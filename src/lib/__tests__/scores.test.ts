import { describe, expect, it } from "vitest";

import {
  ALL_CLASSIFICATION_METRICS,
  ALL_REGRESSION_METRICS,
  collectPresentMetricKeys,
  DEFAULT_DATASET_ITEM_CLASSIFICATION_METRICS,
  DEFAULT_DATASET_ITEM_REGRESSION_METRICS,
  filterMetricsForTaskType,
  getAvailableMetricKeysForTaskTypes,
  getDefaultSelectedMetricsForTaskTypes,
  getDefaultSelectionUpgradeCandidatesForTaskTypes,
  getBestCvEntry,
  getBestFinalEntry,
  getMetricDefinitions,
  getPrimaryContextMetricLabel,
  groupMetricDefinitions,
  orderMetricKeys,
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

  it("uses the requested classification defaults for dataset-item selections", () => {
    expect(DEFAULT_DATASET_ITEM_CLASSIFICATION_METRICS).toEqual([
      "accuracy",
      "balanced_accuracy",
      "precision",
      "recall",
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

  it("orders mixed metric selections by catalog groups", () => {
    expect(orderMetricKeys([
      "balanced_accuracy",
      "r2",
      "precision",
      "rmse",
      "accuracy",
    ])).toEqual([
      "r2",
      "rmse",
      "accuracy",
      "balanced_accuracy",
      "precision",
    ]);
  });

  it("builds metric definitions from explicit keys across task types", () => {
    expect(getMetricDefinitions(["f1", "rmse", "accuracy"]).map(metric => metric.key)).toEqual([
      "rmse",
      "accuracy",
      "f1",
    ]);
  });

  it("builds mixed defaults from the union of regression and classification defaults", () => {
    expect(getDefaultSelectedMetricsForTaskTypes([
      "regression",
      "binary_classification",
    ])).toEqual([
      "r2",
      "rmse",
      "sep",
      "rpd",
      "nrmse",
      "pearson_r",
      "accuracy",
      "balanced_accuracy",
      "precision",
      "recall",
    ]);
  });

  it("exposes the full metric catalog for mixed task types", () => {
    expect(getAvailableMetricKeysForTaskTypes([
      "regression",
      "binary_classification",
    ])).toEqual([
      ...ALL_REGRESSION_METRICS.map(metric => metric.key),
      ...ALL_CLASSIFICATION_METRICS.map(metric => metric.key),
    ]);
  });

  it("exposes regression-only and classification-only defaults as mixed upgrade candidates", () => {
    expect(getDefaultSelectionUpgradeCandidatesForTaskTypes([
      "regression",
      "binary_classification",
    ])).toEqual([
      ["r2", "rmse", "sep", "rpd", "nrmse", "pearson_r"],
      ["r2", "rmse", "mae", "sep", "rpd", "bias"],
      ["accuracy", "balanced_accuracy", "precision", "recall"],
      ["accuracy", "balanced_accuracy", "f1", "roc_auc"],
    ]);
  });

  it("filters a mixed selection down to the metrics relevant for classification rows", () => {
    expect(filterMetricsForTaskType([
      "rmse",
      "r2",
      "accuracy",
      "balanced_accuracy",
      "precision",
    ], "binary_classification")).toEqual([
      "accuracy",
      "balanced_accuracy",
      "precision",
    ]);
  });

  it("groups metric definitions as general, regression, classification", () => {
    expect(groupMetricDefinitions([
      "precision",
      "rmse",
      "accuracy",
    ])).toEqual([
      {
        group: "regression",
        label: "Regression",
        metrics: [getMetricDefinitions(["rmse"])[0]],
      },
      {
        group: "classification",
        label: "Classification",
        metrics: getMetricDefinitions(["accuracy", "precision"]),
      },
    ]);
  });

  it("uses prediction-style labels for classification refit metrics", () => {
    expect(getPrimaryContextMetricLabel("balanced_accuracy", "refit", "classification")).toBe("BAccP");
    expect(getPrimaryContextMetricLabel("accuracy", "refit", "classification")).toBe("AccP");
  });

  it("keeps regression refit and cv naming conventions", () => {
    expect(getPrimaryContextMetricLabel("rmse", "refit", "regression")).toBe("RMSEP");
    expect(getPrimaryContextMetricLabel("rmse", "crossval", "regression")).toBe("RMSECV");
  });
});
