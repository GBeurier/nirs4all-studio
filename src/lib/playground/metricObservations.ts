import {
  getPipelineExecutionMetricObservations,
  type PipelineExecutionMetricObservation,
  type PipelineExecutionMetricValue,
} from "@/lib/pipelineExecutionContract";
import type { MetricsResult, MetricStats } from "@/types/playground";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatMetricLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function statsDimensions(stats: MetricStats, nSamples: number): Record<string, PipelineExecutionMetricValue> {
  const dimensions: Record<string, PipelineExecutionMetricValue> = {};
  for (const key of ["min", "max", "std", "p5", "p25", "p50", "p75", "p95"] as const) {
    if (isFiniteNumber(stats[key])) {
      dimensions[key] = stats[key];
    }
  }
  if (Number.isFinite(nSamples)) {
    dimensions.n_samples = nSamples;
  }
  return dimensions;
}

function projectMetricsResult(metrics: MetricsResult | undefined): PipelineExecutionMetricObservation[] {
  if (!metrics?.statistics) {
    return [];
  }

  const metricKeys = metrics.computed_metrics.length > 0
    ? metrics.computed_metrics
    : Object.keys(metrics.statistics).sort();

  return metricKeys.flatMap((key) => {
    const stats = metrics.statistics[key];
    if (!stats || !isFiniteNumber(stats.mean)) {
      return [];
    }
    return [{
      key,
      label: formatMetricLabel(key),
      value: stats.mean,
      aggregation: "mean",
      source: "playground-metrics",
      dimensions: statsDimensions(stats, metrics.n_samples),
    }];
  });
}

export function projectPlaygroundMetricObservations(
  metrics: MetricsResult | undefined,
  explicitObservations: readonly PipelineExecutionMetricObservation[] | undefined,
): PipelineExecutionMetricObservation[] {
  const explicit = explicitObservations
    ? getPipelineExecutionMetricObservations({ metricObservations: [...explicitObservations] })
    : [];
  const explicitKeys = new Set(explicit.map(observation => observation.key));
  const projected = projectMetricsResult(metrics)
    .filter(observation => !explicitKeys.has(observation.key));

  return [
    ...explicit,
    ...projected,
  ];
}
