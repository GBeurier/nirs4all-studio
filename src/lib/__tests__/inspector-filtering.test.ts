import { describe, expect, it } from "vitest";

import {
  computeResultAnalysisOutlierChainIds,
  computeResultAnalysisScoreStats,
  filterResultAnalysisChains,
} from "@/lib/inspector/filtering";
import { buildResultAnalysisStore } from "@/lib/inspector/resultAnalysisStore";
import type { InspectorChainSummary } from "@/types/inspector";

function chain(
  chainId: string,
  score: number | null,
  overrides: Partial<InspectorChainSummary> = {},
): InspectorChainSummary {
  return {
    chain_id: chainId,
    run_id: "run-1",
    pipeline_id: "pipeline-1",
    pipeline_name: "Pipeline",
    model_class: "PLSRegression",
    model_name: null,
    preprocessings: null,
    preprocessing_steps: [],
    branch_path: [],
    source_index: null,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "Dataset",
    best_params: null,
    variant_params: null,
    cv_val_score: score,
    cv_test_score: null,
    cv_train_score: null,
    cv_fold_count: 0,
    final_test_score: null,
    final_train_score: null,
    pipeline_status: "completed",
    ...overrides,
  };
}

describe("inspector store-backed filtering", () => {
  const store = buildResultAnalysisStore({
    chains: [
      chain("a", 1),
      chain("b", 2),
      chain("c", 2),
      chain("d", 3),
      chain("e", 100),
      chain("unscored", null),
    ],
  });

  it("computes score stats and outliers from a result analysis store", () => {
    expect(computeResultAnalysisScoreStats(store, "cv_val_score")).toEqual({
      min: 1,
      max: 100,
      mean: 21.6,
    });
    expect([...computeResultAnalysisOutlierChainIds(store, "cv_val_score")]).toEqual(["e"]);
  });

  it("applies score range, outlier, and selection filters in order", () => {
    const outlierChainIds = computeResultAnalysisOutlierChainIds(store, "cv_val_score");

    const filtered = filterResultAnalysisChains({
      store,
      scoreColumn: "cv_val_score",
      scoreRange: [0, 10],
      outlier: "hide",
      outlierChainIds,
      selection: "selected",
      selectedChainIds: new Set(["b", "d", "e"]),
      hasSelection: true,
    });

    expect(filtered.map(item => item.chain_id)).toEqual(["b", "d"]);
  });

  it("only applies selection filters when a selection exists", () => {
    const filtered = filterResultAnalysisChains({
      store,
      scoreColumn: "cv_val_score",
      scoreRange: null,
      outlier: "all",
      outlierChainIds: new Set(),
      selection: "selected",
      selectedChainIds: new Set(["a"]),
      hasSelection: false,
    });

    expect(filtered.map(item => item.chain_id)).toEqual(["a", "b", "c", "d", "e", "unscored"]);
  });
});
