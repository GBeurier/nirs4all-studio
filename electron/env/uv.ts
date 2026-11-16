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

/**
 * uv's own explanation of a failure (resolver conflict, missing wheel, network)
 * instead of the command line that failed.
 */
function uvFailure(error: unknown): Error {
  const output = (error as { output?: unknown } | null)?.output;
  if (typeof output !== "string") return error instanceof Error ? error : new Error(String(error));
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  const start = lines.findIndex((line) => /^(×|error:)/i.test(line));
  const detail = lines.slice(start < 0 ? -6 : start).join(" ").replace(/[×╰─▶]+/g, " ").replace(/\s+/g, " ").trim();
  return detail ? new Error(detail.slice(0, 1500), { cause: error }) : error as Error;
}

async function runUv(args: string[], timeoutMs: number, retries: number): Promise<void> {
  try {
    await runCommand(resolveUvPath(), args, { env: UV_ENVIRONMENT, timeoutMs, retries });
  } catch (error) {
    throw uvFailure(error);
  }
}

export function createVenv(venvDir: string, basePython: string): Promise<void> {
  // One retry: antivirus can briefly lock freshly written files on Windows.
  return runUv(venvArgs(venvDir, basePython, resolveUvPayload()), UV_VENV_TIMEOUT_MS, 1);
}

/**
 * One resolver call for `specs`. With an offline payload the shipped wheels
 * are tried first; what they cannot satisfy then needs the package index.
 */
async function install(pythonPath: string, specs: readonly string[]): Promise<void> {
  const payload = resolveUvPayload();
  let offlineFailure: Error | null = null;
  if (payload.offline) {
    try {
      await runUv(pipInstallArgs(pythonPath, specs, payload, true), UV_INSTALL_TIMEOUT_MS, 0);
      return;
    } catch (error) {
      offlineFailure = error as Error;
      appendInstallLog("Not available in the offline package set; trying the package index.");
    }
  }
  try {
    await runUv(pipInstallArgs(pythonPath, specs, payload, false), UV_INSTALL_TIMEOUT_MS, 1);
  } catch (error) {
    const message = (error as Error).message;
    // A conflict is the same from both sources; a missing wheel and a network failure are two reasons.
    if (!offlineFailure || offlineFailure.message === message) throw error;
    throw new Error(`${message} (Offline package set: ${offlineFailure.message})`, { cause: error });
  }
}

/**
 * Install the required cohort at its exact versions in one resolver call, so
 * the packages stay mutually coherent.
 */
export function installRequiredPackages(pythonPath: string): Promise<void> {
  return install(pythonPath, requiredInstallSpecs());
}

/**
 * Install recommended packages at their recommended versions. `requiredPins`
 * (`name==installed version` of the required packages already present) join
 * the same resolver call: a recommended package that conflicts with them
 * fails the resolution instead of silently changing nirs4all or its owners.
 */
export async function installRecommendedPackages(
  pythonPath: string,
  names: readonly string[],
  requiredPins: readonly string[],
): Promise<void> {
  const specs = recommendedInstallSpecs(names);
  if (specs.length > 0) await install(pythonPath, [...specs, ...requiredPins]);
}
