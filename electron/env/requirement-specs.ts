/**
 * Version-range checks against the package catalogue (recommended-config.json).
 *
 * Accepts a small PEP 440 subset: comma-separated `==`, `!=`, `>=`, `>`, `<=`
 * and `<` clauses over numeric release segments. A pre-release or development
 * version sorts before its release, and `<V` also excludes pre-releases of
 * `V`. Unknown operators fail closed. An empty specifier accepts any version.
 */

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
