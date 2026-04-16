import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const archiveBuildModule = require("../scripts/build-archive-standalone.cjs") as {
  getElectronBuilderArgs(config: { platform: string; arch: string }): string[];
  parseArgs(argv?: string[]): {
    profile: string;
    platform: string;
    arch: string;
    clean: boolean;
    skipBackend: boolean;
    skipFrontend: boolean;
    cacheDir: string;
    constraintsFile: string;
    help?: boolean;
  };
  resolveBuildConfig(
    rawOptions: {
      profile: string;
      platform: string;
      arch: string;
      clean: boolean;
      skipBackend: boolean;
      skipFrontend: boolean;
      cacheDir: string;
      constraintsFile: string;
    },
    host?: { platform: string; arch: string },
  ): {
    profile: string;
    platform: string;
    arch: string;
    clean: boolean;
    skipBackend: boolean;
    skipFrontend: boolean;
    cacheDir: string;
    constraintsFile: string;
  };
};

describe("build-archive-standalone", () => {
  it("parses the standalone archive CLI options", () => {
    const parsed = archiveBuildModule.parseArgs([
      "--profile=cpu",
      "--platform",
      "linux",
      "--arch=x64",
      "--clean",
      "--skip-frontend",
      "--cache-dir=build/.cache",
      "--constraints",
      "build/constraints/linux.txt",
    ]);

    expect(parsed.profile).toBe("cpu");
    expect(parsed.platform).toBe("linux");
    expect(parsed.arch).toBe("x64");
    expect(parsed.clean).toBe(true);
    expect(parsed.skipFrontend).toBe(true);
    expect(parsed.skipBackend).toBe(false);
    expect(parsed.cacheDir).toBe(path.resolve("build/.cache"));
    expect(parsed.constraintsFile).toBe(path.resolve("build/constraints/linux.txt"));
  });

  it("rejects non-cpu profiles for standalone archive v1", () => {
    expect(() =>
      archiveBuildModule.resolveBuildConfig(
        {
          profile: "gpu-cuda-torch",
          platform: "linux",
          arch: "x64",
          clean: false,
          skipBackend: false,
          skipFrontend: false,
          cacheDir: path.resolve("build/.python-cache"),
          constraintsFile: "",
        },
        { platform: "linux", arch: "x64" },
      ),
    ).toThrow("Standalone archive packaging is locked to the 'cpu' profile in v1.");
  });

  it("rejects archive builds on a different host target", () => {
    expect(() =>
      archiveBuildModule.resolveBuildConfig(
        {
          profile: "cpu",
          platform: "darwin",
          arch: "arm64",
          clean: false,
          skipBackend: false,
          skipFrontend: false,
          cacheDir: path.resolve("build/.python-cache"),
          constraintsFile: "",
        },
        { platform: "win32", arch: "x64" },
      ),
    ).toThrow("Archive packaging must run on the matching target host.");
  });

  it("builds electron-builder args against the archive config", () => {
    expect(
      archiveBuildModule.getElectronBuilderArgs({ platform: "linux", arch: "x64" }),
    ).toEqual([
      path.join("node_modules", "electron-builder", "cli.js"),
      "--config",
      "electron-builder.archive.yml",
      "--publish",
      "never",
      "--linux",
      "--x64",
    ]);
  });

  it("uses the unpacked dir target for macOS archives to avoid blockmap generation", () => {
    expect(
      archiveBuildModule.getElectronBuilderArgs({ platform: "darwin", arch: "arm64" }),
    ).toEqual([
      path.join("node_modules", "electron-builder", "cli.js"),
      "--config",
      "electron-builder.archive.yml",
      "--publish",
      "never",
      "--mac",
      "--dir",
      "--arm64",
    ]);
  });
});
