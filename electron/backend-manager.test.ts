import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

const fakeApp = {
  getPath: vi.fn(),
  getVersion: vi.fn(() => "0.3.3"),
  isPackaged: false,
};

const fakeBrowserWindow = {
  getAllWindows: vi.fn(() => []),
};

const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

vi.mock("node:child_process", () => ({
  spawn: childProcessMocks.spawn,
}));

vi.mock("electron", () => ({
  default: {
    app: fakeApp,
    BrowserWindow: fakeBrowserWindow,
  },
  app: fakeApp,
  BrowserWindow: fakeBrowserWindow,
}));

const tempDirs: string[] = [];

function makeUserDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-backend-"));
  tempDirs.push(dir);
  fakeApp.getPath.mockImplementation(() => dir);
  return dir;
}

function makeSpawnResult(): EventEmitter & {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.pid = 9999;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

function makeTrackedProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.pid = 4242;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn((signal?: string) => {
    if (signal === "SIGTERM" || signal === "SIGKILL") {
      process.nextTick(() => proc.emit("exit", 0, null));
    }
    return true;
  });
  return proc;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.NIRS4ALL_BACKEND_PORT;
  delete process.env.VITE_DEV_SERVER_URL;
  vi.resetModules();

  childProcessMocks.spawn.mockReset();
  fakeApp.getPath.mockReset();
  fakeApp.getVersion.mockReset();
  fakeApp.getVersion.mockReturnValue("0.3.3");
  fakeApp.isPackaged = false;
  fakeBrowserWindow.getAllWindows.mockReset();
  fakeBrowserWindow.getAllWindows.mockReturnValue([]);
  (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath;

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("BackendManager", () => {
  it("terminates the previous backend before crash restart", async () => {
    makeUserDataDir();

    const { BackendManager } = await import("./backend-manager");
    const manager = new BackendManager();
    const trackedProcess = makeTrackedProcess();

    (manager as unknown as {
      process: typeof trackedProcess;
      status: string;
      port: number;
      notifyRenderer: ReturnType<typeof vi.fn>;
      startInternal: ReturnType<typeof vi.fn>;
    }).process = trackedProcess;
    (manager as unknown as { status: string }).status = "running";
    (manager as unknown as { port: number }).port = 64147;
    (manager as unknown as { notifyRenderer: ReturnType<typeof vi.fn> }).notifyRenderer = vi.fn();
    (manager as unknown as { startInternal: ReturnType<typeof vi.fn> }).startInternal = vi.fn(async () => {
      (manager as unknown as { status: string }).status = "running";
    });

    childProcessMocks.spawn.mockImplementation((command: string) => {
      const proc = makeSpawnResult();
      if (command === "taskkill") {
        process.nextTick(() => trackedProcess.emit("exit", 0, null));
      }
      return proc;
    });

    await (manager as unknown as { handleCrash: () => Promise<void> }).handleCrash();

    if (process.platform === "win32") {
      expect(childProcessMocks.spawn).toHaveBeenCalledWith("taskkill", ["/pid", "4242", "/t", "/f"]);
    } else {
      expect(trackedProcess.kill).toHaveBeenCalledWith("SIGTERM");
    }

    expect(
      (manager as unknown as { startInternal: ReturnType<typeof vi.fn> }).startInternal,
    ).toHaveBeenCalledTimes(1);
    expect(manager.getInfo().status).toBe("running");
  });

  it("surfaces a terminal error when restart attempts are exhausted", async () => {
    makeUserDataDir();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const { BackendManager } = await import("./backend-manager");
    const manager = new BackendManager();

    (manager as unknown as { status: string }).status = "running";
    (manager as unknown as { restartCount: number }).restartCount = 3;
    (manager as unknown as { port: number }).port = 64147;
    (manager as unknown as { notifyRenderer: ReturnType<typeof vi.fn> }).notifyRenderer = vi.fn();

    (manager as unknown as { startHealthMonitor: () => void }).startHealthMonitor();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(manager.getInfo().status).toBe("running");
    expect(manager.getInfo().error).toBeUndefined();

    await vi.advanceTimersByTimeAsync(20_000);

    expect(manager.getInfo().status).toBe("error");
    expect(manager.getInfo().error).toBe("Maximum restart attempts exceeded");

    (manager as unknown as { stopHealthMonitor: () => void }).stopHealthMonitor();
  });

  it("resets transient health-check failures after a successful probe", async () => {
    makeUserDataDir();
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary stall"))
      .mockResolvedValue({
        ok: true,
        json: async () => ({ status: "healthy" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { BackendManager } = await import("./backend-manager");
    const manager = new BackendManager();

    (manager as unknown as { status: string }).status = "running";
    (manager as unknown as { port: number }).port = 64147;
    (manager as unknown as { notifyRenderer: ReturnType<typeof vi.fn> }).notifyRenderer = vi.fn();

    (manager as unknown as { startHealthMonitor: () => void }).startHealthMonitor();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(manager.getInfo().status).toBe("running");
    expect(
      (manager as unknown as { consecutiveHealthFailures: number }).consecutiveHealthFailures,
    ).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);

    expect(manager.getInfo().status).toBe("running");
    expect(
      (manager as unknown as { consecutiveHealthFailures: number }).consecutiveHealthFailures,
    ).toBe(0);

    (manager as unknown as { stopHealthMonitor: () => void }).stopHealthMonitor();
  });

  it("prefers the bundled runtime and tags the backend process accordingly", async () => {
    makeUserDataDir();

    const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-backend-resources-"));
    tempDirs.push(resourcesDir);
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = resourcesDir;

    const backendDir = path.join(resourcesDir, "backend");
    const pythonPath = process.platform === "win32"
      ? path.join(backendDir, "python-runtime", "python", "python.exe")
      : path.join(backendDir, "python-runtime", "python", "bin", "python3");
    const pyinstallerBackend = process.platform === "win32"
      ? path.join(backendDir, "nirs4all-backend.exe")
      : path.join(backendDir, "nirs4all-backend");

    fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
    fs.writeFileSync(pyinstallerBackend, "");

    const { BackendManager } = await import("./backend-manager");
    const manager = new BackendManager();
    manager.setEnvManager({
      getConfiguredRuntimeMode: () => "bundled",
      getConfiguredPythonPath: () => pythonPath,
      getSettingsPath: () => path.join(resourcesDir, "env-settings.json"),
      isBundled: () => true,
    } as unknown as Parameters<typeof manager.setEnvManager>[0]);

    const launch = (manager as unknown as { getBackendPath: () => { command: string; cwd?: string; env?: Record<string, string> } }).getBackendPath();

    expect(launch.command).toBe(pythonPath);
    expect(launch.cwd).toBe(backendDir);
    expect(launch.env?.NIRS4ALL_RUNTIME_MODE).toBe("bundled");
    expect(launch.env?.NIRS4ALL_RUNTIME_KIND).toBe("bundled");
    expect(launch.env?.NIRS4ALL_IS_BUNDLED_DEFAULT).toBe("true");
    expect(launch.env?.NIRS4ALL_BUNDLED_RUNTIME_AVAILABLE).toBe("true");
  });

  it("uses the configured custom Python in dev mode instead of forcing ../.venv", async () => {
    makeUserDataDir();
    process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5173";

    const customPython = path.join(os.tmpdir(), "n4a-custom-python", "python.exe");

    const { BackendManager } = await import("./backend-manager");
    const manager = new BackendManager();
    manager.setEnvManager({
      getConfiguredRuntimeMode: () => "custom",
      getConfiguredPythonPath: () => customPython,
      getSettingsPath: () => path.join(os.tmpdir(), "env-settings.json"),
      isBundled: () => false,
    } as unknown as Parameters<typeof manager.setEnvManager>[0]);

    const launch = (manager as unknown as { getBackendPath: () => { command: string; cwd?: string; env?: Record<string, string> } }).getBackendPath();

    expect(launch.command).toBe(customPython);
    expect(launch.cwd).toBe(process.cwd());
    expect(launch.env?.NIRS4ALL_RUNTIME_MODE).toBe("development");
    expect(launch.env?.NIRS4ALL_RUNTIME_KIND).toBe("custom");
    expect(launch.env?.NIRS4ALL_IS_BUNDLED_DEFAULT).toBe("false");
    expect(launch.env?.NIRS4ALL_BUNDLED_RUNTIME_AVAILABLE).toBe("false");
  });

  it("uses an external configured Python when a packaged bundled build has been switched away from its embedded runtime", async () => {
    makeUserDataDir();
    fakeApp.isPackaged = true;

    const resourcesDir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-backend-bundled-external-"));
    tempDirs.push(resourcesDir);
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = resourcesDir;

    const backendDir = path.join(resourcesDir, "backend");
    const externalPython = path.join(os.tmpdir(), "n4a-external-python", "python.exe");

    const { BackendManager } = await import("./backend-manager");
    const manager = new BackendManager();
    manager.setEnvManager({
      getConfiguredRuntimeMode: () => "custom",
      getConfiguredPythonPath: () => externalPython,
      getSettingsPath: () => path.join(resourcesDir, "env-settings.json"),
      isBundled: () => true,
    } as unknown as Parameters<typeof manager.setEnvManager>[0]);

    const launch = (manager as unknown as {
      getBackendPath: () => { command: string; cwd?: string; env?: Record<string, string> };
    }).getBackendPath();

    expect(launch.command).toBe(externalPython);
    expect(launch.cwd).toBe(backendDir);
    expect(launch.env?.NIRS4ALL_RUNTIME_MODE).toBe("managed");
    expect(launch.env?.NIRS4ALL_RUNTIME_KIND).toBe("custom");
    expect(launch.env?.NIRS4ALL_IS_BUNDLED_DEFAULT).toBe("false");
    expect(launch.env?.NIRS4ALL_BUNDLED_RUNTIME_AVAILABLE).toBe("true");
  });

  it("falls back to the dev .venv only when no desktop runtime is configured", async () => {
    makeUserDataDir();
    process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5173";

    const { BackendManager } = await import("./backend-manager");
    const manager = new BackendManager();
    manager.setEnvManager({
      getConfiguredRuntimeMode: () => "none",
      getConfiguredPythonPath: () => null,
      getSettingsPath: () => path.join(os.tmpdir(), "env-settings.json"),
      isBundled: () => false,
    } as unknown as Parameters<typeof manager.setEnvManager>[0]);

    const launch = (manager as unknown as { getBackendPath: () => { command: string; cwd?: string; env?: Record<string, string> } }).getBackendPath();

    expect(launch.command).toContain(`${path.sep}.venv${path.sep}`);
    expect(launch.cwd).toBe(process.cwd());
    expect(launch.env?.NIRS4ALL_RUNTIME_MODE).toBe("development");
    expect(launch.env?.NIRS4ALL_RUNTIME_KIND).toBe("development");
    expect(launch.env?.NIRS4ALL_BUNDLED_RUNTIME_AVAILABLE).toBe("false");
  });

  it("reuses an explicit backend port when smoke tests force one", async () => {
    makeUserDataDir();
    process.env.NIRS4ALL_BACKEND_PORT = "43123";

    const { BackendManager } = await import("./backend-manager");
    const manager = new BackendManager();

    await expect(
      (manager as unknown as { resolveStartupPort: () => Promise<number> }).resolveStartupPort(),
    ).resolves.toBe(43123);
  });

  it("rejects an invalid forced backend port", async () => {
    makeUserDataDir();
    process.env.NIRS4ALL_BACKEND_PORT = "70000";

    const { BackendManager } = await import("./backend-manager");
    const manager = new BackendManager();

    await expect(
      (manager as unknown as { resolveStartupPort: () => Promise<number> }).resolveStartupPort(),
    ).rejects.toThrow("Invalid NIRS4ALL_BACKEND_PORT value: 70000");
  });
});
