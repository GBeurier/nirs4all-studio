import { describe, expect, it } from "vitest";

import type {
  PartitionPrediction,
  PredictionArraysResponse,
} from "@/types/aggregated-predictions";

import {
  buildConfusionMatrixData,
  buildConfusionMatrixFromVectors,
  formatPartitionLabel,
  isClassificationTask,
  sortPartitions,
} from "./modelDetailClassification";

describe("modelDetailClassification", () => {
  it("detects classification task variants", () => {
    expect(isClassificationTask("classification")).toBe(true);
    expect(isClassificationTask("binary_classification")).toBe(true);
    expect(isClassificationTask("multiclass_classification")).toBe(true);
    expect(isClassificationTask("regression")).toBe(false);
    expect(isClassificationTask(null)).toBe(false);
  });

  it("sorts and formats partitions predictably", () => {
    expect(sortPartitions(["test", "train", "val"])).toEqual(["train", "val", "test"]);
    expect(formatPartitionLabel(["test", "train"])).toBe("train + test");
  });

  it("builds confusion-matrix counts from fold arrays", () => {
    const rows = [
      {
        prediction_id: "pred-train",
        partition: "train",
      },
      {
        prediction_id: "pred-test",
        partition: "test",
      },
    ] as PartitionPrediction[];

    const arraysByPredictionId = {
      "pred-train": {
        prediction_id: "pred-train",
        y_true: [0, 0, 1],
        y_pred: [0, 1, 1],
        y_proba: null,
        sample_indices: null,
        weights: null,
        n_samples: 3,
      },
      "pred-test": {
        prediction_id: "pred-test",
        y_true: [1, 2],
        y_pred: [2, 2],
        y_proba: null,
        sample_indices: null,
        weights: null,
        n_samples: 2,
      },
    } satisfies Record<string, PredictionArraysResponse>;

    const result = buildConfusionMatrixData({
      rows,
      arraysByPredictionId,
      activePartitions: new Set(["train", "test"]),
      normalize: "none",
      partitionLabel: "train + test",
    });

    expect(result.labels).toEqual(["0", "1", "2"]);
    expect(result.total_samples).toBe(5);
    expect(result.cells.find((cell) => cell.true_label === "0" && cell.pred_label === "0")?.count).toBe(1);
    expect(result.cells.find((cell) => cell.true_label === "0" && cell.pred_label === "1")?.count).toBe(1);
    expect(result.cells.find((cell) => cell.true_label === "1" && cell.pred_label === "1")?.count).toBe(1);
    expect(result.cells.find((cell) => cell.true_label === "1" && cell.pred_label === "2")?.count).toBe(1);
    expect(result.cells.find((cell) => cell.true_label === "2" && cell.pred_label === "2")?.count).toBe(1);
  });

  it("supports row normalization", () => {
    const rows = [
      {
        prediction_id: "pred-001",
        partition: "test",
      },
    ] as PartitionPrediction[];

    const arraysByPredictionId = {
      "pred-001": {
        prediction_id: "pred-001",
        y_true: [0, 0, 1, 1],
        y_pred: [0, 1, 1, 1],
        y_proba: null,
        sample_indices: null,
        weights: null,
        n_samples: 4,
      },
    } satisfies Record<string, PredictionArraysResponse>;

    const result = buildConfusionMatrixData({
      rows,
      arraysByPredictionId,
      activePartitions: new Set(["test"]),
      normalize: "row",
      partitionLabel: "test",
    });

    expect(result.cells.find((cell) => cell.true_label === "0" && cell.pred_label === "0")?.normalized).toBe(0.5);
    expect(result.cells.find((cell) => cell.true_label === "0" && cell.pred_label === "1")?.normalized).toBe(0.5);
    expect(result.cells.find((cell) => cell.true_label === "1" && cell.pred_label === "1")?.normalized).toBe(1);
  });

  it("builds confusion data directly from paired vectors", () => {
    const result = buildConfusionMatrixFromVectors({
      yTrue: [1, 1, 2, 3],
      yPred: [1, 2, 2, 3],
      normalize: "none",
      partitionLabel: "test",
    });

    expect(result.labels).toEqual(["1", "2", "3"]);
    expect(result.total_samples).toBe(4);
    expect(result.cells.find((cell) => cell.true_label === "1" && cell.pred_label === "1")?.count).toBe(1);
    expect(result.cells.find((cell) => cell.true_label === "1" && cell.pred_label === "2")?.count).toBe(1);
    expect(result.cells.find((cell) => cell.true_label === "2" && cell.pred_label === "2")?.count).toBe(1);
    expect(result.cells.find((cell) => cell.true_label === "3" && cell.pred_label === "3")?.count).toBe(1);
  });
});
