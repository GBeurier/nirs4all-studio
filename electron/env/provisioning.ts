/**
 * Managed Python runtime provisioning: the full first-launch setup flow
 * (download → extract → venv → core packages → bytecode → metadata) plus the
 * standalone core-package install used by the verify/repair paths.
 *
 * The stateful coordination (status transitions, settings persistence) stays on
 * EnvManager, which passes a narrow {@link ProvisioningContext} so this module
 * can report progress and record the resolved interpreter without owning
 * EnvManager state directly.
 */

import fs from "node:fs";
import path from "node:path";

import { runCommand, rmWithRetry } from "./process-utils";
import { downloadFile, extractTarball, removeQuarantine } from "./python-runtime-installer";
import { MANAGED_RUNTIME_PACKAGES } from "./env-inspection";
import { loadPythonRuntimeConfig } from "./external-config";

/* eslint-disable @typescript-eslint/no-require-imports */
interface PythonRuntimeConfigModule {
  PBS_TAG: string;
  PYTHON_VERSION: string;
  getArchiveFilename(platform: string, arch: string): string;
  getDownloadUrl(platform: string, arch: string): string;
}

const pythonRuntimeConfig = loadPythonRuntimeConfig<PythonRuntimeConfigModule>();
const { PBS_TAG, PYTHON_VERSION, getArchiveFilename, getDownloadUrl } = pythonRuntimeConfig;

const isWindows = process.platform === "win32";
const ENSUREPIP_TIMEOUT_MS = 60_000;
const PIP_INSTALL_TIMEOUT_MS = 600_000;
const COMPILEALL_TIMEOUT_MS = 180_000;
const PIP_INSTALL_BASE_ARGS = ["-m", "pip", "install", "--no-cache-dir", "--prefer-binary"] as const;

export type EnvStatus = "none" | "downloading" | "extracting" | "creating_venv" | "installing" | "ready" | "error";
export type ProgressCallback = (percent: number, step: string, detail: string) => void;

interface InstallCorePackagesOptions {
  timeoutMs?: number;
}

/**
 * Narrow view of EnvManager state that the provisioning flow drives. Keeps the
 * setup body decoupled from the rest of the coordinator while preserving the
 * exact status/settings side-effects.
 */
export interface ProvisioningContext {
  /** Default managed-env directory (used when no custom targetDir is given). */
  readonly envDir: string;
  setStatus(status: EnvStatus): void;
  setLastError(error: string | null): void;
  /** Persist the resolved interpreter (`null` clears the custom path). */
  setPythonPath(pythonPath: string | null): void;
  saveSettings(): void;
}

/**
 * Install core packages into a Python environment using `python -m pip`.
 * Used when the user selects an existing Python that's missing nirs4all.
 */
export async function installCorePackages(
  pythonPath: string,
  options?: InstallCorePackagesOptions,
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? PIP_INSTALL_TIMEOUT_MS;

  // Ensure pip is available
  try {
    await runCommand(pythonPath, ["-m", "ensurepip", "--upgrade"], {
      retries: 1,
      timeoutMs: Math.min(timeoutMs, ENSUREPIP_TIMEOUT_MS),
    });
  } catch {
    // ensurepip may fail if pip is already installed — non-fatal
  }

  // Install all core packages in a single pip call
  await runCommand(pythonPath, [...PIP_INSTALL_BASE_ARGS, ...MANAGED_RUNTIME_PACKAGES], {
    retries: 2,
    timeoutMs,
  });
}

/**
 * Full setup: download Python, create venv, install packages.
 * Reports progress via callback.
 * @param ctx - Narrow EnvManager state view for status/settings side-effects
 * @param progress - Optional progress callback
 * @param targetDir - Optional custom directory. If provided, the env is created there
 *   instead of the default userData location. The venv python is then saved as
 *   pythonPath so getPythonPath() finds it.
 */
export async function provisionManagedRuntime(
  ctx: ProvisioningContext,
  progress?: ProgressCallback,
  targetDir?: string,
): Promise<void> {
  const report = progress ?? (() => {});
  const baseDir = targetDir || ctx.envDir;

  try {
    ctx.setStatus("downloading");
    ctx.setLastError(null);

    // 1. Resolve platform
    const tarballName = getArchiveFilename(process.platform, process.arch);
    const downloadUrl = getDownloadUrl(process.platform, process.arch);
    fs.mkdirSync(baseDir, { recursive: true });

    // 2. Download Python (if not already cached)
    const cachedTarball = path.join(baseDir, tarballName);
    if (fs.existsSync(cachedTarball) && fs.statSync(cachedTarball).size > 10 * 1024 * 1024) {
      report(15, "downloading", "Using cached Python runtime");
    } else {
      report(0, "downloading", "Downloading Python runtime...");
      await downloadFile(downloadUrl, cachedTarball, (percent) => {
        report(Math.round(percent * 0.15), "downloading", `Downloading Python runtime... ${percent}%`);
      });
    }

    // 3. Extract
    ctx.setStatus("extracting");
    report(15, "extracting", "Extracting Python runtime...");
    const pythonDir = path.join(baseDir, "python");
    const extractDir = path.join(baseDir, `.python-extract-${process.pid}-${Date.now()}`);
    if (fs.existsSync(extractDir)) {
      await rmWithRetry(extractDir);
    }
    fs.mkdirSync(extractDir, { recursive: true });

    try {
      await extractTarball(cachedTarball, extractDir);

      const extractedPythonDir = path.join(extractDir, "python");
      const extractedPython = isWindows
        ? path.join(extractedPythonDir, "python.exe")
        : path.join(extractedPythonDir, "bin", "python3");
      if (!fs.existsSync(extractedPython)) {
        throw new Error(`Python executable not found after extraction at ${extractedPython}`);
      }

      if (fs.existsSync(pythonDir)) {
        await rmWithRetry(pythonDir);
      }
      fs.renameSync(extractedPythonDir, pythonDir);
    } finally {
      if (fs.existsSync(extractDir)) {
        await rmWithRetry(extractDir).catch((error) => {
          console.warn(`[EnvManager] Could not clean temporary extraction directory: ${String(error)}`);
        });
      }
    }

    // Verify extraction — the tarball extracts a top-level `python/` directory
    const embeddedPython = isWindows
      ? path.join(pythonDir, "python.exe")
      : path.join(pythonDir, "bin", "python3");
    if (!fs.existsSync(embeddedPython)) {
      throw new Error(`Python executable not found after extraction at ${embeddedPython}`);
    }
    report(25, "extracting", "Python runtime extracted");

    // Remove macOS Gatekeeper quarantine attribute from downloaded Python
    await removeQuarantine(pythonDir);

    // 4. Create venv
    ctx.setStatus("creating_venv");
    report(25, "creating_venv", "Creating virtual environment...");
    const venvDir = path.join(baseDir, "venv");
    if (fs.existsSync(venvDir)) {
      await rmWithRetry(venvDir);
    }

    await runCommand(embeddedPython, ["-m", "venv", venvDir, "--without-pip"], {
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
    await runCommand(venvPython, ["-m", "ensurepip", "--upgrade"], {
      retries: 2,
      timeoutMs: ENSUREPIP_TIMEOUT_MS,
    });
    await runCommand(venvPython, [...PIP_INSTALL_BASE_ARGS, "--upgrade", "pip"], {
      retries: 2,
      timeoutMs: PIP_INSTALL_TIMEOUT_MS,
    });
    report(40, "creating_venv", "Virtual environment ready");

    // 5. Install core packages
    // On Windows, antivirus (Defender) may still be scanning venv files. Retries
    // with exponential backoff give it time to release file locks.
    ctx.setStatus("installing");
    report(40, "installing", "Installing core packages...");

    const totalPackages = MANAGED_RUNTIME_PACKAGES.length;
    for (let i = 0; i < totalPackages; i++) {
      const pkg = MANAGED_RUNTIME_PACKAGES[i];
      const pkgName = pkg.split(">=")[0].split("[")[0];
      const progressPercent = 40 + Math.round(((i + 1) / totalPackages) * 50);
      report(progressPercent, "installing", `Installing ${pkgName}...`);
      await runCommand(venvPython, [...PIP_INSTALL_BASE_ARGS, pkg], {
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
        await runCommand(venvPython, ["-m", "compileall", "-q", "-j", "0", ...compileTargets], {
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
      ctx.setPythonPath(venvPython);
    } else {
      ctx.setPythonPath(null);
    }
    ctx.saveSettings();

    ctx.setStatus("ready");
    report(100, "ready", "Python environment is ready");
  } catch (error) {
    ctx.setStatus("error");
    ctx.setLastError(error instanceof Error ? error.message : String(error));
    throw error;
  }
}
