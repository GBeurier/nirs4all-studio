import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const methodsBuild = require("../scripts/build-native-methods.cjs") as {
  appendGitHubEnvironment(
    environmentPath: string,
    library: { libraryPath: string; sha256: string },
  ): void;
  parseArgs(argv?: string[]): {
    sourceRoot: string;
    platform: string;
    arch: string;
    githubEnv: string;
  };
  resolveBuiltLibrary(
    sourceRoot: string,
    config: { preset: string; libraryPattern: RegExp },
  ): { libraryPath: string; size: number; sha256: string };
  targetConfig(platform: string, arch: string): {
    preset: string;
    libraryPattern: RegExp;
    cliParts: string[];
    configureExtra: string[];
    buildExtra: string[];
    ctestExtra: string[];
  };
};

describe("native Methods product build", () => {
  it("maps every release platform to the native upstream preset", () => {
    expect(methodsBuild.targetConfig("linux", "x64")).toMatchObject({
      preset: "ci-linux-gcc12-release",
      cliParts: ["cpp", "cli", "n4m_cli"],
    });
    expect(methodsBuild.targetConfig("win32", "x64")).toMatchObject({
      preset: "ci-windows-msvc-release",
      cliParts: ["cpp", "cli", "Release", "n4m_cli.exe"],
      buildExtra: ["--config", "Release"],
    });
    expect(methodsBuild.targetConfig("darwin", "x64").configureExtra).toContain(
      "-DCMAKE_OSX_ARCHITECTURES=x86_64",
    );
    expect(methodsBuild.targetConfig("darwin", "arm64").configureExtra).toContain(
      "-DCMAKE_OSX_ARCHITECTURES=arm64",
    );
    expect(() => methodsBuild.targetConfig("linux", "arm64")).toThrow(/Unsupported/);
  });

  it("selects the one real versioned library and excludes symlink aliases", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-methods-build-"));
    try {
      const libraryRoot = path.join(
        root,
        "build",
        "ci-linux-gcc12-release",
        "cpp",
        "src",
      );
      fs.mkdirSync(libraryRoot, { recursive: true });
      const realLibrary = path.join(libraryRoot, "libn4m.so.2.3.0");
      fs.writeFileSync(realLibrary, "abi-2.3");
      fs.symlinkSync("libn4m.so.2.3.0", path.join(libraryRoot, "libn4m.so"));

      expect(
        methodsBuild.resolveBuiltLibrary(
          root,
          methodsBuild.targetConfig("linux", "x64"),
        ),
      ).toMatchObject({ libraryPath: realLibrary, size: 7 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("exports only the content-addressed library identity to later workflow steps", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-methods-env-"));
    try {
      const environmentPath = path.join(root, "github-env");
      methodsBuild.appendGitHubEnvironment(environmentPath, {
        libraryPath: "/build/libn4m.so.2.3.0",
        sha256: "a".repeat(64),
      });
      expect(fs.readFileSync(environmentPath, "utf8")).toBe(
        `NIRS4ALL_BUILD_METHODS_LIBRARY=/build/libn4m.so.2.3.0\n` +
          `NIRS4ALL_BUILD_METHODS_DIRECTORY=/build\n` +
          `NIRS4ALL_BUILD_METHODS_SHA256=${"a".repeat(64)}\n`,
      );
      expect(() =>
        methodsBuild.appendGitHubEnvironment(environmentPath, {
          libraryPath: "/build/evil\npath",
          sha256: "b".repeat(64),
        }),
      ).toThrow(/newline/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires an explicit source checkout", () => {
    expect(() => methodsBuild.parseArgs([])).toThrow("--source-root is required");
    expect(
      methodsBuild.parseArgs([
        "--source-root", "_deps/nirs4all-methods",
        "--platform", "darwin",
        "--arch=arm64",
      ]),
    ).toMatchObject({
      sourceRoot: path.resolve("_deps/nirs4all-methods"),
      platform: "darwin",
      arch: "arm64",
    });
  });
});
