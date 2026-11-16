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
  /** Embedded wheels of the required packages (`wheels/`): Windows and Linux installers carry them, the macOS application does not. */
  wheelhouse: string | null;
  /** Offline installer payload: `wheels/` and the Python archive. */
  offline: string | null;
}

/**
 * An installed application: the Electron runtime was not started as
 * `electron <app>` (`process.defaultApp` is only set then). Plain Node, which
 * runs the tests and build tools, counts as development.
 */
function isPackagedApplication(): boolean {
  return process.versions.electron !== undefined && !(process as NodeJS.Process & { defaultApp?: boolean }).defaultApp;
}

/**
 * Packaged resources first, then the development build output. A packaged
 * application never reads the working directory: it is wherever the user
 * launched it from, and a `backend-dist/` there is a developer's payload.
 */
function findShipped(...segments: string[]): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const roots = [
    resourcesPath ? path.join(resourcesPath, "backend") : null,
    isPackagedApplication() ? null : path.join(process.cwd(), "backend-dist"),
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

/**
 * What the application itself carries. Without embedded wheels (macOS,
 * development) the package index alone supplies the required packages.
 */
export function resolveUvPayload(): UvPayload {
  return { wheelhouse: findShipped("wheels"), offline: findShipped("offline") };
}

function wheelDirectories(payload: UvPayload): string[] {
  const offlineWheels = payload.offline ? path.join(payload.offline, "wheels") : null;
  return [payload.wheelhouse, offlineWheels].filter((directory): directory is string => directory !== null);
}

function isTorchSpec(spec: string): boolean {
  return normalizePackageName(spec.split("==")[0]) === "torch";
}

/** `uv pip install` arguments. `offline` restricts resolution to the shipped wheels. */
export function pipInstallArgs(pythonPath: string, specs: readonly string[], payload: UvPayload, offline: boolean): string[] {
  const installsTorch = specs.some(isTorchSpec);
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
 * are tried first and what they cannot satisfy then needs the package index;
 * `indexFirst` asks the index first and keeps the shipped wheels as the
 * fallback.
 */
async function install(pythonPath: string, specs: readonly string[], payload: UvPayload, indexFirst = false): Promise<void> {
  const fromIndex = (retries: number) => runUv(pipInstallArgs(pythonPath, specs, payload, false), UV_INSTALL_TIMEOUT_MS, retries);
  const fromOfflineSet = () => runUv(pipInstallArgs(pythonPath, specs, payload, true), UV_INSTALL_TIMEOUT_MS, 0);
  if (!payload.offline) return fromIndex(1);

  let firstFailure: Error;
  try {
    // An index that cannot be reached is not asked twice when the shipped wheels can still answer.
    await (indexFirst ? fromIndex(0) : fromOfflineSet());
    return;
  } catch (error) {
    firstFailure = error as Error;
    appendInstallLog(indexFirst
      ? "Not available from the package index; trying the offline package set."
      : "Not available in the offline package set; trying the package index.");
  }
  try {
    await (indexFirst ? fromOfflineSet() : fromIndex(1));
  } catch (error) {
    const [indexFailure, offlineFailure] = indexFirst ? [firstFailure, error as Error] : [error as Error, firstFailure];
    // A conflict is the same from both sources; a missing wheel and a network failure are two reasons.
    if (indexFailure.message === offlineFailure.message) throw error;
    throw new Error(`${indexFailure.message} (Offline package set: ${offlineFailure.message})`, { cause: error });
  }
}

/**
 * Install the required cohort at its exact versions in one resolver call, so
 * the packages stay mutually coherent.
 */
export async function installRequiredPackages(pythonPath: string): Promise<void> {
  await install(pythonPath, requiredInstallSpecs(), resolveUvPayload());
}

/**
 * Install recommended packages at their recommended versions. `requiredPins`
 * (`name==installed version` of the required packages already present) join
 * the same resolver call: a recommended package that conflicts with them
 * fails the resolution instead of silently changing nirs4all or its owners.
 *
 * The offline payload carries the CPU build of PyTorch only. With that payload
 * PyTorch is therefore resolved on its own, from the package index first, so
 * that a machine with a network gets the build for its hardware as it does
 * from the standard installer; the shipped CPU build is the fallback.
 */
export async function installRecommendedPackages(pythonPath: string, names: readonly string[], requiredPins: readonly string[]): Promise<void> {
  const payload = resolveUvPayload();
  const specs = recommendedInstallSpecs(names);
  const torch = payload.offline ? specs.filter(isTorchSpec) : [];
  const others = specs.filter((spec) => !torch.includes(spec));
  if (torch.length > 0) await install(pythonPath, [...torch, ...requiredPins], payload, true);
  if (others.length > 0) await install(pythonPath, [...others, ...requiredPins], payload);
}
