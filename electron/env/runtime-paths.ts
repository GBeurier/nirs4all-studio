/**
 * Pure runtime-mode and filesystem-layout resolution for the managed/bundled/
 * custom Python environments.
 *
 * These helpers translate an env directory + (optionally) a configured custom
 * interpreter into concrete paths, the bundled-runtime descriptor, the env kind
 * classification, writability, and the detected-env sort order. They never touch
 * EnvManager state: the coordinator passes `envDir` (and the configured path
 * where relevant) and composes the results.
 */

import fs from "node:fs";
import path from "node:path";

import { getEnvRootForPythonPath, normalizeDetectedPath } from "./python-discovery";
import type { DetectedEnv, EnvKind } from "./env-inspection";
import { loadPythonRuntimeConfig } from "./external-config";

interface PythonRuntimeConfigModule {
  PYTHON_VERSION_MM: string;
}

const pythonRuntimeConfig = loadPythonRuntimeConfig<PythonRuntimeConfigModule>();
const { PYTHON_VERSION_MM } = pythonRuntimeConfig;

const isWindows = process.platform === "win32";

export interface BundledRuntimeInfo {
  runtimeDir: string;
  pythonPath: string;
  sitePackages: string;
}

/** Resolve the venv Python executable for the managed env at `envDir`. */
export function getManagedPythonPath(envDir: string): string {
  const venvDir = path.join(envDir, "venv");
  return isWindows
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

/**
 * Resolve the site-packages directory for an env root. When `requireExisting`
 * is set, returns null if no candidate directory exists on disk.
 */
export function resolveSitePackages(envRoot: string, requireExisting: boolean = false): string | null {
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

/** Resolve the existing site-packages directory for a custom interpreter path. */
export function getSitePackagesForPythonPath(pythonPath: string | null): string | null {
  if (!pythonPath) return null;
  return resolveSitePackages(getEnvRootForPythonPath(pythonPath), true);
}

/**
 * Detect a pre-baked, immutable bundled runtime shipped next to the app
 * resources. Returns null when no ready bundled runtime is present.
 */
export function detectBundledRuntime(): BundledRuntimeInfo | null {
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
    const sitePackages = resolveSitePackages(candidate.envRoot, true);
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

/** Classify an env root + interpreter into a managed/bundled/conda/venv/system kind. */
export function getEnvKind(envDir: string, envRoot: string, pythonPath: string): EnvKind {
  const bundledRuntime = detectBundledRuntime();
  if (bundledRuntime && path.normalize(bundledRuntime.pythonPath) === path.normalize(pythonPath)) {
    return "bundled";
  }

  const managedPython = getManagedPythonPath(envDir);
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

/** Best-effort writability probe across an env's site-packages / root / bin dir. */
export function isLikelyWritable(envRoot: string, pythonPath: string): boolean {
  const candidates = [
    getSitePackagesForPythonPath(pythonPath),
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

/**
 * Ordering for detected envs: the configured interpreter first, then envs that
 * already have core packages, writable envs, the kind priority, the newest
 * Python version, and finally the path for a stable tiebreak.
 */
export function compareDetectedEnvs(
  configuredPythonPath: string | null,
  left: DetectedEnv,
  right: DetectedEnv,
): number {
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
