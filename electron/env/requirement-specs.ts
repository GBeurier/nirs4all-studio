/**
 * Version-range checks for the packages Studio requires in a reused Python
 * environment (`REUSABLE_RUNTIME_PACKAGES` in scripts/python-runtime-config.cjs).
 *
 * The TypeScript and Python implementations accept the same small PEP 440
 * subset: comma-separated `==`, `!=`, `>=`, `>`, `<=` and `<` clauses over
 * numeric release segments. A pre-release or development version sorts before
 * its release, and `<V` also excludes pre-releases of `V`. Unknown operators
 * fail closed.
 */

export interface RequirementSpec {
  name: string;
  /** The version specifier without the package name, e.g. `>=1.4.14,<1.5`; empty when any version is accepted. */
  specifier: string;
}

export function parseRequirement(spec: string): RequirementSpec {
  const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(.*)$/.exec(spec);
  if (!match) throw new Error(`Invalid package requirement: ${spec}`);
  return { name: match[1], specifier: match[2].trim() };
}

function versionKey(value: string): { release: number[]; prerelease: boolean } | null {
  const match = /^\s*v?(\d+(?:\.\d+)*)(.*)$/i.exec(value);
  if (!match) return null;
  return {
    release: match[1].split(".").map(Number),
    prerelease: /^[-_.]?(a|b|c|rc|alpha|beta|pre|preview|dev)/i.test(match[2].trim()),
  };
}

function compareReleases(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/** Whether `version` satisfies every clause of `specifier`. */
export function versionSatisfies(version: string, specifier: string): boolean {
  const installed = versionKey(version);
  if (!installed) return false;
  for (const clause of specifier.split(",").map((part) => part.trim()).filter(Boolean)) {
    const match = /^(==|!=|>=|<=|>|<)\s*(.+)$/.exec(clause);
    const bound = match ? versionKey(match[2]) : null;
    if (!match || !bound) return false;
    const release = compareReleases(installed.release, bound.release);
    // Pre-releases sort before the release they precede.
    const ordered = release !== 0 ? release : Number(!installed.prerelease) - Number(!bound.prerelease);
    const satisfied = {
      "==": ordered === 0,
      "!=": ordered !== 0,
      ">=": ordered >= 0,
      ">": ordered > 0,
      "<=": ordered <= 0,
      // `<1.5` excludes 1.5.0rc1 as well as 1.5.
      "<": release < 0,
    }[match[1]];
    if (!satisfied) return false;
  }
  return true;
}

/** Describe why an installed distribution does not satisfy a requirement, or null when it does. */
export function requirementIssue(spec: string, installedVersion: string | null | undefined): string | null {
  const { name, specifier } = parseRequirement(spec);
  if (!installedVersion) return `${name} is missing`;
  return specifier && !versionSatisfies(installedVersion, specifier)
    ? `${name} ${installedVersion} is installed; ${name}${specifier} is required`
    : null;
}

/**
 * Python implementation of {@link requirementIssue}, embedded in interpreter
 * probes. Defines `requirement_name(spec)` and `requirement_issue(spec, installed)`.
 */
export const PYTHON_REQUIREMENT_HELPERS = `import re as _requirement_re
def requirement_name(spec):
    return _requirement_re.match(r"\\s*([A-Za-z0-9][A-Za-z0-9._-]*)", spec).group(1)
def _version_key(value):
    match = _requirement_re.match(r"\\s*v?(\\d+(?:\\.\\d+)*)(.*)$", value, _requirement_re.I)
    if not match:
        return None
    prerelease = bool(_requirement_re.match(r"[-_.]?(a|b|c|rc|alpha|beta|pre|preview|dev)", match.group(2).strip(), _requirement_re.I))
    return [int(part) for part in match.group(1).split(".")], prerelease
def _compare_releases(left, right):
    length = max(len(left), len(right))
    left = left + [0] * (length - len(left))
    right = right + [0] * (length - len(right))
    return (left > right) - (left < right)
def version_satisfies(version, specifier):
    installed = _version_key(version)
    if installed is None:
        return False
    for clause in [part.strip() for part in specifier.split(",") if part.strip()]:
        match = _requirement_re.match(r"(==|!=|>=|<=|>|<)\\s*(.+)$", clause)
        bound = _version_key(match.group(2)) if match else None
        if bound is None:
            return False
        release = _compare_releases(installed[0], bound[0])
        ordered = release if release else int(not installed[1]) - int(not bound[1])
        satisfied = {"==": ordered == 0, "!=": ordered != 0, ">=": ordered >= 0, ">": ordered > 0, "<=": ordered <= 0, "<": release < 0}[match.group(1)]
        if not satisfied:
            return False
    return True
def requirement_issue(spec, installed):
    name = requirement_name(spec)
    specifier = spec.strip()[len(name):].strip()
    if not installed:
        return name + " is missing"
    if specifier and not version_satisfies(installed, specifier):
        return name + " " + installed + " is installed; " + name + specifier + " is required"
    return None
`;
