import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { validatePythonRuntime } from "./env/runtime-validation";

const python = [process.env.PYTHON, "python3.11", "python3", "python"].filter(Boolean).find((candidate) => (
  spawnSync(candidate!, ["-I", "-c", "import ensurepip, sys; assert sys.version_info >= (3, 11)"], {
    encoding: "utf8", timeout: 10_000, windowsHide: true,
  }).status === 0
));

// Real Python and pip, local metadata/modules only: no wheel downloads or network.
// These fixtures deliberately separate valid metadata from importable modules.
describe.skipIf(!python)("managed runtime validation with real Python", () => {
  let root: string;
  let executable: string;
  let sitePackages: string;
  const versions: Record<string, string> = {
    nirs4all: "1.1.5", duckdb: "1.5.5", pyarrow: "25.0.1", shap: "0.47.1", matplotlib: "3.10.1",
  };
  const metadata = (name: string, extra = "") => `Metadata-Version: 2.1\nName: ${name}\nVersion: ${versions[name]}\n${extra}`;
  const metadataPath = (name: string) => path.join(sitePackages, `${name}-${versions[name]}.dist-info`, "METADATA");

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-runtime-validation-"));
    execFileSync(python!, ["-I", "-m", "venv", root], { timeout: 30_000, windowsHide: true });
    executable = path.join(root, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    sitePackages = execFileSync(executable, ["-I", "-c", "import sysconfig; print(sysconfig.get_path('purelib'))"], { encoding: "utf8" }).trim();
  });

  beforeEach(() => {
    for (const name of Object.keys(versions)) {
      fs.mkdirSync(path.dirname(metadataPath(name)), { recursive: true });
      fs.writeFileSync(metadataPath(name), metadata(name));
      fs.writeFileSync(path.join(sitePackages, `${name}.py`), name === "nirs4all"
        ? "def studio_scientific_job_v1(): pass\ndef studio_scientific_job_v2(): pass\n" : "");
    }
  });

  afterAll(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

  it("accepts importable packages with coherent installed dependencies", async () => {
    await expect(validatePythonRuntime(executable)).resolves.toBeUndefined();
  });

  it("refuses missing package code even when its installed metadata remains", async () => {
    fs.rmSync(path.join(sitePackages, "shap.py"));
    await expect(validatePythonRuntime(executable)).rejects.toThrow(/No module named 'shap'/);
  });

  it("refuses a package whose compiled dependency cannot be loaded", async () => {
    fs.writeFileSync(path.join(sitePackages, "pyarrow.py"), "raise ImportError('native library unavailable')\n");
    await expect(validatePythonRuntime(executable)).rejects.toThrow("native library unavailable");
  });

  it("refuses installed but incompatible transitive requirements using real pip check", async () => {
    fs.writeFileSync(metadataPath("shap"), metadata("shap", "Requires-Dist: duckdb>=99\n"));
    await expect(validatePythonRuntime(executable)).rejects.toThrow(/duckdb>=99/);
  });

  it("refuses a missing scientific entrypoint", async () => {
    fs.writeFileSync(path.join(sitePackages, "nirs4all.py"), "def studio_scientific_job_v1(): pass\n");
    await expect(validatePythonRuntime(executable)).rejects.toThrow("studio_scientific_job_v2");
  });
});
