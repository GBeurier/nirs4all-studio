/**
 * Coordinator of Studio's single Python environment.
 *
 * Studio uses exactly one interpreter: the one persisted in
 * `env-settings.json`. This class owns that selection, derives its state from
 * a package listing (never from imports), installs the required packages when
 * it may, and exposes the operations of the renderer contract
 * (`src/types/pythonEnvironment.ts`). The mechanics live in `electron/env/`.
 *
 * The scientific host itself runs in the Rust sidecar; the main process
 * supplies `restartHost` so that a change of environment is only kept when the
 * sidecar really runs it.
 */

import fs from "node:fs";
import path from "node:path";

import type {
  ApplyPythonEnvRequest,
  CreatePythonEnvRequest,
  InspectPythonEnvResult,
  NewPythonEnvPlan,
  PythonEnvActionResult,
  PythonEnvActivity,
  PythonEnvPhase,
  PythonEnvProblem,
  PythonEnvReport,
  PythonEnvState,
} from "../src/types/pythonEnvironment";
import { recommendedInstallSpecs } from "./env/catalogue";
import { clearDetectionCache, detectEnvironments } from "./env/env-detection";
import { SETTINGS_FILE, readSelectedPythonPath, writeSelectedPythonPath } from "./env/env-settings";
import { loadNetworkTrust, loadPythonRuntimeConfig } from "./env/external-config";
import { editableRequiredPackages, evaluateInventory, takeInventory } from "./env/inventory";
import type { PythonInventory } from "./env/inventory";
import { readCachedInventory, writeCachedInventory } from "./env/inventory-cache";
import { createStudioEnvironment } from "./env/provisioning";
import {
  canonicalPythonPath,
  getPythonExecutableCandidatesForEnvRoot,
  normalizePythonPath,
} from "./env/python-discovery";
import { getStudioEnvDir, getVenvPythonPath } from "./env/runtime-paths";
import { installRecommendedPackages, installRequiredPackages, resolveUvPayload } from "./env/uv";

export interface EnvManagerOptions {
  /** Electron's `userData` directory: settings, inventory cache and Studio's own environment. */
  userDataDir: string;
  /**
   * Restart the sidecar on the current selection (`getHost()`) and confirm
   * that it runs that interpreter. Rejects with a user-facing reason.
   */
  restartHost(): Promise<void>;
}

/** What the sidecar needs to run the selected interpreter. */
export interface PythonHost {
  pythonPath: string;
  sitePackages: string;
}

interface Evaluation {
  inventory: PythonInventory;
  report: PythonEnvReport;
}

interface Selection {
  pythonPath: string | null;
  phase: Exclude<PythonEnvPhase, "busy">;
  evaluation: Evaluation | null;
  problem?: PythonEnvProblem;
}

/** User-facing reason; certificate failures of a download or an installation get their remedy. */
function errorMessage(error: unknown): string {
  return loadNetworkTrust().explainNetworkError(error).message;
}

function unmetRequirements(report: PythonEnvReport): string {
  return report.required
    .filter((item) => item.status !== "ok")
    .map((item) => item.installedVersion
      ? `${item.name} ${item.installedVersion}${item.requiredRange ? ` (required ${item.requiredRange})` : ""}`
      : `${item.name} (missing)`)
    .join(", ");
}

/** Why Studio may not install the required packages itself, or null when it may. */
function installBlocker(report: PythonEnvReport): string | null {
  const editable = report.required.filter((item) => item.status === "editable").map((item) => item.name);
  if (editable.length > 0) {
    return `${editable.join(", ")} is installed in development (editable) mode outside the version Studio requires: ${unmetRequirements(report)}. Studio does not modify editable installs; update it in this environment or choose another one.`;
  }
  if (!report.writable) {
    return `Studio cannot install packages in this environment (it is read-only or managed by the operating system). Not satisfied: ${unmetRequirements(report)}. Install them yourself or choose another environment.`;
  }
  return null;
}

/** Accept an interpreter path or an environment directory. */
function resolveInterpreter(target: string): string {
  const location = normalizePythonPath(target);
  let isDirectory: boolean;
  try {
    isDirectory = fs.statSync(location).isDirectory();
  } catch {
    throw new Error("No Python interpreter was found at this location.");
  }
  if (!isDirectory) return location;
  const pythonPath = getPythonExecutableCandidatesForEnvRoot(location).find((candidate) => fs.existsSync(candidate));
  if (!pythonPath) throw new Error("No Python interpreter was found in this folder.");
  return pythonPath;
}

export class EnvManager {
  private readonly studioEnvDir: string;
  private readonly settingsPath: string;
  private readonly offlineInstall = resolveUvPayload().offline !== null;
  private readonly listeners = new Set<(state: PythonEnvState) => void>();
  private current: Selection;
  private activity: PythonEnvActivity | undefined;
  /** The running operation installed into the selected environment, which the sidecar is using. */
  private selectionModified = false;

  constructor(private readonly options: EnvManagerOptions) {
    this.studioEnvDir = getStudioEnvDir(options.userDataDir);
    this.settingsPath = path.join(options.userDataDir, SETTINGS_FILE);
    const persisted = readSelectedPythonPath(this.settingsPath);
    // The phase is settled by `startupCheck()`, which runs before any window exists.
    this.current = { pythonPath: persisted && normalizePythonPath(persisted), phase: "unconfigured", evaluation: null };
  }

  getState(): PythonEnvState {
    const { pythonPath, phase, evaluation, problem } = this.current;
    return {
      phase: this.activity ? "busy" : phase,
      selectedPythonPath: pythonPath,
      selected: evaluation?.report ?? null,
      ...(problem ? { problem } : {}),
      ...(this.activity ? { activity: this.activity } : {}),
      offlineInstall: this.offlineInstall,
    };
  }

  /** Subscribe to state changes; returns the unsubscribe function. */
  onStateChange(listener: (state: PythonEnvState) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** The interpreter the sidecar must run, or null when the selection is not usable. */
  getHost(): PythonHost | null {
    const { pythonPath, phase, evaluation } = this.current;
    return phase === "ready" && pythonPath && evaluation
      ? { pythonPath, sitePackages: evaluation.inventory.purelib }
      : null;
  }

  /**
   * Check the selection before the sidecar starts. Required packages that are
   * missing or out of range are installed when the environment allows it. A
   * failure is recorded in the state; Studio still opens.
   */
  async startupCheck(): Promise<PythonEnvState> {
    await this.checkSelection(true);
    this.setActivity(undefined);
    return this.getState();
  }

  /** The sidecar reported that it could not run the selected environment. */
  reportHostFailure(message: string): void {
    if (this.current.phase !== "ready") return;
    this.settle({ ...this.current, phase: "needs_attention", problem: { code: "host_failed", message } });
  }

  detect(refresh = false): Promise<PythonEnvReport[]> {
    return detectEnvironments({ studioEnvDir: this.studioEnvDir, selectedPythonPath: this.current.pythonPath }, refresh);
  }

  async inspect(target: string): Promise<InspectPythonEnvResult> {
    try {
      return { report: (await this.evaluate(this.canonical(resolveInterpreter(target)), false)).report };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }

  /**
   * What a new Studio environment would contain: the pinned Python and every
   * catalogue package, evaluated against an empty environment. No subprocess.
   */
  describeNewEnvironment(): NewPythonEnvPlan {
    const { PYTHON_VERSION } = loadPythonRuntimeConfig<{ PYTHON_VERSION: string }>();
    const { pythonVersion, required, recommended } = evaluateInventory(getVenvPythonPath(this.studioEnvDir), {
      pythonVersion: PYTHON_VERSION,
      distributions: {},
      editable: [],
      externallyManaged: false,
      purelib: "",
      purelibWritable: true,
    }, this.studioEnvDir);
    return { pythonVersion, required, recommended };
  }

  apply(request: ApplyPythonEnvRequest): Promise<PythonEnvActionResult> {
    return this.runAction({ kind: "switching", percent: null, detail: "Checking the selected environment…" }, async () => {
      const pythonPath = this.canonical(resolveInterpreter(request.pythonPath));
      // Refuse unknown package names before anything is installed.
      recommendedInstallSpecs(request.packages);
      let evaluation = await this.evaluate(pythonPath, false);
      const installsRequired = !evaluation.report.usable;
      const blocker = installsRequired ? installBlocker(evaluation.report) : null;
      if (blocker) throw new Error(blocker);
      if (request.packages.length > 0 && !evaluation.report.writable) {
        throw new Error("Studio cannot install packages in this environment (it is read-only or managed by the operating system).");
      }
      if (installsRequired) {
        this.setActivity({ kind: "installing", percent: null, detail: "Installing the required packages…" });
        this.selectionModified ||= pythonPath === this.current.pythonPath;
        await installRequiredPackages(pythonPath, editableRequiredPackages(evaluation.inventory));
      }
      if (request.packages.length > 0) {
        this.setActivity({ kind: "installing", percent: null, detail: "Installing the selected packages…" });
        this.selectionModified ||= pythonPath === this.current.pythonPath;
        await installRecommendedPackages(pythonPath, request.packages);
      }
      if (installsRequired || request.packages.length > 0) evaluation = await this.evaluate(pythonPath, false);
      await this.switchTo(pythonPath, evaluation);
    });
  }

  create(request: CreatePythonEnvRequest): Promise<PythonEnvActionResult> {
    return this.runAction({ kind: "creating", percent: 0, detail: "Preparing the new environment…" }, async () => {
      recommendedInstallSpecs(request.packages);
      const baseDir = request.directory ? path.join(request.directory, "python-env") : this.studioEnvDir;
      const pythonPath = this.canonical(await createStudioEnvironment(baseDir, request.packages, (percent, detail) => {
        this.setActivity({ kind: "creating", percent, detail });
      }));
      await this.switchTo(pythonPath, await this.evaluate(pythonPath, false));
    });
  }

  installPackages(packages: string[]): Promise<PythonEnvActionResult> {
    return this.runAction({ kind: "installing", percent: null, detail: "Installing the selected packages…" }, async () => {
      const { pythonPath, evaluation } = this.current;
      if (!pythonPath || !evaluation) throw new Error("No usable Python environment is selected.");
      if (!evaluation.report.writable) {
        throw new Error("Studio cannot install packages in this environment (it is read-only or managed by the operating system).");
      }
      this.selectionModified = true;
      await installRecommendedPackages(pythonPath, packages);
      await this.checkAndActivate();
    });
  }

  retry(): Promise<PythonEnvActionResult> {
    return this.runAction({ kind: "updating_required", percent: null, detail: "Checking the Python environment…" }, () => this.checkAndActivate());
  }

  /** One operation at a time; a failure is returned as a message, never thrown. */
  private async runAction(activity: PythonEnvActivity, action: () => Promise<void>): Promise<PythonEnvActionResult> {
    if (this.activity) {
      return { success: false, message: "Another Python environment operation is still running.", state: this.getState() };
    }
    this.setActivity(activity);
    this.selectionModified = false;
    let message: string | undefined;
    try {
      await action();
    } catch (error) {
      message = errorMessage(error);
      console.warn(`[EnvManager] ${activity.kind} failed: ${message}`);
      if (this.selectionModified) await this.resyncSelection().catch(() => undefined);
    }
    clearDetectionCache();
    this.setActivity(undefined);
    return { success: message === undefined, ...(message === undefined ? {} : { message }), state: this.getState() };
  }

  /** The one spelling emitted for an interpreter path; see `canonicalPythonPath`. */
  private canonical(pythonPath: string): string {
    return canonicalPythonPath(pythonPath, this.current.pythonPath);
  }

  private setActivity(activity: PythonEnvActivity | undefined): void {
    if (activity === undefined && this.activity === undefined) return;
    this.activity = activity;
    this.emit();
  }

  private settle(selection: Selection): void {
    this.current = selection;
    const versions = selection.evaluation?.report.required
      .map((item) => `${item.name} ${item.installedVersion ?? "missing"}`).join(", ");
    console.log(`[EnvManager] Python environment: phase=${selection.phase} | path=${selection.pythonPath ?? "none"}`
      + `${versions ? ` | ${versions}` : ""}${selection.problem ? ` | ${selection.problem.code}: ${selection.problem.message}` : ""}`);
    this.emit();
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  /** List an interpreter's packages; the persistent cache only ever describes the selection. */
  private async evaluate(pythonPath: string, useCache: boolean): Promise<Evaluation> {
    const cached = useCache ? readCachedInventory(this.options.userDataDir, pythonPath) : null;
    const inventory = cached ?? await takeInventory(pythonPath);
    if (!cached && pythonPath === this.current.pythonPath) {
      writeCachedInventory(this.options.userDataDir, pythonPath, inventory);
    }
    return { inventory, report: evaluateInventory(pythonPath, inventory, this.studioEnvDir) };
  }

  /** Settle the selection's phase, installing the required packages when Studio may. */
  private async checkSelection(useCache: boolean): Promise<void> {
    const pythonPath = this.current.pythonPath;
    if (!pythonPath) {
      this.settle({ pythonPath, phase: "unconfigured", evaluation: null });
      return;
    }
    if (!fs.existsSync(pythonPath)) {
      this.settle({
        pythonPath,
        phase: "unconfigured",
        evaluation: null,
        problem: { code: "interpreter_missing", message: `The selected Python interpreter no longer exists: ${pythonPath}` },
      });
      return;
    }
    let evaluation: Evaluation;
    try {
      evaluation = await this.evaluate(pythonPath, useCache);
    } catch (error) {
      this.settle({ pythonPath, phase: "needs_attention", evaluation: null, problem: { code: "interpreter_missing", message: errorMessage(error) } });
      return;
    }
    if (!evaluation.report.usable) {
      const blocker = installBlocker(evaluation.report);
      if (blocker) {
        this.settle({ pythonPath, phase: "needs_attention", evaluation, problem: { code: "required_not_installable", message: blocker } });
        return;
      }
      this.setActivity({ kind: "updating_required", percent: null, detail: "Updating the required Python packages…" });
      try {
        await installRequiredPackages(pythonPath, editableRequiredPackages(evaluation.inventory));
        evaluation = await this.evaluate(pythonPath, false);
        if (!evaluation.report.usable) throw new Error(`Still not satisfied after installation: ${unmetRequirements(evaluation.report)}.`);
      } catch (error) {
        this.settle({
          pythonPath,
          phase: "needs_attention",
          evaluation,
          problem: { code: "required_update_failed", message: `Studio could not install the required packages. ${errorMessage(error)}` },
        });
        return;
      }
    }
    this.settle({ pythonPath, phase: "ready", evaluation });
  }

  /** Restart the sidecar on the current selection; a failure becomes the `host_failed` problem. */
  private async restartHost(): Promise<void> {
    try {
      await this.options.restartHost();
    } catch (error) {
      this.reportHostFailure(errorMessage(error));
      throw error;
    }
  }

  /** Re-run the startup check, then restart the sidecar on the result. */
  private async checkAndActivate(): Promise<void> {
    await this.checkSelection(false);
    await this.restartHost();
    if (this.current.phase !== "ready") {
      throw new Error(this.current.problem?.message ?? "No Python environment is selected.");
    }
  }

  /**
   * After a failed operation that installed into the selected environment:
   * read it again and, when a required package changed, restart the sidecar.
   * The sidecar admitted the nirs4all version it started with and its workers
   * refuse to run on any other.
   */
  private async resyncSelection(): Promise<void> {
    const required = () => JSON.stringify(this.current.evaluation?.report.required);
    const before = required();
    await this.checkSelection(false);
    if (required() !== before) await this.restartHost();
  }

  /**
   * Select an environment and keep it only when the sidecar runs it: on
   * failure the previous selection is persisted again and restarted.
   */
  private async switchTo(pythonPath: string, evaluation: Evaluation): Promise<void> {
    if (!evaluation.report.usable) {
      throw new Error(`The required packages are not satisfied: ${unmetRequirements(evaluation.report)}.`);
    }
    const previous = this.current;
    this.setActivity({ kind: "switching", percent: null, detail: "Starting the analysis backend on this environment…" });
    writeSelectedPythonPath(this.settingsPath, pythonPath);
    writeCachedInventory(this.options.userDataDir, pythonPath, evaluation.inventory);
    this.settle({ pythonPath, phase: "ready", evaluation });
    try {
      await this.options.restartHost();
    } catch (error) {
      this.settle(previous);
      try {
        writeSelectedPythonPath(this.settingsPath, previous.pythonPath);
        await this.restartHost();
      } catch (restoreError) {
        console.error("[EnvManager] Could not restart the previous environment:", restoreError);
      }
      throw new Error(`${errorMessage(error)} Your previous environment selection has been restored.`);
    }
  }
}
