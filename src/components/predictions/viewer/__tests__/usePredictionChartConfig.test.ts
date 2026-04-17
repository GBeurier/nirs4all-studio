import { describe, expect, it } from "vitest";

import { DEFAULT_CHART_CONFIG } from "../types";
import {
  applyPredictionChartConfigToStorage,
  normalizePredictionChartStorage,
  resolvePredictionChartConfig,
} from "../usePredictionChartConfig";

describe("prediction chart config storage", () => {
  it("stores metadata coloration only for the active dataset", () => {
    const storage = applyPredictionChartConfigToStorage(
      normalizePredictionChartStorage(null),
      "ws::dataset-a",
      {
        ...DEFAULT_CHART_CONFIG,
        colorMode: "metadata",
        metadataKey: "batch",
        metadataType: "categorical",
        categoricalPalette: "set2",
      },
    );

    const datasetA = resolvePredictionChartConfig(storage, "ws::dataset-a");
    const datasetB = resolvePredictionChartConfig(storage, "ws::dataset-b");

    expect(datasetA.colorMode).toBe("metadata");
    expect(datasetA.metadataKey).toBe("batch");
    expect(datasetA.categoricalPalette).toBe("set2");

    expect(datasetB.colorMode).toBe("partition");
    expect(datasetB.metadataKey).toBeUndefined();
    expect(datasetB.categoricalPalette).toBe(DEFAULT_CHART_CONFIG.categoricalPalette);
  });

  it("keeps non-coloration settings global across datasets", () => {
    const storage = applyPredictionChartConfigToStorage(
      normalizePredictionChartStorage(null),
      "ws::dataset-a",
      {
        ...DEFAULT_CHART_CONFIG,
        colorMode: "metadata",
        metadataKey: "batch",
        pointSize: 8,
        jitter: true,
      },
    );

    const datasetB = resolvePredictionChartConfig(storage, "ws::dataset-b");

    expect(datasetB.colorMode).toBe("partition");
    expect(datasetB.pointSize).toBe(8);
    expect(datasetB.jitter).toBe(true);
  });

  it("drops legacy flat metadata mode from the global fallback", () => {
    const legacyStorage = normalizePredictionChartStorage({
      ...DEFAULT_CHART_CONFIG,
      colorMode: "metadata",
      metadataKey: "instrument",
      categoricalPalette: "paired",
    });

    const resolved = resolvePredictionChartConfig(legacyStorage, "ws::dataset-a");

    expect(resolved.colorMode).toBe("partition");
    expect(resolved.metadataKey).toBeUndefined();
    expect(resolved.categoricalPalette).toBe(DEFAULT_CHART_CONFIG.categoricalPalette);
  });
});
