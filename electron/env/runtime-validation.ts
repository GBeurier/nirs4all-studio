/** Validate the interpreter that Studio will use before persisting readiness. */
import { execFile } from "node:child_process";
import { getManagedCorePackageNames } from "./env-inspection";
import { loadPythonRuntimeConfig } from "./external-config";

const { PLUGIN_DISTRIBUTION_VERSION } = loadPythonRuntimeConfig<{ PLUGIN_DISTRIBUTION_VERSION: string }>();

export const REQUIRED_RUNTIME_IMPORT_PROBE = `import importlib, importlib.metadata, json, os, sys
assert sys.version_info >= (3, 11), "Studio requires Python 3.11 or newer"
os.environ.setdefault("MPLBACKEND", "Agg")
for name in json.loads(sys.argv[1]):
    importlib.metadata.version(name)
    importlib.import_module(name.replace("-", "_"))
assert importlib.metadata.version("nirs4all") == sys.argv[2], "Unsupported nirs4all plugin version"
from nirs4all import studio_scientific_job_v1, studio_scientific_job_v2
assert callable(studio_scientific_job_v1) and callable(studio_scientific_job_v2), "Scientific plugin entrypoint unavailable"
`;

interface RuntimeValidationOptions {
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
    "-I", "-B", "-c", REQUIRED_RUNTIME_IMPORT_PROBE,
    JSON.stringify(getManagedCorePackageNames()), PLUGIN_DISTRIBUTION_VERSION,
  ], timeoutMs);
  if (options.checkDependencies !== false) {
    await verifyCommand(pythonPath, ["-I", "-B", "-m", "pip", "check"], timeoutMs);
  }
}
