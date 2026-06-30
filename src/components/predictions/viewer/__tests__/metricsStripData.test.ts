import { describe, expect, it } from "vitest";
import { buildMetricsStripStats } from "../metricsStripData";
import type { PartitionDataset } from "../types";

function dataset(partial: Partial<PartitionDataset>): PartitionDataset {
  return {
    predictionId: partial.predictionId ?? "prediction-1",
    partition: partial.partition ?? "test",
    label: partial.label ?? "Test",
    yTrue: partial.yTrue ?? [],
    yPred: partial.yPred ?? [],
    nSamples: partial.nSamples ?? Math.max(partial.yTrue?.length ?? 0, partial.yPred?.length ?? 0),
    sampleMetadata: partial.sampleMetadata ?? null,
  };
}

describe("buildMetricsStripStats", () => {
  it("builds pooled regression metrics", () => {
    expect(buildMetricsStripStats("regression", [
      dataset({ yTrue: [1, 2, 3], yPred: [1, 3, 2] }),
    ])).toEqual([
      { label: "RMSE", value: "0.8165" },
      { label: "R²", value: "0.0000" },
      { label: "MAE", value: "0.6667" },
      { label: "n", value: "3" },
    ]);
  });

  it("ignores non-finite regression pairs", () => {
    expect(buildMetricsStripStats("regression", [
      dataset({ yTrue: [1, Number.NaN, 3], yPred: [1, 2, Number.POSITIVE_INFINITY] }),
    ])).toEqual([
      { label: "RMSE", value: "0.0000" },
      { label: "R²", value: "0.0000" },
      { label: "MAE", value: "0.0000" },
      { label: "n", value: "1" },
    ]);
  });

  it("builds pooled classification metrics", () => {
    expect(buildMetricsStripStats("classification", [
      dataset({ yTrue: [0, 0, 1, 1], yPred: [0, 1, 1, 1] }),
    ])).toEqual([
      { label: "Accuracy", value: "0.7500" },
      { label: "F1 (macro)", value: "0.7333" },
      { label: "Precision (macro)", value: "0.8333" },
      { label: "Recall (macro)", value: "0.7500" },
    ]);
  });

  it("returns empty-state regression stats", () => {
    expect(buildMetricsStripStats("regression", [])).toEqual([
      { label: "RMSE", value: "—" },
      { label: "R²", value: "—" },
      { label: "MAE", value: "—" },
      { label: "n", value: "0" },
    ]);
  });

  it("returns empty-state classification stats", () => {
    expect(buildMetricsStripStats("classification", [])).toEqual([
      { label: "Accuracy", value: "—" },
      { label: "F1 (macro)", value: "—" },
      { label: "Precision (macro)", value: "—" },
      { label: "Recall (macro)", value: "—" },
    ]);
  });
});
