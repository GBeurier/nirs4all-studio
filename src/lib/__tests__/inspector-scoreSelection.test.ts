import { describe, expect, it } from "vitest";

import type { InspectorChainSummary } from "@/types/inspector";
import {
  getInspectorMetricDisplayName,
  getInspectorReferenceMetric,
  getInspectorScoreColumnLabel,
  getInspectorScoreDirectionLabel,
  INSPECTOR_SCORE_OPTIONS,
  isInspectorScoreLowerBetter,
} from "@/lib/inspector/scoreSelection";

function chain(overrides: Partial<InspectorChainSummary> = {}): InspectorChainSummary {
  return {
    chain_id: "chain-1",
    run_id: "run-1",
    pipeline_id: "pipeline-1",
    pipeline_name: "Pipeline",
    model_class: "PLSRegression",
    model_name: "PLS",
    preprocessings: "SNV",
    preprocessing_steps: ["SNV"],
    branch_path: null,
    source_index: null,
    metric: null,
    task_type: "regression",
    dataset_name: "Corn",
    best_params: null,
    variant_params: null,
    cv_val_score: 0.5,
    cv_test_score: null,
    cv_train_score: null,
    cv_fold_count: 5,
    final_test_score: null,
    final_train_score: null,
    pipeline_status: "completed",
    ...overrides,
  };
}

describe("inspector score selection", () => {
  it("exposes the current fixed score columns as UI options", () => {
    expect(INSPECTOR_SCORE_OPTIONS.map((option) => option.value)).toEqual([
      "cv_val_score",
      "cv_test_score",
      "cv_train_score",
      "final_test_score",
      "final_train_score",
    ]);
    expect(getInspectorScoreColumnLabel("cv_val_score")).toBe("CV Val Score");
  });

  it("selects the first available metric as the inspector reference metric", () => {
    expect(getInspectorReferenceMetric([
      chain({ chain_id: "a", metric: null }),
      chain({ chain_id: "b", metric: "rmse" }),
      chain({ chain_id: "c", metric: "mae" }),
    ])).toBe("rmse");
    expect(getInspectorReferenceMetric([chain({ metric: null })])).toBeNull();
  });

  it("centralizes score direction labels", () => {
    expect(isInspectorScoreLowerBetter("rmse")).toBe(true);
    expect(getInspectorScoreDirectionLabel("rmse")).toBe("Lower is better");
    expect(getInspectorScoreDirectionLabel("r2")).toBe("Higher is better");
  });

  it("uses metric abbreviation when present and score column when metric is missing", () => {
    expect(getInspectorMetricDisplayName("root_mean_squared_error", "cv_val_score")).toBe("RMSE");
    expect(getInspectorMetricDisplayName(null, "cv_val_score")).toBe("CV_VAL_SCORE");
  });
});
