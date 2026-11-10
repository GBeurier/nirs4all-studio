import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it, vi } from "vitest";

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
  acquirePluginWheel(wheelDir: string, suppliedWheel?: string, download?: (url: string, destination: string) => Promise<void>): Promise<string>;
  buildPinnedPluginWheel(python: string, destination: string): Promise<string>;
  buildPluginRuntimeInstallArgs(packageSpecs: string[], options?: { constraintsFile?: string; upgrade?: boolean }): string[];
  verifyInstalledDependencies(python: string, isolated: boolean, execute: (command: string, args: string[]) => Promise<void>): Promise<void>;
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
  PRUNED_LAUNCHER_RECORD_FILES: readonly string[];
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
  it("rejects incompatible installed dependencies before the runtime can be pruned or marked ready", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("missing runtime dependency"));
    await expect(setupPythonEnvModule.verifyInstalledDependencies("/runtime/python", true, execute))
      .rejects.toThrow("missing runtime dependency");
    expect(execute).toHaveBeenCalledWith("/runtime/python", ["-I", "-m", "pip", "check"]);
    const source = fs.readFileSync(path.join(process.cwd(), "scripts", "setup-python-env.cjs"), "utf8");
    const verification = source.indexOf("await verifyInstalledDependencies(runtimePython, pluginOnly)");
    const pruning = source.indexOf("const runtimeStats = pruneStandaloneRuntimeArtifacts");
    expect(verification).toBeGreaterThanOrEqual(0);
    expect(pruning).toBeGreaterThanOrEqual(0);
    expect(verification).toBeLessThan(pruning);
  });

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
      "pip==26.2.1",
      "build==1.6.1",
      "setuptools==84.2.1",
      "wheel==0.47.0",
      "packaging==26.3",
    ]);
  });

  it("retains the historical source recipe separately from public wheel acquisition", () => {
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
      'const HISTORICAL_PLUGIN_WHEEL_FILENAME = "nirs4all-1.4.15-py3-none-any.whl";',
    );
    expect(setupSource).toContain(
      'const HISTORICAL_PLUGIN_SOURCE_COMMIT = "2ab9953ccb4b5e72f76be6cb637503622c5869cf";',
    );
    expect(setupSource).toContain('const PLUGIN_SOURCE_EPOCH = "1793671925";');
    expect(setupSource).toContain("selectedPluginWheel = await acquirePluginWheel(wheelDir, pluginWheel)");
    expect(setupSource).toContain("normalize-plugin-wheel.py");
    expect(setupSource).toContain('const PLUGIN_WHEEL_FILENAME = "nirs4all-1.4.16-py3-none-any.whl";');
    expect(setupSource).toContain('await download(PLUGIN_WHEEL_URL, selected)');
    expect(setupSource).toContain('"nirs4all", PLUGIN_DISTRIBUTION_VERSION');
    expect(setupSource).not.toContain("nirs4all_tools");
  });

  it("keeps --build-plugin-wheel refused before any historical build work", async () => {
    await expect(setupPythonEnvModule.buildPinnedPluginWheel("unused-python", "unused.whl"))
      .rejects.toThrow("Historical SDK wheel build recipe");
    const result = spawnSync(process.execPath, ["scripts/setup-python-env.cjs", "--build-plugin-wheel", "unused.whl"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Historical SDK wheel build recipe");
  });

  it.each(["supplied", "downloaded"])("refuses altered same-version %s public wheel bytes", async (kind) => {
    const root = makeTempDir("n4a-public-wheel-");
    const wheel = path.join(root, "nirs4all-1.4.16-py3-none-any.whl");
    const download = vi.fn(async (_url: string, destination: string) => {
      fs.writeFileSync(destination, "wrong same-version wheel");
    });
    if (kind === "supplied") fs.writeFileSync(wheel, "wrong same-version wheel");
    await expect(setupPythonEnvModule.acquirePluginWheel(root, kind === "supplied" ? wheel : "", download))
      .rejects.toThrow("Pinned plugin wheel identity mismatch");
    if (kind === "supplied") expect(download).not.toHaveBeenCalled();
    else expect(download).toHaveBeenCalledWith(
      "https://files.pythonhosted.org/packages/47/c2/8c92965fe20f18d05a34026e2c7cf48bd30b8ec1287c5a951cf523c8a028/nirs4all-1.4.16-py3-none-any.whl", wheel,
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

  it("requires binary scientific wheels while allowing pinned source-only ecosystem packages", () => {
    expect(setupPythonEnvModule.buildPluginRuntimeInstallArgs(["shap==0.47.1"], {
      constraintsFile: "locked.txt", upgrade: true,
    })).toEqual([
      "-I", "-m", "pip", "install", "--prefer-binary", "--no-compile", "--upgrade",
      "--only-binary=numpy,numba,llvmlite", "-c", "locked.txt", "shap==0.47.1",
    ]);
  });

  it("installs the required Formats distribution rather than only constraining its optional version", () => {
    const { PLUGIN_SUPPORT_PACKAGES } = require("../scripts/python-runtime-config.cjs") as {
      PLUGIN_SUPPORT_PACKAGES: string[];
    };
    const args = setupPythonEnvModule.buildPluginRuntimeInstallArgs(PLUGIN_SUPPORT_PACKAGES, {
      constraintsFile: "build/constraints/plugin-runtime-cpython311.txt",
    });
    expect(args).toContain("nirs4all-formats==0.2.16");
    expect(args).toContain("build/constraints/plugin-runtime-cpython311.txt");
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
    expect(setupPythonEnvModule.PRUNED_LAUNCHER_RECORD_FILES).toEqual(["../../Scripts/nirs4all.exe"]);
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
