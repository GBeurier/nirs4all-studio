import { describe, expect, it } from "vitest";

import {
  buildMetricObservationAvailability,
  buildMetricsFilterPanelReadModel,
} from "@/lib/playground/metricFilterReadModel";
import type { PipelineExecutionMetricObservation } from "@/lib/pipelineExecutionContract";
import type { MetricStats, MetricsResult } from "@/types/playground";

function stats(overrides: Partial<MetricStats> = {}): MetricStats {
  return {
    min: 0,
    max: 10,
    mean: 5,
    std: 1,
    p5: 1,
    p25: 3,
    p50: 5,
    p75: 7,
    p95: 9,
    ...overrides,
  };
}

function observation(key: string, value = 1): PipelineExecutionMetricObservation {
  return {
    key,
    label: key,
    value,
    source: "backend",
  };
}

describe("metric filter read model", () => {
  it("prioritizes observed filterable metrics before legacy computed metrics", () => {
    const metrics: MetricsResult = {
      values: {
        l2_norm: [1, 2],
        snr_estimate: [8, 9],
        custom_metric: [3, 4],
      },
      statistics: {
        l2_norm: stats(),
        snr_estimate: stats(),
        custom_metric: stats(),
      },
      computed_metrics: ["custom_metric", "l2_norm", "snr_estimate"],
      available_metrics: ["energy", "noise"],
      n_samples: 2,
    };

    expect(buildMetricsFilterPanelReadModel(metrics, [
      observation("snr_estimate"),
      observation("rmse"),
      observation("l2_norm"),
    ])).toEqual({
      availableMetricCount: 3,
      hasAvailableMetrics: true,
      metricObservationAvailability: {
        categories: {
          energy: {
            metricKeys: ["l2_norm"],
            observationCount: 1,
          },
          noise: {
            metricKeys: ["snr_estimate"],
            observationCount: 1,
          },
          other: {
            metricKeys: ["rmse"],
            observationCount: 1,
          },
        },
        hasObservations: true,
        metricCount: 3,
        metricKeys: ["l2_norm", "rmse", "snr_estimate"],
        observationCount: 3,
      },
      metricsByCategory: {
        energy: ["l2_norm"],
        noise: ["snr_estimate"],
        other: ["custom_metric"],
      },
    });
  });

  it("uses observation keys to expose filterable metrics missing from computed_metrics", () => {
    const metrics: MetricsResult = {
      values: {
        hf_variance: [1, 2],
        custom_metric: [3, 4],
      },
      statistics: {
        hf_variance: stats(),
        custom_metric: stats(),
      },
      computed_metrics: [],
      available_metrics: [],
      n_samples: 2,
    };

    expect(buildMetricsFilterPanelReadModel(metrics, [
      observation("hf_variance"),
      observation("custom_metric"),
      observation("hf_variance", 2),
    ])).toMatchObject({
      availableMetricCount: 2,
      hasAvailableMetrics: true,
      metricsByCategory: {
        other: ["custom_metric"],
        noise: ["hf_variance"],
      },
      metricObservationAvailability: {
        metricCount: 2,
        observationCount: 3,
      },
    });
  });

  it("keeps observation-only availability separate from filter availability", () => {
    const availability = buildMetricObservationAvailability([
      observation(" rmse "),
      observation(""),
      observation("score"),
    ]);

    expect(availability).toMatchObject({
      hasObservations: true,
      metricCount: 2,
      metricKeys: ["rmse", "score"],
      observationCount: 2,
    });
    expect(buildMetricsFilterPanelReadModel(null, [
      observation("rmse"),
    ])).toMatchObject({
      availableMetricCount: 0,
      hasAvailableMetrics: false,
      metricsByCategory: {},
      metricObservationAvailability: {
        hasObservations: true,
        metricCount: 1,
      },
    });
  });
});
