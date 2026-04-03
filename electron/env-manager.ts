/**
 * Runtime Python environment manager for Electron.
 *
 * Downloads python-build-standalone and creates a venv on first launch,
 * so the installer stays lightweight (~15MB instead of 350MB).
 * The Python env is stored in the user's app data directory.
 */

import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";

/* eslint-disable @typescript-eslint/no-require-imports */
type AppLike = Pick<Electron.App, "getPath" | "getVersion">;
const electronModule = require("electron") as typeof import("electron") | string;
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

// --- Constants (shared with scripts/setup-python-env.cjs) ---
const PYTHON_VERSION = "3.11.13";
const PBS_TAG = "20250828";
const PBS_BASE_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}`;

const PLATFORM_MAP: Record<string, string> = {
  "win32-x64": `cpython-${PYTHON_VERSION}+${PBS_TAG}-x86_64-pc-windows-msvc-install_only.tar.gz`,
  "linux-x64": `cpython-${PYTHON_VERSION}+${PBS_TAG}-x86_64-unknown-linux-gnu-install_only.tar.gz`,
  "darwin-x64": `cpython-${PYTHON_VERSION}+${PBS_TAG}-x86_64-apple-darwin-install_only.tar.gz`,
  "darwin-arm64": `cpython-${PYTHON_VERSION}+${PBS_TAG}-aarch64-apple-darwin-install_only.tar.gz`,
};

// Core packages to install (minimal set to run the backend)
const CORE_PACKAGES = [
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.34.0",
  "pydantic>=2.10.0",
  "python-multipart>=0.0.20",
  "httpx>=0.27.0",
  "pyyaml>=6.0",
  "packaging>=24.0",
  "platformdirs>=4.0.0",
  "sentry-sdk[fastapi]>=2.0.0",
  "nirs4all>=0.8.6",
];

const isWindows = process.platform === "win32";
const ENSUREPIP_TIMEOUT_MS = 60_000;
const PIP_INSTALL_TIMEOUT_MS = 180_000;
const COMPILEALL_TIMEOUT_MS = 180_000;

export type EnvStatus = "none" | "downloading" | "extracting" | "creating_venv" | "installing" | "ready" | "error";

export type ProgressCallback = (percent: number, step: string, detail: string) => void;

export interface DetectedEnv {
  path: string;
  pythonVersion: string;
  hasNirs4all: boolean;
}

export interface EnvInfo {
  status: EnvStatus;
  envDir: string;
  pythonPath: string | null;
  sitePackages: string | null;
  pythonVersion: string | null;
  isCustom: boolean;
  error?: string;
}

const SETTINGS_FILE = "env-settings.json";

interface EnvSettings {
  pythonPath?: string;
  /** App version when the setup wizard was last completed */
  appVersion?: string;
  /** "Don't ask again" flag — skips wizard on subsequent launches (portable mode) */
  skipWizardOnLaunch?: boolean;
}

export interface EnvSummary {
  pythonPath: string;
  envPath: string;
  version: string;
}

interface EnsureBackendPackagesOptions {
  timeoutMs?: number;
}

interface CommandOptions {
  retries?: number;
  /** Base delay (ms) for exponential backoff between retries. Default 2000. */
  retryBaseMs?: number;
  timeoutMs?: number;
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
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = JSON.parse(fs.readFileSync(this.settingsPath, "utf-8")) as Record<string, unknown>;
        this.savedAppVersion = (data.appVersion as string) ?? null;
        this.savedSkipWizard = (data.skipWizardOnLaunch as boolean) ?? false;

        // Migration: convert legacy customPythonPath / customEnvPath to pythonPath
        if (data.pythonPath) {
          this.pythonPath = data.pythonPath as string;
        } else if (data.customPythonPath) {
          this.pythonPath = data.customPythonPath as string;
          this.saveSettings();
        } else if (data.customEnvPath) {
          const envPath = data.customEnvPath as string;
          const candidates = isWindows
            ? [path.join(envPath, "Scripts", "python.exe"), path.join(envPath, "python.exe")]
            : [path.join(envPath, "bin", "python"), path.join(envPath, "bin", "python3")];
          for (const c of candidates) {
            if (fs.existsSync(c)) { this.pythonPath = c; break; }
          }
          this.saveSettings();
        }
      }
    } catch (error) {
      console.warn(`[EnvManager] Failed to load settings: ${error}`);
    }
  }

  private saveSettings(): void {
    try {
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: EnvSettings = {};
      if (this.pythonPath) data.pythonPath = this.pythonPath;
      if (this.savedAppVersion) data.appVersion = this.savedAppVersion;
      if (this.savedSkipWizard) data.skipWizardOnLaunch = this.savedSkipWizard;
      fs.writeFileSync(this.settingsPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`[EnvManager] Failed to save settings: ${error}`);
    }
  }

  /** Get the environment directory */
  getEnvDir(): string {
    return this.envDir;
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

  /** Get the Python executable path */
  getPythonPath(): string | null {
    // Custom python path (user-selected or custom-dir setup)
    if (this.pythonPath) {
      if (fs.existsSync(this.pythonPath)) return this.pythonPath;
      return null;
    }

    // Managed env: use the venv's Python directly.
    // Since the venv is created on the user's machine (not bundled from build),
    // pyvenv.cfg has correct paths and sys.prefix resolves to the venv.
    // This ensures VenvManager's pip_executable and package installs work correctly.
    const venvDir = path.join(this.envDir, "venv");
    return isWindows
      ? path.join(venvDir, "Scripts", "python.exe")
      : path.join(venvDir, "bin", "python");
  }

  /** Get the site-packages path */
  getSitePackages(): string | null {
    // Custom python path: derive env root from executable location
    if (this.pythonPath) {
      const dir = path.dirname(this.pythonPath);
      const dirName = path.basename(dir).toLowerCase();
      const envRoot = (dirName === "scripts" || dirName === "bin") ? path.dirname(dir) : dir;

      if (isWindows) {
        const p = path.join(envRoot, "Lib", "site-packages");
        if (fs.existsSync(p)) return p;
      } else {
        const libDir = path.join(envRoot, "lib");
        if (fs.existsSync(libDir)) {
          const pyDir = fs.readdirSync(libDir).find((e) => e.startsWith("python3."));
          if (pyDir) return path.join(libDir, pyDir, "site-packages");
        }
      }
      return null;
    }

    // Managed env
    const venvDir = path.join(this.envDir, "venv");
    if (isWindows) {
      return path.join(venvDir, "Lib", "site-packages");
    }
    const libDir = path.join(venvDir, "lib");
    if (fs.existsSync(libDir)) {
      try {
        const pyDir = fs.readdirSync(libDir).find((e) => e.startsWith("python3."));
        if (pyDir) return path.join(libDir, pyDir, "site-packages");
      } catch { /* ignore */ }
    }
    return path.join(venvDir, "lib", `python${PYTHON_VERSION.slice(0, 4)}`, "site-packages");
  }

  /** Get full environment info */
  async getInfo(): Promise<EnvInfo> {
    const pythonPath = this.getPythonPath();
    let pythonVersion: string | null = null;
    if (pythonPath && fs.existsSync(pythonPath)) {
      const detected = await this.checkPython(pythonPath);
      if (detected) pythonVersion = detected.pythonVersion;
    }
    return {
      status: this.status,
      envDir: this.envDir,
      pythonPath,
      sitePackages: this.getSitePackages(),
      pythonVersion,
      isCustom: !!this.pythonPath,
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
   * - Shows when the environment is not ready (first launch, broken env).
   * - Portable version: shows every launch unless "don't ask again" was checked.
   * - Version changes are handled silently when the env is already functional
   *   (ensureBackendPackages covers package updates at startup).
   */
  shouldShowWizard(): boolean {
    this.validateConfiguredState();

    // Startup validation failed (for example a timed-out repair on a stale env)
    // — route the user back through the setup flow instead of leaving them on
    // the backend-connecting screen forever.
    if (this.status === "error") return true;

    // Env not configured at all → must show wizard
    if (!this.isReady()) return true;

    // Portable mode: show every time unless user opted out
    if (this.isPortable() && !this.savedSkipWizard) return true;

    // Env is ready — silently stamp current version so portable opt-out stays valid
    const currentVersion = app.getVersion();
    if (this.savedAppVersion !== currentVersion) {
      this.savedAppVersion = currentVersion;
      this.saveSettings();
    }

    return false;
  }

  /**
   * Validate that a portable build's environment paths are still reachable.
   *
   * Portable builds store absolute paths in env-settings.json.  If the user
   * moves the .exe to a new folder, those paths break.  This method checks
   * whether the configured Python executable still exists, and if not, clears
   * the settings so the setup wizard re-runs.
   *
   * Call once at startup, before {@link isReady} / {@link shouldShowWizard}.
   * Only runs in portable mode ({@link isPortable}).
   *
   * @returns `true` if state is valid (or non-portable), `false` if settings were cleared.
   */
  validatePortableState(): boolean {
    return this.validateConfiguredState();
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
    const pythonPath = this.getPythonPath();
    if (!pythonPath || !fs.existsSync(pythonPath)) return null;

    const info = await this.checkPython(pythonPath);
    if (!info) return null;

    return {
      pythonPath,
      envPath: info.path,
      version: info.pythonVersion,
    };
  }

  /**
   * Verify that critical backend packages (uvicorn, fastapi) are importable.
   * Returns true if all packages are available, false otherwise.
   */
  async verifyBackendPackages(): Promise<boolean> {
    const pythonPath = this.getPythonPath();
    if (!pythonPath || !fs.existsSync(pythonPath)) return false;

    return new Promise((resolve) => {
      execFile(
        pythonPath,
        ["-c", "import uvicorn; import fastapi; import nirs4all"],
        { timeout: 15000 },
        (error) => resolve(!error),
      );
    });
  }

  /**
   * Ensure critical backend packages are installed.
   * If uvicorn/fastapi are missing, installs all CORE_PACKAGES.
   * Called before starting the backend to fix the portable-mode issue
   * where the env exists but is missing backend dependencies.
   */
  async ensureBackendPackages(options?: EnsureBackendPackagesOptions): Promise<void> {
    if (!this.validateConfiguredState()) {
      this.status = "error";
      this.lastError = "Python environment is not configured or is missing";
      throw new Error(this.lastError);
    }

    const pythonPath = this.getPythonPath();
    if (!pythonPath || !fs.existsSync(pythonPath)) {
      this.status = "error";
      this.lastError = "Python executable not found";
      throw new Error(this.lastError);
    }

    try {
      const hasPackages = await this.verifyBackendPackages();
      if (!hasPackages) {
        console.log("Backend packages missing, installing core packages...");
        await this.installCorePackages(pythonPath, {
          timeoutMs: options?.timeoutMs ?? PIP_INSTALL_TIMEOUT_MS,
        });
        console.log("Core packages installed successfully");
      }
      this.lastError = null;
      this.status = "ready";
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Detect existing Python environments on the system.
   */
  async detectExistingEnvs(): Promise<DetectedEnv[]> {
    const envs: DetectedEnv[] = [];
    const candidates: string[] = [];

    // Check PATH for python3 / python
    const pathDirs = (process.env.PATH || "").split(path.delimiter);
    for (const dir of pathDirs) {
      const names = isWindows ? ["python.exe"] : ["python3", "python"];
      for (const name of names) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) {
          candidates.push(p);
        }
      }
    }

    // Check common venv/conda locations
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (home) {
      const commonPaths = [
        path.join(home, ".venv"),
        path.join(home, "venv"),
        path.join(home, ".conda", "envs"),
        path.join(home, "miniconda3", "envs"),
        path.join(home, "anaconda3", "envs"),
      ];

      for (const p of commonPaths) {
        if (fs.existsSync(p)) {
          if (p.includes("envs") && fs.statSync(p).isDirectory()) {
            // Conda envs directory — check each subdirectory
            try {
              for (const env of fs.readdirSync(p)) {
                const envDir = path.join(p, env);
                const py = isWindows
                  ? path.join(envDir, "python.exe")
                  : path.join(envDir, "bin", "python");
                if (fs.existsSync(py)) candidates.push(py);
              }
            } catch { /* ignore */ }
          } else {
            const py = isWindows
              ? path.join(p, "Scripts", "python.exe")
              : path.join(p, "bin", "python");
            if (fs.existsSync(py)) candidates.push(py);
          }
        }
      }
    }

    // macOS: Check Homebrew Python locations (not always in PATH when
    // launched from Electron since shell profiles aren't sourced)
    if (process.platform === "darwin") {
      const brewPaths = [
        "/opt/homebrew/bin/python3",   // Apple Silicon Homebrew
        "/usr/local/bin/python3",       // Intel Homebrew
      ];
      for (const p of brewPaths) {
        if (fs.existsSync(p)) candidates.push(p);
      }
    }

    // Deduplicate by resolving paths
    const seen = new Set<string>();
    for (const candidate of candidates) {
      try {
        const resolved = fs.realpathSync(candidate);
        if (seen.has(resolved)) continue;
        seen.add(resolved);

        const info = await this.checkPython(candidate);
        if (info) envs.push(info);
      } catch {
        // Skip inaccessible paths
      }
    }

    return envs;
  }

  /** Check a Python executable and return info if it's 3.11+ */
  private async checkPython(pythonPath: string): Promise<DetectedEnv | null> {
    return new Promise((resolve) => {
      execFile(
        pythonPath,
        ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}'); import importlib; s=importlib.util.find_spec; print(all(s(m) is not None for m in ['nirs4all','uvicorn','fastapi']))"],
        { timeout: 5000 },
        (error, stdout) => {
          if (error) { resolve(null); return; }
          const lines = stdout.trim().split("\n");
          if (lines.length < 2) { resolve(null); return; }
          const version = lines[0].trim();
          const [major, minor] = version.split(".").map(Number);
          if (major < 3 || (major === 3 && minor < 11)) { resolve(null); return; }
          const hasNirs4all = lines[1].trim() === "True";
          // Determine the env root:
          // - Venvs: python is in Scripts/ (Windows) or bin/ (Unix) → go up 2 levels
          // - Base Python (Windows/conda): python.exe is in root → go up 1 level
          const dir = path.dirname(pythonPath);
          const dirName = path.basename(dir).toLowerCase();
          const envRoot = (dirName === "scripts" || dirName === "bin")
            ? path.dirname(dir)
            : dir;
          resolve({ path: envRoot, pythonVersion: version, hasNirs4all });
        },
      );
    });
  }

  /**
   * Configure an existing Python environment.
   * Validates it has Python 3.11+ and installs missing core packages.
   */
  async useExistingEnv(envPath: string): Promise<{ success: boolean; message: string; info?: DetectedEnv }> {
    // Find python executable
    const candidates = isWindows
      ? [path.join(envPath, "Scripts", "python.exe"), path.join(envPath, "python.exe")]
      : [path.join(envPath, "bin", "python"), path.join(envPath, "bin", "python3")];

    let pythonPath: string | null = null;
    for (const c of candidates) {
      if (fs.existsSync(c)) { pythonPath = c; break; }
    }
    if (!pythonPath) {
      return { success: false, message: "No Python executable found in the selected directory" };
    }

    const info = await this.checkPython(pythonPath);
    if (!info) {
      return { success: false, message: "Python 3.11 or later is required" };
    }

    // Save old value for rollback if install fails
    const prevPythonPath = this.pythonPath;

    this.pythonPath = pythonPath;

    // Install missing core packages (nirs4all, fastapi, etc.)
    if (!info.hasNirs4all) {
      try {
        await this.installCorePackages(pythonPath);
      } catch (e) {
        // Rollback — don't persist a broken env
        this.pythonPath = prevPythonPath;
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, message: `Python ${info.pythonVersion} found but failed to install required packages: ${msg}` };
      }
    }

    // Persist only after successful validation/install
    this.saveSettings();
    this.status = "ready";
    return { success: true, message: `Using Python ${info.pythonVersion} from ${envPath}`, info };
  }

  /**
   * Configure using a direct path to a Python executable.
   * More reliable than folder-based detection — no guessing about directory structure.
   */
  async useExistingPython(pythonPath: string): Promise<{ success: boolean; message: string; info?: DetectedEnv }> {
    if (!fs.existsSync(pythonPath)) {
      return { success: false, message: "Python executable not found at the selected path" };
    }

    const info = await this.checkPython(pythonPath);
    if (!info) {
      return { success: false, message: "Python 3.11 or later is required (or the selected file is not a valid Python executable)" };
    }

    // Save old value for rollback if install fails
    const prevPythonPath = this.pythonPath;

    this.pythonPath = pythonPath;

    // Install missing core packages (nirs4all, fastapi, etc.)
    if (!info.hasNirs4all) {
      try {
        await this.installCorePackages(pythonPath);
      } catch (e) {
        // Rollback — don't persist a broken env
        this.pythonPath = prevPythonPath;
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, message: `Python ${info.pythonVersion} found but failed to install required packages: ${msg}` };
      }
    }

    // Persist only after successful validation/install
    this.saveSettings();
    this.status = "ready";
    return { success: true, message: `Using Python ${info.pythonVersion} from ${pythonPath}`, info };
  }

  /**
   * Install core packages into a Python environment using `python -m pip`.
   * Used when user selects an existing Python that's missing nirs4all.
   */
  private async installCorePackages(
    pythonPath: string,
    options?: EnsureBackendPackagesOptions,
  ): Promise<void> {
    const timeoutMs = options?.timeoutMs ?? PIP_INSTALL_TIMEOUT_MS;

    // Ensure pip is available
    try {
      await this.runCommand(pythonPath, ["-m", "ensurepip", "--upgrade"], {
        retries: 1,
        timeoutMs: Math.min(timeoutMs, ENSUREPIP_TIMEOUT_MS),
      });
    } catch {
      // ensurepip may fail if pip is already installed — non-fatal
    }

    // Install all core packages in a single pip call
    await this.runCommand(pythonPath, ["-m", "pip", "install", "--no-cache-dir", ...CORE_PACKAGES], {
      retries: 2,
      timeoutMs,
    });
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
    const report = progress ?? (() => {});
    const baseDir = targetDir || this.envDir;

    try {
      this.status = "downloading";
      this.lastError = null;

      // 1. Resolve platform
      const platformKey = `${process.platform}-${process.arch}`;
      const tarballName = PLATFORM_MAP[platformKey];
      if (!tarballName) {
        throw new Error(`Unsupported platform: ${platformKey}`);
      }

      const downloadUrl = `${PBS_BASE_URL}/${tarballName}`;
      fs.mkdirSync(baseDir, { recursive: true });

      // 2. Download Python (if not already cached)
      const cachedTarball = path.join(baseDir, tarballName);
      if (fs.existsSync(cachedTarball) && fs.statSync(cachedTarball).size > 10 * 1024 * 1024) {
        report(15, "downloading", "Using cached Python runtime");
      } else {
        report(0, "downloading", "Downloading Python runtime...");
        await this.downloadFile(downloadUrl, cachedTarball, (percent) => {
          report(Math.round(percent * 0.15), "downloading", `Downloading Python runtime... ${percent}%`);
        });
      }

      // 3. Extract
      this.status = "extracting";
      report(15, "extracting", "Extracting Python runtime...");
      const pythonDir = path.join(baseDir, "python");
      if (fs.existsSync(pythonDir)) {
        fs.rmSync(pythonDir, { recursive: true, force: true });
      }

      await this.extractTarball(cachedTarball, baseDir);

      // Verify extraction — the tarball extracts a top-level `python/` directory
      const embeddedPython = isWindows
        ? path.join(pythonDir, "python.exe")
        : path.join(pythonDir, "bin", "python3");
      if (!fs.existsSync(embeddedPython)) {
        throw new Error(`Python executable not found after extraction at ${embeddedPython}`);
      }
      report(25, "extracting", "Python runtime extracted");

      // Remove macOS Gatekeeper quarantine attribute from downloaded Python
      await this.removeQuarantine(pythonDir);

      // Warm up: run a lightweight command so the OS / antivirus finishes
      // scanning the freshly extracted binary before we attempt heavier work.
      // On Windows, Defender can lock new executables for 10–30 s after extraction.
      await this.runCommand(embeddedPython, ["--version"], {
        retries: 5,
        retryBaseMs: 3000,
        timeoutMs: PIP_INSTALL_TIMEOUT_MS,
      });
      report(28, "extracting", "Python runtime verified");

      // 4. Create venv
      this.status = "creating_venv";
      report(25, "creating_venv", "Creating virtual environment...");
      const venvDir = path.join(baseDir, "venv");
      if (fs.existsSync(venvDir)) {
        fs.rmSync(venvDir, { recursive: true, force: true });
      }

      await this.runCommand(embeddedPython, ["-m", "venv", venvDir, "--without-pip"], {
        // The freshly extracted runtime can still be scanned or briefly locked
        // by the OS/AV layer right after extraction.
        retries: 3,
        timeoutMs: PIP_INSTALL_TIMEOUT_MS,
      });

      const venvPython = isWindows
        ? path.join(venvDir, "Scripts", "python.exe")
        : path.join(venvDir, "bin", "python");

      if (!fs.existsSync(venvPython)) {
        throw new Error("Venv creation failed: python executable not found");
      }

      report(35, "creating_venv", "Bootstrapping pip...");
      await this.runCommand(venvPython, ["-m", "ensurepip", "--upgrade"], {
        retries: 2,
        timeoutMs: ENSUREPIP_TIMEOUT_MS,
      });
      await this.runCommand(venvPython, ["-m", "pip", "install", "--no-cache-dir", "--upgrade", "pip"], {
        retries: 2,
        timeoutMs: PIP_INSTALL_TIMEOUT_MS,
      });
      report(40, "creating_venv", "Virtual environment ready");

      // 5. Install core packages
      // On Windows, antivirus (Defender) may still be scanning venv files. Retries
      // with exponential backoff give it time to release file locks.
      this.status = "installing";
      report(40, "installing", "Installing core packages...");

      const totalPackages = CORE_PACKAGES.length;
      for (let i = 0; i < totalPackages; i++) {
        const pkg = CORE_PACKAGES[i];
        const pkgName = pkg.split(">=")[0].split("[")[0];
        const progressPercent = 40 + Math.round(((i + 1) / totalPackages) * 50);
        report(progressPercent, "installing", `Installing ${pkgName}...`);
        await this.runCommand(venvPython, ["-m", "pip", "install", "--no-cache-dir", pkg], {
          retries: 2,
          timeoutMs: PIP_INSTALL_TIMEOUT_MS,
        });
      }

      report(90, "installing", "All packages installed");

      // 6. Pre-compile bytecode
      report(92, "installing", "Optimizing startup time...");
      const compileTargets = [
        isWindows ? path.join(venvDir, "Lib") : path.join(venvDir, "lib"),
      ].filter((p) => fs.existsSync(p));

      // Also compile nirs4all source directory (dev/portable builds)
      const backendDir = path.join(process.resourcesPath, "backend");
      const nirs4allSrcDir = path.join(backendDir, "..", "..", "nirs4all", "nirs4all");
      if (fs.existsSync(nirs4allSrcDir)) {
        compileTargets.push(nirs4allSrcDir);
      }
      // Compile backend API source
      if (fs.existsSync(path.join(backendDir, "api"))) {
        compileTargets.push(backendDir);
      }

      if (compileTargets.length > 0) {
        try {
          await this.runCommand(venvPython, ["-m", "compileall", "-q", "-j", "0", ...compileTargets], {
            timeoutMs: COMPILEALL_TIMEOUT_MS,
          });
        } catch {
          // Non-fatal: bytecode compilation failure doesn't prevent running
        }
      }

      // 7. Write build metadata
      const buildInfo = {
        mode: "runtime-setup",
        python_version: PYTHON_VERSION,
        pbs_tag: PBS_TAG,
        platform: `${process.platform}-${process.arch}`,
        created_at: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(baseDir, "build_info.json"), JSON.stringify(buildInfo, null, 2));

      // Clean up the downloaded archive only after the bootstrap has completed.
      // If setup fails earlier, keeping the tarball avoids forcing another full
      // download on the next retry.
      try { fs.unlinkSync(cachedTarball); } catch { /* ignore */ }

      // 8. If custom directory, save it so getPythonPath() finds the new env.
      //    Otherwise clear custom paths so getPythonPath() falls through to the managed env.
      if (targetDir) {
        this.pythonPath = venvPython;
      } else {
        this.pythonPath = null;
      }
      this.saveSettings();

      this.status = "ready";
      report(100, "ready", "Python environment is ready");
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Remove macOS Gatekeeper quarantine attribute from downloaded Python.
   * python-build-standalone binaries downloaded from GitHub are marked with
   * com.apple.quarantine which can block execution. Non-fatal if removal fails.
   */
  private removeQuarantine(dirPath: string): Promise<void> {
    if (process.platform !== "darwin") return Promise.resolve();
    return new Promise((resolve) => {
      execFile("xattr", ["-dr", "com.apple.quarantine", dirPath], (error) => {
        if (error) {
          console.warn(`[EnvManager] Could not remove quarantine attribute: ${error.message}`);
        } else {
          console.log(`[EnvManager] Removed quarantine attribute from ${dirPath}`);
        }
        resolve();
      });
    });
  }

  /** Download a file with redirect support and progress reporting */
  private downloadFile(url: string, destPath: string, onProgress?: (percent: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const makeRequest = (requestUrl: string) => {
        const protocol = requestUrl.startsWith("https") ? https : http;
        protocol.get(requestUrl, (response) => {
          // Follow redirects (GitHub returns 302)
          if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            return makeRequest(response.headers.location);
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Download failed with status ${response.statusCode}`));
            return;
          }

          const totalBytes = parseInt(response.headers["content-length"] || "0", 10);
          let receivedBytes = 0;
          let lastReportedPercent = -1;

          const file = fs.createWriteStream(destPath);
          response.pipe(file);

          response.on("data", (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (totalBytes > 0 && onProgress) {
              const percent = Math.floor((receivedBytes / totalBytes) * 100);
              if (percent > lastReportedPercent) {
                lastReportedPercent = percent;
                onProgress(percent);
              }
            }
          });

          file.on("finish", () => {
            file.close();
            resolve();
          });

          file.on("error", (err) => {
            try { fs.unlinkSync(destPath); } catch { /* ignore */ }
            reject(err);
          });
        }).on("error", reject);
      };

      makeRequest(url);
    });
  }

  /** Extract a .tar.gz file */
  private async extractTarball(tarPath: string, destDir: string): Promise<void> {
    const archive = isWindows ? tarPath.replace(/\\/g, "/") : tarPath;
    const dest = isWindows ? destDir.replace(/\\/g, "/") : destDir;
    const args = ["-xzf", archive, "-C", dest];
    // GNU tar (from Git) interprets drive letters as remote hosts and needs --force-local.
    // Windows built-in bsdtar doesn't support --force-local but handles paths natively.
    if (isWindows && await this.isGnuTar()) args.push("--force-local");

    return this.runCommand("tar", args, {
      retries: 1,
    });
  }

  /** Check if the system tar is GNU tar (vs Windows built-in bsdtar) */
  private isGnuTar(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile("tar", ["--version"], { windowsHide: isWindows }, (err, stdout) => {
        resolve(!err && stdout.includes("GNU tar"));
      });
    });
  }

  /** Run a command and wait for it to complete */
  private runCommand(command: string, args: string[], options?: CommandOptions): Promise<void> {
    const maxRetries = options?.retries ?? 0;
    const timeoutMs = options?.timeoutMs ?? 0;
    const commandLabel = `${command} ${args.join(" ")}`.trim();

    const exec = (): Promise<void> => new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        windowsHide: isWindows,
      });

      let stderr = "";
      let finished = false;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const complete = (error?: Error) => {
        if (finished) return;
        finished = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (error) reject(error);
        else resolve();
      };

      proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          const timeoutError = new Error(
            `Command "${commandLabel}" timed out after ${Math.round(timeoutMs / 1000)}s`,
          );
          if (isWindows && proc.pid) {
            spawn("taskkill", ["/pid", proc.pid.toString(), "/t", "/f"]);
          } else {
            proc.kill("SIGKILL");
          }
          complete(timeoutError);
        }, timeoutMs);
      }

      proc.on("close", (code) => {
        if (finished) return;
        if (code === 0) complete();
        else complete(new Error(`Command "${commandLabel}" failed (code ${code}): ${stderr.slice(0, 500)}`));
      });

      proc.on("error", (error) => {
        const message = error instanceof Error ? error.message : String(error);
        const wrapped = new Error(`Failed to start command "${commandLabel}": ${message}`);
        if (error && typeof error === "object" && "code" in error) {
          Object.assign(wrapped, { code: (error as NodeJS.ErrnoException).code });
        }
        complete(wrapped);
      });
    });

    if (maxRetries <= 0) return exec();

    return (async () => {
      let lastError: Error | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            // Exponential backoff — gives antivirus time to release file locks.
            // Default base 2 s (2, 4, 8 s).  Callers can raise the base for
            // operations where AV scanning is expected to take longer.
            const baseMs = options?.retryBaseMs ?? 2000;
            await new Promise((r) => setTimeout(r, baseMs * Math.pow(2, attempt - 1)));
          }
          await exec();
          return;
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
          if (attempt < maxRetries) {
            console.warn(`[EnvManager] Command "${commandLabel}" failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying: ${lastError.message}`);
          }
        }
      }
      // Annotate EPERM errors with a likely cause on Windows
      if (isWindows && lastError && "code" in lastError && (lastError as NodeJS.ErrnoException).code === "EPERM") {
        lastError.message += " — this is usually caused by antivirus software blocking newly extracted files. "
          + "Try temporarily adding the install directory to your antivirus exclusions and retrying.";
      }
      throw lastError;
    })();
  }
}
