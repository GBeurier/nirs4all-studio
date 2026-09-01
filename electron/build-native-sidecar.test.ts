import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const buildNativeSidecar = require("../scripts/build-native-sidecar.cjs") as {
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
  parseVerifyArgs(argv?: string[]): {
    backendRoot: string;
    platform: string;
    arch: string;
  };
  verifyRuntimeContract(options: {
    backendRoot: string;
    platform: string;
    arch: string;
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
      };
    };
  };
};

describe("build-native-sidecar", () => {
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

  it("writes and verifies the all-in-one Rust/Python resource contract", () => {
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
      fs.writeFileSync(sidecarPath, "rust-sidecar");
      fs.writeFileSync(pythonPath, "python-host");
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
          platform: "linux",
          arch: "x64",
        }),
      ).toMatchObject({
        sidecarPath,
        pythonPluginHostPath: pythonPath,
        methodsLibraryPath: null,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("attests an explicitly staged ABI 2.2 native Methods closure", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-native-methods-contract-"));
    try {
      const backendRoot = path.join(root, "backend-dist");
      const sidecarPath = path.join(backendRoot, "native", "studio-sidecar");
      const methodsPath = path.join(backendRoot, "native", "libn4m.so");
      fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
      fs.writeFileSync(sidecarPath, "rust-sidecar");
      fs.writeFileSync(methodsPath, "libn4m-abi-2.2");

      const written = runtimeContract.writeRuntimeContract({
        backendRoot,
        platform: "linux",
        arch: "x64",
        methodsLibraryPath: methodsPath,
      });
      expect(written.contract.methods_library).toMatchObject({
        mode: "bundled-required",
        abi: { major: 2, minor: 2 },
      });
      expect(
        runtimeContract.verifyRuntimeContract({
          backendRoot,
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
      const bytes = Buffer.from("libn4m-abi-2.2");
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
      const bytes = Buffer.from("libn4m-abi-2.2");
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
        "--platform=darwin",
        "--arch",
        "arm64",
      ]),
    ).toEqual({
      backendRoot: path.resolve("release/product/resources/backend"),
      platform: "darwin",
      arch: "arm64",
    });
    expect(() => runtimeContract.parseVerifyArgs([])).toThrow(
      "--backend-root is required",
    );
  });
});
