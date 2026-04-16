import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const smokeModule = require("../scripts/smoke-archive-standalone.cjs") as {
  assertValidConfig(config: {
    extractedRoot: string;
    platform: string;
    appName: string;
    port: number;
    timeoutMs: number;
    sandboxRoot: string;
    keepSandbox: boolean;
  }): {
    extractedRoot: string;
    platform: string;
    appName: string;
    port: number;
    timeoutMs: number;
    sandboxRoot: string;
    keepSandbox: boolean;
  };
  buildSandboxEnv(platformId: string, sandboxRoot: string, port: number): Record<string, string>;
  cleanupSandboxRoot(
    sandboxRoot: string,
    options?: { retryCount?: number; retryDelayMs?: number },
  ): Promise<boolean>;
  collectRuntimePathLeaks(runtimeRoot: string, disallowedFragments: string[]): Array<{
    path: string;
    kind: string;
    matches: string[];
  }>;
  isRetryableCleanupError(error: { code?: string } | null | undefined): boolean;
  parseArgs(argv?: string[]): {
    extractedRoot: string;
    platform: string;
    appName: string;
    port: number;
    timeoutMs: number;
    sandboxRoot: string;
    keepSandbox: boolean;
    help: boolean;
  };
  resolveLaunchLayout(extractedRoot: string, platformId: string, appName: string): {
    appRoot: string;
    executablePath: string;
    runtimeReadyPath: string;
    bundledPythonPath: string;
    bundledPythonCandidates: string[];
  };
  removePathWithRetries(
    targetPath: string,
    options?: { retryCount?: number; retryDelayMs?: number },
  ): Promise<void>;
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

describe("smoke-archive-standalone", () => {
  it("parses CLI flags for an extracted bundle smoke test", () => {
    const parsed = smokeModule.parseArgs([
      "--extracted-root",
      "release/archive-smoke",
      "--platform=linux",
      "--app-name",
      "nirs4all Studio",
      "--port",
      "43123",
      "--timeout-ms=90000",
      "--sandbox-root",
      "tmp/smoke-home",
      "--keep-sandbox",
    ]);

    expect(parsed.extractedRoot).toBe(path.resolve("release/archive-smoke"));
    expect(parsed.platform).toBe("linux");
    expect(parsed.appName).toBe("nirs4all Studio");
    expect(parsed.port).toBe(43123);
    expect(parsed.timeoutMs).toBe(90000);
    expect(parsed.sandboxRoot).toBe(path.resolve("tmp/smoke-home"));
    expect(parsed.keepSandbox).toBe(true);
  });

  it("resolves the Windows standalone layout", () => {
    const extractedRoot = makeTempDir("n4a-smoke-win-");
    const layout = smokeModule.resolveLaunchLayout(extractedRoot, "win32", "nirs4all Studio");

    expect(layout.executablePath).toBe(path.join(extractedRoot, "nirs4all Studio.exe"));
    expect(layout.runtimeReadyPath).toBe(
      path.join(extractedRoot, "resources", "backend", "python-runtime", "RUNTIME_READY.json"),
    );
    expect(layout.bundledPythonPath).toBe(
      path.join(extractedRoot, "resources", "backend", "python-runtime", "python", "python.exe"),
    );
    expect(layout.bundledPythonCandidates).toContain(
      path.join(extractedRoot, "resources", "backend", "python-runtime", "venv", "Scripts", "python.exe"),
    );
  });

  it("resolves the macOS .app layout", () => {
    const extractedRoot = makeTempDir("n4a-smoke-mac-");
    const appBundle = path.join(extractedRoot, "nirs4all Studio.app");
    fs.mkdirSync(appBundle);

    const layout = smokeModule.resolveLaunchLayout(extractedRoot, "darwin", "nirs4all Studio");

    expect(layout.appRoot).toBe(appBundle);
    expect(layout.executablePath).toBe(
      path.join(appBundle, "Contents", "MacOS", "nirs4all Studio"),
    );
    expect(layout.runtimeReadyPath).toBe(
      path.join(appBundle, "Contents", "Resources", "backend", "python-runtime", "RUNTIME_READY.json"),
    );
    expect(layout.bundledPythonPath).toBe(
      path.join(appBundle, "Contents", "Resources", "backend", "python-runtime", "python", "bin", "python3"),
    );
    expect(layout.bundledPythonCandidates).toContain(
      path.join(appBundle, "Contents", "Resources", "backend", "python-runtime", "venv", "bin", "python"),
    );
  });

  it("detects build-path leaks inside runtime launcher files", () => {
    const runtimeRoot = makeTempDir("n4a-smoke-leaks-");
    const scriptsDir = path.join(runtimeRoot, "venv", "Scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(
      path.join(runtimeRoot, "venv", "pyvenv.cfg"),
      "home = D:\\a\\nirs4all-webapp\\nirs4all-webapp\\backend-dist\\python-runtime\\python\n",
    );

    const leaks = smokeModule.collectRuntimePathLeaks(runtimeRoot, [
      "D:\\a\\nirs4all-webapp\\nirs4all-webapp",
      "D:\\a\\nirs4all-webapp\\nirs4all-webapp\\backend-dist",
    ]);

    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.path).toBe(path.join(runtimeRoot, "venv", "pyvenv.cfg"));
  });

  it("creates an isolated Linux sandbox env", () => {
    const sandboxRoot = makeTempDir("n4a-smoke-env-");
    const env = smokeModule.buildSandboxEnv("linux", sandboxRoot, 43123);

    expect(env.NIRS4ALL_OFFLINE).toBe("1");
    expect(env.NIRS4ALL_BACKEND_PORT).toBe("43123");
    expect(env.HOME).toBe(path.join(sandboxRoot, "home"));
    expect(env.XDG_CACHE_HOME).toBe(path.join(sandboxRoot, "home", ".cache"));
    expect(env.XDG_DATA_HOME).toBe(path.join(sandboxRoot, "home", ".local", "share"));
    expect(env.XDG_CONFIG_HOME).toBe(path.join(sandboxRoot, "home", ".config"));
  });

  it("rejects invalid forced ports", () => {
    const extractedRoot = makeTempDir("n4a-smoke-config-");

    expect(() =>
      smokeModule.assertValidConfig({
        extractedRoot,
        platform: "linux",
        appName: "nirs4all Studio",
        port: 70000,
        timeoutMs: 90000,
        sandboxRoot: "",
        keepSandbox: false,
      }),
    ).toThrow("Invalid --port value: 70000");
  });

  it("retries sandbox removal after transient Windows-style EPERM locks", async () => {
    const sandboxRoot = makeTempDir("n4a-smoke-cleanup-");
    fs.writeFileSync(path.join(sandboxRoot, "lock.txt"), "locked\n");

    const originalRmSync = fs.rmSync;
    let attempts = 0;
    fs.rmSync = (((targetPath, options) => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error(`locked: ${targetPath}`) as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      return originalRmSync(targetPath, options);
    }) as typeof fs.rmSync);

    try {
      await smokeModule.removePathWithRetries(sandboxRoot, { retryCount: 3, retryDelayMs: 1 });
    } finally {
      fs.rmSync = originalRmSync;
    }

    expect(attempts).toBe(3);
    expect(fs.existsSync(sandboxRoot)).toBe(false);
  });

  it("treats generated sandbox cleanup as best-effort after a passed smoke", async () => {
    const sandboxRoot = makeTempDir("n4a-smoke-warn-");
    fs.writeFileSync(path.join(sandboxRoot, "lock.txt"), "locked\n");

    const originalRmSync = fs.rmSync;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fs.rmSync = (((targetPath) => {
      const error = new Error(`locked: ${targetPath}`) as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    }) as typeof fs.rmSync);

    try {
      await expect(
        smokeModule.cleanupSandboxRoot(sandboxRoot, { retryCount: 1, retryDelayMs: 1 }),
      ).resolves.toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Warning: unable to remove smoke sandbox"));
    } finally {
      fs.rmSync = originalRmSync;
      warnSpy.mockRestore();
    }
  });
});
