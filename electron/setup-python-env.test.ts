import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const setupPythonEnvModule = require("../scripts/setup-python-env.cjs") as {
  buildPipInstallArgs(
    packageSpecs: string[],
    options?: {
      upgrade?: boolean;
      constraintsFile?: string;
      noCompile?: boolean;
    },
  ): string[];
  pruneStandaloneRuntimeArtifacts(runtimeRoot: string): {
    removedBytes: number;
    removedPaths: number;
  };
  pruneStandaloneRuntimeLaunchers(buildRoot: string): {
    removedBytes: number;
    removedPaths: number;
  };
};

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("setup-python-env", () => {
  it("adds --no-compile when building bundled standalone pip installs", () => {
    const args = setupPythonEnvModule.buildPipInstallArgs(["nirs4all==0.1.0"], {
      constraintsFile: "build/constraints.txt",
      noCompile: true,
      upgrade: true,
    });

    expect(args).toEqual([
      "-m",
      "pip",
      "install",
      "--no-compile",
      "--upgrade",
      "-c",
      "build/constraints.txt",
      "nirs4all==0.1.0",
    ]);
  });

  it("prunes package caches and non-runtime launchers from standalone bundles", () => {
    const buildRoot = makeTempDir("n4a-setup-python-");
    const scriptsDir = path.join(buildRoot, "python", "Scripts");
    const binDir = path.join(buildRoot, "python", "bin");
    const pycacheDir = path.join(buildRoot, "python", "lib", "python3.11", "site-packages", "pandas", "__pycache__");

    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(pycacheDir, { recursive: true });

    fs.writeFileSync(path.join(scriptsDir, "numba"), "#!C:/build/python.exe\n");
    fs.writeFileSync(path.join(binDir, "python"), "");
    fs.writeFileSync(path.join(binDir, "python3"), "");
    fs.writeFileSync(path.join(binDir, "pip3"), "#!/tmp/build/python/bin/python3\n");
    fs.writeFileSync(path.join(pycacheDir, "__init__.cpython-311.pyc"), "pyc");

    const artifactStats = setupPythonEnvModule.pruneStandaloneRuntimeArtifacts(buildRoot);
    const launcherStats = setupPythonEnvModule.pruneStandaloneRuntimeLaunchers(buildRoot);

    expect(fs.existsSync(scriptsDir)).toBe(false);
    expect(fs.existsSync(path.join(binDir, "python"))).toBe(true);
    expect(fs.existsSync(path.join(binDir, "python3"))).toBe(true);
    expect(fs.existsSync(path.join(binDir, "pip3"))).toBe(false);
    expect(fs.existsSync(pycacheDir)).toBe(false);
    expect(artifactStats.removedPaths + launcherStats.removedPaths).toBeGreaterThanOrEqual(3);
  });
});
