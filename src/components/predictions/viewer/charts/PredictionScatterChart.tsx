/**
 * Scatter chart: y_true (actual) vs y_pred (predicted).
 *
 * Renders one <Scatter> per partition, colored via the configured palette
 * (when partitionColoring is ON). Honors identity line, regression line,
 * jitter, point size/opacity.
 */

import { forwardRef, useMemo } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getPartitionColor } from "../palettes";
import type { ChartConfig, PartitionDataset } from "../types";

interface PredictionScatterChartProps {
  datasets: PartitionDataset[];
  config: ChartConfig;
  /** When false, hide labels/tooltips/ticks (used by inline preview). */
  compact?: boolean;
  /** Optional className for outer wrapper height control. */
  className?: string;
}

function formatTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  if (abs >= 1000 || abs < 0.01) return value.toExponential(1);
  return value.toFixed(2);
}

function jitterValue(v: number, amount: number): number {
  // Uniform jitter in [-amount/2, +amount/2].
  return v + (Math.random() - 0.5) * amount;
}

function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumXX += xs[i] * xs[i];
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export const PredictionScatterChart = forwardRef<HTMLDivElement, PredictionScatterChartProps>(
  function PredictionScatterChart({ datasets, config, compact, className }, ref) {
    const { series, identitySegment, regressionSegment } = useMemo(() => {
      // Per-partition series + pooled ranges for lines.
      let globalMin = Number.POSITIVE_INFINITY;
      let globalMax = Number.NEGATIVE_INFINITY;
      const allActual: number[] = [];
      const allPredicted: number[] = [];

      // Find a small jitter scale based on the overall X range.
      const series = datasets.map((ds) => {
        const pts: { actual: number; predicted: number }[] = [];
        const n = Math.min(ds.yTrue.length, ds.yPred.length);
        for (let i = 0; i < n; i++) {
          const t = ds.yTrue[i];
          const p = ds.yPred[i];
          if (!Number.isFinite(t) || !Number.isFinite(p)) continue;
          pts.push({ actual: t, predicted: p });
          if (t < globalMin) globalMin = t;
          if (t > globalMax) globalMax = t;
          if (p < globalMin) globalMin = p;
          if (p > globalMax) globalMax = p;
          allActual.push(t);
          allPredicted.push(p);
        }
        return { dataset: ds, points: pts };
      });

      const range = Number.isFinite(globalMin) && Number.isFinite(globalMax) ? globalMax - globalMin : 0;
      const jitterAmount = config.jitter ? Math.max(range * 0.01, 1e-9) : 0;
      if (jitterAmount > 0) {
        for (const s of series) {
          s.points = s.points.map((p) => ({
            actual: jitterValue(p.actual, jitterAmount),
            predicted: jitterValue(p.predicted, jitterAmount),
          }));
        }
      }

      const identitySegment = Number.isFinite(globalMin) && Number.isFinite(globalMax) && globalMin < globalMax
        ? [
            { x: globalMin, y: globalMin },
            { x: globalMax, y: globalMax },
          ]
        : null;

      let regressionSegment: { x: number; y: number }[] | null = null;
      if (config.regressionLine && allActual.length >= 2) {
        const fit = linearRegression(allActual, allPredicted);
        if (fit && identitySegment) {
          regressionSegment = [
            { x: globalMin, y: fit.slope * globalMin + fit.intercept },
            { x: globalMax, y: fit.slope * globalMax + fit.intercept },
          ];
        }
      }

      return { series, identitySegment, regressionSegment };
    }, [datasets, config.jitter, config.regressionLine]);

    const showChrome = !compact;

    return (
      <div ref={ref} className={className ?? "h-full w-full"}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart
            margin={
              showChrome
                ? { top: 12, right: 20, bottom: 44, left: 52 }
                : { top: 4, right: 8, bottom: 8, left: 8 }
            }
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="actual"
              type="number"
              name="Actual"
              domain={["auto", "auto"]}
              hide={!showChrome}
              tick={showChrome ? { fill: "hsl(var(--muted-foreground))", fontSize: 11 } : false}
              tickFormatter={formatTick}
              label={
                showChrome
                  ? {
                      value: "Actual",
                      position: "bottom",
                      offset: 18,
                      style: { fill: "hsl(var(--muted-foreground))" },
                    }
                  : undefined
              }
            />
            <YAxis
              dataKey="predicted"
              type="number"
              name="Predicted"
              domain={["auto", "auto"]}
              hide={!showChrome}
              tick={showChrome ? { fill: "hsl(var(--muted-foreground))", fontSize: 11 } : false}
              tickFormatter={formatTick}
              label={
                showChrome
                  ? {
                      value: "Predicted",
                      angle: -90,
                      position: "left",
                      offset: 38,
                      style: { fill: "hsl(var(--muted-foreground))" },
                    }
                  : undefined
              }
            />
            {showChrome && (
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                formatter={(value: number) => value.toFixed(3)}
              />
            )}

            {config.identityLine && identitySegment && (
              <ReferenceLine
                segment={identitySegment}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                strokeOpacity={0.55}
              />
            )}
            {config.regressionLine && regressionSegment && (
              <ReferenceLine
                segment={regressionSegment}
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
                strokeOpacity={0.85}
              />
            )}

            {series.map(({ dataset, points }) => {
              const color = config.partitionColoring
                ? getPartitionColor(dataset.partition, config.palette)
                : "hsl(var(--primary))";
              const radius = Math.max(1, config.pointSize / 2);
              return (
                <Scatter
                  key={`${dataset.predictionId}-${dataset.partition}`}
                  name={dataset.label}
                  data={points}
                  fill={color}
                  opacity={config.pointOpacity}
                  shape={(props: { cx?: number; cy?: number; fill?: string }) => (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={radius}
                      fill={color}
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
