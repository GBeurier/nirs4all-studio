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
import { editableRequiredPackages, evaluateInventory, installedRequiredPins, takeInventory } from "./env/inventory";
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
import type { WheelhouseCache } from "./env/wheelhouse";

export interface EnvManagerOptions {
  /** Electron's `userData` directory: settings, inventory cache and Studio's own environment. */
  userDataDir: string;
  /**
   * Restart the sidecar on the current selection (`getHost()`) and confirm
   * that it runs that interpreter. Rejects with a user-facing reason.
   */
  restartHost(): Promise<void>;
  /**
   * Stop the sidecar when it is running a Python environment, so that the
   * environment's files are free to be replaced. Resolves to whether it was stopped.
   */
  stopHost(): Promise<boolean>;
  /** A sentence describing the runs the sidecar is executing, or null when it is idle. */
  describeActiveRuns(): Promise<string | null>;
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

const NOT_WRITABLE = "Studio cannot install packages in this environment (it is read-only or managed by the operating system).";

/**
 * Why Studio may not install the required packages itself, or null when it
 * may. Any editable required package blocks the installation: the resolver
 * could replace it as a dependency of another required package, and Studio
 * never modifies an editable install.
 */
function installBlocker({ inventory, report }: Evaluation): string | null {
  const editable = editableRequiredPackages(inventory);
  if (editable.length > 0) {
    return `${editable.join(", ")} ${editable.length === 1 ? "is" : "are"} installed in development (editable) mode, and Studio does not modify editable installs. Not satisfied: ${unmetRequirements(report)}. Install or update them yourself in this environment, or choose another one.`;
  }
  if (!report.writable) {
    return `${NOT_WRITABLE} Not satisfied: ${unmetRequirements(report)}. Install them yourself or choose another environment.`;
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
  /** Required wheels are downloaded on first use where the installer cannot embed them; see `env/wheelhouse.ts`. */
  private readonly wheelhouse: WheelhouseCache;
  private current: Selection;
  private activity: PythonEnvActivity | undefined;
  /** The sidecar was stopped or restarted during the running operation. */
  private hostRestarted = false;
  /** The sidecar was stopped for an installation and has not been started again. */
  private hostStopped = false;

  constructor(private readonly options: EnvManagerOptions) {
    this.studioEnvDir = getStudioEnvDir(options.userDataDir);
    this.settingsPath = path.join(options.userDataDir, SETTINGS_FILE);
    this.wheelhouse = {
      directory: path.join(options.userDataDir, "wheelhouse"),
      onProgress: (detail) => { if (this.activity) this.setActivity({ ...this.activity, detail }); },
    };
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
    // The caller starts the sidecar next, whatever was stopped for an installation.
    this.hostStopped = false;
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
      const blocker = installsRequired ? installBlocker(evaluation) : null;
      if (blocker) throw new Error(blocker);
      if (request.packages.length > 0 && !evaluation.report.writable) throw new Error(NOT_WRITABLE);
      if (installsRequired) {
        this.setActivity({ kind: "installing", percent: null, detail: "Installing the required packages…" });
        await this.stopHostBeforeInstalling(pythonPath);
        await installRequiredPackages(pythonPath, this.wheelhouse);
        evaluation = await this.evaluate(pythonPath, false);
      }
      if (request.packages.length > 0) {
        this.setActivity({ kind: "installing", percent: null, detail: "Installing the selected packages…" });
        await this.stopHostBeforeInstalling(pythonPath);
        await installRecommendedPackages(pythonPath, request.packages, installedRequiredPins(evaluation.inventory), this.wheelhouse);
        evaluation = await this.evaluate(pythonPath, false);
      }
      await this.switchTo(pythonPath, evaluation);
    });
  }

  create(request: CreatePythonEnvRequest): Promise<PythonEnvActionResult> {
    return this.runAction({ kind: "creating", percent: 0, detail: "Preparing the new environment…" }, async () => {
      recommendedInstallSpecs(request.packages);
      const baseDir = request.directory ? path.join(request.directory, "python-env") : this.studioEnvDir;
      const pythonPath = this.canonical(await createStudioEnvironment(baseDir, request.packages, (percent, detail) => {
        this.setActivity({ kind: "creating", percent, detail });
      }, this.wheelhouse.directory));
      await this.switchTo(pythonPath, await this.evaluate(pythonPath, false));
    });
  }

  installPackages(packages: string[]): Promise<PythonEnvActionResult> {
    return this.runAction({ kind: "installing", percent: null, detail: "Installing the selected packages…" }, async () => {
      const pythonPath = this.current.pythonPath;
      if (!pythonPath || !this.current.evaluation) throw new Error("No usable Python environment is selected.");
      recommendedInstallSpecs(packages);
      // Read the environment now: its required packages are pinned at the versions really installed.
      const { inventory, report } = await this.evaluate(pythonPath, false);
      if (!report.writable) throw new Error(NOT_WRITABLE);
      await this.stopHostBeforeInstalling(pythonPath);
      await installRecommendedPackages(pythonPath, packages, installedRequiredPins(inventory), this.wheelhouse);
      await this.checkAndActivate();
    });
  }

  retry(): Promise<PythonEnvActionResult> {
    return this.runAction({ kind: "updating_required", percent: null, detail: "Checking the Python environment…" }, () => this.checkAndActivate());
  }

  /**
   * The user's "restart backend": with a problem to solve it is a retry,
   * otherwise the sidecar is restarted on the current selection. It may
   * interrupt a run, which is what the user asked for.
   */
  restartBackend(): Promise<PythonEnvActionResult> {
    if (this.current.phase === "needs_attention") return this.retry();
    return this.runAction(
      { kind: "switching", percent: null, detail: "Restarting the analysis backend…" },
      () => this.activateHost(),
      { interruptsRuns: true },
    );
  }

  /**
   * One operation at a time; a failure is returned as a message, never thrown.
   * An operation ends by restarting the sidecar, which would kill a run in
   * progress: unless that is intended, it is refused while a run is active.
   */
  private async runAction(
    activity: PythonEnvActivity,
    action: () => Promise<void>,
    { interruptsRuns = false } = {},
  ): Promise<PythonEnvActionResult> {
    if (this.activity) {
      return { success: false, message: "Another Python environment operation is still running.", hostRestarted: false, state: this.getState() };
    }
    this.setActivity(activity);
    this.hostRestarted = false;
    let message: string | undefined;
    try {
      const activeRuns = interruptsRuns ? null : await this.options.describeActiveRuns();
      if (activeRuns) throw new Error(`${activeRuns} Wait for the end of the run or stop it, then try again.`);
      await action();
    } catch (error) {
      message = errorMessage(error);
      console.warn(`[EnvManager] ${activity.kind} failed: ${message}`);
      // An installation failed while the sidecar was stopped for it: read the
      // environment as it now is and start the sidecar again.
      if (this.hostStopped) {
        await this.checkSelection(false);
        await this.activateHost().catch(() => undefined);
      }
    }
    clearDetectionCache();
    this.setActivity(undefined);
    return {
      success: message === undefined,
      ...(message === undefined ? {} : { message }),
      hostRestarted: this.hostRestarted,
      state: this.getState(),
    };
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
      this.settle({ pythonPath, phase: "needs_attention", evaluation: null, problem: { code: "interpreter_unusable", message: errorMessage(error) } });
      return;
    }
    if (!evaluation.report.usable) {
      const blocker = installBlocker(evaluation);
      if (blocker) {
        this.settle({ pythonPath, phase: "needs_attention", evaluation, problem: { code: "required_not_installable", message: blocker } });
        return;
      }
      this.setActivity({ kind: "updating_required", percent: null, detail: "Updating the required Python packages…" });
      try {
        await this.stopHostBeforeInstalling(pythonPath);
        await installRequiredPackages(pythonPath, this.wheelhouse);
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

  /**
   * The sidecar and its warm workers hold the files of the environment they
   * run: Windows cannot replace a loaded extension module, and elsewhere a
   * running worker would mix versions. Stop it before installing there.
   */
  private async stopHostBeforeInstalling(pythonPath: string): Promise<void> {
    if (pythonPath !== this.current.pythonPath || this.hostStopped) return;
    if (await this.options.stopHost()) {
      this.hostRestarted = true;
      this.hostStopped = true;
    }
  }

  private async restartHost(): Promise<void> {
    this.hostRestarted = true;
    this.hostStopped = false;
    await this.options.restartHost();
  }

  /** Restart the sidecar on the current selection; a failure becomes the `host_failed` problem. */
  private async activateHost(): Promise<void> {
    try {
      await this.restartHost();
    } catch (error) {
      this.reportHostFailure(errorMessage(error));
      throw error;
    }
  }

  /** Re-run the startup check, then restart the sidecar on the result. */
  private async checkAndActivate(): Promise<void> {
    await this.checkSelection(false);
    await this.activateHost();
    if (this.current.phase !== "ready") {
      throw new Error(this.current.problem?.message ?? "No Python environment is selected.");
    }
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
    if (pythonPath === previous.pythonPath) {
      // The same environment, possibly with new packages: there is no other selection to return to.
      await this.activateHost();
      return;
    }
    try {
      await this.restartHost();
    } catch (error) {
      this.settle(previous);
      try {
        writeSelectedPythonPath(this.settingsPath, previous.pythonPath);
        await this.activateHost();
      } catch (restoreError) {
        console.error("[EnvManager] Could not restart the previous environment:", restoreError);
      }
      throw new Error(`${errorMessage(error)} Your previous environment selection has been restored.`);
    }
  }
}
