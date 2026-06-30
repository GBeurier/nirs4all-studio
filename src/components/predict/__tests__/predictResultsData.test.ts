import { describe, expect, it } from "vitest";
import {
  buildPredictAvailableKinds,
  buildPredictChartBaseFilename,
  buildPredictChartCsvExport,
  buildPredictFullscreenSubtitleParts,
  buildPredictFullscreenTitle,
  buildPredictMetricCards,
  buildPredictMetricEntries,
  buildPredictPartitionDatasets,
  buildPredictPreprocessingBadges,
  buildPredictReferenceBadge,
  buildPredictStatsCards,
  buildPredictSummaryCards,
  buildPredictTableCsvRows,
  buildPredictTableRows,
  buildPredictTaskBadge,
  buildPredictViewerHeader,
  computePredictStats,
  detectPredictTaskKind,
  formatPredictPartitionLabel,
  getPredictInputLabel,
  getPredictInputSubLabel,
  resolvePredictInputFromDatasetCache,
  resolvePredictDefaultKind,
} from "../predictResultsData";
import type { PredictResponse } from "@/types/predict";

function response(overrides: Partial<PredictResponse> = {}): PredictResponse {
  return {
    predictions: [1.1, 2.2, 3.3],
    num_samples: 3,
    model_name: "PLS tuned",
    preprocessing_steps: [],
    actual_values: [1, 2, 3],
    metrics: { rmse: 0.2, r2: 0.9 },
    sample_ids: ["a", "b", "c"],
    partitions: null,
    ...overrides,
  };
}

describe("predictResultsData", () => {
  it("detects task kind from model metadata, metrics, and data heuristics", () => {
    expect(detectPredictTaskKind({
      actualValues: [0, 1],
      metrics: null,
      model: { id: "m1", name: "PLS", source: "chain", model_class: "PLSRegression", dataset_name: null, metric: null, best_score: null, created_at: null, file_size: null, preprocessing: null, bundle_path: null },
      predictions: [0.1, 0.9],
    })).toBe("regression");

    expect(detectPredictTaskKind({
      actualValues: null,
      metrics: { accuracy: 1 },
      model: null,
      predictions: [0, 1, 1],
    })).toBe("classification");

    expect(detectPredictTaskKind({
      actualValues: [0, 1, 1],
      metrics: null,
      model: null,
      predictions: [0, 1, 1],
    })).toBe("classification");
  });

  it("splits prediction arrays by per-sample partitions in canonical order", () => {
    expect(buildPredictPartitionDatasets({
      fallbackPartition: "test",
      hasActuals: true,
      result: response({
        predictions: [10, 20, 30, 40],
        actual_values: [11, 21, 31, 41],
        sample_ids: ["s-test", "s-train-1", "s-val", "s-train-2"],
        partitions: ["test", "train", "val", "train"],
      }),
    })).toMatchObject([
      { partition: "train", label: "Train", yTrue: [21, 41], yPred: [20, 40], nSamples: 2, sampleIds: ["s-train-1", "s-train-2"] },
      { partition: "val", label: "Val", yTrue: [31], yPred: [30], nSamples: 1, sampleIds: ["s-val"] },
      { partition: "test", label: "Test", yTrue: [11], yPred: [10], nSamples: 1, sampleIds: ["s-test"] },
    ]);
  });

  it("derives available and default chart kinds", () => {
    expect(buildPredictAvailableKinds(false, "regression")).toEqual(["distribution"]);
    expect(buildPredictAvailableKinds(true, "regression")).toEqual(["scatter", "residuals", "distribution"]);
    expect(buildPredictAvailableKinds(true, "classification")).toEqual(["confusion", "distribution"]);
    expect(resolvePredictDefaultKind(["distribution"], "regression", false)).toBe("distribution");
    expect(resolvePredictDefaultKind(["confusion", "distribution"], "classification", true)).toBe("confusion");
    expect(resolvePredictDefaultKind(["scatter", "distribution"], "regression", true)).toBe("scatter");
  });

  it("builds labels, stats, table rows, metric entries, and filenames", () => {
    expect(getPredictInputLabel({ type: "dataset", datasetId: "d1", datasetName: "Corn", partition: "test" }, "fallback")).toBe("Corn");
    expect(getPredictInputSubLabel({ type: "dataset", datasetId: "d1", partition: "all" })).toBe("partition: all");
    expect(formatPredictPartitionLabel("test")).toBe("Test");
    expect(computePredictStats([1, 2, 3, 4])).toMatchObject({
      count: 4,
      mean: 2.5,
      min: 1,
      q1: 2,
      median: 2.5,
      q3: 4,
      max: 4,
    });
    const tableRows = buildPredictTableRows(response(), true);
    expect(tableRows[0]).toEqual({
      index: "a",
      partition: null,
      predicted: 1.1,
      actual: 1,
      residual: -0.10000000000000009,
    });
    expect(buildPredictTableCsvRows(tableRows)[0]).toEqual({
      sample: "a",
      predicted: 1.1,
      actual: 1,
      residual: -0.10000000000000009,
    });
    expect(buildPredictMetricEntries({ custom: 3, r2: 0.8, rmse: 0.2 })).toEqual([
      { key: "rmse", value: 0.2 },
      { key: "r2", value: 0.8 },
      { key: "custom", value: 3 },
    ]);
    expect(buildPredictChartBaseFilename("Corn dataset", "PLS / tuned", "scatter")).toBe("Corn_dataset_PLS_tuned_scatter");
  });

  it("resolves dataset input labels from the datasets cache", () => {
    const namedInput = { type: "dataset" as const, datasetId: "d1", datasetName: "Existing", partition: "test" };
    const fileInput = { type: "file" as const, fileName: "spectra.csv" };

    expect(resolvePredictInputFromDatasetCache(null, [{ id: "d1", name: "Corn" }])).toBeNull();
    expect(resolvePredictInputFromDatasetCache(fileInput, [{ id: "d1", name: "Corn" }])).toBe(fileInput);
    expect(resolvePredictInputFromDatasetCache(namedInput, [{ id: "d1", name: "Corn" }])).toBe(namedInput);
    expect(resolvePredictInputFromDatasetCache(
      { type: "dataset", datasetId: "d1", partition: "test" },
      [{ id: "d1", name: "Corn" }],
    )).toEqual({ type: "dataset", datasetId: "d1", datasetName: "Corn", partition: "test" });
    expect(resolvePredictInputFromDatasetCache(
      { type: "dataset", datasetId: "missing", partition: "test" },
      [{ id: "d1", name: "Corn" }],
    )).toEqual({ type: "dataset", datasetId: "missing", datasetName: "missing", partition: "test" });
  });

  it("builds predict results header badges and card read models", () => {
    expect(buildPredictViewerHeader({
      displayName: "Corn",
      result: response({
        model_name: "Classifier",
        num_samples: 5,
        preprocessing_steps: ["SNV", "Smooth"],
      }),
      taskKind: "classification",
    })).toEqual({
      datasetName: "Corn",
      modelName: "Classifier",
      preprocessings: "SNV · Smooth",
      taskType: "classification",
      nSamples: 5,
    });

    expect(buildPredictTaskBadge("classification")).toMatchObject({ label: "Classification" });
    expect(buildPredictTaskBadge("classification").className).toContain("border-violet-500/40");
    expect(buildPredictReferenceBadge(false)).toMatchObject({ label: "No reference values" });
    expect(buildPredictReferenceBadge(false).className).toContain("border-amber-500/40");

    expect(buildPredictSummaryCards({
      hasActuals: false,
      numSamples: 3,
      partitionCount: 2,
      summaryMetric: { key: "rmse", value: 0.2 },
    })).toEqual([
      { key: "samples", label: "Samples", value: "3", description: "2 partitions" },
      {
        key: "reference",
        label: "Reference",
        value: "Missing",
        description: "Upload data with targets for scatter / residuals / confusion",
      },
      {
        key: "metric",
        label: "Prediction: RMSEP",
        value: "0.200",
        description: "Primary metric for this prediction",
      },
    ]);

    expect(buildPredictMetricCards([{ key: "r2", value: 0.81234 }])).toEqual([
      { key: "r2", label: "R²", value: "0.8123" },
    ]);
    const statsCards = buildPredictStatsCards(computePredictStats([1, 2, 3])!);
    expect(statsCards.slice(0, 3)).toEqual([
      { label: "N", value: "3" },
      { label: "Mean", value: "2.0000" },
      { label: "Std", value: "0.8165" },
    ]);
    expect(buildPredictPreprocessingBadges(["SNV", "Smooth"])).toEqual([
      { key: "SNV", label: "SNV" },
      { key: "Smooth", label: "Smooth" },
    ]);
    expect(buildPredictFullscreenTitle({ modelName: "PLS", displayName: "Corn" })).toBe("PLS · Corn");
    expect(buildPredictFullscreenTitle({ modelName: "PLS", displayName: "" })).toBe("PLS");
    expect(buildPredictFullscreenSubtitleParts({
      displaySubLabel: "partition: test",
      nSamples: 3,
      preprocessings: "SNV · Smooth",
    })).toEqual(["3 samples", "partition: test", "SNV · Smooth"]);
  });

  it("builds regression distribution chart CSV exports", () => {
    expect(buildPredictChartCsvExport({
      hasActuals: false,
      kind: "distribution",
      partitionDatasets: [],
      predictions: [1.1, 2.2],
      sampleIds: ["s1", "s2"],
      taskKind: "regression",
    })).toEqual({
      columns: ["sample_id", "y_pred"],
      rows: [
        { sample_id: "s1", y_pred: 1.1 },
        { sample_id: "s2", y_pred: 2.2 },
      ],
    });
  });

  it("builds classification distribution and confusion chart CSV exports", () => {
    const partitions = buildPredictPartitionDatasets({
      fallbackPartition: "test",
      hasActuals: true,
      result: response({
        predictions: [0, 1, 1],
        actual_values: [0, 0, 1],
        sample_ids: ["c1", "c2", "c3"],
      }),
    });

    expect(buildPredictChartCsvExport({
      hasActuals: true,
      kind: "distribution",
      partitionDatasets: partitions,
      predictions: [],
      sampleIds: null,
      taskKind: "classification",
    })).toEqual({
      columns: ["sample_id", "partition", "y_true", "y_pred"],
      rows: [
        { sample_id: "c1", partition: "Test", y_pred: 0, y_true: 0 },
        { sample_id: "c2", partition: "Test", y_pred: 1, y_true: 0 },
        { sample_id: "c3", partition: "Test", y_pred: 1, y_true: 1 },
      ],
    });

    expect(buildPredictChartCsvExport({
      hasActuals: true,
      kind: "confusion",
      partitionDatasets: partitions,
      predictions: [],
      sampleIds: null,
      taskKind: "classification",
    })).toEqual({
      columns: ["true_label", "pred_label", "count"],
      rows: [
        { true_label: "0", pred_label: "0", count: 1 },
        { true_label: "0", pred_label: "1", count: 1 },
        { true_label: "1", pred_label: "1", count: 1 },
      ],
    });
  });

  it("builds scatter and residual chart CSV exports", () => {
    const partitions = buildPredictPartitionDatasets({
      fallbackPartition: "test",
      hasActuals: true,
      result: response({
        predictions: [1.2, 1.8],
        actual_values: [1, 2],
        sample_ids: ["r1", "r2"],
      }),
    });

    expect(buildPredictChartCsvExport({
      hasActuals: true,
      kind: "scatter",
      partitionDatasets: partitions,
      predictions: [],
      sampleIds: null,
      taskKind: "regression",
    })).toEqual({
      columns: ["sample_id", "partition", "y_true", "y_pred", "residual"],
      rows: [
        { sample_id: "r1", partition: "Test", y_true: 1, y_pred: 1.2, residual: -0.19999999999999996 },
        { sample_id: "r2", partition: "Test", y_true: 2, y_pred: 1.8, residual: 0.19999999999999996 },
      ],
    });
  });
});
