import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const buildScript = path.join(projectRoot, "scripts", "build-release.cjs");

function snapshotMutableInputs(): Record<string, string | null> {
  return Object.fromEntries(
    ["package.json", "version.json"].map((relativePath) => {
      const filePath = path.join(projectRoot, relativePath);
      return [relativePath, fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null];
    }),
  );
}

describe("build-release fail-closed preflight", () => {
  const hostPlatforms: Partial<Record<NodeJS.Platform, string>> = {
    win32: "win", darwin: "mac", linux: "linux",
  };
  const hostPlatform = hostPlatforms[process.platform];

  it.each([
    [["--mode", "standalone"], "release:all-in-one"],
    [["--standalone"], "release:all-in-one"],
    [["--flavor", "gpu"], "--flavor cpu"],
    [["--flavor", "cpu-lite"], "--flavor cpu"],
    [["--platform", "all"], "not attested"],
    [["--platform", hostPlatform === "linux" ? "win" : "linux"], "not attested"],
    [["--platform", "windows"], "not attested"],
    [["--mode", "invalid"], "release:all-in-one"],
    [["--mode"], "requires a value"],
    [["--platform"], "requires a value"],
    [["--flavor"], "requires a value"],
    [["--unknown"], "Unknown argument"],
    [["positional"], "Unknown argument"],
    [["--help"], "Unknown argument"],
  ])("rejects %j before version mutation or build spawn", (args, expected) => {
    const before = snapshotMutableInputs();
    const completed = spawnSync(process.execPath, [buildScript, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
    });

    expect(completed.status).toBe(1);
    expect(completed.stderr).toContain(expected);
    expect(completed.stdout).not.toContain("Running:");
    expect(snapshotMutableInputs()).toEqual(before);
  });
});
