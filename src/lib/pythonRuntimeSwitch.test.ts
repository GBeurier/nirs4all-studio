/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alignConfig: vi.fn(),
  detectGPU: vi.fn(),
  getRecommendedConfig: vi.fn(),
  getRuntimeSummary: vi.fn(),
  resetBackendUrl: vi.fn(),
  dispatchOperatorAvailabilityInvalidated: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  alignConfig: mocks.alignConfig,
  detectGPU: mocks.detectGPU,
  getRecommendedConfig: mocks.getRecommendedConfig,
  getRuntimeSummary: mocks.getRuntimeSummary,
  resetBackendUrl: mocks.resetBackendUrl,
}));

vi.mock("@/lib/pipelineOperatorAvailability", () => ({
  dispatchOperatorAvailabilityInvalidated: mocks.dispatchOperatorAvailabilityInvalidated,
}));

import {
  loadPostSwitchValidation,
  restartBackendForRuntimeSwitch,
} from "./pythonRuntimeSwitch";

afterEach(() => {
  vi.clearAllMocks();
});

describe("pythonRuntimeSwitch", () => {
  it("preselects installed visible optional packages from runtime summary gaps without scanning dependencies", async () => {
    mocks.getRuntimeSummary.mockResolvedValue({
      core_ready: true,
      missing_optional_packages: ["tabpfn"],
    });
    mocks.detectGPU.mockResolvedValue({
      has_cuda: false,
      has_metal: false,
      cuda_version: null,
      gpu_name: null,
      driver_version: null,
      torch_cuda_available: false,
      torch_version: null,
      detection_source: null,
      recommended_profiles: ["cpu"],
    });
    mocks.getRecommendedConfig.mockResolvedValue({
      schema_version: "1.2",
      app_version: "0.6.0",
      nirs4all: "0.9.0",
      fetched_from: "bundled",
      fetched_at: "2026-04-18T08:00:00",
      profiles: [
        {
          id: "cpu",
          label: "CPU",
          description: "CPU profile",
          platforms: [],
          packages: {},
        },
      ],
      optional: [
        {
          name: "tabpfn",
          min: ">=1.0.0",
          recommended: "1.0.1",
          description: "TabPFN",
          category: "models",
          note: null,
          show_when_profile_managed: false,
          default_install: true,
        },
        {
          name: "xgboost",
          min: ">=2.0.0",
          recommended: "2.1.1",
          description: "XGBoost",
          category: "models",
          note: null,
          show_when_profile_managed: false,
          default_install: false,
        },
      ],
    });
    mocks.alignConfig.mockRejectedValue(new Error("skip preview"));

    const validation = await loadPostSwitchValidation();

    expect(validation.selectedProfile).toBe("cpu");
    expect(validation.selectedExtras).toEqual(["tabpfn", "xgboost"]);
    expect(mocks.alignConfig).toHaveBeenCalledWith({
      profile: "cpu",
      optional_packages: ["tabpfn", "xgboost"],
      dry_run: true,
    });
  });

  it("restarts the backend with skipEnsure enabled during runtime switches", async () => {
    const restartBackend = vi.fn().mockResolvedValue({ success: true });
    const restarted = vi.fn();
    window.addEventListener("backend-restarted", restarted);

    mocks.getRuntimeSummary.mockResolvedValue(null);
    mocks.detectGPU.mockResolvedValue(null);
    mocks.getRecommendedConfig.mockResolvedValue(null);

    try {
      await restartBackendForRuntimeSwitch(restartBackend);
    } finally {
      window.removeEventListener("backend-restarted", restarted);
    }

    expect(restartBackend).toHaveBeenCalledWith({ skipEnsure: true });
    expect(mocks.resetBackendUrl).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchOperatorAvailabilityInvalidated).toHaveBeenCalledTimes(1);
    expect(restarted).toHaveBeenCalledTimes(1);
  });
});
