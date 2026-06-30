import { describe, expect, it } from "vitest";

import {
  averagePredictionScoreMaps,
  extractPredictionScoreMap,
  extremePredictionScoreMaps,
  foldVariantId,
  isNumberedFoldId,
  predictionMatchesVariant,
  projectPartitionScoreMaps,
} from "../score-adapters-fold-scores";
import type { PartitionPrediction } from "@/types/aggregated-predictions";

function makePrediction(overrides: Partial<PartitionPrediction>): PartitionPrediction {
  return {
    prediction_id: overrides.prediction_id ?? "pred",
    pipeline_id: overrides.pipeline_id ?? "pipe",
    chain_id: overrides.chain_id ?? "chain",
    dataset_name: overrides.dataset_name ?? "dataset_a",
    model_name: overrides.model_name ?? "PLSRegression",
    model_class: overrides.model_class ?? "PLSRegression",
    fold_id: overrides.fold_id ?? "0",
    partition: overrides.partition ?? "test",
    val_score: overrides.val_score ?? null,
    test_score: overrides.test_score ?? null,
    train_score: overrides.train_score ?? null,
    scores: overrides.scores ?? null,
    best_params: overrides.best_params ?? null,
    metric: overrides.metric ?? "rmse",
    task_type: overrides.task_type ?? "regression",
    n_samples: overrides.n_samples ?? 10,
    n_features: overrides.n_features ?? 3,
    preprocessings: overrides.preprocessings ?? "SNV",
  };
}

describe("score adapter fold score helpers", () => {
  it("projects nested partition score maps while preserving null coercions", () => {
    expect(projectPartitionScoreMaps({
      test: { rmse: "0.2", skipped: "n/a" },
      val: { r2: 0.91 },
    })).toEqual({
      testScores: { rmse: 0.2, skipped: null },
      valScores: { r2: 0.91 },
      trainScores: {},
    });
  });

  it("assigns flat score maps to the active partition and drops non-numeric fallback values", () => {
    expect(projectPartitionScoreMaps({
      rmse: "0.3",
      metadata: { ignored: true },
      skipped: "n/a",
    }, "val")).toEqual({
      testScores: {},
      valScores: { rmse: 0.3 },
      trainScores: {},
    });
  });

  it("extracts the active partition from nested score maps without dropping custom metrics", () => {
    const row = extractPredictionScoreMap(makePrediction({
      partition: "test",
      test_score: 0.24,
      scores: {
        test: { rmse: "0.2", target_a_rmse: 0.31, skipped: "n/a" },
        val: { rmse: 0.4 },
      } as unknown as PartitionPrediction["scores"],
    }));

    expect(row).toEqual({ rmse: 0.2, target_a_rmse: 0.31 });
  });

  it("adds the primary metric fallback when flat score maps omit it", () => {
    const row = extractPredictionScoreMap(makePrediction({
      partition: "val",
      metric: " R2 ",
      val_score: 0.91,
      scores: {
        rmse: "0.3",
        metadata: { ignored: true },
      } as unknown as PartitionPrediction["scores"],
    }));

    expect(row).toEqual({ rmse: 0.3, r2: 0.91 });
  });

  it("averages and finds extrema per metric across sparse prediction maps", () => {
    const predictions = [
      makePrediction({
        test_score: 0.2,
        scores: { test: { rmse: 0.2, r2: 0.92 } } as unknown as PartitionPrediction["scores"],
      }),
      makePrediction({
        test_score: 0.4,
        scores: { test: { rmse: 0.4, target_b_rmse: 0.7 } } as unknown as PartitionPrediction["scores"],
      }),
      makePrediction({
        metric: "rmse",
        test_score: null,
        scores: { test: { rmse: "n/a", r2: 0.88 } } as unknown as PartitionPrediction["scores"],
      }),
    ];

    expect(averagePredictionScoreMaps(predictions)).toEqual({
      rmse: 0.30000000000000004,
      r2: 0.9,
      target_b_rmse: 0.7,
    });
    expect(extremePredictionScoreMaps(predictions, "min")).toEqual({
      rmse: 0.2,
      r2: 0.88,
      target_b_rmse: 0.7,
    });
    expect(extremePredictionScoreMaps(predictions, "max")).toEqual({
      rmse: 0.4,
      r2: 0.92,
      target_b_rmse: 0.7,
    });
  });

  it("keeps raw and aggregated fold variants separated", () => {
    expect(foldVariantId("avg", "raw")).toBe("avg");
    expect(foldVariantId("avg", "aggregated")).toBe("avg_agg");

    expect(predictionMatchesVariant(makePrediction({ fold_id: "0" }), "raw")).toBe(true);
    expect(predictionMatchesVariant(makePrediction({ fold_id: "0_agg" }), "raw")).toBe(false);
    expect(predictionMatchesVariant(makePrediction({ fold_id: "0_agg" }), "aggregated")).toBe(true);
  });

  it("recognizes drill-down fold ids while excluding summary and aggregated ids", () => {
    expect(isNumberedFoldId("0")).toBe(true);
    expect(isNumberedFoldId("12")).toBe(true);
    expect(isNumberedFoldId("avg")).toBe(false);
    expect(isNumberedFoldId("w_avg")).toBe(false);
    expect(isNumberedFoldId("final")).toBe(false);
    expect(isNumberedFoldId("0_agg")).toBe(false);
  });
});
