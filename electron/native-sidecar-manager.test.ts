import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
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

function writePackagedContract(
  resourcesPath: string,
  sidecarPath: string,
  pythonPath: string,
): void {
  const backendRoot = path.join(resourcesPath, "backend");
  const sitePackagesPath = path.join(
    backendRoot,
    "python-runtime",
    "python",
    "lib",
    "python3.11",
    "site-packages",
  );
  const packagePath = path.join(sitePackagesPath, "nirs4all.py");
  fs.mkdirSync(sitePackagesPath, { recursive: true });
  fs.writeFileSync(packagePath, "def studio_scientific_job_v1(): pass\n");
  const describe = (filePath: string, memberPath: string) => {
    const content = fs.readFileSync(filePath);
    return {
      path: memberPath,
      size: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  };
  const runtimeRoot = path.join(backendRoot, "python-runtime", "python");
  const closure = {
    schema: "nirs4all.studio-python-plugin-closure.v1",
    root: "python-runtime/python",
    site_packages: "python-runtime/python/lib/python3.11/site-packages",
    directories: [
      "",
      "bin",
      "lib",
      "lib/python3.11",
      "lib/python3.11/site-packages",
    ],
    files: [pythonPath, packagePath]
      .map((filePath) => describe(filePath, path.relative(runtimeRoot, filePath)))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  const closurePath = path.join(
    backendRoot,
    "python-runtime",
    "PYTHON_PLUGIN_CLOSURE.json",
  );
  fs.writeFileSync(closurePath, `${JSON.stringify(closure)}\n`);
  const markerPath = path.join(
    backendRoot,
    "python-runtime",
    "PLUGIN_RUNTIME_READY.json",
  );
  fs.writeFileSync(markerPath, JSON.stringify({
    schema: "nirs4all.studio-python-plugin-runtime.v1",
    python_role: "library-plugin-host-only",
    product_backend: "rust-sidecar",
    transport: "bounded-cpython-stdio-v1",
    http_listener: "forbidden",
    source_commit: "6429974a88cccc3fbf8dbe8aeb060435381f2bd4",
    wheel_sha256: "7387eb80516c98a8d01e5ac5743ed058035fcb69cd22cc4d162c57b7a32e7259",
    distribution: "nirs4all",
    distribution_version: "1.0.0rc2",
    installed_manifest_sha256: "52767f7b8fdfaf1443873070f1e0cc1a4b22f5668c9a7baa6faf22e2a45f3fa5",
    conversion_tools: {
      source_commit: "88c2bc1e29603049cdbf1a1080a35845edf2f3c9",
      wheel_sha256: "4f1c2e65ba42af9dc807e0704b7c6ec6b80efc22169d43f8051ae47f679cd819",
      distribution: "nirs4all-tools",
      distribution_version: "0.0.7",
      installed_manifest_sha256: "cd0311a57c4be4cd99f84b8ae750eb2f97d4edf765bb0e8717a9ea181724ae07",
      module: "nirs4all_tools",
      cli: "python -I -B -m nirs4all_tools",
      readers: { duckdb: "1.5.5", pyarrow: "25.0.1" },
      functional_probes: {
        duckdb: "in-memory-select-40-plus-2",
        pyarrow_parquet: "in-memory-round-trip",
      },
    },
    platform: "linux",
    arch: process.arch,
    forbidden_distributions: [
      "fastapi", "httptools", "python-multipart", "sentry-sdk", "starlette",
      "uvicorn", "uvloop", "watchfiles", "websockets",
    ],
  }));
  fs.writeFileSync(
    path.join(
      resourcesPath,
      "backend",
      "native",
      "STUDIO_RUNTIME_CONTRACT.json",
    ),
    JSON.stringify({
      schema: "nirs4all.studio-packaged-runtime.v1",
      platform: "linux",
      arch: process.arch,
      product_backend: "rust-sidecar",
      python_role: "library-plugin-host-only",
      sidecar: describe(sidecarPath, "native/studio-sidecar"),
      python_plugin_host: {
        mode: "bundled-required",
        member: describe(
          pythonPath,
          "python-runtime/python/bin/python3",
        ),
        closure: describe(
          closurePath,
          "python-runtime/PYTHON_PLUGIN_CLOSURE.json",
        ),
        runtime_root: "python-runtime/python",
        site_packages: "python-runtime/python/lib/python3.11/site-packages",
        marker: describe(
          markerPath,
          "python-runtime/PLUGIN_RUNTIME_READY.json",
        ),
      },
      methods_library: {
        mode: "unavailable",
        member: null,
        abi: { major: 2, minor: 5 },
        source: {
          commit: "48ad1e5a50844f68c2b99e93b02ad6a3b491c07b",
          tree: "f2eaa3c46629c26d11913a25bff723f9a9cefbc9",
          project_version: "1.0.15",
        },
      },
    }),
  );
}

afterEach(() => {
  delete process.env.NIRS4ALL_NATIVE_SIDECAR_PATH;
  delete process.env.NIRS4ALL_NATIVE_SIDECAR_PORT;
  delete process.env.NIRS4ALL_ENABLE_NATIVE_SIDECAR;
  delete process.env.NIRS4ALL_PYTHON_PLUGIN_HOST;
  delete process.env.NIRS4ALL_PYTHON_PLUGIN_HOST_BUNDLED;
  delete process.env.NIRS4ALL_SCIENTIFIC_EXECUTOR;
  childProcessMocks.spawn.mockReset();
  vi.resetModules();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("NativeSidecarManager", () => {
  it("resolves an explicit binary before a product-enabled packaged resource", async () => {
    const { resolveNativeSidecarPath } = await import("./native-sidecar-manager");

    expect(
      resolveNativeSidecarPath({
        environment: {
          NIRS4ALL_NATIVE_SIDECAR_PATH: "tools/studio-sidecar",
          NIRS4ALL_ENABLE_NATIVE_SIDECAR: "1",
        },
        resourcesPath: "/app/resources",
        platform: "linux",
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
    ).toBe("/app/resources/backend/native/studio-sidecar.exe");
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

  it("refuses a packaged sidecar without its content contract", async () => {
    const resourcesPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "n4a-packaged-sidecar-missing-contract-"),
    );
    tempDirs.push(resourcesPath);
    const sidecarPath = path.join(
      resourcesPath,
      "backend",
      "native",
      "studio-sidecar",
    );
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.writeFileSync(sidecarPath, "unverified");
    const { NativeSidecarManager } = await import("./native-sidecar-manager");

    await expect(
      new NativeSidecarManager().start({
        allowPackagedResource: true,
        resourcesPath,
        platform: "linux",
        arch: process.arch,
      }),
    ).resolves.toMatchObject({
      status: "error",
      error: expect.stringContaining("Packaged runtime contract not found"),
    });
    expect(childProcessMocks.spawn).not.toHaveBeenCalled();
  });

  it("keeps Rust selected when the bundled Python plugin host disappears", async () => {
    const resourcesPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "n4a-packaged-sidecar-no-python-"),
    );
    tempDirs.push(resourcesPath);
    const sidecarPath = path.join(resourcesPath, "backend", "native", "studio-sidecar");
    const pythonPath = path.join(
      resourcesPath,
      "backend",
      "python-runtime",
      "python",
      "bin",
      "python3",
    );
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
    fs.writeFileSync(sidecarPath, "verified-rust-sidecar");
    fs.writeFileSync(pythonPath, "verified-python-host");
    writePackagedContract(resourcesPath, sidecarPath, pythonPath);
    fs.rmSync(pythonPath);

    const child = makeProcess();
    childProcessMocks.spawn.mockReturnValue(child);
    const { NativeSidecarManager } = await import("./native-sidecar-manager");
    const manager = new NativeSidecarManager();
    const startup = manager.start({
      allowPackagedResource: true,
      resourcesPath,
      platform: "linux",
      arch: process.arch,
    });
    const spawnOptions = childProcessMocks.spawn.mock.calls[0]?.[2] as {
      env: NodeJS.ProcessEnv;
    };
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
    expect(childProcessMocks.spawn.mock.calls[0]?.[0]).toBe(sidecarPath);
    expect(childProcessMocks.spawn.mock.calls[0]?.[1]).toEqual([
      "--host",
      "127.0.0.1",
      "--port",
      "0",
    ]);
    expect(childProcessMocks.spawn.mock.calls[0]?.[0]).toBe(sidecarPath);
    expect(spawnOptions.env.NIRS4ALL_PYTHON_PLUGIN_HOST).toBeUndefined();
    expect(spawnOptions.env.NIRS4ALL_SCIENTIFIC_EXECUTOR).toBeUndefined();
    child.stdout.emit(
      "data",
      Buffer.from(
        'STUDIO_SIDECAR_READY {"protocol_version":"studio-sidecar-r1","host":"127.0.0.1","port":43123}\n',
      ),
    );
    await expect(startup).resolves.toMatchObject({
      status: "running",
      pythonPluginHostConfigured: false,
      pythonPluginHostError: expect.stringContaining(
        "Bundled Python plugin host not found",
      ),
    });
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
        env: expect.objectContaining({
          NIRS4ALL_PYTHON_PLUGIN_HOST: "/plugin-host/python",
        }),
        windowsHide: true,
      }),
    );
    const developmentEnvironment = childProcessMocks.spawn.mock.calls[0]?.[2]
      ?.env as NodeJS.ProcessEnv;
    expect(developmentEnvironment.NIRS4ALL_SCIENTIFIC_EXECUTOR).toBeUndefined();
    child.stdout.emit(
      "data",
      Buffer.from(
        'STUDIO_SIDECAR_READY {"protocol_version":"studio-sidecar-r1","host":"127.0.0.1","port":43123}\n',
      ),
    );

    await expect(startup).resolves.toMatchObject({
      status: "running",
      host: "127.0.0.1",
      port: 43123,
      protocolVersion: "studio-sidecar-r1",
      url: "http://127.0.0.1:43123",
    });
  });

  it("passes the selected interpreter and product runtime metadata to the sidecar", async () => {
    process.env.NIRS4ALL_NATIVE_SIDECAR_PATH = makeExecutable();
    const child = makeProcess();
    childProcessMocks.spawn.mockReturnValue(child);
    const { NativeSidecarManager } = await import("./native-sidecar-manager");
    const manager = new NativeSidecarManager();

    const startup = manager.start({
      pythonPluginHost: "/selected-runtime/python",
      runtimeMode: "bundled",
      runtimeKind: "bundled",
      buildInfoPath: "/resources/backend/python-runtime/build_info.json",
      appVersion: "0.9.1",
    });
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      path.resolve(process.env.NIRS4ALL_NATIVE_SIDECAR_PATH),
      ["--host", "127.0.0.1", "--port", "0"],
      expect.objectContaining({
        env: expect.objectContaining({
          NIRS4ALL_PYTHON_PLUGIN_HOST: "/selected-runtime/python",
          NIRS4ALL_RUNTIME_MODE: "bundled",
          NIRS4ALL_RUNTIME_KIND: "bundled",
          NIRS4ALL_BUILD_INFO_PATH:
            "/resources/backend/python-runtime/build_info.json",
          NIRS4ALL_APP_VERSION: "0.9.1",
        }),
        windowsHide: true,
      }),
    );
    const selectedEnvironment = childProcessMocks.spawn.mock.calls[0]?.[2]
      ?.env as NodeJS.ProcessEnv;
    expect(selectedEnvironment.NIRS4ALL_SCIENTIFIC_EXECUTOR).toBeUndefined();
    child.stdout.emit(
      "data",
      Buffer.from(
        'STUDIO_SIDECAR_READY {"protocol_version":"studio-sidecar-r1","host":"127.0.0.1","port":43123}\n',
      ),
    );
    await expect(startup).resolves.toMatchObject({
      status: "running",
      pythonPluginHostConfigured: true,
    });
  });

  it("ignores user and managed interpreters for a packaged product", async () => {
    const resourcesPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "n4a-packaged-sidecar-strict-python-"),
    );
    tempDirs.push(resourcesPath);
    const sidecarPath = path.join(
      resourcesPath,
      "backend",
      "native",
      "studio-sidecar",
    );
    const pythonPath = path.join(
      resourcesPath,
      "backend",
      "python-runtime",
      "python",
      "bin",
      "python3",
    );
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
    fs.writeFileSync(sidecarPath, "verified-rust-sidecar");
    fs.writeFileSync(pythonPath, "verified-python-host");
    writePackagedContract(resourcesPath, sidecarPath, pythonPath);
    process.env.NIRS4ALL_PYTHON_PLUGIN_HOST = "/user/venv/bin/python";

    const child = makeProcess();
    childProcessMocks.spawn.mockReturnValue(child);
    const { NativeSidecarManager } = await import("./native-sidecar-manager");
    const startup = new NativeSidecarManager().start({
      allowPackagedResource: true,
      resourcesPath,
      platform: "linux",
      arch: process.arch,
      pythonPluginHost: "/managed/runtime/bin/python",
    });
    const spawnOptions = childProcessMocks.spawn.mock.calls[0]?.[2] as {
      env: NodeJS.ProcessEnv;
    };
    expect(spawnOptions.env.NIRS4ALL_PYTHON_PLUGIN_HOST).toBe(pythonPath);
    expect(childProcessMocks.spawn).toHaveBeenCalledTimes(1);
    expect(childProcessMocks.spawn.mock.calls[0]?.[0]).toBe(sidecarPath);
    expect(spawnOptions.env.NIRS4ALL_PYTHON_PLUGIN_HOST).not.toContain("venv");
    expect(spawnOptions.env.NIRS4ALL_PYTHON_PLUGIN_CLOSURE).toBe(
      path.join(
        resourcesPath,
        "backend",
        "python-runtime",
        "PYTHON_PLUGIN_CLOSURE.json",
      ),
    );
    expect(spawnOptions.env.NIRS4ALL_PYTHON_PLUGIN_SITE_PACKAGES).toBe(
      path.join(
        resourcesPath,
        "backend",
        "python-runtime",
        "python",
        "lib",
        "python3.11",
        "site-packages",
      ),
    );
    expect(spawnOptions.env.NIRS4ALL_SCIENTIFIC_EXECUTOR).toBe(
      "cpython-stdio-v1",
    );
    child.stdout.emit(
      "data",
      Buffer.from(
        'STUDIO_SIDECAR_READY {"protocol_version":"studio-sidecar-r1","host":"127.0.0.1","port":43123}\n',
      ),
    );
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
});
