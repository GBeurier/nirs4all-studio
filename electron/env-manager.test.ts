import fs from "node:fs";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

const fakeApp = {
  getPath: vi.fn(),
  getVersion: vi.fn(() => "0.3.1"),
};

vi.mock("node:child_process", () => ({
  execFile: childProcessMocks.execFile,
  spawn: childProcessMocks.spawn,
}));

vi.mock("electron", () => ({
  default: {
    app: fakeApp,
  },
  app: fakeApp,
}));

const tempDirs: string[] = [];
const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

function makeUserDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-env-"));
  tempDirs.push(dir);
  (globalThis as { __NIRS4ALL_TEST_APP__?: typeof fakeApp }).__NIRS4ALL_TEST_APP__ =
    fakeApp;
  fakeApp.getPath.mockImplementation(() => dir);
  return dir;
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  childProcessMocks.execFile.mockReset();
  childProcessMocks.spawn.mockReset();
  fakeApp.getPath.mockReset();
  fakeApp.getVersion.mockReset();
  fakeApp.getVersion.mockReturnValue("0.3.1");

  delete process.env.PORTABLE_EXECUTABLE_FILE;
  delete (globalThis as { __NIRS4ALL_TEST_APP__?: typeof fakeApp })
    .__NIRS4ALL_TEST_APP__;
  (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath;

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("EnvManager", () => {
  it("clears a stale saved custom python path instead of treating it as ready", async () => {
    const userDataDir = makeUserDataDir();
    const settingsPath = path.join(userDataDir, "env-settings.json");

    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        pythonPath: path.join(userDataDir, "missing", "python.exe"),
        appVersion: "0.3.1",
      }),
    );

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    expect(manager.isReady()).toBe(false);
    expect(manager.validateConfiguredState()).toBe(false);
    expect(manager.shouldShowWizard()).toBe(true);

    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
      pythonPath?: string;
    };
    expect(saved.pythonPath).toBeUndefined();
  });

  it("fails fast when backend package repair is requested without a usable runtime", async () => {
    makeUserDataDir();

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    await expect(manager.ensureBackendPackages()).rejects.toThrow(
      "Python environment is not configured or is missing",
    );
  });

  it("repairs missing packages without routing pip installs through a shell", async () => {
    const userDataDir = makeUserDataDir();
    const settingsPath = path.join(userDataDir, "env-settings.json");
    const pythonPath = path.join(userDataDir, "runtime", "python.exe");

    fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
    fs.writeFileSync(pythonPath, "");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        pythonPath,
        appVersion: "0.3.1",
      }),
    );

    let verifyCalls = 0;
    childProcessMocks.execFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (error: Error | null) => void;
      verifyCalls += 1;
      callback(verifyCalls === 1 ? new Error("missing packages") : null);
    });

    childProcessMocks.spawn.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        pid: number;
        stderr: EventEmitter;
        stdout: EventEmitter;
      };
      proc.pid = 1234;
      proc.stderr = new EventEmitter();
      proc.stdout = new EventEmitter();
      process.nextTick(() => proc.emit("close", 0));
      return proc;
    });

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    await expect(manager.ensureBackendPackages({ timeoutMs: 1000 })).resolves.toBe(true);

    const spawnCalls = childProcessMocks.spawn.mock.calls;
    expect(spawnCalls.length).toBeGreaterThanOrEqual(2);
    expect(
      spawnCalls.some(
        ([command, args]) =>
          command === pythonPath &&
          Array.isArray(args) &&
          args.includes("pip") &&
          args.includes("install"),
      ),
    ).toBe(true);

    for (const [, , options] of spawnCalls) {
      expect(options).toMatchObject({ shell: false });
    }
  });

  it("repairs a runtime that is missing nirs4all even when uvicorn and fastapi import", async () => {
    const userDataDir = makeUserDataDir();
    const settingsPath = path.join(userDataDir, "env-settings.json");
    const pythonPath = path.join(userDataDir, "runtime", "python.exe");

    fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
    fs.writeFileSync(pythonPath, "");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        pythonPath,
        appVersion: "0.3.1",
      }),
    );

    let heavyVerifyCalls = 0;
    childProcessMocks.execFile.mockImplementation((...args: unknown[]) => {
      const code = args[1] as string[];
      const callback = args[args.length - 1] as (error: Error | null) => void;
      if (Array.isArray(code) && code[1]?.includes("import uvicorn, fastapi")) {
        callback(null);
        return;
      }
      heavyVerifyCalls += 1;
      callback(heavyVerifyCalls === 1 ? new Error("missing nirs4all") : null);
    });

    childProcessMocks.spawn.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        pid: number;
        stderr: EventEmitter;
        stdout: EventEmitter;
      };
      proc.pid = 5678;
      proc.stderr = new EventEmitter();
      proc.stdout = new EventEmitter();
      process.nextTick(() => proc.emit("close", 0));
      return proc;
    });

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    await expect(manager.ensureBackendPackages({ timeoutMs: 1000 })).resolves.toBe(true);

    expect(
      childProcessMocks.spawn.mock.calls.some(
        ([command, args]) =>
          command === pythonPath &&
          Array.isArray(args) &&
          args.includes("pip") &&
          args.includes("install"),
      ),
    ).toBe(true);
  });

  it("annotates spawn failures with the exact command that could not be started", async () => {
    makeUserDataDir();

    childProcessMocks.spawn.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        pid: number;
        stderr: EventEmitter;
        stdout: EventEmitter;
      };
      proc.pid = 9876;
      proc.stderr = new EventEmitter();
      proc.stdout = new EventEmitter();
      process.nextTick(() => proc.emit("error", Object.assign(new Error("spawn EPERM"), { code: "EPERM" })));
      return proc;
    });

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    await expect(
      (manager as unknown as {
        runCommand(command: string, args: string[], options?: { retries?: number }): Promise<void>;
      }).runCommand("python.exe", ["-m", "venv", "C:\\temp\\venv"]),
    ).rejects.toThrow('Failed to start command "python.exe -m venv C:\\temp\\venv": spawn EPERM');
  });

  it("retries the first venv bootstrap spawn and only deletes the cached tarball after setup succeeds", async () => {
    const userDataDir = makeUserDataDir();
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = userDataDir;
    vi.useFakeTimers();
    let cachedTarballPath = "";
    const baseDir = path.join(userDataDir, "python-env");
    const pythonDir = path.join(baseDir, "python");
    const embeddedPython = process.platform === "win32"
      ? path.join(pythonDir, "python.exe")
      : path.join(pythonDir, "bin", "python3");
    const venvPython = process.platform === "win32"
      ? path.join(baseDir, "venv", "Scripts", "python.exe")
      : path.join(baseDir, "venv", "bin", "python");
    let embeddedPythonAttempts = 0;

    childProcessMocks.spawn.mockImplementation((command: string) => {
      const proc = new EventEmitter() as EventEmitter & {
        pid: number;
        stderr: EventEmitter;
        stdout: EventEmitter;
      };
      proc.pid = 4567;
      proc.stderr = new EventEmitter();
      proc.stdout = new EventEmitter();

      process.nextTick(() => {
        if (command === embeddedPython) {
          embeddedPythonAttempts += 1;
          if (embeddedPythonAttempts === 1) {
            proc.emit("error", Object.assign(new Error("spawn EPERM"), { code: "EPERM" }));
            return;
          }

          fs.mkdirSync(path.dirname(venvPython), { recursive: true });
          fs.writeFileSync(venvPython, "");
        }

        proc.emit("close", 0);
      });

      return proc;
    });

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    (manager as unknown as {
      downloadFile(url: string, destPath: string): Promise<void>;
      extractTarball(tarPath: string, destDir: string): Promise<void>;
    }).downloadFile = vi.fn(async (_url: string, destPath: string) => {
      cachedTarballPath = destPath;
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, Buffer.alloc(11 * 1024 * 1024, 1));
    });
    (manager as unknown as {
      extractTarball(tarPath: string, destDir: string): Promise<void>;
    }).extractTarball = vi.fn(async (_tarPath: string, destDir: string) => {
      fs.mkdirSync(path.dirname(embeddedPython), { recursive: true });
      fs.writeFileSync(embeddedPython, "");
      expect(destDir).toBe(baseDir);
    });

    const setupPromise = manager.setup();
    const setupExpectation = expect(setupPromise).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    await setupExpectation;

    expect(embeddedPythonAttempts).toBe(2);
    expect(cachedTarballPath).not.toBe("");
    expect(fs.existsSync(cachedTarballPath)).toBe(false);
  });

  it("keeps the cached tarball when setup fails before the runtime is ready", async () => {
    makeUserDataDir();
    vi.useFakeTimers();
    let cachedTarballPath = "";
    let spawnAttempts = 0;
    const baseDir = path.join(fakeApp.getPath("userData"), "python-env");
    const embeddedPython = process.platform === "win32"
      ? path.join(baseDir, "python", "python.exe")
      : path.join(baseDir, "python", "bin", "python3");

    childProcessMocks.spawn.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        pid: number;
        stderr: EventEmitter;
        stdout: EventEmitter;
      };
      proc.pid = 2468;
      proc.stderr = new EventEmitter();
      proc.stdout = new EventEmitter();

      process.nextTick(() => {
        spawnAttempts += 1;
        proc.emit("error", Object.assign(new Error("spawn EPERM"), { code: "EPERM" }));
      });

      return proc;
    });

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    (manager as unknown as {
      downloadFile(url: string, destPath: string): Promise<void>;
      extractTarball(tarPath: string, destDir: string): Promise<void>;
    }).downloadFile = vi.fn(async (_url: string, destPath: string) => {
      cachedTarballPath = destPath;
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, Buffer.alloc(11 * 1024 * 1024, 1));
    });
    (manager as unknown as {
      extractTarball(tarPath: string, destDir: string): Promise<void>;
    }).extractTarball = vi.fn(async () => {
      fs.mkdirSync(path.dirname(embeddedPython), { recursive: true });
      fs.writeFileSync(embeddedPython, "");
    });

    const setupPromise = manager.setup();
    const setupExpectation = expect(setupPromise).rejects.toThrow(
      `Failed to start command "${embeddedPython} -m venv ${path.join(baseDir, "venv")} --without-pip": spawn EPERM`,
    );
    await vi.runAllTimersAsync();
    await setupExpectation;

    expect(spawnAttempts).toBe(4);
    expect(cachedTarballPath).not.toBe("");
    expect(fs.existsSync(cachedTarballPath)).toBe(true);
  });
});
