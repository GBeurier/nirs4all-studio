import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

interface LockEntry { name: string; version: string; filename: string; url: string; sha256: string }
interface Lock { target: string; requirements: { required: string[]; recommended: string[] }; packages: LockEntry[] }

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(import.meta.dirname, "..");
const locks = require("../scripts/python-wheel-lock.cjs") as {
  TARGETS: Record<string, { sourceBuilds?: string[]; unavailable?: string[] }>;
  lockPath(key: string, root?: string): string;
  lockedPackages(lock: Lock, options: { required: boolean }): LockEntry[];
  parseCompiledRequirements(text: string): Array<{ name: string; version: string; hashes: Set<string>; index: string | null }>;
  readLock(key: string, root?: string): Lock;
  targetKey(platform: string, arch: string): string;
  wheelRank(filename: string, key: string): number;
};
const uv = require("../scripts/fetch-uv.cjs") as {
  UV_ARCHIVES: Record<string, { filename: string; sha256: string }>;
  parseTargetArgs(argv: string[]): { platform: string; arch: string };
};
const catalogue = require("../recommended-config.json") as {
  required: Array<{ name: string; install: string }>;
  optional: Record<string, { recommended: string; default_install?: boolean }>;
};
const targets = Object.keys(locks.TARGETS);
const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("python wheel locks", () => {
  it("covers every installer target, like the pinned uv release", () => {
    expect(targets.sort()).toEqual(["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"]);
    expect(Object.keys(uv.UV_ARCHIVES).sort()).toEqual(targets);
    expect(Object.values(uv.UV_ARCHIVES).every((archive) => /^[0-9a-f]{64}$/.test(archive.sha256))).toBe(true);
    expect(locks.targetKey("win32", "x64")).toBe("win32-x64");
    expect(() => locks.targetKey("linux", "arm64")).toThrow("Unsupported target 'linux-arm64'");
    expect(uv.parseTargetArgs(["--platform", "darwin", "--arch", "arm64"])).toEqual({ platform: "darwin", arch: "arm64" });
    expect(() => uv.parseTargetArgs(["--arch"])).toThrow("--arch requires a value");
    expect(() => uv.parseTargetArgs(["--offline"])).toThrow("Unknown argument");
  });

  it.each(targets)("%s lock carries the catalogue's exact versions with one hash-pinned file per package", (key) => {
    const lock = locks.readLock(key);
    expect(lock.requirements.required).toEqual(catalogue.required.map((spec) => `${spec.name}==${spec.install}`));
    const unavailable = locks.TARGETS[key].unavailable ?? [];
    expect(lock.requirements.recommended).toEqual(
      Object.entries(catalogue.optional)
        .filter(([name, spec]) => spec.default_install === true && !unavailable.includes(name))
        .map(([name, spec]) => `${name}==${spec.recommended}`),
    );

    const names = lock.packages.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of lock.packages) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.url.startsWith("https://")).toBe(true);
      expect(decodeURIComponent(path.posix.basename(new URL(entry.url).pathname))).toBe(entry.filename);
    }
    const required = locks.lockedPackages(lock, { required: true });
    expect(required.map((entry) => `${entry.name}==${entry.version}`).sort()).toEqual([...lock.requirements.required].sort());
    expect(locks.lockedPackages(lock, { required: false })).toHaveLength(lock.packages.length - required.length);

    // Only the declared packages are built from source; every other file is a wheel for this target.
    const sources = lock.packages.filter((entry) => !entry.filename.endsWith(".whl"));
    expect(sources.map((entry) => entry.name).sort()).toEqual(["pyopls", ...(locks.TARGETS[key].sourceBuilds ?? [])].sort());
    expect(sources.every((entry) => entry.filename.endsWith(".tar.gz"))).toBe(true);
    for (const entry of lock.packages.filter((candidate) => candidate.filename.endsWith(".whl"))) {
      expect(locks.wheelRank(entry.filename, key), entry.filename).toBeGreaterThanOrEqual(0);
    }
  });

  it("refuses a lock that no longer matches the catalogue", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-wheel-lock-"));
    temporary.push(root);
    fs.mkdirSync(path.join(root, "build", "constraints"), { recursive: true });
    fs.copyFileSync(locks.lockPath("linux-x64"), locks.lockPath("linux-x64", root));
    fs.copyFileSync(path.join(projectRoot, "recommended-config.json"), path.join(root, "recommended-config.json"));
    expect(locks.readLock("linux-x64", root).target).toBe("linux-x64");

    const changed = structuredClone(catalogue);
    changed.required[0].install = "9.9.9";
    fs.writeFileSync(path.join(root, "recommended-config.json"), JSON.stringify(changed));
    expect(() => locks.readLock("linux-x64", root)).toThrow("does not match recommended-config.json");
  });

  it("selects wheels by CPython 3.11 and platform tags", () => {
    expect(locks.wheelRank("torch-2.6.0+cpu-cp311-cp311-linux_x86_64.whl", "linux-x64")).toBeGreaterThanOrEqual(0);
    expect(locks.wheelRank("numpy-2.4.6-cp311-cp311-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl", "linux-x64"))
      .toBeGreaterThan(locks.wheelRank("numpy-2.4.6-cp311-cp311-manylinux2014_x86_64.whl", "linux-x64"));
    expect(locks.wheelRank("x-1-cp311-cp311-manylinux_2_39_x86_64.whl", "linux-x64")).toBe(-1);
    expect(locks.wheelRank("x-1-cp311-cp311-manylinux_2_28_aarch64.whl", "linux-x64")).toBe(-1);
    expect(locks.wheelRank("x-1-cp312-cp312-win_amd64.whl", "win32-x64")).toBe(-1);
    expect(locks.wheelRank("x-1-cp312-abi3-win_amd64.whl", "win32-x64")).toBe(-1);
    expect(locks.wheelRank("x-1-cp310-abi3-win_amd64.whl", "win32-x64")).toBe(1);
    expect(locks.wheelRank("x-1-cp310-cp310-win_amd64.whl", "win32-x64")).toBe(-1);
    expect(locks.wheelRank("x-1-py2.py3-none-any.whl", "darwin-arm64")).toBe(0);
    expect(locks.wheelRank("x-1-py3-none-macosx_11_0_universal2.whl", "darwin-x64")).toBeGreaterThan(0);
    expect(locks.wheelRank("x-1-cp311-cp311-macosx_12_0_arm64.whl", "darwin-arm64")).toBeGreaterThan(0);
    expect(locks.wheelRank("x-1-cp311-cp311-macosx_14_0_arm64.whl", "darwin-arm64")).toBe(-1);
    expect(locks.wheelRank("x-1-cp311-cp311-macosx_11_0_arm64.whl", "darwin-x64")).toBe(-1);
    expect(locks.wheelRank("x-1.tar.gz", "linux-x64")).toBe(-1);
  });

  it("reads the resolved versions, hashes and index of a uv compilation", () => {
    expect(locks.parseCompiledRequirements([
      "numpy==2.4.6 \\",
      `    --hash=sha256:${"a".repeat(64)} \\`,
      `    --hash=sha256:${"b".repeat(64)}`,
      "    # from https://pypi.org/simple",
      "Nirs4all_Core==0.5.0 \\",
      `    --hash=sha256:${"c".repeat(64)}`,
      "    # from https://download.pytorch.org/whl/cpu",
    ].join("\n"))).toEqual([
      { name: "numpy", version: "2.4.6", hashes: new Set(["a".repeat(64), "b".repeat(64)]), index: "https://pypi.org/simple" },
      { name: "nirs4all-core", version: "0.5.0", hashes: new Set(["c".repeat(64)]), index: "https://download.pytorch.org/whl/cpu" },
    ]);
  });
});
