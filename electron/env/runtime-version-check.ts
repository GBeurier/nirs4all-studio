/** Lightweight package metadata check, cached across ordinary app launches. */
import fs from "node:fs";
import path from "node:path";

import { loadPythonRuntimeConfig } from "./external-config";
import { execFileText } from "./process-utils";
import { PYTHON_REQUIREMENT_HELPERS } from "./requirement-specs";
import { computeEnvFingerprint } from "./verify-cache";

const { REUSABLE_RUNTIME_PACKAGES } = loadPythonRuntimeConfig<{
  REUSABLE_RUNTIME_PACKAGES: string[];
}>();

/** Report range issues and the installed versions of the required distributions. */
export const PACKAGE_VERSION_PROBE = `import importlib.metadata as metadata, json, sys
${PYTHON_REQUIREMENT_HELPERS}
issues = []
versions = {}
if sys.version_info < (3, 11):
    issues.append("Python 3.11 or newer is required")
for spec in json.loads(sys.argv[1]):
    name = requirement_name(spec)
    try:
        installed = metadata.version(name)
    except metadata.PackageNotFoundError:
        installed = None
    versions[name] = installed
    issue = requirement_issue(spec, installed)
    if issue:
        issues.append(issue)
print(json.dumps({"issues": issues, "versions": versions}))
`;

export interface RuntimePackageCheck {
  /** Unsatisfied requirements; empty when compatible or when the versions could not be read. */
  issues: string[];
  /** Installed versions of the required distributions (null when missing); empty when not probed. */
  versions: Record<string, string | null>;
}

interface VersionCheckCache extends RuntimePackageCheck {
  key: string;
}

function isRuntimePackageCheck(value: unknown): value is RuntimePackageCheck {
  const check = value as Partial<RuntimePackageCheck> | null;
  return !!check && Array.isArray(check.issues) && check.issues.every(issue => typeof issue === "string")
    && !!check.versions && typeof check.versions === "object" && !Array.isArray(check.versions)
    && Object.values(check.versions).every(version => version === null || typeof version === "string");
}

/** Cold interpreters on Windows (first launch after an update, antivirus scans) can exceed 10 seconds. */
const PACKAGE_VERSION_PROBE_TIMEOUT_MS = 30_000;

/** Explain package version issues to the user, with the available recovery actions. */
export function describeRuntimePackageIssues(issues: readonly string[]): string {
  return `This Python environment needs the versions required by Studio: ${issues.join("; ")}. Install the required versions below or in Python Environment settings (this can downgrade newer packages), or select Studio's included environment.`;
}

/** Check the required package ranges of a reused environment; no issues when compatible or unknown. */
export async function checkRuntimePackageVersions(options: {
  pythonPath: string;
  appVersion: string;
  userDataDir: string;
  reused: boolean;
  force?: boolean;
}): Promise<RuntimePackageCheck> {
  // The immutable bundled runtime is qualified with the installer.
  if (!options.reused) return { issues: [], versions: {} };
  const requirements = REUSABLE_RUNTIME_PACKAGES;
  const fingerprint = computeEnvFingerprint(path.dirname(options.pythonPath), options.pythonPath);
  const key = JSON.stringify([3, options.pythonPath, options.appVersion, requirements, fingerprint]);
  const cachePath = path.join(options.userDataDir, "runtime-package-versions.json");
  if (!options.force && fingerprint) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8")) as VersionCheckCache;
      if (cached.key === key && isRuntimePackageCheck(cached)) {
        return { issues: cached.issues, versions: cached.versions };
      }
    } catch { /* First launch or update: read package versions once. */ }
  }
  const result = await execFileText(options.pythonPath, [
    "-I", "-B", "-c", PACKAGE_VERSION_PROBE,
    JSON.stringify(requirements),
  ], PACKAGE_VERSION_PROBE_TIMEOUT_MS);
  // Unknown metadata must not disable a healthy host; Rust readiness remains authoritative.
  let check: RuntimePackageCheck;
  try {
    if (!result) throw new Error("no answer");
    const parsed: unknown = JSON.parse(result.stdout.trim());
    if (!isRuntimePackageCheck(parsed)) throw new Error("Invalid package version response");
    check = { issues: parsed.issues, versions: parsed.versions };
  } catch {
    console.warn(`[EnvManager] Package versions of ${options.pythonPath} could not be read; Rust readiness decides`);
    return { issues: [], versions: {} };
  }
  try {
    if (fingerprint) {
      fs.mkdirSync(options.userDataDir, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify({ key, ...check }));
    }
  } catch { /* A read-only settings directory must not prevent startup. */ }
  return check;
}
