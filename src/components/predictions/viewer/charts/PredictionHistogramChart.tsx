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
import type {
  ChartConfig,
  ChartVariant,
  PartitionDataset,
  TaskKind,
} from "../types";
import {
  buildPredictionHistogramRenderModel,
  formatPredictionHistogramTooltipValue,
  getPredictionHistogramTooltipTitle,
} from "./PredictionHistogramChartData";

interface PredictionHistogramChartProps {
  datasets: PartitionDataset[];
  config: ChartConfig;
  /** When true (or unset), the chart treats class labels as discrete categories
   *  instead of binning a continuous range. Auto-detected from yTrue/yPred if
   *  not provided. */
  taskKind?: TaskKind;
  /** Reference values available — controls whether "actual" / "both" /
   *  "residuals" series can render. */
  hasActuals?: boolean;
  /** Density / chrome level. Defaults to "full". */
  variant?: ChartVariant;
  className?: string;
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

    const {
      taskKind: detectedTaskKind,
      classLabels,
      rows,
      barEntries,
      maxY,
      refStats,
      refLineX,
      xAxisLabel,
      yAxisLabel,
      emptyMessage,
    } = useMemo(
      () => buildPredictionHistogramRenderModel({ datasets, config, taskKind, hasActuals }),
      [datasets, config, taskKind, hasActuals],
    );

    const fillOpacity = config.histogramBarOpacity;
    const overlayBarGap =
      config.histogramLayout === "overlaid" ? "-100%" : undefined;

    if (rows.length === 0 || barEntries.length === 0) {
      return (
        <div ref={ref} className={className ?? "h-full w-full"}>
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {emptyMessage}
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
                        {getPredictionHistogramTooltipTitle(detectedTaskKind, label)}
                      </div>
                      <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                        {payload.map((item) => {
                          const entry = barEntries.find((e) => e.dataKey === item.dataKey);
                          const displayName = entry?.label ?? String(item.name);
                          const formatted = formatPredictionHistogramTooltipValue(
                            item.value,
                            config.histogramYAxis,
                          );
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
