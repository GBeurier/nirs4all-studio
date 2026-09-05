import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const runtimeConfig = require("../scripts/python-runtime-config.cjs") as {
  assertProfileSupportedOnPlatform(profileId: string, platform?: string): void;
  LITE_EXCLUDED_PACKAGE_NAMES: string[];
  MANAGED_RUNTIME_PACKAGES: string[];
  PLUGIN_DISTRIBUTION_VERSION: string;
  PLUGIN_HOST_PACKAGES: string[];
  PRODUCT_PROFILES: Record<string, { extraPackageNames: string[] }>;
  STANDALONE_V1_PROFILE: string;
  getArchiveFilename(platform: string, arch: string): string;
  getDownloadUrl(platform: string, arch: string): string;
  getProfilePackageInstallSpecs(profileId: string, options?: { platform?: string }): string[];
  resolveProfileForFlavor(flavor: string, platform?: string): string;
};
const transitionalHttpConfig = require("../scripts/python-http-runtime-config.cjs") as {
  BACKEND_COMMON_PACKAGES: string[];
  BACKEND_TRANSITION_TOOL_PACKAGES: string[];
};

describe("python-runtime-config", () => {
  it("keeps transitional HTTP dependencies out of the packaged plugin-host config", () => {
    expect(transitionalHttpConfig.BACKEND_TRANSITION_TOOL_PACKAGES).toEqual([
      "nirs4all-tools>=0.0.5",
    ]);
    expect(transitionalHttpConfig.BACKEND_COMMON_PACKAGES).toContain("fastapi>=0.115.0");
    expect(runtimeConfig.PLUGIN_DISTRIBUTION_VERSION).toBe("1.0.1");
    expect(runtimeConfig.PLUGIN_HOST_PACKAGES).toEqual(["nirs4all==1.0.1"]);
    expect(runtimeConfig.MANAGED_RUNTIME_PACKAGES).toEqual(runtimeConfig.PLUGIN_HOST_PACKAGES);

    const packagedSpecs = runtimeConfig.MANAGED_RUNTIME_PACKAGES.join(" ").toLowerCase();
    for (const forbidden of ["fastapi", "uvicorn", "python-multipart", "sentry-sdk"]) {
      expect(packagedSpecs).not.toContain(forbidden);
    }
  });

  it("keeps the standalone v1 scope pinned to the cpu profile extras", () => {
    expect(runtimeConfig.STANDALONE_V1_PROFILE).toBe("cpu");
    expect(runtimeConfig.PRODUCT_PROFILES.cpu.extraPackageNames).toEqual([
      "pyopls",
      "trendfitter",
      "xgboost",
      "umap-learn",
      "torch",
    ]);
  });

  it("keeps the cpu-lite profile lite: exclusions and CPU-wheel renames come from recommended-config.json", () => {
    // The lite rules are data on the cpu-lite profile (exclude_optionals /
    // package_renames) shared with api/recommended_config.py — losing them in
    // the JSON would silently re-grow the lite build, so pin the result here.
    expect(runtimeConfig.LITE_EXCLUDED_PACKAGE_NAMES).toEqual([
      "torch",
      "tensorflow",
      "keras",
      "jax",
      "jaxlib",
      "flax",
      "tabpfn",
      "tabicl",
      "autogluon",
      "umap-learn",
    ]);
    expect(runtimeConfig.PRODUCT_PROFILES["cpu-lite"].extraPackageNames).toEqual([
      "pyopls",
      "trendfitter",
      "xgboost",
    ]);
    expect(runtimeConfig.getProfilePackageInstallSpecs("cpu-lite", { platform: "linux" })).toEqual([
      "nirs4all>=1.0.1",
      "pyopls>=20.0",
      "trendfitter>=0.0.6",
      "xgboost-cpu>=2.0.0",
    ]);
    expect(runtimeConfig.getProfilePackageInstallSpecs("cpu-lite", { platform: "win32" })).toEqual([
      "nirs4all>=1.0.1",
      "pyopls>=20.0",
      "trendfitter>=0.0.6",
      "xgboost-cpu>=2.0.0",
    ]);
    // No macOS xgboost-cpu wheel exists — darwin keeps the regular name.
    expect(runtimeConfig.getProfilePackageInstallSpecs("cpu-lite", { platform: "darwin" })).toEqual([
      "nirs4all>=1.0.1",
      "pyopls>=20.0",
      "trendfitter>=0.0.6",
      "xgboost>=2.0.0",
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
    expect(runtimeConfig.MANAGED_RUNTIME_PACKAGES).toContain("nirs4all==1.0.1");
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
