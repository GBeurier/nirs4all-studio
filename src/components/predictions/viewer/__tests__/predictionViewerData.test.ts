import { describe, expect, it } from "vitest";

import {
  buildPredictionViewerBaseFilename,
  buildPredictionViewerCsvExport,
  buildPredictionViewerHeaderDescription,
  buildPredictionViewerHeaderTitle,
  getPredictionViewerAvailableKinds,
  getPredictionViewerDistributionSeries,
  getPredictionViewerTaskKind,
  resolvePredictionViewerInitialKind,
  shouldShowPredictionColorLegend,
} from "../predictionViewerData";
import type { PartitionDataset, ViewerHeader } from "../types";

function dataset(overrides: Partial<PartitionDataset> = {}): PartitionDataset {
  return {
    predictionId: "pred-1",
    partition: "test",
    label: "Test",
    yTrue: [1, 2, 3],
    yPred: [1.2, 1.5, 2.5],
    nSamples: 3,
    ...overrides,
  };
}

const header: ViewerHeader = {
  datasetName: "corn dataset",
  modelName: "PLS / tuned",
  taskType: "regression",
};

describe("predictionViewerData", () => {
  it("derives task kind, available chart kinds, and initial chart kind", () => {
    expect(getPredictionViewerTaskKind("classification")).toBe("classification");
    expect(getPredictionViewerTaskKind("regression")).toBe("regression");
    expect(getPredictionViewerAvailableKinds("classification")).toEqual(["confusion", "distribution"]);
    expect(getPredictionViewerAvailableKinds("regression")).toEqual(["scatter", "residuals", "distribution"]);
    expect(resolvePredictionViewerInitialKind("residuals", "regression")).toBe("residuals");
    expect(resolvePredictionViewerInitialKind("scatter", "classification")).toBe("confusion");
    expect(resolvePredictionViewerInitialKind(undefined, "regression")).toBe("scatter");
  });

  it("builds header copy and sanitized export filenames", () => {
    expect(buildPredictionViewerHeaderTitle(header)).toBe("PLS / tuned · corn dataset");
    expect(buildPredictionViewerHeaderDescription(header)).toBe(
      "Inspect prediction charts for dataset corn dataset, model PLS / tuned, regression task.",
    );
    expect(buildPredictionViewerBaseFilename(header, "scatter")).toBe("corn_dataset_PLS_tuned_scatter");
  });

  it("builds pooled confusion matrix CSV rows", () => {
    const csvExport = buildPredictionViewerCsvExport("confusion", [
      dataset({ yTrue: [0, 0, 1], yPred: [0, 1, 1] }),
      dataset({ yTrue: [0], yPred: [0] }),
    ], { histogramSeries: "both" });

    expect(csvExport).toEqual({
      columns: ["true_label", "pred_label", "count"],
      rows: [
        { true_label: "0", pred_label: "0", count: 2 },
        { true_label: "0", pred_label: "1", count: 1 },
        { true_label: "1", pred_label: "1", count: 1 },
      ],
    });
  });

  it("builds distribution CSV rows for selected histogram series", () => {
    expect(getPredictionViewerDistributionSeries("both")).toEqual(["actual", "predicted"]);
    expect(getPredictionViewerDistributionSeries("residuals")).toEqual(["residual"]);

    const csvExport = buildPredictionViewerCsvExport("distribution", [
      dataset({ yTrue: [1, Number.NaN, 3], yPred: [1.5, 2, 2.25] }),
    ], { histogramSeries: "residuals" });

    expect(csvExport).toEqual({
      columns: ["sample_id", "partition", "series", "value"],
      rows: [
        { sample_id: 0, partition: "Test", series: "residual", value: -0.5 },
        { sample_id: 2, partition: "Test", series: "residual", value: 0.75 },
      ],
    });
  });

  it("builds scatter and residual CSV rows", () => {
    const csvExport = buildPredictionViewerCsvExport("scatter", [
      dataset({ yTrue: [1, 2], yPred: [1.25, 1.75] }),
    ], { histogramSeries: "both" });

    expect(csvExport).toEqual({
      columns: ["sample_id", "partition", "y_true", "y_pred", "residual"],
      rows: [
        { sample_id: 0, partition: "Test", y_true: 1, y_pred: 1.25, residual: -0.25 },
        { sample_id: 1, partition: "Test", y_true: 2, y_pred: 1.75, residual: 0.25 },
      ],
    });
    expect(buildPredictionViewerCsvExport("scatter", [], { histogramSeries: "both" })).toBeNull();
  });

  it("decides when the color legend is visible", () => {
    expect(shouldShowPredictionColorLegend({
      colorMode: "partition",
      datasetCount: 2,
      kind: "scatter",
    })).toBe(true);
    expect(shouldShowPredictionColorLegend({
      colorMode: "metadata",
      datasetCount: 2,
      kind: "distribution",
      metadataKey: "batch",
    })).toBe(true);
    expect(shouldShowPredictionColorLegend({
      colorMode: "metadata",
      datasetCount: 2,
      kind: "distribution",
    })).toBe(false);
    expect(shouldShowPredictionColorLegend({
      colorMode: "partition",
      datasetCount: 0,
      kind: "scatter",
    })).toBe(false);
    expect(shouldShowPredictionColorLegend({
      colorMode: "partition",
      datasetCount: 2,
      kind: "confusion",
    })).toBe(false);
  });
});
