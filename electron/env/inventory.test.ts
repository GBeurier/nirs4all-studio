// @vitest-environment node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { REQUIRED_PACKAGES } from "./catalogue";
import { editableRequiredPackages, evaluateInventory, takeInventory } from "./inventory";
import type { PythonInventory } from "./inventory";

const STUDIO_ENV_DIR = path.join(os.tmpdir(), "studio-user-data", "python-env");
const PYTHON_PATH = path.join(os.tmpdir(), "inventory-test-env", "bin", "python");

/** An environment holding the exact required cohort. */
function inventory(overrides: Partial<PythonInventory> = {}): PythonInventory {
  return {
    pythonVersion: "3.11.13",
    distributions: Object.fromEntries(REQUIRED_PACKAGES.map((spec) => [spec.name, spec.install])),
    editable: [],
    externallyManaged: false,
    purelib: path.join(os.tmpdir(), "inventory-test-env", "lib", "python3.11", "site-packages"),
    purelibWritable: true,
    ...overrides,
  };
}

function withPackages(packages: Record<string, string | undefined>, overrides: Partial<PythonInventory> = {}): PythonInventory {
  const distributions: Record<string, string> = { ...inventory().distributions };
  for (const [name, version] of Object.entries(packages)) {
    if (version === undefined) delete distributions[name];
    else distributions[name] = version;
  }
  return inventory({ distributions, ...overrides });
}

function evaluate(value: PythonInventory) {
  return evaluateInventory(PYTHON_PATH, value, STUDIO_ENV_DIR);
}

describe("inventory evaluation", () => {
  it("reports an environment with the required cohort as usable", () => {
    const report = evaluate(inventory());
    expect(report).toMatchObject({
      pythonPath: PYTHON_PATH,
      envRoot: path.join(os.tmpdir(), "inventory-test-env"),
      kind: "system",
      pythonVersion: "3.11.13",
      writable: true,
      usable: true,
      outdatedRecommendedCount: 0,
    });
    expect(report.required.map((item) => item.status)).toEqual(REQUIRED_PACKAGES.map(() => "ok"));
    expect(report.required[0]).toEqual({
      name: "nirs4all", installedVersion: "1.4.16", requiredRange: ">=1.4.16,<1.5", targetVersion: "1.4.16", status: "ok",
    });
    expect(report.recommended.every((item) => item.status === "missing" || item.status === "unsupported_python")).toBe(true);
  });

  it("distinguishes missing, out-of-range and editable required packages", () => {
    const report = evaluate(withPackages({ "nirs4all-core": undefined, "nirs4all-io": "0.2.9", nirs4all: "1.5.0.dev0" }, { editable: ["nirs4all"] }));
    const status = Object.fromEntries(report.required.map((item) => [item.name, item.status]));
    expect(status).toMatchObject({
      nirs4all: "editable",
      "nirs4all-core": "missing",
      "nirs4all-io": "out_of_range",
      "nirs4all-methods": "ok",
    });
    expect(report.usable).toBe(false);
    expect(report.required.find((item) => item.name === "nirs4all-core")?.installedVersion).toBeNull();
  });

  it("accepts an editable install that is within the required range, and any version without a range", () => {
    const value = withPackages({ nirs4all: "1.4.17", "dag-ml": "9.9.9" }, { editable: ["nirs4all", "requests"] });
    const report = evaluate(value);
    expect(report.usable).toBe(true);
    expect(report.required.find((item) => item.name === "nirs4all")?.status).toBe("ok");
    expect([...editableRequiredPackages(value)]).toEqual(["nirs4all"]);
  });

  it("matches distribution names regardless of their spelling", () => {
    const report = evaluate(withPackages({ "umap-learn": "0.5.7", pypdf2: "3.0.1" }));
    expect(report.recommended.find((item) => item.name === "umap-learn")?.status).toBe("ok");
    expect(report.recommended.find((item) => item.name === "PyPDF2")).toMatchObject({ installedVersion: "3.0.1", status: "ok" });
  });

  it("flags recommended packages that are older than recommended or below the supported minimum", () => {
    const report = evaluate(withPackages({ torch: "2.5.1", shap: "0.40.0", xgboost: "3.1.0", lightgbm: "4.6.0" }));
    const byName = Object.fromEntries(report.recommended.map((item) => [item.name, item]));
    expect(byName.torch).toMatchObject({
      installedVersion: "2.5.1", minimum: ">=2.1.0", recommendedVersion: "2.6.0",
      status: "older", belowMinimum: false, defaultInstall: true, category: "deep_learning",
    });
    expect(byName.shap).toMatchObject({ status: "older", belowMinimum: true });
    expect(byName.xgboost).toMatchObject({ status: "ok", belowMinimum: false });
    expect(byName.lightgbm).toMatchObject({ status: "ok", belowMinimum: false });
    expect(byName.catboost).toMatchObject({ installedVersion: null, status: "missing", belowMinimum: false });
    expect(report.outdatedRecommendedCount).toBe(2);
    // Recommended packages never affect usability.
    expect(report.usable).toBe(true);
  });

  it("marks packages whose recommended release does not support the interpreter's Python", () => {
    const supported = evaluate(inventory({ pythonVersion: "3.12.4" }));
    const unsupported = evaluate(withPackages({ autogluon: "1.1.0" }, { pythonVersion: "3.13.1" }));
    expect(supported.recommended.find((item) => item.name === "autogluon")?.status).toBe("missing");
    expect(unsupported.recommended.find((item) => item.name === "autogluon")?.status).toBe("unsupported_python");
    expect(unsupported.outdatedRecommendedCount).toBe(0);
  });

  it("is not writable when the package directory is read-only or owned by the operating system", () => {
    expect(evaluate(inventory({ purelibWritable: false })).writable).toBe(false);
    expect(evaluate(inventory({ externallyManaged: true })).writable).toBe(false);
  });

  it("classifies the environment inside Studio's data directory as Studio's own", () => {
    const pythonPath = path.join(STUDIO_ENV_DIR, "venv", "bin", "python");
    expect(evaluateInventory(pythonPath, inventory(), STUDIO_ENV_DIR)).toMatchObject({
      kind: "studio",
      envRoot: path.join(STUDIO_ENV_DIR, "venv"),
    });
  });
});

const python311 = [process.env.PYTHON, "python3.11", "python3.12", "python3.13", "python3", "python"]
  .filter((candidate): candidate is string => Boolean(candidate))
  .find((candidate) => spawnSync(candidate, ["-I", "-c", "import sys; assert sys.version_info >= (3, 11)"], { timeout: 10_000, windowsHide: true }).status === 0);

describe("package inventory subprocess", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it.skipIf(!python311)("lists distributions, editable installs and the package directory without importing anything", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-inventory-"));
    roots.push(root);
    const venv = path.join(root, "venv");
    expect(spawnSync(python311!, ["-m", "venv", "--without-pip", venv], { timeout: 60_000 }).status).toBe(0);
    const pythonPath = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
    const purelib = spawnSync(pythonPath, ["-I", "-c", "import sysconfig; print(sysconfig.get_path('purelib'))"], { encoding: "utf8" }).stdout.trim();
    const addDistribution = (name: string, version: string, files: Record<string, string> = {}) => {
      const directory = path.join(purelib, `${name.replace(/-/g, "_")}-${version}.dist-info`);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, "METADATA"), `Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n`);
      for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, file), content);
    };
    addDistribution("NIRS4ALL", "1.5.0.dev0", { "direct_url.json": JSON.stringify({ url: "file:///src/nirs4all", dir_info: { editable: true } }) });
    addDistribution("nirs4all-io", "0.3.1", { "direct_url.json": JSON.stringify({ url: "https://example.test/io.whl", archive_info: {} }) });
    addDistribution("Umap_Learn", "0.5.7");
    // A package that fails on import must not disturb a metadata-only listing.
    fs.writeFileSync(path.join(purelib, "nirs4all.py"), "raise RuntimeError('imported')\n");

    const result = await takeInventory(pythonPath);

    expect(result.pythonVersion).toMatch(/^3\.1[1-9]\.\d+$/);
    expect(result.distributions).toEqual({ nirs4all: "1.5.0.dev0", "nirs4all-io": "0.3.1", "umap-learn": "0.5.7" });
    expect(result.editable).toEqual(["nirs4all"]);
    expect(result.externallyManaged).toBe(false);
    expect(fs.realpathSync(result.purelib)).toBe(fs.realpathSync(purelib));
    expect(result.purelibWritable).toBe(true);
    expect(evaluateInventory(pythonPath, result, STUDIO_ENV_DIR)).toMatchObject({ kind: "venv", usable: false, writable: true });
  });

  it("explains a path that is not a Python interpreter", async () => {
    await expect(takeInventory(path.join(os.tmpdir(), "no-such-python"))).rejects.toThrow("could not be run as a Python 3.11+ interpreter");
  });

  // A shell script stands in for the interpreter; Windows cannot execute one directly.
  it.skipIf(process.platform === "win32")("refuses an interpreter older than Python 3.11", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-old-python-"));
    roots.push(root);
    const launcher = path.join(root, "python");
    const answer = JSON.stringify({ pythonVersion: "3.10.12", distributions: {}, editable: [], externallyManaged: false, purelib: "/x", purelibWritable: true });
    fs.writeFileSync(launcher, `#!/bin/sh\necho '${answer}'\n`, { mode: 0o755 });
    await expect(takeInventory(launcher)).rejects.toThrow("Python 3.11 or later is required; this interpreter is Python 3.10.12.");
  });
});
