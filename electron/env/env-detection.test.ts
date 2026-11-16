import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { PythonEnvReport } from "../../src/types/pythonEnvironment";

vi.mock("./python-discovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./python-discovery")>()),
  gatherPythonCandidates: vi.fn(),
}));
vi.mock("./inventory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inventory")>()),
  takeInventory: vi.fn(),
}));
import { REQUIRED_PACKAGES } from "./catalogue";
import { clearDetectionCache, compareReports, detectEnvironments } from "./env-detection";
import { takeInventory } from "./inventory";
import type { PythonInventory } from "./inventory";
import { gatherPythonCandidates } from "./python-discovery";
import { getVenvPythonPath } from "./runtime-paths";

const root = path.join(os.tmpdir(), "studio-detection");
const studioEnvDir = path.join(root, "user-data", "python-env");
const python = (name: string, executable = "python") => path.join(root, name, "bin", executable);

function inventory(overrides: Partial<PythonInventory> = {}): PythonInventory {
  return {
    pythonVersion: "3.11.13",
    distributions: Object.fromEntries(REQUIRED_PACKAGES.map((spec) => [spec.name, spec.install])),
    editable: [],
    externallyManaged: false,
    purelib: path.join(root, "site-packages"),
    purelibWritable: true,
    ...overrides,
  };
}

function report(overrides: Partial<PythonEnvReport>): PythonEnvReport {
  return {
    pythonPath: "/envs/a/bin/python", envRoot: "/envs/a", kind: "venv", pythonVersion: "3.11.9", writable: true,
    required: [], recommended: [], usable: true, outdatedRecommendedCount: 0, ...overrides,
  };
}

afterEach(() => {
  clearDetectionCache();
  vi.mocked(gatherPythonCandidates).mockReset();
  vi.mocked(takeInventory).mockReset();
});

describe("detected environment ordering", () => {
  it("lists the selected environment first, then usable, writable, Studio's own and the newest Python", () => {
    const selected = report({ pythonPath: "/envs/selected/bin/python", envRoot: "/envs/selected", usable: false, writable: false, kind: "system" });
    const usableReadOnly = report({ pythonPath: "/usr/bin/python3", envRoot: "/usr", writable: false, kind: "system" });
    const studio = report({ pythonPath: "/data/python-env/venv/bin/python", envRoot: "/data/python-env/venv", kind: "studio" });
    const conda = report({ pythonPath: "/conda/envs/nirs/bin/python", envRoot: "/conda/envs/nirs", kind: "conda", pythonVersion: "3.12.4" });
    const olderConda = report({ pythonPath: "/conda/envs/old/bin/python", envRoot: "/conda/envs/old", kind: "conda", pythonVersion: "3.11.2" });
    const unusable = report({ pythonPath: "/envs/empty/bin/python", envRoot: "/envs/empty", usable: false });

    const sorted = [unusable, olderConda, usableReadOnly, conda, studio, selected]
      .sort((left, right) => compareReports(selected.pythonPath, left, right));

    expect(sorted.map((item) => item.envRoot)).toEqual([
      "/envs/selected", "/data/python-env/venv", "/conda/envs/nirs", "/conda/envs/old", "/usr", "/envs/empty",
    ]);
  });
});

describe("environment detection", () => {
  it("takes one inventory per candidate, skips unusable interpreters and de-duplicates by environment root", async () => {
    const selected = python("selected");
    vi.mocked(gatherPythonCandidates).mockResolvedValue([
      python("work"), python("work", "python3"), python("broken"), selected, python("empty"),
    ]);
    vi.mocked(takeInventory).mockImplementation(async (pythonPath) => {
      if (pythonPath === python("broken")) throw new Error("Python 3.11 or later is required");
      if (pythonPath === python("empty")) return inventory({ distributions: {} });
      return inventory();
    });

    const reports = await detectEnvironments({ studioEnvDir, selectedPythonPath: selected });

    expect(gatherPythonCandidates).toHaveBeenCalledWith([selected, getVenvPythonPath(studioEnvDir)]);
    expect(takeInventory).toHaveBeenCalledTimes(5);
    expect(reports.map((item) => [item.envRoot, item.usable])).toEqual([
      [path.join(root, "selected"), true],
      [path.join(root, "work"), true],
      [path.join(root, "empty"), false],
    ]);
    expect(reports[2].required.every((item) => item.status === "missing")).toBe(true);
  });

  it("reports the selected environment under exactly the selected path, whatever spelling discovery found", async () => {
    const selected = python("selected");
    const discovered = path.join(root, "selected", "bin", ".", "python") + path.sep;
    vi.mocked(gatherPythonCandidates).mockResolvedValue([path.join(root, "other", "lib", "..", "bin", "python"), discovered]);
    vi.mocked(takeInventory).mockResolvedValue(inventory());

    const reports = await detectEnvironments({ studioEnvDir, selectedPythonPath: selected });

    expect(reports.map((item) => item.pythonPath)).toEqual([selected, python("other")]);
    expect(vi.mocked(takeInventory).mock.calls.map(([pythonPath]) => pythonPath).sort()).toEqual([python("other"), selected].sort());
  });

  it("inspects a bounded number of interpreters at a time", async () => {
    const candidates = Array.from({ length: 11 }, (_, index) => python(`env-${index}`));
    vi.mocked(gatherPythonCandidates).mockResolvedValue(candidates);
    let running = 0;
    let peak = 0;
    vi.mocked(takeInventory).mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return inventory();
    });

    expect(await detectEnvironments({ studioEnvDir, selectedPythonPath: null })).toHaveLength(11);
    expect(peak).toBe(4);
  });

  it("reuses a recent detection unless a refresh is requested", async () => {
    vi.mocked(gatherPythonCandidates).mockResolvedValue([python("work")]);
    vi.mocked(takeInventory).mockResolvedValue(inventory());
    const context = { studioEnvDir, selectedPythonPath: null };

    await detectEnvironments(context);
    await detectEnvironments(context);
    expect(takeInventory).toHaveBeenCalledTimes(1);
    await detectEnvironments(context, true);
    expect(takeInventory).toHaveBeenCalledTimes(2);
    clearDetectionCache();
    await detectEnvironments(context);
    expect(takeInventory).toHaveBeenCalledTimes(3);
  });
});
