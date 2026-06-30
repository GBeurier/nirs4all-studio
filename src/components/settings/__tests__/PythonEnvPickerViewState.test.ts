import { describe, expect, it } from "vitest";
import type {
  OptionalPackageInfo,
  ProfileInfo,
  RecommendedConfigResponse,
} from "@/api/config";
import type { PostSwitchValidation } from "@/types/pythonRuntime";
import type { RuntimeSummaryResponse } from "@/types/settings";
import {
  derivePythonEnvRuntimeView,
  resolveReviewProfileSelection,
} from "../PythonEnvPickerViewState";

function createProfile(id: string, overrides: Partial<ProfileInfo> = {}): ProfileInfo {
  return {
    id,
    label: id,
    description: id,
    packages: {},
    platforms: [],
    ...overrides,
  };
}

function createOptional(name: string): OptionalPackageInfo {
  return {
    name,
    min: ">=1.0.0",
    recommended: "1.2.0",
    description: name,
    category: "models",
  };
}

function createConfig(profiles: ProfileInfo[]): RecommendedConfigResponse {
  return {
    schema_version: "1",
    app_version: "0.7.0",
    nirs4all: "0.9.1",
    profiles,
    optional: [],
    fetched_from: "test",
    fetched_at: "2026-04-18T08:00:00",
  };
}

function createValidation(overrides: Partial<PostSwitchValidation> = {}): PostSwitchValidation {
  return {
    runtimeSummary: null,
    gpuInfo: null,
    config: null,
    visibleOptionalPackages: [],
    selectedProfile: "",
    selectedExtras: [],
    alignmentPreview: null,
    ...overrides,
  };
}

function createRuntimeSummary(overrides: Partial<RuntimeSummaryResponse> = {}): RuntimeSummaryResponse {
  return {
    coherent: true,
    configured_python: "/opt/py/bin/python",
    running_python: "/opt/py/bin/python",
    running_prefix: "/opt/py",
    runtime_kind: "user",
    is_bundled_default: false,
    bundled_runtime_available: false,
    configured_matches_running: true,
    core_ready: true,
    missing_core_packages: [],
    missing_optional_packages: [],
    python_match: true,
    prefix_match: true,
    runtime: { python: "/opt/py/bin/python", prefix: "/opt/py", version: "3.11.13" },
    venv_manager: { python: "/opt/py/bin/python", prefix: "/opt/py" },
    ...overrides,
  };
}

describe("resolveReviewProfileSelection", () => {
  it("returns no profiles when validation lacks a config", () => {
    const result = resolveReviewProfileSelection(null, "linux");
    expect(result.compatibleProfiles).toEqual([]);
    expect(result.selectedReviewProfile).toBe("");
  });

  it("keeps the selected profile when it is compatible with the platform", () => {
    const config = createConfig([
      createProfile("cpu", { platforms: ["linux", "win32"] }),
      createProfile("gpu", { platforms: ["linux"] }),
    ]);
    const validation = createValidation({ config, selectedProfile: "gpu" });

    const result = resolveReviewProfileSelection(validation, "linux");
    expect(result.compatibleProfiles.map((p) => p.id)).toEqual(["cpu", "gpu"]);
    expect(result.selectedReviewProfile).toBe("gpu");
  });

  it("falls back to the first compatible profile when the selection is incompatible", () => {
    const config = createConfig([
      createProfile("cpu", { platforms: ["win32"] }),
      createProfile("metal", { platforms: ["darwin"] }),
    ]);
    const validation = createValidation({ config, selectedProfile: "gpu" });

    const result = resolveReviewProfileSelection(validation, "darwin");
    expect(result.compatibleProfiles.map((p) => p.id)).toEqual(["metal"]);
    expect(result.selectedReviewProfile).toBe("metal");
  });

  it("falls back to the raw selection when no compatible profile exists", () => {
    const config = createConfig([createProfile("cpu", { platforms: ["win32"] })]);
    const validation = createValidation({ config, selectedProfile: "gpu" });

    const result = resolveReviewProfileSelection(validation, "darwin");
    expect(result.compatibleProfiles).toEqual([]);
    expect(result.selectedReviewProfile).toBe("gpu");
  });
});

describe("derivePythonEnvRuntimeView", () => {
  it("prefers the runtime summary for readiness and version", () => {
    const view = derivePythonEnvRuntimeView({
      runtimeSummary: createRuntimeSummary({
        running_python: "/opt/py/bin/python",
        missing_core_packages: ["numpy"],
        missing_optional_packages: ["torch", "umap-learn"],
      }),
      envInfo: { status: "error", pythonPath: "/fallback/python", pythonVersion: "3.9.0" },
      postSwitchValidation: null,
      selectedReviewProfile: "",
    });

    expect(view.isReady).toBe(true);
    expect(view.runningPythonPath).toBe("/opt/py/bin/python");
    expect(view.runtimeVersion).toBe("3.11.13");
    expect(view.missingCoreCount).toBe(1);
    expect(view.missingOptionalCount).toBe(2);
  });

  it("falls back to env info when no runtime summary is present", () => {
    const view = derivePythonEnvRuntimeView({
      runtimeSummary: null,
      envInfo: { status: "ready", pythonPath: "/fallback/python", pythonVersion: "3.9.0" },
      postSwitchValidation: null,
      selectedReviewProfile: "",
    });

    expect(view.isReady).toBe(true);
    expect(view.runningPythonPath).toBe("/fallback/python");
    expect(view.runtimeVersion).toBe("3.9.0");
    expect(view.missingCoreCount).toBe(0);
  });

  it("treats a not-ready env without a python path as not ready", () => {
    const view = derivePythonEnvRuntimeView({
      runtimeSummary: null,
      envInfo: { status: "missing", pythonPath: null, pythonVersion: null },
      postSwitchValidation: null,
      selectedReviewProfile: "",
    });

    expect(view.isReady).toBe(false);
    expect(view.runningPythonPath).toBeNull();
    expect(view.runtimeVersion).toBeNull();
  });

  it("surfaces alignment preview presence and change count", () => {
    const view = derivePythonEnvRuntimeView({
      runtimeSummary: createRuntimeSummary(),
      envInfo: null,
      postSwitchValidation: createValidation({
        alignmentPreview: {
          success: true,
          message: "ok",
          installed: ["torch", "scikit-learn"],
          upgraded: [],
          failed: [],
          dry_run: true,
          requires_restart: false,
        },
      }),
      selectedReviewProfile: "",
    });

    expect(view.hasAlignmentPreview).toBe(true);
    expect(view.alignmentChangesCount).toBe(2);
  });

  it("drops optional packages the selected profile excludes", () => {
    const config = createConfig([
      createProfile("cpu-lite", { exclude_optionals: ["torch", "umap-learn"] }),
    ]);
    const view = derivePythonEnvRuntimeView({
      runtimeSummary: createRuntimeSummary(),
      envInfo: null,
      postSwitchValidation: createValidation({
        config,
        visibleOptionalPackages: [
          createOptional("torch"),
          createOptional("tabpfn"),
          createOptional("umap-learn"),
        ],
      }),
      selectedReviewProfile: "cpu-lite",
    });

    expect(view.reviewOptionalPackages.map((p) => p.name)).toEqual(["tabpfn"]);
  });
});
