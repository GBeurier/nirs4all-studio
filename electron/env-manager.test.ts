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
const originalCwd = process.cwd();

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
  vi.unstubAllEnvs();
  vi.resetModules();
  childProcessMocks.execFile.mockReset();
  childProcessMocks.spawn.mockReset();
  fakeApp.getPath.mockReset();
  fakeApp.getVersion.mockReset();
  fakeApp.getVersion.mockReturnValue("0.3.1");
  process.chdir(originalCwd);

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

  it("does not auto-install missing core packages when selecting an existing Python", async () => {
    const userDataDir = makeUserDataDir();
    const pythonPath = path.join(userDataDir, "external-env", "python.exe");

    fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
    fs.writeFileSync(pythonPath, "");

    childProcessMocks.execFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (error: Error | null, stdout?: string) => void;
      callback(null, JSON.stringify({
        version: "3.11.7",
        installed: {
          nirs4all: "0.9.1",
        },
      }));
    });

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    await expect(manager.useExistingPython(pythonPath)).resolves.toMatchObject({
      success: false,
    });
    expect(childProcessMocks.spawn).not.toHaveBeenCalled();
    expect(manager.getConfiguredPythonPath()).toBeNull();
  });

  it("only installs core packages when the explicit apply path requests it", async () => {
    const userDataDir = makeUserDataDir();
    const settingsPath = path.join(userDataDir, "env-settings.json");
    const pythonPath = path.join(userDataDir, "external-env", "python.exe");

    fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
    fs.writeFileSync(pythonPath, "");

    let inspectCalls = 0;
    childProcessMocks.execFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (error: Error | null, stdout?: string) => void;
      inspectCalls += 1;
      callback(null, JSON.stringify({
        version: "3.11.7",
        installed: inspectCalls === 1
          ? { nirs4all: "0.9.1" }
          : {
              nirs4all: "0.9.1",
              fastapi: "0.111.0",
              uvicorn: "0.30.0",
              pydantic: "2.10.0",
              "python-multipart": "0.0.20",
              httpx: "0.27.0",
              pyyaml: "6.0.2",
              packaging: "24.2",
              platformdirs: "4.3.6",
              "sentry-sdk": "2.25.1",
            },
      }));
    });

    childProcessMocks.spawn.mockImplementation(() => {
      const proc = new EventEmitter() as EventEmitter & {
        pid: number;
        stderr: EventEmitter;
        stdout: EventEmitter;
      };
      proc.pid = 3210;
      proc.stderr = new EventEmitter();
      proc.stdout = new EventEmitter();
      process.nextTick(() => proc.emit("close", 0));
      return proc;
    });

    const envManagerModule = await import("./env-manager");
    vi.spyOn(envManagerModule, "probeNetworkOnline").mockResolvedValue(true);
    const manager = new envManagerModule.EnvManager();

    await expect(
      manager.applyExistingPython(pythonPath, { installCorePackages: true }),
    ).resolves.toMatchObject({
      success: true,
    });

    expect(
      childProcessMocks.spawn.mock.calls.some(
        ([command, args]) =>
          command === pythonPath
          && Array.isArray(args)
          && args.includes("pip")
          && args.includes("install"),
      ),
    ).toBe(true);

    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
      pythonPath?: string;
    };
    expect(saved.pythonPath).toBe(pythonPath);
  });

  it("switches from the managed runtime to an existing local venv root", async () => {
    const userDataDir = makeUserDataDir();
    const managedPython = process.platform === "win32"
      ? path.join(userDataDir, "python-env", "venv", "Scripts", "python.exe")
      : path.join(userDataDir, "python-env", "venv", "bin", "python");
    const localEnvRoot = path.join(userDataDir, "workspace", ".venv");
    const localPython = process.platform === "win32"
      ? path.join(localEnvRoot, "Scripts", "python.exe")
      : path.join(localEnvRoot, "bin", "python");
    const settingsPath = path.join(userDataDir, "env-settings.json");

    fs.mkdirSync(path.dirname(managedPython), { recursive: true });
    fs.mkdirSync(path.dirname(localPython), { recursive: true });
    fs.writeFileSync(managedPython, "");
    fs.writeFileSync(localPython, "");
    fs.writeFileSync(path.join(localEnvRoot, "pyvenv.cfg"), "home = test");

    childProcessMocks.execFile.mockImplementation((command: string, ...args: unknown[]) => {
      const callback = args[args.length - 1] as (error: Error | null, stdout?: string) => void;
      if (command === localPython) {
        callback(null, JSON.stringify({
          version: "3.11.8",
          installed: {
            nirs4all: "0.9.1",
            fastapi: "0.111.0",
            uvicorn: "0.30.0",
            pydantic: "2.10.0",
            "python-multipart": "0.0.20",
            httpx: "0.27.0",
            pyyaml: "6.0.2",
            packaging: "24.2",
            platformdirs: "4.3.6",
            "sentry-sdk": "2.25.1",
          },
        }));
        return;
      }
      callback(new Error(`unexpected command ${command}`));
    });

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    expect(manager.getConfiguredRuntimeMode()).toBe("managed");

    await expect(manager.applyExistingEnv(localEnvRoot)).resolves.toMatchObject({
      success: true,
      info: {
        envKind: "venv",
        pythonPath: localPython,
      },
    });

    expect(manager.getConfiguredRuntimeMode()).toBe("custom");
    expect(manager.getConfiguredPythonPath()).toBe(localPython);
    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
      pythonPath?: string;
    };
    expect(saved.pythonPath).toBe(localPython);
  });

  it("switches from the managed runtime to an inspected conda env", async () => {
    const userDataDir = makeUserDataDir();
    const managedPython = process.platform === "win32"
      ? path.join(userDataDir, "python-env", "venv", "Scripts", "python.exe")
      : path.join(userDataDir, "python-env", "venv", "bin", "python");
    const condaEnvRoot = path.join(userDataDir, "miniconda3", "envs", "vision");
    const condaPython = process.platform === "win32"
      ? path.join(condaEnvRoot, "python.exe")
      : path.join(condaEnvRoot, "bin", "python");

    fs.mkdirSync(path.dirname(managedPython), { recursive: true });
    fs.mkdirSync(path.dirname(condaPython), { recursive: true });
    fs.mkdirSync(path.join(condaEnvRoot, "conda-meta"), { recursive: true });
    fs.writeFileSync(managedPython, "");
    fs.writeFileSync(condaPython, "");

    childProcessMocks.execFile.mockImplementation((command: string, ...args: unknown[]) => {
      const callback = args[args.length - 1] as (error: Error | null, stdout?: string) => void;
      if (command === condaPython) {
        callback(null, JSON.stringify({
          version: "3.11.7",
          installed: {
            nirs4all: "0.9.1",
            fastapi: "0.111.0",
            uvicorn: "0.30.0",
            pydantic: "2.10.0",
            "python-multipart": "0.0.20",
            httpx: "0.27.0",
            pyyaml: "6.0.2",
            packaging: "24.2",
            platformdirs: "4.3.6",
            "sentry-sdk": "2.25.1",
          },
        }));
        return;
      }
      callback(new Error(`unexpected command ${command}`));
    });

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    await expect(manager.applyExistingEnv(condaEnvRoot)).resolves.toMatchObject({
      success: true,
      info: {
        envKind: "conda",
        pythonPath: condaPython,
      },
    });

    expect(manager.getConfiguredPythonPath()).toBe(condaPython);
    expect(manager.getConfiguredRuntimeMode()).toBe("custom");
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

  it("switches back to the app-created managed runtime when setup runs in the default location", async () => {
    const userDataDir = makeUserDataDir();
    const settingsPath = path.join(userDataDir, "env-settings.json");
    const customPython = process.platform === "win32"
      ? path.join(userDataDir, "external-env", "python.exe")
      : path.join(userDataDir, "external-env", "bin", "python");
    const baseDir = path.join(userDataDir, "python-env");
    const embeddedPython = process.platform === "win32"
      ? path.join(baseDir, "python", "python.exe")
      : path.join(baseDir, "python", "bin", "python3");
    const managedPython = process.platform === "win32"
      ? path.join(baseDir, "venv", "Scripts", "python.exe")
      : path.join(baseDir, "venv", "bin", "python");

    fs.mkdirSync(path.dirname(customPython), { recursive: true });
    fs.writeFileSync(customPython, "");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        pythonPath: customPython,
        appVersion: "0.3.1",
      }),
    );

    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = userDataDir;

    childProcessMocks.spawn.mockImplementation((command: string) => {
      const proc = new EventEmitter() as EventEmitter & {
        pid: number;
        stderr: EventEmitter;
        stdout: EventEmitter;
      };
      proc.pid = 2468;
      proc.stderr = new EventEmitter();
      proc.stdout = new EventEmitter();

      process.nextTick(() => {
        if (command === embeddedPython) {
          fs.mkdirSync(path.dirname(managedPython), { recursive: true });
          fs.writeFileSync(managedPython, "");
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
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, Buffer.alloc(11 * 1024 * 1024, 1));
    });
    (manager as unknown as {
      extractTarball(tarPath: string, destDir: string): Promise<void>;
    }).extractTarball = vi.fn(async (_tarPath: string, destDir: string) => {
      fs.mkdirSync(path.dirname(embeddedPython), { recursive: true });
      fs.writeFileSync(embeddedPython, "");
    });

    await expect(manager.setup()).resolves.toBeUndefined();

    expect(manager.getConfiguredRuntimeMode()).toBe("managed");
    expect(manager.getConfiguredPythonPath()).toBe(managedPython);

    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
      pythonPath?: string;
    };
    expect(saved.pythonPath).toBeUndefined();
  });

  it("prefers a bundled runtime over saved custom settings and skips the wizard", async () => {
    const userDataDir = makeUserDataDir();
    const settingsPath = path.join(userDataDir, "env-settings.json");
    const customPython = path.join(userDataDir, "custom-env", "python.exe");

    fs.mkdirSync(path.dirname(customPython), { recursive: true });
    fs.writeFileSync(customPython, "");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        pythonPath: customPython,
        appVersion: "0.3.1",
      }),
    );

    const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-bundled-"));
    tempDirs.push(resourcesDir);
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = resourcesDir;

    const runtimeDir = path.join(resourcesDir, "backend", "python-runtime");
    const bundledPython = process.platform === "win32"
      ? path.join(runtimeDir, "python", "python.exe")
      : path.join(runtimeDir, "python", "bin", "python3");
    const sitePackages = process.platform === "win32"
      ? path.join(runtimeDir, "python", "Lib", "site-packages")
      : path.join(runtimeDir, "python", "lib", "python3.11", "site-packages");

    fs.mkdirSync(path.dirname(bundledPython), { recursive: true });
    fs.mkdirSync(sitePackages, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, "RUNTIME_READY.json"), "{}");
    fs.writeFileSync(bundledPython, "");

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    expect(manager.isBundled()).toBe(true);
    expect(manager.getConfiguredRuntimeMode()).toBe("custom");
    expect(manager.getConfiguredPythonPath()).toBe(customPython);
    expect(manager.getRuntimeMode()).toBe("bundled");
    expect(manager.getPythonPath()).toBe(bundledPython);
    expect(manager.shouldShowWizard()).toBe(false);
  });

  it("verifies a bundled runtime without attempting any package repair", async () => {
    makeUserDataDir();

    const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-bundled-"));
    tempDirs.push(resourcesDir);
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = resourcesDir;

    const runtimeDir = path.join(resourcesDir, "backend", "python-runtime");
    const bundledPython = process.platform === "win32"
      ? path.join(runtimeDir, "python", "python.exe")
      : path.join(runtimeDir, "python", "bin", "python3");
    const sitePackages = process.platform === "win32"
      ? path.join(runtimeDir, "python", "Lib", "site-packages")
      : path.join(runtimeDir, "python", "lib", "python3.11", "site-packages");

    fs.mkdirSync(path.dirname(bundledPython), { recursive: true });
    fs.mkdirSync(sitePackages, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, "RUNTIME_READY.json"), "{}");
    fs.writeFileSync(bundledPython, "");

    childProcessMocks.execFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      callback(null, "", "");
    });

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    await expect(manager.ensureBackendPackages()).resolves.toBe(false);
    expect(childProcessMocks.spawn).not.toHaveBeenCalled();
    expect(childProcessMocks.execFile).toHaveBeenCalled();
  });

  it("verifies the configured custom runtime even when a bundled runtime is present", async () => {
    const userDataDir = makeUserDataDir();
    const settingsPath = path.join(userDataDir, "env-settings.json");
    const customPython = path.join(userDataDir, "custom-env", "python.exe");

    fs.mkdirSync(path.dirname(customPython), { recursive: true });
    fs.writeFileSync(customPython, "");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        pythonPath: customPython,
        appVersion: "0.3.1",
      }),
    );

    const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-bundled-verify-"));
    tempDirs.push(resourcesDir);
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = resourcesDir;

    const runtimeDir = path.join(resourcesDir, "backend", "python-runtime");
    const bundledPython = process.platform === "win32"
      ? path.join(runtimeDir, "python", "python.exe")
      : path.join(runtimeDir, "python", "bin", "python3");
    const sitePackages = process.platform === "win32"
      ? path.join(runtimeDir, "python", "Lib", "site-packages")
      : path.join(runtimeDir, "python", "lib", "python3.11", "site-packages");

    fs.mkdirSync(path.dirname(bundledPython), { recursive: true });
    fs.mkdirSync(sitePackages, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, "RUNTIME_READY.json"), "{}");
    fs.writeFileSync(bundledPython, "");

    childProcessMocks.execFile.mockImplementation((command: string, ...args: unknown[]) => {
      const callback = args[args.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      expect(command).toBe(customPython);
      callback(null, "", "");
    });

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    await expect(manager.verifyBackendRuntime()).resolves.toBe(true);
    expect(childProcessMocks.execFile).toHaveBeenCalled();
  });

  it("falls back to the legacy bundled venv layout for previously baked archives", async () => {
    makeUserDataDir();

    const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-bundled-legacy-"));
    tempDirs.push(resourcesDir);
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = resourcesDir;

    const runtimeDir = path.join(resourcesDir, "backend", "python-runtime");
    const bundledPython = process.platform === "win32"
      ? path.join(runtimeDir, "venv", "Scripts", "python.exe")
      : path.join(runtimeDir, "venv", "bin", "python");
    const sitePackages = process.platform === "win32"
      ? path.join(runtimeDir, "venv", "Lib", "site-packages")
      : path.join(runtimeDir, "venv", "lib", "python3.11", "site-packages");

    fs.mkdirSync(path.dirname(bundledPython), { recursive: true });
    fs.mkdirSync(sitePackages, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, "RUNTIME_READY.json"), "{}");
    fs.writeFileSync(bundledPython, "");

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    expect(manager.isBundled()).toBe(true);
    expect(manager.getPythonPath()).toBe(bundledPython);
  });

  it("tries alternate Python executable candidates when inspecting an env root", async () => {
    const userDataDir = makeUserDataDir();
    const envRoot = path.join(userDataDir, "mixed-env");
    const firstCandidate = process.platform === "win32"
      ? path.join(envRoot, "Scripts", "python.exe")
      : path.join(envRoot, "bin", "python3");
    const secondCandidate = process.platform === "win32"
      ? path.join(envRoot, "python.exe")
      : path.join(envRoot, "bin", "python");

    fs.mkdirSync(path.dirname(firstCandidate), { recursive: true });
    fs.mkdirSync(path.dirname(secondCandidate), { recursive: true });
    fs.writeFileSync(firstCandidate, "");
    fs.writeFileSync(secondCandidate, "");

    childProcessMocks.execFile.mockImplementation((command: string, ...args: unknown[]) => {
      const callback = args[args.length - 1] as (error: Error | null, stdout?: string) => void;
      if (command === firstCandidate) {
        callback(null, JSON.stringify({ version: "3.10.9", installed: {} }));
        return;
      }
      if (command === secondCandidate) {
        callback(null, JSON.stringify({ version: "3.11.9", installed: {} }));
        return;
      }
      callback(new Error(`unexpected command ${command}`));
    });

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    await expect(manager.inspectExistingEnv(envRoot)).resolves.toMatchObject({
      success: true,
      info: {
        pythonPath: secondCandidate,
      },
    });
  });

  it("discovers managed, nearby, conda, and pyenv runtimes from the expanded search sources", async () => {
    const userDataDir = makeUserDataDir();
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-discovery-workspace-"));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-discovery-home-"));
    tempDirs.push(workspaceDir, homeDir);

    process.chdir(workspaceDir);
    vi.stubEnv("PATH", "");
    vi.stubEnv("HOME", homeDir);
    vi.stubEnv("USERPROFILE", homeDir);
    vi.stubEnv("PYENV_ROOT", path.join(homeDir, ".pyenv"));

    const managedRoot = path.join(userDataDir, "python-env", "venv");
    const managedPython = process.platform === "win32"
      ? path.join(managedRoot, "Scripts", "python.exe")
      : path.join(managedRoot, "bin", "python");
    fs.mkdirSync(path.dirname(managedPython), { recursive: true });
    fs.writeFileSync(managedPython, "");

    const nearbyEnvRoot = path.join(workspaceDir, ".venv");
    const nearbyPython = process.platform === "win32"
      ? path.join(nearbyEnvRoot, "Scripts", "python.exe")
      : path.join(nearbyEnvRoot, "bin", "python");
    fs.mkdirSync(path.dirname(nearbyPython), { recursive: true });
    fs.writeFileSync(nearbyPython, "");
    fs.writeFileSync(path.join(nearbyEnvRoot, "pyvenv.cfg"), "home = test");

    const childProjectEnvRoot = path.join(workspaceDir, "analysis-project", "venv");
    const childProjectPython = process.platform === "win32"
      ? path.join(childProjectEnvRoot, "Scripts", "python.exe")
      : path.join(childProjectEnvRoot, "bin", "python");
    fs.mkdirSync(path.dirname(childProjectPython), { recursive: true });
    fs.writeFileSync(childProjectPython, "");
    fs.writeFileSync(path.join(childProjectEnvRoot, "pyvenv.cfg"), "home = test");

    const condaEnvRoot = path.join(homeDir, "miniconda3", "envs", "vision");
    const condaPython = process.platform === "win32"
      ? path.join(condaEnvRoot, "python.exe")
      : path.join(condaEnvRoot, "bin", "python");
    const condaExe = process.platform === "win32"
      ? path.join(homeDir, "miniconda3", "Scripts", "conda.exe")
      : path.join(homeDir, "miniconda3", "bin", "conda");
    fs.mkdirSync(path.dirname(condaPython), { recursive: true });
    fs.mkdirSync(path.join(condaEnvRoot, "conda-meta"), { recursive: true });
    fs.writeFileSync(condaPython, "");
    fs.mkdirSync(path.dirname(condaExe), { recursive: true });
    fs.writeFileSync(condaExe, "");

    const pyenvEnvRoot = process.platform === "win32"
      ? path.join(homeDir, ".pyenv", "pyenv-win", "versions", "3.11.9")
      : path.join(homeDir, ".pyenv", "versions", "3.11.9");
    const pyenvPython = process.platform === "win32"
      ? path.join(pyenvEnvRoot, "python.exe")
      : path.join(pyenvEnvRoot, "bin", "python");
    fs.mkdirSync(path.dirname(pyenvPython), { recursive: true });
    fs.writeFileSync(pyenvPython, "");

    const pythonOutputs = new Map([
      [managedPython, "3.11.9\nTrue\nTrue"],
      [nearbyPython, "3.11.8\nFalse\nFalse"],
      [childProjectPython, "3.12.1\nTrue\nTrue"],
      [condaPython, "3.11.7\nTrue\nTrue"],
      [pyenvPython, "3.11.6\nTrue\nTrue"],
    ]);

    childProcessMocks.execFile.mockImplementation((command: string, ...args: unknown[]) => {
      const callback = args[args.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      const commandArgs = Array.isArray(args[0]) ? args[0] as string[] : [];

      if (command === "py" && commandArgs[0] === "-0p") {
        callback(null, "", "");
        return;
      }

      if (commandArgs.join(" ") === "env list --json") {
        if (command === "conda") {
          callback(new Error("ENOENT"));
          return;
        }
        callback(null, JSON.stringify({ envs: [condaEnvRoot] }), "");
        return;
      }

      const stdout = pythonOutputs.get(command);
      if (stdout) {
        callback(null, stdout, "");
        return;
      }

      callback(new Error(`unexpected command ${command}`));
    });

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();
    const envs = await manager.detectExistingEnvs();

    expect(envs.map((env) => env.path)).toEqual(expect.arrayContaining([
      managedRoot,
      nearbyEnvRoot,
      childProjectEnvRoot,
      condaEnvRoot,
      pyenvEnvRoot,
    ]));
    expect(envs.find((env) => env.path === managedRoot)).toMatchObject({
      envKind: "managed",
      hasCorePackages: true,
      writable: true,
    });
    expect(envs.find((env) => env.path === nearbyEnvRoot)).toMatchObject({
      envKind: "venv",
      hasCorePackages: false,
    });
    expect(envs.find((env) => env.path === childProjectEnvRoot)).toMatchObject({
      envKind: "venv",
      hasCorePackages: true,
    });
    expect(envs.find((env) => env.path === condaEnvRoot)).toMatchObject({
      envKind: "conda",
      hasCorePackages: true,
    });
    expect(envs.find((env) => env.path === pyenvEnvRoot)).toMatchObject({
      envKind: "system",
      hasCorePackages: true,
    });
    expect(envs[0]?.path).toBe(managedRoot);
  });

  it("deduplicates Windows launcher discoveries against PATH entries", async () => {
    if (process.platform !== "win32") {
      return;
    }

    makeUserDataDir();
    const pathDir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-launcher-path-"));
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-launcher-home-"));
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-launcher-workspace-"));
    tempDirs.push(pathDir, homeDir, workspaceDir);

    process.chdir(workspaceDir);
    vi.stubEnv("PATH", pathDir);
    vi.stubEnv("HOME", homeDir);
    vi.stubEnv("USERPROFILE", homeDir);

    const pathPython = path.join(pathDir, "python.exe");
    const launcherOnlyRoot = path.join(homeDir, "launcher-only");
    const launcherOnlyPython = path.join(launcherOnlyRoot, "python.exe");
    fs.mkdirSync(path.dirname(pathPython), { recursive: true });
    fs.mkdirSync(path.dirname(launcherOnlyPython), { recursive: true });
    fs.writeFileSync(pathPython, "");
    fs.writeFileSync(launcherOnlyPython, "");

    childProcessMocks.execFile.mockImplementation((command: string, ...args: unknown[]) => {
      const callback = args[args.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      const commandArgs = Array.isArray(args[0]) ? args[0] as string[] : [];

      if (command === "py" && commandArgs[0] === "-0p") {
        callback(
          null,
          ` -V:3.12 ${pathPython}\n -V:3.11 ${launcherOnlyPython}`,
          "",
        );
        return;
      }

      if (commandArgs.join(" ") === "env list --json") {
        callback(new Error("ENOENT"));
        return;
      }

      if (command === pathPython) {
        callback(null, "3.12.1\nTrue\nTrue", "");
        return;
      }

      if (command === launcherOnlyPython) {
        callback(null, "3.11.9\nTrue\nTrue", "");
        return;
      }

      callback(new Error(`unexpected command ${command}`));
    });

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();
    const envs = await manager.detectExistingEnvs();

    expect(envs).toHaveLength(2);
    expect(envs.map((env) => env.pythonPath)).toEqual(expect.arrayContaining([
      pathPython,
      launcherOnlyPython,
    ]));
    expect(
      childProcessMocks.execFile.mock.calls.some(
        ([command, args]) => command === "py" && Array.isArray(args) && args[0] === "-0p",
      ),
    ).toBe(true);
  });
});
