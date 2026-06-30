import { describe, expect, it } from "vitest";
import {
  buildEffectivePredictionMetricContext,
  getInitialPredictionMetricTaskFilter,
  resolvePredictionPrimaryMetricKey,
  selectPredictionQuickView,
} from "@/lib/predictions/pageData";
import type { PredictionRecord } from "@/types/linked-workspaces";
import type { ScoreCardRow } from "@/types/score-cards";

function row(overrides: Partial<ScoreCardRow>): ScoreCardRow {
  return {
    id: "row-1",
    chainId: "chain-1",
    modelName: "PLS",
    modelClass: "PLSRegression",
    preprocessings: null,
    bestParams: null,
    cardType: "refit",
    metric: "rmse",
    testScores: {},
    valScores: {},
    trainScores: {},
    primaryTestScore: null,
    primaryValScore: null,
    primaryTrainScore: null,
    hasRefitArtifact: false,
    ...overrides,
  };
}

function prediction(overrides: Partial<PredictionRecord>): PredictionRecord {
  return {
    id: "prediction-1",
    source_dataset: "dataset-a",
    source_file: "",
    dataset_name: "Dataset A",
    pipeline_uid: "pipeline-1",
    model_name: "PLS",
    partition: "test",
    ...overrides,
  };
}

describe("predictions page data helpers", () => {
  it("initializes the metric task filter only for classification-only rows", () => {
    expect(getInitialPredictionMetricTaskFilter([
      row({ taskType: "classification" }),
      row({ taskType: "binary_classification" }),
    ])).toBe("classification");

    expect(getInitialPredictionMetricTaskFilter([
      row({ taskType: "classification" }),
      row({ taskType: "regression" }),
    ])).toBeNull();

    expect(getInitialPredictionMetricTaskFilter([])).toBeNull();
  });

  it("filters the metric context to the active metric task filter", () => {
    expect(buildEffectivePredictionMetricContext({
      taskType: null,
      taskTypes: ["regression", "classification"],
      availableMetricKeys: ["rmse", "r2", "accuracy", "f1_macro"],
    }, "regression")).toEqual({
      taskType: "regression",
      taskTypes: ["regression"],
      availableMetricKeys: ["r2", "rmse"],
    });

    expect(buildEffectivePredictionMetricContext({
      taskType: null,
      taskTypes: ["regression", "classification"],
      availableMetricKeys: ["rmse", "accuracy", "f1"],
    }, "classification")).toEqual({
      taskType: "classification",
      taskTypes: ["classification"],
      availableMetricKeys: ["accuracy", "f1"],
    });
  });

  it("resolves the primary metric key from rows, selection, or task fallback", () => {
    expect(resolvePredictionPrimaryMetricKey({
      effectiveMetricTaskType: "regression",
      filteredRows: [row({ metric: "RMSE" })],
      selectedMetrics: ["r2"],
    })).toBe("rmse");

    expect(resolvePredictionPrimaryMetricKey({
      effectiveMetricTaskType: "regression",
      filteredRows: [],
      selectedMetrics: ["r2"],
    })).toBe("r2");

    expect(resolvePredictionPrimaryMetricKey({
      effectiveMetricTaskType: "classification",
      filteredRows: [],
      selectedMetrics: [],
    })).toBe("accuracy");
  });

  it("selects quick-view siblings and prefers test then validation records", () => {
    const train = prediction({ id: "train", partition: "train" });
    const val = prediction({ id: "val", partition: "val" });
    const test = prediction({ id: "test", partition: "test" });
    const other = prediction({ id: "other", pipeline_uid: "pipeline-2", partition: "test" });

    expect(selectPredictionQuickView("train", [train, val, test, other])).toEqual({
      initialKind: "scatter",
      primary: test,
      siblings: [train, val, test],
    });

    expect(selectPredictionQuickView("missing", [train])).toBeNull();
  });
});
