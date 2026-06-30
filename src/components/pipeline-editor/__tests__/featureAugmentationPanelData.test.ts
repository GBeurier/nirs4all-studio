import { describe, expect, it } from "vitest";
import type { FeatureAugmentationConfig } from "../featureAugmentationConfig";
import {
  applyFeatureAugmentationPreset,
  appendFeatureAugmentationTransform,
  clearFeatureAugmentationTransforms,
  coerceFeatureAugmentationParamValue,
  formatFeatureAugmentationParamsPreview,
  getActiveFeatureAugmentationTransforms,
  getFeatureAugmentationOutputPreview,
  groupStepOptionsByCategory,
  removeFeatureAugmentationTransform,
  setFeatureAugmentationAction,
  setFeatureAugmentationEnabled,
  toggleFeatureAugmentationTransform,
  updateFeatureAugmentationTransformParams,
  type FeatureAugmentationPreset,
} from "../featureAugmentationPanelData";
import type { StepOption } from "../types";

function nextIdFactory(): () => string {
  let nextId = 0;
  return () => `transform-${++nextId}`;
}

function makeConfig(
  overrides: Partial<FeatureAugmentationConfig> = {},
): FeatureAugmentationConfig {
  return {
    enabled: false,
    action: "extend",
    transforms: [
      {
        id: "snv",
        name: "SNV",
        params: {},
        enabled: true,
      },
      {
        id: "msc",
        name: "MSC",
        params: { reference: "mean" },
        enabled: false,
      },
    ],
    ...overrides,
  };
}

describe("featureAugmentationPanelData", () => {
  it("updates top-level config fields without mutating the source config", () => {
    const config = makeConfig();

    const enabled = setFeatureAugmentationEnabled(config, true);
    const action = setFeatureAugmentationAction(config, "replace");

    expect(enabled).toEqual({ ...config, enabled: true });
    expect(action).toEqual({ ...config, action: "replace" });
    expect(config.enabled).toBe(false);
    expect(config.action).toBe("extend");
  });

  it("appends transforms with stable generated ids and cleaned params", () => {
    const config = makeConfig({ transforms: [] });
    const ids = nextIdFactory();

    const next = appendFeatureAugmentationTransform(
      config,
      "SavitzkyGolay",
      { window_length: 11, polyorder: 2, drop: undefined },
      ids,
    );

    expect(next.transforms).toEqual([
      {
        id: "transform-1",
        name: "SavitzkyGolay",
        params: { window_length: 11, polyorder: 2 },
        enabled: true,
      },
    ]);
    expect(config.transforms).toEqual([]);
  });

  it("toggles, updates, removes, and clears transforms immutably", () => {
    const config = makeConfig();

    const toggled = toggleFeatureAugmentationTransform(config, "snv", false);
    expect(toggled.transforms[0].enabled).toBe(false);
    expect(config.transforms[0].enabled).toBe(true);

    const updated = updateFeatureAugmentationTransformParams(config, "msc", {
      reference: "median",
      ignored: undefined,
    });
    expect(updated.transforms[1].params).toEqual({ reference: "median" });
    expect(config.transforms[1].params).toEqual({ reference: "mean" });

    const removed = removeFeatureAugmentationTransform(config, "snv");
    expect(removed.transforms.map((transform) => transform.id)).toEqual(["msc"]);

    const cleared = clearFeatureAugmentationTransforms(config);
    expect(cleared.transforms).toEqual([]);
    expect(config.transforms).toHaveLength(2);
  });

  it("applies presets as an enabled replacement transform list", () => {
    const preset: FeatureAugmentationPreset = {
      name: "Custom",
      description: "Custom preset",
      transforms: [
        { name: "SNV", params: {} },
        { name: "MSC", params: { reference: "mean", drop: undefined } },
      ],
    };

    const next = applyFeatureAugmentationPreset(
      makeConfig({ enabled: false }),
      preset,
      nextIdFactory(),
    );

    expect(next.enabled).toBe(true);
    expect(next.transforms).toEqual([
      {
        id: "transform-1",
        name: "SNV",
        params: {},
        enabled: true,
      },
      {
        id: "transform-2",
        name: "MSC",
        params: { reference: "mean" },
        enabled: true,
      },
    ]);
  });

  it("derives active transforms and output preview metadata", () => {
    const config = makeConfig();
    const activeTransforms = getActiveFeatureAugmentationTransforms(config);

    expect(activeTransforms.map((transform) => transform.id)).toEqual(["snv"]);
    expect(getFeatureAugmentationOutputPreview("extend", activeTransforms)).toEqual({
      channels: 2,
      description: "Original + 1 transform = 2 channels",
    });
    expect(getFeatureAugmentationOutputPreview("add", activeTransforms)).toEqual({
      channels: 2,
      description: "Cumulative: Original, +T1, +T1+T2, ... = 2 channels",
    });
    expect(getFeatureAugmentationOutputPreview("replace", activeTransforms)).toEqual({
      channels: 1,
      description: "Sequential processing: T1 → T2 → ... → T1",
    });
    expect(getFeatureAugmentationOutputPreview("extend", [])).toEqual({
      channels: 1,
      description: "No transforms - original only",
    });
  });

  it("formats params and preserves the existing input coercion behavior", () => {
    expect(
      formatFeatureAugmentationParamsPreview({
        window_length: 11,
        polyorder: 2,
        deriv: 1,
      }),
    ).toBe("window_length=11, polyorder=2");
    expect(coerceFeatureAugmentationParamValue(1, "2.5")).toBe(2.5);
    expect(coerceFeatureAugmentationParamValue(1, "")).toBe(0);
    expect(coerceFeatureAugmentationParamValue(true, "false")).toBe("false");
  });

  it("groups step options by their display category in source order", () => {
    const options: StepOption[] = [
      { name: "SNV", description: "SNV", defaultParams: {}, category: "NIRS" },
      { name: "MSC", description: "MSC", defaultParams: {}, category: "NIRS" },
      { name: "Gaussian", description: "Gaussian", defaultParams: {} },
      {
        name: "SavitzkyGolay",
        description: "SG",
        defaultParams: {},
        category: "Derivatives",
      },
    ];

    expect(groupStepOptionsByCategory(options)).toEqual([
      { category: "NIRS", options: [options[0], options[1]] },
      { category: "Other", options: [options[2]] },
      { category: "Derivatives", options: [options[3]] },
    ]);
  });
});
