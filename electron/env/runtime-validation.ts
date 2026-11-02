/** Validate the interpreter that Studio will use before persisting readiness. */
import { execFile } from "node:child_process";
import { getManagedCorePackageNames } from "./env-inspection";
import { loadPythonRuntimeConfig } from "./external-config";
import { parseRequirement, PYTHON_REQUIREMENT_HELPERS } from "./requirement-specs";

const { REQUIRED_METHODS_ABI, REUSABLE_RUNTIME_PACKAGES } = loadPythonRuntimeConfig<{
  REQUIRED_METHODS_ABI: [number, number];
  REUSABLE_RUNTIME_PACKAGES: string[];
}>();

/**
 * Import every required distribution, check the required version ranges, the
 * scientific entrypoints and the native Methods ABI.
 * argv: [distribution names to import, version requirements, required ABI].
 */
export const REQUIRED_RUNTIME_IMPORT_PROBE = `import importlib, importlib.metadata, json, os, sys
${PYTHON_REQUIREMENT_HELPERS}
assert sys.version_info >= (3, 11), "Studio requires Python 3.11 or newer"
os.environ.setdefault("MPLBACKEND", "Agg")
for name in json.loads(sys.argv[1]):
    importlib.metadata.version(name)
    importlib.import_module("n4m" if name == "nirs4all-methods" else name.replace("-", "_"))
for spec in json.loads(sys.argv[2]):
    try:
        installed = importlib.metadata.version(requirement_name(spec))
    except importlib.metadata.PackageNotFoundError:
        installed = None
    issue = requirement_issue(spec, installed)
    assert issue is None, "Unsupported package version: " + str(issue)
from nirs4all import studio_scientific_job_v1, studio_scientific_job_v2
assert callable(studio_scientific_job_v1) and callable(studio_scientific_job_v2), "Scientific plugin entrypoint unavailable"
from n4m import abi_version
methods_abi = abi_version()
required_abi = tuple(json.loads(sys.argv[3]))
assert tuple(methods_abi[:2]) == required_abi, f"Unsupported Methods ABI {methods_abi}: Studio requires ABI {required_abi[0]}.{required_abi[1]}. Install a nirs4all-methods release that provides it in this environment."
`;

interface RuntimeValidationOptions {
  reused?: boolean;
  timeoutMs?: number;
  /** The immutable bundle intentionally removes pip after build qualification. */
  checkDependencies?: boolean;
}

function verifyCommand(pythonPath: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(pythonPath, args, { timeout: timeoutMs, windowsHide: process.platform === "win32" }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Python runtime verification failed: ${String(stderr || stdout || error.message).trim().slice(0, 2000)}`));
      } else resolve();
    });
  });
}

/** Check actual imports and dependency compatibility, even after a cache hit. */
export async function validatePythonRuntime(pythonPath: string, options: RuntimeValidationOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  await verifyCommand(pythonPath, [
    ...(options.reused ? [] : ["-I"]), "-B", "-c", REQUIRED_RUNTIME_IMPORT_PROBE,
    JSON.stringify(options.reused ? REUSABLE_RUNTIME_PACKAGES.map((spec) => parseRequirement(spec).name) : getManagedCorePackageNames()),
    JSON.stringify(REUSABLE_RUNTIME_PACKAGES), JSON.stringify(REQUIRED_METHODS_ABI),
  ], timeoutMs);
  if (options.checkDependencies !== false) {
    await verifyCommand(pythonPath, ["-I", "-B", "-m", "pip", "check"], timeoutMs);
  }
}
