import type { PredictionRecord } from "@/types/linked-workspaces";
import type { ScoreCardRow } from "@/types/score-cards";
import {
  canonicalMetricKey,
  getMetricDefinitions,
  isClassificationTaskType,
  orderMetricKeys,
} from "@/lib/scores";
import {
  predictionGroupKey,
  type MetricTaskFilter,
} from "./rows";

export interface PredictionMetricContext {
  taskType: string | null;
  taskTypes: string[];
  availableMetricKeys: string[];
}

export interface PredictionQuickViewSelection {
  initialKind: "scatter";
  primary: PredictionRecord;
  siblings: PredictionRecord[];
}

export function getInitialPredictionMetricTaskFilter(
  rows: readonly Pick<ScoreCardRow, "taskType">[],
): MetricTaskFilter | null {
  if (rows.length === 0) return null;
  const hasClassification = rows.some((row) => isClassificationTaskType(row.taskType));
  const hasRegression = rows.some((row) => row.taskType && !isClassificationTaskType(row.taskType));
  return hasClassification && !hasRegression ? "classification" : null;
}

export function buildEffectivePredictionMetricContext(
  metricContext: PredictionMetricContext,
  metricTaskFilter: MetricTaskFilter,
): PredictionMetricContext {
  const filteredKeys = orderMetricKeys(
    metricContext.availableMetricKeys.filter((key) => {
      const definition = getMetricDefinitions([key])[0];
      if (!definition) return true;
      if (definition.group === "general") return true;
      if (metricTaskFilter === "regression") return definition.group === "regression";
      return definition.group === "multiclass" || definition.group === "binary";
    }),
  );

  return {
    taskType: metricTaskFilter,
    taskTypes: [metricTaskFilter],
    availableMetricKeys: filteredKeys,
  };
}

export function resolvePredictionPrimaryMetricKey({
  effectiveMetricTaskType,
  filteredRows,
  selectedMetrics,
}: {
  effectiveMetricTaskType: string | null;
  filteredRows: readonly Pick<ScoreCardRow, "metric">[];
  selectedMetrics: readonly string[];
}): string {
  return canonicalMetricKey(filteredRows.find((row) => row.metric)?.metric)
    || selectedMetrics[0]
    || (isClassificationTaskType(effectiveMetricTaskType) ? "accuracy" : "rmse");
}

export function selectPredictionQuickView(
  predictionId: string,
  predictions: readonly PredictionRecord[],
): PredictionQuickViewSelection | null {
  const prediction = predictions.find((record) => record.id === predictionId);
  if (!prediction) return null;

  const key = predictionGroupKey(prediction);
  const siblings = predictions.filter((record) => predictionGroupKey(record) === key);
  const primary = siblings.find((record) => record.partition === "test")
    ?? siblings.find((record) => record.partition === "val")
    ?? prediction;

  return {
    initialKind: "scatter",
    primary,
    siblings: siblings.length > 0 ? siblings : [prediction],
  };
}
