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
      extraPipArgs?: string[];
    },
  ): string[];
  getLocalNirs4allCandidates(explicitPath?: string, env?: Record<string, string | undefined>): string[];
  resolveLocalNirs4allPath(explicitPath?: string, env?: Record<string, string | undefined>): string | null;
  getDependencyInstallPhases(
    profileId: string,
    platform?: string,
  ): Array<{
    label: string;
    packageSpecs: string[];
    extraPipArgs: string[];
  }>;
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
      extraPipArgs: ["--index-url", "https://download.pytorch.org/whl/cpu"],
      noCompile: true,
      upgrade: true,
    });

    expect(args).toEqual([
      "-m",
      "pip",
      "install",
      "--prefer-binary",
      "--no-compile",
      "--upgrade",
      "--index-url",
      "https://download.pytorch.org/whl/cpu",
      "-c",
      "build/constraints.txt",
      "nirs4all==0.1.0",
    ]);
  });

  it.each(["linux", "darwin", "win32"])("keeps recovery CPU Lite provisioning lightweight on %s", (platform) => {
    const phases = setupPythonEnvModule.getDependencyInstallPhases("cpu-lite", platform);
    expect(phases).toHaveLength(1);
    expect(phases[0].label).toBe("backend dependencies");
    expect(phases[0].extraPipArgs).toEqual([]);
    expect(phases[0].packageSpecs).toEqual(expect.arrayContaining([
      "fastapi>=0.115.0", "uvicorn[standard]>=0.34.0", "msgpack>=1.0.0",
    ]));
    // GPU/foundation-model stacks belong to explicit optional installs, not bootstrap.
    expect(phases[0].packageSpecs.some(spec => /^(torch|tabpfn|tabicl|tensorflow|nvidia-|umap-learn)/.test(spec))).toBe(false);
  });

  it("resolves an explicit local nirs4all source path", () => {
    const sourceDir = makeTempDir("n4a-lib-");

    expect(setupPythonEnvModule.resolveLocalNirs4allPath(sourceDir, {})).toBe(sourceDir);
    expect(setupPythonEnvModule.getLocalNirs4allCandidates(sourceDir, {})).toContain(sourceDir);
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
