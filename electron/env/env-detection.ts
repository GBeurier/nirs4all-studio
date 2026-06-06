/**
 * Discovery of existing Python environments on the host.
 *
 * `checkPythonEnv` spawns an interpreter to read its version + core-package
 * presence and classifies the result. `detectExistingEnvs` gathers candidates
 * across ecosystems, classifies them in parallel, then sorts and de-duplicates
 * by env root behind a short-TTL in-memory cache. EnvManager passes the env
 * directory and the configured interpreter; it never holds this discovery state.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

import { getManagedCorePackageNames } from "./env-inspection";
import type { DetectedEnv } from "./env-inspection";
import {
  gatherPythonCandidates,
  getEnvRootForPythonPath,
  normalizeDetectedPath,
} from "./python-discovery";
import {
  compareDetectedEnvs,
  detectBundledRuntime,
  getEnvKind,
  getManagedPythonPath,
  isLikelyWritable,
} from "./runtime-paths";

const isWindows = process.platform === "win32";

// Short-TTL in-memory cache for detectExistingEnvs(). Scanning PATH and
// spawning Python for every candidate is expensive, and the Settings UI can
// trigger it multiple times in quick succession. This cache is intentionally
// module-scope and non-persistent — the separate on-disk verify cache
// (verify-cache.json) covers ensureBackendPackages() and must not be
// co-mingled with this transient cache.
const DETECT_ENVS_TTL_MS = 30_000;
let detectEnvsCache: { key: string; expiresAt: number; result: DetectedEnv[] } | null = null;

export interface DetectEnvsContext {
  /** Default managed-env directory. */
  envDir: string;
  /** The persisted custom interpreter, if any. */
  customPythonPath: string | null;
  /** The interpreter Electron is currently configured to use, for sort priority. */
  configuredPythonPath: string | null;
}

/** Check a Python executable and return info if it's 3.11+. */
export function checkPythonEnv(envDir: string, pythonPath: string): Promise<DetectedEnv | null> {
  const corePackageNames = JSON.stringify(getManagedCorePackageNames());
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
        const envRoot = getEnvRootForPythonPath(pythonPath);
        resolve({
          path: envRoot,
          pythonPath,
          pythonVersion: version,
          hasNirs4all,
          hasCorePackages,
          envKind: getEnvKind(envDir, envRoot, pythonPath),
          writable: isLikelyWritable(envRoot, pythonPath),
        });
      },
    );
  });
}

/**
 * Detect existing Python environments on the system.
 *
 * Results are cached in-memory for a short TTL, keyed on a hash of the active
 * discovery inputs (`process.cwd()`, `PATH`, and key Python manager env vars).
 * The cache is intentionally transient and separate from the persistent verify
 * cache used by ensureBackendPackages().
 */
export async function detectExistingEnvs(ctx: DetectEnvsContext): Promise<DetectedEnv[]> {
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

  const candidatePaths = await gatherPythonCandidates([
    ctx.customPythonPath,
    getManagedPythonPath(ctx.envDir),
    detectBundledRuntime()?.pythonPath,
  ]);

  const detected = (await Promise.all(
    candidatePaths.map((candidate) => checkPythonEnv(ctx.envDir, candidate)),
  )).filter((env): env is DetectedEnv => Boolean(env));

  const envs: DetectedEnv[] = [];
  const seenEnvRoots = new Set<string>();
  for (const env of detected.sort((left, right) => compareDetectedEnvs(ctx.configuredPythonPath, left, right))) {
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
