import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getManagedCorePackageNames, getMissingCorePackages, getUnsatisfiedExactPins, inspectPythonPackages, normalizePackageName } from "./env/env-inspection";

describe("pinned recovery runtime readiness", () => {
  it("recognizes installed nirs4all despite its exact version pin and avoids reinstalling it on every launch", () => {
    const names = getManagedCorePackageNames();
    expect(names).toContain("nirs4all");
    expect(names.every(name => !/[<>=!~[\]]/.test(name))).toBe(true);
    const installed = new Set(names.map(normalizePackageName));
    expect(getMissingCorePackages(installed)).toEqual([]);
    installed.delete("nirs4all");
    expect(getMissingCorePackages(installed)).toEqual(["nirs4all"]);
  });
  it("requires the recovery version when an older or newer nirs4all is already installed", () => {
    for (const version of ["0.9.3", "0.11.1", "1.0.3rc1"]) {
      expect(getUnsatisfiedExactPins(new Map([["nirs4all", version]]))).toEqual(["nirs4all==1.0.3"]);
    }
    expect(getUnsatisfiedExactPins(new Map([["nirs4all", "1.0.3"]]))).toEqual([]);
  });
});

// Real metadata resolution: no fake package imports or simulated JSON responses.
describe("Python distribution precedence", () => {
  it.each(["1.0.3", "1.0.1"])("keeps the first sys.path distribution (%s), including normalized aliases", async (firstVersion) => {
    const python = [process.env.NIRS4ALL_TEST_PYTHON, "python3.11", "python3", "python"].find(candidate => {
      if (!candidate) return false;
      try {
        return execFileSync(candidate, ["-c", "import sys; print(sys.version_info >= (3, 11))"], { encoding: "utf8", timeout: 5000 }).trim() === "True";
      } catch {
        return false;
      }
    });
    expect(python, "Python >=3.11 is required to verify interpreter metadata precedence").toBeTruthy();
    const root = mkdtempSync(join(tmpdir(), "studio-metadata-precedence-"));
    try {
      const first = join(root, "first");
      const second = join(root, "second");
      for (const [directory, version, alias] of [
        [first, firstVersion, "Example-Package"],
        [second, firstVersion === "1.0.3" ? "1.0.1" : "1.0.3", "example_package"],
      ]) {
        for (const name of ["nirs4all", alias]) {
          const info = join(directory, `${name.replaceAll("-", "_")}-${version}.dist-info`);
          mkdirSync(info, { recursive: true });
          writeFileSync(join(info, "METADATA"), `Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n`);
        }
      }
      vi.stubEnv("PYTHONPATH", [first, second].join(delimiter));
      const expected = execFileSync(python!, ["-c", "from importlib.metadata import version; print(version('nirs4all'))"], { encoding: "utf8" }).trim();
      const inspected = await inspectPythonPackages(python!);
      expect(expected).toBe(firstVersion);
      expect(inspected?.installedPackages.get("nirs4all")).toBe(expected);
      expect(inspected?.installedPackages.get("example_package")).toBe(expected);
      expect(getUnsatisfiedExactPins(inspected!.installedPackages)).toEqual(firstVersion === "1.0.3" ? [] : ["nirs4all==1.0.3"]);
    } finally {
      vi.unstubAllEnvs();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
