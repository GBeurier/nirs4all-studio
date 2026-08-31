import { cx } from "./_cx.js";
import {
  buildFrame,
  makeScale,
  niceExtent,
  round,
  stdDev,
  ticks,
  type Extent,
  type PlotPadding,
} from "./geometry.js";
import { N4_PARTITION_COLORS, N4_VIZ_COLORS, type PartitionKey } from "./theme.js";

/** One residual observation: residual vs. predicted (actual − predicted if `residual` absent). */
export interface ResidualPoint {
  predicted: number;
  residual?: number;
  actual?: number;
  partition?: PartitionKey;
  color?: string;
}

export interface ResidualPlotProps {
  points: readonly ResidualPoint[];
  width?: number;
  height?: number;
  padding?: PlotPadding;
  /** Draw dashed ±2σ reference lines around zero (default true). */
  sigmaBand?: boolean;
  pointRadius?: number;
  pointOpacity?: number;
  xLabel?: string;
  yLabel?: string;
  title?: string;
  className?: string;
}

function resolveResidual(point: ResidualPoint): number {
  if (point.residual != null) return point.residual;
  if (point.actual != null) return point.actual - point.predicted;
  return Number.NaN;
}

function pointColor(point: ResidualPoint): string {
  if (point.color) return point.color;
  if (point.partition) return N4_PARTITION_COLORS[point.partition];
  return N4_VIZ_COLORS.teal;
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

/**
 * Residual (y) vs. predicted (x) scatter with a solid zero reference and dashed
 * ±2σ bands — the residual-diagnostic view from Studio's Inspector. Pure inline
 * SVG; hosts pass points (residual or actual) and (optionally) precomputed
 * colors.
 */
export function ResidualPlot({
  points,
  width = 420,
  height = 260,
  padding,
  sigmaBand = true,
  pointRadius = 3,
  pointOpacity = 0.7,
  xLabel = "Predicted",
  yLabel = "Residual",
  title = "Residuals",
  className,
}: ResidualPlotProps) {
  const frame = buildFrame(width, height, padding);
  const { top, left } = frame.padding;
  const bottom = top + frame.innerHeight;
  const right = left + frame.innerWidth;

  const resolved = points
    .map((p) => ({ predicted: p.predicted, residual: resolveResidual(p), color: pointColor(p) }))
    .filter((p) => Number.isFinite(p.predicted) && Number.isFinite(p.residual));

  const residuals = resolved.map((p) => p.residual);
  const sigma = stdDev(residuals);
  const twoSigma = 2 * sigma;

  const maxAbs = Math.max(1e-9, ...residuals.map((r) => Math.abs(r)), sigmaBand ? twoSigma : 0);
  const safeMaxAbs = Number.isFinite(maxAbs) && maxAbs > 0 ? maxAbs : 1;
  const yDomain: Extent = niceExtent([-safeMaxAbs, safeMaxAbs], 0.08);
  const xDomain: Extent = niceExtent(resolved.map((p) => p.predicted), 0.06);

  const xScale = makeScale(xDomain, left, right);
  const yScale = makeScale(yDomain, bottom, top);
  const xTicks = ticks(xDomain, 5);
  const yTicks = ticks(yDomain, 5);

  const showSigma = sigmaBand && Number.isFinite(sigma) && sigma > 0 && resolved.length > 1;

  return (
    <svg
      className={cx("n4viz", "n4viz-residual", className)}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{title}</title>

      {yTicks.map((t) => (
        <line
          key={`gy-${t}`}
          className="n4viz-grid"
          x1={left}
          x2={right}
          y1={round(yScale(t))}
          y2={round(yScale(t))}
        />
      ))}

      {showSigma
        ? [twoSigma, -twoSigma].map((s) => (
            <line
              key={`sigma-${s}`}
              className="n4viz-reference n4viz-sigma"
              x1={left}
              x2={right}
              y1={round(yScale(s))}
              y2={round(yScale(s))}
              stroke={N4_VIZ_COLORS.amber}
              strokeDasharray="5 4"
              strokeWidth={1.3}
            />
          ))
        : null}

      <line
        className="n4viz-reference n4viz-zero"
        x1={left}
        x2={right}
        y1={round(yScale(0))}
        y2={round(yScale(0))}
        stroke={N4_VIZ_COLORS.slate}
        strokeWidth={1.4}
      />

      {resolved.map((p, i) => (
        <circle
          key={i}
          className="n4viz-dot"
          cx={round(xScale(p.predicted))}
          cy={round(yScale(p.residual))}
          r={pointRadius}
          fill={p.color}
          fillOpacity={pointOpacity}
        />
      ))}

      <line className="n4viz-axis" x1={left} x2={right} y1={bottom} y2={bottom} />
      <line className="n4viz-axis" x1={left} x2={left} y1={top} y2={bottom} />
      {xTicks.map((t) => (
        <text key={`tx-${t}`} className="n4viz-tick" x={round(xScale(t))} y={bottom + 15} textAnchor="middle">
          {fmt(t)}
        </text>
      ))}
      {yTicks.map((t) => (
        <text key={`ty-${t}`} className="n4viz-tick" x={left - 6} y={round(yScale(t)) + 3} textAnchor="end">
          {fmt(t)}
        </text>
      ))}
      <text className="n4viz-axis-label" x={left + frame.innerWidth / 2} y={height - 2} textAnchor="middle">
        {xLabel}
      </text>
      <text
        className="n4viz-axis-label"
        transform={`translate(11 ${top + frame.innerHeight / 2}) rotate(-90)`}
        textAnchor="middle"
      >
        {yLabel}
      </text>
    </svg>
  );
}
