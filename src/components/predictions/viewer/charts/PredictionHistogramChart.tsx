/**
 * Shared histogram chart for prediction distributions.
 *
 * Regression: bins pooled over selected series (predicted / actual / both /
 * residuals), split per visible group (partition or categorical metadata).
 * Layout can be grouped, stacked, or overlaid; optional ±√n error bars and
 * mean/median reference lines; supports count or density on the y-axis.
 *
 * Classification: discrete class-count bars (no binning), with the same
 * layout / opacity / error-bar / series toggles. Bin count, density, and
 * residuals controls don't apply and are hidden in the config panel.
 */

import { forwardRef, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ErrorBar,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMetricValue } from "@/lib/scores";
import { getCategoricalColor } from "@/lib/playground/colorConfig";
import { buildPredictionColoration } from "../coloration";
import { getPartitionColor } from "../palettes";
import type {
  ChartConfig,
  ChartVariant,
  HistogramSeries,
  PartitionDataset,
} from "../types";

interface PredictionHistogramChartProps {
  datasets: PartitionDataset[];
  config: ChartConfig;
  /** When true (or unset), the chart treats class labels as discrete categories
   *  instead of binning a continuous range. Auto-detected from yTrue/yPred if
   *  not provided. */
  taskKind?: "regression" | "classification";
  /** Reference values available — controls whether "actual" / "both" /
   *  "residuals" series can render. */
  hasActuals?: boolean;
  /** Density / chrome level. Defaults to "full". */
  variant?: ChartVariant;
  className?: string;
}

interface GroupDef {
  key: string;
  label: string;
  color: string;
}

interface BarEntry {
  dataKey: string;
  label: string;
  color: string;
  stackId?: string;
  errorKey?: string;
  pattern: "solid" | "hatch";
}

type BinRow = Record<string, number> & { binLabel: string; binCenter: number };

const EPSILON = 1e-6;

function roundClass(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < EPSILON) return String(rounded);
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function allInteger(values: number[]): boolean {
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const rounded = Math.round(v);
    if (Math.abs(v - rounded) > EPSILON) return false;
  }
  return true;
}

function detectTaskKind(
  datasets: PartitionDataset[],
  hasActuals: boolean,
): "regression" | "classification" {
  const pooled: number[] = [];
  for (const d of datasets) {
    pooled.push(...d.yPred);
    if (hasActuals) pooled.push(...d.yTrue);
  }
  if (pooled.length === 0) return "regression";
  const finite = pooled.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return "regression";
  if (!allInteger(finite)) return "regression";
  const uniq = new Set(finite.map((v) => Math.round(v)));
  // Treat ≤ 20 distinct integer labels as classification.
  return uniq.size <= 20 ? "classification" : "regression";
}

function pooledResiduals(dataset: PartitionDataset): Array<{ value: number; sampleIndex: number }> {
  const out: Array<{ value: number; sampleIndex: number }> = [];
  const n = Math.min(dataset.yTrue.length, dataset.yPred.length);
  for (let i = 0; i < n; i++) {
    const t = dataset.yTrue[i];
    const p = dataset.yPred[i];
    if (!Number.isFinite(t) || !Number.isFinite(p)) continue;
    out.push({ value: t - p, sampleIndex: i });
  }
  return out;
}

function poolFromKey(
  dataset: PartitionDataset,
  key: "yTrue" | "yPred",
): Array<{ value: number; sampleIndex: number }> {
  const arr = dataset[key];
  const out: Array<{ value: number; sampleIndex: number }> = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isFinite(v)) out.push({ value: v, sampleIndex: i });
  }
  return out;
}

function summary(values: number[]): { mean: number; median: number } | null {
  if (values.length === 0) return null;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return { mean, median };
}

function resolveSeries(histogramSeries: HistogramSeries, hasActuals: boolean): HistogramSeries {
  if (!hasActuals) {
    // Without reference values, fall back to predicted-only.
    if (histogramSeries === "actual" || histogramSeries === "residuals") return "predicted";
    if (histogramSeries === "both") return "predicted";
  }
  return histogramSeries;
}

export const PredictionHistogramChart = forwardRef<HTMLDivElement, PredictionHistogramChartProps>(
  function PredictionHistogramChart(
    { datasets, config, taskKind, hasActuals, variant, className },
    ref,
  ) {
    const resolved: ChartVariant = variant ?? "full";
    const showChrome = resolved !== "thumbnail";
    const showTooltip = resolved !== "thumbnail";
    const showAxisLabel = resolved === "full";
    const showLegend = resolved === "full" || resolved === "panel";
    const tickFontSize = resolved === "panel" ? 10 : 11;
    const chartMargin =
      resolved === "full"
        ? { top: 12, right: 20, bottom: 44, left: 52 }
        : resolved === "panel"
        ? { top: 8, right: 12, bottom: 28, left: 40 }
        : { top: 4, right: 8, bottom: 8, left: 8 };

    const actualsAvailable = hasActuals ?? datasets.some((d) => d.yTrue.length > 0);
    const detectedTaskKind = taskKind ?? detectTaskKind(datasets, actualsAvailable);
    const effectiveSeries = resolveSeries(config.histogramSeries, actualsAvailable);

    const coloration = useMemo(
      () => buildPredictionColoration(datasets, config),
      [datasets, config],
    );

    // Build the groups (partition or categorical metadata categories).
    const groups = useMemo<GroupDef[]>(() => {
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

      return datasets.map((d) => ({
        key: `part:${d.predictionId}:${d.partition}`,
        label: d.label,
        color: getPartitionColor(d.partition, config.palette, config.partitionColors),
      }));
    }, [
      datasets,
      config.colorMode,
      config.palette,
      config.partitionColors,
      config.categoricalPalette,
      coloration.metadataCategories,
      coloration.metadataKey,
      coloration.metadataType,
    ]);

    // Resolve value arrays per group × variant (actual | predicted | residual).
    type VariantKey = "actual" | "predicted" | "residual";
    const activeVariants: VariantKey[] = useMemo(() => {
      if (effectiveSeries === "actual") return ["actual"];
      if (effectiveSeries === "predicted") return ["predicted"];
      if (effectiveSeries === "residuals") return ["residual"];
      return ["actual", "predicted"];
    }, [effectiveSeries]);

    const seriesByGroup = useMemo(() => {
      const map = new Map<string, Record<VariantKey, number[]>>();
      for (const group of groups) {
        map.set(group.key, { actual: [], predicted: [], residual: [] });
      }

      const byMetadata = config.colorMode === "metadata"
        && coloration.metadataType === "categorical"
        && coloration.metadataKey;

      if (byMetadata) {
        const metadataKey = coloration.metadataKey!;
        for (const dataset of datasets) {
          const column = dataset.sampleMetadata?.[metadataKey];
          if (!Array.isArray(column)) continue;
          for (let i = 0; i < column.length; i++) {
            const category = String(column[i]);
            const groupKey = `meta:${category}`;
            const entry = map.get(groupKey);
            if (!entry) continue;
            const t = dataset.yTrue[i];
            const p = dataset.yPred[i];
            if (activeVariants.includes("predicted") && Number.isFinite(p)) entry.predicted.push(p);
            if (activeVariants.includes("actual") && Number.isFinite(t)) entry.actual.push(t);
            if (
              activeVariants.includes("residual")
              && Number.isFinite(t)
              && Number.isFinite(p)
            ) {
              entry.residual.push(t - p);
            }
          }
        }
      } else {
        for (const dataset of datasets) {
          const groupKey = `part:${dataset.predictionId}:${dataset.partition}`;
          const entry = map.get(groupKey);
          if (!entry) continue;
          if (activeVariants.includes("predicted")) {
            entry.predicted.push(...poolFromKey(dataset, "yPred").map((p) => p.value));
          }
          if (activeVariants.includes("actual")) {
            entry.actual.push(...poolFromKey(dataset, "yTrue").map((p) => p.value));
          }
          if (activeVariants.includes("residual")) {
            entry.residual.push(...pooledResiduals(dataset).map((p) => p.value));
          }
        }
      }

      return map;
    }, [
      datasets,
      groups,
      activeVariants,
      config.colorMode,
      coloration.metadataKey,
      coloration.metadataType,
    ]);

    // Pool all values to determine bin domain (regression) or class labels (classification).
    const pooledValues = useMemo(() => {
      const all: number[] = [];
      for (const [, variants] of seriesByGroup) {
        for (const variant of activeVariants) {
          all.push(...variants[variant]);
        }
      }
      return all.filter((v) => Number.isFinite(v));
    }, [seriesByGroup, activeVariants]);

    const classLabels = useMemo<string[]>(() => {
      if (detectedTaskKind !== "classification") return [];
      const seen = new Map<string, number>();
      for (const v of pooledValues) {
        const key = roundClass(v);
        if (key && !seen.has(key)) seen.set(key, Number(key));
      }
      return [...seen.keys()].sort((a, b) => {
        const na = Number(a);
        const nb = Number(b);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return a.localeCompare(b);
      });
    }, [detectedTaskKind, pooledValues]);

    const binDomain = useMemo(() => {
      if (detectedTaskKind === "classification") return null;
      if (pooledValues.length === 0) return null;
      const min = Math.min(...pooledValues);
      const max = Math.max(...pooledValues);
      return { min, max };
    }, [detectedTaskKind, pooledValues]);

    const numBins = Math.max(2, Math.min(200, Math.round(config.histogramBinCount)));

    // Build the row data consumed by Recharts.
    const { rows, barEntries, maxY } = useMemo(() => {
      const entries: BarEntry[] = [];
      const addEntry = (entry: BarEntry) => {
        entries.push(entry);
      };

      const stackId = config.histogramLayout === "stacked" ? "stack" : undefined;

      // Build each visible (group × variant) Bar definition.
      for (const group of groups) {
        for (const variant of activeVariants) {
          const dataKey = `${group.key}:${variant}`;
          const suffix =
            effectiveSeries === "both" ? ` (${variant === "actual" ? "actual" : "predicted"})` : "";
          addEntry({
            dataKey,
            label: `${group.label}${suffix}`,
            color: group.color,
            stackId,
            errorKey: config.histogramShowErrorBars ? `${dataKey}__err` : undefined,
            pattern: variant === "actual" ? "hatch" : "solid",
          });
        }
      }

      let rows: BinRow[] = [];

      if (detectedTaskKind === "classification" && classLabels.length > 0) {
        rows = classLabels.map((label) => {
          const row: BinRow = { binLabel: label, binCenter: Number(label) };
          for (const group of groups) {
            const variants = seriesByGroup.get(group.key);
            if (!variants) continue;
            for (const variant of activeVariants) {
              const values = variants[variant];
              let count = 0;
              for (const v of values) if (roundClass(v) === label) count += 1;
              row[`${group.key}:${variant}`] = count;
            }
          }
          return row;
        });
      } else if (binDomain) {
        const { min, max } = binDomain;
        const range = max - min;
        if (range <= 0) {
          const row: BinRow = { binLabel: formatMetricValue(min), binCenter: min };
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
            const row: BinRow = { binLabel: formatMetricValue(center), binCenter: center };
            return row;
          });
          for (const group of groups) {
            const variants = seriesByGroup.get(group.key);
            if (!variants) continue;
            for (const variant of activeVariants) {
              const values = variants[variant];
              const counts = new Array(numBins).fill(0) as number[];
              for (const v of values) {
                const idx = Math.min(Math.floor((v - min) / binWidth), numBins - 1);
                if (idx >= 0) counts[idx] += 1;
              }
              const total = values.length;
              for (let i = 0; i < numBins; i++) {
                const count = counts[i];
                const y = config.histogramYAxis === "density" && total > 0 && binWidth > 0
                  ? count / (total * binWidth)
                  : count;
                rows[i][`${group.key}:${variant}`] = y;
                if (config.histogramShowErrorBars) {
                  // Poisson √n, converted to density units when applicable.
                  const err = Math.sqrt(count);
                  rows[i][`${group.key}:${variant}__err`] =
                    config.histogramYAxis === "density" && total > 0 && binWidth > 0
                      ? err / (total * binWidth)
                      : err;
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
          const v = row[entry.dataKey];
          if (typeof v === "number" && Number.isFinite(v)) {
            if (stackId) rowTotal += v;
            else if (v > maxY) maxY = v;
          }
        }
        if (stackId && rowTotal > maxY) maxY = rowTotal;
      }
      if (maxY === 0) maxY = 1;

      return { rows, barEntries: entries, maxY };
    }, [
      groups,
      activeVariants,
      detectedTaskKind,
      classLabels,
      binDomain,
      numBins,
      seriesByGroup,
      config.histogramLayout,
      config.histogramShowErrorBars,
      config.histogramYAxis,
      effectiveSeries,
    ]);

    // Mean / median reference lines over the pooled value set for the active series.
    const refStats = useMemo(() => summary(pooledValues), [pooledValues]);

    // Snap ref-line x values to the bin label they fall into. Recharts'
    // categorical axis only matches on exact category values, so a raw
    // numeric x renders nothing.
    const refLineX = useMemo<{ mean: string | null; median: string | null }>(() => {
      if (detectedTaskKind !== "regression" || !refStats || !binDomain || rows.length === 0) {
        return { mean: null, median: null };
      }
      const { min, max } = binDomain;
      const range = max - min;
      if (range <= 0) return { mean: null, median: null };
      const binWidth = range / numBins;
      const snap = (value: number): string | null => {
        if (!Number.isFinite(value)) return null;
        const idx = Math.min(Math.max(Math.floor((value - min) / binWidth), 0), rows.length - 1);
        return typeof rows[idx]?.binLabel === "string" ? rows[idx].binLabel : null;
      };
      return { mean: snap(refStats.mean), median: snap(refStats.median) };
    }, [detectedTaskKind, refStats, binDomain, numBins, rows]);

    const yAxisLabel =
      config.histogramYAxis === "density" && detectedTaskKind === "regression" ? "Density" : "Count";
    const xAxisLabel =
      detectedTaskKind === "classification"
        ? "Class"
        : effectiveSeries === "residuals"
        ? "Residual (y_true − y_pred)"
        : effectiveSeries === "actual"
        ? "Actual"
        : effectiveSeries === "predicted"
        ? "Predicted"
        : "Value";

    const fillOpacity = config.histogramBarOpacity;
    const overlayBarGap =
      config.histogramLayout === "overlaid" ? "-100%" : undefined;

    if (rows.length === 0 || barEntries.length === 0) {
      return (
        <div ref={ref} className={className ?? "h-full w-full"}>
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {actualsAvailable ? "No values to visualize." : "No predictions to visualize."}
          </div>
        </div>
      );
    }

    return (
      <div ref={ref} className={className ?? "h-full w-full"}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={chartMargin}
            barGap={overlayBarGap}
            stackOffset={config.histogramLayout === "stacked" ? "none" : undefined}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="binLabel"
              interval="preserveStartEnd"
              hide={!showChrome}
              angle={detectedTaskKind === "classification" && classLabels.length > 8 ? -35 : 0}
              textAnchor={
                detectedTaskKind === "classification" && classLabels.length > 8 ? "end" : "middle"
              }
              height={detectedTaskKind === "classification" && classLabels.length > 8 ? 70 : 40}
              tick={showChrome ? { fill: "hsl(var(--muted-foreground))", fontSize: tickFontSize } : false}
              tickLine={false}
              label={
                showAxisLabel
                  ? {
                      value: xAxisLabel,
                      position: "bottom",
                      offset: 18,
                      style: { fill: "hsl(var(--muted-foreground))" },
                    }
                  : undefined
              }
            />
            <YAxis
              allowDecimals={config.histogramYAxis === "density"}
              domain={[0, Math.ceil(maxY * 1.05)]}
              hide={!showChrome}
              tick={showChrome ? { fill: "hsl(var(--muted-foreground))", fontSize: tickFontSize } : false}
              tickLine={false}
              label={
                showAxisLabel
                  ? {
                      value: yAxisLabel,
                      angle: -90,
                      position: "left",
                      offset: 38,
                      style: { fill: "hsl(var(--muted-foreground))" },
                    }
                  : undefined
              }
            />
            {showTooltip && (
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                content={({ active, payload, label }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  return (
                    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
                      <div className="font-medium text-foreground">
                        {detectedTaskKind === "classification" ? `Class ${label}` : `≈ ${label}`}
                      </div>
                      <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                        {payload.map((item) => {
                          const entry = barEntries.find((e) => e.dataKey === item.dataKey);
                          const displayName = entry?.label ?? String(item.name);
                          const value = item.value;
                          const formatted =
                            typeof value === "number"
                              ? config.histogramYAxis === "density"
                                ? value.toFixed(3)
                                : String(Math.round(value))
                              : String(value);
                          const color = entry?.color ?? (item.color as string);
                          const isHollow = entry?.pattern === "hatch";
                          return (
                            <span key={String(item.dataKey)} className="contents">
                              <span
                                className="inline-flex items-center gap-1.5 text-muted-foreground"
                              >
                                <span
                                  aria-hidden
                                  className="inline-block h-2.5 w-3 rounded-[2px]"
                                  style={
                                    isHollow
                                      ? { backgroundColor: "transparent", border: `2px solid ${color}` }
                                      : { backgroundColor: color }
                                  }
                                />
                                {displayName}
                              </span>
                              <span>{formatted}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                }}
              />
            )}
            {showLegend && barEntries.length > 1 && (
              <Legend
                verticalAlign="top"
                align="right"
                wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                content={() => (
                  <ul className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 pb-2">
                    {barEntries.map((entry) => (
                      <li
                        key={entry.dataKey}
                        className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
                      >
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-3.5 rounded-[2px]"
                          style={
                            entry.pattern === "hatch"
                              ? {
                                  backgroundColor: "transparent",
                                  border: `2px solid ${entry.color}`,
                                }
                              : { backgroundColor: entry.color }
                          }
                        />
                        <span>{entry.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
              />
            )}

            {config.histogramShowMean && refLineX.mean && (
              <ReferenceLine
                x={refLineX.mean}
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                ifOverflow="extendDomain"
                label={{
                  value: `μ ${formatMetricValue(refStats!.mean)}`,
                  position: "top",
                  style: { fill: "hsl(var(--primary))", fontSize: 10 },
                }}
              />
            )}
            {config.histogramShowMedian && refLineX.median && (
              <ReferenceLine
                x={refLineX.median}
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={1.5}
                strokeDasharray="2 2"
                ifOverflow="extendDomain"
                label={{
                  value: `med ${formatMetricValue(refStats!.median)}`,
                  position: "top",
                  style: { fill: "hsl(var(--muted-foreground))", fontSize: 10 },
                }}
              />
            )}

            {barEntries.map((entry) => {
              const isHollow = entry.pattern === "hatch";
              return (
                <Bar
                  key={entry.dataKey}
                  dataKey={entry.dataKey}
                  name={entry.label}
                  fill={entry.color}
                  fillOpacity={isHollow ? Math.min(fillOpacity * 0.2, 0.2) : fillOpacity}
                  stroke={isHollow ? entry.color : undefined}
                  strokeWidth={isHollow ? 2 : 0}
                  stackId={entry.stackId}
                  radius={[2, 2, 0, 0]}
                >
                  {entry.errorKey && (
                    <ErrorBar
                      dataKey={entry.errorKey}
                      width={4}
                      stroke="hsl(var(--muted-foreground))"
                      strokeOpacity={0.8}
                    />
                  )}
                </Bar>
              );
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  },
);
