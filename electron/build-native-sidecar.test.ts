import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(import.meta.dirname, "..");
const recommendedConfig = require("../recommended-config.json") as { required: Array<{ name: string; install: string }> };
const adapters = require("../scripts/studio-document-adapters.cjs") as {
  installRuntimeAdapters(root: string, target: string): unknown;
};
const buildNativeSidecar = require("../scripts/build-native-sidecar.cjs") as {
  assertMethodsBuildIdentityConfigured(
    sourcePath: string | null,
    expectedSha256: string | null,
  ): void;
  cargoEnvironmentForPlatform(
    platform: NodeJS.Platform,
    environment?: NodeJS.ProcessEnv,
  ): NodeJS.ProcessEnv;
  getNativeSidecarPaths(
    root?: string,
    platform?: NodeJS.Platform,
    targetTriple?: string | null,
    cargoTargetDir?: string | null,
  ): {
    manifestPath: string;
    builtBinaryPath: string;
    packagedBinaryPath: string;
  };
  stagePackagedMethodsLibrary(options: {
    inspectLinuxLibrary?(library: string): void;
    backendRoot: string;
    platform: NodeJS.Platform;
    sourcePath: string | null;
    expectedSha256: string | null;
  }): string | null;
};
const runtimeContract = require("../scripts/native-runtime-contract.cjs") as {
  parseVerifyArgs(argv?: string[]): {
    backendRoot: string;
    artifactBoundaryRoot: string;
    platform: string;
    arch: string;
  };
  verifyRuntimeContract(options: {
    backendRoot: string;
    artifactBoundaryRoot: string;
    platform: string;
    arch: string;
    requirePythonPayload?: boolean;
    requireBundledMethods?: boolean;
  }): {
    sidecarPath: string;
    methodsLibraryPath: string | null;
  };
  writeRuntimeContract(options: {
    backendRoot: string;
    platform: string;
    arch: string;
    methodsLibraryPath?: string;
    methodsIdentityProfile?: string;
  }): {
    contractPath: string;
    contract: {
      native_runtime_linkage?: {
        profile: string;
        methods_cmake_runtime: string;
        sidecar_rust_target_feature: string;
        forbidden_dynamic_import_prefixes: string[];
      };
      methods_library: {
        mode: string;
        abi: { major: number; minor: number };
        source: { commit: string; tree: string; project_version: string };
      };
    };
  };
};

describe("build-native-sidecar", () => {
  it("refuses a product build without an exact native Methods identity", () => {
    expect(() =>
      buildNativeSidecar.assertMethodsBuildIdentityConfigured(null, null),
    ).toThrow(/Native Methods ABI 2\.23 is required/);
    expect(() =>
      buildNativeSidecar.assertMethodsBuildIdentityConfigured(
        "/build/libn4m.so",
        null,
      ),
    ).toThrow(/NIRS4ALL_BUILD_METHODS_SHA256/);
    expect(() =>
      buildNativeSidecar.assertMethodsBuildIdentityConfigured(
        "/build/libn4m.so",
        "a".repeat(64),
      ),
    ).not.toThrow();
  });

  it("places the host-native binary in the packaged backend resource tree", () => {
    const paths = buildNativeSidecar.getNativeSidecarPaths("/workspace/studio", "linux");

    expect(paths.manifestPath).toBe(path.join("/workspace/studio", "sidecar", "Cargo.toml"));
    expect(paths.builtBinaryPath).toBe(path.join("/workspace/studio", "sidecar", "target", "release", "studio-sidecar"));
    expect(paths.packagedBinaryPath).toBe(path.join("/workspace/studio", "backend-dist", "native", "studio-sidecar"));
  });

  it("uses the Windows executable extension throughout the packaging contract", () => {
    const paths = buildNativeSidecar.getNativeSidecarPaths("C:/workspace/studio", "win32");

    expect(paths.builtBinaryPath).toBe(path.join("C:/workspace/studio", "sidecar", "target", "release", "studio-sidecar.exe"));
    expect(paths.packagedBinaryPath).toBe(path.join("C:/workspace/studio", "backend-dist", "native", "studio-sidecar.exe"));
  });

  it("selects the static MSVC runtime only for Windows sidecar builds", () => {
    const base = { PATH: "C:\\Windows", CARGO_ENCODED_RUSTFLAGS: "--cfg\x1fexisting" };
    expect(
      buildNativeSidecar.cargoEnvironmentForPlatform("win32", base),
    ).toMatchObject({
      PATH: "C:\\Windows",
      CARGO_ENCODED_RUSTFLAGS:
        "--cfg\x1fexisting\x1f-C\x1ftarget-feature=+crt-static",
    });
    expect(
      buildNativeSidecar.cargoEnvironmentForPlatform("linux", base),
    ).toBe(base);
  });

  it("supports an out-of-tree Cargo target directory for bounded builders", () => {
    const paths = buildNativeSidecar.getNativeSidecarPaths(
      "/workspace/studio",
      "linux",
      "x86_64-unknown-linux-gnu",
      "/tmp/n4a-cargo-target",
    );
    expect(paths.builtBinaryPath).toBe(
      path.resolve("/tmp/n4a-cargo-target", "x86_64-unknown-linux-gnu", "release", "studio-sidecar"),
    );
  });

  it("requires the Python payload and the native Methods library only for release artifacts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-native-build-contract-"));
    try {
      const backendRoot = path.join(root, "backend-dist");
      const sidecarPath = path.join(backendRoot, "native", "studio-sidecar");
      fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
      fs.writeFileSync(sidecarPath, "rust-sidecar");

      const written = runtimeContract.writeRuntimeContract({
        backendRoot,
        platform: "linux",
        arch: "x64",
      });
      expect(JSON.parse(fs.readFileSync(written.contractPath, "utf8"))).not.toHaveProperty("python_plugin_host");
      const verification = { backendRoot, artifactBoundaryRoot: backendRoot, platform: "linux", arch: "x64" };
      expect(runtimeContract.verifyRuntimeContract(verification)).toMatchObject({
        sidecarPath,
        methodsLibraryPath: null,
      });
      expect(() => runtimeContract.verifyRuntimeContract({ ...verification, requireBundledMethods: true }))
        .toThrow(/native Methods library is required/);

      const withPayload = { ...verification, requirePythonPayload: true };
      expect(() => runtimeContract.verifyRuntimeContract(withPayload)).toThrow(/Packaged uv not found/);
      fs.mkdirSync(path.join(backendRoot, "tools"));
      fs.writeFileSync(path.join(backendRoot, "tools", "uv"), "uv");
      expect(() => runtimeContract.verifyRuntimeContract(withPayload))
        .toThrow(/exactly one nirs4all==\d+\.\d+\.\d+ wheel/);
      const wheelhouse = path.join(backendRoot, "wheels");
      fs.mkdirSync(wheelhouse);
      for (const { name, install } of recommendedConfig.required) {
        fs.writeFileSync(path.join(wheelhouse, `${name.replaceAll("-", "_")}-${install}-py3-none-any.whl`), name);
      }
      expect(() => runtimeContract.verifyRuntimeContract(withPayload)).toThrow(/Packaged document adapters not found/);
      adapters.installRuntimeAdapters(projectRoot, path.join(backendRoot, "adapters"));
      expect(runtimeContract.verifyRuntimeContract(withPayload).sidecarPath).toBe(sidecarPath);

      fs.writeFileSync(path.join(wheelhouse, "numpy-2.4.6-cp311-cp311-manylinux_2_28_x86_64.whl"), "extra");
      expect(() => runtimeContract.verifyRuntimeContract(withPayload)).toThrow(/outside the required cohort/);
      fs.rmSync(path.join(wheelhouse, "numpy-2.4.6-cp311-cp311-manylinux_2_28_x86_64.whl"));
      fs.appendFileSync(path.join(backendRoot, "adapters", "studio_document_adapters", "api", "library_documents.py"), "\n# changed\n");
      expect(() => runtimeContract.verifyRuntimeContract(withPayload)).toThrow(/Adapter member differs/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires a macOS application to name its required wheels instead of embedding them", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-native-build-contract-"));
    try {
      const backendRoot = path.join(root, "backend-dist");
      fs.mkdirSync(path.join(backendRoot, "native"), { recursive: true });
      fs.writeFileSync(path.join(backendRoot, "native", "studio-sidecar"), "rust-sidecar");
      fs.mkdirSync(path.join(backendRoot, "tools"));
      fs.writeFileSync(path.join(backendRoot, "tools", "uv"), "uv");
      adapters.installRuntimeAdapters(projectRoot, path.join(backendRoot, "adapters"));
      runtimeContract.writeRuntimeContract({ backendRoot, platform: "darwin", arch: "arm64" });
      const verify = () => runtimeContract.verifyRuntimeContract({
        backendRoot, artifactBoundaryRoot: backendRoot, platform: "darwin", arch: "arm64", requirePythonPayload: true,
      });
      // Nothing stands for the required packages on macOS: Studio installs them from the package index.
      expect(verify().sidecarPath).toBe(path.join(backendRoot, "native", "studio-sidecar"));
      fs.mkdirSync(path.join(backendRoot, "wheels"));
      expect(verify).toThrow(/must not embed wheels/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("attests an explicitly staged ABI 2.23 native Methods closure", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-native-methods-contract-"));
    try {
      const backendRoot = path.join(root, "backend-dist");
      const sidecarPath = path.join(backendRoot, "native", "studio-sidecar");
      const methodsPath = path.join(backendRoot, "native", "libn4m.so");
      fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
      fs.writeFileSync(sidecarPath, "rust-sidecar");
      fs.writeFileSync(methodsPath, "libn4m-abi-2.23");

      const written = runtimeContract.writeRuntimeContract({
        backendRoot,
        platform: "linux",
        arch: "x64",
        methodsLibraryPath: methodsPath,
        methodsIdentityProfile: "source-build",
      });
      expect(written.contract.methods_library).toMatchObject({
        mode: "bundled-required",
        abi: { major: 2, minor: 23 },
        source: {
          commit: "50b307dd2fc76c0a04ff06e83c316d408c19fc68",
          tree: "8ad3ff8dfe80b2419833f3a32e190c5d9300b3a5",
          project_version: "1.3.18",
        },
      });
      expect(written.contract.native_runtime_linkage).toBeUndefined();
      expect(
        runtimeContract.verifyRuntimeContract({
          backendRoot,
          artifactBoundaryRoot: backendRoot,
          platform: "linux",
          arch: "x64",
        }),
      ).toMatchObject({ methodsLibraryPath: methodsPath });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("records and verifies the closed Windows static-CRT build profile", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-windows-linkage-"));
    try {
      const backendRoot = path.join(root, "backend-dist");
      const nativeRoot = path.join(backendRoot, "native");
      fs.mkdirSync(nativeRoot, { recursive: true });
      fs.writeFileSync(path.join(nativeRoot, "studio-sidecar.exe"), "sidecar");
      fs.writeFileSync(path.join(nativeRoot, "n4m.dll"), "methods");
      const written = runtimeContract.writeRuntimeContract({
        backendRoot,
        platform: "win32",
        arch: "x64",
        methodsLibraryPath: path.join(nativeRoot, "n4m.dll"),
        methodsIdentityProfile: "source-build",
      });
      expect(written.contract.native_runtime_linkage).toEqual({
        profile: "studio-msvc-static-crt-v1",
        methods_cmake_runtime: "MultiThreaded",
        sidecar_rust_target_feature: "+crt-static",
        forbidden_dynamic_import_prefixes: ["MSVCP", "VCRUNTIME"],
      });
      expect(
        runtimeContract.verifyRuntimeContract({
          backendRoot,
          artifactBoundaryRoot: backendRoot,
          platform: "win32",
          arch: "x64",
          requireBundledMethods: true,
        }),
      ).toMatchObject({ methodsLibraryPath: path.join(nativeRoot, "n4m.dll") });

      const contract = JSON.parse(fs.readFileSync(written.contractPath, "utf8"));
      contract.native_runtime_linkage.sidecar_rust_target_feature = "dynamic";
      fs.writeFileSync(written.contractPath, `${JSON.stringify(contract)}\n`);
      expect(() =>
        runtimeContract.verifyRuntimeContract({
          backendRoot,
          artifactBoundaryRoot: backendRoot,
          platform: "win32",
          arch: "x64",
          requireBundledMethods: true,
        }),
      ).toThrow(/linkage profile mismatch/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a nonportable Methods dependency before writing the packaged library", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-methods-dependency-"));
    try {
      const sourcePath = path.join(root, "library.so");
      fs.writeFileSync(sourcePath, "wheel-library");
      const backendRoot = path.join(root, "backend");
      expect(() => buildNativeSidecar.stagePackagedMethodsLibrary({
        backendRoot, platform: "linux", sourcePath,
        expectedSha256: createHash("sha256").update("wheel-library").digest("hex"),
        inspectLinuxLibrary: () => { throw new Error("unbundled libgfortran"); },
      })).toThrow("unbundled libgfortran");
      expect(fs.existsSync(path.join(backendRoot, "native", "libn4m.so"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("stages native Methods only from an explicit build-time SHA identity", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-native-methods-stage-"));
    try {
      const backendRoot = path.join(root, "backend-dist");
      const sourcePath = path.join(root, "libn4m-source.so");
      const bytes = Buffer.from("libn4m-abi-2.23");
      fs.writeFileSync(sourcePath, bytes);
      const expectedSha256 = createHash("sha256").update(bytes).digest("hex");

      expect(
        buildNativeSidecar.stagePackagedMethodsLibrary({
          inspectLinuxLibrary: () => undefined,
          backendRoot,
          platform: "linux",
          sourcePath,
          expectedSha256,
        }),
      ).toBe(path.join(backendRoot, "native", "libn4m.so"));
      expect(() =>
        buildNativeSidecar.stagePackagedMethodsLibrary({
          inspectLinuxLibrary: () => undefined,
          backendRoot,
          platform: "linux",
          sourcePath,
          expectedSha256: "0".repeat(64),
        }),
      ).toThrow("SHA-256 mismatch");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a symlink at the native Methods packaged destination", () => {
    if (process.platform === "win32") return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-native-methods-symlink-"));
    try {
      const backendRoot = path.join(root, "backend-dist");
      const sourcePath = path.join(root, "libn4m-source.so");
      const outsidePath = path.join(root, "outside.so");
      const stagedPath = path.join(backendRoot, "native", "libn4m.so");
      const bytes = Buffer.from("libn4m-abi-2.23");
      fs.writeFileSync(sourcePath, bytes);
      fs.writeFileSync(outsidePath, "must-not-change");
      fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
      fs.symlinkSync(outsidePath, stagedPath);
      const expectedSha256 = createHash("sha256").update(bytes).digest("hex");

      expect(() =>
        buildNativeSidecar.stagePackagedMethodsLibrary({
          inspectLinuxLibrary: () => undefined,
          backendRoot,
          platform: "linux",
          sourcePath,
          expectedSha256,
        }),
      ).toThrow("must not be a symlink");
      expect(fs.readFileSync(outsidePath, "utf8")).toBe("must-not-change");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("parses the cross-platform packaged verification gate", () => {
    expect(
      runtimeContract.parseVerifyArgs([
        "--backend-root",
        "release/product/resources/backend",
        "--artifact-boundary-root",
        "release/product",
        "--platform=darwin",
        "--arch",
        "arm64",
        "--require-python-payload",
        "--require-bundled-methods",
      ]),
    ).toEqual({
      backendRoot: path.resolve("release/product/resources/backend"),
      artifactBoundaryRoot: path.resolve("release/product"),
      platform: "darwin",
      arch: "arm64",
      requirePythonPayload: true,
      requireBundledMethods: true,
    });
    expect(() => runtimeContract.parseVerifyArgs([])).toThrow(
      "--backend-root is required",
    );
    expect(() => runtimeContract.parseVerifyArgs([
      "--backend-root",
      "backend-dist",
    ])).toThrow("--artifact-boundary-root is required");
  });

  it("rejects an ancestor symlink between the artifact boundary and backend", () => {
    if (process.platform === "win32") return;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-native-boundary-symlink-"));
    try {
      const artifactBoundaryRoot = path.join(root, "linux-unpacked");
      const outsideResources = path.join(root, "outside-resources");
      const outsideBackend = path.join(outsideResources, "backend");
      const sidecarPath = path.join(outsideBackend, "native", "studio-sidecar");
      fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
      fs.mkdirSync(artifactBoundaryRoot);
      fs.writeFileSync(sidecarPath, "rust-sidecar");
      runtimeContract.writeRuntimeContract({
        backendRoot: outsideBackend,
        platform: "linux",
        arch: "x64",
      });
      fs.symlinkSync(outsideResources, path.join(artifactBoundaryRoot, "resources"));

      expect(() => runtimeContract.verifyRuntimeContract({
        backendRoot: path.join(artifactBoundaryRoot, "resources", "backend"),
        artifactBoundaryRoot,
        platform: "linux",
        arch: "x64",
      })).toThrow(/boundary component must be a real non-symlink directory/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps every official runtime verifier call fail-closed on an explicit boundary", () => {
    for (const relativePath of [
      "scripts/build-release.cjs",
      "scripts/smoke-archive-standalone.cjs",
      "scripts/installer-release-contract.cjs",
    ]) {
      const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
      const calls = [...source.matchAll(/verifyRuntimeContract\(\{([\s\S]*?)\n\s*\}\);/g)];
      expect(calls.length, relativePath).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call[1], relativePath).toContain("artifactBoundaryRoot:");
        expect(call[1], relativePath).toContain("requirePythonPayload: true");
        expect(call[1], relativePath).toContain("requireBundledMethods: true");
      }
    }
    for (const relativePath of [
      ".github/workflows/ci.yml",
      ".github/workflows/release-unified.yml",
    ]) {
      const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
      const commands = source
        .split(/\r?\n/)
        .filter((line) => line.includes("scripts/native-runtime-contract.cjs"));
      expect(commands.length, relativePath).toBeGreaterThan(0);
      for (const command of commands) {
        expect(command, relativePath).toContain("--artifact-boundary-root");
        expect(command, relativePath).toContain("--require-python-payload");
        expect(command, relativePath).toContain("--require-bundled-methods");
      }
    }
  });
});
