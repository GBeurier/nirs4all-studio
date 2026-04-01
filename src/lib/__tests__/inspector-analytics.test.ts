import { describe, expect, it } from "vitest";
import {
  buildBranchComparisonData,
  buildHyperparameterData,
  buildPreprocessingImpactData,
  buildRankingsData,
  pickFocusedChainIds,
} from "@/lib/inspector/analytics";
import type { InspectorChainSummary } from "@/types/inspector";

const baseChains: InspectorChainSummary[] = [
  {
    chain_id: "chain-a",
    run_id: "run-1",
    pipeline_id: "pipe-1",
    model_class: "PLSRegression",
    model_name: "PLS 8",
    preprocessings: "SNV",
    branch_path: [0, 1],
    source_index: 0,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "diesel",
    best_params: { n_components: 8, alpha: 0.1 },
    cv_val_score: 0.12,
    cv_test_score: 0.15,
    cv_train_score: 0.09,
    cv_fold_count: 5,
    final_test_score: 0.14,
    final_train_score: 0.08,
    pipeline_status: "completed",
  },
  {
    chain_id: "chain-b",
    run_id: "run-1",
    pipeline_id: "pipe-1",
    model_class: "RandomForestRegressor",
    model_name: "RF",
    preprocessings: "MSC",
    branch_path: [0, 2],
    source_index: 1,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "diesel",
    best_params: { max_depth: 6 },
    cv_val_score: 0.22,
    cv_test_score: 0.24,
    cv_train_score: 0.11,
    cv_fold_count: 5,
    final_test_score: 0.2,
    final_train_score: 0.09,
    pipeline_status: "completed",
  },
  {
    chain_id: "chain-c",
    run_id: "run-2",
    pipeline_id: "pipe-2",
    model_class: "PLSRegression",
    model_name: "PLS 10",
    preprocessings: "SNV",
    branch_path: [1],
    source_index: 2,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "diesel",
    best_params: { n_components: 10, alpha: 0.2 },
    cv_val_score: 0.11,
    cv_test_score: 0.14,
    cv_train_score: 0.08,
    cv_fold_count: 5,
    final_test_score: 0.13,
    final_train_score: 0.07,
    pipeline_status: "completed",
  },
];

describe("inspector analytics", () => {
  it("sorts rankings using metric direction and uses top chains by default", () => {
    const rankings = buildRankingsData(baseChains, "cv_val_score", 10);
    expect(rankings.rankings.map(row => row.chain_id)).toEqual(["chain-c", "chain-a", "chain-b"]);

    const focused = pickFocusedChainIds(baseChains, new Set<string>(), "cv_val_score", 2);
    expect(focused.mode).toBe("top");
    expect(focused.chainIds).toEqual(["chain-c", "chain-a"]);
  });

  it("prefers the current selection when choosing focused chains", () => {
    const focused = pickFocusedChainIds(baseChains, new Set(["chain-b", "chain-a"]), "cv_val_score", 3);
    expect(focused.mode).toBe("selection");
    expect(focused.chainIds).toEqual(["chain-a", "chain-b"]);
  });

  it("computes preprocessing impact with positive values meaning beneficial change", () => {
    const impact = buildPreprocessingImpactData(baseChains, "cv_val_score");
    const snv = impact.entries.find(entry => entry.step_name === "SNV");
    const msc = impact.entries.find(entry => entry.step_name === "MSC");

    expect(snv?.impact).toBeGreaterThan(0);
    expect(msc?.impact).toBeLessThan(0);
  });

  it("discovers numeric hyperparameters and only emits valid scatter points", () => {
    const hyper = buildHyperparameterData(baseChains, "cv_val_score", "n_components");
    expect(hyper.available_params).toContain("n_components");
    expect(hyper.points).toHaveLength(2);
    expect(hyper.points.map(point => point.chain_id)).toEqual(["chain-a", "chain-c"]);
  });

  it("aggregates branch comparison statistics from branch paths", () => {
    const branches = buildBranchComparisonData(baseChains, "cv_val_score");
    expect(branches.branches).toHaveLength(3);
    expect(branches.branches[0]?.label).toBe("1");
    expect(branches.total_chains).toBe(3);
  });
});
