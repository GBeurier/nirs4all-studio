import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

const {
  isSemver,
  looksLikeWslUncPath,
  parseArgs,
} = require("../scripts/build-local-windows-rc.cjs") as {
  isSemver(value: string): boolean;
  looksLikeWslUncPath(value: string): boolean;
  parseArgs(argv?: string[]): {
    version: string;
    clean: boolean;
    skipSmoke: boolean;
    help: boolean;
  };
};

describe("build-local-windows-rc helper", () => {
  it("accepts SemVer prerelease versions used for Studio RC installers", () => {
    expect(isSemver("1.0.0-rc.1")).toBe(true);
    expect(isSemver("1.0.0-rc.1+build.4")).toBe(true);
    expect(isSemver("1.0")).toBe(false);
    expect(isSemver("v1.0.0-rc.1")).toBe(false);
  });

  it("parses the local Windows RC build flags without mutating defaults", () => {
    expect(parseArgs(["--version", "1.0.0-rc.1"])).toEqual({
      version: "1.0.0-rc.1",
      clean: true,
      skipSmoke: false,
      help: false,
    });
    expect(parseArgs(["--version=1.0.0-rc.2", "--skip-smoke", "--no-clean"])).toEqual({
      version: "1.0.0-rc.2",
      clean: false,
      skipSmoke: true,
      help: false,
    });
  });

  it("rejects WSL UNC paths for native Windows installer builds", () => {
    expect(looksLikeWslUncPath("\\\\wsl.localhost\\Ubuntu\\home\\delete\\nirs4all")).toBe(true);
    expect(looksLikeWslUncPath("\\\\wsl$\\Ubuntu\\home\\delete\\nirs4all")).toBe(true);
    expect(looksLikeWslUncPath("C:\\src\\nirs4all\\nirs4all-studio")).toBe(false);
  });
});
