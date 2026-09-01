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
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.writeFileSync(sidecarPath, sidecar);
  fs.writeFileSync(pythonPath, python);
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
      },
      methods_library: {
        mode: "unavailable",
        member: null,
        abi: { major: 2, minor: 2 },
      },
    }),
  );
  return { resourcesPath, sidecarPath, pythonPath };
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
