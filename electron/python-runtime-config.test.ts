import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const runtimeConfig = require("../scripts/python-runtime-config.cjs") as {
  assertProfileSupportedOnPlatform(profileId: string, platform?: string): void;
  MANAGED_RUNTIME_PACKAGES: string[];
  PRODUCT_PROFILES: Record<string, { extraPackageNames: string[] }>;
  STANDALONE_V1_PROFILE: string;
  getArchiveFilename(platform: string, arch: string): string;
  getDownloadUrl(platform: string, arch: string): string;
  resolveProfileForFlavor(flavor: string, platform?: string): string;
};

describe("python-runtime-config", () => {
  it("keeps the standalone v1 scope pinned to the cpu profile extras", () => {
    expect(runtimeConfig.STANDALONE_V1_PROFILE).toBe("cpu");
    expect(runtimeConfig.PRODUCT_PROFILES.cpu.extraPackageNames).toEqual([
      "xgboost",
      "lightgbm",
      "trendfitter",
      "pyopls",
      "shap",
      "umap-learn",
    ]);
  });

  it("resolves python-build-standalone archive names and URLs from the shared mapping", () => {
    expect(runtimeConfig.getArchiveFilename("darwin", "arm64")).toBe(
      "cpython-3.11.13+20250828-aarch64-apple-darwin-install_only.tar.gz",
    );
    expect(runtimeConfig.getDownloadUrl("linux", "x64")).toBe(
      "https://github.com/astral-sh/python-build-standalone/releases/download/20250828/cpython-3.11.13+20250828-x86_64-unknown-linux-gnu-install_only.tar.gz",
    );
  });

  it("maps legacy installer flavors onto product profiles while preserving the managed runtime footprint", () => {
    expect(runtimeConfig.resolveProfileForFlavor("gpu", "darwin")).toBe("gpu-mps");
    expect(runtimeConfig.resolveProfileForFlavor("gpu", "win32")).toBe("gpu-cuda-torch");
    expect(runtimeConfig.MANAGED_RUNTIME_PACKAGES).toContain("nirs4all>=0.8.11");
    expect(runtimeConfig.MANAGED_RUNTIME_PACKAGES.some((pkg) => pkg.startsWith("torch"))).toBe(false);
  });

  it("rejects profiles and legacy flavors that are incompatible with the current platform", () => {
    expect(() => runtimeConfig.assertProfileSupportedOnPlatform("gpu-cuda-torch", "darwin")).toThrow(
      "Product profile 'gpu-cuda-torch' is not supported on platform 'darwin'. Supported platforms: win32, linux",
    );
    expect(() => runtimeConfig.resolveProfileForFlavor("gpu-metal", "win32")).toThrow(
      "Product profile 'gpu-mps' is not supported on platform 'win32'. Supported platforms: darwin",
    );
  });
});
