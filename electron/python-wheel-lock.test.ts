import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

interface LockEntry { name: string; version: string; filename: string; url: string; sha256: string }
interface Lock {
  target: string;
  python: string;
  rules: { platform: string; source_builds: string[]; macos_deployment_target?: string };
  requirements: { required: string[]; recommended?: string[]; offline_extras?: string[]; image_extras?: string[] };
  packages: LockEntry[];
  image_packages?: LockEntry[];
}

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(import.meta.dirname, "..");
const locks = require("../scripts/python-wheel-lock.cjs") as {
  TARGETS: Record<string, { embeddedWheels?: boolean; imageExtras?: string[] }>;
  lockPath(key: string, root?: string): string;
  lockedOfflineNames(lock: Lock, set: "recommended" | "offline_extras"): string[];
  lockedPackages(lock: Lock, set: "required" | "offline" | "image"): LockEntry[];
  parseCompiledRequirements(text: string): Array<{ name: string; version: string; hashes: Set<string>; index: string | null }>;
  readLock(key: string, root?: string): Lock;
  targetKey(platform: string, arch: string): string;
  wheelRank(filename: string, key: string): number;
};
const uv = require("../scripts/fetch-uv.cjs") as {
  UV_ARCHIVES: Record<string, { filename: string; sha256: string }>;
  parseTargetArgs(argv: string[], flags?: { valueFlags?: string[]; booleanFlags?: string[] }): Record<string, string | boolean>;
};
const runtime = require("../scripts/python-runtime-config.cjs") as { PYTHON_VERSION: string };
const catalogue = require("../recommended-config.json") as {
  required: Array<{ name: string; install: string }>;
  optional: Record<string, { recommended: string; default_install?: boolean; offline_payload?: boolean }>;
};
const targets = Object.keys(locks.TARGETS);
const defaultRecommended = Object.entries(catalogue.optional)
  .filter(([, spec]) => spec.default_install === true)
  .map(([name, spec]) => `${name}==${spec.recommended}`);
// Carried by the offline installers although Studio installs them on request only.
const offlineExtras = Object.entries(catalogue.optional)
  .filter(([, spec]) => spec.offline_payload === true && spec.default_install !== true)
  .map(([name, spec]) => `${name}==${spec.recommended}`);
const temporary: string[] = [];

/** A copy of the project files that a lock is checked against. */
function lockFixture(key: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-wheel-lock-"));
  temporary.push(root);
  fs.mkdirSync(path.join(root, "build", "constraints"), { recursive: true });
  fs.copyFileSync(locks.lockPath(key), locks.lockPath(key, root));
  fs.copyFileSync(path.join(projectRoot, "recommended-config.json"), path.join(root, "recommended-config.json"));
  return root;
}

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("python wheel locks", () => {
  it("covers every installer target, like the pinned uv release", () => {
    expect(targets.sort()).toEqual(["darwin-arm64", "linux-x64", "win32-x64"]);
    expect(Object.keys(uv.UV_ARCHIVES).sort()).toEqual(targets);
    expect(Object.values(uv.UV_ARCHIVES).every((archive) => /^[0-9a-f]{64}$/.test(archive.sha256))).toBe(true);
    expect(locks.targetKey("win32", "x64")).toBe("win32-x64");
    expect(() => locks.targetKey("darwin", "x64")).toThrow("Unsupported target 'darwin-x64'");
    expect(fs.readdirSync(path.join(projectRoot, "build", "constraints")).filter((name) => name.endsWith(".json")).sort())
      .toEqual(targets.map((key) => `python-wheels-${key}.json`));
  });

  it("parses the target and each script's own flags", () => {
    expect(uv.parseTargetArgs(["--platform", "darwin", "--arch", "arm64"])).toEqual({ platform: "darwin", arch: "arm64" });
    expect(uv.parseTargetArgs(["--image"], { booleanFlags: ["image"] })).toMatchObject({ image: true });
    expect(uv.parseTargetArgs(["--tag", "1.2.3"], { valueFlags: ["tag"] })).toMatchObject({ tag: "1.2.3" });
    expect(() => uv.parseTargetArgs(["--arch"])).toThrow("--arch requires a value");
    expect(() => uv.parseTargetArgs(["--image"])).toThrow("Unknown argument: --image");
    expect(() => uv.parseTargetArgs(["positional"])).toThrow("Unknown argument");
  });

  it.each(targets)("%s lock carries the catalogue's exact versions with one hash-pinned file per package", (key) => {
    const lock = locks.readLock(key);
    const target = locks.TARGETS[key];
    expect(lock.python).toBe(runtime.PYTHON_VERSION.split(".").slice(0, 2).join("."));
    expect(lock.requirements.required).toEqual(catalogue.required.map((spec) => `${spec.name}==${spec.install}`));
    expect(lock.requirements.recommended).toEqual(target.embeddedWheels ? defaultRecommended : undefined);
    expect(lock.requirements.offline_extras).toEqual(target.embeddedWheels ? offlineExtras : undefined);
    expect(lock.requirements.image_extras).toEqual(target.imageExtras?.map((name) => `${name}==${catalogue.optional[name].recommended}`));

    const required = locks.lockedPackages(lock, "required");
    expect(required.map((entry) => `${entry.name}==${entry.version}`).sort()).toEqual([...lock.requirements.required].sort());
    for (const closure of [lock.packages, lock.image_packages ?? []]) {
      const names = closure.map((entry) => entry.name);
      expect(new Set(names).size).toBe(names.length);
      for (const entry of closure) {
        expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(entry.url.startsWith("https://")).toBe(true);
        expect(decodeURIComponent(path.posix.basename(new URL(entry.url).pathname))).toBe(entry.filename);
        // Only declared source builds are not wheels; every wheel installs on this target.
        if (entry.filename.endsWith(".whl")) expect(locks.wheelRank(entry.filename, key), entry.filename).toBeGreaterThanOrEqual(0);
        else expect(lock.rules.source_builds, entry.filename).toContain(entry.name);
      }
    }
    if (target.embeddedWheels) {
      expect(locks.lockedPackages(lock, "offline")).toHaveLength(lock.packages.length - required.length);
      expect(locks.lockedOfflineNames(lock, "recommended")).toEqual(defaultRecommended.map((spec) => spec.split("==")[0]));
      expect(locks.lockedOfflineNames(lock, "offline_extras")).toEqual(["torch"]);
      // PyTorch is not installed by default, yet its CPU wheel stays in the offline payload.
      expect(defaultRecommended.some((spec) => spec.startsWith("torch=="))).toBe(false);
      expect(locks.lockedPackages(lock, "offline").find((entry) => entry.name === "torch")?.version).toBe(`${catalogue.optional.torch.recommended}+cpu`);
    } else {
      // No offline installer: only the required cohort itself is shipped.
      expect(lock.packages).toHaveLength(required.length);
      expect(() => locks.lockedPackages(lock, "offline")).toThrow(`The ${key} lock has no offline closure`);
    }
  });

  it("locks the Docker image closure with the versions of the offline closure", () => {
    const lock = locks.readLock("linux-x64");
    const offline = new Map(lock.packages.map((entry) => [entry.name, entry.sha256]));
    const image = lock.image_packages!;
    for (const name of ["shap", "matplotlib", "lightgbm", "nirs4all", "numpy"]) expect(image.map((entry) => entry.name)).toContain(name);
    expect(image.filter((entry) => offline.has(entry.name) && offline.get(entry.name) !== entry.sha256)).toEqual([]);
    expect(locks.lockedPackages(lock, "image").some((entry) => entry.name === "nirs4all")).toBe(false);
    expect(() => locks.lockedPackages(locks.readLock("win32-x64"), "image")).toThrow("has no image closure");
  });

  it("proves that every required package publishes a wheel for the target that installs them from the package index", () => {
    // The macOS application embeds no wheels: nothing is built from source and nothing is staged for it.
    expect(locks.TARGETS["darwin-arm64"].embeddedWheels).toBeUndefined();
    const lock = locks.readLock("darwin-arm64");
    expect(lock.rules).toEqual({ platform: "aarch64-apple-darwin", macos_deployment_target: "12.0", source_builds: ["pyopls"] });
    expect(lock.packages.map((entry) => entry.name).sort()).toEqual(catalogue.required.map((spec) => spec.name).sort());
    for (const entry of lock.packages) {
      expect(entry.filename, entry.name).toMatch(/-(?:any|macosx_\d+_\d+_(?:arm64|universal2))\.whl$/);
    }
    expect(catalogue.required.map((spec) => spec.name)).not.toContain("nirs4all-formats");
  });

  it("refuses a lock that no longer matches the catalogue, the pinned Python or the target's rules", () => {
    const root = lockFixture("linux-x64");
    expect(locks.readLock("linux-x64", root).target).toBe("linux-x64");
    const lockFile = locks.lockPath("linux-x64", root);
    const original = fs.readFileSync(lockFile, "utf8");
    for (const change of [
      (lock: Lock) => { lock.python = "3.12"; },
      (lock: Lock) => { lock.rules.platform = "x86_64-manylinux_2_28"; },
      (lock: Lock) => { lock.rules.source_builds = []; },
      (lock: Lock) => { lock.requirements.image_extras = ["shap==0.1"]; },
      (lock: Lock) => { lock.requirements.offline_extras = []; },
    ]) {
      const lock = JSON.parse(original) as Lock;
      change(lock);
      fs.writeFileSync(lockFile, JSON.stringify(lock));
      expect(() => locks.readLock("linux-x64", root)).toThrow("does not match recommended-config.json, Python 3.11 or the linux-x64 rules");
    }
    fs.writeFileSync(lockFile, original);
    const changed = structuredClone(catalogue);
    changed.required[0].install = "9.9.9";
    fs.writeFileSync(path.join(root, "recommended-config.json"), JSON.stringify(changed));
    expect(() => locks.readLock("linux-x64", root)).toThrow("does not match recommended-config.json");
  });

  it("selects wheels by the pinned CPython and platform tags", () => {
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
    expect(locks.wheelRank("x-1-py3-none-macosx_11_0_universal2.whl", "darwin-arm64")).toBeGreaterThan(0);
    expect(locks.wheelRank("x-1-cp311-cp311-macosx_12_0_arm64.whl", "darwin-arm64")).toBeGreaterThan(0);
    // The deployment target that source builds use is the newest tag accepted.
    expect(locks.wheelRank("x-1-cp311-cp311-macosx_12_1_arm64.whl", "darwin-arm64")).toBe(-1);
    expect(locks.wheelRank("x-1-cp311-cp311-macosx_14_0_arm64.whl", "darwin-arm64")).toBe(-1);
    expect(locks.wheelRank("x-1-cp311-cp311-macosx_11_0_x86_64.whl", "darwin-arm64")).toBe(-1);
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
