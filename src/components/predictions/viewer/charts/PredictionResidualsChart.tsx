/**
 * Residuals chart: y_pred (predicted) vs (y_true - y_pred).
 *
 * Renders one <Scatter> per partition while resolving point colors from the
 * shared prediction-viewer coloration config. Honors zero line and ±1σ band.
 */

import { forwardRef, useMemo } from "react";
import {
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildPredictionColoration } from "../coloration";
import { getPartitionColor } from "../palettes";
import type { ChartConfig, ChartVariant, PartitionDataset } from "../types";

interface PredictionResidualsChartProps {
  datasets: PartitionDataset[];
  config: ChartConfig;
  /** Density / chrome level. Defaults to "full". */
  variant?: ChartVariant;
  /** @deprecated Use `variant="thumbnail"`. Back-compat only. */
  compact?: boolean;
  className?: string;
}

interface ResidualDot {
  predicted: number;
  residual: number;
  fill: string;
  partitionLabel: string;
  sampleIndex: number;
  metadataLabel?: string;
  metadataValue?: unknown;
}

function formatTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 1000 || abs < 0.01) return value.toExponential(1);
  return value.toFixed(2);
}

function jitterValue(v: number, amount: number): number {
  return v + (Math.random() - 0.5) * amount;
}

function formatTooltipValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(3) : String(value);
  }
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  return String(value);
}

export const PredictionResidualsChart = forwardRef<HTMLDivElement, PredictionResidualsChartProps>(
  function PredictionResidualsChart({ datasets, config, variant, compact, className }, ref) {
    const resolved: ChartVariant = variant ?? (compact ? "thumbnail" : "full");
    const showChrome = resolved !== "thumbnail";
    const showTooltip = resolved !== "thumbnail";
    const showAxisLabel = resolved === "full";
    const tickFontSize = resolved === "panel" ? 10 : 11;
    const chartMargin =
      resolved === "full"
        ? { top: 12, right: 20, bottom: 44, left: 52 }
        : resolved === "panel"
        ? { top: 8, right: 12, bottom: 28, left: 40 }
        : { top: 4, right: 8, bottom: 8, left: 8 };
    const coloration = useMemo(
      () => buildPredictionColoration(datasets, config),
      [datasets, config],
    );

    const { series, sigma, xMin, xMax } = useMemo(() => {
      const allResiduals: number[] = [];
      let xMin = Number.POSITIVE_INFINITY;
      let xMax = Number.NEGATIVE_INFINITY;

      const series = datasets.map((ds) => {
        const pts: ResidualDot[] = [];
        const n = Math.min(ds.yTrue.length, ds.yPred.length);
        for (let i = 0; i < n; i++) {
          const t = ds.yTrue[i];
          const p = ds.yPred[i];
          if (!Number.isFinite(t) || !Number.isFinite(p)) continue;
          const r = t - p;
          pts.push({
            predicted: p,
            residual: r,
            fill: coloration.getPointColor(ds, i),
            partitionLabel: ds.label,
            sampleIndex: i,
            metadataLabel: coloration.metadataKey,
            metadataValue: coloration.getMetadataValue(ds, i),
          });
          allResiduals.push(r);
          if (p < xMin) xMin = p;
          if (p > xMax) xMax = p;
        }
        return { dataset: ds, points: pts };
      });

      // Jitter on X (predicted) if requested.
      const range = Number.isFinite(xMin) && Number.isFinite(xMax) ? xMax - xMin : 0;
      const jitterAmount = config.jitter ? Math.max(range * 0.01, 1e-9) : 0;
      if (jitterAmount > 0) {
        for (const s of series) {
          s.points = s.points.map((p) => ({
            ...p,
            predicted: jitterValue(p.predicted, jitterAmount),
            residual: p.residual,
          }));
        }
      }

      let sigma = 0;
      if (allResiduals.length >= 2) {
        const mean = allResiduals.reduce((a, b) => a + b, 0) / allResiduals.length;
        const variance =
          allResiduals.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) / allResiduals.length;
        sigma = Math.sqrt(variance);
      }

      return { series, sigma, xMin, xMax };
    }, [datasets, coloration, config.jitter]);

    return (
      <div ref={ref} className={className ?? "h-full w-full"}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="predicted"
              type="number"
              domain={["auto", "auto"]}
              hide={!showChrome}
              tick={showChrome ? { fill: "hsl(var(--muted-foreground))", fontSize: tickFontSize } : false}
              tickFormatter={formatTick}
              label={
                showAxisLabel
                  ? {
                      value: "Predicted",
                      position: "bottom",
                      offset: 18,
                      style: { fill: "hsl(var(--muted-foreground))" },
                    }
                  : undefined
              }
            />
            <YAxis
              dataKey="residual"
              type="number"
              domain={["auto", "auto"]}
              hide={!showChrome}
              tick={showChrome ? { fill: "hsl(var(--muted-foreground))", fontSize: tickFontSize } : false}
              tickFormatter={formatTick}
              label={
                showAxisLabel
                  ? {
                      value: "Residual",
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
                content={({ active, payload }: { active?: boolean; payload?: Array<{ payload: ResidualDot }> }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const dot = payload[0]?.payload;
                  if (!dot) return null;
                  return (
                    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
                      <div className="font-medium text-foreground">{dot.partitionLabel}</div>
                      <div className="mt-1 text-muted-foreground">Sample {dot.sampleIndex + 1}</div>
                      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                        <span className="text-muted-foreground">Predicted</span>
                        <span>{formatTooltipValue(dot.predicted)}</span>
                        <span className="text-muted-foreground">Residual</span>
                        <span>{formatTooltipValue(dot.residual)}</span>
                        {dot.metadataLabel && (
                          <>
                            <span className="text-muted-foreground">{dot.metadataLabel}</span>
                            <span>{formatTooltipValue(dot.metadataValue)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                }}
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
            )}

            {config.sigmaBand && sigma > 0 && Number.isFinite(xMin) && Number.isFinite(xMax) && (
              <ReferenceArea
                y1={-sigma}
                y2={sigma}
                fill="hsl(var(--primary))"
                fillOpacity={0.08}
                stroke="none"
              />
            )}
            {config.zeroLine && (
              <ReferenceLine
                y={0}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                strokeOpacity={0.6}
              />
            )}

            {series.map(({ dataset, points }) => {
              const color = getPartitionColor(dataset.partition, config.palette, config.partitionColors);
              const radius = Math.max(1, config.pointSize / 2);
              return (
                <Scatter
                  key={`${dataset.predictionId}-${dataset.partition}`}
                  name={dataset.label}
                  data={points}
                  fill={color}
                  opacity={config.pointOpacity}
                  shape={(props: { cx?: number; cy?: number; payload?: ResidualDot }) => (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={radius}
                      fill={props.payload?.fill ?? color}
                      fillOpacity={config.pointOpacity}
                    />
                  )}
                />
              );
            })}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  },
);
