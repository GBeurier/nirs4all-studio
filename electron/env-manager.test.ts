// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PythonEnvState } from "../src/types/pythonEnvironment";

vi.mock("./env/inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./env/inventory")>()),
  takeInventory: vi.fn(),
}));
vi.mock("./env/uv", () => ({
  installRecommendedPackages: vi.fn(),
  installRequiredPackages: vi.fn(),
  resolveUvPayload: vi.fn(() => ({ wheelhouse: null, offline: null })),
}));
vi.mock("./env/provisioning", () => ({ createStudioEnvironment: vi.fn() }));
vi.mock("./env/env-detection", () => ({ clearDetectionCache: vi.fn(), detectEnvironments: vi.fn(async () => []) }));

import { EnvManager } from "./env-manager";
import { REQUIRED_PACKAGES } from "./env/catalogue";
import { clearDetectionCache, detectEnvironments } from "./env/env-detection";
import { takeInventory } from "./env/inventory";
import type { PythonInventory } from "./env/inventory";
import { createStudioEnvironment } from "./env/provisioning";
import { installRecommendedPackages, installRequiredPackages, resolveUvPayload } from "./env/uv";

const COHORT = Object.fromEntries(REQUIRED_PACKAGES.map((spec) => [spec.name, spec.install]));
let root: string;
let userDataDir: string;
let settingsPath: string;
/** What each interpreter's package listing currently returns. */
let inventories: Map<string, PythonInventory>;
let restartHost: ReturnType<typeof vi.fn<() => Promise<void>>>;

/** Create an interpreter file and its package directory, and register its inventory. */
function environment(name: string, overrides: Partial<PythonInventory> = {}): string {
  const pythonPath = path.join(root, name, "bin", "python");
  const purelib = path.join(root, name, "lib", "site-packages");
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.mkdirSync(purelib, { recursive: true });
  fs.writeFileSync(pythonPath, "");
  inventories.set(pythonPath, {
    pythonVersion: "3.11.13",
    distributions: { ...COHORT },
    editable: [],
    externallyManaged: false,
    purelib,
    purelibWritable: true,
    ...overrides,
  });
  return pythonPath;
}

function setDistributions(pythonPath: string, distributions: Record<string, string>): void {
  inventories.set(pythonPath, { ...inventories.get(pythonPath)!, distributions });
}

function select(pythonPath: string): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({ pythonPath }));
}

function persistedSelection(): unknown {
  return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
}

function manager(): EnvManager {
  return new EnvManager({ userDataDir, restartHost });
}

/** A manager whose startup check already ran on `pythonPath`. */
async function startedOn(pythonPath: string): Promise<EnvManager> {
  select(pythonPath);
  const env = manager();
  await env.startupCheck();
  vi.mocked(takeInventory).mockClear();
  return env;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-env-manager-"));
  userDataDir = path.join(root, "user-data");
  settingsPath = path.join(userDataDir, "env-settings.json");
  inventories = new Map();
  restartHost = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  vi.mocked(takeInventory).mockImplementation(async (pythonPath) => {
    const inventory = inventories.get(pythonPath);
    if (!inventory) throw new Error("This file could not be run as a Python 3.11+ interpreter: spawn ENOEXEC");
    return inventory;
  });
  vi.mocked(installRequiredPackages).mockImplementation(async (pythonPath) => {
    setDistributions(pythonPath, { ...inventories.get(pythonPath)!.distributions, ...COHORT });
  });
  vi.mocked(installRecommendedPackages).mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(takeInventory).mockReset();
  vi.mocked(installRequiredPackages).mockReset();
  vi.mocked(installRecommendedPackages).mockReset();
  vi.mocked(createStudioEnvironment).mockReset();
  vi.mocked(clearDetectionCache).mockClear();
  vi.mocked(detectEnvironments).mockClear();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("startup check", () => {
  it("is unconfigured when no environment was ever selected", async () => {
    const env = manager();

    expect(await env.startupCheck()).toEqual({
      phase: "unconfigured", selectedPythonPath: null, selected: null, offlineInstall: false,
    });
    expect(env.getHost()).toBeNull();
    expect(takeInventory).not.toHaveBeenCalled();
  });

  it("does not migrate the included runtime of earlier releases", async () => {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ runtime: "bundled", appVersion: "0.15.11", skipWizardOnLaunch: true }));

    expect((await manager().startupCheck()).phase).toBe("unconfigured");
  });

  it("keeps the selection but asks for setup again when the interpreter no longer exists", async () => {
    const missing = path.join(root, "moved", "bin", "python");
    select(missing);
    const env = manager();

    expect(await env.startupCheck()).toMatchObject({
      phase: "unconfigured",
      selectedPythonPath: missing,
      selected: null,
      problem: { code: "interpreter_missing", message: expect.stringContaining(missing) },
    });
    expect(env.getHost()).toBeNull();
    expect(takeInventory).not.toHaveBeenCalled();
    expect(persistedSelection()).toEqual({ pythonPath: missing });
  });

  it("is ready when every required package is within range, and hands the interpreter to the sidecar", async () => {
    const pythonPath = environment("work", { distributions: { ...COHORT, nirs4all: "1.4.20", torch: "2.5.0" } });
    select(pythonPath);
    const env = manager();

    const state = await env.startupCheck();

    expect(state).toMatchObject({
      phase: "ready",
      selectedPythonPath: pythonPath,
      selected: { pythonPath, usable: true, kind: "system", outdatedRecommendedCount: 1 },
    });
    expect(state.problem).toBeUndefined();
    expect(state.activity).toBeUndefined();
    expect(env.getHost()).toEqual({ pythonPath, sitePackages: inventories.get(pythonPath)!.purelib });
    expect(installRequiredPackages).not.toHaveBeenCalled();
    expect(restartHost).not.toHaveBeenCalled();
  });

  it("needs no Python subprocess on the next launch while the environment is unchanged", async () => {
    const pythonPath = environment("work");
    select(pythonPath);
    await manager().startupCheck();
    expect(takeInventory).toHaveBeenCalledTimes(1);

    const relaunched = manager();
    expect((await relaunched.startupCheck()).phase).toBe("ready");
    expect(relaunched.getHost()?.pythonPath).toBe(pythonPath);
    expect(takeInventory).toHaveBeenCalledTimes(1);

    // A package was installed outside Studio: the package directory changed.
    const later = new Date(Date.now() + 5_000);
    fs.utimesSync(inventories.get(pythonPath)!.purelib, later, later);
    await manager().startupCheck();
    expect(takeInventory).toHaveBeenCalledTimes(2);
  });

  it("installs the required packages automatically when they are missing or out of range", async () => {
    const pythonPath = environment("work", { distributions: { nirs4all: "1.4.10", "nirs4all-io": "0.3.1", numpy: "2.1.0" } });
    select(pythonPath);
    const env = manager();
    const states: PythonEnvState[] = [];
    env.onStateChange((state) => states.push(state));

    const state = await env.startupCheck();

    expect(installRequiredPackages).toHaveBeenCalledTimes(1);
    expect(installRequiredPackages).toHaveBeenCalledWith(pythonPath, new Set());
    expect(states.some((item) => item.phase === "busy" && item.activity?.kind === "updating_required" && item.activity.percent === null)).toBe(true);
    expect(state).toMatchObject({ phase: "ready", selected: { usable: true } });
    expect(state.activity).toBeUndefined();
    expect(env.getHost()?.pythonPath).toBe(pythonPath);
    // Studio opened the window itself afterwards: the sidecar is started by the caller, once.
    expect(restartHost).not.toHaveBeenCalled();
  });

  it("still opens with a problem when the automatic installation fails", async () => {
    const pythonPath = environment("work", { distributions: { nirs4all: "1.4.10" } });
    select(pythonPath);
    vi.mocked(installRequiredPackages).mockRejectedValueOnce(new Error("Command \"uv pip install\" failed (code 2): network unreachable"));
    const env = manager();

    const state = await env.startupCheck();

    expect(state).toMatchObject({
      phase: "needs_attention",
      selectedPythonPath: pythonPath,
      selected: { usable: false },
      problem: { code: "required_update_failed", message: expect.stringContaining("network unreachable") },
    });
    expect(state.activity).toBeUndefined();
    expect(env.getHost()).toBeNull();
  });

  it("reports a failed update when the packages are still out of range after installation", async () => {
    const pythonPath = environment("work", { distributions: {} });
    select(pythonPath);
    vi.mocked(installRequiredPackages).mockResolvedValueOnce(undefined);

    expect(await manager().startupCheck()).toMatchObject({
      phase: "needs_attention",
      problem: { code: "required_update_failed", message: expect.stringContaining("nirs4all (missing)") },
    });
  });

  it.each([
    ["read-only", { purelibWritable: false }],
    ["managed by the operating system", { externallyManaged: true }],
  ])("never installs into an environment that is %s", async (_label, overrides) => {
    const pythonPath = environment("system", { distributions: { nirs4all: "1.4.10" }, ...overrides });
    select(pythonPath);
    const env = manager();

    expect(await env.startupCheck()).toMatchObject({
      phase: "needs_attention",
      selected: { usable: false, writable: false },
      problem: { code: "required_not_installable", message: expect.stringContaining("nirs4all 1.4.10 (required >=1.4.16,<1.5)") },
    });
    expect(installRequiredPackages).not.toHaveBeenCalled();
    expect(env.getHost()).toBeNull();
  });

  it("never modifies an editable install that is out of range", async () => {
    const pythonPath = environment("dev", { distributions: { ...COHORT, nirs4all: "1.5.0.dev0" }, editable: ["nirs4all"] });
    select(pythonPath);
    const env = manager();

    const state = await env.startupCheck();

    expect(state).toMatchObject({
      phase: "needs_attention",
      problem: { code: "required_not_installable", message: expect.stringContaining("editable") },
    });
    expect(state.selected?.required.find((item) => item.name === "nirs4all")?.status).toBe("editable");
    expect(installRequiredPackages).not.toHaveBeenCalled();
  });

  it("uses an editable install within range and leaves it out of a repair of the other packages", async () => {
    const { "nirs4all-core": _missing, ...withoutCore } = COHORT;
    const pythonPath = environment("dev", { distributions: { ...withoutCore, nirs4all: "1.4.17" }, editable: ["nirs4all"] });
    select(pythonPath);

    expect((await manager().startupCheck()).phase).toBe("ready");
    expect(installRequiredPackages).toHaveBeenCalledWith(pythonPath, new Set(["nirs4all"]));
  });

  it("needs attention when the selected file is not a usable interpreter", async () => {
    const pythonPath = path.join(root, "not-python");
    fs.writeFileSync(pythonPath, "");
    select(pythonPath);

    expect(await manager().startupCheck()).toMatchObject({
      phase: "needs_attention",
      selected: null,
      problem: { code: "interpreter_missing", message: expect.stringContaining("Python 3.11+") },
    });
  });
});

describe("switching environment", () => {
  it("installs what is needed, selects the environment and restarts the sidecar on it", async () => {
    const previous = environment("previous");
    const target = environment("target", { distributions: { numpy: "2.1.0" } });
    const env = await startedOn(previous);
    const hostDuringRestart: Array<string | undefined> = [];
    restartHost.mockImplementation(async () => { hostDuringRestart.push(env.getHost()?.pythonPath); });

    const result = await env.apply({ pythonPath: target, packages: ["torch", "xgboost"] });

    expect(result).toMatchObject({ success: true, state: { phase: "ready", selectedPythonPath: target, selected: { usable: true } } });
    expect(result.message).toBeUndefined();
    expect(installRequiredPackages).toHaveBeenCalledWith(target, new Set());
    expect(installRecommendedPackages).toHaveBeenCalledWith(target, ["torch", "xgboost"]);
    expect(hostDuringRestart).toEqual([target]);
    expect(persistedSelection()).toEqual({ pythonPath: target });
    expect(clearDetectionCache).toHaveBeenCalled();
    // The next launch reuses the inventory taken during the switch.
    vi.mocked(takeInventory).mockClear();
    await manager().startupCheck();
    expect(takeInventory).not.toHaveBeenCalled();
  });

  it("does not reinstall required packages that are already within range", async () => {
    const target = environment("target", { distributions: { ...COHORT, nirs4all: "1.4.18" } });
    const env = await startedOn(environment("previous"));

    expect((await env.apply({ pythonPath: target, packages: [] })).success).toBe(true);
    expect(installRequiredPackages).not.toHaveBeenCalled();
    expect(installRecommendedPackages).not.toHaveBeenCalled();
  });

  // The fixture uses the POSIX layout (`bin/python`).
  it.skipIf(process.platform === "win32")("accepts an environment directory", async () => {
    const target = environment("target");
    const env = await startedOn(environment("previous"));

    const result = await env.apply({ pythonPath: path.join(root, "target"), packages: [] });

    expect(result).toMatchObject({ success: true, state: { selectedPythonPath: target } });
  });

  it("restores the previous selection when the sidecar cannot run the new environment", async () => {
    const previous = environment("previous");
    const target = environment("target");
    const env = await startedOn(previous);
    const hostDuringRestart: Array<string | undefined> = [];
    restartHost
      .mockImplementationOnce(async () => {
        hostDuringRestart.push(env.getHost()?.pythonPath);
        throw new Error("Studio could not load nirs4all in this Python environment (python_host_timed_out).");
      })
      .mockImplementationOnce(async () => { hostDuringRestart.push(env.getHost()?.pythonPath); });

    const result = await env.apply({ pythonPath: target, packages: [] });

    expect(result.success).toBe(false);
    expect(result.message).toBe("Studio could not load nirs4all in this Python environment (python_host_timed_out). Your previous environment selection has been restored.");
    expect(result.state).toMatchObject({ phase: "ready", selectedPythonPath: previous, selected: { pythonPath: previous } });
    expect(result.state.activity).toBeUndefined();
    // First the new environment, then the previous one again.
    expect(hostDuringRestart).toEqual([target, previous]);
    expect(persistedSelection()).toEqual({ pythonPath: previous });
    expect(env.getHost()?.pythonPath).toBe(previous);
  });

  it("restores an unconfigured state when the very first selection fails", async () => {
    const target = environment("target");
    const env = manager();
    await env.startupCheck();
    restartHost.mockRejectedValueOnce(new Error("The analysis backend could not be started."));

    const result = await env.apply({ pythonPath: target, packages: [] });

    expect(result).toMatchObject({ success: false, state: { phase: "unconfigured", selectedPythonPath: null, selected: null } });
    expect(persistedSelection()).toEqual({});
    expect(restartHost).toHaveBeenCalledTimes(2);
  });

  it("keeps the current selection when the target cannot be prepared", async () => {
    const previous = environment("previous");
    const readOnly = environment("read-only", { distributions: {}, purelibWritable: false });
    const failing = environment("failing", { distributions: {} });
    const env = await startedOn(previous);

    const refused = await env.apply({ pythonPath: readOnly, packages: [] });
    expect(refused).toMatchObject({ success: false, message: expect.stringContaining("cannot install packages in this environment") });

    const unknownPackage = await env.apply({ pythonPath: failing, packages: ["requests"] });
    expect(unknownPackage).toMatchObject({ success: false, message: expect.stringContaining("not in Studio's package catalogue") });
    expect(installRequiredPackages).not.toHaveBeenCalled();

    vi.mocked(installRequiredPackages).mockRejectedValueOnce(new Error("resolver conflict"));
    const failed = await env.apply({ pythonPath: failing, packages: [] });
    expect(failed).toMatchObject({ success: false, message: "resolver conflict" });

    const notPython = await env.apply({ pythonPath: path.join(root, "nowhere"), packages: [] });
    expect(notPython).toMatchObject({ success: false, message: "No Python interpreter was found at this location." });

    expect(restartHost).not.toHaveBeenCalled();
    expect(persistedSelection()).toEqual({ pythonPath: previous });
    expect(env.getState()).toMatchObject({ phase: "ready", selectedPythonPath: previous });
  });

  it("runs one operation at a time", async () => {
    const target = environment("target");
    const env = await startedOn(environment("previous"));
    let release: () => void = () => undefined;
    restartHost.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));

    const first = env.apply({ pythonPath: target, packages: [] });
    await vi.waitFor(() => expect(restartHost).toHaveBeenCalledTimes(1));
    expect(env.getState()).toMatchObject({ phase: "busy", activity: { kind: "switching" } });
    expect(await env.retry()).toMatchObject({ success: false, message: "Another Python environment operation is still running." });
    release();

    expect((await first).success).toBe(true);
  });
});

describe("creating an environment", () => {
  it("creates Studio's environment in its data directory, reports progress and switches to it", async () => {
    const env = manager();
    await env.startupCheck();
    const activities: Array<[string | undefined, number | null | undefined]> = [];
    env.onStateChange((state) => activities.push([state.activity?.kind, state.activity?.percent]));
    const created = environment(path.join("user-data", "python-env", "venv"));
    vi.mocked(createStudioEnvironment).mockImplementation(async (_baseDir, _packages, progress) => {
      progress(30, "Extracting the Python runtime…");
      return created;
    });

    const result = await env.create({ packages: ["torch"] });

    expect(createStudioEnvironment).toHaveBeenCalledWith(path.join(userDataDir, "python-env"), ["torch"], expect.any(Function));
    expect(activities).toContainEqual(["creating", 0]);
    expect(activities).toContainEqual(["creating", 30]);
    expect(result).toMatchObject({ success: true, state: { phase: "ready", selectedPythonPath: created, selected: { kind: "studio" } } });
    expect(restartHost).toHaveBeenCalledTimes(1);
    expect(persistedSelection()).toEqual({ pythonPath: created });
  });

  it("creates the environment in a folder of the chosen parent directory", async () => {
    const env = manager();
    await env.startupCheck();
    const parent = path.join(root, "Shared tools");
    const created = environment(path.join("Shared tools", "python-env", "venv"));
    vi.mocked(createStudioEnvironment).mockResolvedValue(created);

    const result = await env.create({ directory: parent, packages: [] });

    expect(createStudioEnvironment).toHaveBeenCalledWith(path.join(parent, "python-env"), [], expect.any(Function));
    expect(result).toMatchObject({ success: true, state: { selectedPythonPath: created } });
  });

  it("keeps the previous selection when the creation fails", async () => {
    const previous = environment("previous");
    const env = await startedOn(previous);
    vi.mocked(createStudioEnvironment).mockRejectedValue(new Error("A Python environment already exists in this folder."));

    const result = await env.create({ packages: [] });

    expect(result).toMatchObject({
      success: false,
      message: "A Python environment already exists in this folder.",
      state: { phase: "ready", selectedPythonPath: previous },
    });
    expect(restartHost).not.toHaveBeenCalled();
  });
});

describe("installing recommended packages", () => {
  it("installs into the selected environment, refreshes its report and restarts the sidecar", async () => {
    const pythonPath = environment("work");
    const env = await startedOn(pythonPath);
    vi.mocked(installRecommendedPackages).mockImplementationOnce(async () => {
      setDistributions(pythonPath, { ...COHORT, torch: "2.6.0" });
    });

    const result = await env.installPackages(["torch"]);

    expect(installRecommendedPackages).toHaveBeenCalledWith(pythonPath, ["torch"]);
    expect(result.success).toBe(true);
    expect(result.state.selected?.recommended.find((item) => item.name === "torch")).toMatchObject({ installedVersion: "2.6.0", status: "ok" });
    expect(restartHost).toHaveBeenCalledTimes(1);
  });

  it("repairs required packages that an installation moved out of range", async () => {
    const pythonPath = environment("work");
    const env = await startedOn(pythonPath);
    vi.mocked(installRecommendedPackages).mockImplementationOnce(async () => {
      setDistributions(pythonPath, { ...COHORT, "nirs4all-methods": "2.0.0" });
    });

    const result = await env.installPackages(["autogluon"]);

    expect(installRequiredPackages).toHaveBeenCalledWith(pythonPath, new Set());
    expect(result).toMatchObject({ success: true, state: { phase: "ready" } });
  });

  it("leaves the sidecar alone when the installation fails", async () => {
    const env = await startedOn(environment("work"));
    vi.mocked(installRecommendedPackages).mockRejectedValueOnce(new Error("No matching distribution"));

    expect(await env.installPackages(["catboost"])).toMatchObject({ success: false, message: "No matching distribution", state: { phase: "ready" } });
    expect(restartHost).not.toHaveBeenCalled();
  });

  it("restarts the sidecar after a failed installation that changed a required package", async () => {
    const pythonPath = environment("work");
    const env = await startedOn(pythonPath);
    // The installation replaced nirs4all with another in-range version, then failed.
    vi.mocked(installRecommendedPackages).mockImplementationOnce(async () => {
      setDistributions(pythonPath, { ...COHORT, nirs4all: "1.4.18" });
      throw new Error("No space left on device");
    });

    const result = await env.installPackages(["torch"]);

    expect(result).toMatchObject({ success: false, message: "No space left on device", state: { phase: "ready" } });
    expect(result.state.selected?.required[0].installedVersion).toBe("1.4.18");
    // Its workers would refuse the nirs4all version the running sidecar did not admit.
    expect(restartHost).toHaveBeenCalledTimes(1);
  });

  it("restarts the sidecar when a failed switch already changed nirs4all in the selected environment", async () => {
    const { "dag-ml": _removed, ...withoutDagMl } = COHORT;
    const pythonPath = environment("work", { distributions: { ...COHORT, nirs4all: "1.4.18" } });
    const env = await startedOn(pythonPath);
    // A required package was removed outside Studio; repairing it installs the exact cohort (nirs4all 1.4.16).
    setDistributions(pythonPath, { ...withoutDagMl, nirs4all: "1.4.18" });
    vi.mocked(installRecommendedPackages).mockRejectedValueOnce(new Error("No matching distribution"));

    const result = await env.apply({ pythonPath, packages: ["catboost"] });

    expect(installRequiredPackages).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: false, message: "No matching distribution", state: { phase: "ready", selectedPythonPath: pythonPath } });
    expect(result.state.selected?.required[0].installedVersion).toBe("1.4.16");
    expect(restartHost).toHaveBeenCalledTimes(1);
  });

  it("refuses when nothing usable is selected or the environment is read-only", async () => {
    const unconfigured = manager();
    await unconfigured.startupCheck();
    expect(await unconfigured.installPackages(["torch"])).toMatchObject({ success: false, message: "No usable Python environment is selected." });

    const readOnly = await startedOn(environment("system", { purelibWritable: false }));
    expect(await readOnly.installPackages(["torch"])).toMatchObject({ success: false, message: expect.stringContaining("read-only") });
    expect(installRecommendedPackages).not.toHaveBeenCalled();
  });
});

describe("scientific host failures and retry", () => {
  it("needs attention when the sidecar could not run a compatible environment, until a retry succeeds", async () => {
    const pythonPath = environment("work");
    const env = await startedOn(pythonPath);

    env.reportHostFailure("Studio could not load nirs4all in this Python environment (import_failed).");

    expect(env.getState()).toMatchObject({
      phase: "needs_attention",
      selected: { usable: true },
      problem: { code: "host_failed", message: expect.stringContaining("import_failed") },
    });
    expect(env.getHost()).toBeNull();

    const result = await env.retry();

    expect(result).toMatchObject({ success: true, state: { phase: "ready" } });
    expect(result.state.problem).toBeUndefined();
    expect(restartHost).toHaveBeenCalledTimes(1);
    expect(env.getHost()?.pythonPath).toBe(pythonPath);
  });

  it("reports the host failure again when the retry cannot start it", async () => {
    const env = await startedOn(environment("work"));
    restartHost.mockRejectedValueOnce(new Error("The analysis backend did not activate the selected Python environment."));

    expect(await env.retry()).toMatchObject({
      success: false,
      message: "The analysis backend did not activate the selected Python environment.",
      state: { phase: "needs_attention", problem: { code: "host_failed" } },
    });
  });

  it("retries the installation of required packages and then starts the host", async () => {
    const pythonPath = environment("work", { distributions: {} });
    select(pythonPath);
    vi.mocked(installRequiredPackages).mockRejectedValueOnce(new Error("offline"));
    const env = manager();
    expect((await env.startupCheck()).problem?.code).toBe("required_update_failed");

    const result = await env.retry();

    expect(installRequiredPackages).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ success: true, state: { phase: "ready" } });
    expect(restartHost).toHaveBeenCalledTimes(1);
  });

  it("fails a retry that still cannot make the environment usable, after restarting without Python", async () => {
    const pythonPath = environment("system", { distributions: {}, purelibWritable: false });
    const env = await startedOn(pythonPath);

    expect(await env.retry()).toMatchObject({
      success: false,
      message: expect.stringContaining("cannot install packages"),
      state: { phase: "needs_attention", problem: { code: "required_not_installable" } },
    });
    expect(restartHost).toHaveBeenCalledTimes(1);
    expect(env.getHost()).toBeNull();
  });
});

describe("interpreter path spelling", () => {
  it("normalises the persisted path and reports every spelling of the selection as that one path", async () => {
    const pythonPath = environment("work");
    const variant = path.join(root, "work", "bin", "..", "bin", "python") + path.sep;
    inventories.set(variant, inventories.get(pythonPath)!);
    select(variant);
    const env = manager();

    const state = await env.startupCheck();

    expect(state).toMatchObject({ phase: "ready", selectedPythonPath: pythonPath, selected: { pythonPath } });
    expect(env.getHost()?.pythonPath).toBe(pythonPath);
    expect((await env.inspect(variant)).report?.pythonPath).toBe(pythonPath);
    const applied = await env.apply({ pythonPath: path.join(root, "work", ".", "bin", "python"), packages: [] });
    expect(applied.state).toMatchObject({ selectedPythonPath: pythonPath, selected: { pythonPath } });
    expect(persistedSelection()).toEqual({ pythonPath });
  });

  it("emits a normalised path for an environment that is not the selection", async () => {
    const other = environment("other");
    const env = await startedOn(environment("work"));

    const inspected = await env.inspect(path.join(root, "other", "lib", "..", "bin", "python"));
    const applied = await env.apply({ pythonPath: path.join(root, "other", "bin", ".", "python"), packages: [] });

    expect(inspected.report).toMatchObject({ pythonPath: other, envRoot: path.join(root, "other") });
    expect(applied.state.selectedPythonPath).toBe(other);
  });
});

describe("new environment plan", () => {
  it("lists what a created environment would contain without running Python", () => {
    const plan = manager().describeNewEnvironment();

    expect(plan.pythonVersion).toMatch(/^3\.11\.\d+$/);
    expect(plan.required).toEqual(REQUIRED_PACKAGES.map((spec) => ({
      name: spec.name, installedVersion: null, requiredRange: spec.range, targetVersion: spec.install, status: "missing",
    })));
    expect(plan.recommended.length).toBeGreaterThan(10);
    expect(plan.recommended.every((item) => item.installedVersion === null && item.status === "missing" && !item.belowMinimum)).toBe(true);
    expect(plan.recommended.find((item) => item.name === "torch")).toMatchObject({ defaultInstall: true, recommendedVersion: "2.6.0" });
    expect(Object.keys(plan).sort()).toEqual(["pythonVersion", "recommended", "required"]);
    expect(takeInventory).not.toHaveBeenCalled();
  });
});

describe("inspection and detection", () => {
  it("inspects an interpreter without changing the selection", async () => {
    const previous = environment("previous");
    const other = environment("other", { distributions: { nirs4all: "1.4.16" } });
    const env = await startedOn(previous);

    const inspected = await env.inspect(other);

    expect(inspected.error).toBeUndefined();
    expect(inspected.report).toMatchObject({ pythonPath: other, usable: false, writable: true });
    expect(await env.inspect(path.join(root, "nowhere"))).toEqual({ error: "No Python interpreter was found at this location." });
    expect(await env.inspect(root)).toEqual({ error: "No Python interpreter was found in this folder." });
    expect(env.getState().selectedPythonPath).toBe(previous);
    expect(installRequiredPackages).not.toHaveBeenCalled();
  });

  it("detects environments around Studio's own directory and the current selection", async () => {
    const pythonPath = environment("work");
    const env = await startedOn(pythonPath);

    await env.detect(true);

    expect(detectEnvironments).toHaveBeenCalledWith({ studioEnvDir: path.join(userDataDir, "python-env"), selectedPythonPath: pythonPath }, true);
  });

  it("reports an offline installation", async () => {
    vi.mocked(resolveUvPayload).mockReturnValueOnce({ wheelhouse: null, offline: path.join(root, "offline") });
    expect(manager().getState().offlineInstall).toBe(true);
  });
});
