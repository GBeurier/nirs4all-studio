/**
 * Chart panel for the Predict page — feature-parity with the unified
 * prediction viewer used in outcomes pages (history, leaderboard, database),
 * but driven by data already held on the client (no fetch).
 *
 * Supports:
 *   - scatter (regression)
 *   - residuals (regression)
 *   - confusion matrix (classification)
 *   - distribution (regression → histogram, classification → class counts)
 *
 * Honors the shared ChartConfig (palette, point size/opacity, identity line,
 * regression line, jitter, zero line, sigma band, confusion normalization,
 * confusion gradient) so visuals match the viewer modal used elsewhere.
 */

import { forwardRef, useMemo } from "react";
import {
  Activity,
  BarChart3,
  FileSpreadsheet,
  Grid3x3,
  ImageDown,
  Maximize2,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { formatMetricValue } from "@/lib/scores";

import { ChartConfigPopover } from "@/components/predictions/viewer/ChartConfigPopover";
import { MetricsStrip } from "@/components/predictions/viewer/MetricsStrip";
import { PredictionColorLegend } from "@/components/predictions/viewer/PredictionColorLegend";
import { PredictionScatterChart } from "@/components/predictions/viewer/charts/PredictionScatterChart";
import { PredictionResidualsChart } from "@/components/predictions/viewer/charts/PredictionResidualsChart";
import { PredictionConfusionChart } from "@/components/predictions/viewer/charts/PredictionConfusionChart";
import { buildPredictionColoration } from "@/components/predictions/viewer/coloration";
import { getPartitionColor } from "@/components/predictions/viewer/palettes";
import type {
  ChartConfig,
  ChartKind,
  PartitionDataset,
  TaskKind,
  ViewerHeader,
} from "@/components/predictions/viewer/types";

export type PanelKind = ChartKind | "distribution";

interface PredictChartPanelProps {
  datasets: PartitionDataset[];
  header: ViewerHeader;
  taskKind: TaskKind;
  hasActuals: boolean;
  availableKinds: PanelKind[];
  kind: PanelKind;
  onKindChange: (next: PanelKind) => void;
  config: ChartConfig;
  onConfigChange: (next: ChartConfig | ((prev: ChartConfig) => ChartConfig)) => void;
  onConfigReset: () => void;
  onExportPng: () => void;
  onExportCsv: () => void;
  onExpand?: () => void;
  isFullscreen?: boolean;
  className?: string;
  chartClassName?: string;
}

function buildHistogram(values: number[], numBins = 24): { label: string; value: number; count: number }[] {
  if (values.length === 0) return [];
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = max - min;
  if (range === 0) {
    return [{ label: formatMetricValue(min), value: min, count: finite.length }];
  }
  const binWidth = range / numBins;
  const bins = Array.from({ length: numBins }, (_, index) => {
    const center = min + binWidth * (index + 0.5);
    return { label: formatMetricValue(center), value: center, count: 0 };
  });
  for (const v of finite) {
    const idx = Math.min(Math.floor((v - min) / binWidth), numBins - 1);
    bins[idx].count += 1;
  }
  return bins;
}

interface ClassCountRow {
  label: string;
  /** Numeric position for the bar on a numeric X axis. NaN when the class
   *  label is non-numeric (falls back to categorical axis). */
  x: number;
  actual: number;
  predicted: number;
}

/**
 * Class labels are supposed to be discrete, but model outputs and round-trips
 * through float arrays often introduce tiny drift (e.g. 15.999999999999998).
 * Snap to the nearest integer when within epsilon so "16" and "15.999…" count
 * as the same class instead of rendering as separate 16-digit bars.
 */
function classLabelKey(v: number): string {
  if (Number.isInteger(v)) return String(v);
  const rounded = Math.round(v);
  if (Math.abs(v - rounded) < 1e-6) return String(rounded);
  return v.toFixed(4).replace(/\.?0+$/, "");
}

function buildClassCounts(
  datasets: PartitionDataset[],
  hasActuals: boolean,
): ClassCountRow[] {
  const byLabel = new Map<string, { actual: number; predicted: number }>();
  const bump = (label: string, key: "actual" | "predicted") => {
    const existing = byLabel.get(label) ?? { actual: 0, predicted: 0 };
    existing[key] += 1;
    byLabel.set(label, existing);
  };

  for (const d of datasets) {
    for (const v of d.yPred) {
      if (!Number.isFinite(v)) continue;
      bump(classLabelKey(v), "predicted");
    }
    if (hasActuals) {
      for (const v of d.yTrue) {
        if (!Number.isFinite(v)) continue;
        bump(classLabelKey(v), "actual");
      }
    }
  }

  return Array.from(byLabel.entries())
    .sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    )
    .map(([label, counts]) => ({
      label,
      x: Number(label),
      actual: counts.actual,
      predicted: counts.predicted,
    }));
}

export const PredictChartPanel = forwardRef<HTMLDivElement, PredictChartPanelProps>(
  function PredictChartPanel(
    {
      datasets,
      header,
      taskKind,
      hasActuals,
      availableKinds,
      kind,
      onKindChange,
      config,
      onConfigChange,
      onConfigReset,
      onExportPng,
      onExportCsv,
      onExpand,
      isFullscreen,
      className,
      chartClassName,
    },
    chartRef,
  ) {
    const coloration = useMemo(
      () => buildPredictionColoration(datasets, config),
      [datasets, config],
    );

    const isClassificationDistribution =
      kind === "distribution" && taskKind === "classification";

    const histogramData = useMemo(() => {
      if (kind !== "distribution" || isClassificationDistribution) return [];
      const pooled = datasets.flatMap((d) => d.yPred);
      return buildHistogram(pooled);
    }, [datasets, isClassificationDistribution, kind]);

    const classCounts = useMemo(() => {
      if (!isClassificationDistribution) return [];
      return buildClassCounts(datasets, hasActuals);
    }, [datasets, hasActuals, isClassificationDistribution]);

    // When every class label parses as a finite number, use a numeric X axis
    // so bars are positioned at their *real* class values (with gaps preserved
    // if classes are sparse, e.g. 0, 5, 10) instead of being evenly spaced as
    // ordinal categories.
    const numericClassAxis =
      classCounts.length > 0 && classCounts.every((row) => Number.isFinite(row.x));

    const predictedColor = useMemo(
      () =>
        getPartitionColor(
          datasets[0]?.partition ?? "test",
          config.palette,
          config.partitionColors,
        ),
      [datasets, config.palette, config.partitionColors],
    );
    const actualColor = useMemo(
      () => getPartitionColor("train", config.palette, config.partitionColors),
      [config.palette, config.partitionColors],
    );

    const legendVisible =
      kind === "scatter" || kind === "residuals"
        ? datasets.length > 0 && (config.colorMode === "partition" || Boolean(coloration.metadataKey))
        : false;

    const showMetricsStrip = hasActuals && kind !== "distribution";

    // Chart area sizing: full-screen fills the flex parent, inline mode uses a
    // fixed pixel height so Recharts' ResponsiveContainer gets a non-zero
    // clientHeight on first paint (flex-1 inside an auto-height column would
    // collapse to 0 and force a subsequent resize to render).
    const chartAreaClass = chartClassName
      ? cn("px-3 py-3", chartClassName)
      : isFullscreen
      ? "flex min-h-0 flex-1 flex-col px-3 py-3"
      : "h-[420px] shrink-0 px-3 py-3";

    return (
      <div
        className={cn(
          "flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm",
          isFullscreen && "min-h-0 flex-1",
          className,
        )}
      >
        {/* Toolbar row: chart-kind toggles on the left, config + exports on the right */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2">
          <ToggleGroup
            type="single"
            size="sm"
            value={kind}
            onValueChange={(v) => {
              if (v && (availableKinds as string[]).includes(v)) {
                onKindChange(v as PanelKind);
              }
            }}
            className="justify-start"
          >
            {availableKinds.includes("scatter") && (
              <ToggleGroupItem value="scatter" className="h-8 gap-1.5 text-xs">
                <TrendingUp className="h-3.5 w-3.5" />
                Scatter
              </ToggleGroupItem>
            )}
            {availableKinds.includes("residuals") && (
              <ToggleGroupItem value="residuals" className="h-8 gap-1.5 text-xs">
                <BarChart3 className="h-3.5 w-3.5" />
                Residuals
              </ToggleGroupItem>
            )}
            {availableKinds.includes("confusion") && (
              <ToggleGroupItem value="confusion" className="h-8 gap-1.5 text-xs">
                <Grid3x3 className="h-3.5 w-3.5" />
                Confusion
              </ToggleGroupItem>
            )}
            {availableKinds.includes("distribution") && (
              <ToggleGroupItem value="distribution" className="h-8 gap-1.5 text-xs">
                <Activity className="h-3.5 w-3.5" />
                Distribution
              </ToggleGroupItem>
            )}
          </ToggleGroup>

          <div className="flex items-center gap-1.5">
            {kind !== "distribution" && (
              <ChartConfigPopover
                kind={kind as ChartKind}
                config={config}
                metadataColumns={coloration.metadataColumns}
                resolvedMetadataType={coloration.metadataType}
                onChange={onConfigChange}
                onReset={onConfigReset}
              />
            )}
            {onExpand && !isFullscreen && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={onExpand}
                title="Expand to full-screen viewer"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Expand</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={onExportPng}
              disabled={datasets.length === 0}
              title="Export chart as PNG"
            >
              <ImageDown className="h-3.5 w-3.5" />
              PNG
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={onExportCsv}
              title="Export data as CSV"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              CSV
            </Button>
          </div>
        </div>

        {legendVisible && (
          <div className="border-b bg-muted/10 px-3 py-1.5">
            <PredictionColorLegend datasets={datasets} config={config} />
          </div>
        )}

        {/* Chart area — fixed pixel height inline, fill in fullscreen */}
        <div className={chartAreaClass}>
          {kind === "scatter" && hasActuals && datasets.length > 0 ? (
            <PredictionScatterChart
              ref={chartRef}
              datasets={datasets}
              config={config}
              variant="full"
            />
          ) : kind === "residuals" && hasActuals && datasets.length > 0 ? (
            <PredictionResidualsChart
              ref={chartRef}
              datasets={datasets}
              config={config}
              variant="full"
            />
          ) : kind === "confusion" && hasActuals && datasets.length > 0 ? (
            <PredictionConfusionChart
              ref={chartRef}
              datasets={datasets}
              config={config}
              variant="full"
            />
          ) : kind === "distribution" ? (
            <div ref={chartRef} className="h-full w-full">
              {isClassificationDistribution ? (
                classCounts.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={classCounts}
                      margin={{ top: 12, right: 20, bottom: 44, left: 52 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      {numericClassAxis ? (
                        <XAxis
                          dataKey="x"
                          type="number"
                          domain={["dataMin - 0.5", "dataMax + 0.5"]}
                          allowDecimals
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                          tickLine={false}
                          label={{
                            value: "Class value",
                            position: "bottom",
                            offset: 18,
                            style: { fill: "hsl(var(--muted-foreground))" },
                          }}
                        />
                      ) : (
                        <XAxis
                          dataKey="label"
                          interval={0}
                          angle={classCounts.length > 8 ? -35 : 0}
                          textAnchor={classCounts.length > 8 ? "end" : "middle"}
                          height={classCounts.length > 8 ? 70 : 40}
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                          tickLine={false}
                          label={{
                            value: "Class",
                            position: "bottom",
                            offset: classCounts.length > 8 ? 2 : 18,
                            style: { fill: "hsl(var(--muted-foreground))" },
                          }}
                        />
                      )}
                      <YAxis
                        allowDecimals={false}
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                        tickLine={false}
                        label={{
                          value: "Count",
                          angle: -90,
                          position: "left",
                          offset: 38,
                          style: { fill: "hsl(var(--muted-foreground))" },
                        }}
                      />
                      <RechartsTooltip
                        cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.3 }}
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const row = payload[0]?.payload as ClassCountRow | undefined;
                          const displayLabel = row?.label ?? "";
                          return (
                            <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
                              <div className="font-medium text-foreground">
                                Class {displayLabel}
                              </div>
                              <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                                {payload.map((item) => (
                                  <span
                                    key={item.dataKey as string}
                                    className="contents"
                                  >
                                    <span className="text-muted-foreground">{item.name}</span>
                                    <span>{item.value as number}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        }}
                      />
                      {hasActuals && (
                        <Bar
                          dataKey="actual"
                          name="Actual"
                          fill={actualColor}
                          fillOpacity={0.7}
                          radius={[2, 2, 0, 0]}
                        />
                      )}
                      <Bar
                        dataKey="predicted"
                        name="Predicted"
                        fill={predictedColor}
                        fillOpacity={0.85}
                        radius={[2, 2, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No class predictions to visualize.
                  </div>
                )
              ) : histogramData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={histogramData}
                    margin={{ top: 12, right: 20, bottom: 44, left: 52 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="label"
                      interval="preserveStartEnd"
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      tickLine={false}
                      label={{
                        value: "Predicted",
                        position: "bottom",
                        offset: 18,
                        style: { fill: "hsl(var(--muted-foreground))" },
                      }}
                    />
                    <YAxis
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      tickLine={false}
                      label={{
                        value: "Count",
                        angle: -90,
                        position: "left",
                        offset: 38,
                        style: { fill: "hsl(var(--muted-foreground))" },
                      }}
                    />
                    <RechartsTooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const row = payload[0]?.payload as
                          | { label: string; count: number }
                          | undefined;
                        if (!row) return null;
                        return (
                          <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
                            <div className="font-medium text-foreground">
                              Predicted ≈ {row.label}
                            </div>
                            <div className="mt-1 text-muted-foreground">Count: {row.count}</div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="count"
                      fill={predictedColor}
                      fillOpacity={0.85}
                      radius={[2, 2, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No predictions to visualize.
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {hasActuals
                ? "No data to display for this view."
                : "Reference values are required for this chart. Switch to Distribution or predict on a dataset partition with targets."}
            </div>
          )}
        </div>

        {showMetricsStrip && (
          <MetricsStrip taskKind={taskKind} datasets={datasets} header={header} />
        )}
      </div>
    );
  },
);

export default PredictChartPanel;
