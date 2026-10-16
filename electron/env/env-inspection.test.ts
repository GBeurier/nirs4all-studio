import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
import { getCorePackageIssues, inspectPythonPackages } from "./env-inspection";
afterEach(() => vi.resetAllMocks());

describe("existing Python inventory", () => {
  it("retries a cold timed-out probe without installing packages", async () => {
    mocks.execFile.mockImplementationOnce((_p, _a, options, callback) => {
      expect(options.timeout).toBe(15_000);
      callback(Object.assign(new Error("timed out"), { killed: true }), "");
    }).mockImplementationOnce((_p, _a, options, callback) => {
      expect(options.timeout).toBe(45_000);
      callback(null, JSON.stringify({ version: "3.11.13", installed: { nirs4all: "1.4.8" } }));
    });
    expect((await inspectPythonPackages("python"))?.installedPackages.get("nirs4all")).toBe("1.4.8");
    expect(mocks.execFile).toHaveBeenCalledTimes(2);
  });
  it("reports an inaccessible executable separately from Python version incompatibility", async () => {
    mocks.execFile.mockImplementation((_p, _a, _o, callback) => callback(new Error("EACCES"), ""));
    await expect(inspectPythonPackages("python")).rejects.toThrow("EACCES");
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
  });
  it("distinguishes absent dependencies from an installed SDK requiring an in-place update", () => {
    expect(getCorePackageIssues(new Map([["nirs4all", "1.4.7"], ["duckdb", "1.5.5"]]))).toEqual([
      { name: "nirs4all", installedVersion: "1.4.7", requiredVersion: "1.4.10" },
      { name: "nirs4all-io", installedVersion: null, requiredVersion: "0.2.10" },
      { name: "nirs4all-methods", installedVersion: null, requiredVersion: "1.3.4" },
      { name: "nirs4all-formats", installedVersion: null, requiredVersion: null },
    ]);
  });
  it("reports a newer incompatible Methods binding as an in-place package change", () => {
    expect(getCorePackageIssues(new Map([["nirs4all_methods", "1.3.6"]]))).toContainEqual({
      name: "nirs4all-methods", installedVersion: "1.3.6", requiredVersion: "1.3.4",
    });
  });
});
