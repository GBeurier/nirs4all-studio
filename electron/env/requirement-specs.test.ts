import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { parseRequirement, PYTHON_REQUIREMENT_HELPERS, requirementIssue, versionSatisfies } from "./requirement-specs";

const python = [process.env.PYTHON, "python3.11", "python3", "python"].filter(Boolean).find((candidate) => (
  spawnSync(candidate!, ["-I", "-c", "import sys; assert sys.version_info >= (3, 11)"], { timeout: 10_000, windowsHide: true }).status === 0
));

// [version, specifier, satisfied]
const CASES: Array<[string, string, boolean]> = [
  ["1.4.14", ">=1.4.14,<1.5", true],
  ["1.4.15", ">=1.4.14,<1.5", true],
  ["1.4.99.post1", ">=1.4.14,<1.5", true],
  ["1.4.13", ">=1.4.14,<1.5", false],
  ["1.4.14rc1", ">=1.4.14,<1.5", false],
  ["1.4.14.dev0", ">=1.4.14,<1.5", false],
  ["1.5", ">=1.4.14,<1.5", false],
  ["1.5.0", ">=1.4.14,<1.5", false],
  ["1.5.0rc1", ">=1.4.14,<1.5", false],
  ["0.2.13", ">=0.2.11,<0.3", true],
  ["0.3.0", ">=0.2.11,<0.3", false],
  ["1.3.12", ">=1.3.9,<2", true],
  ["2.0.0", ">=1.3.9,<2", false],
  ["1.4.14", "==1.4.14", true],
  ["1.4.14.0", "==1.4.14", true],
  ["1.4.15", "==1.4.14", false],
  ["1.4.15", "!=1.4.14", true],
  ["1.4.14", ">1.4.14", false],
  ["1.4.14", "<=1.4.14", true],
  ["anything", "", false],
  ["1.0", "~=1.0", false],
  ["2.0.0", "", true],
];

describe("package requirement ranges", () => {
  it("parses names and specifiers", () => {
    expect(parseRequirement("nirs4all>=1.4.14,<1.5")).toEqual({ name: "nirs4all", specifier: ">=1.4.14,<1.5" });
    expect(parseRequirement("nirs4all-formats")).toEqual({ name: "nirs4all-formats", specifier: "" });
  });

  it.each(CASES.filter(([version]) => version !== "anything"))("%s satisfies '%s': %s", (version, specifier, satisfied) => {
    expect(versionSatisfies(version, specifier)).toBe(satisfied);
  });

  it("refuses unreadable versions and describes missing or out-of-range packages", () => {
    expect(versionSatisfies("anything", ">=1")).toBe(false);
    expect(requirementIssue("nirs4all>=1.4.14,<1.5", "1.4.15")).toBeNull();
    expect(requirementIssue("nirs4all-io>=0.2.11,<0.3", null)).toBe("nirs4all-io is missing");
    expect(requirementIssue("nirs4all>=1.4.14,<1.5", "1.4.13")).toBe("nirs4all 1.4.13 is installed; nirs4all>=1.4.14,<1.5 is required");
    expect(requirementIssue("nirs4all-formats", "2.0.0")).toBeNull();
  });

  it.skipIf(!python)("matches the Python implementation used by interpreter probes", () => {
    const specs = CASES.map(([version, specifier]) => [version, `nirs4all${specifier}`]);
    const script = `${PYTHON_REQUIREMENT_HELPERS}
import json, sys
print(json.dumps([requirement_issue(spec, version) for version, spec in json.loads(sys.argv[1])]))
`;
    const result = spawnSync(python!, ["-I", "-c", script, JSON.stringify(specs)], { encoding: "utf8", timeout: 10_000 });
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual(specs.map(([version, spec]) => requirementIssue(spec, version)));
  });
});
