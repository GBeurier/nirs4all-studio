import {
  detectMetadataType,
  getCategoricalColor,
  getContinuousColor,
  getMetadataUniqueCategories,
  normalizeValue,
} from "@/lib/playground/colorConfig";
import { getPartitionColor } from "./palettes";
import type {
  ChartConfig,
  PartitionDataset,
  ViewerMetadataType,
} from "./types";

export const PREDICTION_COLOR_FALLBACK = "hsl(var(--muted-foreground))";

export interface PredictionColoration {
  metadataColumns: string[];
  metadataKey?: string;
  metadataType: ViewerMetadataType | null;
  metadataCategories: string[];
  metadataRange: { min: number; max: number } | null;
  getPointColor: (dataset: PartitionDataset, sampleIndex: number) => string;
  getMetadataValue: (dataset: PartitionDataset, sampleIndex: number) => unknown;
}

function pushColumn(columns: string[], seen: Set<string>, key: string, values: unknown[] | undefined): void {
  if (!Array.isArray(values) || values.length === 0 || seen.has(key)) return;
  seen.add(key);
  columns.push(key);
}

export function getPredictionMetadataColumns(datasets: PartitionDataset[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();

  for (const dataset of datasets) {
    const metadata = dataset.sampleMetadata;
    if (!metadata) continue;
    for (const key of Object.keys(metadata)) {
      pushColumn(columns, seen, key, metadata[key]);
    }
  }

  return columns;
}

function getResolvedMetadataKey(datasets: PartitionDataset[], config: ChartConfig): string | undefined {
  const columns = getPredictionMetadataColumns(datasets);
  if (columns.length === 0) return undefined;
  if (config.metadataKey && columns.includes(config.metadataKey)) {
    return config.metadataKey;
  }
  return columns[0];
}

function getMetadataValue(dataset: PartitionDataset, key: string | undefined, sampleIndex: number): unknown {
  if (!key) return undefined;
  return dataset.sampleMetadata?.[key]?.[sampleIndex];
}

function collectMetadataValues(datasets: PartitionDataset[], key: string | undefined): unknown[] {
  if (!key) return [];
  const values: unknown[] = [];
  for (const dataset of datasets) {
    const column = dataset.sampleMetadata?.[key];
    if (Array.isArray(column)) {
      values.push(...column);
    }
  }
  return values;
}

export function buildPredictionColoration(
  datasets: PartitionDataset[],
  config: ChartConfig,
): PredictionColoration {
  const metadataColumns = getPredictionMetadataColumns(datasets);
  const metadataKey = config.colorMode === "metadata"
    ? getResolvedMetadataKey(datasets, config)
    : undefined;
  const metadataValues = collectMetadataValues(datasets, metadataKey);
  const metadataType = metadataKey
    ? (config.metadataType ?? detectMetadataType(metadataValues))
    : null;

  const metadataCategories = metadataType === "categorical"
    ? getMetadataUniqueCategories(metadataValues)
    : [];

  const numericValues = metadataType === "continuous"
    ? metadataValues.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    : [];

  const metadataRange = numericValues.length > 0
    ? { min: Math.min(...numericValues), max: Math.max(...numericValues) }
    : null;

  const getPointColor = (dataset: PartitionDataset, sampleIndex: number): string => {
    if (config.colorMode === "partition") {
      return getPartitionColor(dataset.partition, config.palette, config.partitionColors);
    }

    const value = getMetadataValue(dataset, metadataKey, sampleIndex);
    if (value === null || value === undefined) {
      return PREDICTION_COLOR_FALLBACK;
    }

    if (
      metadataType === "continuous"
      && typeof value === "number"
      && Number.isFinite(value)
      && metadataRange
    ) {
      const t = normalizeValue(value, metadataRange.min, metadataRange.max);
      return getContinuousColor(t, config.continuousPalette);
    }

    if (metadataType === "categorical") {
      const categoryIndex = metadataCategories.indexOf(String(value));
      return getCategoricalColor(
        categoryIndex >= 0 ? categoryIndex : 0,
        config.categoricalPalette,
      );
    }

    return PREDICTION_COLOR_FALLBACK;
  };

  return {
    metadataColumns,
    metadataKey,
    metadataType,
    metadataCategories,
    metadataRange,
    getPointColor,
    getMetadataValue: (dataset, sampleIndex) => getMetadataValue(dataset, metadataKey, sampleIndex),
  };
}
