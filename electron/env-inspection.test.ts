import { describe, expect, it } from "vitest";
import { getManagedCorePackageNames, getMissingCorePackages, getUnsatisfiedExactPins, normalizePackageName } from "./env/env-inspection";

describe("pinned recovery runtime readiness", () => {
  it("recognizes installed nirs4all despite its exact version pin and avoids reinstalling it on every launch", () => {
    const names = getManagedCorePackageNames();
    expect(names).toContain("nirs4all");
    expect(names.every(name => !/[<>=!~\[\]]/.test(name))).toBe(true);
    const installed = new Set(names.map(normalizePackageName));
    expect(getMissingCorePackages(installed)).toEqual([]);
    installed.delete("nirs4all");
    expect(getMissingCorePackages(installed)).toEqual(["nirs4all"]);
  });
  it("requires the recovery version when an older or newer nirs4all is already installed", () => {
    for (const version of ["0.9.3", "0.11.1", "0.11.0rc1"]) {
      expect(getUnsatisfiedExactPins(new Map([["nirs4all", version]]))).toEqual(["nirs4all==0.11.0"]);
    }
    expect(getUnsatisfiedExactPins(new Map([["nirs4all", "0.11.0"]]))).toEqual([]);
  });
});
