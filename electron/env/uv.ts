/**
 * `uv` is the only tool Studio uses to create environments and install
 * packages. Every call names the target interpreter explicitly and streams its
 * output to the install log.
 */

import fs from "node:fs";
import path from "node:path";

import { normalizePackageName, recommendedInstallSpecs, requiredInstallSpecs } from "./catalogue";
import { appendInstallLog } from "./install-log";
import { runCommand } from "./process-utils";

const UV_EXECUTABLE = process.platform === "win32" ? "uv.exe" : "uv";
/** A GPU build of torch is several gigabytes; slow links need the time. */
const UV_INSTALL_TIMEOUT_MS = 30 * 60_000;
const UV_VENV_TIMEOUT_MS = 120_000;
const UV_ENVIRONMENT: NodeJS.ProcessEnv = {
  // Hard links and clones from uv's cache break when the cache is cleaned or on another volume.
  UV_LINK_MODE: "copy",
  // Corporate proxies are trusted through the system certificate store.
  UV_NATIVE_TLS: "1",
};

export interface UvPayload {
  /** Wheels of the required packages shipped with every installer. */
  wheelhouse: string | null;
  /** Offline installer payload: `wheels/` and the Python archive. */
  offline: string | null;
}

/** Packaged resources first, then the development build output. */
function findShipped(...segments: string[]): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const roots = [
    resourcesPath ? path.join(resourcesPath, "backend") : null,
    path.join(process.cwd(), "backend-dist"),
  ];
  for (const root of roots) {
    if (!root) continue;
    const candidate = path.join(root, ...segments);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** `NIRS4ALL_UV`, then the binary shipped with Studio, then `uv` on PATH (development). */
export function resolveUvPath(): string {
  return process.env.NIRS4ALL_UV?.trim() || findShipped("tools", UV_EXECUTABLE) || "uv";
}

export function resolveUvPayload(): UvPayload {
  return { wheelhouse: findShipped("wheels"), offline: findShipped("offline") };
}

function wheelDirectories(payload: UvPayload): string[] {
  const offlineWheels = payload.offline ? path.join(payload.offline, "wheels") : null;
  return [payload.wheelhouse, offlineWheels].filter((directory): directory is string => directory !== null);
}

/** `uv pip install` arguments. `offline` restricts resolution to the shipped wheels. */
export function pipInstallArgs(pythonPath: string, specs: readonly string[], payload: UvPayload, offline: boolean): string[] {
  const installsTorch = specs.some((spec) => normalizePackageName(spec.split("==")[0]) === "torch");
  return [
    "pip", "install", "--python", pythonPath,
    ...(offline ? ["--offline", "--no-index"] : []),
    ...wheelDirectories(payload).flatMap((directory) => ["--find-links", directory]),
    // Selects the CPU, CUDA or Metal build from the machine; offline wheels are used as shipped.
    ...(installsTorch && !offline ? ["--torch-backend", "auto"] : []),
    ...specs,
  ];
}

/** `uv venv` arguments for an environment on the given base interpreter. */
export function venvArgs(venvDir: string, basePython: string, payload: UvPayload): string[] {
  return ["venv", venvDir, "--python", basePython, ...(payload.offline ? ["--offline"] : [])];
}

function runUv(args: string[], timeoutMs: number): Promise<void> {
  // One retry: antivirus can briefly lock freshly written files on Windows.
  return runCommand(resolveUvPath(), args, { env: UV_ENVIRONMENT, timeoutMs, retries: 1 });
}

export function createVenv(venvDir: string, basePython: string): Promise<void> {
  return runUv(venvArgs(venvDir, basePython, resolveUvPayload()), UV_VENV_TIMEOUT_MS);
}

/**
 * Install the required cohort at its exact versions in one resolver call, so
 * the packages stay mutually coherent. `excluded` names (editable installs)
 * are left untouched.
 */
export function installRequiredPackages(pythonPath: string, excluded: ReadonlySet<string> = new Set()): Promise<void> {
  const payload = resolveUvPayload();
  return runUv(pipInstallArgs(pythonPath, requiredInstallSpecs(excluded), payload, payload.offline !== null), UV_INSTALL_TIMEOUT_MS);
}

/**
 * Install recommended packages at their recommended versions. With an offline
 * payload the shipped wheels are tried first; a package outside the payload
 * then needs the package index.
 */
export async function installRecommendedPackages(pythonPath: string, names: readonly string[]): Promise<void> {
  const specs = recommendedInstallSpecs(names);
  if (specs.length === 0) return;
  const payload = resolveUvPayload();
  if (payload.offline) {
    try {
      await runCommand(resolveUvPath(), pipInstallArgs(pythonPath, specs, payload, true), { env: UV_ENVIRONMENT, timeoutMs: UV_INSTALL_TIMEOUT_MS });
      return;
    } catch {
      appendInstallLog("Not available in the offline package set; trying the package index.");
    }
  }
  await runUv(pipInstallArgs(pythonPath, specs, payload, false), UV_INSTALL_TIMEOUT_MS);
}
