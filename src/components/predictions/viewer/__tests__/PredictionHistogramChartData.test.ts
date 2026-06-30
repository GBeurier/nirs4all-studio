import { describe, expect, it } from "vitest";

import {
  buildPredictionHistogramRenderModel,
  detectPredictionHistogramTaskKind,
  formatPredictionHistogramTooltipValue,
  getPredictionHistogramActiveVariants,
  getPredictionHistogramTooltipTitle,
  getPredictionHistogramXAxisLabel,
  getPredictionHistogramYAxisLabel,
  resolvePredictionHistogramSeries,
} from "../charts/PredictionHistogramChartData";
import { DEFAULT_CHART_CONFIG, type ChartConfig, type PartitionDataset } from "../types";

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

function chartConfig(overrides: Partial<ChartConfig> = {}): ChartConfig {
  const { partitionColors, ...rest } = overrides;
  return {
    ...DEFAULT_CHART_CONFIG,
    ...rest,
    partitionColors: {
      ...DEFAULT_CHART_CONFIG.partitionColors,
      ...(partitionColors ?? {}),
    },
  };
}

describe("PredictionHistogramChartData", () => {
  it("detects task kind and resolves active histogram series", () => {
    expect(detectPredictionHistogramTaskKind([
      dataset({ yTrue: [0, 1, 2], yPred: [0, 1, 1] }),
    ], true)).toBe("classification");
    expect(detectPredictionHistogramTaskKind([
      dataset({ yTrue: [0.25, 1, 2], yPred: [0, 1, 1] }),
    ], true)).toBe("regression");
    expect(detectPredictionHistogramTaskKind([
      dataset({ yTrue: [0.25], yPred: [0, 1, 1] }),
    ], false)).toBe("classification");

    expect(resolvePredictionHistogramSeries("both", false)).toBe("predicted");
    expect(resolvePredictionHistogramSeries("actual", false)).toBe("predicted");
    expect(resolvePredictionHistogramSeries("residuals", false)).toBe("predicted");
    expect(resolvePredictionHistogramSeries("both", true)).toBe("both");
    expect(getPredictionHistogramActiveVariants("both")).toEqual(["actual", "predicted"]);
    expect(getPredictionHistogramActiveVariants("residuals")).toEqual(["residual"]);
  });

  it("falls back to predicted-only rows when actuals are unavailable", () => {
    const model = buildPredictionHistogramRenderModel({
      datasets: [
        dataset({
          yTrue: [],
          yPred: [2, 1, 2],
          nSamples: 3,
        }),
      ],
      config: chartConfig({ histogramSeries: "residuals" }),
      hasActuals: false,
    });

    expect(model.actualsAvailable).toBe(false);
    expect(model.effectiveSeries).toBe("predicted");
    expect(model.activeVariants).toEqual(["predicted"]);
    expect(model.taskKind).toBe("classification");
    expect(model.classLabels).toEqual(["1", "2"]);
    expect(model.emptyMessage).toBe("No predictions to visualize.");
    expect(model.rows.map((row) => row["part:pred-1:test:predicted"])).toEqual([1, 2]);
  });

  it("builds partition grouped regression histogram rows", () => {
    const model = buildPredictionHistogramRenderModel({
      datasets: [
        dataset({
          predictionId: "train-pred",
          partition: "train",
          label: "Train",
          yTrue: [],
          yPred: [0, 1],
          nSamples: 2,
        }),
        dataset({
          predictionId: "test-pred",
          partition: "test",
          label: "Test",
          yTrue: [],
          yPred: [2, 3],
          nSamples: 2,
        }),
      ],
      config: chartConfig({
        histogramSeries: "predicted",
        histogramBinCount: 2,
      }),
      taskKind: "regression",
      hasActuals: false,
    });

    expect(model.groups.map((group) => [group.key, group.label])).toEqual([
      ["part:train-pred:train", "Train"],
      ["part:test-pred:test", "Test"],
    ]);
    expect(model.barEntries.map((entry) => entry.label)).toEqual(["Train", "Test"]);
    expect(model.rows).toHaveLength(2);
    expect(model.rows[0]["part:train-pred:train:predicted"]).toBe(2);
    expect(model.rows[0]["part:test-pred:test:predicted"]).toBe(0);
    expect(model.rows[1]["part:train-pred:train:predicted"]).toBe(0);
    expect(model.rows[1]["part:test-pred:test:predicted"]).toBe(2);
  });

  it("builds categorical metadata grouped histogram rows", () => {
    const model = buildPredictionHistogramRenderModel({
      datasets: [
        dataset({
          yTrue: [],
          yPred: [0, 0.2, 1.8, 2],
          nSamples: 4,
          sampleMetadata: {
            batch: ["A", "B", "A", "B"],
          },
        }),
      ],
      config: chartConfig({
        colorMode: "metadata",
        metadataKey: "batch",
        metadataType: "categorical",
        histogramSeries: "predicted",
        histogramBinCount: 2,
      }),
      taskKind: "regression",
      hasActuals: false,
    });

    expect(model.groups.map((group) => [group.key, group.label])).toEqual([
      ["meta:A", "A"],
      ["meta:B", "B"],
    ]);
    expect(model.seriesByGroup.get("meta:A")?.predicted).toEqual([0, 1.8]);
    expect(model.seriesByGroup.get("meta:B")?.predicted).toEqual([0.2, 2]);
    expect(model.rows[0]["meta:A:predicted"]).toBe(1);
    expect(model.rows[0]["meta:B:predicted"]).toBe(1);
    expect(model.rows[1]["meta:A:predicted"]).toBe(1);
    expect(model.rows[1]["meta:B:predicted"]).toBe(1);
  });

  it("builds axis, tooltip, and both-series labels", () => {
    const model = buildPredictionHistogramRenderModel({
      datasets: [
        dataset({
          label: "Validation",
          yTrue: [1, 2],
          yPred: [1.5, 1.75],
          nSamples: 2,
        }),
      ],
      config: chartConfig({
        histogramSeries: "both",
        histogramYAxis: "density",
      }),
      taskKind: "regression",
      hasActuals: true,
    });

    expect(model.xAxisLabel).toBe("Value");
    expect(model.yAxisLabel).toBe("Density");
    expect(model.barEntries.map((entry) => entry.label)).toEqual([
      "Validation (actual)",
      "Validation (predicted)",
    ]);
    expect(getPredictionHistogramXAxisLabel("regression", "residuals")).toBe("Residual (y_true − y_pred)");
    expect(getPredictionHistogramYAxisLabel("density", "classification")).toBe("Count");
    expect(getPredictionHistogramTooltipTitle("classification", "7")).toBe("Class 7");
    expect(getPredictionHistogramTooltipTitle("regression", "1.5")).toBe("≈ 1.5");
    expect(formatPredictionHistogramTooltipValue(1.23456, "density")).toBe("1.235");
    expect(formatPredictionHistogramTooltipValue(1.6, "count")).toBe("2");
  });
});
