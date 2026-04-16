import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const bakeStandaloneBackendModule = require("../scripts/bake-standalone-backend.cjs") as {
  getVenvPythonPath(runtimeRoot: string): string;
  moveIfExists(
    srcPath: string,
    destPath: string,
    options?: { retryCount?: number; retryDelayMs?: number; removeAttempts?: number },
  ): Promise<void>;
  parseArgs(argv?: string[]): {
    profile: string;
    platform: string;
    arch: string;
    clean: boolean;
    cacheDir: string;
    constraintsFile: string;
    help?: boolean;
  };
  resolveBakeConfig(
    rawOptions: {
      profile: string;
      platform: string;
      arch: string;
      clean: boolean;
      cacheDir: string;
      constraintsFile: string;
    },
    host?: { platform: string; arch: string },
  ): {
    profile: string;
    platform: string;
    arch: string;
    clean: boolean;
    cacheDir: string;
    constraintsFile: string;
  };
  resolveConstraintsFile(
    options: {
      profile: string;
      platform: string;
      arch: string;
      constraintsFile: string;
    },
    rootDir?: string,
  ): string;
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

describe("bake-standalone-backend", () => {
  it("parses both --flag value and --flag=value forms", () => {
    const parsed = bakeStandaloneBackendModule.parseArgs([
      "--profile=cpu",
      "--platform",
      "linux",
      "--arch=x64",
      "--clean",
      "--cache-dir=build/.cache",
      "--constraints",
      "build/constraints/linux.txt",
    ]);

    expect(parsed.profile).toBe("cpu");
    expect(parsed.platform).toBe("linux");
    expect(parsed.arch).toBe("x64");
    expect(parsed.clean).toBe(true);
    expect(parsed.cacheDir).toBe(path.resolve("build/.cache"));
    expect(parsed.constraintsFile).toBe(path.resolve("build/constraints/linux.txt"));
  });

  it("auto-resolves the per-target constraints file when present", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-bake-constraints-"));
    tempDirs.push(projectRoot);

    const constraintsDir = path.join(projectRoot, "build", "constraints", "standalone");
    fs.mkdirSync(constraintsDir, { recursive: true });
    const expected = path.join(constraintsDir, "cpu-linux-x64.txt");
    fs.writeFileSync(expected, "# pinned\n");

    const resolved = bakeStandaloneBackendModule.resolveConstraintsFile(
      {
        profile: "cpu",
        platform: "linux",
        arch: "x64",
        constraintsFile: "",
      },
      projectRoot,
    );

    expect(resolved).toBe(expected);
  });

  it("rejects cross-target bakes on the wrong host", () => {
    expect(() =>
      bakeStandaloneBackendModule.resolveBakeConfig(
        {
          profile: "cpu",
          platform: "linux",
          arch: "x64",
          clean: false,
          cacheDir: path.resolve("build/.python-cache"),
          constraintsFile: "",
        },
        { platform: "win32", arch: "x64" },
      ),
    ).toThrow("Cross-target bake is not supported on this host.");
  });

  it("returns the bundled venv Python path for the current platform", () => {
    const runtimeRoot = path.join("backend-dist", "python-runtime");
    const pythonPath = bakeStandaloneBackendModule.getVenvPythonPath(runtimeRoot);

    expect(pythonPath).toBe(
      process.platform === "win32"
        ? path.join(runtimeRoot, "venv", "Scripts", "python.exe")
        : path.join(runtimeRoot, "venv", "bin", "python"),
    );
  });

  it("falls back to copy/remove when rename is denied", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-bake-move-"));
    tempDirs.push(tempRoot);

    const srcDir = path.join(tempRoot, "python");
    const destDir = path.join(tempRoot, "python-runtime", "python");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "RUNTIME_READY.json"), "{}\n");

    const originalRenameSync = fs.renameSync;
    fs.renameSync = ((src, dest) => {
      const error = new Error(`rename blocked: ${src} -> ${dest}`) as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    }) as typeof fs.renameSync;

    try {
      await bakeStandaloneBackendModule.moveIfExists(srcDir, destDir, {
        retryCount: 1,
        retryDelayMs: 1,
        removeAttempts: 2,
      });
    } finally {
      fs.renameSync = originalRenameSync;
    }

    expect(fs.existsSync(srcDir)).toBe(false);
    expect(fs.readFileSync(path.join(destDir, "RUNTIME_READY.json"), "utf-8")).toContain("{}");
  });
});
