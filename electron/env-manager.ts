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
const electron = require("electron") as typeof import("electron");
const { app } = electron;

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
  "aiofiles>=24.0.0",
  "httpx>=0.27.0",
  "pyyaml>=6.0",
  "packaging>=24.0",
  "platformdirs>=4.0.0",
  "nirs4all",
];

const isWindows = process.platform === "win32";

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
  customEnvPath?: string;
}

export class EnvManager {
  private status: EnvStatus = "none";
  private lastError: string | null = null;
  private envDir: string;
  private settingsPath: string;
  private customEnvPath: string | null = null;

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
        const data = JSON.parse(fs.readFileSync(this.settingsPath, "utf-8")) as EnvSettings;
        this.customEnvPath = data.customEnvPath ?? null;
      }
    } catch {
      // Ignore corrupt settings
    }
  }

  private saveSettings(): void {
    try {
      const data: EnvSettings = {};
      if (this.customEnvPath) data.customEnvPath = this.customEnvPath;
      fs.writeFileSync(this.settingsPath, JSON.stringify(data, null, 2));
    } catch {
      // Best effort
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
    // Custom env
    if (this.customEnvPath) {
      const p = isWindows
        ? path.join(this.customEnvPath, "Scripts", "python.exe")
        : path.join(this.customEnvPath, "bin", "python");
      if (fs.existsSync(p)) return p;
      // Also check if it's a base Python (not a venv)
      const p2 = isWindows
        ? path.join(this.customEnvPath, "python.exe")
        : path.join(this.customEnvPath, "bin", "python3");
      if (fs.existsSync(p2)) return p2;
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
    // Custom env
    if (this.customEnvPath) {
      if (isWindows) {
        const p = path.join(this.customEnvPath, "Lib", "site-packages");
        if (fs.existsSync(p)) return p;
      } else {
        // Find pythonX.Y directory
        const libDir = path.join(this.customEnvPath, "lib");
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
  getInfo(): EnvInfo {
    return {
      status: this.status,
      envDir: this.envDir,
      pythonPath: this.getPythonPath(),
      sitePackages: this.getSitePackages(),
      pythonVersion: null, // Filled on demand
      isCustom: this.customEnvPath !== null,
      error: this.lastError ?? undefined,
    };
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
        ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}'); import importlib; print(importlib.util.find_spec('nirs4all') is not None)"],
        { timeout: 5000 },
        (error, stdout) => {
          if (error) { resolve(null); return; }
          const lines = stdout.trim().split("\n");
          if (lines.length < 2) { resolve(null); return; }
          const version = lines[0].trim();
          const [major, minor] = version.split(".").map(Number);
          if (major < 3 || (major === 3 && minor < 11)) { resolve(null); return; }
          const hasNirs4all = lines[1].trim() === "True";
          // Determine the env root (parent of bin/ or Scripts/)
          const envRoot = path.dirname(path.dirname(pythonPath));
          resolve({ path: envRoot, pythonVersion: version, hasNirs4all });
        },
      );
    });
  }

  /**
   * Configure an existing Python environment.
   * Validates it has Python 3.11+ and optionally nirs4all.
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

    this.customEnvPath = envPath;
    this.saveSettings();
    this.status = "ready";
    return { success: true, message: `Using Python ${info.pythonVersion} from ${envPath}`, info };
  }

  /**
   * Full setup: download Python, create venv, install packages.
   * Reports progress via callback.
   */
  async setup(progress?: ProgressCallback): Promise<void> {
    const report = progress ?? (() => {});

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
      fs.mkdirSync(this.envDir, { recursive: true });

      // 2. Download Python (if not already cached)
      const cachedTarball = path.join(this.envDir, tarballName);
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
      const pythonDir = path.join(this.envDir, "python");
      if (fs.existsSync(pythonDir)) {
        fs.rmSync(pythonDir, { recursive: true, force: true });
      }

      await this.extractTarball(cachedTarball, this.envDir);

      // Verify extraction
      const embeddedPython = this.getPythonPath();
      if (!embeddedPython || !fs.existsSync(embeddedPython)) {
        throw new Error(`Python executable not found after extraction`);
      }
      report(25, "extracting", "Python runtime extracted");

      // Clean up tarball to save space
      try { fs.unlinkSync(cachedTarball); } catch { /* ignore */ }

      // 4. Create venv
      this.status = "creating_venv";
      report(25, "creating_venv", "Creating virtual environment...");
      const venvDir = path.join(this.envDir, "venv");
      if (fs.existsSync(venvDir)) {
        fs.rmSync(venvDir, { recursive: true, force: true });
      }

      await this.runCommand(embeddedPython, ["-m", "venv", venvDir, "--without-pip"]);

      const venvPython = isWindows
        ? path.join(venvDir, "Scripts", "python.exe")
        : path.join(venvDir, "bin", "python");

      if (!fs.existsSync(venvPython)) {
        throw new Error("Venv creation failed: python executable not found");
      }

      report(35, "creating_venv", "Bootstrapping pip...");
      await this.runCommand(venvPython, ["-m", "ensurepip", "--upgrade"]);
      await this.runCommand(venvPython, ["-m", "pip", "install", "--upgrade", "pip"]);
      report(40, "creating_venv", "Virtual environment ready");

      // 5. Install core packages
      this.status = "installing";
      report(40, "installing", "Installing core packages...");

      const totalPackages = CORE_PACKAGES.length;
      for (let i = 0; i < totalPackages; i++) {
        const pkg = CORE_PACKAGES[i];
        const pkgName = pkg.split(">=")[0].split("[")[0];
        const progressPercent = 40 + Math.round(((i + 1) / totalPackages) * 50);
        report(progressPercent, "installing", `Installing ${pkgName}...`);
        await this.runCommand(venvPython, ["-m", "pip", "install", pkg]);
      }

      report(90, "installing", "All packages installed");

      // 6. Pre-compile bytecode
      report(92, "installing", "Optimizing startup time...");
      const compileTargets = [
        isWindows ? path.join(venvDir, "Lib") : path.join(venvDir, "lib"),
      ].filter((p) => fs.existsSync(p));

      if (compileTargets.length > 0) {
        try {
          await this.runCommand(venvPython, ["-m", "compileall", "-q", ...compileTargets]);
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
      fs.writeFileSync(path.join(this.envDir, "build_info.json"), JSON.stringify(buildInfo, null, 2));

      this.status = "ready";
      report(100, "ready", "Python environment is ready");
    } catch (error) {
      this.status = "error";
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
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

    return this.runCommand("tar", args);
  }

  /** Check if the system tar is GNU tar (vs Windows built-in bsdtar) */
  private isGnuTar(): Promise<boolean> {
    return new Promise((resolve) => {
      execFile("tar", ["--version"], { shell: isWindows }, (err, stdout) => {
        resolve(!err && stdout.includes("GNU tar"));
      });
    });
  }

  /** Run a command and wait for it to complete */
  private runCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: isWindows,
      });

      let stderr = "";
      proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Command "${command} ${args.join(" ")}" failed (code ${code}): ${stderr.slice(0, 500)}`));
      });

      proc.on("error", reject);
    });
  }
}
