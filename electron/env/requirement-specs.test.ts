import { describe, expect, it } from "vitest";

import { versionSatisfies } from "./requirement-specs";

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
  ["1.0", "~=1.0", false],
  ["2.0.0", "", true],
  // A local build tag (PyTorch CUDA wheels) is the same release.
  ["2.6.0+cu126", ">=2.6.0", true],
  ["3.12.4", "<3.13", true],
  ["3.13.0", "<3.13", false],
];

describe("package requirement ranges", () => {
  it.each(CASES)("%s satisfies '%s': %s", (version, specifier, satisfied) => {
    expect(versionSatisfies(version, specifier)).toBe(satisfied);
  });

  it("refuses unreadable versions", () => {
    expect(versionSatisfies("anything", ">=1")).toBe(false);
    expect(versionSatisfies("anything", "")).toBe(false);
  });
});
