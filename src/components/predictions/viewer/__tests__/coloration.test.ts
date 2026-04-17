import { describe, expect, it } from "vitest";

import { buildPredictionColoration, getPredictionMetadataColumns } from "../coloration";
import { DEFAULT_CHART_CONFIG, type PartitionDataset } from "../types";

const DATASETS: PartitionDataset[] = [
  {
    predictionId: "pred-train",
    partition: "train",
    label: "Train",
    yTrue: [1, 2],
    yPred: [1.1, 1.9],
    nSamples: 2,
    sampleMetadata: {
      batch: ["A", "B"],
      moisture: [11.2, 14.8],
    },
  },
  {
    predictionId: "pred-test",
    partition: "test",
    label: "Test",
    yTrue: [3, 4],
    yPred: [2.8, 4.2],
    nSamples: 2,
    sampleMetadata: {
      batch: ["A", "C"],
      moisture: [12.1, 16.3],
    },
  },
];

describe("prediction viewer coloration", () => {
  it("collects metadata columns in dataset order", () => {
    expect(getPredictionMetadataColumns(DATASETS)).toEqual(["batch", "moisture"]);
  });

  it("uses categorical colors for low-cardinality metadata", () => {
    const coloration = buildPredictionColoration(DATASETS, {
      ...DEFAULT_CHART_CONFIG,
      colorMode: "metadata",
      metadataKey: "batch",
    });

    expect(coloration.metadataType).toBe("categorical");
    expect(coloration.metadataCategories).toEqual(["A", "B", "C"]);
    expect(coloration.getPointColor(DATASETS[0], 0)).toBe(coloration.getPointColor(DATASETS[1], 0));
    expect(coloration.getPointColor(DATASETS[0], 0)).not.toBe(coloration.getPointColor(DATASETS[0], 1));
  });

  it("uses continuous colors for high-cardinality numeric metadata", () => {
    const denseDataset: PartitionDataset[] = [
      {
        ...DATASETS[0],
        sampleMetadata: {
          score: Array.from({ length: 12 }, (_, index) => index),
        },
        yTrue: Array.from({ length: 12 }, (_, index) => index),
        yPred: Array.from({ length: 12 }, (_, index) => index),
        nSamples: 12,
      },
    ];

    const coloration = buildPredictionColoration(denseDataset, {
      ...DEFAULT_CHART_CONFIG,
      colorMode: "metadata",
      metadataKey: "score",
      continuousPalette: "viridis",
    });

    expect(coloration.metadataType).toBe("continuous");
    expect(coloration.metadataRange).toEqual({ min: 0, max: 11 });
    expect(coloration.getPointColor(denseDataset[0], 0)).not.toBe(
      coloration.getPointColor(denseDataset[0], 11),
    );
  });

  it("keeps partition colors when metadata mode is not active", () => {
    const coloration = buildPredictionColoration(DATASETS, DEFAULT_CHART_CONFIG);

    expect(coloration.metadataKey).toBeUndefined();
    expect(coloration.getPointColor(DATASETS[0], 0)).toBe("#17cfb9");
    expect(coloration.getPointColor(DATASETS[1], 0)).toBe("#1cca5b");
  });
});
