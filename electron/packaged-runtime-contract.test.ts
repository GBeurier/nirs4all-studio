import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasExactWindowsNativeRuntimeLinkage,
  hasExactPublicMethodsArtifact,
  verifyPackagedRuntimeContract,
} from "./packaged-runtime-contract";
import publicMethodsWheel from "../scripts/methods-public-wheel-profile.json";

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

function makeResources(): { resourcesPath: string; sidecarPath: string } {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-runtime-contract-"));
  tempDirs.push(resourcesPath);
  const backendRoot = path.join(resourcesPath, "backend");
  const sidecarPath = path.join(backendRoot, "native", "studio-sidecar");
  const sidecar = Buffer.from("rust-sidecar");
  fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
  fs.writeFileSync(sidecarPath, sidecar);
  fs.mkdirSync(path.join(backendRoot, "tools"));
  fs.writeFileSync(path.join(backendRoot, "tools", "uv"), "uv");
  fs.mkdirSync(path.join(backendRoot, "adapters", "studio_document_adapters"), { recursive: true });
  fs.writeFileSync(
    path.join(backendRoot, "native", "STUDIO_RUNTIME_CONTRACT.json"),
    JSON.stringify({
      schema: "nirs4all.studio-packaged-runtime.v1",
      platform: "linux",
      arch: process.arch,
      product_backend: "rust-sidecar",
      sidecar: {
        path: "native/studio-sidecar",
        size: sidecar.length,
        sha256: digest(sidecar),
      },
      methods_library: {
        mode: "unavailable",
        member: null,
        abi: { major: 2, minor: 22 },
        source: {
          commit: "41b5d4e02e2574a94cd9dad6fcfa6269573b5eed",
          tree: "61406cd2cf11204273a9972e4f268acfde7eb424",
          project_version: "1.3.15",
        },
      },
    }),
  );
  return { resourcesPath, sidecarPath };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("packaged runtime contract", () => {
  it("accepts only the selected public artifact metadata without inventing source identity", () => {
    const producer = require("../scripts/native-runtime-contract.cjs") as {
      hasExactPublicMethodsArtifact: typeof hasExactPublicMethodsArtifact;
    };
    // This checks metadata agreement only; the real bytes/startup test is separate.
    const methods = {
      mode: "bundled-required", abi: publicMethodsWheel.abi,
      member: { path: "native/libn4m.so", ...publicMethodsWheel.library },
      artifact: publicMethodsWheel.artifact,
    };
    for (const check of [hasExactPublicMethodsArtifact, producer.hasExactPublicMethodsArtifact]) {
      expect(check(methods, "linux", "x64")).toBe(true);
      expect(check(methods, "linux", "arm64")).toBe(false);
      expect(check(methods, "darwin", "x64")).toBe(false);
      expect(check({ ...methods, source: { commit: "eccbe5", tree: "unknown", project_version: "1.3.15" } }, "linux", "x64")).toBe(false);
      expect(check({ ...methods, abi: { major: 2, minor: 20 } }, "linux", "x64")).toBe(false);
      expect(check({ ...methods, member: { ...methods.member, sha256: "a".repeat(64) } }, "linux", "x64")).toBe(false);
      for (const artifact of [
        { ...methods.artifact, kind: "other" },
        { ...methods.artifact, source: { commit: "eccbe5" } },
        { ...methods.artifact, distribution: { name: "nirs4all-methods", version: "1.3.16" } },
        { ...methods.artifact, wheel: { ...methods.artifact.wheel, sha256: "a".repeat(64) } },
        { ...methods.artifact, extra: true },
      ]) expect(check({ ...methods, artifact }, "linux", "x64")).toBe(false);
    }
  });

  it("refuses arbitrary bytes in the public-wheel producer without stamping a source", () => {
    const fixture = makeResources();
    const backendRoot = path.join(fixture.resourcesPath, "backend");
    const methodsLibraryPath = path.join(backendRoot, "native", "libn4m.so");
    fs.writeFileSync(methodsLibraryPath, "unselected-artifact-bytes");
    const producer = require("../scripts/native-runtime-contract.cjs") as {
      createRuntimeContract(options: { backendRoot: string; platform: string; arch: string; methodsLibraryPath: string }): unknown;
    };
    expect(() => producer.createRuntimeContract({ backendRoot, platform: "linux", arch: "x64", methodsLibraryPath }))
      .toThrow("does not match the selected public wheel artifact");
  });

  it.skipIf(process.platform !== "linux" || process.arch !== "x64" || !process.env.NIRS4ALL_BUILD_METHODS_LIBRARY ||
    (process.env.NIRS4ALL_BUILD_METHODS_IDENTITY_PROFILE?.trim() || "public-wheel") !== "public-wheel")(
    "selects the actual public wheel through producer and Electron, then rejects tampering",
    () => {
      const fixture = makeResources();
      const backendRoot = path.join(fixture.resourcesPath, "backend");
      const methodsLibraryPath = path.join(backendRoot, "native", "libn4m.so");
      fs.copyFileSync(process.env.NIRS4ALL_BUILD_METHODS_LIBRARY!, methodsLibraryPath);
      const producer = require("../scripts/native-runtime-contract.cjs") as {
        writeRuntimeContract(options: {
          backendRoot: string; platform: string; arch: string; methodsLibraryPath: string;
          methodsIdentityProfile?: string;
        }): { contractPath: string; contract: { methods_library: { artifact?: unknown; source?: unknown } } };
        verifyRuntimeContract(options: {
          backendRoot: string; artifactBoundaryRoot: string; platform: string; arch: string; requireBundledMethods: boolean;
        }): { methodsLibraryPath: string | null };
      };
      const options = { backendRoot, platform: "linux", arch: "x64", methodsLibraryPath };
      const written = producer.writeRuntimeContract(options);
      expect(written.contract.methods_library.artifact).toEqual(publicMethodsWheel.artifact);
      expect(written.contract.methods_library).not.toHaveProperty("source");
      expect(producer.verifyRuntimeContract({
        backendRoot, artifactBoundaryRoot: backendRoot, platform: "linux", arch: "x64", requireBundledMethods: true,
      }).methodsLibraryPath).toBe(methodsLibraryPath);
      expect(verifyPackagedRuntimeContract({ resourcesPath: fixture.resourcesPath, platform: "linux", arch: "x64" }))
        .toMatchObject({ methodsLibraryPath, methodsLibraryError: null });
      expect(() => producer.writeRuntimeContract({ ...options, methodsIdentityProfile: "source-build" }))
        .toThrow("a public wheel must not claim source identity");
      fs.appendFileSync(methodsLibraryPath, "tampered");
      expect(verifyPackagedRuntimeContract({ resourcesPath: fixture.resourcesPath, platform: "linux", arch: "x64" }))
        .toMatchObject({ methodsLibraryPath: null, methodsLibraryError: expect.stringContaining("integrity mismatch") });
    },
  );

  it.skipIf(process.platform !== "linux" || process.arch !== "x64" ||
    !process.env.NIRS4ALL_BUILD_METHODS_LIBRARY || !process.env.NIRS4ALL_BUILD_METHODS_SHA256 ||
    process.env.NIRS4ALL_BUILD_METHODS_IDENTITY_PROFILE?.trim() !== "source-build")(
    "selects the actual source build through producer and Electron, then rejects tampering",
    () => {
      const fixture = makeResources();
      const backendRoot = path.join(fixture.resourcesPath, "backend");
      const methodsLibraryPath = path.join(backendRoot, "native", "libn4m.so");
      fs.copyFileSync(process.env.NIRS4ALL_BUILD_METHODS_LIBRARY!, methodsLibraryPath);
      const stagedSha256 = digest(fs.readFileSync(methodsLibraryPath));
      expect(stagedSha256).toBe(process.env.NIRS4ALL_BUILD_METHODS_SHA256);
      expect(stagedSha256).not.toBe(publicMethodsWheel.library.sha256);
      const producer = require("../scripts/native-runtime-contract.cjs") as {
        writeRuntimeContract(options: {
          backendRoot: string; platform: string; arch: string; methodsLibraryPath: string;
          methodsIdentityProfile?: string;
        }): { contract: { methods_library: { source?: unknown; artifact?: unknown } } };
        verifyRuntimeContract(options: {
          backendRoot: string; artifactBoundaryRoot: string; platform: string; arch: string; requireBundledMethods: boolean;
        }): { methodsLibraryPath: string | null; methodsIdentityProfile: string };
      };
      const options = { backendRoot, platform: "linux", arch: "x64", methodsLibraryPath };
      expect(() => producer.writeRuntimeContract(options))
        .toThrow("does not match the selected public wheel artifact");
      const written = producer.writeRuntimeContract({ ...options, methodsIdentityProfile: "source-build" });
      expect(written.contract.methods_library.source).toEqual({
        commit: "41b5d4e02e2574a94cd9dad6fcfa6269573b5eed",
        tree: "61406cd2cf11204273a9972e4f268acfde7eb424",
        project_version: "1.3.15",
      });
      expect(written.contract.methods_library).not.toHaveProperty("artifact");
      const verification = {
        backendRoot, artifactBoundaryRoot: backendRoot, platform: "linux", arch: "x64", requireBundledMethods: true,
      };
      expect(producer.verifyRuntimeContract(verification))
        .toMatchObject({ methodsLibraryPath, methodsIdentityProfile: "source-build" });
      expect(verifyPackagedRuntimeContract({ resourcesPath: fixture.resourcesPath, platform: "linux", arch: "x64" }))
        .toMatchObject({ methodsLibraryPath, methodsLibraryError: null });
      fs.appendFileSync(methodsLibraryPath, "tampered");
      expect(() => producer.verifyRuntimeContract(verification)).toThrow("integrity mismatch");
      expect(verifyPackagedRuntimeContract({ resourcesPath: fixture.resourcesPath, platform: "linux", arch: "x64" }))
        .toMatchObject({ methodsLibraryPath: null, methodsLibraryError: expect.stringContaining("integrity mismatch") });
    },
  );

  it("requires the exact closed Windows static-CRT linkage profile", () => {
    const exact = {
      profile: "studio-msvc-static-crt-v1",
      methods_cmake_runtime: "MultiThreaded",
      sidecar_rust_target_feature: "+crt-static",
      forbidden_dynamic_import_prefixes: ["MSVCP", "VCRUNTIME"],
    };
    expect(hasExactWindowsNativeRuntimeLinkage(exact)).toBe(true);
    expect(hasExactWindowsNativeRuntimeLinkage({
      ...exact,
      methods_cmake_runtime: "MultiThreadedDLL",
    })).toBe(false);
    expect(hasExactWindowsNativeRuntimeLinkage({
      ...exact,
      forbidden_dynamic_import_prefixes: ["VCRUNTIME", "MSVCP"],
    })).toBe(false);
    const withUnexpected = {
      ...exact,
      unexpected: "tampered",
    };
    expect(hasExactWindowsNativeRuntimeLinkage(withUnexpected)).toBe(false);
  });

  it("keeps the transitional Python HTTP configuration out of the packaged Electron graph", () => {
    const root = process.cwd();
    const result = assertPackagedElectronGraph({ root, requireDist: false });
    const relativeSources = result.sourceFiles.map(
      (file) => path.relative(root, file).split(path.sep).join("/"),
    );
    expect(relativeSources).toContain("electron/env-manager.ts");
    expect(relativeSources).toContain("electron/env/provisioning.ts");
    expect(relativeSources).toContain("scripts/python-runtime-config.cjs");
    expect(relativeSources).not.toContain("scripts/python-http-runtime-config.cjs");
    expect(
      fs.existsSync(path.join(root, "electron/python-http-diagnostic-policy.ts")),
    ).toBe(false);
  });
  it("selects the content-addressed Rust sidecar of a package that carries uv and the adapters", () => {
    const fixture = makeResources();
    expect(
      verifyPackagedRuntimeContract({
        resourcesPath: fixture.resourcesPath,
        platform: "linux",
      }),
    ).toEqual({
      contractPath: path.join(fixture.resourcesPath, "backend", "native", "STUDIO_RUNTIME_CONTRACT.json"),
      sidecarPath: fixture.sidecarPath,
      methodsLibraryPath: null,
      methodsLibraryError: null,
    });
  });

  it.each([
    ["tools", "Packaged uv not found"],
    ["adapters", "Packaged document adapters not found"],
  ])("refuses a package without %s", (directory, message) => {
    const fixture = makeResources();
    fs.rmSync(path.join(fixture.resourcesPath, "backend", directory), { recursive: true });
    expect(() =>
      verifyPackagedRuntimeContract({ resourcesPath: fixture.resourcesPath, platform: "linux" }),
    ).toThrow(message);
  });

  it("expects uv.exe in a Windows package", () => {
    const fixture = makeResources();
    const contractPath = path.join(fixture.resourcesPath, "backend", "native", "STUDIO_RUNTIME_CONTRACT.json");
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    const sidecar = fs.readFileSync(fixture.sidecarPath);
    fs.writeFileSync(path.join(fixture.resourcesPath, "backend", "native", "studio-sidecar.exe"), sidecar);
    fs.writeFileSync(contractPath, JSON.stringify({
      ...contract,
      platform: "win32",
      sidecar: { ...contract.sidecar, path: "native/studio-sidecar.exe" },
      native_runtime_linkage: {
        profile: "studio-msvc-static-crt-v1",
        methods_cmake_runtime: "MultiThreaded",
        sidecar_rust_target_feature: "+crt-static",
        forbidden_dynamic_import_prefixes: ["MSVCP", "VCRUNTIME"],
      },
    }));
    const verify = () => verifyPackagedRuntimeContract({ resourcesPath: fixture.resourcesPath, platform: "win32" });
    expect(verify).toThrow("Packaged uv not found");
    fs.writeFileSync(path.join(fixture.resourcesPath, "backend", "tools", "uv.exe"), "uv");
    expect(verify().sidecarPath).toBe(path.join(fixture.resourcesPath, "backend", "native", "studio-sidecar.exe"));
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

  it("selects native Methods only while its exact packaged SHA remains valid", () => {
    const fixture = makeResources();
    const backendRoot = path.join(fixture.resourcesPath, "backend");
    const contractPath = path.join(
      backendRoot,
      "native",
      "STUDIO_RUNTIME_CONTRACT.json",
    );
    const methodsPath = path.join(backendRoot, "native", "libn4m.so");
    const methods = Buffer.from("libn4m-abi-2.22");
    fs.writeFileSync(methodsPath, methods);
    const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
    contract.methods_library = {
      mode: "bundled-required",
      member: {
        path: "native/libn4m.so",
        size: methods.length,
        sha256: digest(methods),
      },
      abi: { major: 2, minor: 22 },
      source: {
        commit: "41b5d4e02e2574a94cd9dad6fcfa6269573b5eed",
        tree: "61406cd2cf11204273a9972e4f268acfde7eb424",
        project_version: "1.3.15",
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


it("loads the Docker contract verifier from only its staged module closure", () => {
  const project = process.cwd();
  const dockerfile = fs.readFileSync(path.join(project, "Dockerfile"), "utf8");
  const stage = dockerfile.split("AS native-runtime-contract")[1].split("\nFROM ")[0];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-docker-contract-"));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, "contract-scripts"));
  const scripts = stage.match(/^COPY (.+) \/contract-scripts\/$/m);
  expect(scripts).not.toBeNull();
  for (const source of scripts![1].split(" ")) {
    fs.copyFileSync(path.join(project, source), path.join(root, "contract-scripts", path.basename(source)));
  }
  if (stage.includes("COPY recommended-config.json /recommended-config.json")) {
    fs.copyFileSync(path.join(project, "recommended-config.json"), path.join(root, "recommended-config.json"));
  }
  const contract = path.join(root, "contract-scripts/native-runtime-contract.cjs");
  const result = spawnSync(process.execPath, ["-e", "const c=require(process.argv[1]); if(typeof c.writeRuntimeContract!=='function'||typeof c.verifyRuntimeContract!=='function')process.exit(2)", contract], { encoding: "utf8", cwd: root });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
});
