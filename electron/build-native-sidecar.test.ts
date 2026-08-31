import path from "node:path";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const buildNativeSidecar = require("../scripts/build-native-sidecar.cjs") as {
  getNativeSidecarPaths(root?: string, platform?: NodeJS.Platform): {
    manifestPath: string;
    builtBinaryPath: string;
    packagedBinaryPath: string;
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
});
