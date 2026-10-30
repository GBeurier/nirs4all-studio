import { describe, expect, it } from "vitest";
import { normalizeYProcessingParams } from "../pipelineYProcessing";
import { exportToNirs4all } from "../pipelineConverter";
import type { PipelineStep } from "@/components/pipeline-editor/types";

describe("target processing contracts", () => {
  it.each(["10,20", "[10,20]", [10, 20]])("exports custom class boundaries %j", bins => {
    expect(exportToNirs4all([{
      id: "target", type: "y_processing", name: "RangeDiscretizer", params: { bins },
    }])).toEqual([{ y_processing: { class: "nirs4all.operators.transforms.targets.RangeDiscretizer", params: { bins: [10, 20] } } }]);
  });

  it.each(["", "10,", "2,1", "1,1", "[true,2]", "NaN,2", 0, false, [1, Infinity]])("refuses invalid boundaries %j", bins => {
    expect(() => normalizeYProcessingParams("RangeDiscretizer", { bins })).toThrow();
  });

  it("turns disabled target processing off while retaining the continuous model", () => {
    expect(exportToNirs4all([
      { id: "target", type: "y_processing", name: "RangeDiscretizer", params: { bins: "invalid" }, enabled: false },
      { id: "model", type: "model", name: "Ridge", classPath: "sklearn.linear_model.Ridge", params: {} },
    ])).toEqual([{ model: { class: "sklearn.linear_model.Ridge" } }]);
  });

  it("exports both supported equal-size and equal-frequency binning strategies", () => {
    for (const strategy of ["uniform", "quantile"]) {
      expect(exportToNirs4all([{ id: "target", type: "y_processing", name: "IntegerKBinsDiscretizer", params: { strategy, n_bins: 3 } }]))
        .toEqual([{ y_processing: { class: "nirs4all.operators.transforms.targets.IntegerKBinsDiscretizer", params: { strategy, n_bins: 3 } } }]);
    }
  });

  it("exports MinMax bounds using the public library signature", () => {
    expect(normalizeYProcessingParams("MinMaxScaler", { feature_range_min: -1, feature_range_max: 1 }))
      .toEqual({ feature_range: [-1, 1] });
  });

  it("recovers target settings saved by the previous editor without silently running stale parameters", () => {
    expect(exportToNirs4all([{
      id: "target", type: "y_processing", name: "StandardScaler", params: {},
      yProcessingConfig: { enabled: true, scaler: "RangeDiscretizer", params: { ranges: "10,20" } },
    }])).toEqual([{ y_processing: { class: "nirs4all.operators.transforms.targets.RangeDiscretizer", params: { bins: [10, 20] } } }]);
  });

  it("removes disabled nested nodes without inventing null generator alternatives", () => {
    const disabled: PipelineStep = { id: "off", type: "y_processing", name: "RangeDiscretizer", params: { bins: "invalid" }, enabled: false };
    const model: PipelineStep = { id: "model", type: "model", name: "Ridge", classPath: "sklearn.linear_model.Ridge", params: {} };
    const noop: PipelineStep = { id: "noop", type: "flow", name: "NoOp", params: {}, isNoOp: true, rawNirs4all: null };
    expect(exportToNirs4all([{ id: "seq", type: "flow", subType: "sequential", name: "Sequential", params: {}, children: [disabled, model] }]))
      .toEqual([[{ model: { class: "sklearn.linear_model.Ridge" } }]]);
    expect(exportToNirs4all([{ id: "or", type: "flow", subType: "generator", generatorKind: "or", name: "Or", params: {}, branches: [[disabled, model], [noop]] }]))
      .toEqual([{ _or_: [{ model: { class: "sklearn.linear_model.Ridge" } }, null] }]);
    expect(exportToNirs4all([{ id: "aug", type: "flow", subType: "feature_augmentation", generatorKind: "or", name: "FeatureAugmentation", params: {}, children: [disabled, noop] }]))
      .toEqual([{ feature_augmentation: { _or_: [null] } }]);
    expect(exportToNirs4all([{ id: "empty", type: "flow", subType: "sequential", name: "Sequential", params: {}, children: [disabled] }]))
      .toEqual([[]]);
  });
});
