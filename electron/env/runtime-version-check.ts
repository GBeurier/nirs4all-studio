/** Lightweight package metadata check, cached across ordinary app launches. */
import fs from "node:fs";
import path from "node:path";

import { loadPythonRuntimeConfig } from "./external-config";
import { execFileText } from "./process-utils";
import { computeEnvFingerprint } from "./verify-cache";

const { REUSABLE_RUNTIME_PACKAGES } = loadPythonRuntimeConfig<{
  REUSABLE_RUNTIME_PACKAGES: string[];
}>();

export const PACKAGE_VERSION_PROBE = `import importlib.metadata as metadata, json, sys
issues = []
if sys.version_info < (3, 11):
    issues.append("Python 3.11 or newer is required")
for spec in json.loads(sys.argv[1]):
    name, _, required = spec.partition("==")
    try:
        installed = metadata.version(name)
    except metadata.PackageNotFoundError:
        issues.append(name + " is missing")
        continue
    if required and installed != required:
        issues.append(name + " " + installed + " is installed; " + required + " is required")
print(json.dumps(issues))
`;

interface VersionCheckCache {
  key: string;
  issues: string[];
}

/** Cold interpreters on Windows (first launch after an update, antivirus scans) can exceed 10 seconds. */
const PACKAGE_VERSION_PROBE_TIMEOUT_MS = 30_000;

/** Explain package version issues to the user, with the available recovery actions. */
export function describeRuntimePackageIssues(issues: readonly string[]): string {
  return `This Python environment needs the versions required by Studio: ${issues.join("; ")}. Install the required versions below or in Python Environment settings (this can downgrade newer packages), or select Studio's included environment.`;
}

/** Return the package version issues of a reused environment; empty when compatible or unknown. */
export async function checkRuntimePackageVersions(options: {
  pythonPath: string;
  appVersion: string;
  userDataDir: string;
  reused: boolean;
  force?: boolean;
}): Promise<string[]> {
  // The immutable bundled runtime is qualified with the installer.
  if (!options.reused) return [];
  const requirements = REUSABLE_RUNTIME_PACKAGES;
  const fingerprint = computeEnvFingerprint(path.dirname(options.pythonPath), options.pythonPath);
  const key = JSON.stringify([2, options.pythonPath, options.appVersion, requirements, fingerprint]);
  const cachePath = path.join(options.userDataDir, "runtime-package-versions.json");
  let issues: string[] | undefined;
  if (!options.force && fingerprint) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8")) as VersionCheckCache;
      if (cached.key === key && Array.isArray(cached.issues) && cached.issues.every(issue => typeof issue === "string")) {
        issues = cached.issues;
      }
    } catch { /* First launch or update: read package versions once. */ }
  }
  if (!issues) {
    const result = await execFileText(options.pythonPath, [
      "-I", "-B", "-c", PACKAGE_VERSION_PROBE,
      JSON.stringify(requirements),
    ], PACKAGE_VERSION_PROBE_TIMEOUT_MS);
    // Unknown metadata must not disable a healthy host; Rust readiness remains authoritative.
    if (!result) {
      console.warn(`[EnvManager] Package versions of ${options.pythonPath} could not be read; Rust readiness decides`);
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(result.stdout.trim());
      if (!Array.isArray(parsed) || !parsed.every(issue => typeof issue === "string")) {
        throw new Error("Invalid package version response");
      }
      issues = parsed;
    } catch {
      return [];
    }
    try {
      if (fingerprint) {
        fs.mkdirSync(options.userDataDir, { recursive: true });
        fs.writeFileSync(cachePath, JSON.stringify({ key, issues }));
      }
    } catch { /* A read-only settings directory must not prevent startup. */ }
  }
  return issues;
}
