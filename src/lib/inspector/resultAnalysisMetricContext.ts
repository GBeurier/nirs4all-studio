import { orderMetricKeys } from "@/lib/scores";
import type { ResultAnalysisStore } from "@/lib/inspector/resultAnalysisStore";
import type { MetricObservation } from "@/types/inspector";

export interface ResultAnalysisMetricSelectionContext {
  taskType: string | null;
  taskTypes: string[];
  availableMetricKeys: string[];
}

type ResultAnalysisMetricSelectionContextStore =
  Pick<ResultAnalysisStore, "scope"> &
  Partial<Pick<ResultAnalysisStore, "metricObservations">>;

function collectMetricObservationMetricKeys(
  metricObservations: readonly MetricObservation[] | undefined,
): string[] {
  const metricKeys = new Set<string>();

  for (const observation of metricObservations ?? []) {
    const metric = observation.ref.metric?.trim();
    if (metric) metricKeys.add(metric);
  }

  return [...metricKeys];
}

export function buildResultAnalysisMetricSelectionContext(
  store: ResultAnalysisMetricSelectionContextStore,
): ResultAnalysisMetricSelectionContext {
  const taskTypes: string[] = [];
  if (store.scope.hasClassification) taskTypes.push("classification");
  if (store.scope.hasRegression) taskTypes.push("regression");

  const metricKeys = [
    ...store.scope.metrics,
    ...collectMetricObservationMetricKeys(store.metricObservations),
  ];

  return {
    taskType: taskTypes.length === 1 ? taskTypes[0] : null,
    taskTypes,
    availableMetricKeys: orderMetricKeys(metricKeys),
  };
}
