import { formatMetricValue } from "@/lib/scores";
import type {
  ChartConfig,
  HistogramSeries,
  HistogramYAxis,
  TaskKind,
} from "../types";
import {
  formatPredictionHistogramClassValue,
  type PredictionHistogramBinDomain,
  type PredictionHistogramGroupDef,
  type PredictionHistogramVariantKey,
  type PredictionHistogramVariantSeries,
} from "./PredictionHistogramSeries";

export interface PredictionHistogramBarEntry {
  dataKey: string;
  label: string;
  color: string;
  stackId?: string;
  errorKey?: string;
  pattern: "solid" | "hatch";
}

export interface PredictionHistogramBinRow {
  binLabel: string;
  binCenter: number;
  [dataKey: string]: string | number;
}

export interface PredictionHistogramSummary {
  mean: number;
  median: number;
}

export interface PredictionHistogramRowsModel {
  rows: PredictionHistogramBinRow[];
  barEntries: PredictionHistogramBarEntry[];
  maxY: number;
}

export function clampPredictionHistogramBinCount(histogramBinCount: number): number {
  return Math.max(2, Math.min(200, Math.round(histogramBinCount)));
}

export function buildPredictionHistogramRowsModel({
  groups,
  activeVariants,
  taskKind,
  classLabels,
  binDomain,
  numBins,
  seriesByGroup,
  layout,
  showErrorBars,
  yAxis,
  effectiveSeries,
}: {
  groups: PredictionHistogramGroupDef[];
  activeVariants: PredictionHistogramVariantKey[];
  taskKind: TaskKind;
  classLabels: string[];
  binDomain: PredictionHistogramBinDomain | null;
  numBins: number;
  seriesByGroup: Map<string, PredictionHistogramVariantSeries>;
  layout: ChartConfig["histogramLayout"];
  showErrorBars: boolean;
  yAxis: HistogramYAxis;
  effectiveSeries: HistogramSeries;
}): PredictionHistogramRowsModel {
  const entries: PredictionHistogramBarEntry[] = [];
  const stackId = layout === "stacked" ? "stack" : undefined;

  for (const group of groups) {
    for (const variant of activeVariants) {
      const dataKey = `${group.key}:${variant}`;
      const suffix =
        effectiveSeries === "both" ? ` (${variant === "actual" ? "actual" : "predicted"})` : "";
      entries.push({
        dataKey,
        label: `${group.label}${suffix}`,
        color: group.color,
        stackId,
        errorKey: showErrorBars ? `${dataKey}__err` : undefined,
        pattern: variant === "actual" ? "hatch" : "solid",
      });
    }
  }

  let rows: PredictionHistogramBinRow[] = [];

  if (taskKind === "classification" && classLabels.length > 0) {
    rows = classLabels.map((label) => {
      const row: PredictionHistogramBinRow = { binLabel: label, binCenter: Number(label) };
      for (const group of groups) {
        const variants = seriesByGroup.get(group.key);
        if (!variants) continue;
        for (const variant of activeVariants) {
          const values = variants[variant];
          let count = 0;
          for (const value of values) {
            if (formatPredictionHistogramClassValue(value) === label) count += 1;
          }
          row[`${group.key}:${variant}`] = count;
        }
      }
      return row;
    });
  } else if (binDomain) {
    const { min, max } = binDomain;
    const range = max - min;
    if (range <= 0) {
      const row: PredictionHistogramBinRow = {
        binLabel: formatMetricValue(min),
        binCenter: min,
      };
      for (const group of groups) {
        const variants = seriesByGroup.get(group.key);
        if (!variants) continue;
        for (const variant of activeVariants) {
          row[`${group.key}:${variant}`] = variants[variant].length;
        }
      }
      rows = [row];
    } else {
      const binWidth = range / numBins;
      rows = Array.from({ length: numBins }, (_, index) => {
        const center = min + binWidth * (index + 0.5);
        return { binLabel: formatMetricValue(center), binCenter: center };
      });
      for (const group of groups) {
        const variants = seriesByGroup.get(group.key);
        if (!variants) continue;
        for (const variant of activeVariants) {
          const values = variants[variant];
          const counts = new Array(numBins).fill(0) as number[];
          for (const value of values) {
            const index = Math.min(Math.floor((value - min) / binWidth), numBins - 1);
            if (index >= 0) counts[index] += 1;
          }
          const total = values.length;
          for (let index = 0; index < numBins; index++) {
            const count = counts[index];
            const y = yAxis === "density" && total > 0 && binWidth > 0
              ? count / (total * binWidth)
              : count;
            rows[index][`${group.key}:${variant}`] = y;
            if (showErrorBars) {
              const error = Math.sqrt(count);
              rows[index][`${group.key}:${variant}__err`] =
                yAxis === "density" && total > 0 && binWidth > 0
                  ? error / (total * binWidth)
                  : error;
            }
          }
        }
      }
    }
  }

  let maxY = 0;
  for (const row of rows) {
    let rowTotal = 0;
    for (const entry of entries) {
      const value = row[entry.dataKey];
      if (typeof value === "number" && Number.isFinite(value)) {
        if (stackId) rowTotal += value;
        else if (value > maxY) maxY = value;
      }
    }
    if (stackId && rowTotal > maxY) maxY = rowTotal;
  }
  if (maxY === 0) maxY = 1;

  return { rows, barEntries: entries, maxY };
}

export function summarizePredictionHistogramValues(
  values: number[],
): PredictionHistogramSummary | null {
  if (values.length === 0) return null;
  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
  return { mean, median };
}

export function getPredictionHistogramReferenceLineX({
  taskKind,
  refStats,
  binDomain,
  numBins,
  rows,
}: {
  taskKind: TaskKind;
  refStats: PredictionHistogramSummary | null;
  binDomain: PredictionHistogramBinDomain | null;
  numBins: number;
  rows: PredictionHistogramBinRow[];
}): { mean: string | null; median: string | null } {
  if (taskKind !== "regression" || !refStats || !binDomain || rows.length === 0) {
    return { mean: null, median: null };
  }
  const { min, max } = binDomain;
  const range = max - min;
  if (range <= 0) return { mean: null, median: null };
  const binWidth = range / numBins;
  const snap = (value: number): string | null => {
    if (!Number.isFinite(value)) return null;
    const index = Math.min(Math.max(Math.floor((value - min) / binWidth), 0), rows.length - 1);
    return typeof rows[index]?.binLabel === "string" ? rows[index].binLabel : null;
  };
  return { mean: snap(refStats.mean), median: snap(refStats.median) };
}

export function getPredictionHistogramYAxisLabel(
  yAxis: HistogramYAxis,
  taskKind: TaskKind,
): string {
  return yAxis === "density" && taskKind === "regression" ? "Density" : "Count";
}

export function getPredictionHistogramXAxisLabel(
  taskKind: TaskKind,
  effectiveSeries: HistogramSeries,
): string {
  if (taskKind === "classification") return "Class";
  if (effectiveSeries === "residuals") return "Residual (y_true − y_pred)";
  if (effectiveSeries === "actual") return "Actual";
  if (effectiveSeries === "predicted") return "Predicted";
  return "Value";
}

export function getPredictionHistogramTooltipTitle(
  taskKind: TaskKind,
  label: unknown,
): string {
  return taskKind === "classification" ? `Class ${String(label)}` : `≈ ${String(label)}`;
}

export function formatPredictionHistogramTooltipValue(
  value: unknown,
  yAxis: HistogramYAxis,
): string {
  if (typeof value !== "number") return String(value);
  return yAxis === "density" ? value.toFixed(3) : String(Math.round(value));
}
