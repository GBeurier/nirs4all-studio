import { describe, expect, it } from "vitest";

import { metricMap, scoreForPartition } from "./chainDetailScoreUtils";
import type { PartitionPrediction } from "@/types/aggregated-predictions";

function predictionRow(overrides: Partial<PartitionPrediction> = {}): PartitionPrediction {
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

describe("chainDetailScoreUtils", () => {
  it("resolves scalar scores by partition", () => {
    const row = predictionRow({
      val_score: 0.1,
      test_score: 0.2,
      train_score: 0.3,
    });

    expect(scoreForPartition(row, "val")).toBe(0.1);
    expect(scoreForPartition(row, "test")).toBe(0.2);
    expect(scoreForPartition(row, "train")).toBe(0.3);
  });

  it("builds metric maps from the shared prediction score projection", () => {
    expect(metricMap(predictionRow({
      partition: "test",
      test_score: 0.24,
      scores: {
        test: { mae: 0.1, rmse: "0.2", skipped: "n/a" },
      } as unknown as PartitionPrediction["scores"],
    }))).toEqual([
      ["rmse", 0.2],
      ["mae", 0.1],
    ]);

    expect(metricMap(predictionRow({
      partition: "val",
      metric: "r2",
      val_score: 0.91,
      scores: {
        rmse: "0.3",
        metadata: { ignored: true },
      } as unknown as PartitionPrediction["scores"],
    }))).toEqual([
      ["r2", 0.91],
      ["rmse", 0.3],
    ]);
  });
});
