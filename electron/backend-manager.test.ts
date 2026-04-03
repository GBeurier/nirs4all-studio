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
  vi.resetModules();

  childProcessMocks.spawn.mockReset();
  fakeApp.getPath.mockReset();
  fakeApp.getVersion.mockReset();
  fakeApp.getVersion.mockReturnValue("0.3.3");
  fakeBrowserWindow.getAllWindows.mockReset();
  fakeBrowserWindow.getAllWindows.mockReturnValue([]);

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

    expect(manager.getInfo().status).toBe("error");
    expect(manager.getInfo().error).toBe("Maximum restart attempts exceeded");

    (manager as unknown as { stopHealthMonitor: () => void }).stopHealthMonitor();
  });
});
