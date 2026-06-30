import { describe, expect, it } from "vitest";

import { projectPlaygroundMetricObservations } from "@/lib/playground/metricObservations";
import type { MetricsResult } from "@/types/playground";

function metrics(): MetricsResult {
  return {
    values: {
      snr: [12, 14],
      baseline_drift: [0.1, 0.2],
    },
    statistics: {
      snr: {
        min: 12,
        max: 14,
        mean: 13,
        std: 1,
        p5: 12.1,
        p25: 12.5,
        p50: 13,
        p75: 13.5,
        p95: 13.9,
      },
      baseline_drift: {
        min: 0.1,
        max: 0.2,
        mean: 0.15,
        std: 0.05,
        p5: 0.105,
        p25: 0.125,
        p50: 0.15,
        p75: 0.175,
        p95: 0.195,
      },
    },
    computed_metrics: ["snr", "baseline_drift"],
    available_metrics: ["quality"],
    n_samples: 2,
  };
}

describe("projectPlaygroundMetricObservations", () => {
  it("projects metric statistics to structured mean observations", () => {
    expect(projectPlaygroundMetricObservations(metrics(), undefined)).toEqual([
      {
        key: "snr",
        label: "Snr",
        value: 13,
        aggregation: "mean",
        source: "playground-metrics",
        dimensions: {
          min: 12,
          max: 14,
          std: 1,
          p5: 12.1,
          p25: 12.5,
          p50: 13,
          p75: 13.5,
          p95: 13.9,
          n_samples: 2,
        },
      },
      expect.objectContaining({
        key: "baseline_drift",
        label: "Baseline Drift",
        value: 0.15,
      }),
    ]);
  });

  it("preserves explicit observations and fills only missing legacy metric keys", () => {
    expect(projectPlaygroundMetricObservations(metrics(), [
      {
        key: "snr",
        label: "SNR per source",
        value: 12.5,
        aggregation: "median",
        source: "backend",
        datasetId: "dataset-a",
      },
    ])).toEqual([
      {
        key: "snr",
        label: "SNR per source",
        value: 12.5,
        aggregation: "median",
        source: "backend",
        datasetId: "dataset-a",
      },
      expect.objectContaining({
        key: "baseline_drift",
        value: 0.15,
        aggregation: "mean",
      }),
    ]);
  });
});
