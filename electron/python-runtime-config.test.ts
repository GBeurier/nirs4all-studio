import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const runtimeConfig = require("../scripts/python-runtime-config.cjs") as {
  PYTHON_VERSION: string;
  getArchiveFilename(platform: string, arch: string): string;
  getArchiveSha256(platform: string, arch: string): string;
  getDownloadUrl(platform: string, arch: string): string;
  listSupportedPlatformArchKeys(): string[];
};
const transitionalHttpConfig = require("../scripts/python-http-runtime-config.cjs") as {
  BACKEND_COMMON_PACKAGES: string[];
};

describe("python-runtime-config", () => {
  it("pins one python-build-standalone archive and its SHA-256 per supported target", () => {
    expect(runtimeConfig.PYTHON_VERSION).toBe("3.11.13");
    expect(runtimeConfig.listSupportedPlatformArchKeys()).toEqual(["darwin-arm64", "linux-x64", "win32-x64"]);
    expect(runtimeConfig.getArchiveFilename("linux", "x64")).toBe(
      "cpython-3.11.13+20250828-x86_64-unknown-linux-gnu-install_only.tar.gz",
    );
    expect(runtimeConfig.getDownloadUrl("darwin", "arm64")).toBe(
      "https://github.com/astral-sh/python-build-standalone/releases/download/20250828/cpython-3.11.13+20250828-aarch64-apple-darwin-install_only.tar.gz",
    );
    const digests = runtimeConfig.listSupportedPlatformArchKeys().map((key) => {
      const [platform, arch] = key.split("-");
      expect(runtimeConfig.getArchiveFilename(platform, arch)).toContain(`cpython-${runtimeConfig.PYTHON_VERSION}+`);
      return runtimeConfig.getArchiveSha256(platform, arch);
    });
    expect(digests.every((digest) => /^[0-9a-f]{64}$/.test(digest))).toBe(true);
    expect(new Set(digests).size).toBe(3);
  });

  it("refuses a target without a pinned archive", () => {
    expect(() => runtimeConfig.getArchiveFilename("linux", "arm64")).toThrow(
      "Unsupported python-build-standalone target 'linux-arm64'",
    );
    expect(() => runtimeConfig.getDownloadUrl("darwin", "x64")).toThrow("Unsupported python-build-standalone target 'darwin-x64'");
    expect(() => runtimeConfig.getArchiveSha256("win32", "arm64")).toThrow("Unsupported python-build-standalone target");
  });

  it("exposes no package list: the catalogue is recommended-config.json alone", () => {
    expect(Object.keys(runtimeConfig).sort()).toEqual([
      "PYTHON_VERSION", "getArchiveFilename", "getArchiveSha256", "getDownloadUrl", "listSupportedPlatformArchKeys",
    ]);
    expect(transitionalHttpConfig.BACKEND_COMMON_PACKAGES).toContain("fastapi>=0.115.0");
  });
});
