/**
 * Persistent verify-cache primitives for the managed Python environment.
 *
 * The on-disk cache lets ensureBackendPackages() skip spawning Python entirely
 * when the env fingerprint matches a previously fully-verified state. These
 * helpers are pure filesystem IO + fingerprinting; EnvManager owns when to read,
 * write, and trust the entry.
 */

import fs from "node:fs";
import path from "node:path";

import { getEnvRootForPythonPath } from "./python-discovery";
import { getSitePackagesForPythonPath } from "./runtime-paths";

export const VERIFY_CACHE_FILE = "verify-cache.json";

export interface VerifyCacheEntry {
  pythonPath: string;
  appVersion: string;
  fingerprint: string;
  verifiedAt: number;
}

/**
 * Compute a fingerprint for a Python environment, used as the cache key suffix.
 * Returns null when no reliable fingerprint can be built (e.g. a user-provided
 * custom env without a recognisable layout) — callers MUST treat this as
 * "do not cache".
 */
export function computeEnvFingerprint(envDir: string, pythonPath: string): string | null {
  const parts: string[] = [];

  // Derive env root from python executable location.
  const envRoot = getEnvRootForPythonPath(pythonPath);

  const stat = (p: string): string | null => {
    try {
      const s = fs.statSync(p);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return null;
    }
  };

  // build_info.json (managed env marker)
  const buildInfo = stat(path.join(envDir, "build_info.json"));
  if (buildInfo) parts.push(`build:${buildInfo}`);

  // pyvenv.cfg
  const pyvenvCfg = stat(path.join(envRoot, "pyvenv.cfg"));
  if (pyvenvCfg) parts.push(`pyvenv:${pyvenvCfg}`);

  // site-packages directory mtime
  const sitePackages = getSitePackagesForPythonPath(pythonPath);
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

/** Read the persisted verify-cache entry, or null when absent/invalid. */
export function readVerifyCache(userDataDir: string): VerifyCacheEntry | null {
  try {
    const p = path.join(userDataDir, VERIFY_CACHE_FILE);
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, "utf-8")) as VerifyCacheEntry;
    if (!data.pythonPath || !data.appVersion || !data.fingerprint) return null;
    return data;
  } catch {
    return null;
  }
}

/** Persist a verify-cache entry. Failures are logged and swallowed. */
export function writeVerifyCache(userDataDir: string, entry: VerifyCacheEntry): void {
  try {
    const p = path.join(userDataDir, VERIFY_CACHE_FILE);
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(entry, null, 2));
  } catch (error) {
    console.warn(`[EnvManager] Failed to write verify cache: ${error}`);
  }
}
