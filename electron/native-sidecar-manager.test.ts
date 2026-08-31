import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: childProcessMocks.spawn }));

const tempDirs: string[] = [];

function makeExecutable(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-sidecar-manager-"));
  tempDirs.push(dir);
  const executable = path.join(dir, "studio-sidecar");
  fs.writeFileSync(executable, "placeholder");
  return executable;
}

function makeProcess() {
  const process = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  process.kill = vi.fn(() => true);
  return process;
}

afterEach(() => {
  delete process.env.NIRS4ALL_NATIVE_SIDECAR_PATH;
  delete process.env.NIRS4ALL_NATIVE_SIDECAR_PORT;
  delete process.env.NIRS4ALL_ENABLE_NATIVE_SIDECAR;
  delete process.env.NIRS4ALL_PYTHON_PLUGIN_HOST;
  childProcessMocks.spawn.mockReset();
  vi.resetModules();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("NativeSidecarManager", () => {
  it("resolves an explicit binary before an opt-in packaged resource", async () => {
    const { resolveBundledPythonPluginHost, resolveNativeSidecarPath } = await import("./native-sidecar-manager");

    expect(
      resolveNativeSidecarPath({
        environment: {
          NIRS4ALL_NATIVE_SIDECAR_PATH: "tools/studio-sidecar",
          NIRS4ALL_ENABLE_NATIVE_SIDECAR: "1",
        },
        resourcesPath: "/app/resources",
        platform: "linux",
      }),
    ).toBe(path.resolve("tools/studio-sidecar"));
    expect(
      resolveNativeSidecarPath({
        environment: { NIRS4ALL_ENABLE_NATIVE_SIDECAR: "1" },
        resourcesPath: "/app/resources",
        platform: "win32",
      }),
    ).toBe("/app/resources/backend/native/studio-sidecar.exe");
    expect(resolveNativeSidecarPath({ environment: {}, resourcesPath: "/app/resources" })).toBeNull();

    const resources = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-sidecar-runtime-"));
    tempDirs.push(resources);
    const bundledPython = path.join(resources, "backend", "python-runtime", "python", "bin", "python3");
    fs.mkdirSync(path.dirname(bundledPython), { recursive: true });
    fs.writeFileSync(bundledPython, "placeholder");
    expect(resolveBundledPythonPluginHost({ resourcesPath: resources, platform: "linux" })).toBe(bundledPython);
  });

  it("stays disabled without an explicit sidecar binary", async () => {
    const { NativeSidecarManager } = await import("./native-sidecar-manager");

    await expect(new NativeSidecarManager().start()).resolves.toMatchObject({
      status: "disabled",
      url: null,
    });
    expect(childProcessMocks.spawn).not.toHaveBeenCalled();
  });

  it("launches only a loopback sidecar and records its readiness contract", async () => {
    process.env.NIRS4ALL_NATIVE_SIDECAR_PATH = makeExecutable();
    process.env.NIRS4ALL_PYTHON_PLUGIN_HOST = "/plugin-host/python";
    const child = makeProcess();
    childProcessMocks.spawn.mockReturnValue(child);
    const { NativeSidecarManager } = await import("./native-sidecar-manager");
    const manager = new NativeSidecarManager();

    const startup = manager.start();
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      path.resolve(process.env.NIRS4ALL_NATIVE_SIDECAR_PATH),
      ["--host", "127.0.0.1", "--port", "0"],
      expect.objectContaining({
        env: expect.objectContaining({ NIRS4ALL_PYTHON_PLUGIN_HOST: "/plugin-host/python" }),
        windowsHide: true,
      }),
    );
    child.stdout.emit(
      "data",
      Buffer.from('STUDIO_SIDECAR_READY {"protocol_version":"studio-sidecar-r1","host":"127.0.0.1","port":43123}\n'),
    );

    await expect(startup).resolves.toMatchObject({
      status: "running",
      host: "127.0.0.1",
      port: 43123,
      protocolVersion: "studio-sidecar-r1",
      url: "http://127.0.0.1:43123",
    });
  });

  it("rejects a readiness line that exposes a non-loopback host", async () => {
    process.env.NIRS4ALL_NATIVE_SIDECAR_PATH = makeExecutable();
    const child = makeProcess();
    childProcessMocks.spawn.mockReturnValue(child);
    const { NativeSidecarManager } = await import("./native-sidecar-manager");
    const manager = new NativeSidecarManager();

    const startup = manager.start();
    child.stdout.emit(
      "data",
      Buffer.from('STUDIO_SIDECAR_READY {"protocol_version":"studio-sidecar-r1","host":"0.0.0.0","port":43123}\n'),
    );

    await expect(startup).rejects.toThrow("bind exactly to 127.0.0.1");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(manager.getInfo()).toMatchObject({ status: "error" });
  });

  it("stops an active sidecar before Electron exits", async () => {
    process.env.NIRS4ALL_NATIVE_SIDECAR_PATH = makeExecutable();
    const child = makeProcess();
    childProcessMocks.spawn.mockReturnValue(child);
    const { NativeSidecarManager } = await import("./native-sidecar-manager");
    const manager = new NativeSidecarManager();

    const startup = manager.start();
    child.stdout.emit(
      "data",
      Buffer.from('STUDIO_SIDECAR_READY {"protocol_version":"studio-sidecar-r1","host":"127.0.0.1","port":43123}\n'),
    );
    await startup;

    const stop = manager.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("exit", 0, null);
    await stop;
    expect(manager.getInfo()).toMatchObject({ status: "stopped", url: "http://127.0.0.1:43123" });
  });
});
