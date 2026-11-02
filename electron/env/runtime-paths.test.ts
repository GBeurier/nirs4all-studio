import { describe, expect, it } from "vitest";

import type { DetectedEnv } from "./env-inspection";
import { compareDetectedEnvs, isBundledRuntimeLayoutPath } from "./runtime-paths";

function env(overrides: Partial<DetectedEnv>): DetectedEnv {
  return {
    path: "/envs/default",
    pythonPath: "/envs/default/bin/python",
    pythonVersion: "3.11.9",
    hasNirs4all: true,
    hasCorePackages: true,
    envKind: "venv",
    writable: true,
    ...overrides,
  };
}

describe("detected environment ordering", () => {
  it("lists the included runtime first after the configured interpreter", () => {
    const configured = env({ path: "/envs/configured", pythonPath: "/envs/configured/bin/python", hasCorePackages: false });
    const writable = env({ path: "/envs/work", pythonPath: "/envs/work/bin/python" });
    const bundled = env({ path: "/app/python", pythonPath: "/app/python/bin/python3", envKind: "bundled", writable: false });

    const sorted = [writable, bundled, configured].sort((left, right) => compareDetectedEnvs(configured.pythonPath, left, right));

    expect(sorted.map((candidate) => candidate.path)).toEqual(["/envs/configured", "/app/python", "/envs/work"]);
  });
});

describe("included runtime layout", () => {
  it("recognizes interpreters of the included runtime from any install location", () => {
    expect(isBundledRuntimeLayoutPath("C:\\Program Files\\nirs4all Studio\\resources\\backend\\python-runtime\\python\\python.exe")).toBe(true);
    expect(isBundledRuntimeLayoutPath("/Applications/nirs4all Studio.app/Contents/Resources/backend/python-runtime/python/bin/python3")).toBe(true);
    expect(isBundledRuntimeLayoutPath("/home/user/.venvs/nirs/bin/python")).toBe(false);
  });
});
