import { describe, expect, it } from "vitest";

import {
  VISUAL_STEPS,
  WIZARD_STEPS,
  buildEnvSetupViewState,
  checkedStateToBoolean,
  getEffectiveProfileExtras,
  getStepLabelKey,
  getVisualIndex,
  isGpuProfile,
  isRecommendedProfile,
  pruneSelectedExtrasForVisiblePackages,
  updateExtraSelection,
  type WizardStep,
} from "../EnvSetup.helpers";
import type { GPUDetectionResponse, RecommendedConfigResponse } from "@/api/config";

const recommendedConfig: RecommendedConfigResponse = {
  schema_version: "1",
  app_version: "1.0.0",
  nirs4all: "1.0.0",
  fetched_from: "test",
  fetched_at: "2026-01-01T00:00:00Z",
  profiles: [
    {
      id: "cpu-lite",
      label: "CPU Lite",
      description: "Small CPU install",
      platforms: [],
      packages: {
        numpy: { min: "1.0.0", recommended: "1.1.0" },
      },
      exclude_optionals: ["torch"],
    },
    {
      id: "gpu-cuda",
      label: "CUDA",
      description: "GPU install",
      platforms: ["linux"],
      packages: {
        torch: { min: "2.0.0", recommended: "2.1.0" },
      },
    },
    {
      id: "win-extra",
      label: "Windows",
      description: "Windows-only profile",
      platforms: ["win32"],
      packages: {},
    },
  ],
  optional: [
    {
      name: "numpy",
      min: "1.0.0",
      recommended: "1.1.0",
      description: "Managed by profiles and hidden by default",
      category: "core",
    },
    {
      name: "torch",
      min: "2.0.0",
      recommended: "2.1.0",
      description: "Optional GPU package",
      category: "ml",
      show_when_profile_managed: true,
    },
    {
      name: "plotly",
      min: "5.0.0",
      recommended: null,
      description: "Plotting",
      category: "viz",
    },
  ],
};

describe("getVisualIndex", () => {
  it("collapses env and env-progress onto the first dot", () => {
    expect(getVisualIndex("env")).toBe(0);
    expect(getVisualIndex("env-progress")).toBe(0);
  });

  it("collapses extras and install onto the extras dot", () => {
    expect(getVisualIndex("extras")).toBe(3);
    expect(getVisualIndex("install")).toBe(3);
  });

  it("maps the remaining steps to distinct dots", () => {
    expect(getVisualIndex("detect")).toBe(1);
    expect(getVisualIndex("profile")).toBe(2);
    expect(getVisualIndex("done")).toBe(4);
  });

  it("returns an index within VISUAL_STEPS bounds for every wizard step", () => {
    for (const step of WIZARD_STEPS) {
      const index = getVisualIndex(step);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(VISUAL_STEPS.length);
    }
  });
});

describe("getStepLabelKey", () => {
  it("maps known env-setup steps to their translation keys", () => {
    expect(getStepLabelKey("downloading")).toBe("setupWizard.envProgress.downloading");
    expect(getStepLabelKey("creating_venv")).toBe("setupWizard.envProgress.creatingVenv");
    expect(getStepLabelKey("starting")).toBe("setupWizard.envProgress.startingBackend");
    expect(getStepLabelKey("ready")).toBe("setupWizard.envProgress.ready");
  });

  it("falls back to the generic setting-up key for unknown or empty steps", () => {
    expect(getStepLabelKey("")).toBe("setupWizard.envProgress.settingUp");
    expect(getStepLabelKey("not-a-real-step")).toBe("setupWizard.envProgress.settingUp");
  });
});

describe("isGpuProfile", () => {
  it("treats gpu/cuda/mps ids as accelerated", () => {
    expect(isGpuProfile("gpu")).toBe(true);
    expect(isGpuProfile("gpu-cuda")).toBe(true);
    expect(isGpuProfile("gpu-metal-mps")).toBe(true);
  });

  it("treats plain cpu profiles as not accelerated", () => {
    expect(isGpuProfile("cpu")).toBe(false);
    expect(isGpuProfile("cpu-lite")).toBe(false);
  });
});

describe("isRecommendedProfile", () => {
  const gpuInfo = { recommended_profiles: ["gpu-cuda", "cpu"] } as GPUDetectionResponse;

  it("matches only the top recommendation", () => {
    expect(isRecommendedProfile(gpuInfo, "gpu-cuda")).toBe(true);
    expect(isRecommendedProfile(gpuInfo, "cpu")).toBe(false);
  });

  it("is false when detection info is missing", () => {
    expect(isRecommendedProfile(null, "gpu-cuda")).toBe(false);
    expect(isRecommendedProfile(undefined, "cpu")).toBe(false);
  });

  it("is false when there are no recommendations", () => {
    const empty = { recommended_profiles: [] } as unknown as GPUDetectionResponse;
    expect(isRecommendedProfile(empty, "cpu")).toBe(false);
  });
});

describe("buildEnvSetupViewState", () => {
  it("filters profiles by platform and hides profile-excluded optionals", () => {
    const state = buildEnvSetupViewState({
      config: recommendedConfig,
      platform: "win32",
      selectedExtras: ["torch", "plotly"],
      selectedProfile: "cpu-lite",
    });

    expect(state.profiles.map((profile) => profile.id)).toEqual(["cpu-lite", "win-extra"]);
    expect(state.profileOptionalPackages.map((pkg) => pkg.name)).toEqual(["plotly"]);
    expect(state.effectiveExtras).toEqual(["plotly"]);
  });

  it("keeps current extras while config has not loaded", () => {
    expect(buildEnvSetupViewState({
      config: null,
      platform: "win32",
      selectedExtras: ["plotly"],
      selectedProfile: "cpu-lite",
    })).toEqual({
      profiles: [],
      profileOptionalPackages: [],
      effectiveExtras: ["plotly"],
    });
  });
});

describe("getEffectiveProfileExtras", () => {
  it("drops selected extras excluded by the selected profile", () => {
    expect(getEffectiveProfileExtras(["torch", "plotly"], recommendedConfig, "cpu-lite")).toEqual(["plotly"]);
  });
});

describe("pruneSelectedExtrasForVisiblePackages", () => {
  it("keeps only globally visible optionals", () => {
    expect(pruneSelectedExtrasForVisiblePackages(["numpy", "torch", "plotly"], recommendedConfig)).toEqual(["torch", "plotly"]);
  });

  it("clears selections when no config is available", () => {
    expect(pruneSelectedExtrasForVisiblePackages(["plotly"], null)).toEqual([]);
  });
});

describe("updateExtraSelection", () => {
  it("adds selected package names with the existing truthy checkbox behavior", () => {
    expect(updateExtraSelection(["plotly"], "torch", true)).toEqual(["plotly", "torch"]);
    expect(updateExtraSelection(["plotly"], "torch", "indeterminate")).toEqual(["plotly", "torch"]);
  });

  it("removes all matching package names when unchecked", () => {
    expect(updateExtraSelection(["plotly", "torch", "torch"], "torch", false)).toEqual(["plotly"]);
  });
});

describe("checkedStateToBoolean", () => {
  it("coerces only the explicit checked state to true", () => {
    expect(checkedStateToBoolean(true)).toBe(true);
    expect(checkedStateToBoolean(false)).toBe(false);
    expect(checkedStateToBoolean("indeterminate")).toBe(false);
  });
});

describe("step constants", () => {
  it("keeps the wizard step union and the runtime list in sync", () => {
    const steps: WizardStep[] = [...WIZARD_STEPS];
    expect(steps).toContain("done");
    expect(new Set(WIZARD_STEPS).size).toBe(WIZARD_STEPS.length);
  });
});
