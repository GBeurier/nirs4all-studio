import { cx } from "./_cx.js";
import { extentOf, makeScale, round, ticks } from "./geometry.js";
import { divergingColor, N4_VIZ_COLORS } from "./theme.js";

/** A single SHAP contribution for one sample against one feature. */
export interface BeeswarmPoint {
  shap: number;
  featureValue: number;
}

/** One feature row: every sample's SHAP value + raw feature value. */
export interface BeeswarmFeature {
  label: string;
  points: readonly BeeswarmPoint[];
}

export interface ShapBeeswarmProps {
  features: readonly BeeswarmFeature[];
  width?: number;
  /** Auto-sized from the feature count when omitted. */
  height?: number;
  pointRadius?: number;
  title?: string;
  className?: string;
  xLabel?: string;
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

function truncate(label: string, max = 15): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/** Deterministic pseudo-jitter in [-1, 1] derived only from the point index. */
function jitterUnit(index: number): number {
  const hashed = (Math.trunc(index) * 2654435761) >>> 0;
  return ((hashed % 1000) / 999) * 2 - 1;
}

/**
 * SHAP beeswarm: one horizontal row per feature with a dot per sample placed by
 * its SHAP value and colored (blue→neutral→red) by the sample's normalized
 * feature value. A dashed zero reference line separates negative from positive
 * contributions. Jitter is deterministic (index-derived, never random) so the
 * markup is stable across renders. Pure inline SVG.
 */
export function ShapBeeswarm({
  features,
  width = 420,
  height,
  pointRadius = 2.5,
  title = "SHAP beeswarm",
  className,
  xLabel = "SHAP value",
}: ShapBeeswarmProps) {
  const resolvedHeight = height ?? Math.max(180, features.length * 34 + 48);

  const padLeft = 96;
  const padRight = 16;
  const padTop = 10;
  const padBottom = 30;
  const plotLeft = padLeft;
  const plotRight = width - padRight;
  const plotTop = padTop;
  const plotBottom = resolvedHeight - padBottom;
  const plotHeight = Math.max(0, plotBottom - plotTop);

  const allShap = features.flatMap((f) => f.points.map((p) => p.shap));
  const ext = extentOf(allShap);
  const domain = { min: Math.min(0, ext.min), max: Math.max(0, ext.max) };
  const xScale = makeScale(domain, plotLeft, plotRight);
  const axisTicks = ticks(domain, 5);
  const xZero = xScale(0);

  const n = features.length;
  const band = n > 0 ? plotHeight / n : plotHeight;
  const amplitude = Math.min(band, 30) * 0.35;

  return (
    <svg
      className={cx("n4viz", "n4viz-beeswarm", className)}
      viewBox={`0 0 ${width} ${resolvedHeight}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{title}</title>

      <line
        className="n4viz-reference n4viz-zero"
        x1={round(xZero)}
        x2={round(xZero)}
        y1={plotTop}
        y2={plotBottom}
        stroke={N4_VIZ_COLORS.slate}
        strokeDasharray="5 4"
        strokeWidth={1.4}
      />

      {features.map((feature, fi) => {
        const center = plotTop + band * fi + band / 2;
        const fvExtent = extentOf(feature.points.map((p) => p.featureValue));
        const fvSpan = fvExtent.max - fvExtent.min;
        return (
          <g key={`${feature.label}-${fi}`}>
            <text
              className="n4viz-tick"
              x={plotLeft - 6}
              y={round(center + 3)}
              textAnchor="end"
            >
              {truncate(feature.label)}
            </text>
            {feature.points.map((point, pi) => {
              const norm = fvSpan > 0 ? (point.featureValue - fvExtent.min) / fvSpan : 0.5;
              const cy = center + jitterUnit(pi + fi * 131) * amplitude;
              return (
                <circle
                  key={`p-${fi}-${pi}`}
                  className="n4viz-dot"
                  cx={round(xScale(point.shap))}
                  cy={round(cy)}
                  r={pointRadius}
                  fill={divergingColor(norm)}
                  fillOpacity={0.72}
                />
              );
            })}
          </g>
        );
      })}

      <line className="n4viz-axis" x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} />
      {axisTicks.map((t) => (
        <text
          key={`tx-${t}`}
          className="n4viz-tick"
          x={round(xScale(t))}
          y={plotBottom + 15}
          textAnchor="middle"
        >
          {fmt(t)}
        </text>
      ))}
      <text className="n4viz-axis-label" x={plotLeft + (plotRight - plotLeft) / 2} y={resolvedHeight - 2} textAnchor="middle">
        {xLabel}
      </text>
    </svg>
  );
}
