import { describe, expect, it } from "vitest";
import type { YProcessingConfig } from "../yProcessingConfig";
import {
  buildYProcessingQuickSetup,
  coerceYProcessingParamValue,
  findYProcessingOption,
  getRecommendedScaler,
  getYProcessingDefaultParams,
  getYProcessingParamDescription,
  getYProcessingParamInputStep,
  getYProcessingParamSelect,
  groupYProcessingOptionsByCategory,
  resetYProcessingParams,
  setYProcessingEnabled,
  setYProcessingParam,
  setYProcessingScaler,
  Y_PROCESSING_CATEGORY_ORDER,
} from "../YProcessingPanelData";

function makeConfig(overrides: Partial<YProcessingConfig> = {}): YProcessingConfig {
  return {
    enabled: false,
    scaler: "MinMaxScaler",
    params: { feature_range_min: 0, feature_range_max: 1 },
    ...overrides,
  };
}

describe("findYProcessingOption", () => {
  it("returns the matching option", () => {
    expect(findYProcessingOption("StandardScaler")?.category).toBe("Scaling");
  });

  it("returns undefined for unknown or empty names", () => {
    expect(findYProcessingOption("Nope")).toBeUndefined();
    expect(findYProcessingOption(undefined)).toBeUndefined();
    expect(findYProcessingOption("")).toBeUndefined();
  });
});

describe("getYProcessingDefaultParams", () => {
  it("materializes default params as a plain record", () => {
    expect(getYProcessingDefaultParams(findYProcessingOption("MinMaxScaler"))).toEqual({
      feature_range_min: 0,
      feature_range_max: 1,
    });
  });

  it("returns an empty record for undefined or param-less options", () => {
    expect(getYProcessingDefaultParams(undefined)).toEqual({});
    expect(getYProcessingDefaultParams(findYProcessingOption("StandardScaler"))).toEqual({});
  });
});

describe("getYProcessingParamDescription", () => {
  it("returns the description when present, undefined otherwise", () => {
    const opt = findYProcessingOption("MinMaxScaler");
    expect(getYProcessingParamDescription(opt, "feature_range_min")).toBe(
      "Minimum value after scaling"
    );
    expect(getYProcessingParamDescription(opt, "missing")).toBeUndefined();
    expect(getYProcessingParamDescription(undefined, "feature_range_min")).toBeUndefined();
  });
});

describe("groupYProcessingOptionsByCategory", () => {
  it("groups options in display order with no empty groups", () => {
    const groups = groupYProcessingOptionsByCategory();
    expect(groups.map((g) => g.category)).toEqual([...Y_PROCESSING_CATEGORY_ORDER]);
    expect(groups.every((g) => g.options.length > 0)).toBe(true);
    expect(groups.flatMap((g) => g.options.map((o) => o.name))).toContain("RangeDiscretizer");
  });
});

describe("getYProcessingParamSelect", () => {
  it("returns choice lists for select params and undefined for free inputs", () => {
    expect(getYProcessingParamSelect("method")?.map((c) => c.value)).toEqual([
      "yeo-johnson",
      "box-cox",
    ]);
    expect(getYProcessingParamSelect("strategy")).toHaveLength(3);
    expect(getYProcessingParamSelect("n_bins")).toBeUndefined();
  });
});

describe("getYProcessingParamInputStep", () => {
  it("uses a fine step for sub-unit numeric defaults, coarse otherwise", () => {
    expect(getYProcessingParamInputStep(0.5)).toBe(0.01);
    expect(getYProcessingParamInputStep(5)).toBe(1);
    expect(getYProcessingParamInputStep("0,10,20")).toBe(1);
  });
});

describe("coerceYProcessingParamValue", () => {
  it("parses numbers from numeric defaults, falling back to 0", () => {
    expect(coerceYProcessingParamValue(5, "12")).toBe(12);
    expect(coerceYProcessingParamValue(5, "abc")).toBe(0);
  });

  it("passes strings through for non-numeric defaults", () => {
    expect(coerceYProcessingParamValue("0,10", "0,10,20")).toBe("0,10,20");
  });
});

describe("getRecommendedScaler", () => {
  it("recommends MinMax for DL models and no model, Standard otherwise", () => {
    expect(getRecommendedScaler()).toBe("MinMaxScaler");
    expect(getRecommendedScaler("nicon")).toBe("MinMaxScaler");
    expect(getRecommendedScaler("PLS")).toBe("StandardScaler");
  });
});

describe("config patch helpers", () => {
  it("setYProcessingEnabled toggles without mutating", () => {
    const config = makeConfig();
    const next = setYProcessingEnabled(config, true);
    expect(next.enabled).toBe(true);
    expect(config.enabled).toBe(false);
  });

  it("setYProcessingScaler resets params to the new scaler defaults", () => {
    const next = setYProcessingScaler(makeConfig(), "PowerTransformer");
    expect(next.scaler).toBe("PowerTransformer");
    expect(next.params).toEqual({ method: "yeo-johnson" });
  });

  it("setYProcessingParam updates a single key immutably", () => {
    const config = makeConfig();
    const next = setYProcessingParam(config, "feature_range_max", 2);
    expect(next.params).toEqual({ feature_range_min: 0, feature_range_max: 2 });
    expect(config.params.feature_range_max).toBe(1);
  });

  it("resetYProcessingParams restores defaults for the current scaler", () => {
    const config = makeConfig({ params: { feature_range_min: -5, feature_range_max: 99 } });
    expect(resetYProcessingParams(config).params).toEqual({
      feature_range_min: 0,
      feature_range_max: 1,
    });
  });

  it("resetYProcessingParams is a no-op for an unknown scaler", () => {
    const config = makeConfig({ scaler: "Nope", params: { a: 1 } });
    expect(resetYProcessingParams(config)).toBe(config);
  });

  it("buildYProcessingQuickSetup builds an enabled config with defaults", () => {
    expect(buildYProcessingQuickSetup("StandardScaler")).toEqual({
      enabled: true,
      scaler: "StandardScaler",
      params: {},
    });
  });
});
