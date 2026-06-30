import { describe, expect, it } from "vitest";

import type { InspectorChainSummary } from "@/types/inspector";
import { buildResultAnalysisStore } from "@/lib/inspector/resultAnalysisStore";
import {
  buildInspectorChainGroupMap,
  computeInspectorGroups,
  computeInspectorGroupsFromStore,
} from "@/lib/inspector/grouping";

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
    metric: "rmse",
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

describe("inspector grouping", () => {
  it("groups chains by variable values and sorts larger groups first", () => {
    const groups = computeInspectorGroups(
      [
        chain({ chain_id: "a", dataset_name: "Corn" }),
        chain({ chain_id: "b", dataset_name: "Wheat" }),
        chain({ chain_id: "c", dataset_name: "Corn" }),
        chain({ chain_id: "d", dataset_name: null }),
      ],
      {
        groupMode: "by_variable",
        groupBy: "dataset_name",
        rangeConfig: null,
        topKConfig: null,
        expressionConfig: null,
      },
    );

    expect(groups.map((group) => [group.label, group.chain_ids])).toEqual([
      ["Corn", ["a", "c"]],
      ["Wheat", ["b"]],
      ["(empty)", ["d"]],
    ]);
  });

  it("groups finite scores into configured ranges", () => {
    const groups = computeInspectorGroups(
      [
        chain({ chain_id: "low", cv_val_score: 0.1 }),
        chain({ chain_id: "mid", cv_val_score: 0.5 }),
        chain({ chain_id: "high", cv_val_score: 0.9 }),
        chain({ chain_id: "missing", cv_val_score: null }),
      ],
      {
        groupMode: "by_range",
        groupBy: null,
        rangeConfig: { column: "cv_val_score", binCount: 2 },
        topKConfig: null,
        expressionConfig: null,
      },
    );

    expect(groups.map((group) => [group.label, group.chain_ids])).toEqual([
      ["0.100 – 0.500", ["low"]],
      ["0.500 – 0.900", ["mid", "high"]],
    ]);
  });

  it("builds top-k groups with the existing descending default", () => {
    const groups = computeInspectorGroups(
      [
        chain({ chain_id: "best", cv_val_score: 0.9 }),
        chain({ chain_id: "middle", cv_val_score: 0.6 }),
        chain({ chain_id: "worst", cv_val_score: 0.1 }),
      ],
      {
        groupMode: "by_top_k",
        groupBy: null,
        rangeConfig: null,
        topKConfig: { scoreColumn: "cv_val_score", k: 2 },
        expressionConfig: null,
      },
    );

    expect(groups.map((group) => [group.label, group.chain_ids])).toEqual([
      ["Top 2", ["best", "middle"]],
      ["Others (1)", ["worst"]],
    ]);
  });

  it("groups chains by branch labels", () => {
    const groups = computeInspectorGroups(
      [
        chain({ chain_id: "root", branch_path: null }),
        chain({ chain_id: "left", branch_path: "left" }),
        chain({ chain_id: "left-2", branch_path: "left" }),
      ],
      {
        groupMode: "by_branch",
        groupBy: null,
        rangeConfig: null,
        topKConfig: null,
        expressionConfig: null,
      },
    );

    expect(groups.map((group) => [group.label, group.chain_ids])).toEqual([
      ["left", ["left", "left-2"]],
      ["(no branch)", ["root"]],
    ]);
  });

  it("groups chains with expression rules", () => {
    const groups = computeInspectorGroups(
      [
        chain({ chain_id: "pls-good", model_class: "PLSRegression", cv_val_score: 0.8 }),
        chain({ chain_id: "pls-low", model_class: "PLSRegression", cv_val_score: 0.3 }),
        chain({ chain_id: "rf-good", model_class: "RandomForest", cv_val_score: 0.9 }),
      ],
      {
        groupMode: "by_expression",
        groupBy: null,
        rangeConfig: null,
        topKConfig: null,
        expressionConfig: {
          groups: [
            {
              id: "good-pls",
              label: "Good PLS",
              combinator: "AND",
              rules: [
                { id: "model", field: "model_class", operator: "contains", value: "PLS" },
                { id: "score", field: "cv_val_score", operator: "gt", value: "0.5" },
              ],
            },
            {
              id: "not-rf",
              label: "",
              combinator: "OR",
              rules: [
                { id: "not-rf", field: "model_class", operator: "not_contains", value: "Forest" },
              ],
            },
          ],
        },
      },
    );

    expect(groups.map((group) => [group.label, group.chain_ids])).toEqual([
      ["Good PLS", ["pls-good"]],
      ["Group 2", ["pls-good", "pls-low"]],
    ]);
  });

  it("builds a chain to group lookup", () => {
    const groups = computeInspectorGroups(
      [
        chain({ chain_id: "a", model_class: "PLS" }),
        chain({ chain_id: "b", model_class: "RF" }),
      ],
      {
        groupMode: "by_variable",
        groupBy: "model_class",
        rangeConfig: null,
        topKConfig: null,
        expressionConfig: null,
      },
    );

    const lookup = buildInspectorChainGroupMap(groups);
    expect(lookup.get("a")?.label).toBe("PLS");
    expect(lookup.get("b")?.label).toBe("RF");
    expect(lookup.get("missing")).toBeUndefined();
  });

  it("builds groups from a result analysis store", () => {
    const store = buildResultAnalysisStore({
      chains: [
        chain({ chain_id: "pls", model_class: "PLSRegression", cv_val_score: 0.9 }),
        chain({ chain_id: "rf", model_class: "RandomForest", cv_val_score: 0.7 }),
        chain({ chain_id: "missing", model_class: "RandomForest", cv_val_score: null }),
      ],
    });

    expect(computeInspectorGroupsFromStore(store, {
      groupMode: "by_top_k",
      groupBy: null,
      rangeConfig: null,
      topKConfig: { scoreColumn: "cv_val_score", k: 1 },
      expressionConfig: null,
    }).map((group) => [group.label, group.chain_ids])).toEqual([
      ["Top 1", ["pls"]],
      ["Others (1)", ["rf"]],
    ]);

    expect(computeInspectorGroupsFromStore(store, {
      groupMode: "by_variable",
      groupBy: "model_class",
      rangeConfig: null,
      topKConfig: null,
      expressionConfig: null,
    }).map((group) => [group.label, group.chain_ids])).toEqual([
      ["RandomForest", ["rf", "missing"]],
      ["PLSRegression", ["pls"]],
    ]);
  });
});
