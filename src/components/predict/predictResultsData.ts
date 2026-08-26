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
  conformalCoverageLabel?: string;
  conformalLower?: number;
  conformalUpper?: number;
  actual?: number;
  residual?: number;
}

export interface PredictCsvExport {
  columns: string[];
  rows: Record<string, unknown>[];
}

interface NativeConformalAttachment {
  coverage: number;
  coverageLabel: string;
  intervals: Array<{
    coverage: number;
    coverageLabel: string;
    lower: number;
    upper: number;
  } | null>;
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

export function getPredictMetricLabel(metric: string): string {
  const normalized = metric.toLowerCase();
  if (normalized === "rmse" || normalized === "rmsep") {
    return getPredictionMetricLabel(normalized);
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

export function formatPredictPartitionLabel(value: string): string {
  if (!value) return value;
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

export function buildPredictTaskBadge(taskKind: TaskKind): PredictBadgeReadModel {
  return {
    label: taskKind === "classification" ? "Classification" : "Regression",
    className:
      taskKind === "classification"
        ? `${PREDICT_BADGE_BASE_CLASS} border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-300`
        : `${PREDICT_BADGE_BASE_CLASS} border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300`,
  };
}

export function buildPredictReferenceBadge(hasActuals: boolean): PredictBadgeReadModel {
  return {
    label: hasActuals ? "Reference values available" : "No reference values",
    className: hasActuals
      ? `${PREDICT_BADGE_BASE_CLASS} border-primary/40 bg-primary/10 text-primary`
      : `${PREDICT_BADGE_BASE_CLASS} border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300`,
  };
}

export function buildPredictPartitionDatasets({
  fallbackPartition,
  hasActuals,
  result,
}: {
  fallbackPartition: string;
  hasActuals: boolean;
  result: PredictResponse;
}): PartitionDataset[] {
  const n = result.predictions.length;
  const perSample = result.partitions ?? null;
  const conformal = resolveNativeConformalAttachment(result);

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
        label: formatPredictPartitionLabel(key),
        yTrue: hasActuals ? indices.map((index) => result.actual_values![index]) : [],
        yPred: indices.map((index) => result.predictions[index]),
        nSamples: indices.length,
        sampleIds: indices.map((index) => result.sample_ids?.[index] ?? index + 1),
        conformalCoverage: conformal?.coverage,
        conformalCoverageLabel: conformal?.coverageLabel,
        conformalIntervals: conformal
          ? indices.map((index) => conformal.intervals[index])
          : undefined,
      };
    });
  }

  const partitionKey = (fallbackPartition || (hasActuals ? "test" : "pred")).toLowerCase();
  return [
    {
      predictionId: `predict-inline-${result.model_name}-${partitionKey}`,
      partition: partitionKey,
      label: formatPredictPartitionLabel(partitionKey),
      yTrue: hasActuals ? result.actual_values ?? [] : [],
      yPred: result.predictions,
      nSamples: n,
      sampleIds: result.predictions.map((_, index) => result.sample_ids?.[index] ?? index + 1),
      conformalCoverage: conformal?.coverage,
      conformalCoverageLabel: conformal?.coverageLabel,
      conformalIntervals: conformal?.intervals,
    },
  ];
}

/**
 * Convert the scalar presentation emitted by DAG-ML into the shared chart view.
 *
 * This is deliberately a transport validation, not an interval calculation:
 * every identity, point prediction, and finite endpoint must already close over
 * the native response before the chart can display a band.
 */
function resolveNativeConformalAttachment(result: PredictResponse): NativeConformalAttachment | null {
  const presentation = result.conformal_presentation;
  const sampleIds = result.sample_ids;
  if (
    !presentation
    || presentation.schema_version !== 1
    || !Array.isArray(sampleIds)
    || !sampleIds.every((sampleId): sampleId is string => typeof sampleId === "string" && sampleId.length > 0)
    || sampleIds.length !== result.predictions.length
    || presentation.sample_ids.length !== sampleIds.length
    || presentation.point_predictions.length !== result.predictions.length
    || presentation.sample_ids.some((sampleId, index) => sampleId !== sampleIds[index])
    || presentation.point_predictions.some((value, index) => !Object.is(value, result.predictions[index]))
    || presentation.intervals.length === 0
  ) {
    return null;
  }

  const interval = presentation.intervals[0];
  if (
    !Number.isFinite(interval.coverage)
    || interval.coverage <= 0
    || interval.coverage >= 1
    || interval.lower.length !== sampleIds.length
    || interval.upper.length !== sampleIds.length
  ) {
    return null;
  }
  const coverageLabel = `${Math.round(interval.coverage * 1000) / 10}%`;
  const intervals: NativeConformalAttachment["intervals"] = [];
  for (let index = 0; index < sampleIds.length; index++) {
    const lower = interval.lower[index];
    const upper = interval.upper[index];
    const point = result.predictions[index];
    if (lower === null || upper === null) {
      if (lower !== null || upper !== null) return null;
      intervals.push(null);
      continue;
    }
    if (
      !Number.isFinite(lower)
      || !Number.isFinite(upper)
      || !Number.isFinite(point)
      || lower > point
      || point > upper
    ) {
      return null;
    }
    intervals.push({ coverage: interval.coverage, coverageLabel, lower, upper });
  }
  return { coverage: interval.coverage, coverageLabel, intervals };
}

export function getPredictInputLabel(input: PredictionInput | null | undefined, fallback: string): string {
  if (!input) return fallback;
  if (input.type === "dataset") {
    return input.datasetName || input.datasetId;
  }
  if (input.type === "file") return input.fileName;
  return `${input.rowCount} pasted row${input.rowCount === 1 ? "" : "s"}`;
}

export function getPredictInputSubLabel(input: PredictionInput | null | undefined): string | null {
  if (!input) return null;
  if (input.type === "dataset") return `partition: ${input.partition}`;
  if (input.type === "file") return "uploaded file";
  if (input.type === "array") return "pasted spectra";
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
  const conformal = resolveNativeConformalAttachment(result);
  return result.predictions.map((prediction, index) => {
    const interval = conformal?.intervals[index];
    return {
      index: result.sample_ids?.[index] ?? index + 1,
      partition:
        result.partitions && result.partitions.length === result.predictions.length
          ? result.partitions[index]
          : null,
      predicted: prediction,
      ...(interval
        ? {
            conformalCoverageLabel: interval.coverageLabel,
            conformalLower: interval.lower,
            conformalUpper: interval.upper,
          }
        : {}),
      actual: hasActuals ? result.actual_values![index] : undefined,
      residual: hasActuals ? result.actual_values![index] - prediction : undefined,
    };
  });
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
}: {
  hasActuals: boolean;
  numSamples: number;
  partitionCount: number;
  summaryMetric: PredictMetricEntry | null;
}): PredictSummaryCardReadModel[] {
  return [
    {
      key: "samples",
      label: "Samples",
      value: String(numSamples),
      description:
        partitionCount > 1
          ? `${partitionCount} partitions`
          : "Predictions in this run",
    },
    {
      key: "reference",
      label: "Reference",
      value: hasActuals ? "Available" : "Missing",
      description: hasActuals
        ? "Quality metrics computed against targets"
        : "Upload data with targets for scatter / residuals / confusion",
    },
    {
      key: "metric",
      label: summaryMetric ? getPredictMetricLabel(summaryMetric.key) : "Prediction metric",
      value: summaryMetric ? formatMetricValue(summaryMetric.value, summaryMetric.key) : "—",
      description: summaryMetric
        ? "Primary metric for this prediction"
        : "No comparable score available",
    },
  ];
}

export function buildPredictMetricCards(metricEntries: PredictMetricEntry[]): PredictMetricCardReadModel[] {
  return metricEntries.map((entry) => ({
    key: entry.key,
    label: getPredictMetricLabel(entry.key),
    value: formatMetricValue(entry.value, entry.key),
  }));
}

export function buildPredictStatsCards(stats: PredictStats | null): PredictStatCardReadModel[] {
  if (!stats) return [];
  return [
    { label: "N", value: String(stats.count) },
    { label: "Mean", value: formatMetricValue(stats.mean) },
    { label: "Std", value: formatMetricValue(stats.std) },
    { label: "Min", value: formatMetricValue(stats.min) },
    { label: "Q1", value: formatMetricValue(stats.q1) },
    { label: "Median", value: formatMetricValue(stats.median) },
    { label: "Q3", value: formatMetricValue(stats.q3) },
    { label: "Max", value: formatMetricValue(stats.max) },
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
}: {
  displaySubLabel: string | null;
  nSamples: number;
  preprocessings: string | null;
}): string[] {
  return [
    `${nSamples} samples`,
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
    if (row.conformalLower !== undefined) record.conformal_lower = row.conformalLower;
    if (row.conformalUpper !== undefined) record.conformal_upper = row.conformalUpper;
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
            partition: dataset.label,
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
        partition: dataset.label,
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
