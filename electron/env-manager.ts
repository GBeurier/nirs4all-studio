/**
 * Runtime Python environment manager for Electron.
 *
 * Downloads python-build-standalone and creates a venv on first launch,
 * so the installer stays lightweight (~15MB instead of 350MB).
 * The Python env is stored in the user's app data directory.
 */

import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";

/* eslint-disable @typescript-eslint/no-require-imports */
interface PythonRuntimeConfigModule {
  MANAGED_RUNTIME_PACKAGES: readonly string[];
  PBS_TAG: string;
  PYTHON_VERSION: string;
  PYTHON_VERSION_MM: string;
  getArchiveFilename(platform: string, arch: string): string;
  getDownloadUrl(platform: string, arch: string): string;
}

type AppLike = Pick<Electron.App, "getPath" | "getVersion">;
const electronModule = require("electron") as typeof import("electron") | string;
const pythonRuntimeConfig = require("../scripts/python-runtime-config.cjs") as PythonRuntimeConfigModule;
const recommendedConfig = require("../recommended-config.json") as RecommendedConfigFile;
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

const { MANAGED_RUNTIME_PACKAGES, PBS_TAG, PYTHON_VERSION, PYTHON_VERSION_MM, getArchiveFilename, getDownloadUrl } = pythonRuntimeConfig;

const isWindows = process.platform === "win32";
const ENSUREPIP_TIMEOUT_MS = 60_000;
const PIP_INSTALL_TIMEOUT_MS = 180_000;
const COMPILEALL_TIMEOUT_MS = 180_000;

// --- Network probe (shared with backend network_state.py) ---
// Multiple URLs raced in parallel — first response wins. Diversified providers
// so a single blocked host (corporate proxy, GeoDNS) does not flip offline.
const NETWORK_PROBE_URLS = [
  "https://www.cloudflare.com",
  "https://pypi.org",
  "https://api.github.com",
  "https://www.google.com",
];
const NETWORK_PROBE_TIMEOUT_MS = 4_000;
const NETWORK_PROBE_TTL_MS = 60_000;

let networkProbeCache: { at: number; online: boolean } | null = null;
let networkProbeInFlight: Promise<boolean> | null = null;

function isOfflineForced(): boolean {
  const v = (process.env.NIRS4ALL_OFFLINE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function probeOne(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(result);
    };
    const t = setTimeout(() => done(false), timeoutMs + 250);
    try {
      const req = https.request(
        url,
        { method: "HEAD", timeout: timeoutMs },
        (res) => {
          // Any HTTP response (incl. 4xx redirect) means we reached the server.
          done((res.statusCode ?? 0) < 600);
          res.resume();
        },
      );
      req.on("error", () => done(false));
      req.on("timeout", () => { req.destroy(); done(false); });
      req.end();
    } catch {
      done(false);
    }
  });
}

/**
 * Probe network reachability. Races multiple URLs and caches the result
 * for 60 s. Returns `false` whenever `NIRS4ALL_OFFLINE` is set, without
 * attempting any outbound connection. Never throws. Concurrent callers
 * share the same in-flight probe.
 */
export async function probeNetworkOnline(): Promise<boolean> {
  if (isOfflineForced()) return false;
  const now = Date.now();
  if (networkProbeCache && now - networkProbeCache.at < NETWORK_PROBE_TTL_MS) {
    return networkProbeCache.online;
  }
  if (networkProbeInFlight) return networkProbeInFlight;

  networkProbeInFlight = (async () => {
    try {
      const online = await new Promise<boolean>((resolve) => {
        let resolved = false;
        const finish = (v: boolean) => {
          if (resolved) return;
          resolved = true;
          resolve(v);
        };
        let pending = NETWORK_PROBE_URLS.length;
        for (const url of NETWORK_PROBE_URLS) {
          probeOne(url, NETWORK_PROBE_TIMEOUT_MS).then((ok) => {
            if (ok) finish(true);
            pending -= 1;
            if (pending === 0) finish(false);
          });
        }
      });
      networkProbeCache = { at: Date.now(), online };
      console.log(`[EnvManager] Network probe: ${online ? "ONLINE" : "OFFLINE"}`);
      return online;
    } finally {
      networkProbeInFlight = null;
    }
  })();

  return networkProbeInFlight;
}

export type EnvStatus = "none" | "downloading" | "extracting" | "creating_venv" | "installing" | "ready" | "error";

export type ProgressCallback = (percent: number, step: string, detail: string) => void;

type EnvKind = "system" | "venv" | "conda" | "managed" | "bundled";

interface RecommendedPackageSpec {
  min?: string;
  recommended?: string | null;
}

interface RecommendedProfileConfig {
  label?: string;
  platforms?: string[];
  packages?: Record<string, RecommendedPackageSpec | string>;
}

interface RecommendedOptionalConfig {
  min?: string;
  recommended?: string | null;
  description?: string;
  category?: string;
}

interface RecommendedConfigFile {
  profiles?: Record<string, RecommendedProfileConfig>;
  optional?: Record<string, RecommendedOptionalConfig>;
}

export interface ProfileAlignmentGuess {
  id: string;
  label: string;
  missingCount: number;
}

export interface DetectedEnv {
  path: string;
  pythonPath: string;
  pythonVersion: string;
  hasNirs4all: boolean;
  hasCorePackages: boolean;
  envKind: EnvKind;
  writable: boolean;
}

export interface InspectedEnv extends DetectedEnv {
  missingCorePackages: string[];
  missingOptionalPackages: string[];
  profileAlignmentGuess: ProfileAlignmentGuess | null;
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

interface BundledRuntimeInfo {
  runtimeDir: string;
  pythonPath: string;
  sitePackages: string;
}

export type EnvRuntimeMode = "bundled" | "managed" | "custom" | "none";

const SETTINGS_FILE = "env-settings.json";
const VERIFY_CACHE_FILE = "verify-cache.json";

// Short-TTL in-memory cache for detectExistingEnvs(). Scanning PATH and
// spawning Python for every candidate is expensive, and the Settings UI can
// trigger it multiple times in quick succession. This cache is intentionally
// module-scope and non-persistent — the separate on-disk verify cache above
// (verify-cache.json) covers ensureBackendPackages() and must not be
// co-mingled with this transient cache.
const DETECT_ENVS_TTL_MS = 30_000;
let detectEnvsCache: { key: string; expiresAt: number; result: DetectedEnv[] } | null = null;
const WINDOWS_LAUNCHER_TIMEOUT_MS = 5_000;
const CONDA_DISCOVERY_TIMEOUT_MS = 12_000;
const PROJECT_ENV_DIR_NAMES = [".venv", "venv", ".env", "env"];
const NEARBY_PROJECT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-electron",
  "build",
  "coverage",
  "__pycache__",
]);

interface VerifyCacheEntry {
  pythonPath: string;
  appVersion: string;
  fingerprint: string;
  verifiedAt: number;
}

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

interface ApplyExistingPythonOptions {
  installCorePackages?: boolean;
}

interface InspectPythonData {
  version: string;
  installedPackages: Map<string, string>;
}

function normalizePackageName(name: string): string {
  return name.replace(/[-_.]+/g, "_").toLowerCase();
}

function getSupportedProfiles(config: RecommendedConfigFile): Array<[string, RecommendedProfileConfig]> {
  return Object.entries(config.profiles ?? {}).filter(([, profile]) => {
    const platforms = profile.platforms ?? [];
    return platforms.length === 0 || platforms.includes(process.platform);
  });
}

function normalizeDetectedPath(candidate: string): string {
  const normalized = path.normalize(candidate);
  return isWindows ? normalized.toLowerCase() : normalized;
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
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (!resourcesPath) return null;

    const runtimeDir = path.join(resourcesPath, "backend", "python-runtime");
    const readyMarker = path.join(runtimeDir, "RUNTIME_READY.json");
    if (!fs.existsSync(readyMarker)) {
      return null;
    }

    const bundledCandidates: Array<{ envRoot: string; pythonPath: string }> = isWindows
      ? [
          {
            envRoot: path.join(runtimeDir, "python"),
            pythonPath: path.join(runtimeDir, "python", "python.exe"),
          },
          {
            envRoot: path.join(runtimeDir, "venv"),
            pythonPath: path.join(runtimeDir, "venv", "Scripts", "python.exe"),
          },
        ]
      : [
          {
            envRoot: path.join(runtimeDir, "python"),
            pythonPath: path.join(runtimeDir, "python", "bin", "python3"),
          },
          {
            envRoot: path.join(runtimeDir, "python"),
            pythonPath: path.join(runtimeDir, "python", "bin", "python"),
          },
          {
            envRoot: path.join(runtimeDir, "venv"),
            pythonPath: path.join(runtimeDir, "venv", "bin", "python"),
          },
        ];

    for (const candidate of bundledCandidates) {
      const sitePackages = this.resolveSitePackages(candidate.envRoot, true);
      if (!fs.existsSync(candidate.pythonPath) || !sitePackages || !fs.existsSync(sitePackages)) {
        continue;
      }

      return {
        runtimeDir,
        pythonPath: candidate.pythonPath,
        sitePackages,
      };
    }

    return null;
  }

  isBundled(): boolean {
    return this.detectBundledRuntime() !== null;
  }

  private getManagedPythonPath(): string {
    const venvDir = path.join(this.envDir, "venv");
    return isWindows
      ? path.join(venvDir, "Scripts", "python.exe")
      : path.join(venvDir, "bin", "python");
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

    const bundledRuntime = this.detectBundledRuntime();
    if (bundledRuntime) {
      return bundledRuntime.pythonPath;
    }

    const managedPython = this.getManagedPythonPath();
    return fs.existsSync(managedPython) ? managedPython : null;
  }

  /** Get the configured runtime mode from Electron state. */
  getConfiguredRuntimeMode(): EnvRuntimeMode {
    if (this.pythonPath && fs.existsSync(this.pythonPath)) return "custom";
    if (this.isBundled()) return "bundled";
    return fs.existsSync(this.getManagedPythonPath()) ? "managed" : "none";
  }

  /**
   * Resolve the Python executable Electron intends to target for backend
   * verification / repair work. Falls back to the runtime launch path when no
   * configured interpreter has been persisted yet.
   */
  private getBackendTargetPythonPath(): string | null {
    return this.getConfiguredPythonPath() ?? this.getPythonPath();
  }

  getRuntimeMode(): EnvRuntimeMode {
    if (this.isBundled()) return "bundled";
    if (this.pythonPath && fs.existsSync(this.pythonPath)) return "custom";

    const managedPython = this.getManagedPythonPath();

    if (fs.existsSync(managedPython)) return "managed";
    return "none";
  }

  /** Get the Python executable path */
  getPythonPath(): string | null {
    const bundledRuntime = this.detectBundledRuntime();
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
    return this.getManagedPythonPath();
  }

  private resolveSitePackages(envRoot: string, requireExisting: boolean = false): string | null {
    const fallback = isWindows
      ? path.join(envRoot, "Lib", "site-packages")
      : path.join(envRoot, "lib", `python${PYTHON_VERSION_MM}`, "site-packages");

    if (isWindows) {
      return !requireExisting || fs.existsSync(fallback) ? fallback : null;
    }

    const libDir = path.join(envRoot, "lib");
    if (fs.existsSync(libDir)) {
      try {
        const pyDir = fs.readdirSync(libDir).find((e) => e.startsWith("python3."));
        if (pyDir) {
          const detected = path.join(libDir, pyDir, "site-packages");
          if (!requireExisting || fs.existsSync(detected)) return detected;
        }
      } catch { /* ignore */ }
    }

    return !requireExisting || fs.existsSync(fallback) ? fallback : null;
  }

  /** Get the site-packages path */
  getSitePackages(): string | null {
    const bundledRuntime = this.detectBundledRuntime();
    if (bundledRuntime) {
      return bundledRuntime.sitePackages;
    }

    // Custom python path: derive env root from executable location
    if (this.pythonPath) {
      const dir = path.dirname(this.pythonPath);
      const dirName = path.basename(dir).toLowerCase();
      const envRoot = (dirName === "scripts" || dirName === "bin") ? path.dirname(dir) : dir;
      return this.resolveSitePackages(envRoot, true);
    }

    // Managed env
    const venvDir = path.join(this.envDir, "venv");
    return this.resolveSitePackages(venvDir);
  }

  private getSitePackagesForPythonPath(pythonPath: string | null): string | null {
    if (!pythonPath) return null;
    const dir = path.dirname(pythonPath);
    const dirName = path.basename(dir).toLowerCase();
    const envRoot = (dirName === "scripts" || dirName === "bin") ? path.dirname(dir) : dir;
    return this.resolveSitePackages(envRoot, true);
  }

  private getEnvRootForPythonPath(pythonPath: string): string {
    const dir = path.dirname(pythonPath);
    const dirName = path.basename(dir).toLowerCase();
    return (dirName === "scripts" || dirName === "bin") ? path.dirname(dir) : dir;
  }

  private getPythonExecutableCandidatesForEnvRoot(envRoot: string): string[] {
    return isWindows
      ? [path.join(envRoot, "Scripts", "python.exe"), path.join(envRoot, "python.exe")]
      : [path.join(envRoot, "bin", "python3"), path.join(envRoot, "bin", "python")];
  }

  private addPythonCandidate(candidateMap: Map<string, string>, pythonPath: string | null | undefined): void {
    if (!pythonPath || !fs.existsSync(pythonPath)) {
      return;
    }

    try {
      const resolvedPath = fs.realpathSync(pythonPath);
      const key = normalizeDetectedPath(resolvedPath);
      if (!candidateMap.has(key)) {
        candidateMap.set(key, pythonPath);
      }
      return;
    } catch {
      const key = normalizeDetectedPath(pythonPath);
      if (!candidateMap.has(key)) {
        candidateMap.set(key, pythonPath);
      }
    }
  }

  private collectPythonCandidatesFromRoots(candidateMap: Map<string, string>, envRoots: Iterable<string>): void {
    for (const envRoot of envRoots) {
      if (!envRoot || !fs.existsSync(envRoot)) {
        continue;
      }

      for (const pythonPath of this.getPythonExecutableCandidatesForEnvRoot(envRoot)) {
        this.addPythonCandidate(candidateMap, pythonPath);
      }
    }
  }

  private listPathPythonCandidates(): string[] {
    const candidates: string[] = [];
    const names = isWindows ? ["python.exe"] : ["python3", "python"];
    const pathDirs = (process.env.PATH || "")
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const dir of pathDirs) {
      for (const name of names) {
        const candidate = path.join(dir, name);
        if (fs.existsSync(candidate)) {
          candidates.push(candidate);
        }
      }
    }

    return candidates;
  }

  private listCommonHomePythonCandidates(): string[] {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (!home) {
      return [];
    }

    const candidates = new Map<string, string>();
    const directEnvRoots = [
      path.join(home, ".venv"),
      path.join(home, "venv"),
    ];
    this.collectPythonCandidatesFromRoots(candidates, directEnvRoots);

    const condaEnvDirs = [
      path.join(home, ".conda", "envs"),
      path.join(home, "miniconda3", "envs"),
      path.join(home, "Miniconda3", "envs"),
      path.join(home, "anaconda3", "envs"),
      path.join(home, "Anaconda3", "envs"),
      path.join(home, "miniforge3", "envs"),
      path.join(home, "mambaforge", "envs"),
      path.join(home, "AppData", "Local", "miniconda3", "envs"),
      path.join(home, "AppData", "Local", "Miniconda3", "envs"),
      path.join(home, "AppData", "Local", "anaconda3", "envs"),
      path.join(home, "AppData", "Local", "Anaconda3", "envs"),
    ];

    for (const envDir of condaEnvDirs) {
      if (!fs.existsSync(envDir)) {
        continue;
      }

      try {
        const envRoots = fs.readdirSync(envDir)
          .map((entry) => path.join(envDir, entry))
          .filter((candidate) => {
            try {
              return fs.statSync(candidate).isDirectory();
            } catch {
              return false;
            }
          });
        this.collectPythonCandidatesFromRoots(candidates, envRoots);
      } catch {
        // Ignore unreadable env directories.
      }
    }

    return [...candidates.values()];
  }

  private getCondaCommandCandidates(): string[] {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const addCandidate = (candidate: string | null | undefined) => {
      if (!candidate) {
        return;
      }

      const isAbsolute = candidate.includes(path.sep) || candidate.includes("/");
      if (isAbsolute && !fs.existsSync(candidate)) {
        return;
      }

      const key = isAbsolute ? normalizeDetectedPath(candidate) : candidate;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      candidates.push(candidate);
    };

    addCandidate(process.env.CONDA_EXE);
    addCandidate("conda");

    const home = process.env.HOME || process.env.USERPROFILE || "";
    if (!home) {
      return candidates;
    }

    const installRoots = [
      path.join(home, "Anaconda3"),
      path.join(home, "anaconda3"),
      path.join(home, "Miniconda3"),
      path.join(home, "miniconda3"),
      path.join(home, "miniforge3"),
      path.join(home, "mambaforge"),
      path.join(home, "AppData", "Local", "Anaconda3"),
      path.join(home, "AppData", "Local", "anaconda3"),
      path.join(home, "AppData", "Local", "Miniconda3"),
      path.join(home, "AppData", "Local", "miniconda3"),
    ];

    for (const installRoot of installRoots) {
      addCandidate(isWindows
        ? path.join(installRoot, "Scripts", "conda.exe")
        : path.join(installRoot, "bin", "conda"));
    }

    return candidates;
  }

  private execFileText(
    command: string,
    args: string[],
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string } | null> {
    return new Promise((resolve) => {
      execFile(
        command,
        args,
        { timeout: timeoutMs, windowsHide: isWindows },
        (error, stdout, stderr) => {
          if (error) {
            resolve(null);
            return;
          }

          resolve({ stdout, stderr });
        },
      );
    });
  }

  private async listWindowsLauncherPythonCandidates(): Promise<string[]> {
    if (!isWindows) {
      return [];
    }

    const result = await this.execFileText("py", ["-0p"], WINDOWS_LAUNCHER_TIMEOUT_MS);
    if (!result) {
      return [];
    }

    return `${result.stdout}\n${result.stderr}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .map((line) => line.match(/^-V:\S+\s+(?:\*\s+)?(.+)$/)?.[1]?.trim() ?? null)
      .filter((candidate): candidate is string => Boolean(candidate));
  }

  private async listCondaEnvPythonCandidates(): Promise<string[]> {
    for (const command of this.getCondaCommandCandidates()) {
      const result = await this.execFileText(command, ["env", "list", "--json"], CONDA_DISCOVERY_TIMEOUT_MS);
      if (!result) {
        continue;
      }

      try {
        const payload = JSON.parse(result.stdout.trim()) as { envs?: string[] };
        if (!Array.isArray(payload.envs)) {
          continue;
        }

        const candidates = new Map<string, string>();
        this.collectPythonCandidatesFromRoots(candidates, payload.envs);
        return [...candidates.values()];
      } catch {
        continue;
      }
    }

    return [];
  }

  private getNearbyProjectSearchRoots(): string[] {
    const roots = new Set<string>();
    let currentDir = path.resolve(process.cwd());

    for (let depth = 0; depth < 2; depth += 1) {
      roots.add(currentDir);

      const parentDir = path.dirname(currentDir);
      const filesystemRoot = path.parse(currentDir).root;
      if (parentDir === currentDir || parentDir === filesystemRoot) {
        break;
      }

      currentDir = parentDir;
    }

    return [...roots];
  }

  private listNearbyProjectPythonCandidates(): string[] {
    const candidates = new Map<string, string>();

    for (const searchRoot of this.getNearbyProjectSearchRoots()) {
      this.collectPythonCandidatesFromRoots(
        candidates,
        PROJECT_ENV_DIR_NAMES.map((envName) => path.join(searchRoot, envName)),
      );

      try {
        const projectDirs = fs.readdirSync(searchRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && !NEARBY_PROJECT_IGNORED_DIRS.has(entry.name))
          .map((entry) => path.join(searchRoot, entry.name));

        for (const projectDir of projectDirs) {
          this.collectPythonCandidatesFromRoots(
            candidates,
            PROJECT_ENV_DIR_NAMES.map((envName) => path.join(projectDir, envName)),
          );
        }
      } catch {
        // Ignore unreadable project directories.
      }
    }

    return [...candidates.values()];
  }

  private listPyenvPythonCandidates(): string[] {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const pyenvRoots = [
      process.env.PYENV_ROOT,
      home ? path.join(home, ".pyenv") : null,
      isWindows && home ? path.join(home, ".pyenv", "pyenv-win") : null,
    ].filter((candidate): candidate is string => Boolean(candidate));

    const candidates = new Map<string, string>();
    for (const pyenvRoot of pyenvRoots) {
      const versionsDirCandidates = [
        path.join(pyenvRoot, "versions"),
        isWindows ? path.join(pyenvRoot, "pyenv-win", "versions") : null,
      ].filter((candidate): candidate is string => Boolean(candidate));

      for (const versionsDir of versionsDirCandidates) {
        if (!fs.existsSync(versionsDir)) {
          continue;
        }

        try {
          const envRoots = fs.readdirSync(versionsDir)
            .map((entry) => path.join(versionsDir, entry))
            .filter((candidate) => {
              try {
                return fs.statSync(candidate).isDirectory();
              } catch {
                return false;
              }
            });
          this.collectPythonCandidatesFromRoots(candidates, envRoots);
        } catch {
          // Ignore unreadable pyenv version directories.
        }
      }
    }

    return [...candidates.values()];
  }

  private compareDetectedEnvs(left: DetectedEnv, right: DetectedEnv): number {
    const configuredPythonPath = this.getConfiguredPythonPath();
    const configuredNormalized = configuredPythonPath ? normalizeDetectedPath(configuredPythonPath) : null;
    const leftIsConfigured = configuredNormalized === normalizeDetectedPath(left.pythonPath);
    const rightIsConfigured = configuredNormalized === normalizeDetectedPath(right.pythonPath);
    if (leftIsConfigured !== rightIsConfigured) {
      return Number(rightIsConfigured) - Number(leftIsConfigured);
    }

    if (left.hasCorePackages !== right.hasCorePackages) {
      return Number(right.hasCorePackages) - Number(left.hasCorePackages);
    }

    if (left.writable !== right.writable) {
      return Number(right.writable) - Number(left.writable);
    }

    const envKindPriority: Record<EnvKind, number> = {
      managed: 0,
      conda: 1,
      venv: 2,
      system: 3,
      bundled: 4,
    };
    const kindDifference = envKindPriority[left.envKind] - envKindPriority[right.envKind];
    if (kindDifference !== 0) {
      return kindDifference;
    }

    const versionDifference = right.pythonVersion.localeCompare(left.pythonVersion, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (versionDifference !== 0) {
      return versionDifference;
    }

    return left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" });
  }

  private getEnvKind(envRoot: string, pythonPath: string): EnvKind {
    const bundledRuntime = this.detectBundledRuntime();
    if (bundledRuntime && path.normalize(bundledRuntime.pythonPath) === path.normalize(pythonPath)) {
      return "bundled";
    }

    const managedPython = this.getManagedPythonPath();
    if (path.normalize(managedPython) === path.normalize(pythonPath)) {
      return "managed";
    }

    if (fs.existsSync(path.join(envRoot, "conda-meta"))) {
      return "conda";
    }

    if (fs.existsSync(path.join(envRoot, "pyvenv.cfg"))) {
      return "venv";
    }

    return "system";
  }

  private isLikelyWritable(envRoot: string, pythonPath: string): boolean {
    const candidates = [
      this.getSitePackagesForPythonPath(pythonPath),
      envRoot,
      path.dirname(pythonPath),
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of candidates) {
      try {
        fs.accessSync(candidate, fs.constants.W_OK);
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  private getMissingOptionalPackages(installedPackages: Set<string>): string[] {
    return Object.keys(recommendedConfig.optional ?? {}).filter(
      (packageName) => !installedPackages.has(normalizePackageName(packageName)),
    );
  }

  private guessProfileAlignment(installedPackages: Set<string>): ProfileAlignmentGuess | null {
    const supportedProfiles = getSupportedProfiles(recommendedConfig);
    if (supportedProfiles.length === 0) {
      return null;
    }

    const scoredProfiles = supportedProfiles.map(([id, profile]) => {
      const packageNames = Object.keys(profile.packages ?? {});
      const missingCount = packageNames.filter(
        (packageName) => !installedPackages.has(normalizePackageName(packageName)),
      ).length;
      return {
        id,
        label: profile.label ?? id,
        missingCount,
      };
    });

    scoredProfiles.sort((left, right) => {
      if (left.missingCount !== right.missingCount) {
        return left.missingCount - right.missingCount;
      }
      if (left.id === "cpu") return -1;
      if (right.id === "cpu") return 1;
      return left.id.localeCompare(right.id);
    });

    return scoredProfiles[0] ?? null;
  }

  private async inspectPythonPackages(pythonPath: string): Promise<InspectPythonData | null> {
    return new Promise((resolve) => {
      execFile(
        pythonPath,
        [
          "-c",
          "import json, sys\n"
          + "from importlib import metadata as importlib_metadata\n"
          + "installed = {}\n"
          + "for dist in importlib_metadata.distributions():\n"
          + "    name = dist.metadata.get('Name')\n"
          + "    if name:\n"
          + "        installed[name] = dist.version\n"
          + "payload = {\n"
          + "    'version': f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}',\n"
          + "    'installed': installed,\n"
          + "}\n"
          + "print(json.dumps(payload))",
        ],
        { timeout: 10_000 },
        (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }

          try {
            const payload = JSON.parse(stdout.trim()) as {
              version?: string;
              installed?: Record<string, string>;
            };
            const version = payload.version?.trim();
            if (!version) {
              resolve(null);
              return;
            }

            const [major, minor] = version.split(".").map(Number);
            if (major < 3 || (major === 3 && minor < 11)) {
              resolve(null);
              return;
            }

            const installedPackages = new Map<string, string>();
            for (const [name, packageVersion] of Object.entries(payload.installed ?? {})) {
              installedPackages.set(normalizePackageName(name), packageVersion);
            }

            resolve({ version, installedPackages });
          } catch {
            resolve(null);
          }
        },
      );
    });
  }

  private buildInspectedEnv(pythonPath: string, data: InspectPythonData): InspectedEnv {
    const envRoot = this.getEnvRootForPythonPath(pythonPath);
    const installedPackageNames = new Set(data.installedPackages.keys());
    const missingCorePackages = MANAGED_RUNTIME_PACKAGES
      .map((packageSpec) => packageSpec.split(">=")[0].split("[")[0])
      .filter((packageName) => !installedPackageNames.has(normalizePackageName(packageName)));
    const profileAlignmentGuess = this.guessProfileAlignment(installedPackageNames);

    return {
      path: envRoot,
      pythonPath,
      pythonVersion: data.version,
      hasNirs4all: installedPackageNames.has("nirs4all"),
      hasCorePackages: missingCorePackages.length === 0,
      envKind: this.getEnvKind(envRoot, pythonPath),
      writable: this.isLikelyWritable(envRoot, pythonPath),
      missingCorePackages,
      missingOptionalPackages: this.getMissingOptionalPackages(installedPackageNames),
      profileAlignmentGuess,
    };
  }

  /** Get full environment info */
  async getInfo(): Promise<EnvInfo> {
    const pythonPath = this.getConfiguredPythonPath();
    let pythonVersion: string | null = null;
    if (pythonPath && fs.existsSync(pythonPath)) {
      const detected = await this.checkPython(pythonPath);
      if (detected) pythonVersion = detected.pythonVersion;
    }
    return {
      status: this.status,
      envDir: this.envDir,
      pythonPath,
      sitePackages: this.getSitePackagesForPythonPath(pythonPath),
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
    const pythonPath = this.getConfiguredPythonPath();
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
   * Lightweight runtime check: verifies that uvicorn and fastapi are
   * importable. Intended for the startup-fast path — does NOT import
   * `nirs4all`, which is heavy and is loaded lazily by the backend itself.
   */
  async verifyBackendRuntime(): Promise<boolean> {
    const pythonPath = this.getBackendTargetPythonPath();
    if (!pythonPath || !fs.existsSync(pythonPath)) return false;

    const start = Date.now();
    const result = await new Promise<boolean>((resolve) => {
      execFile(
        pythonPath,
        ["-c", "import uvicorn, fastapi"],
        { timeout: 15000 },
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

    const start = Date.now();
    const result = await new Promise<boolean>((resolve) => {
      execFile(
        pythonPath,
        ["-c", "import uvicorn; import fastapi; import nirs4all"],
        { timeout: 30000 },
        (error) => resolve(!error),
      );
    });
    console.log(`verifyBackendPackages: ${result ? "ok" : "fail"} in ${Date.now() - start}ms`);
    return result;
  }

  /**
   * Compute a fingerprint for the current Python environment, used as the
   * cache key suffix for {@link verifyBackendRuntime}. Returns null when no
   * reliable fingerprint can be built (e.g. user-provided custom env without
   * a recognisable layout) — callers MUST treat this as "do not cache".
   */
  private computeEnvFingerprint(pythonPath: string): string | null {
    const parts: string[] = [];

    // Derive env root from python executable location.
    const dir = path.dirname(pythonPath);
    const dirName = path.basename(dir).toLowerCase();
    const envRoot = (dirName === "scripts" || dirName === "bin")
      ? path.dirname(dir)
      : dir;

    const stat = (p: string): string | null => {
      try {
        const s = fs.statSync(p);
        return `${s.mtimeMs}:${s.size}`;
      } catch {
        return null;
      }
    };

    // build_info.json (managed env marker)
    const buildInfo = stat(path.join(this.envDir, "build_info.json"));
    if (buildInfo) parts.push(`build:${buildInfo}`);

    // pyvenv.cfg
    const pyvenvCfg = stat(path.join(envRoot, "pyvenv.cfg"));
    if (pyvenvCfg) parts.push(`pyvenv:${pyvenvCfg}`);

    // site-packages directory mtime
    const sitePackages = this.getSitePackagesForPythonPath(pythonPath);
    if (sitePackages) {
      const sp = stat(sitePackages);
      if (sp) parts.push(`site:${sp}`);
    }

    // For custom envs that don't expose any of the markers above, we can't
    // build a reliable fingerprint — refuse to cache.
    if (parts.length === 0) {
      return null;
    }

    return parts.join("|");
  }

  private getVerifyCachePath(): string {
    return path.join(app.getPath("userData"), VERIFY_CACHE_FILE);
  }

  private readVerifyCache(): VerifyCacheEntry | null {
    try {
      const p = this.getVerifyCachePath();
      if (!fs.existsSync(p)) return null;
      const data = JSON.parse(fs.readFileSync(p, "utf-8")) as VerifyCacheEntry;
      if (!data.pythonPath || !data.appVersion || !data.fingerprint) return null;
      return data;
    } catch {
      return null;
    }
  }

  private writeVerifyCache(entry: VerifyCacheEntry): void {
    try {
      const p = this.getVerifyCachePath();
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p, JSON.stringify(entry, null, 2));
    } catch (error) {
      console.warn(`[EnvManager] Failed to write verify cache: ${error}`);
    }
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
      const fingerprint = this.computeEnvFingerprint(pythonPath);
      const currentVersion = app.getVersion();
      if (fingerprint) {
        const cached = this.readVerifyCache();
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
        await this.installCorePackages(pythonPath, {
          timeoutMs: options?.timeoutMs ?? PIP_INSTALL_TIMEOUT_MS,
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
          await this.installCorePackages(pythonPath, {
            timeoutMs: options?.timeoutMs ?? PIP_INSTALL_TIMEOUT_MS,
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
      const finalFingerprint = this.computeEnvFingerprint(pythonPath);
      if (finalFingerprint) {
        this.writeVerifyCache({
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
   * Detect existing Python environments on the system.
   *
   * Results are cached in-memory for a short TTL, keyed on a hash of
   * the active discovery inputs (`process.cwd()`, `PATH`, and key Python
   * manager env vars). The cache is intentionally transient and separate from
   * the persistent verify cache used by {@link ensureBackendPackages}.
   */
  async detectExistingEnvs(): Promise<DetectedEnv[]> {
    const cacheKey = createHash("sha1")
      .update(process.platform)
      .update("\u0000")
      .update(process.cwd())
      .update("\u0000")
      .update(process.env.PATH || "")
      .update("\u0000")
      .update(process.env.CONDA_EXE || "")
      .update("\u0000")
      .update(process.env.PYENV_ROOT || "")
      .digest("hex");
    const now = Date.now();
    if (detectEnvsCache && detectEnvsCache.key === cacheKey && detectEnvsCache.expiresAt > now) {
      return detectEnvsCache.result.slice();
    }

    const candidates = new Map<string, string>();
    this.addPythonCandidate(candidates, this.pythonPath);
    this.addPythonCandidate(candidates, this.getManagedPythonPath());
    this.addPythonCandidate(candidates, this.detectBundledRuntime()?.pythonPath);

    for (const candidate of this.listPathPythonCandidates()) {
      this.addPythonCandidate(candidates, candidate);
    }

    for (const candidate of this.listCommonHomePythonCandidates()) {
      this.addPythonCandidate(candidates, candidate);
    }

    for (const candidate of this.listNearbyProjectPythonCandidates()) {
      this.addPythonCandidate(candidates, candidate);
    }

    for (const candidate of this.listPyenvPythonCandidates()) {
      this.addPythonCandidate(candidates, candidate);
    }

    const [windowsLauncherCandidates, condaCandidates] = await Promise.all([
      this.listWindowsLauncherPythonCandidates(),
      this.listCondaEnvPythonCandidates(),
    ]);

    for (const candidate of windowsLauncherCandidates) {
      this.addPythonCandidate(candidates, candidate);
    }

    for (const candidate of condaCandidates) {
      this.addPythonCandidate(candidates, candidate);
    }

    if (process.platform === "darwin") {
      for (const candidate of [
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
      ]) {
        this.addPythonCandidate(candidates, candidate);
      }
    }

    const detected = (await Promise.all(
      [...candidates.values()].map((candidate) => this.checkPython(candidate)),
    )).filter((env): env is DetectedEnv => Boolean(env));

    const envs: DetectedEnv[] = [];
    const seenEnvRoots = new Set<string>();
    for (const env of detected.sort((left, right) => this.compareDetectedEnvs(left, right))) {
      const envKey = normalizeDetectedPath(env.path);
      if (seenEnvRoots.has(envKey)) {
        continue;
      }

      seenEnvRoots.add(envKey);
      envs.push(env);
    }

    detectEnvsCache = {
      key: cacheKey,
      expiresAt: Date.now() + DETECT_ENVS_TTL_MS,
      result: envs.slice(),
    };

    return envs;
  }

  /** Check a Python executable and return info if it's 3.11+ */
  private async checkPython(pythonPath: string): Promise<DetectedEnv | null> {
    const corePackageNames = JSON.stringify(
      MANAGED_RUNTIME_PACKAGES.map((packageSpec) => packageSpec.split(">=")[0].split("[")[0]),
    );
    return new Promise((resolve) => {
      execFile(
        pythonPath,
        [
          "-c",
          "import sys\n"
          + "from importlib import metadata as importlib_metadata\n"
          + "print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')\n"
          + "installed = set()\n"
          + "normalize = lambda name: name.replace('-', '_').replace('.', '_').lower()\n"
          + "for dist in importlib_metadata.distributions():\n"
          + "    name = dist.metadata.get('Name')\n"
          + "    if name:\n"
          + "        installed.add(normalize(name))\n"
          + `core = [normalize(name) for name in ${corePackageNames}]\n`
          + "print('nirs4all' in installed)\n"
          + "print(all(name in installed for name in core))",
        ],
        { timeout: 5000, windowsHide: isWindows },
        (error, stdout) => {
          if (error) { resolve(null); return; }
          const lines = stdout.trim().split("\n");
          if (lines.length < 3) { resolve(null); return; }
          const version = lines[0].trim();
          const [major, minor] = version.split(".").map(Number);
          if (major < 3 || (major === 3 && minor < 11)) { resolve(null); return; }
          const hasNirs4all = lines[1].trim() === "True";
          const hasCorePackages = lines[2].trim() === "True";
          const envRoot = this.getEnvRootForPythonPath(pythonPath);
          resolve({
            path: envRoot,
            pythonPath,
            pythonVersion: version,
            hasNirs4all,
            hasCorePackages,
            envKind: this.getEnvKind(envRoot, pythonPath),
            writable: this.isLikelyWritable(envRoot, pythonPath),
          });
        },
      );
    });
  }

  /**
   * Inspect an existing Python environment without mutating it.
   */
  async inspectExistingEnv(envPath: string): Promise<{ success: boolean; message: string; info?: InspectedEnv }> {
    const candidates = this.getPythonExecutableCandidatesForEnvRoot(envPath)
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

    const data = await this.inspectPythonPackages(pythonPath);
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
    const installCorePackages = options?.installCorePackages === true;

    if (!info.hasCorePackages && !installCorePackages) {
      return {
        success: false,
        message: `Python ${info.pythonVersion} is missing required backend packages (${info.missingCorePackages.join(", ")}). Choose an explicit install action before switching.`,
        info,
      };
    }

    if (!info.hasCorePackages && installCorePackages) {
      if (!(await probeNetworkOnline())) {
        return {
          success: false,
          message: `Python ${info.pythonVersion} is missing required backend packages and the app is offline. Connect to the internet once to install ${info.missingCorePackages.join(", ")} or install them manually and retry.`,
          info,
        };
      }

      try {
        await this.installCorePackages(pythonPath);
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

    const action = installCorePackages ? "Installed core packages and switched" : "Using";
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
    await this.runCommand(pythonPath, ["-m", "pip", "install", "--no-cache-dir", ...MANAGED_RUNTIME_PACKAGES], {
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
      const tarballName = getArchiveFilename(process.platform, process.arch);
      const downloadUrl = getDownloadUrl(process.platform, process.arch);
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
        await this.rmWithRetry(pythonDir);
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

      // 4. Create venv
      this.status = "creating_venv";
      report(25, "creating_venv", "Creating virtual environment...");
      const venvDir = path.join(baseDir, "venv");
      if (fs.existsSync(venvDir)) {
        await this.rmWithRetry(venvDir);
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

      const totalPackages = MANAGED_RUNTIME_PACKAGES.length;
      for (let i = 0; i < totalPackages; i++) {
        const pkg = MANAGED_RUNTIME_PACKAGES[i];
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

  /**
   * Remove a directory with retry + exponential backoff.
   *
   * On Windows, antivirus (Defender) can temporarily lock freshly extracted
   * files for 10–30 s.  A bare `fs.rmSync` fails instantly with EPERM/EBUSY.
   * This wrapper retries with increasing delays so the AV scan has time to
   * finish before we give up.
   */
  private async rmWithRetry(dirPath: string, retries = 5, baseDelayMs = 2000): Promise<void> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const retryable = code === "EPERM" || code === "EBUSY" || code === "EACCES";

        if (!retryable || attempt === retries) {
          // Annotate the final error with a likely cause on Windows
          if (isWindows && err instanceof Error && retryable) {
            err.message += " — this is usually caused by antivirus software locking newly extracted files. "
              + "Try temporarily adding the install directory to your antivirus exclusions and retrying.";
          }
          throw err;
        }

        const delayMs = baseDelayMs * Math.pow(2, attempt);
        console.warn(
          `[EnvManager] rmSync "${dirPath}" failed (attempt ${attempt + 1}/${retries + 1}, ${code}), retrying in ${delayMs / 1000}s...`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
}
