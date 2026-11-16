import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./process-utils", () => ({ runCommand: vi.fn() }));
import { REQUIRED_PACKAGES } from "./catalogue";
import { runCommand } from "./process-utils";
import {
  createVenv,
  installRecommendedPackages,
  installRequiredPackages,
  pipInstallArgs,
  resolveUvPath,
  resolveUvPayload,
  venvArgs,
} from "./uv";

const UV = process.platform === "win32" ? "uv.exe" : "uv";
const PYTHON = "/envs/studio/bin/python";
const REQUIRED_SPECS = REQUIRED_PACKAGES.map((spec) => `${spec.name}==${spec.install}`);
const roots: string[] = [];
let resources: string;
let development: string;

function shipped(root: string, ...segments: string[]): string {
  const target = path.join(root, ...segments);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (path.extname(target) || segments.at(-1) === UV) fs.writeFileSync(target, "");
  else fs.mkdirSync(target, { recursive: true });
  return target;
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-uv-"));
  roots.push(root);
  resources = path.join(root, "resources");
  development = path.join(root, "checkout");
  fs.mkdirSync(resources);
  fs.mkdirSync(development);
  Object.defineProperty(process, "resourcesPath", { value: resources, configurable: true });
  vi.spyOn(process, "cwd").mockReturnValue(development);
  vi.mocked(runCommand).mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.NIRS4ALL_UV;
  delete (process as { resourcesPath?: string }).resourcesPath;
  vi.restoreAllMocks();
  vi.mocked(runCommand).mockReset();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("uv resolution", () => {
  it("prefers NIRS4ALL_UV, then the shipped binary, then the development build, then PATH", () => {
    expect(resolveUvPath()).toBe("uv");
    const developmentUv = shipped(development, "backend-dist", "tools", UV);
    expect(resolveUvPath()).toBe(developmentUv);
    const packagedUv = shipped(resources, "backend", "tools", UV);
    expect(resolveUvPath()).toBe(packagedUv);
    process.env.NIRS4ALL_UV = "/opt/tools/uv";
    expect(resolveUvPath()).toBe("/opt/tools/uv");
  });

  it("finds the wheelhouse and the offline payload shipped with the installer", () => {
    expect(resolveUvPayload()).toEqual({ wheelhouse: null, offline: null });
    const developmentWheels = shipped(development, "backend-dist", "wheels");
    expect(resolveUvPayload()).toEqual({ wheelhouse: developmentWheels, offline: null });
    const wheelhouse = shipped(resources, "backend", "wheels");
    const offline = shipped(resources, "backend", "offline");
    expect(resolveUvPayload()).toEqual({ wheelhouse, offline });
  });
});

describe("uv arguments", () => {
  it("always names the interpreter and installs from the package index by default", () => {
    expect(pipInstallArgs(PYTHON, ["xgboost==3.0.0"], { wheelhouse: null, offline: null }, false)).toEqual([
      "pip", "install", "--python", PYTHON, "xgboost==3.0.0",
    ]);
  });

  it("offers the shipped wheelhouse as an additional source", () => {
    expect(pipInstallArgs(PYTHON, REQUIRED_SPECS, { wheelhouse: "/res/backend/wheels", offline: null }, false)).toEqual([
      "pip", "install", "--python", PYTHON, "--find-links", "/res/backend/wheels", ...REQUIRED_SPECS,
    ]);
  });

  it("restricts an offline installation to the shipped wheels", () => {
    const args = pipInstallArgs(PYTHON, ["torch==2.6.0"], { wheelhouse: "/res/backend/wheels", offline: "/res/backend/offline" }, true);
    expect(args).toEqual([
      "pip", "install", "--python", PYTHON, "--offline", "--no-index",
      "--find-links", "/res/backend/wheels", "--find-links", path.join("/res/backend/offline", "wheels"),
      "torch==2.6.0",
    ]);
    // The shipped torch wheel is used as is: no index is consulted for a backend.
    expect(args).not.toContain("--torch-backend");
  });

  it("lets uv choose the torch build for this machine when torch comes from an index", () => {
    expect(pipInstallArgs(PYTHON, ["shap==0.47.1", "torch==2.6.0"], { wheelhouse: null, offline: null }, false)).toEqual([
      "pip", "install", "--python", PYTHON, "--torch-backend", "auto", "shap==0.47.1", "torch==2.6.0",
    ]);
    expect(pipInstallArgs(PYTHON, ["torchvision==0.21.0"], { wheelhouse: null, offline: null }, false)).not.toContain("--torch-backend");
  });

  it("creates a virtual environment on an explicit base interpreter", () => {
    expect(venvArgs("/data/python-env/venv", "/data/python-env/python/bin/python3", { wheelhouse: null, offline: null }))
      .toEqual(["venv", "/data/python-env/venv", "--python", "/data/python-env/python/bin/python3"]);
    expect(venvArgs("/v", "/p", { wheelhouse: null, offline: "/res/backend/offline" })).toEqual(["venv", "/v", "--python", "/p", "--offline"]);
  });
});

describe("uv installations", () => {
  const uvEnvironment = { UV_LINK_MODE: "copy", UV_NATIVE_TLS: "1" };
  const PINS = ["nirs4all==1.4.18", "nirs4all-io==0.3.1"];
  /** A failed command as `runCommand` reports it: the command line in the message, the tool's output aside. */
  const commandFailure = (output: string) => Object.assign(new Error(`Command "uv pip install --python ${PYTHON}" failed (code 1): ${output.slice(0, 40)}`), { output });

  it("installs the whole required cohort in one resolver call with Studio's uv settings", async () => {
    process.env.NIRS4ALL_UV = "/opt/tools/uv";
    await installRequiredPackages(PYTHON);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand).toHaveBeenCalledWith(
      "/opt/tools/uv",
      ["pip", "install", "--python", PYTHON, ...REQUIRED_SPECS],
      expect.objectContaining({ env: uvEnvironment }),
    );
    expect(vi.mocked(runCommand).mock.calls[0][2]?.timeoutMs).toBeGreaterThan(0);
  });

  it("installs required packages from the offline payload when the installer carries one", async () => {
    const offline = shipped(resources, "backend", "offline");
    await installRequiredPackages(PYTHON);
    expect(vi.mocked(runCommand).mock.calls.map((call) => call[1])).toEqual([
      ["pip", "install", "--python", PYTHON, "--offline", "--no-index", "--find-links", path.join(offline, "wheels"), ...REQUIRED_SPECS],
    ]);
  });

  it("falls back to the package index when the offline payload cannot satisfy the required packages", async () => {
    const offline = shipped(resources, "backend", "offline");
    vi.mocked(runCommand).mockRejectedValueOnce(commandFailure("  × No solution found when resolving dependencies:\n  ╰─▶ Because nirs4all-methods was not found in the provided package locations"));

    await installRequiredPackages(PYTHON);

    expect(vi.mocked(runCommand).mock.calls.map((call) => call[1])).toEqual([
      ["pip", "install", "--python", PYTHON, "--offline", "--no-index", "--find-links", path.join(offline, "wheels"), ...REQUIRED_SPECS],
      ["pip", "install", "--python", PYTHON, "--find-links", path.join(offline, "wheels"), ...REQUIRED_SPECS],
    ]);
  });

  it("reports both failures when neither the offline payload nor the index can install", async () => {
    shipped(resources, "backend", "offline");
    vi.mocked(runCommand)
      .mockRejectedValueOnce(commandFailure("  × No solution found: nirs4all-methods was not found in the provided package locations"))
      .mockRejectedValue(commandFailure("error: Failed to fetch: `https://pypi.org/simple/nirs4all/`\n  Caused by: dns error"));

    await expect(installRequiredPackages(PYTHON)).rejects.toThrow(
      "error: Failed to fetch: `https://pypi.org/simple/nirs4all/` Caused by: dns error (Offline package set: No solution found: nirs4all-methods was not found in the provided package locations)",
    );
  });

  it("resolves recommended packages together with the installed required packages", async () => {
    await installRecommendedPackages(PYTHON, ["torch", "xgboost"], PINS);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runCommand).mock.calls[0][1]).toEqual([
      "pip", "install", "--python", PYTHON, "--torch-backend", "auto", "torch==2.6.0", "xgboost==3.0.0", ...PINS,
    ]);
    vi.mocked(runCommand).mockClear();
    await installRecommendedPackages(PYTHON, [], PINS);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("fails with uv's own explanation when a recommended package conflicts with a required one", async () => {
    vi.mocked(runCommand).mockRejectedValue(commandFailure([
      "Using Python 3.11.13 environment at: /envs/studio",
      "  × No solution found when resolving dependencies:",
      "  ╰─▶ Because autogluon==1.2.0 depends on nirs4all-io<0.3 and you require nirs4all-io==0.3.1,",
      "      we can conclude that your requirements are unsatisfiable.",
    ].join("\n")));

    const failure = await installRecommendedPackages(PYTHON, ["autogluon"], PINS).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "No solution found when resolving dependencies: Because autogluon==1.2.0 depends on nirs4all-io<0.3 and you require nirs4all-io==0.3.1, we can conclude that your requirements are unsatisfiable.",
    );
  });

  it("reports a conflict once when the offline payload and the index give the same answer", async () => {
    shipped(resources, "backend", "offline");
    vi.mocked(runCommand).mockRejectedValue(commandFailure("  × No solution found when resolving dependencies:\n  ╰─▶ Because you require numpy==1.21.0 and nirs4all==1.4.16 depends on numpy>=2.0.0"));

    await expect(installRecommendedPackages(PYTHON, ["xgboost"], PINS)).rejects.toThrow(
      /^No solution found when resolving dependencies: Because you require numpy==1\.21\.0 and nirs4all==1\.4\.16 depends on numpy>=2\.0\.0$/,
    );
  });

  it("keeps the original error when uv could not be started", async () => {
    vi.mocked(runCommand).mockRejectedValue(new Error('Failed to start command "uv pip install": spawn uv ENOENT'));
    await expect(installRequiredPackages(PYTHON)).rejects.toThrow("spawn uv ENOENT");
  });

  it("tries the offline payload first for recommended packages and needs the index only for packages outside it", async () => {
    const offline = shipped(resources, "backend", "offline");
    await installRecommendedPackages(PYTHON, ["xgboost"], []);
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runCommand).mock.calls[0][1]).toContain("--no-index");

    vi.mocked(runCommand).mockClear();
    vi.mocked(runCommand).mockRejectedValueOnce(new Error("no matching distribution"));
    await installRecommendedPackages(PYTHON, ["catboost"], PINS);
    expect(vi.mocked(runCommand).mock.calls.map((call) => call[1])).toEqual([
      ["pip", "install", "--python", PYTHON, "--offline", "--no-index", "--find-links", path.join(offline, "wheels"), "catboost==1.2.7", ...PINS],
      ["pip", "install", "--python", PYTHON, "--find-links", path.join(offline, "wheels"), "catboost==1.2.7", ...PINS],
    ]);
  });

  it("creates the virtual environment through uv", async () => {
    await createVenv("/data/python-env/venv", "/data/python-env/python/bin/python3");
    expect(runCommand).toHaveBeenCalledWith(
      "uv",
      ["venv", "/data/python-env/venv", "--python", "/data/python-env/python/bin/python3"],
      expect.objectContaining({ env: uvEnvironment }),
    );
  });
});
