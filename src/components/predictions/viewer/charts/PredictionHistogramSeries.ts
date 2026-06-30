import { getCategoricalColor } from "@/lib/playground/colorConfig";
import type { PredictionColoration } from "../coloration";
import { getPartitionColor } from "../palettes";
import type {
  ChartConfig,
  HistogramSeries,
  PartitionDataset,
  TaskKind,
} from "../types";

export interface PredictionHistogramGroupDef {
  key: string;
  label: string;
  color: string;
}

export type PredictionHistogramVariantKey = "actual" | "predicted" | "residual";

export interface PredictionHistogramVariantSeries {
  actual: number[];
  predicted: number[];
  residual: number[];
}

export interface PredictionHistogramBinDomain {
  min: number;
  max: number;
}

const EPSILON = 1e-6;

export function formatPredictionHistogramClassValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < EPSILON) return String(rounded);
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function allInteger(values: number[]): boolean {
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const rounded = Math.round(value);
    if (Math.abs(value - rounded) > EPSILON) return false;
  }
  return true;
}

export function detectPredictionHistogramTaskKind(
  datasets: PartitionDataset[],
  hasActuals: boolean,
): TaskKind {
  const pooled: number[] = [];
  for (const dataset of datasets) {
    pooled.push(...dataset.yPred);
    if (hasActuals) pooled.push(...dataset.yTrue);
  }
  if (pooled.length === 0) return "regression";
  const finite = pooled.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return "regression";
  if (!allInteger(finite)) return "regression";
  const uniqueLabels = new Set(finite.map((value) => Math.round(value)));
  return uniqueLabels.size <= 20 ? "classification" : "regression";
}

export function resolvePredictionHistogramSeries(
  histogramSeries: HistogramSeries,
  hasActuals: boolean,
): HistogramSeries {
  if (!hasActuals) {
    if (histogramSeries === "actual" || histogramSeries === "residuals") return "predicted";
    if (histogramSeries === "both") return "predicted";
  }
  return histogramSeries;
}

export function getPredictionHistogramActiveVariants(
  effectiveSeries: HistogramSeries,
): PredictionHistogramVariantKey[] {
  if (effectiveSeries === "actual") return ["actual"];
  if (effectiveSeries === "predicted") return ["predicted"];
  if (effectiveSeries === "residuals") return ["residual"];
  return ["actual", "predicted"];
}

export function buildPredictionHistogramGroups({
  datasets,
  config,
  coloration,
}: {
  datasets: PartitionDataset[];
  config: ChartConfig;
  coloration: PredictionColoration;
}): PredictionHistogramGroupDef[] {
  if (
    config.colorMode === "metadata"
    && coloration.metadataType === "categorical"
    && coloration.metadataKey
  ) {
    return coloration.metadataCategories.map((category, index) => ({
      key: `meta:${category}`,
      label: category,
      color: getCategoricalColor(index, config.categoricalPalette),
    }));
  }

  return datasets.map((dataset) => ({
    key: `part:${dataset.predictionId}:${dataset.partition}`,
    label: dataset.label,
    color: getPartitionColor(dataset.partition, config.palette, config.partitionColors),
  }));
}

function pooledResiduals(dataset: PartitionDataset): Array<{ value: number; sampleIndex: number }> {
  const out: Array<{ value: number; sampleIndex: number }> = [];
  const sampleCount = Math.min(dataset.yTrue.length, dataset.yPred.length);
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const actual = dataset.yTrue[sampleIndex];
    const predicted = dataset.yPred[sampleIndex];
    if (!Number.isFinite(actual) || !Number.isFinite(predicted)) continue;
    out.push({ value: actual - predicted, sampleIndex });
  }
  return out;
}

function poolFromKey(
  dataset: PartitionDataset,
  key: "yTrue" | "yPred",
): Array<{ value: number; sampleIndex: number }> {
  const values = dataset[key];
  const out: Array<{ value: number; sampleIndex: number }> = [];
  for (let sampleIndex = 0; sampleIndex < values.length; sampleIndex++) {
    const value = values[sampleIndex];
    if (Number.isFinite(value)) out.push({ value, sampleIndex });
  }
  return out;
}

export function buildPredictionHistogramSeriesByGroup({
  datasets,
  groups,
  activeVariants,
  config,
  coloration,
}: {
  datasets: PartitionDataset[];
  groups: PredictionHistogramGroupDef[];
  activeVariants: PredictionHistogramVariantKey[];
  config: Pick<ChartConfig, "colorMode">;
  coloration: Pick<PredictionColoration, "metadataKey" | "metadataType">;
}): Map<string, PredictionHistogramVariantSeries> {
  const map = new Map<string, PredictionHistogramVariantSeries>();
  for (const group of groups) {
    map.set(group.key, { actual: [], predicted: [], residual: [] });
  }

  const metadataKey = config.colorMode === "metadata"
    && coloration.metadataType === "categorical"
    && coloration.metadataKey
    ? coloration.metadataKey
    : null;

  if (metadataKey) {
    for (const dataset of datasets) {
      const column = dataset.sampleMetadata?.[metadataKey];
      if (!Array.isArray(column)) continue;
      for (let sampleIndex = 0; sampleIndex < column.length; sampleIndex++) {
        const category = String(column[sampleIndex]);
        const groupKey = `meta:${category}`;
        const entry = map.get(groupKey);
        if (!entry) continue;
        const actual = dataset.yTrue[sampleIndex];
        const predicted = dataset.yPred[sampleIndex];
        if (activeVariants.includes("predicted") && Number.isFinite(predicted)) {
          entry.predicted.push(predicted);
        }
        if (activeVariants.includes("actual") && Number.isFinite(actual)) {
          entry.actual.push(actual);
        }
        if (
          activeVariants.includes("residual")
          && Number.isFinite(actual)
          && Number.isFinite(predicted)
        ) {
          entry.residual.push(actual - predicted);
        }
      }
    }
  } else {
    for (const dataset of datasets) {
      const groupKey = `part:${dataset.predictionId}:${dataset.partition}`;
      const entry = map.get(groupKey);
      if (!entry) continue;
      if (activeVariants.includes("predicted")) {
        entry.predicted.push(...poolFromKey(dataset, "yPred").map((point) => point.value));
      }
      if (activeVariants.includes("actual")) {
        entry.actual.push(...poolFromKey(dataset, "yTrue").map((point) => point.value));
      }
      if (activeVariants.includes("residual")) {
        entry.residual.push(...pooledResiduals(dataset).map((point) => point.value));
      }
    }
  }

  return map;
}

export function getPredictionHistogramPooledValues(
  seriesByGroup: Map<string, PredictionHistogramVariantSeries>,
  activeVariants: PredictionHistogramVariantKey[],
): number[] {
  const pooled: number[] = [];
  for (const variants of seriesByGroup.values()) {
    for (const variant of activeVariants) {
      pooled.push(...variants[variant]);
    }
  }
  return pooled.filter((value) => Number.isFinite(value));
}

export function buildPredictionHistogramClassLabels(
  taskKind: TaskKind,
  pooledValues: number[],
): string[] {
  if (taskKind !== "classification") return [];
  const seen = new Map<string, number>();
  for (const value of pooledValues) {
    const key = formatPredictionHistogramClassValue(value);
    if (key && !seen.has(key)) seen.set(key, Number(key));
  }
  return [...seen.keys()].sort((left, right) => {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }
    return left.localeCompare(right);
  });
}

export function getPredictionHistogramBinDomain(
  taskKind: TaskKind,
  pooledValues: number[],
): PredictionHistogramBinDomain | null {
  if (taskKind === "classification") return null;
  if (pooledValues.length === 0) return null;
  return {
    min: Math.min(...pooledValues),
    max: Math.max(...pooledValues),
  };
}
