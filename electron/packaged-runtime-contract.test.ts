import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyPackagedRuntimeContract } from "./packaged-runtime-contract";

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
    source_commit: "322265576ccfaeb1ee22332d05ae04b87be4b538",
    wheel_sha256: "00326c703b933ff2c4b106905e1c44f81906b918db30bb5d05aa189846c48940",
    distribution: "nirs4all",
    distribution_version: "0.10.3",
    distribution_record_sha256: "41833befe7dd25b0c0c7e19c6090b44e29bb2d2243700164c49f951fe3ad71c2",
    installed_manifest_sha256: "261d0acbb05fa3a60b75d28f0f21b54c0985bd82b44227f9d852b159cc8c5684",
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
        abi: { major: 2, minor: 2 },
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
    const methods = Buffer.from("libn4m-abi-2.2");
    fs.writeFileSync(methodsPath, methods);
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    contract.methods_library = {
      mode: "bundled-required",
      member: {
        path: "native/libn4m.so",
        size: methods.length,
        sha256: digest(methods),
      },
      abi: { major: 2, minor: 2 },
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
