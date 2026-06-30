import { describe, expect, it } from "vitest";
import {
  buildCvMetricRows,
  buildFoldGroups,
  buildPipelineTreeWithParams,
  formatBranchPath,
  parseRecord,
  resolveInitialFoldId,
  resolvePrimaryCvMetric,
  residualSummary,
  summarize,
} from "./chainDetailData";
import type { PartitionPrediction } from "@/types/aggregated-predictions";

function predictionRow(overrides: Partial<PartitionPrediction>): PartitionPrediction {
  return {
    prediction_id: "pred",
    pipeline_id: "pipe",
    chain_id: "chain",
    dataset_name: "dataset",
    model_name: "model",
    model_class: "Model",
    fold_id: "0",
    partition: "test",
    val_score: null,
    test_score: null,
    train_score: null,
    scores: null,
    best_params: null,
    metric: "rmse",
    task_type: "regression",
    n_samples: null,
    n_features: null,
    preprocessings: null,
    ...overrides,
  };
}

describe("chainDetailData", () => {
  it("groups folds with refit and aggregate folds first, preserving partition order", () => {
    const groups = buildFoldGroups([
      predictionRow({ prediction_id: "fold-train", fold_id: "2", partition: "train" }),
      predictionRow({ prediction_id: "final-test", fold_id: "final", partition: "test" }),
      predictionRow({ prediction_id: "fold-val", fold_id: "2", partition: "val" }),
      predictionRow({ prediction_id: "avg-test", fold_id: "avg", partition: "test" }),
      predictionRow({ prediction_id: "fold-test", fold_id: "2", partition: "test" }),
    ]);

    expect(groups.map((group) => group.foldId)).toEqual(["final", "avg", "2"]);
    expect(groups[0]).toMatchObject({ kind: "refit", representative: expect.objectContaining({ prediction_id: "final-test" }) });
    expect(groups[2].rows.map((row) => row.partition)).toEqual(["val", "test", "train"]);
  });

  it("resolves the initial fold from focus, refit score, then CV average fallback", () => {
    const rows = [
      predictionRow({ prediction_id: "avg", fold_id: "avg", partition: "test" }),
      predictionRow({ prediction_id: "final", fold_id: "final", partition: "test" }),
      predictionRow({ prediction_id: "fold-1", fold_id: "1", partition: "test" }),
    ];

    expect(resolveInitialFoldId(rows, { predictionId: "fold-1" }, { final_test_score: 0.4 })).toBe("1");
    expect(resolveInitialFoldId(rows, { foldId: "final" }, { final_test_score: null })).toBe("final");
    expect(resolveInitialFoldId(rows, undefined, { final_test_score: 0.4 })).toBe("final");
    expect(resolveInitialFoldId(rows.slice(0, 1), undefined, { final_test_score: null })).toBe("avg");
  });

  it("normalizes CV metric rows and resolves the primary metric", () => {
    const rows = buildCvMetricRows(
      {
        val: { rmse: 0.2, mae: 0.1 },
        test: { RMSE: 0.3, mae: 0.15 },
        train: { rmse: 0.18 },
      },
      "rmse",
    );

    expect(rows[0]).toEqual({
      metric: "rmse",
      values: { val: 0.2, test: 0.3, train: 0.18 },
    });
    expect(rows.find((row) => row.metric === "mae")?.values).toEqual({
      val: 0.1,
      test: 0.15,
      train: null,
    });
    expect(resolvePrimaryCvMetric("rmse", rows)).toBe("rmse");
    expect(resolvePrimaryCvMetric(null, rows)).toBe("rmse");
  });

  it("builds a limited pipeline tree with params, branches, model kind, and generator flags", () => {
    const tree = buildPipelineTreeWithParams([
      {
        id: "choice",
        type: "branch",
        name: "Choice",
        params: { mode: "either", empty: "" },
        branches: [
          [{ id: "prep", type: "preprocessing", displayName: "MSC", params: { window: 5 } }],
          [{ id: "model", type: "model", name: "PLS", generator: { values: [1, 2] } }],
        ],
      },
    ], 10);

    expect(tree.total).toBe(3);
    expect(tree.nodes.map((node) => [node.id, node.kind, node.depth])).toEqual([
      ["choice", "branch", 0],
      ["prep", "step", 1],
      ["model", "model", 1],
    ]);
    expect(tree.nodes[0].params).toEqual([["mode", "either"]]);
    expect(tree.nodes[2].hasGenerator).toBe(true);
  });

  it("parses records and summarizes vectors defensively", () => {
    expect(parseRecord('{"alpha":1}')).toEqual({ alpha: 1 });
    expect(parseRecord("not-json")).toBeNull();
    expect(formatBranchPath(["a", "b", 2])).toBe("a -> b -> 2");
    expect(summarize([1, 3, 5])).toEqual({ min: 1, max: 5, mean: 3 });
    expect(residualSummary([3, 4], [1, 1])).toEqual({ mean: 2.5, sigma: 0.5 });
  });
});
