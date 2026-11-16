// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./process-utils", () => ({ execFileText: vi.fn() }));
import { execFileText } from "./process-utils";
import {
  addPythonCandidate,
  canonicalPythonPath,
  gatherPythonCandidates,
  normalizePythonPath,
  samePythonPath,
} from "./python-discovery";

const isWindows = process.platform === "win32";
let root: string;

/** Create an interpreter file in the platform's layout for a venv-like or flat environment root. */
function interpreter(envRoot: string, flat = false): string {
  const pythonPath = isWindows
    ? path.join(envRoot, ...(flat ? [] : ["Scripts"]), "python.exe")
    : path.join(envRoot, "bin", "python");
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.writeFileSync(pythonPath, "");
  return pythonPath;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-discovery-"));
  vi.mocked(execFileText).mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(execFileText).mockReset();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("interpreter path spelling", () => {
  it("gives a Windows path one spelling whatever its separators, dot segments or trailing separator", () => {
    const expected = "C:\\Users\\Ada\\envs\\nirs\\Scripts\\python.exe";
    for (const variant of [
      "C:\\Users\\Ada\\envs\\nirs\\Scripts\\python.exe",
      "C:/Users/Ada/envs/nirs/Scripts/python.exe",
      "C:\\Users\\Ada\\envs\\\\nirs/Scripts\\.\\python.exe",
      "C:\\Users\\Ada\\envs\\other\\..\\nirs\\Scripts\\python.exe\\",
      "C:/Users/Ada/envs/nirs/Scripts/python.exe//",
    ]) {
      expect(normalizePythonPath(variant, "win32"), variant).toBe(expected);
    }
    expect(normalizePythonPath("C:\\", "win32")).toBe("C:\\");
    expect(normalizePythonPath("\\\\server\\share\\envs\\python.exe", "win32")).toBe("\\\\server\\share\\envs\\python.exe");
  });

  it("gives a POSIX path one spelling and keeps backslashes and case, which are significant there", () => {
    expect(normalizePythonPath("/opt//envs/./nirs/lib/../bin/python/", "linux")).toBe("/opt/envs/nirs/bin/python");
    expect(normalizePythonPath("/", "linux")).toBe("/");
    expect(normalizePythonPath("/opt/Envs/odd\\name/bin/python", "darwin")).toBe("/opt/Envs/odd\\name/bin/python");
    expect(samePythonPath("/opt/Envs/bin/python", "/opt/envs/bin/python", "linux")).toBe(false);
    expect(samePythonPath("/opt/envs/bin/python", "/opt/envs/bin/../bin/python/", "linux")).toBe(true);
  });

  it("treats Windows spellings that differ only by case as the same interpreter", () => {
    expect(samePythonPath("C:\\Envs\\NIRS\\Scripts\\Python.exe", "c:/envs/nirs/scripts/python.exe/", "win32")).toBe(true);
    expect(samePythonPath("C:\\Envs\\nirs\\Scripts\\python.exe", "D:\\Envs\\nirs\\Scripts\\python.exe", "win32")).toBe(false);
  });

  it("emits the selected environment's own spelling, and the normalised spelling for any other", () => {
    const selected = "C:\\Users\\Ada\\envs\\nirs\\Scripts\\python.exe";
    // PATH entries and launchers commonly report another case or separator.
    expect(canonicalPythonPath("c:/users/ada/ENVS/nirs/scripts/PYTHON.EXE", selected, "win32")).toBe(selected);
    expect(canonicalPythonPath("C:/Users/Ada/envs/other/Scripts/python.exe/", selected, "win32"))
      .toBe("C:\\Users\\Ada\\envs\\other\\Scripts\\python.exe");
    expect(canonicalPythonPath("c:/tools/python.exe", null, "win32")).toBe("c:\\tools\\python.exe");
    expect(canonicalPythonPath("/envs/nirs/bin/./python", "/envs/nirs/bin/python", "linux")).toBe("/envs/nirs/bin/python");
  });

  it.skipIf(isWindows)("keeps a virtual environment's own interpreter instead of the base it links to", () => {
    const base = path.join(root, "base-python");
    const link = path.join(root, "venv", "bin", "python");
    fs.writeFileSync(base, "");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(base, link);
    expect(normalizePythonPath(`${path.dirname(link)}/./python`)).toBe(link);
  });
});

describe("interpreter discovery", () => {
  it("finds seeded, nearby project, conda and pyenv interpreters, seeds first", async () => {
    const workspace = path.join(root, "workspace");
    const home = path.join(root, "home");
    fs.mkdirSync(workspace, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(workspace);
    vi.stubEnv("PATH", "");
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    vi.stubEnv("PYENV_ROOT", path.join(home, ".pyenv"));
    vi.stubEnv("CONDA_EXE", "");

    const studio = interpreter(path.join(root, "user-data", "python-env", "venv"));
    const nearby = interpreter(path.join(workspace, ".venv"));
    fs.writeFileSync(path.join(workspace, ".venv", "pyvenv.cfg"), "home = test");
    const childProject = interpreter(path.join(workspace, "analysis-project", "venv"));
    const condaRoot = path.join(home, "miniconda3", "envs", "vision");
    const conda = interpreter(condaRoot, true);
    const condaExe = isWindows
      ? path.join(home, "miniconda3", "Scripts", "conda.exe")
      : path.join(home, "miniconda3", "bin", "conda");
    fs.mkdirSync(path.dirname(condaExe), { recursive: true });
    fs.writeFileSync(condaExe, "");
    const pyenv = interpreter(isWindows
      ? path.join(home, ".pyenv", "pyenv-win", "versions", "3.11.9")
      : path.join(home, ".pyenv", "versions", "3.11.9"), true);
    vi.mocked(execFileText).mockImplementation(async (command, args) => (
      command === condaExe && args.join(" ") === "env list --json"
        ? { stdout: JSON.stringify({ envs: [condaRoot] }), stderr: "" }
        : null
    ));

    const candidates = await gatherPythonCandidates([null, path.join(root, "missing", "python"), studio]);

    expect(candidates[0]).toBe(studio);
    expect(candidates).toEqual(expect.arrayContaining([nearby, childProject, conda, pyenv]));
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it.skipIf(isWindows)("keeps separate venvs that share the same Python binary and merges their aliases", () => {
    const base = path.join(root, "base-python");
    fs.writeFileSync(base, "python");
    for (const name of ["old-studio", "local"]) {
      const environment = path.join(root, name);
      fs.mkdirSync(path.join(environment, "bin"), { recursive: true });
      fs.writeFileSync(path.join(environment, "pyvenv.cfg"), "home = /usr/bin");
      for (const alias of ["python", "python3"]) fs.symlinkSync(base, path.join(environment, "bin", alias));
    }
    const candidates = new Map<string, string>();
    for (const name of ["old-studio", "local"]) {
      for (const alias of ["python", "python3"]) addPythonCandidate(candidates, path.join(root, name, "bin", alias));
    }
    expect([...candidates.values()]).toEqual([
      path.join(root, "old-studio", "bin", "python"),
      path.join(root, "local", "bin", "python"),
    ]);
  });

  it.skipIf(!isWindows)("deduplicates Windows launcher discoveries against PATH entries", async () => {
    const pathDir = path.join(root, "path");
    const home = path.join(root, "home");
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(workspace);
    vi.stubEnv("PATH", pathDir);
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    const pathPython = interpreter(pathDir, true);
    const launcherOnly = interpreter(path.join(home, "launcher-only"), true);
    vi.mocked(execFileText).mockImplementation(async (command, args) => (
      command === "py" && args[0] === "-0p"
        ? { stdout: ` -V:3.12 ${pathPython}\n -V:3.11 ${launcherOnly}`, stderr: "" }
        : null
    ));

    expect(await gatherPythonCandidates([])).toEqual([pathPython, launcherOnly]);
  });
});
