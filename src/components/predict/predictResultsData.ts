import type { TFunction } from "i18next";

import { getPredictionMetricLabel } from "@/lib/predict-metrics";
import {
  formatMetricName,
  formatMetricValue,
  getMetricDefinitions,
} from "@/lib/scores";
import { sanitizeFilename } from "@/components/predictions/viewer/export";
import type {
  ChartKind,
  PartitionDataset,
  TaskKind,
  ViewerHeader,
} from "@/components/predictions/viewer/types";
import type { AvailableModel, PredictResponse } from "@/types/predict";

export type PredictionInput =
  | { type: "dataset"; datasetId: string; datasetName?: string | null; partition: string }
  | { type: "file"; fileName: string }
  | { type: "array"; rowCount: number };

export interface PredictStats {
  count: number;
  mean: number;
  std: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

export interface PredictMetricEntry {
  key: string;
  value: number;
}

export interface PredictDatasetCacheEntry {
  id: string;
  name?: string | null;
}

export interface PredictBadgeReadModel {
  label: string;
  className: string;
}

export interface PredictSummaryCardReadModel {
  key: "samples" | "reference" | "metric";
  label: string;
  value: string;
  description: string;
}

export interface PredictMetricCardReadModel {
  key: string;
  label: string;
  value: string;
}

export interface PredictStatCardReadModel {
  label: string;
  value: string;
}

export interface PredictPreprocessingBadgeReadModel {
  key: string;
  label: string;
}

export interface PredictTableRow {
  index: string | number;
  partition: string | null;
  predicted: number;
  actual?: number;
  residual?: number;
}

export interface PredictCsvExport {
  columns: string[];
  rows: Record<string, unknown>[];
}

const PARTITION_ORDER: Record<string, number> = {
  train: 0,
  val: 1,
  test: 2,
};

const METRIC_PRIORITY = [
  "rmsep",
  "rmse",
  "r2",
  "mae",
  "accuracy",
  "balanced_accuracy",
  "f1",
  "f1_macro",
  "precision",
  "recall",
  "rpd",
  "sep",
  "bias",
] as const;

const PREDICT_BADGE_BASE_CLASS = "h-5 px-2 text-[10px] uppercase tracking-wider";

export function computePredictStats(values: number[]): PredictStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const mean = sum / count;
  const variance = sorted.reduce((acc, value) => acc + (value - mean) ** 2, 0) / count;
  const std = Math.sqrt(variance);
  const median =
    count % 2 === 0
      ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
      : sorted[Math.floor(count / 2)];
  const q1 = sorted[Math.floor(count * 0.25)];
  const q3 = sorted[Math.floor(count * 0.75)];

  return {
    count,
    mean,
    std,
    min: sorted[0],
    q1,
    median,
    q3,
    max: sorted[count - 1],
  };
}

export function getPredictMetricLabel(metric: string, t: TFunction): string {
  const normalized = metric.toLowerCase();
  if (normalized === "rmse" || normalized === "rmsep") {
    return getPredictionMetricLabel(normalized, t);
  }
  if (normalized === "r2") return "R²";
  return formatMetricName(normalized);
}

function metricGroups(keys: readonly string[]): Set<string> {
  return new Set(getMetricDefinitions(keys).map((definition) => definition.group));
}

export function detectPredictTaskKind({
  actualValues,
  metrics,
  model,
  predictions,
}: {
  actualValues: number[] | null;
  metrics: Record<string, number> | null;
  model?: AvailableModel | null;
  predictions: number[];
}): TaskKind {
  const modelMetric = (model?.prediction_metric || model?.metric || "").toLowerCase();
  if (modelMetric) {
    const groups = metricGroups([modelMetric]);
    if (groups.has("regression")) return "regression";
    if (groups.has("multiclass") || groups.has("binary")) return "classification";
  }

  const combined = `${model?.model_class ?? ""} ${model?.name ?? ""} ${model?.id ?? ""}`.toLowerCase();
  if (/(regress|regressor|\bpls\b|\bpcr\b|\bridge\b|\blasso\b|\belasticnet\b|\bsvr\b|\bgbr\b)/.test(combined)) {
    return "regression";
  }
  if (/(classif|classifier|logisticregression|\bsvc\b|\bmlpclassifier\b|\bknnclassifier\b)/.test(combined)) {
    return "classification";
  }

  if (metrics) {
    const groups = metricGroups(Object.keys(metrics));
    if (groups.has("regression")) return "regression";
    if (groups.has("multiclass") || groups.has("binary")) return "classification";
  }

  const probeActual =
    actualValues && actualValues.length > 0
      ? actualValues.slice(0, 300).filter((value) => Number.isFinite(value))
      : [];
  const probePred = predictions.slice(0, 300).filter((value) => Number.isFinite(value));
  if (probePred.length > 0) {
    const actualsInt = probeActual.length > 0 && probeActual.every((value) => Number.isInteger(value));
    const predsInt = probePred.every((value) => Number.isInteger(value));
    const uniqueCombined = new Set<number>();
    for (const value of probePred) uniqueCombined.add(value);
    for (const value of probeActual) uniqueCombined.add(value);
    if (actualsInt && predsInt && uniqueCombined.size <= 10 && uniqueCombined.size >= 2) {
      return "classification";
    }
  }
  return "regression";
}

const KNOWN_PARTITION_LABEL_KEYS: Record<string, string> = {
  train: "predict.view.partitions.train",
  val: "predict.view.partitions.val",
  test: "predict.view.partitions.test",
  pred: "predict.view.partitions.pred",
};

export function formatPredictPartitionLabel(value: string, t: TFunction): string {
  if (!value) return value;
  const key = KNOWN_PARTITION_LABEL_KEYS[value.toLowerCase()];
  if (key) return t(key);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function resolvePredictInputFromDatasetCache(
  input: PredictionInput | null | undefined,
  datasets: readonly PredictDatasetCacheEntry[] | null | undefined,
): PredictionInput | null {
  if (!input) return null;
  if (input.type !== "dataset") return input;
  if (input.datasetName) return input;
  const match = datasets?.find((dataset) => dataset.id === input.datasetId);
  return { ...input, datasetName: match?.name ?? input.datasetId };
}

export function buildPredictViewerHeader({
  displayName,
  result,
  taskKind,
}: {
  displayName: string;
  result: PredictResponse;
  taskKind: TaskKind;
}): ViewerHeader {
  return {
    datasetName: displayName,
    modelName: result.model_name,
    preprocessings:
      result.preprocessing_steps.length > 0
        ? result.preprocessing_steps.join(" · ")
        : null,
    taskType: taskKind === "classification" ? "classification" : "regression",
    nSamples: result.num_samples,
  };
}

export function buildPredictTaskBadge(taskKind: TaskKind, t: TFunction): PredictBadgeReadModel {
  return {
    label: t(taskKind === "classification" ? "predict.view.classification" : "predict.view.regression"),
    className:
      taskKind === "classification"
        ? `${PREDICT_BADGE_BASE_CLASS} border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-300`
        : `${PREDICT_BADGE_BASE_CLASS} border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300`,
  };
}

export function buildPredictReferenceBadge(hasActuals: boolean, t: TFunction): PredictBadgeReadModel {
  return {
    label: t(hasActuals ? "predict.view.referenceAvailable" : "predict.view.referenceMissing"),
    className: hasActuals
      ? `${PREDICT_BADGE_BASE_CLASS} border-primary/40 bg-primary/10 text-primary`
      : `${PREDICT_BADGE_BASE_CLASS} border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300`,
  };
}

export function buildPredictPartitionDatasets({
  fallbackPartition,
  hasActuals,
  result,
  t,
}: {
  fallbackPartition: string;
  hasActuals: boolean;
  result: PredictResponse;
  t: TFunction;
}): PartitionDataset[] {
  const n = result.predictions.length;
  const perSample = result.partitions ?? null;

  if (perSample && perSample.length === n && new Set(perSample.filter(Boolean)).size > 1) {
    const groups = new Map<string, number[]>();
    for (let index = 0; index < n; index++) {
      const key = (perSample[index] || fallbackPartition || "pred").toLowerCase();
      const list = groups.get(key) ?? [];
      list.push(index);
      groups.set(key, list);
    }

    const keys = Array.from(groups.keys()).sort((a, b) => {
      const rankA = PARTITION_ORDER[a] ?? Number.MAX_SAFE_INTEGER;
      const rankB = PARTITION_ORDER[b] ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.localeCompare(b);
    });

    return keys.map((key) => {
      const indices = groups.get(key)!;
      return {
        predictionId: `predict-inline-${result.model_name}-${key}`,
        partition: key,
        label: formatPredictPartitionLabel(key, t),
        yTrue: hasActuals ? indices.map((index) => result.actual_values![index]) : [],
        yPred: indices.map((index) => result.predictions[index]),
        nSamples: indices.length,
        sampleIds: indices.map((index) => result.sample_ids?.[index] ?? index + 1),
      };
    });
  }

  const partitionKey = (fallbackPartition || (hasActuals ? "test" : "pred")).toLowerCase();
  return [
    {
      predictionId: `predict-inline-${result.model_name}-${partitionKey}`,
      partition: partitionKey,
      label: formatPredictPartitionLabel(partitionKey, t),
      yTrue: hasActuals ? result.actual_values ?? [] : [],
      yPred: result.predictions,
      nSamples: n,
      sampleIds: result.predictions.map((_, index) => result.sample_ids?.[index] ?? index + 1),
    },
  ];
}

export function getPredictInputLabel(input: PredictionInput | null | undefined, fallback: string, t: TFunction): string {
  if (!input) return fallback;
  if (input.type === "dataset") {
    return input.datasetName || input.datasetId;
  }
  if (input.type === "file") return input.fileName;
  return t("predict.view.pastedRows", { count: input.rowCount });
}

export function getPredictInputSubLabel(input: PredictionInput | null | undefined, t: TFunction): string | null {
  if (!input) return null;
  if (input.type === "dataset") return t("predict.view.subPartition", { partition: input.partition });
  if (input.type === "file") return t("predict.view.subUploadedFile");
  if (input.type === "array") return t("predict.view.subPastedSpectra");
  return null;
}

export function buildPredictAvailableKinds(hasActuals: boolean, taskKind: TaskKind): ChartKind[] {
  const kinds: ChartKind[] = [];
  if (hasActuals) {
    if (taskKind === "regression") {
      kinds.push("scatter", "residuals");
    } else {
      kinds.push("confusion");
    }
  }
  kinds.push("distribution");
  return kinds;
}

export function resolvePredictDefaultKind(
  availableKinds: ChartKind[],
  taskKind: TaskKind,
  hasActuals: boolean,
): ChartKind {
  if (!hasActuals) return "distribution";
  if (taskKind === "classification" && availableKinds.includes("confusion")) return "confusion";
  if (taskKind === "regression" && availableKinds.includes("scatter")) return "scatter";
  return availableKinds[0] ?? "distribution";
}

export function buildPredictTableRows(result: PredictResponse, hasActuals: boolean): PredictTableRow[] {
  return result.predictions.map((prediction, index) => ({
    index: result.sample_ids?.[index] ?? index + 1,
    partition:
      result.partitions && result.partitions.length === result.predictions.length
        ? result.partitions[index]
        : null,
    predicted: prediction,
    actual: hasActuals ? result.actual_values![index] : undefined,
    residual: hasActuals ? result.actual_values![index] - prediction : undefined,
  }));
}

export function buildPredictMetricEntries(metrics: Record<string, number> | null): PredictMetricEntry[] {
  if (!metrics) return [];

  const seen = new Set<string>();
  const ordered: PredictMetricEntry[] = [];

  for (const key of METRIC_PRIORITY) {
    const alias = key === "rmsep" ? "rmse" : key;
    const value = metrics[alias];
    if (value == null || seen.has(alias)) continue;
    seen.add(alias);
    ordered.push({ key: alias, value });
  }

  for (const [key, value] of Object.entries(metrics)) {
    if (value == null || seen.has(key)) continue;
    seen.add(key);
    ordered.push({ key, value });
  }

  return ordered;
}

export function buildPredictSummaryCards({
  hasActuals,
  numSamples,
  partitionCount,
  summaryMetric,
  t,
}: {
  hasActuals: boolean;
  numSamples: number;
  partitionCount: number;
  summaryMetric: PredictMetricEntry | null;
  t: TFunction;
}): PredictSummaryCardReadModel[] {
  return [
    {
      key: "samples",
      label: t("predict.view.cards.samples"),
      value: String(numSamples),
      description:
        partitionCount > 1
          ? t("predict.view.cards.partitionsCount", { count: partitionCount })
          : t("predict.view.cards.predictionsInRun"),
    },
    {
      key: "reference",
      label: t("predict.view.cards.reference"),
      value: t(hasActuals ? "predict.view.cards.available" : "predict.view.cards.missing"),
      description: t(hasActuals ? "predict.view.cards.referenceAvailableHint" : "predict.view.cards.referenceMissingHint"),
    },
    {
      key: "metric",
      label: summaryMetric ? getPredictMetricLabel(summaryMetric.key, t) : t("predict.view.cards.predictionMetric"),
      value: summaryMetric ? formatMetricValue(summaryMetric.value, summaryMetric.key) : "—",
      description: t(summaryMetric ? "predict.view.cards.primaryMetric" : "predict.view.cards.noScore"),
    },
  ];
}

export function buildPredictMetricCards(metricEntries: PredictMetricEntry[], t: TFunction): PredictMetricCardReadModel[] {
  return metricEntries.map((entry) => ({
    key: entry.key,
    label: getPredictMetricLabel(entry.key, t),
    value: formatMetricValue(entry.value, entry.key),
  }));
}

export function buildPredictStatsCards(stats: PredictStats | null, t: TFunction): PredictStatCardReadModel[] {
  if (!stats) return [];
  return [
    { label: t("predict.view.stats.count"), value: String(stats.count) },
    { label: t("predict.view.stats.mean"), value: formatMetricValue(stats.mean) },
    { label: t("predict.view.stats.std"), value: formatMetricValue(stats.std) },
    { label: t("predict.view.stats.min"), value: formatMetricValue(stats.min) },
    { label: t("predict.view.stats.q1"), value: formatMetricValue(stats.q1) },
    { label: t("predict.view.stats.median"), value: formatMetricValue(stats.median) },
    { label: t("predict.view.stats.q3"), value: formatMetricValue(stats.q3) },
    { label: t("predict.view.stats.max"), value: formatMetricValue(stats.max) },
  ];
}

export function buildPredictPreprocessingBadges(
  steps: readonly string[],
): PredictPreprocessingBadgeReadModel[] {
  return steps.map((step) => ({ key: step, label: step }));
}

export function buildPredictFullscreenTitle({
  displayName,
  modelName,
}: {
  displayName: string;
  modelName: string;
}): string {
  return `${modelName}${displayName ? ` · ${displayName}` : ""}`;
}

export function buildPredictFullscreenSubtitleParts({
  displaySubLabel,
  nSamples,
  preprocessings,
  t,
}: {
  displaySubLabel: string | null;
  nSamples: number;
  preprocessings: string | null;
  t: TFunction;
}): string[] {
  return [
    t("predict.view.samplesCount", { count: nSamples }),
    ...(displaySubLabel ? [displaySubLabel] : []),
    ...(preprocessings ? [preprocessings] : []),
  ];
}

export function buildPredictTableCsvRows(tableRows: PredictTableRow[]): Record<string, number | string>[] {
  return tableRows.map((row) => {
    const record: Record<string, number | string> = {
      sample: String(row.index),
      predicted: row.predicted,
    };
    if (row.partition) record.partition = row.partition;
    if (row.actual !== undefined) record.actual = row.actual;
    if (row.residual !== undefined) record.residual = row.residual;
    return record;
  });
}

export function buildPredictChartBaseFilename(
  displayName: string,
  modelName: string,
  kind: ChartKind,
): string {
  return `${sanitizeFilename(displayName)}_${sanitizeFilename(modelName)}_${kind}`;
}

export function buildPredictChartCsvExport({
  hasActuals,
  kind,
  partitionDatasets,
  predictions,
  sampleIds,
  taskKind,
}: {
  hasActuals: boolean;
  kind: ChartKind;
  partitionDatasets: PartitionDataset[];
  predictions: number[];
  sampleIds: (string | number)[] | null;
  taskKind: TaskKind;
}): PredictCsvExport {
  if (kind === "distribution") {
    if (taskKind === "classification") {
      const rows: Record<string, unknown>[] = [];
      for (const dataset of partitionDatasets) {
        for (let index = 0; index < dataset.yPred.length; index++) {
          rows.push({
            sample_id: String(dataset.sampleIds?.[index] ?? index + 1),
            partition: dataset.partition,
            y_pred: dataset.yPred[index],
            y_true: hasActuals && dataset.yTrue[index] !== undefined ? dataset.yTrue[index] : "",
          });
        }
      }
      return {
        columns: ["sample_id", "partition", "y_true", "y_pred"],
        rows,
      };
    }

    return {
      columns: ["sample_id", "y_pred"],
      rows: predictions.map((value, index) => ({
        sample_id: String(sampleIds?.[index] ?? index + 1),
        y_pred: value,
      })),
    };
  }

  if (kind === "confusion") {
    const counts = new Map<string, number>();
    for (const dataset of partitionDatasets) {
      const n = Math.min(dataset.yTrue.length, dataset.yPred.length);
      for (let index = 0; index < n; index++) {
        const key = `${dataset.yTrue[index]}|${dataset.yPred[index]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const rows: Record<string, unknown>[] = [];
    for (const [key, count] of counts.entries()) {
      const [trueLabel, predLabel] = key.split("|");
      rows.push({ true_label: trueLabel, pred_label: predLabel, count });
    }
    return {
      columns: ["true_label", "pred_label", "count"],
      rows,
    };
  }

  const rows: Record<string, unknown>[] = [];
  for (const dataset of partitionDatasets) {
    const n = Math.min(dataset.yTrue.length, dataset.yPred.length);
    for (let index = 0; index < n; index++) {
      rows.push({
        sample_id: String(dataset.sampleIds?.[index] ?? index + 1),
        partition: dataset.partition,
        y_true: dataset.yTrue[index],
        y_pred: dataset.yPred[index],
        residual: dataset.yTrue[index] - dataset.yPred[index],
      });
    }
  }
  return {
    columns: ["sample_id", "partition", "y_true", "y_pred", "residual"],
    rows,
  };
}
