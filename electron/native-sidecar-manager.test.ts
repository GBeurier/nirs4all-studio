import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({ spawn: vi.fn() }));
const contractMocks = vi.hoisted(() => ({ verifyPackagedRuntimeContract: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: childProcessMocks.spawn }));
// The packaged contract has its own tests; here it only names the verified sidecar.
vi.mock("./packaged-runtime-contract", () => contractMocks);

const tempDirs: string[] = [];
const fixturePlatform = process.platform;
const READY_LINE = 'STUDIO_SIDECAR_READY {"protocol_version":"studio-sidecar-r1","host":"127.0.0.1","port":43123}\n';

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
  delete process.env.NIRS4ALL_PYTHON_PLUGIN_SITE_PACKAGES;
  delete process.env.NIRS4ALL_SCIENTIFIC_EXECUTOR;
  delete process.env.NIRS4ALL_STUDIO_ADAPTERS_DIR;
  delete process.env.NIRS4ALL_ALL_IN_ONE;
  delete process.env.NIRS4ALL_BUNDLED_RUNTIME_AVAILABLE;
  delete process.env.NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN;
  delete process.env.NIRS4ALL_APP_DIR;
  delete process.env.NIRS4ALL_APP_EXE;
  delete process.env.NIRS4ALL_ELECTRON_PID;
  delete process.env.NIRS4ALL_ELECTRON;
  childProcessMocks.spawn.mockReset();
  contractMocks.verifyPackagedRuntimeContract.mockReset();
  vi.resetModules();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("NativeSidecarManager", () => {
  it("accepts an explicit random archive-smoke token only inside CI", async () => {
    const { createNativeSessionToken } = await import("./native-sidecar-manager");
    const token = "A".repeat(64);

    expect(createNativeSessionToken({
      CI: "1",
      NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN: token,
    })).toBe(token);
    expect(createNativeSessionToken({
      NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN: token,
    })).toMatch(/^[a-f0-9]{64}$/);
    expect(() => createNativeSessionToken({
      CI: "1",
      NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN: "too-short",
    })).toThrow(/32\.\.256 ASCII letters\/digits/);
  });

  it("resolves an explicit binary before a product-enabled packaged resource", async () => {
    const { resolveNativeSidecarPath } = await import("./native-sidecar-manager");

    expect(
      resolveNativeSidecarPath({
        environment: {
          NIRS4ALL_NATIVE_SIDECAR_PATH: "tools/studio-sidecar",
          NIRS4ALL_ENABLE_NATIVE_SIDECAR: "1",
        },
        resourcesPath: "/app/resources",
        platform: fixturePlatform,
        allowPackagedResource: true,
      }),
    ).toBe(path.resolve("tools/studio-sidecar"));
    expect(
      resolveNativeSidecarPath({
        environment: {},
        resourcesPath: "/app/resources",
        platform: "win32",
        allowPackagedResource: true,
      }),
    ).toBe(path.join("/app/resources", "backend", "native", "studio-sidecar.exe"));
    expect(
      resolveNativeSidecarPath({
        environment: {},
        resourcesPath: "/app/resources",
      }),
    ).toBeNull();

  });

  it("stays disabled without an explicit sidecar binary", async () => {
    const { NativeSidecarManager } = await import("./native-sidecar-manager");

    await expect(new NativeSidecarManager().start()).resolves.toMatchObject({
      status: "disabled",
      url: null,
    });
    expect(childProcessMocks.spawn).not.toHaveBeenCalled();
  });

  it("refuses a packaged sidecar whose content contract does not verify", async () => {
    contractMocks.verifyPackagedRuntimeContract.mockImplementation(() => {
      throw new Error("Packaged runtime contract not found: STUDIO_RUNTIME_CONTRACT.json");
    });
    const { NativeSidecarManager } = await import("./native-sidecar-manager");

    await expect(
      new NativeSidecarManager().start({
        allowPackagedResource: true,
        resourcesPath: "/app/resources",
        platform: fixturePlatform,
        arch: process.arch,
      }),
    ).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("Packaged runtime contract not found"),
    });
    expect(contractMocks.verifyPackagedRuntimeContract).toHaveBeenCalledWith({
      resourcesPath: "/app/resources", platform: fixturePlatform, arch: process.arch,
    });
    expect(childProcessMocks.spawn).not.toHaveBeenCalled();
  });

  it("starts the verified packaged sidecar without Python when no environment is usable", async () => {
    const sidecarPath = makeExecutable();
    contractMocks.verifyPackagedRuntimeContract.mockReturnValue({ sidecarPath });
    // Variables of the launching shell never select an interpreter.
    process.env.NIRS4ALL_PYTHON_PLUGIN_HOST = "/user/venv/bin/python";
    process.env.NIRS4ALL_PYTHON_PLUGIN_SITE_PACKAGES = "/user/venv/lib/site-packages";
    process.env.NIRS4ALL_SCIENTIFIC_EXECUTOR = "cpython-stdio-v1";
    process.env.NIRS4ALL_STUDIO_ADAPTERS_DIR = "/user/adapters";
    // Nor may stray updater variables enable an in-place update of the installation.
    process.env.NIRS4ALL_ALL_IN_ONE = "true";
    process.env.NIRS4ALL_BUNDLED_RUNTIME_AVAILABLE = "true";
    const child = makeProcess();
    childProcessMocks.spawn.mockReturnValue(child);
    const { NativeSidecarManager } = await import("./native-sidecar-manager");

    const startup = new NativeSidecarManager().start({
      allowPackagedResource: true,
      resourcesPath: "/app/resources",
      platform: fixturePlatform,
      arch: process.arch,
      // Adapters alone do not configure a host.
      studioAdaptersDir: "/app/resources/backend/adapters",
    });
    const spawnOptions = childProcessMocks.spawn.mock.calls[0]?.[2] as { env: NodeJS.ProcessEnv };
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
    expect(childProcessMocks.spawn.mock.calls[0]?.[0]).toBe(sidecarPath);
    expect(childProcessMocks.spawn.mock.calls[0]?.[1]).toEqual(["--host", "127.0.0.1", "--port", "0"]);
    expect(spawnOptions.env.NIRS4ALL_PYTHON_PLUGIN_HOST).toBeUndefined();
    expect(spawnOptions.env.NIRS4ALL_PYTHON_PLUGIN_SITE_PACKAGES).toBeUndefined();
    expect(spawnOptions.env.NIRS4ALL_SCIENTIFIC_EXECUTOR).toBeUndefined();
    expect(spawnOptions.env.NIRS4ALL_STUDIO_ADAPTERS_DIR).toBeUndefined();
    expect(spawnOptions.env.NIRS4ALL_ALL_IN_ONE).toBeUndefined();
    expect(spawnOptions.env.NIRS4ALL_BUNDLED_RUNTIME_AVAILABLE).toBeUndefined();
    child.stdout.emit("data", Buffer.from(READY_LINE));
    await expect(startup).resolves.toMatchObject({
      status: "running",
      pythonPluginHostConfigured: false,
    });
  });

  it("launches only a loopback sidecar and records its readiness contract", async () => {
    process.env.NIRS4ALL_NATIVE_SIDECAR_PATH = makeExecutable();
    const child = makeProcess();
    childProcessMocks.spawn.mockReturnValue(child);
    const { NativeSidecarManager } = await import("./native-sidecar-manager");
    const manager = new NativeSidecarManager();

    const startup = manager.start();
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      path.resolve(process.env.NIRS4ALL_NATIVE_SIDECAR_PATH),
      ["--host", "127.0.0.1", "--port", "0"],
      expect.objectContaining({ windowsHide: true }),
    );
    // An explicit development binary is not checked against the packaged contract.
    expect(contractMocks.verifyPackagedRuntimeContract).not.toHaveBeenCalled();
    const developmentEnvironment = childProcessMocks.spawn.mock.calls[0]?.[2]
      ?.env as NodeJS.ProcessEnv;
    child.stdout.emit("data", Buffer.from(READY_LINE));

    await expect(startup).resolves.toMatchObject({
      status: "running",
      host: "127.0.0.1",
      port: 43123,
      protocolVersion: "studio-sidecar-r1",
      url: "http://127.0.0.1:43123",
      pythonPluginHostConfigured: false,
    });
    const token = developmentEnvironment.NIRS4ALL_STUDIO_SESSION_TOKEN;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(manager.getInfo())).not.toContain(token);
    expect(manager.sessionHeaders("http://127.0.0.1:43123/api/health"))
      .toEqual({ "X-Nirs4all-Session": token });
    expect(manager.sessionHeaders("ws://127.0.0.1:43123/ws"))
      .toEqual({ "X-Nirs4all-Session": token });
    for (const url of ["http://untrusted.example:43123/", "http://127.0.0.1:9999/", "http://user@127.0.0.1:43123/", "https://127.0.0.1:43123/", "invalid"]) {
      expect(manager.sessionHeaders(url)).toEqual({});
    }
    child.emit("exit", 0, null);
    expect(manager.sessionHeaders("http://127.0.0.1:43123/api/health")).toEqual({});
  });

  it("hands the selected interpreter, its packages, the stdio executor and Studio's adapters to the sidecar", async () => {
    process.env.NIRS4ALL_NATIVE_SIDECAR_PATH = makeExecutable();
    process.env.NIRS4ALL_PYTHON_PLUGIN_HOST = "/inherited/python";
    process.env.NIRS4ALL_APP_DIR = "/spoofed/app";
    process.env.NIRS4ALL_APP_EXE = "spoofed.exe";
    process.env.NIRS4ALL_ELECTRON_PID = "999999";
    const child = makeProcess();
    childProcessMocks.spawn.mockReturnValue(child);
    const { NativeSidecarManager } = await import("./native-sidecar-manager");
    const manager = new NativeSidecarManager();

    const startup = manager.start({
      pythonPluginHost: "/data/python-env/venv/bin/python",
      pythonPluginSitePackages: "/data/python-env/venv/lib/python3.11/site-packages",
      studioAdaptersDir: "/app/resources/backend/adapters",
      buildInfoPath: "/app/resources/backend/build_info.json",
      appVersion: "0.16.0",
    });
    const environment = childProcessMocks.spawn.mock.calls[0]?.[2]?.env as NodeJS.ProcessEnv;
    const python = Object.fromEntries(Object.entries(environment).filter(([name]) => (
      /^NIRS4ALL_(PYTHON_|SCIENTIFIC_|STUDIO_ADAPTERS)/.test(name)
    )));
    expect(python).toEqual({
      NIRS4ALL_PYTHON_PLUGIN_HOST: "/data/python-env/venv/bin/python",
      NIRS4ALL_PYTHON_PLUGIN_SITE_PACKAGES: "/data/python-env/venv/lib/python3.11/site-packages",
      NIRS4ALL_SCIENTIFIC_EXECUTOR: "cpython-stdio-v1",
      NIRS4ALL_STUDIO_ADAPTERS_DIR: "/app/resources/backend/adapters",
    });
    expect(environment.NIRS4ALL_BUILD_INFO_PATH).toBe("/app/resources/backend/build_info.json");
    expect(environment.NIRS4ALL_APP_VERSION).toBe("0.16.0");
    expect(environment.NIRS4ALL_APP_DIR).toBe(path.dirname(process.execPath));
    expect(environment.NIRS4ALL_APP_EXE).toBe(path.basename(process.execPath));
    expect(environment.NIRS4ALL_ELECTRON_PID).toBe(process.pid.toString());
    expect(environment.NIRS4ALL_ELECTRON).toBe("true");
    // No runtime kind or mode label exists any more.
    expect(Object.keys(environment).filter((name) => name.startsWith("NIRS4ALL_RUNTIME_"))).toEqual([]);
    child.stdout.emit("data", Buffer.from(READY_LINE));
    await expect(startup).resolves.toMatchObject({
      status: "running",
      pythonPluginHostConfigured: true,
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
      Buffer.from(
        'STUDIO_SIDECAR_READY {"protocol_version":"studio-sidecar-r1","host":"0.0.0.0","port":43123}\n',
      ),
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
      Buffer.from(
        'STUDIO_SIDECAR_READY {"protocol_version":"studio-sidecar-r1","host":"127.0.0.1","port":43123}\n',
      ),
    );
    await startup;

    const stop = manager.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.emit("exit", 0, null);
    await stop;
    expect(manager.getInfo()).toMatchObject({
      status: "stopped",
      url: "http://127.0.0.1:43123",
    });
  });

  it("logs sidecar timing diagnostics at debug and the host acquisition at info", async () => {
    const { logSidecarStderr, sidecarStderrLevel } = await import("./native-sidecar-manager");
    expect(sidecarStderrLevel("Studio boundary timing phase=readiness_route elapsed_us=12")).toBe("debug");
    expect(sidecarStderrLevel("Studio performance worker_started pid=4")).toBe("debug");
    expect(sidecarStderrLevel("Studio scientific host packaged ready nirs4all=1.4.16 elapsed_ms=812")).toBe("info");
    expect(sidecarStderrLevel("studio-sidecar connection error: os error 10053")).toBe("error");

    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // Chunks split lines arbitrarily; only complete lines are classified.
      let tail = logSidecarStderr("", "Studio boundary timing phase=a elapsed_us=1\nStudio boundary ti");
      tail = logSidecarStderr(tail, "ming phase=b elapsed_us=2\r\nStudio scientific host selected unavailable reason=python_host_timed_out elapsed_ms=180000\npanic: boom");
      expect(tail).toBe("panic: boom");
      expect(logSidecarStderr(tail, "\n")).toBe("");
      expect(debug.mock.calls.map(([line]) => line)).toEqual([
        "[Native sidecar] Studio boundary timing phase=a elapsed_us=1",
        "[Native sidecar] Studio boundary timing phase=b elapsed_us=2",
      ]);
      expect(log.mock.calls.map(([line]) => line)).toEqual([
        "[Native sidecar] Studio scientific host selected unavailable reason=python_host_timed_out elapsed_ms=180000",
      ]);
      expect(error.mock.calls.map(([line]) => line)).toEqual(["[Native sidecar] panic: boom"]);
    } finally {
      debug.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });
});
