import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const buildNativeSidecar = require("../scripts/build-native-sidecar.cjs") as {
  assertMethodsBuildIdentityConfigured(
    sourcePath: string | null,
    expectedSha256: string | null,
  ): void;
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
    backendRoot: string;
    platform: NodeJS.Platform;
    sourcePath: string | null;
    expectedSha256: string | null;
  }): string | null;
};
const runtimeContract = require("../scripts/native-runtime-contract.cjs") as {
  collectRuntimeClosure(runtimeRoot: string): {
    files: Array<{ path: string; size: number; sha256: string }>;
    directories: string[];
  };
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
    requireBundledPythonPlugin?: boolean;
    requireBundledMethods?: boolean;
  }): {
    sidecarPath: string;
    pythonPluginHostPath: string | null;
    methodsLibraryPath: string | null;
  };
  writeRuntimeContract(options: {
    backendRoot: string;
    platform: string;
    arch: string;
    methodsLibraryPath?: string;
  }): {
    contractPath: string;
    contract: {
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
    ).toThrow(/Native Methods ABI 2\.4 is required/);
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

  it("orders closure paths bytewise exactly as the Rust verifier", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-native-byte-order-"));
    try {
      for (const name of ["install-sh", "Makefile", "zeta", "Éclair", "éclair", "😀.txt"]) {
        fs.writeFileSync(path.join(root, name), name);
      }
      const closure = runtimeContract.collectRuntimeClosure(root);
      const expected = closure.files
        .map((entry) => entry.path)
        .sort((left, right) =>
          Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
        );
      expect(closure.files.map((entry) => entry.path)).toEqual(expected);
      expect(expected.indexOf("Makefile")).toBeLessThan(expected.indexOf("install-sh"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("places the host-native binary in the packaged backend resource tree", () => {
    const paths = buildNativeSidecar.getNativeSidecarPaths("/workspace/studio", "linux");

    expect(paths.manifestPath).toBe("/workspace/studio/sidecar/Cargo.toml");
    expect(paths.builtBinaryPath).toBe("/workspace/studio/sidecar/target/release/studio-sidecar");
    expect(paths.packagedBinaryPath).toBe("/workspace/studio/backend-dist/native/studio-sidecar");
  });

  it("uses the Windows executable extension throughout the packaging contract", () => {
    const paths = buildNativeSidecar.getNativeSidecarPaths("C:/workspace/studio", "win32");

    expect(paths.builtBinaryPath).toBe(path.join("C:/workspace/studio", "sidecar", "target", "release", "studio-sidecar.exe"));
    expect(paths.packagedBinaryPath).toBe(path.join("C:/workspace/studio", "backend-dist", "native", "studio-sidecar.exe"));
  });

  it("supports an out-of-tree Cargo target directory for bounded builders", () => {
    const paths = buildNativeSidecar.getNativeSidecarPaths(
      "/workspace/studio",
      "linux",
      "x86_64-unknown-linux-gnu",
      "/tmp/n4a-cargo-target",
    );
    expect(paths.builtBinaryPath).toBe(
      "/tmp/n4a-cargo-target/x86_64-unknown-linux-gnu/release/studio-sidecar",
    );
  });

  it("never promotes a generic standalone Python backend marker to plugin capability", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-native-build-contract-"));
    try {
      const backendRoot = path.join(root, "backend-dist");
      const sidecarPath = path.join(backendRoot, "native", "studio-sidecar");
      const pythonPath = path.join(
        backendRoot,
        "python-runtime",
        "python",
        "bin",
        "python3",
      );
      fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
      fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
      fs.mkdirSync(
        path.join(
          backendRoot,
          "python-runtime",
          "python",
          "lib",
          "python3.11",
          "site-packages",
        ),
        { recursive: true },
      );
      fs.writeFileSync(sidecarPath, "rust-sidecar");
      fs.writeFileSync(pythonPath, "python-host");
      fs.writeFileSync(
        path.join(
          backendRoot,
          "python-runtime",
          "python",
          "lib",
          "python3.11",
          "site-packages",
          "nirs4all.py",
        ),
        "def studio_scientific_job_v1(): pass\n",
      );
      fs.writeFileSync(
        path.join(backendRoot, "python-runtime", "RUNTIME_READY.json"),
        "{}\n",
      );

      const written = runtimeContract.writeRuntimeContract({
        backendRoot,
        platform: "linux",
        arch: "x64",
      });
      expect(fs.existsSync(written.contractPath)).toBe(true);
      expect(
        runtimeContract.verifyRuntimeContract({
          backendRoot,
          artifactBoundaryRoot: backendRoot,
          platform: "linux",
          arch: "x64",
        }),
      ).toMatchObject({
        sidecarPath,
        pythonPluginHostPath: null,
        methodsLibraryPath: null,
      });
      expect(() =>
        runtimeContract.verifyRuntimeContract({
          backendRoot,
          artifactBoundaryRoot: backendRoot,
          platform: "linux",
          arch: "x64",
          requireBundledPythonPlugin: true,
        }),
      ).toThrow(/required/);
      expect(() =>
        runtimeContract.verifyRuntimeContract({
          backendRoot,
          artifactBoundaryRoot: backendRoot,
          platform: "linux",
          arch: "x64",
          requireBundledMethods: true,
        }),
      ).toThrow(/native Methods library is required/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("attests an explicitly staged ABI 2.4 native Methods closure", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-native-methods-contract-"));
    try {
      const backendRoot = path.join(root, "backend-dist");
      const sidecarPath = path.join(backendRoot, "native", "studio-sidecar");
      const methodsPath = path.join(backendRoot, "native", "libn4m.so");
      fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
      fs.writeFileSync(sidecarPath, "rust-sidecar");
      fs.writeFileSync(methodsPath, "libn4m-abi-2.4");

      const written = runtimeContract.writeRuntimeContract({
        backendRoot,
        platform: "linux",
        arch: "x64",
        methodsLibraryPath: methodsPath,
      });
      expect(written.contract.methods_library).toMatchObject({
        mode: "bundled-required",
        abi: { major: 2, minor: 4 },
        source: {
          commit: "a71ee2927524d03482183de3d6e22661efc05d12",
          tree: "f6749f4c4be7dca161f3c2677dd10a9ac4434b66",
          project_version: "1.0.14",
        },
      });
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

  it("stages native Methods only from an explicit build-time SHA identity", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-native-methods-stage-"));
    try {
      const backendRoot = path.join(root, "backend-dist");
      const sourcePath = path.join(root, "libn4m-source.so");
      const bytes = Buffer.from("libn4m-abi-2.4");
      fs.writeFileSync(sourcePath, bytes);
      const expectedSha256 = createHash("sha256").update(bytes).digest("hex");

      expect(
        buildNativeSidecar.stagePackagedMethodsLibrary({
          backendRoot,
          platform: "linux",
          sourcePath,
          expectedSha256,
        }),
      ).toBe(path.join(backendRoot, "native", "libn4m.so"));
      expect(() =>
        buildNativeSidecar.stagePackagedMethodsLibrary({
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
      const bytes = Buffer.from("libn4m-abi-2.4");
      fs.writeFileSync(sourcePath, bytes);
      fs.writeFileSync(outsidePath, "must-not-change");
      fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
      fs.symlinkSync(outsidePath, stagedPath);
      const expectedSha256 = createHash("sha256").update(bytes).digest("hex");

      expect(() =>
        buildNativeSidecar.stagePackagedMethodsLibrary({
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
        "--require-bundled-python-plugin",
        "--require-bundled-methods",
      ]),
    ).toEqual({
      backendRoot: path.resolve("release/product/resources/backend"),
      artifactBoundaryRoot: path.resolve("release/product"),
      platform: "darwin",
      arch: "arm64",
      requireBundledPythonPlugin: true,
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
    const projectRoot = path.resolve(import.meta.dirname, "..");
    for (const relativePath of [
      "scripts/build-release.cjs",
      "scripts/build-archive-standalone.cjs",
      "scripts/smoke-archive-standalone.cjs",
      "scripts/installer-release-contract.cjs",
    ]) {
      const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
      const calls = [...source.matchAll(/verifyRuntimeContract\(\{([\s\S]*?)\n\s*\}\);/g)];
      expect(calls.length, relativePath).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call[1], relativePath).toContain("artifactBoundaryRoot:");
        expect(call[1], relativePath).toContain("requireBundledPythonPlugin: true");
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
        expect(command, relativePath).toContain("--require-bundled-python-plugin");
        expect(command, relativePath).toContain("--require-bundled-methods");
      }
    }
  });
});
