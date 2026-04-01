import { describe, expect, it } from "vitest";

import {
  buildOverviewData,
  buildPreprocessingImpactData,
  buildRankingsData,
  flattenNumericParams,
  getAvailableHyperparameters,
} from "../inspector/derived";
import type { InspectorChainSummary } from "@/types/inspector";

const CHAINS: InspectorChainSummary[] = [
  {
    chain_id: "chain-a",
    run_id: "run-1",
    pipeline_id: "pipe-1",
    model_class: "PLSRegression",
    model_name: "PLSRegression",
    preprocessings: "SNV | SG",
    branch_path: null,
    source_index: null,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "diesel-a",
    best_params: { n_components: 8, optimizer: { learning_rate: 0.02 } },
    cv_val_score: 0.18,
    cv_test_score: 0.21,
    cv_train_score: 0.14,
    cv_fold_count: 5,
    final_test_score: 0.2,
    final_train_score: 0.12,
    pipeline_status: "completed",
  },
  {
    chain_id: "chain-b",
    run_id: "run-1",
    pipeline_id: "pipe-2",
    model_class: "RandomForestRegressor",
    model_name: "RandomForestRegressor",
    preprocessings: "SNV",
    branch_path: null,
    source_index: null,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "diesel-a",
    best_params: { max_depth: 6, optimizer: { learning_rate: 0.05 } },
    cv_val_score: 0.24,
    cv_test_score: 0.28,
    cv_train_score: 0.08,
    cv_fold_count: 5,
    final_test_score: 0.27,
    final_train_score: 0.09,
    pipeline_status: "completed",
  },
  {
    chain_id: "chain-c",
    run_id: "run-2",
    pipeline_id: "pipe-3",
    model_class: "PLSRegression",
    model_name: "PLSRegression",
    preprocessings: "MSC | SG",
    branch_path: null,
    source_index: null,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "diesel-b",
    best_params: { n_components: 12, optimizer: { learning_rate: 0.01 } },
    cv_val_score: 0.16,
    cv_test_score: 0.18,
    cv_train_score: 0.13,
    cv_fold_count: 5,
    final_test_score: 0.19,
    final_train_score: 0.11,
    pipeline_status: "completed",
  },
];

describe("inspector derived helpers", () => {
  it("orders rankings using metric direction", () => {
    const rankings = buildRankingsData(CHAINS, "cv_val_score");
    expect(rankings.rankings.map(row => row.chain_id)).toEqual(["chain-c", "chain-a", "chain-b"]);
    expect(rankings.sort_ascending).toBe(true);
  });

  it("flattens nested numeric hyperparameters", () => {
    expect(flattenNumericParams(CHAINS[0].best_params as Record<string, unknown>)).toEqual({
      n_components: 8,
      "optimizer.learning_rate": 0.02,
    });
    expect(getAvailableHyperparameters(CHAINS)).toContain("optimizer.learning_rate");
  });

  it("computes preprocessing impact with positive lift for lower-is-better metrics", () => {
    const impact = buildPreprocessingImpactData(CHAINS, "cv_val_score");
    const snv = impact.entries.find(entry => entry.step_name === "SNV");
    const sg = impact.entries.find(entry => entry.step_name === "SG");

    expect(snv?.impact).toBeLessThan(0);
    expect(sg?.impact).toBeGreaterThan(0);
  });

  it("surfaces mixed scope warnings in the overview", () => {
    const mixedScope = buildOverviewData([
      ...CHAINS,
      {
        ...CHAINS[0],
        chain_id: "chain-d",
        metric: "accuracy",
        task_type: "classification",
        cv_val_score: 0.91,
      },
    ], "cv_val_score");

    expect(mixedScope.insights.some(insight => insight.title === "Mixed comparison scope")).toBe(true);
  });
});
