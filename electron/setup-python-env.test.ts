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
  buildPluginToolchainInstallArgs(): string[];
  buildDeterministicWheelEnv(
    sourceEpoch: string,
    baseEnv?: Record<string, string | undefined>,
  ): Record<string, string | undefined>;
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
  pruneStandaloneRuntimeArtifacts(runtimeRoot: string, options?: { pluginOnlyRuntime?: boolean }): {
    removedBytes: number;
    removedPaths: number;
  };
  pruneStandaloneRuntimeLaunchers(buildRoot: string): {
    removedBytes: number;
    removedPaths: number;
  };
  PRUNED_LAUNCHER_RECORD_PREFIXES: readonly string[];
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
  it("keeps the plugin wheel toolchain exact while bounding network retries", () => {
    expect(setupPythonEnvModule.buildPluginToolchainInstallArgs()).toEqual([
      "-I",
      "-m",
      "pip",
      "install",
      "--prefer-binary",
      "--no-compile",
      "--upgrade",
      "--timeout",
      "60",
      "--retries",
      "3",
      "setuptools==84.0.0",
      "wheel==0.48.0",
      "packaging==26.3",
    ]);
  });

  it("downloads the published plugin wheel and normalizes the remaining pinned source build", () => {
    expect(
      setupPythonEnvModule.buildDeterministicWheelEnv("1788621086", {
        EXISTING: "preserved",
        GIT_CONFIG_COUNT: "7",
        GIT_CONFIG_KEY_0: "unsafe.override",
        GIT_CONFIG_VALUE_0: "true",
      }),
    ).toEqual({
      EXISTING: "preserved",
      SOURCE_DATE_EPOCH: "1788621086",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.autocrlf",
      GIT_CONFIG_VALUE_0: "false",
    });

    const setupSource = fs.readFileSync(
      path.join(process.cwd(), "scripts", "setup-python-env.cjs"),
      "utf8",
    );
    expect(setupSource).toContain(
      'const PLUGIN_WHEEL_FILENAME = "nirs4all-1.0.1-py3-none-any.whl";',
    );
    expect(setupSource).toContain(
      'const PLUGIN_WHEEL_URL = "https://files.pythonhosted.org/packages/53/dc/1240b0db9095277cea050fd5d8044ffc7bdba303fd8242c8bd1b6eab4e15/nirs4all-1.0.1-py3-none-any.whl";',
    );
    expect(setupSource).not.toContain("PLUGIN_SOURCE_EPOCH");
    expect(setupSource).not.toContain("pip\",\n        \"wheel\",\n        \"--no-deps\",\n        \"--no-build-isolation\",\n        \"--wheel-dir\",\n        wheelDir");
    expect(setupSource).toContain(
      "env: buildDeterministicWheelEnv(TOOLS_SOURCE_EPOCH)",
    );
  });

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

  it("installs torch separately with the Linux CPU wheel index for the standalone CPU bundle scope", () => {
    const phases = setupPythonEnvModule.getDependencyInstallPhases("cpu", "linux");

    expect(phases).toHaveLength(2);
    expect(phases[0]).toEqual({
      label: "torch runtime",
      packageSpecs: ["torch>=2.1.0"],
      extraPipArgs: ["--index-url", "https://download.pytorch.org/whl/cpu"],
    });
    expect(phases[1].label).toBe("backend dependencies");
    expect(phases[1].extraPipArgs).toEqual([]);
    expect(phases[1].packageSpecs).toContain("pyopls>=20.0");
    expect(phases[1].packageSpecs).toContain("trendfitter>=0.0.6");
    expect(phases[1].packageSpecs).toContain("xgboost>=2.0.0");
    expect(phases[1].packageSpecs).toContain("umap-learn>=0.5.0");
    expect(phases[1].packageSpecs).not.toContain("torch>=2.1.0");
    expect(phases[1].packageSpecs).not.toContain("tabpfn>=2.0.0");
    expect(phases[1].packageSpecs).not.toContain("tabicl>=2.0.0");
  });

  it("keeps macOS CPU standalone installs on the default index", () => {
    const phases = setupPythonEnvModule.getDependencyInstallPhases("cpu", "darwin");

    expect(phases).toHaveLength(1);
    expect(phases[0].label).toBe("backend dependencies");
    expect(phases[0].extraPipArgs).toEqual([]);
    expect(phases[0].packageSpecs).toContain("torch>=2.1.0");
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
    expect(setupPythonEnvModule.PRUNED_LAUNCHER_RECORD_PREFIXES).toEqual([
      "../../../bin/",
      "../../../Scripts/",
    ]);
    const setupSource = fs.readFileSync(
      path.join(process.cwd(), "scripts", "setup-python-env.cjs"),
      "utf8",
    );
    expect(setupSource.indexOf("pruneStandaloneRuntimeLaunchers(backendDist)")).toBeLessThan(
      setupSource.indexOf("removePrunedLauncherRecordRows(runtimePython, backendDist)"),
    );
    expect(setupSource.indexOf("removePrunedLauncherRecordRows(runtimePython, backendDist)")).toBeLessThan(
      setupSource.indexOf('restorePinnedWheelRecord(runtimePython, backendDist, selectedPluginWheel'),
    );
  });

  it("removes build-only wheel metadata and Tk from the headless plugin closure", () => {
    const buildRoot = makeTempDir("n4a-setup-python-headless-");
    const stdlibDir = path.join(buildRoot, "python", "lib", "python3.11");
    const tkinterDir = path.join(stdlibDir, "tkinter");
    const extensionPath = path.join(
      stdlibDir,
      "lib-dynload",
      "_tkinter.cpython-311-x86_64-linux-gnu.so",
    );
    const retainedPath = path.join(stdlibDir, "turtle.py");
    const sitePackages = path.join(stdlibDir, "site-packages");
    const wheelPackage = path.join(sitePackages, "wheel");
    const wheelMetadata = path.join(sitePackages, "wheel-0.48.0.dist-info");

    fs.mkdirSync(tkinterDir, { recursive: true });
    fs.mkdirSync(path.dirname(extensionPath), { recursive: true });
    fs.mkdirSync(wheelPackage, { recursive: true });
    fs.mkdirSync(wheelMetadata, { recursive: true });
    fs.writeFileSync(path.join(tkinterDir, "__init__.py"), "pass\n");
    fs.writeFileSync(extensionPath, "extension");
    fs.writeFileSync(retainedPath, "pass\n");
    fs.writeFileSync(path.join(wheelPackage, "__init__.py"), "pass\n");
    fs.writeFileSync(path.join(wheelMetadata, "METADATA"), "Name: wheel\nVersion: 0.48.0\n");

    const stats = setupPythonEnvModule.pruneStandaloneRuntimeArtifacts(buildRoot, {
      pluginOnlyRuntime: true,
    });

    expect(fs.existsSync(tkinterDir)).toBe(false);
    expect(fs.existsSync(extensionPath)).toBe(false);
    expect(fs.existsSync(wheelPackage)).toBe(false);
    expect(fs.existsSync(wheelMetadata)).toBe(false);
    expect(fs.existsSync(retainedPath)).toBe(true);
    expect(stats.removedPaths).toBe(4);
  });
});
