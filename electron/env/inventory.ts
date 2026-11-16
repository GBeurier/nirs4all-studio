/**
 * Package inventory of one Python interpreter and its evaluation against the
 * catalogue.
 *
 * The inventory is one subprocess that reads distribution metadata only: no
 * package is imported, so it is fast and cannot be broken by a package's import
 * side effects. `evaluateInventory` is pure.
 */

import { execFile } from "node:child_process";

import type {
  PythonEnvReport,
  RecommendedPackageState,
  RequiredPackageState,
} from "../../src/types/pythonEnvironment";
import { normalizePackageName, RECOMMENDED_PACKAGES, REQUIRED_PACKAGES } from "./catalogue";
import { getEnvRootForPythonPath } from "./python-discovery";
import { versionSatisfies } from "./requirement-specs";
import { getEnvKind } from "./runtime-paths";

export interface PythonInventory {
  pythonVersion: string;
  /** Normalised distribution name to installed version. */
  distributions: Record<string, string>;
  /** Normalised names of editable (development) installs. */
  editable: string[];
  /** PEP 668: the interpreter's packages are owned by the operating system. */
  externallyManaged: boolean;
  /** Directory where pure-Python packages are installed. */
  purelib: string;
  purelibWritable: boolean;
}

/**
 * ASCII-only JSON on stdout: isolated mode ignores PYTHONIOENCODING, and paths
 * may not be representable in the console code page on Windows.
 */
const INVENTORY_PROBE = `import json, os, re, sys, sysconfig
from importlib import metadata
distributions = {}
editable = []
for dist in metadata.distributions():
    try:
        name = dist.metadata.get("Name")
        version = dist.version
    except Exception:
        continue
    if not name or not version:
        continue
    key = re.sub(r"[-_.]+", "-", name).lower()
    if key in distributions:
        continue
    distributions[key] = version
    try:
        direct_url = dist.read_text("direct_url.json")
        if direct_url and json.loads(direct_url).get("dir_info", {}).get("editable"):
            editable.append(key)
    except Exception:
        pass
purelib = sysconfig.get_path("purelib")
print(json.dumps({
    "pythonVersion": "%d.%d.%d" % sys.version_info[:3],
    "distributions": distributions,
    "editable": editable,
    "externallyManaged": sys.prefix == sys.base_prefix and os.path.isfile(os.path.join(sysconfig.get_path("stdlib"), "EXTERNALLY-MANAGED")),
    "purelib": purelib,
    "purelibWritable": os.access(purelib, os.W_OK),
}))
`;

/** A cold interpreter (antivirus scan after an update) gets one longer second attempt. */
const INVENTORY_TIMEOUTS_MS = [15_000, 45_000];

function isInventory(value: unknown): value is PythonInventory {
  const inventory = value as Partial<PythonInventory> | null;
  return !!inventory && typeof inventory === "object"
    && typeof inventory.pythonVersion === "string"
    && !!inventory.distributions && typeof inventory.distributions === "object"
    && Object.values(inventory.distributions).every((version) => typeof version === "string")
    && Array.isArray(inventory.editable) && inventory.editable.every((name) => typeof name === "string")
    && typeof inventory.externallyManaged === "boolean"
    && typeof inventory.purelib === "string"
    && typeof inventory.purelibWritable === "boolean";
}

function runInventoryProbe(pythonPath: string, timeout: number): Promise<{ stdout: string } | { timedOut: boolean; message: string }> {
  return new Promise((resolve) => {
    execFile(
      pythonPath,
      ["-I", "-B", "-c", INVENTORY_PROBE],
      { timeout, windowsHide: process.platform === "win32", maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => resolve(error ? { timedOut: error.killed === true, message: error.message } : { stdout }),
    );
  });
}

/**
 * List the distributions of an interpreter. Rejects with a user-facing reason
 * when the path is not a usable Python 3.11+ interpreter.
 */
export async function takeInventory(pythonPath: string): Promise<PythonInventory> {
  let failure = { timedOut: false, message: "" };
  for (const timeout of INVENTORY_TIMEOUTS_MS) {
    const result = await runInventoryProbe(pythonPath, timeout);
    if ("stdout" in result) {
      let inventory: unknown;
      try { inventory = JSON.parse(result.stdout.trim().split(/\r?\n/).pop() ?? ""); }
      catch { inventory = null; }
      if (!isInventory(inventory)) {
        throw new Error("Python returned an unreadable package listing. The environment has not been changed.");
      }
      const [major, minor] = inventory.pythonVersion.split(".").map(Number);
      if (major !== 3 || minor < 11) {
        throw new Error(`Python 3.11 or later is required; this interpreter is Python ${inventory.pythonVersion}.`);
      }
      return inventory;
    }
    failure = result;
    if (!result.timedOut) break;
  }
  throw new Error(failure.timedOut
    ? "Python did not answer in time. The environment has not been changed; retry when the disk is less busy."
    : `This file could not be run as a Python 3.11+ interpreter: ${failure.message.split("\n")[0]}`);
}

/** Whether `installed` is at least `version` (a plain release such as `2.6.0`). */
function isAtLeast(installed: string, version: string): boolean {
  return versionSatisfies(installed, `>=${version}`);
}

/** Describe an interpreter from its inventory, exactly as the renderer contract defines. */
export function evaluateInventory(pythonPath: string, inventory: PythonInventory, studioEnvDir: string): PythonEnvReport {
  const editable = new Set(inventory.editable);
  const installedVersion = (name: string): string | null => inventory.distributions[normalizePackageName(name)] ?? null;

  const required = REQUIRED_PACKAGES.map((spec): RequiredPackageState => {
    const installed = installedVersion(spec.name);
    const status = !installed
      ? "missing"
      : !spec.range || versionSatisfies(installed, spec.range)
        ? "ok"
        // Studio never modifies an editable install, so it cannot bring it into range.
        : editable.has(normalizePackageName(spec.name)) ? "editable" : "out_of_range";
    return { name: spec.name, installedVersion: installed, requiredRange: spec.range, targetVersion: spec.install, status };
  });

  const recommended = RECOMMENDED_PACKAGES.map((spec): RecommendedPackageState => {
    const installed = installedVersion(spec.name);
    const status = spec.python && !versionSatisfies(inventory.pythonVersion, spec.python)
      ? "unsupported_python"
      : !installed ? "missing" : isAtLeast(installed, spec.recommended) ? "ok" : "older";
    return {
      name: spec.name,
      installedVersion: installed,
      minimum: spec.min,
      recommendedVersion: spec.recommended,
      belowMinimum: installed !== null && !versionSatisfies(installed, spec.min),
      category: spec.category,
      description: spec.description,
      defaultInstall: spec.defaultInstall,
      status,
    };
  });

  const envRoot = getEnvRootForPythonPath(pythonPath);
  return {
    pythonPath,
    envRoot,
    kind: getEnvKind(studioEnvDir, envRoot),
    pythonVersion: inventory.pythonVersion,
    writable: inventory.purelibWritable && !inventory.externallyManaged,
    required,
    recommended,
    usable: required.every((item) => item.status === "ok"),
    outdatedRecommendedCount: recommended.filter((item) => item.status === "older").length,
  };
}

/** Normalised names of the required packages that are editable installs. */
export function editableRequiredPackages(inventory: PythonInventory): Set<string> {
  const required = new Set(REQUIRED_PACKAGES.map((spec) => normalizePackageName(spec.name)));
  return new Set(inventory.editable.filter((name) => required.has(name)));
}
