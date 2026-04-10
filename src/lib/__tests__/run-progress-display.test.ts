import { describe, expect, it } from "vitest";

import {
  buildPipelineCompactSummary,
  buildPipelinePrimarySummary,
  formatPipelineVariantLabel,
  getPipelineDisplayMetrics,
} from "../run-progress-display";

describe("run progress display helpers", () => {
  it("formats raw serialized variant descriptions into compact operator labels", () => {
    const rawVariant = "[['nirs4all.operators.transforms.nirs.MultiplicativeScatterCorrection', {'class': 'nirs4all.operators.transforms.signal.Gaussian', 'params': {'order': 0, 'sigma': 2}}, 'nirs4all.operators.transforms.nirs.ASLSBaseline', {'class': 'nirs4all.operators.transforms.orthogonalization.OSC', 'params': {'n_components': 2}}]]";

    expect(formatPipelineVariantLabel(null, rawVariant)).toBe(
      "MultiplicativeScatterCorrection, Gaussian(order:0, sigma:2), ASLSBaseline, OSC(n_components:2)"
    );
  });

  it("keeps scalar variant choices readable", () => {
    expect(
      formatPipelineVariantLabel({ n_components: 12, alpha: 0.25 }, null)
    ).toBe("n_components: 12 | alpha: 0.25");
  });

  it("averages fold metrics when final metrics are not available", () => {
    expect(
      getPipelineDisplayMetrics({
        fold_metrics: {
          1: { r2: 0.8, rmse: 0.2, mae: 0.1 },
          2: { r2: 0.6, rmse: 0.4, mae: 0.2 },
        },
      })
    ).toEqual({
      r2: 0.7,
      rmse: 0.30000000000000004,
      mae: 0.15000000000000002,
    });
  });

  it("builds compact primary and secondary summaries", () => {
    const pipeline = {
      model: "PLSRegression",
      preprocessing: "StandardNormalVariate → MultiplicativeScatterCorrection",
      pipeline_name: "PLSRegression",
      fold_count: 5,
      total_model_count: 15,
      model_count_breakdown: "5 folds × 3 branches = 15 models",
    };

    expect(buildPipelinePrimarySummary(6, 150, pipeline)).toBe("6/150 · 15 fits");
    expect(buildPipelineCompactSummary(pipeline)).toBe(
      "5 folds · PLSRegression · StandardNormalVariate → MultiplicativeScatterCorrection"
    );
  });
});