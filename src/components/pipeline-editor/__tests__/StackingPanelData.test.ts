import { describe, expect, it } from "vitest";
import type { StackingConfig } from "../stackingConfig";
import {
  coerceStackingParamValue,
  getMetaModelDefaultParams,
  getStackingParamInputStep,
  getStackingParamInputValue,
  getStackingSourceSelection,
  getVisibleStackingBaseModelCount,
  isStackingSourceSelected,
  selectStackingMetaModel,
  setStackingCoverageStrategy,
  setStackingFillValue,
  setStackingMetaModelParam,
  setStackingPassthrough,
  selectAllStackingSourceModels,
  toggleStackingSourceModel,
} from "../StackingPanelData";

function makeConfig(overrides: Partial<StackingConfig> = {}): StackingConfig {
  return {
    enabled: true,
    metaModel: "Ridge",
    metaModelParams: { alpha: 1 },
    sourceModels: [],
    coverageStrategy: "drop",
    useOriginalFeatures: false,
    passthrough: false,
    ...overrides,
  };
}

describe("StackingPanelData", () => {
  it("cleans and copies meta-model default params", () => {
    const defaults = getMetaModelDefaultParams({
      defaultParams: { alpha: 1, ignored: undefined, kernel: "rbf" },
    });

    expect(defaults).toEqual({ alpha: 1, kernel: "rbf" });
    expect(defaults).not.toBe(
      getMetaModelDefaultParams({
        defaultParams: { alpha: 1, kernel: "rbf" },
      }),
    );
  });

  it("selects a meta-model and resets stale params immutably", () => {
    const config = makeConfig({
      metaModelParams: { alpha: 9, stale: true },
    });

    const next = selectStackingMetaModel(config, "XGBoost");

    expect(next).toEqual({
      ...config,
      metaModel: "XGBoost",
      metaModelParams: { n_estimators: 50, learning_rate: 0.1, max_depth: 3 },
    });
    expect(config.metaModel).toBe("Ridge");
    expect(config.metaModelParams).toEqual({ alpha: 9, stale: true });
  });

  it("derives and updates source model selection without mutating config", () => {
    const availableModels = [
      { id: "model-a", name: "A", type: "PLS" },
      { id: "model-b", name: "B", type: "SVR" },
    ];
    const config = makeConfig({ sourceModels: ["model-a"] });

    expect(getStackingSourceSelection(makeConfig(), availableModels)).toEqual({
      isUsingAllSources: true,
      selectedSourceCount: 2,
    });
    expect(getStackingSourceSelection(config, availableModels)).toEqual({
      isUsingAllSources: false,
      selectedSourceCount: 1,
    });
    expect(isStackingSourceSelected([], "model-b")).toBe(true);
    expect(isStackingSourceSelected(config.sourceModels, "model-b")).toBe(false);

    const added = toggleStackingSourceModel(config, "model-b", true);
    expect(added.sourceModels).toEqual(["model-a", "model-b"]);

    const removed = toggleStackingSourceModel(config, "model-a", false);
    expect(removed.sourceModels).toEqual([]);
    expect(config.sourceModels).toEqual(["model-a"]);
    expect(selectAllStackingSourceModels(config).sourceModels).toEqual([]);
  });

  it("updates advanced config fields immutably", () => {
    const config = makeConfig();

    expect(setStackingCoverageStrategy(config, "fill")).toEqual({
      ...config,
      coverageStrategy: "fill",
    });
    expect(setStackingFillValue(config, -1.5)).toEqual({
      ...config,
      fillValue: -1.5,
    });
    expect(setStackingPassthrough(config, true)).toEqual({
      ...config,
      passthrough: true,
    });
    expect(setStackingMetaModelParam(config, "alpha", 2)).toEqual({
      ...config,
      metaModelParams: { alpha: 2 },
    });
    expect(config).toEqual(makeConfig());
  });

  it("preserves existing input coercion and display behavior", () => {
    expect(coerceStackingParamValue(1, "2.5")).toBe(2.5);
    expect(coerceStackingParamValue(1, "")).toBe(0);
    expect(coerceStackingParamValue("rbf", "linear")).toBe("linear");
    expect(coerceStackingParamValue(true, "false")).toBe("false");

    expect(getStackingParamInputValue({}, "alpha", 1)).toBe("1");
    expect(getStackingParamInputValue({ enabled: false }, "enabled", true)).toBe(
      "false",
    );
    expect(getStackingParamInputStep(0.1)).toBe(0.1);
    expect(getStackingParamInputStep(1)).toBe(1);
    expect(getVisibleStackingBaseModelCount(6)).toBe(4);
  });
});
