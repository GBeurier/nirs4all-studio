import { describe, expect, it } from "vitest";

import {
  collectPresentMetricKeys,
  DEFAULT_DATASET_ITEM_REGRESSION_METRICS,
  getBestCvEntry,
  getBestFinalEntry,
  getMetricDefinitions,
} from "../scores";

describe("score selection helpers", () => {
  it("picks the lowest final score for lower-is-better metrics", () => {
    const chains = [
      { chain_id: "a", final_test_score: 0.42, avg_val_score: 0.11 },
      { chain_id: "b", final_test_score: 0.18, avg_val_score: 0.27 },
      { chain_id: "c", final_test_score: null, avg_val_score: 0.09 },
    ];

    expect(getBestFinalEntry(chains, "rmse")?.chain_id).toBe("b");
  });

  it("picks the highest CV score for higher-is-better metrics", () => {
    const chains = [
      { chain_id: "a", final_test_score: 0.88, avg_val_score: 0.81 },
      { chain_id: "b", final_test_score: 0.91, avg_val_score: 0.79 },
      { chain_id: "c", final_test_score: null, avg_val_score: 0.93 },
    ];

    expect(getBestCvEntry(chains, "accuracy")?.chain_id).toBe("c");
  });

  it("exposes the requested dataset-item regression default metric order", () => {
    expect(DEFAULT_DATASET_ITEM_REGRESSION_METRICS).toEqual([
      "rmse",
      "r2",
      "nrmse",
      "sep",
      "rpd",
      "pearson_r",
    ]);
  });

  it("keeps only present metric keys and returns them in catalog order", () => {
    expect(collectPresentMetricKeys(
      {
        test: { f1: 0.91, accuracy: 0.93, unknown_metric: 1 },
        train: { balanced_accuracy: "0.95", precision: null },
      },
      { rmse: 0.22, r2: 0.88, max_error: Number.NaN },
    )).toEqual([
      "r2",
      "rmse",
      "accuracy",
      "balanced_accuracy",
      "f1",
    ]);
  });

  it("builds metric definitions from explicit keys across task types", () => {
    expect(getMetricDefinitions(["f1", "rmse", "accuracy"]).map(metric => metric.key)).toEqual([
      "rmse",
      "accuracy",
      "f1",
    ]);
  });
});
