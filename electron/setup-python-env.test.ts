import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const setupPythonEnvModule = require("../scripts/setup-python-env.cjs") as {
  getCompileTargets(options: {
    backendDist: string;
    buildMode: string;
    runtimeOnly: boolean;
    venvDir: string;
  }): string[];
  isStandaloneBundledRuntimeMode(mode?: string): boolean;
  pruneStandaloneRuntimeArtifacts(runtimeRoot: string): {
    removedBytes: number;
    removedPaths: number;
  };
};

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("setup-python-env", () => {
  it("detects standalone bundled runtime mode explicitly", () => {
    expect(setupPythonEnvModule.isStandaloneBundledRuntimeMode("standalone-bundled-runtime")).toBe(true);
    expect(setupPythonEnvModule.isStandaloneBundledRuntimeMode("installer")).toBe(false);
  });

  it("skips venv-wide bytecode compilation for the immutable bundled runtime", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-setup-compile-"));
    tempDirs.push(tempRoot);

    const backendDist = path.join(tempRoot, "backend-dist");
    const venvDir = path.join(backendDist, "venv");
    const venvLib = path.join(venvDir, process.platform === "win32" ? "Lib" : "lib");
    const apiDir = path.join(backendDist, "api");
    const websocketDir = path.join(backendDist, "websocket");
    const mainPy = path.join(backendDist, "main.py");

    fs.mkdirSync(venvLib, { recursive: true });
    fs.mkdirSync(apiDir, { recursive: true });
    fs.mkdirSync(websocketDir, { recursive: true });
    fs.writeFileSync(mainPy, "print('ok')\n");

    const standaloneTargets = setupPythonEnvModule.getCompileTargets({
      backendDist,
      buildMode: "standalone-bundled-runtime",
      runtimeOnly: false,
      venvDir,
    });
    expect(standaloneTargets).toEqual([apiDir, websocketDir, mainPy]);

    const installerTargets = setupPythonEnvModule.getCompileTargets({
      backendDist,
      buildMode: "installer",
      runtimeOnly: false,
      venvDir,
    });
    expect(installerTargets).toEqual([venvLib, apiDir, websocketDir, mainPy]);
  });

  it("prunes development-only include and cmake trees from the bundled runtime", () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-setup-prune-"));
    tempDirs.push(runtimeRoot);

    const torchIncludeDir = path.join(
      runtimeRoot,
      "venv",
      "lib",
      "python3.11",
      "site-packages",
      "torch",
      "include",
      "pybind11",
    );
    const cmakeDir = path.join(runtimeRoot, "python", "lib", "cmake", "torch");
    const runtimeLibDir = path.join(runtimeRoot, "venv", "lib", "python3.11", "site-packages", "torch", "lib");
    const runtimeLib = path.join(runtimeLibDir, "libtorch_cpu.dylib");

    fs.mkdirSync(torchIncludeDir, { recursive: true });
    fs.mkdirSync(cmakeDir, { recursive: true });
    fs.mkdirSync(runtimeLibDir, { recursive: true });
    fs.writeFileSync(path.join(torchIncludeDir, "type_caster_pyobject_ptr.h"), "// header\n");
    fs.writeFileSync(path.join(cmakeDir, "TorchConfig.cmake"), "# cmake\n");
    fs.writeFileSync(runtimeLib, "binary\n");

    const stats = setupPythonEnvModule.pruneStandaloneRuntimeArtifacts(runtimeRoot);

    expect(stats.removedPaths).toBe(2);
    expect(stats.removedBytes).toBeGreaterThan(0);
    expect(fs.existsSync(torchIncludeDir)).toBe(false);
    expect(fs.existsSync(cmakeDir)).toBe(false);
    expect(fs.existsSync(runtimeLib)).toBe(true);
  });
});
