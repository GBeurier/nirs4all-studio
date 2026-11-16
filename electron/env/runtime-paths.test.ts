import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getEnvKind, getStandalonePythonPath, getStudioEnvDir, getVenvPythonPath } from "./runtime-paths";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("environment layout", () => {
  it("places Studio's environment and its runtime under the data directory", () => {
    const studioEnvDir = getStudioEnvDir(path.join("data", "studio"));
    expect(studioEnvDir).toBe(path.join("data", "studio", "python-env"));
    expect(getVenvPythonPath(studioEnvDir)).toBe(process.platform === "win32"
      ? path.join(studioEnvDir, "venv", "Scripts", "python.exe")
      : path.join(studioEnvDir, "venv", "bin", "python"));
    expect(getStandalonePythonPath(studioEnvDir)).toBe(process.platform === "win32"
      ? path.join(studioEnvDir, "python", "python.exe")
      : path.join(studioEnvDir, "python", "bin", "python3"));
  });

  it("classifies an environment root by ownership first, then by layout", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-env-kind-"));
    roots.push(root);
    const studioEnvDir = path.join(root, "user-data", "python-env");
    const conda = path.join(root, "conda");
    const venv = path.join(root, "venv");
    const system = path.join(root, "system");
    fs.mkdirSync(path.join(conda, "conda-meta"), { recursive: true });
    fs.mkdirSync(venv);
    fs.writeFileSync(path.join(venv, "pyvenv.cfg"), "");
    fs.mkdirSync(system);

    expect(getEnvKind(studioEnvDir, path.join(studioEnvDir, "venv"))).toBe("studio");
    expect(getEnvKind(studioEnvDir, conda)).toBe("conda");
    expect(getEnvKind(studioEnvDir, venv)).toBe("venv");
    expect(getEnvKind(studioEnvDir, system)).toBe("system");
    // A sibling whose name merely starts with the same prefix is not Studio's.
    expect(getEnvKind(studioEnvDir, `${studioEnvDir}-backup`)).toBe("system");
  });
});
