import type { PipelineExecutionMetricObservation } from "@/lib/pipelineExecutionContract";
import { getMetricCategory } from "@/lib/playground/metricFilterData";
import type { MetricsResult } from "@/types/playground";

export interface MetricObservationCategoryAvailability {
  metricKeys: string[];
  observationCount: number;
}

export interface MetricObservationAvailability {
  categories: Record<string, MetricObservationCategoryAvailability>;
  hasObservations: boolean;
  metricCount: number;
  metricKeys: string[];
  observationCount: number;
}

export interface MetricsFilterPanelReadModel {
  availableMetricCount: number;
  hasAvailableMetrics: boolean;
  metricObservationAvailability: MetricObservationAvailability;
  metricsByCategory: Record<string, string[]>;
}

function normalizeMetricKey(key: string | null | undefined): string | null {
  const normalized = key?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function uniqueStableMetricKeys(metricKeys: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const key of metricKeys) {
    const normalized = normalizeMetricKey(key);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}

function groupMetricKeysByCategory(metricKeys: readonly string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};

  for (const key of metricKeys) {
    const category = getMetricCategory(key);
    if (!groups[category]) groups[category] = [];
    groups[category].push(key);
  }

  return groups;
}

function hasFilterableMetricData(metrics: MetricsResult | null | undefined, metricKey: string): boolean {
  return Boolean(metrics?.values?.[metricKey] && metrics?.statistics?.[metricKey]);
}

function sortMetricKeys(metricKeys: Iterable<string>): string[] {
  return [...metricKeys].sort((left, right) => left.localeCompare(right));
}

export function buildMetricObservationAvailability(
  metricObservations: readonly PipelineExecutionMetricObservation[] | null | undefined,
): MetricObservationAvailability {
  const observations = metricObservations ?? [];
  const validObservations = observations.filter((observation) => normalizeMetricKey(observation.key) != null);
  const metricKeys = sortMetricKeys(new Set(validObservations.map(observation => observation.key.trim())));
  const categories: Record<string, MetricObservationCategoryAvailability> = {};

  for (const key of metricKeys) {
    const category = getMetricCategory(key);
    categories[category] = {
      metricKeys: [...(categories[category]?.metricKeys ?? []), key],
      observationCount: categories[category]?.observationCount ?? 0,
    };
  }

  for (const observation of validObservations) {
    const category = getMetricCategory(observation.key.trim());
    categories[category] = {
      metricKeys: categories[category]?.metricKeys ?? [],
      observationCount: (categories[category]?.observationCount ?? 0) + 1,
    };
  }

  return {
    categories,
    hasObservations: validObservations.length > 0,
    metricCount: metricKeys.length,
    metricKeys,
    observationCount: validObservations.length,
  };
}

export function buildMetricsFilterPanelReadModel(
  metrics: MetricsResult | null | undefined,
  metricObservations: readonly PipelineExecutionMetricObservation[] | null | undefined,
): MetricsFilterPanelReadModel {
  const metricObservationAvailability = buildMetricObservationAvailability(metricObservations);
  const computedMetricKeys = uniqueStableMetricKeys(metrics?.computed_metrics ?? []);
  const observedFilterableMetricKeys = metricObservationAvailability.metricKeys.filter((key) => (
    hasFilterableMetricData(metrics, key)
  ));
  const observedMetricKeySet = new Set(observedFilterableMetricKeys);
  const legacyComplementMetricKeys = computedMetricKeys.filter((key) => !observedMetricKeySet.has(key));
  const availableMetricKeys = [
    ...observedFilterableMetricKeys,
    ...legacyComplementMetricKeys,
  ];

  return {
    availableMetricCount: availableMetricKeys.length,
    hasAvailableMetrics: availableMetricKeys.length > 0,
    metricObservationAvailability,
    metricsByCategory: groupMetricKeysByCategory(availableMetricKeys),
  };
}
