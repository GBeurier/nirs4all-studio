/**
 * Runtime Python environment manager for Electron.
 *
 * Downloads python-build-standalone and creates a venv on first launch,
 * so the installer stays lightweight (~15MB instead of 350MB).
 * The Python env is stored in the user's app data directory.
 *
 * This module is the coordinator: it owns the in-memory env state and the
 * setup/verify/detect/apply flows. The lower-level mechanics are split into
 * focused modules under `electron/env/`:
 *   - network-probe         — outbound reachability probe
 *   - process-utils         — runCommand / rmWithRetry / execFileText
 *   - python-discovery      — interpreter discovery across ecosystems
 *   - python-runtime-installer — download / extract / quarantine primitives
 *   - env-inspection        — package scoring and pure interpreter inspection
 *   - env-settings          — env-settings.json shape + read/write
 *   - runtime-paths         — runtime-mode + filesystem-layout resolution
 *   - env-detection         — existing-env discovery, classification, TTL cache
 *   - verify-cache          — verify-cache.json fingerprint + read/write
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { probeNetworkOnline } from "./env/network-probe";
import {
  getEnvRootForPythonPath,
  getPythonExecutableCandidatesForEnvRoot,
} from "./env/python-discovery";
import {
  getMissingCorePackages,
  getMissingOptionalPackages,
  guessProfileAlignment,
  inspectPythonPackages,
} from "./env/env-inspection";
import type {
  DetectedEnv,
  InspectedEnv,
  InspectPythonData,
} from "./env/env-inspection";
import { installCorePackages, provisionManagedRuntime } from "./env/provisioning";
import type { ProvisioningContext } from "./env/provisioning";
import { SETTINGS_FILE, readEnvSettings, writeEnvSettings } from "./env/env-settings";
import type { EnvSettings } from "./env/env-settings";
import {
  detectBundledRuntime,
  getEnvKind,
  getManagedPythonPath,
  getSitePackagesForPythonPath,
  isLikelyWritable,
  resolveSitePackages,
} from "./env/runtime-paths";
import type { BundledRuntimeInfo } from "./env/runtime-paths";
import { checkPythonEnv, detectExistingEnvs } from "./env/env-detection";
import { computeEnvFingerprint, readVerifyCache, writeVerifyCache } from "./env/verify-cache";

/* eslint-disable @typescript-eslint/no-require-imports */
type AppLike = Pick<Electron.App, "getPath" | "getVersion">;
// require("electron") resolves to the binary path string outside the Electron
// runtime (Vitest locally) and THROWS when the binary was never downloaded
// (CI runners). Both must fall through to the injected/stub app below.
const electronModule = (() => {
  try {
    return require("electron") as typeof import("electron") | string;
  } catch {
    return "electron-unavailable";
  }
})();
const testApp = (globalThis as { __NIRS4ALL_TEST_APP__?: AppLike }).__NIRS4ALL_TEST_APP__;
const { app } = typeof electronModule === "string"
  ? {
      // In non-Electron contexts (for example Vitest), require("electron")
      // resolves to the binary path string. Fall back to an injected test app,
      // or a minimal cwd-based stub so the module can still be exercised.
      app: testApp ?? {
        getPath: (_name: string) => process.cwd(),
        getVersion: () => "0.0.0-test",
      },
    }
  : electronModule;

export type EnvStatus = "none" | "downloading" | "extracting" | "creating_venv" | "installing" | "ready" | "error";

export type ProgressCallback = (percent: number, step: string, detail: string) => void;

export interface EnvInfo {
  status: EnvStatus;
  envDir: string;
  pythonPath: string | null;
  sitePackages: string | null;
  pythonVersion: string | null;
  isCustom: boolean;
  error?: string;
}

export type EnvRuntimeMode = "bundled" | "managed" | "custom" | "none";

export interface EnvSummary {
  pythonPath: string;
  envPath: string;
  version: string;
}

interface EnsureBackendPackagesOptions {
  timeoutMs?: number;
}

function envTimeoutMs(name: string, fallbackMs: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value >= 1000 ? value : fallbackMs;
}

interface ApplyExistingPythonOptions {
  installCorePackages?: boolean;
}

export class EnvManager {
  private status: EnvStatus = "none";
  private lastError: string | null = null;
  private envDir: string;
  private settingsPath: string;
  private pythonPath: string | null = null;
  private savedAppVersion: string | null = null;
  private savedSkipWizard: boolean = false;

  constructor() {
    this.envDir = path.join(app.getPath("userData"), "python-env");
    this.settingsPath = path.join(app.getPath("userData"), SETTINGS_FILE);
    this.loadSettings();

    // Check initial status
    if (this.isReady()) {
      this.status = "ready";
    }
  }

  private loadSettings(): void {
    const data = readEnvSettings(this.settingsPath);
    if (!data) return;

    this.savedAppVersion = (data.appVersion as string) ?? null;
    this.savedSkipWizard = (data.skipWizardOnLaunch as boolean) ?? false;
    if (data.pythonPath) {
      this.pythonPath = data.pythonPath as string;
    }
  }

  private saveSettings(): void {
    const data: EnvSettings = {};
    if (this.pythonPath) data.pythonPath = this.pythonPath;
    if (this.savedAppVersion) data.appVersion = this.savedAppVersion;
    if (this.savedSkipWizard) data.skipWizardOnLaunch = this.savedSkipWizard;
    writeEnvSettings(this.settingsPath, data);
  }

  /** Get the environment directory */
  getEnvDir(): string {
    return this.envDir;
  }

  /** Get the persisted Electron env settings file path. */
  getSettingsPath(): string {
    return this.settingsPath;
  }

  /** Get current setup status */
  getStatus(): EnvStatus {
    return this.status;
  }

  /** Check if the Python environment is ready to use */
  isReady(): boolean {
    const pythonPath = this.getPythonPath();
    if (!pythonPath || !fs.existsSync(pythonPath)) return false;

    const sitePackages = this.getSitePackages();
    if (!sitePackages || !fs.existsSync(sitePackages)) return false;

    return true;
  }

  detectBundledRuntime(): BundledRuntimeInfo | null {
    return detectBundledRuntime();
  }

  isBundled(): boolean {
    return detectBundledRuntime() !== null;
  }

  /**
   * Get the Python executable Electron is currently configured to use.
   *
   * This differs from getPythonPath(): explicit user selection wins over the
   * packaged bundled runtime so the UI can show configured-vs-running
   * mismatches immediately, before the backend is restarted.
   */
  getConfiguredPythonPath(): string | null {
    if (this.pythonPath && fs.existsSync(this.pythonPath)) {
      return this.pythonPath;
    }

    const bundledRuntime = detectBundledRuntime();
    if (bundledRuntime) {
      return bundledRuntime.pythonPath;
    }

    const managedPython = getManagedPythonPath(this.envDir);
    return fs.existsSync(managedPython) ? managedPython : null;
  }

  /** Get the configured runtime mode from Electron state. */
  getConfiguredRuntimeMode(): EnvRuntimeMode {
    if (this.pythonPath && fs.existsSync(this.pythonPath)) return "custom";
    if (this.isBundled()) return "bundled";
    return fs.existsSync(getManagedPythonPath(this.envDir)) ? "managed" : "none";
  }

  /**
   * Resolve the Python executable Electron intends to target for backend
   * verification / repair work. Falls back to the runtime launch path when no
   * configured interpreter has been persisted yet.
   */
  private getBackendTargetPythonPath(): string | null {
    return this.getConfiguredPythonPath() ?? this.getPythonPath();
  }

  /** Get the Python executable path */
  getPythonPath(): string | null {
    const bundledRuntime = detectBundledRuntime();
    if (bundledRuntime) {
      return bundledRuntime.pythonPath;
    }

    // Custom python path (user-selected or custom-dir setup)
    if (this.pythonPath) {
      if (fs.existsSync(this.pythonPath)) return this.pythonPath;
      return null;
    }

    // Managed env: use the venv's Python directly.
    // Since the venv is created on the user's machine (not bundled from build),
    // pyvenv.cfg has correct paths and sys.prefix resolves to the venv.
    // This ensures VenvManager's pip_executable and package installs work correctly.
    return getManagedPythonPath(this.envDir);
  }

  /** Get the site-packages path */
  getSitePackages(): string | null {
    const bundledRuntime = detectBundledRuntime();
    if (bundledRuntime) {
      return bundledRuntime.sitePackages;
    }

    // Custom python path: derive env root from executable location
    if (this.pythonPath) {
      return resolveSitePackages(getEnvRootForPythonPath(this.pythonPath), true);
    }

    // Managed env
    const venvDir = path.join(this.envDir, "venv");
    return resolveSitePackages(venvDir);
  }

  private buildInspectedEnv(pythonPath: string, data: InspectPythonData): InspectedEnv {
    const envRoot = getEnvRootForPythonPath(pythonPath);
    const installedPackageNames = new Set(data.installedPackages.keys());
    const missingCorePackages = getMissingCorePackages(installedPackageNames);
    const profileAlignmentGuess = guessProfileAlignment(installedPackageNames);

    return {
      path: envRoot,
      pythonPath,
      pythonVersion: data.version,
      hasNirs4all: installedPackageNames.has("nirs4all"),
      hasCorePackages: missingCorePackages.length === 0,
      envKind: getEnvKind(this.envDir, envRoot, pythonPath),
      writable: isLikelyWritable(envRoot, pythonPath),
      missingCorePackages,
      missingOptionalPackages: getMissingOptionalPackages(installedPackageNames),
      profileAlignmentGuess,
    };
  }

  /** Get full environment info */
  async getInfo(): Promise<EnvInfo> {
    const pythonPath = this.getConfiguredPythonPath();
    let pythonVersion: string | null = null;
    if (pythonPath && fs.existsSync(pythonPath)) {
      const detected = await checkPythonEnv(this.envDir, pythonPath);
      if (detected) pythonVersion = detected.pythonVersion;
    }
    return {
      status: this.status,
      envDir: this.envDir,
      pythonPath,
      sitePackages: getSitePackagesForPythonPath(pythonPath),
      pythonVersion,
      isCustom: this.getConfiguredRuntimeMode() === "custom",
      error: this.lastError ?? undefined,
    };
  }

  /** Check if this is a portable (non-installed) build */
  isPortable(): boolean {
    return !!process.env.PORTABLE_EXECUTABLE_FILE;
  }

  /**
   * Validate the currently configured Python path.
   *
   * This catches stale custom paths and half-missing managed envs before the
   * app tries to reuse them on startup.
   *
   * @returns `true` if the configured runtime is still reachable.
   */
  validateConfiguredState(): boolean {
    if (this.pythonPath && !fs.existsSync(this.pythonPath)) {
      console.warn(
        `[EnvManager] Configured Python not found at ${this.pythonPath} (clearing saved custom path)`,
      );
      this.pythonPath = null;
      this.savedAppVersion = null;
      this.saveSettings();
      this.status = "none";
      this.lastError = null;
      return false;
    }

    const pythonPath = this.getPythonPath();
    if (!pythonPath) {
      this.status = "none";
      return false;
    }

    if (fs.existsSync(pythonPath)) {
      return true;
    }

    console.warn(
      `[EnvManager] Configured Python not found at ${pythonPath}`,
    );

    this.status = "none";
    this.lastError = null;
    return false;
  }

  /**
   * Single decision point for whether the setup wizard should be shown.
   *
   * Rules:
   * - Env not configured / broken → always show.
   * - Wizard never completed before → show (savedAppVersion is null on a
   *   fresh install or after `validateConfiguredState` cleared a stale path).
   * - Wizard completed for the current app version → skip silently. This is
   *   the common case, including portable mode: once a portable user has
   *   gone through the wizard once on a given .exe + version, we don't nag
   *   them again. Moving the .exe to a different folder is handled by
   *   `validateConfiguredState`, which clears `savedAppVersion` if the saved
   *   custom python path no longer exists.
   * - App version bump → show once, unless `savedSkipWizard` was set via the
   *   "Don't ask again" checkbox in the wizard's final step.
   */
  shouldShowWizard(): boolean {
    this.validateConfiguredState();

    // Standalone archive runtime is pre-baked and immutable. Even if a prior
    // verify failed, routing to the setup wizard would be misleading because
    // the bundle cannot be repaired in-place from that flow.
    if (this.isBundled()) return false;

    // Startup validation failed (for example a timed-out repair on a stale env)
    // — route the user back through the setup flow instead of leaving them on
    // the backend-connecting screen forever.
    if (this.status === "error") return true;

    // Env not configured at all → must show wizard
    if (!this.isReady()) return true;

    const currentVersion = app.getVersion();

    // Env ready and the wizard was already completed for this version → skip.
    if (this.savedAppVersion === currentVersion) {
      return false;
    }

    // Env ready but version bumped (or this is the first run after a manual
    // settings file). The "Don't ask again" opt-out from a previous run still
    // applies — refresh the saved version so we stop asking on subsequent
    // launches.
    if (this.savedAppVersion && this.savedSkipWizard) {
      this.savedAppVersion = currentVersion;
      this.saveSettings();
      return false;
    }

    return true;
  }

  /**
   * Mark the setup wizard as completed.
   * Saves the current app version and the "don't ask again" preference.
   */
  markWizardComplete(skipNextTime: boolean): void {
    this.savedAppVersion = app.getVersion();
    this.savedSkipWizard = skipNextTime;
    this.saveSettings();
  }

  /**
   * Get a summary of the currently configured Python environment.
   * Returns null if no env is configured or the Python executable doesn't exist.
   */
  async getCurrentEnvSummary(): Promise<EnvSummary | null> {
    const pythonPath = this.getConfiguredPythonPath();
    if (!pythonPath || !fs.existsSync(pythonPath)) return null;

    const info = await checkPythonEnv(this.envDir, pythonPath);
    if (!info) return null;

    return {
      pythonPath,
      envPath: info.path,
      version: info.pythonVersion,
    };
  }

  /**
   * Lightweight runtime check: verifies that uvicorn and fastapi are
   * importable. Intended for the startup-fast path — does NOT import
   * `nirs4all`, which is heavy and is loaded lazily by the backend itself.
   */
  async verifyBackendRuntime(): Promise<boolean> {
    const pythonPath = this.getBackendTargetPythonPath();
    if (!pythonPath || !fs.existsSync(pythonPath)) return false;

    const timeout = envTimeoutMs("NIRS4ALL_BACKEND_RUNTIME_VERIFY_TIMEOUT_MS", 15000);
    const start = Date.now();
    const result = await new Promise<boolean>((resolve) => {
      execFile(
        pythonPath,
        ["-c", "import uvicorn, fastapi"],
        { timeout },
        (error) => resolve(!error),
      );
    });
    console.log(`verifyBackendRuntime: ${result ? "ok" : "fail"} in ${Date.now() - start}ms`);
    return result;
  }

  /**
   * Heavier verify that also imports `nirs4all`. Used by explicit setup/repair
   * flows, never on the startup critical path.
   */
  async verifyBackendPackages(): Promise<boolean> {
    const pythonPath = this.getBackendTargetPythonPath();
    if (!pythonPath || !fs.existsSync(pythonPath)) return false;

    const timeout = envTimeoutMs("NIRS4ALL_BACKEND_PACKAGE_VERIFY_TIMEOUT_MS", 30000);
    const start = Date.now();
    const result = await new Promise<boolean>((resolve) => {
      execFile(
        pythonPath,
        ["-c", "import uvicorn; import fastapi; import nirs4all"],
        { timeout },
        (error) => resolve(!error),
      );
    });
    console.log(`verifyBackendPackages: ${result ? "ok" : "fail"} in ${Date.now() - start}ms`);
    return result;
  }

  /**
   * Ensure critical backend packages are installed.
   * Verifies the lightweight runtime first, then confirms that `nirs4all`
   * itself imports cleanly before writing the persistent verify cache.
   *
   * Returns true when a repair/install was actually performed.
   *
   * Called before starting the backend to fix the portable-mode issue
   * where the env exists but is missing backend dependencies.
   */
  async ensureBackendPackages(options?: EnsureBackendPackagesOptions): Promise<boolean> {
    if (!this.validateConfiguredState()) {
      this.status = "error";
      this.lastError = "Python environment is not configured or is missing";
      throw new Error(this.lastError);
    }

    const pythonPath = this.getBackendTargetPythonPath();
    if (!pythonPath || !fs.existsSync(pythonPath)) {
      this.status = "error";
      this.lastError = "Python executable not found";
      throw new Error(this.lastError);
    }

    const isBundledRuntime = this.getConfiguredRuntimeMode() === "bundled";

    try {
      let repaired = false;

      // Fast path: persistent verify cache. Skips spawning Python entirely
      // when the env fingerprint matches a previously FULLY verified state.
      const fingerprint = computeEnvFingerprint(this.envDir, pythonPath);
      const currentVersion = app.getVersion();
      if (fingerprint) {
        const cached = readVerifyCache(app.getPath("userData"));
        if (
          cached
          && cached.pythonPath === pythonPath
          && cached.appVersion === currentVersion
          && cached.fingerprint === fingerprint
        ) {
          console.log("ensureBackendPackages: verify-cache hit");
          this.lastError = null;
          this.status = "ready";
          return false;
        }
      } else {
        console.log("ensureBackendPackages: verify-cache disabled (no fingerprint)");
      }

      // Cache miss / disabled / mismatch — verify the lightweight runtime
      // first so we can repair the common "uvicorn/fastapi missing" case
      // without paying the heavier import if the env is obviously broken.
      const hasRuntime = await this.verifyBackendRuntime();
      if (!hasRuntime) {
        if (isBundledRuntime) {
          this.status = "error";
          this.lastError = "Bundled runtime verification failed. Reinstall the all-in-one bundle.";
          throw new Error(this.lastError);
        }
        if (!(await probeNetworkOnline())) {
          // Offline: don't blindly mark ready. Confirm the heavier
          // verifyBackendPackages succeeds before claiming the env works,
          // otherwise leave a clear error so the UI can surface it.
          const hasBackendPackages = await this.verifyBackendPackages();
          if (hasBackendPackages) {
            console.warn("Runtime check failed but backend packages OK and offline — proceeding without repair");
            this.lastError = null;
            this.status = "ready";
            return false;
          }
          this.status = "error";
          this.lastError = "Backend runtime packages missing and the app is offline. Connect to the internet once to repair, or install the required packages manually (fastapi, uvicorn, nirs4all).";
          throw new Error(this.lastError);
        }
        console.log("Backend runtime packages missing, installing core packages...");
        await installCorePackages(pythonPath, {
          timeoutMs: options?.timeoutMs,
        });
        console.log("Core packages installed successfully");
        repaired = true;
      }

      // The startup-fast path only skipped the heavy import from the main
      // process. We still need to confirm that nirs4all imports before we
      // trust or persist this environment state.
      let hasBackendPackages = await this.verifyBackendPackages();
      if (!hasBackendPackages) {
        if (isBundledRuntime) {
          this.status = "error";
          this.lastError = "Bundled runtime packages are not importable. Reinstall the all-in-one bundle.";
          throw new Error(this.lastError);
        }
        if (!(await probeNetworkOnline())) {
          // Offline and packages don't import. The runtime check passed so
          // the backend may still serve a degraded experience; surface the
          // problem rather than claim "ready".
          this.status = "error";
          this.lastError = "Some backend packages are not importable and the app is offline. Connect to the internet to repair the environment.";
          throw new Error(this.lastError);
        }
        if (!repaired) {
          console.log("Backend packages incomplete, reinstalling core packages...");
          await installCorePackages(pythonPath, {
            timeoutMs: options?.timeoutMs,
          });
          console.log("Core packages reinstalled successfully");
          repaired = true;
        }

        hasBackendPackages = await this.verifyBackendPackages();
        if (!hasBackendPackages) {
          throw new Error("Backend packages are still not importable after repair");
        }
      }

      // Persist a fresh cache entry. Recompute the fingerprint after any
      // install so the new site-packages mtime is captured.
      const finalFingerprint = computeEnvFingerprint(this.envDir, pythonPath);
      if (finalFingerprint) {
        writeVerifyCache(app.getPath("userData"), {
          pythonPath,
          appVersion: currentVersion,
          fingerprint: finalFingerprint,
          verifiedAt: Date.now(),
        });
      }

      this.lastError = null;
      this.status = "ready";
      return repaired;
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Detect existing Python environments on the system. Delegates discovery,
   * classification, sorting, and the short-TTL cache to env-detection; this
   * passes the configured/managed interpreter context.
   */
  detectExistingEnvs(): Promise<DetectedEnv[]> {
    return detectExistingEnvs({
      envDir: this.envDir,
      customPythonPath: this.pythonPath,
      configuredPythonPath: this.getConfiguredPythonPath(),
    });
  }

  /**
   * Inspect an existing Python environment without mutating it.
   */
  async inspectExistingEnv(envPath: string): Promise<{ success: boolean; message: string; info?: InspectedEnv }> {
    const candidates = getPythonExecutableCandidatesForEnvRoot(envPath)
      .filter((candidate) => fs.existsSync(candidate));

    if (candidates.length === 0) {
      return { success: false, message: "No Python executable found in the selected directory" };
    }

    let lastFailure: { success: boolean; message: string; info?: InspectedEnv } | null = null;
    for (const pythonPath of candidates) {
      const inspection = await this.inspectExistingPython(pythonPath);
      if (inspection.success) {
        return inspection;
      }

      lastFailure = inspection;
    }

    return lastFailure ?? { success: false, message: "No supported Python executable found in the selected directory" };
  }

  /**
   * Inspect a Python executable without mutating it.
   */
  async inspectExistingPython(pythonPath: string): Promise<{ success: boolean; message: string; info?: InspectedEnv }> {
    if (!fs.existsSync(pythonPath)) {
      return { success: false, message: "Python executable not found at the selected path" };
    }

    const data = await inspectPythonPackages(pythonPath);
    if (!data) {
      return { success: false, message: "Python 3.11 or later is required (or the selected file is not a valid Python executable)" };
    }

    const info = this.buildInspectedEnv(pythonPath, data);
    const message = info.hasCorePackages
      ? `Python ${info.pythonVersion} is ready to use`
      : `Python ${info.pythonVersion} is missing ${info.missingCorePackages.length} core package${info.missingCorePackages.length === 1 ? "" : "s"}`;

    return { success: true, message, info };
  }

  /**
   * Persist an inspected Python environment and optionally install its missing
   * backend-core packages before switching.
   */
  async applyExistingEnv(
    envPath: string,
    options?: ApplyExistingPythonOptions,
  ): Promise<{ success: boolean; message: string; info?: InspectedEnv }> {
    const inspection = await this.inspectExistingEnv(envPath);
    if (!inspection.success || !inspection.info) {
      return inspection;
    }
    return this.applyExistingPython(inspection.info.pythonPath, options);
  }

  /**
   * Persist a Python executable as the configured runtime. Missing core
   * packages are only installed when explicitly requested.
   */
  async applyExistingPython(
    pythonPath: string,
    options?: ApplyExistingPythonOptions,
  ): Promise<{ success: boolean; message: string; info?: InspectedEnv }> {
    const inspection = await this.inspectExistingPython(pythonPath);
    if (!inspection.success || !inspection.info) {
      return inspection;
    }

    let info = inspection.info;
    const shouldInstallCorePackages = options?.installCorePackages === true;

    if (!info.hasCorePackages && !shouldInstallCorePackages) {
      return {
        success: false,
        message: `Python ${info.pythonVersion} is missing required backend packages (${info.missingCorePackages.join(", ")}). Choose an explicit install action before switching.`,
        info,
      };
    }

    if (!info.hasCorePackages && shouldInstallCorePackages) {
      if (!(await probeNetworkOnline())) {
        return {
          success: false,
          message: `Python ${info.pythonVersion} is missing required backend packages and the app is offline. Connect to the internet once to install ${info.missingCorePackages.join(", ")} or install them manually and retry.`,
          info,
        };
      }

      try {
        await installCorePackages(pythonPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          message: `Python ${info.pythonVersion} found but failed to install required packages: ${message}`,
          info,
        };
      }

      const refreshedInspection = await this.inspectExistingPython(pythonPath);
      if (!refreshedInspection.success || !refreshedInspection.info) {
        return {
          success: false,
          message: "Core packages were installed but the environment could not be revalidated.",
        };
      }

      info = refreshedInspection.info;
      if (!info.hasCorePackages) {
        return {
          success: false,
          message: `Core backend packages are still missing after installation: ${info.missingCorePackages.join(", ")}`,
          info,
        };
      }
    }

    this.pythonPath = pythonPath;
    this.saveSettings();
    this.status = "ready";
    this.lastError = null;

    const action = shouldInstallCorePackages ? "Installed core packages and switched" : "Using";
    return {
      success: true,
      message: `${action} Python ${info.pythonVersion} from ${pythonPath}`,
      info,
    };
  }

  /**
   * Configure an existing Python environment without mutating it.
   */
  async useExistingEnv(envPath: string): Promise<{ success: boolean; message: string; info?: DetectedEnv }> {
    const result = await this.applyExistingEnv(envPath, { installCorePackages: false });
    return { success: result.success, message: result.message, info: result.info };
  }

  /**
   * Configure using a direct path to a Python executable.
   * More reliable than folder-based detection — no guessing about directory structure.
   */
  async useExistingPython(pythonPath: string): Promise<{ success: boolean; message: string; info?: DetectedEnv }> {
    const result = await this.applyExistingPython(pythonPath, { installCorePackages: false });
    return { success: result.success, message: result.message, info: result.info };
  }

  /**
   * Narrow EnvManager state view passed to the provisioning flow so it can
   * drive status transitions and persist the resolved interpreter without
   * owning the rest of the coordinator's state.
   */
  private provisioningContext(): ProvisioningContext {
    return {
      envDir: this.envDir,
      setStatus: (status) => { this.status = status; },
      setLastError: (error) => { this.lastError = error; },
      setPythonPath: (pythonPath) => { this.pythonPath = pythonPath; },
      saveSettings: () => this.saveSettings(),
    };
  }

  /**
   * Full setup: download Python, create venv, install packages.
   * Reports progress via callback.
   * @param progress - Optional progress callback
   * @param targetDir - Optional custom directory. If provided, the env is created there
   *   instead of the default userData location. The venv python is then saved as
   *   pythonPath so getPythonPath() finds it.
   */
  async setup(progress?: ProgressCallback, targetDir?: string): Promise<void> {
    return provisionManagedRuntime(this.provisioningContext(), progress, targetDir);
  }
}
