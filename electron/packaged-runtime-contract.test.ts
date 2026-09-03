import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyPackagedRuntimeContract } from "./packaged-runtime-contract";
import { preselectRendererTransport } from "./renderer-transport-selection";

const require = createRequire(import.meta.url);
const { assertPackagedElectronGraph } = require("../scripts/check-packaged-electron-graph.cjs") as {
  assertPackagedElectronGraph(options: { root: string; requireDist: boolean }): {
    sourceFiles: string[];
    distFiles: string[];
  };
};

const tempDirs: string[] = [];

function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function makeResources(): {
  resourcesPath: string;
  sidecarPath: string;
  pythonPath: string;
  sitePackagesPath: string;
} {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-runtime-contract-"));
  tempDirs.push(resourcesPath);
  const backendRoot = path.join(resourcesPath, "backend");
  const sidecarPath = path.join(backendRoot, "native", "studio-sidecar");
  const pythonPath = path.join(
    backendRoot,
    "python-runtime",
    "python",
    "bin",
    "python3",
  );
  const sidecar = Buffer.from("rust-sidecar");
  const python = Buffer.from("python-plugin-host");
  const sitePackagesPath = path.join(
    backendRoot,
    "python-runtime",
    "python",
    "lib",
    "python3.11",
    "site-packages",
  );
  const packagePath = path.join(sitePackagesPath, "nirs4all.py");
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.mkdirSync(sitePackagesPath, { recursive: true });
  fs.writeFileSync(sidecarPath, sidecar);
  fs.writeFileSync(pythonPath, python);
  fs.writeFileSync(packagePath, "def studio_scientific_job_v1(): pass\n");
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
      .map((filePath) => {
        const bytes = fs.readFileSync(filePath);
        return {
          path: path
            .relative(path.join(backendRoot, "python-runtime", "python"), filePath)
            .split(path.sep)
            .join("/"),
          size: bytes.length,
          sha256: digest(bytes),
        };
      })
      .sort((left, right) =>
        Buffer.compare(Buffer.from(left.path, "utf8"), Buffer.from(right.path, "utf8")),
      ),
  };
  const closurePath = path.join(
    backendRoot,
    "python-runtime",
    "PYTHON_PLUGIN_CLOSURE.json",
  );
  fs.writeFileSync(closurePath, `${JSON.stringify(closure)}\n`);
  const closureBytes = fs.readFileSync(closurePath);
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
    source_commit: "3a38f589e5acbda58c5d071c95036f2572972ecd",
    wheel_sha256: "906c151a80c3bbdf2ef1264b904a8fd61a2a67fbe0ded2cba92453e44fbce230",
    distribution: "nirs4all",
    distribution_version: "1.0.0rc2",
    distribution_record_sha256: "896cb15467a2e7864d5458c42ab37501bfb029c6e8d64fc5c8984999c408930b",
    installed_manifest_sha256: "099259cc3b510fd415b573122630a1db9304fdf847589b2ab92de3b3e8b36ba7",
    conversion_tools: {
      source_commit: "e3a332633f87b4652a06f8993e63c386a3568698",
      wheel_sha256: "372ecec41b18c25c607fd660060f19780cdaf8aea378239fa5ade5a61d81c8dc",
      distribution: "nirs4all-tools",
      distribution_version: "0.0.7",
      distribution_record_sha256: "8db345e39929f63e658d33bba1a9379336547e5653ed4b51271792791e5d6f54",
      installed_manifest_sha256: "37e8862680fe35efcf6b3348ad5c064701f8ba90f43be89bd07c632a59a509fb",
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
  const markerBytes = fs.readFileSync(markerPath);
  fs.writeFileSync(
    path.join(backendRoot, "native", "STUDIO_RUNTIME_CONTRACT.json"),
    JSON.stringify({
      schema: "nirs4all.studio-packaged-runtime.v1",
      platform: "linux",
      arch: process.arch,
      product_backend: "rust-sidecar",
      python_role: "library-plugin-host-only",
      sidecar: {
        path: "native/studio-sidecar",
        size: sidecar.length,
        sha256: digest(sidecar),
      },
      python_plugin_host: {
        mode: "bundled-required",
        member: {
          path: "python-runtime/python/bin/python3",
          size: python.length,
          sha256: digest(python),
        },
        closure: {
          path: "python-runtime/PYTHON_PLUGIN_CLOSURE.json",
          size: closureBytes.length,
          sha256: digest(closureBytes),
        },
        runtime_root: "python-runtime/python",
        site_packages: "python-runtime/python/lib/python3.11/site-packages",
        marker: {
          path: "python-runtime/PLUGIN_RUNTIME_READY.json",
          size: markerBytes.length,
          sha256: digest(markerBytes),
        },
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
  return { resourcesPath, sidecarPath, pythonPath, sitePackagesPath };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("packaged runtime contract", () => {
  it("keeps the transitive packaged Electron graph plugin-host only", () => {
    const root = process.cwd();
    const result = assertPackagedElectronGraph({ root, requireDist: false });
    const relativeSources = result.sourceFiles.map((file) => path.relative(root, file));
    expect(relativeSources).toContain("electron/env-manager.ts");
    expect(relativeSources).toContain("electron/env/provisioning.ts");
    expect(relativeSources).toContain("scripts/python-runtime-config.cjs");
    expect(relativeSources).not.toContain("scripts/python-http-runtime-config.cjs");
    expect(
      fs.existsSync(path.join(root, "electron/python-http-diagnostic-policy.ts")),
    ).toBe(false);
  });
  it("selects content-addressed Rust and bundled Python resources", () => {
    const fixture = makeResources();
    expect(
      verifyPackagedRuntimeContract({
        resourcesPath: fixture.resourcesPath,
        platform: "linux",
      }),
    ).toMatchObject({
      sidecarPath: fixture.sidecarPath,
      pythonPluginHostPath: fixture.pythonPath,
      pythonPluginHostError: null,
      pythonSitePackagesPath: fixture.sitePackagesPath,
    });
  });

  it("keeps verified packaged stdio execution behind Rust-owned routes", async () => {
    const fixture = makeResources();
    const verified = verifyPackagedRuntimeContract({
      resourcesPath: fixture.resourcesPath,
      platform: "linux",
    });
    expect(verified.pythonPluginHostPath).toBe(fixture.pythonPath);

    const capabilities = vi.fn().mockImplementation(
      async () => new Response(
        JSON.stringify({
          protocol_version: "studio-sidecar-r1",
          features: {
            renderer_transport_selection: true,
            renderer_rust_only_default: true,
            implicit_python_http_fallback: false,
            unmigrated_renderer_routes_fail_closed: true,
            renderer_http_transport: true,
            renderer_websocket_transport: true,
            health: true,
            scientific_submission_transport: true,
            native_archive_v2_prediction: true,
            system_capabilities_route: true,
            python_plugin_preflight: true,
            python_plugin_execution: true,
            scientific_execution: true,
          },
        }),
        { status: 200 },
      ),
    );
    const packagedSidecar = () => ({
      status: "running" as const,
      url: "http://127.0.0.1:43123",
      pythonPluginHostConfigured: verified.pythonPluginHostPath !== null,
    });

    for (const candidate of [
      { kind: "http" as const, method: "GET", path: "/health" },
      { kind: "http" as const, method: "POST", path: "/runs/run-groups" },
      { kind: "http" as const, method: "POST", path: "/predict/archive-v2" },
      { kind: "http" as const, method: "GET", path: "/system/capabilities" },
      { kind: "websocket" as const, path: "/ws/training/job-1" },
    ]) {
      await expect(preselectRendererTransport(
        candidate,
        packagedSidecar,
        capabilities,
      )).resolves.toMatchObject({
        target: "native-sidecar",
        renderer_transport: true,
        scientific_execution: false,
        fallback_after_native_selection: "none",
        status: 200,
      });
    }
    expect(capabilities).toHaveBeenCalledTimes(5);
  });

  it("refuses an altered product sidecar before spawn", () => {
    const fixture = makeResources();
    fs.appendFileSync(fixture.sidecarPath, "tampered");
    expect(() =>
      verifyPackagedRuntimeContract({
        resourcesPath: fixture.resourcesPath,
        platform: "linux",
      }),
    ).toThrow("Native Studio sidecar integrity mismatch");
  });

  it("disables Python when the plugin-only role marker is altered", () => {
    const fixture = makeResources();
    const markerPath = path.join(
      fixture.resourcesPath,
      "backend",
      "python-runtime",
      "PLUGIN_RUNTIME_READY.json",
    );
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    marker.python_role = "standalone-bundled-runtime";
    fs.writeFileSync(markerPath, JSON.stringify(marker));
    expect(
      verifyPackagedRuntimeContract({
        resourcesPath: fixture.resourcesPath,
        platform: "linux",
      }),
    ).toMatchObject({
      pythonPluginHostPath: null,
      pythonPluginHostError: expect.stringMatching(/marker.*(integrity|identity)/i),
    });
  });

  it("disables a missing bundled Python host without changing the Rust backend", () => {
    const fixture = makeResources();
    fs.rmSync(fixture.pythonPath);
    expect(
      verifyPackagedRuntimeContract({
        resourcesPath: fixture.resourcesPath,
        platform: "linux",
      }),
    ).toMatchObject({
      sidecarPath: fixture.sidecarPath,
      pythonPluginHostPath: null,
      pythonPluginHostError: expect.stringContaining(
        "Bundled Python plugin host not found",
      ),
    });
  });

  it("disables a changed or extended Python closure before sidecar spawn", () => {
    const changed = makeResources();
    fs.appendFileSync(
      path.join(changed.sitePackagesPath, "nirs4all.py"),
      "# tampered\n",
    );
    expect(
      verifyPackagedRuntimeContract({
        resourcesPath: changed.resourcesPath,
        platform: "linux",
      }),
    ).toMatchObject({
      sidecarPath: changed.sidecarPath,
      pythonPluginHostPath: null,
      pythonPluginHostError: expect.stringContaining("closure mismatch"),
    });

    const extended = makeResources();
    fs.writeFileSync(path.join(extended.sitePackagesPath, "injected.pth"), "import injected\n");
    expect(
      verifyPackagedRuntimeContract({
        resourcesPath: extended.resourcesPath,
        platform: "linux",
      }),
    ).toMatchObject({
      pythonPluginHostPath: null,
      pythonPluginHostError: expect.stringContaining("inventory mismatch"),
    });
  });

  it("refuses symlink and parent-path substitution inside the Python closure", () => {
    if (process.platform === "win32") return;
    const leaf = makeResources();
    const outside = path.join(leaf.resourcesPath, "outside.py");
    fs.writeFileSync(outside, "outside\n");
    fs.symlinkSync(outside, path.join(leaf.sitePackagesPath, "injected.py"));
    expect(
      verifyPackagedRuntimeContract({
        resourcesPath: leaf.resourcesPath,
        platform: "linux",
      }),
    ).toMatchObject({
      pythonPluginHostPath: null,
      pythonPluginHostError: expect.stringContaining("must not contain symlinks"),
    });

    const parent = makeResources();
    const original = path.join(
      parent.resourcesPath,
      "backend",
      "python-runtime",
      "python",
      "lib",
    );
    const substituted = path.join(parent.resourcesPath, "substituted-lib");
    fs.renameSync(original, substituted);
    fs.symlinkSync(substituted, original, "dir");
    expect(
      verifyPackagedRuntimeContract({
        resourcesPath: parent.resourcesPath,
        platform: "linux",
      }),
    ).toMatchObject({
      pythonPluginHostPath: null,
      pythonPluginHostError: expect.stringContaining(
        "must not contain symlinks",
      ),
    });
  });

  it("selects native Methods only while its exact packaged SHA remains valid", () => {
    const fixture = makeResources();
    const backendRoot = path.join(fixture.resourcesPath, "backend");
    const contractPath = path.join(
      backendRoot,
      "native",
      "STUDIO_RUNTIME_CONTRACT.json",
    );
    const methodsPath = path.join(backendRoot, "native", "libn4m.so");
    const methods = Buffer.from("libn4m-abi-2.5");
    fs.writeFileSync(methodsPath, methods);
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    contract.methods_library = {
      mode: "bundled-required",
      member: {
        path: "native/libn4m.so",
        size: methods.length,
        sha256: digest(methods),
      },
      abi: { major: 2, minor: 5 },
      source: {
        commit: "48ad1e5a50844f68c2b99e93b02ad6a3b491c07b",
        tree: "f2eaa3c46629c26d11913a25bff723f9a9cefbc9",
        project_version: "1.0.15",
      },
    };
    fs.writeFileSync(contractPath, JSON.stringify(contract));

    expect(
      verifyPackagedRuntimeContract({
        resourcesPath: fixture.resourcesPath,
        platform: "linux",
      }),
    ).toMatchObject({ methodsLibraryPath: methodsPath, methodsLibraryError: null });

    fs.appendFileSync(methodsPath, "tampered");
    expect(
      verifyPackagedRuntimeContract({
        resourcesPath: fixture.resourcesPath,
        platform: "linux",
      }),
    ).toMatchObject({
      sidecarPath: fixture.sidecarPath,
      methodsLibraryPath: null,
      methodsLibraryError: expect.stringContaining("integrity mismatch"),
    });
  });
});
