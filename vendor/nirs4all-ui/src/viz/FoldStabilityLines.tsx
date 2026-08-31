import { cx } from "./_cx.js";
import {
  bandPath,
  buildFrame,
  linePath,
  makeScale,
  mean,
  niceExtent,
  round,
  ticks,
  type PlotPadding,
} from "./geometry.js";
import { categoricalColor, N4_VIZ_COLORS } from "./theme.js";

/** One model / chain's cross-validation scores, index-aligned to the fold axis. */
export interface FoldSeries {
  id: string;
  label?: string;
  scores: readonly number[];
  color?: string;
}

export interface FoldStabilityLinesProps {
  series: readonly FoldSeries[];
  /** X-axis fold labels (default "F1".."Fn" from the longest series). */
  foldLabels?: readonly string[];
  /** Draw the emphasized cross-series mean line + min/max envelope (default true). */
  showMean?: boolean;
  width?: number;
  height?: number;
  padding?: PlotPadding;
  yLabel?: string;
  title?: string;
  className?: string;
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

/**
 * Per-fold cross-validation stability chart — the Studio Inspector fold-stability
 * view. One faint line per model/chain across the fold axis, with an emphasized
 * cross-series mean line and a shaded min/max envelope highlighting agreement.
 * Pure inline SVG; hosts pass per-fold score arrays.
 */
export function FoldStabilityLines({
  series,
  foldLabels,
  showMean = true,
  width = 460,
  height = 260,
  padding,
  yLabel = "Score",
  title = "Fold stability",
  className,
}: FoldStabilityLinesProps) {
  const frame = buildFrame(width, height, padding);
  const { top, left } = frame.padding;
  const bottom = top + frame.innerHeight;
  const right = left + frame.innerWidth;

  const foldCount = series.reduce((m, s) => Math.max(m, s.scores.length), 0);
  const labels = foldLabels ?? Array.from({ length: foldCount }, (_, i) => `F${i + 1}`);

  const foldSpan = Math.max(1, foldCount - 1);
  const xAt = (i: number): number =>
    foldCount <= 1 ? left + frame.innerWidth / 2 : left + (i / foldSpan) * frame.innerWidth;

  const allScores = series.flatMap((s) => s.scores.filter((v) => Number.isFinite(v)));
  const yDomain = niceExtent(allScores.length > 0 ? allScores : [0, 1], 0.08);
  const yScale = makeScale(yDomain, bottom, top);
  const yTicks = ticks(yDomain, 5);

  const foldStats: Array<{ i: number; mean: number; min: number; max: number }> = [];
  for (let i = 0; i < foldCount; i += 1) {
    const vals = series
      .map((s) => s.scores[i])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (vals.length === 0) continue;
    foldStats.push({ i, mean: mean(vals), min: Math.min(...vals), max: Math.max(...vals) });
  }

  const showEnvelope = showMean && foldStats.length > 0;
  const meanPoints = foldStats.map((f) => [xAt(f.i), yScale(f.mean)] as [number, number]);
  const upperPoints = foldStats.map((f) => [xAt(f.i), yScale(f.max)] as [number, number]);
  const lowerPoints = foldStats.map((f) => [xAt(f.i), yScale(f.min)] as [number, number]);

  return (
    <svg
      className={cx("n4viz", "n4viz-foldstability", className)}
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

      {showEnvelope ? (
        <path
          className="n4viz-band"
          d={bandPath(upperPoints, lowerPoints)}
          fill={N4_VIZ_COLORS.teal}
          fillOpacity={0.12}
          stroke="none"
        />
      ) : null}

      {series.map((s, i) => {
        const points: Array<[number, number]> = [];
        s.scores.forEach((v, fi) => {
          if (Number.isFinite(v)) points.push([xAt(fi), yScale(v)]);
        });
        if (points.length === 0) return <g key={s.id} />;
        return (
          <path
            key={s.id}
            className="n4viz-line"
            d={linePath(points)}
            fill="none"
            stroke={s.color ?? categoricalColor(i)}
            strokeOpacity={0.4}
            strokeWidth={1.3}
          />
        );
      })}

      {showEnvelope ? (
        <path
          className="n4viz-line n4viz-line-mean"
          d={linePath(meanPoints)}
          fill="none"
          stroke={N4_VIZ_COLORS.tealDark}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}

      <line className="n4viz-axis" x1={left} x2={right} y1={bottom} y2={bottom} />
      <line className="n4viz-axis" x1={left} x2={left} y1={top} y2={bottom} />

      {labels.map((label, i) => (
        <text
          key={`lx-${label}-${i}`}
          className="n4viz-tick"
          x={round(xAt(i))}
          y={bottom + 15}
          textAnchor="middle"
        >
          {label}
        </text>
      ))}
      {yTicks.map((t) => (
        <text key={`ty-${t}`} className="n4viz-tick" x={left - 6} y={round(yScale(t)) + 3} textAnchor="end">
          {fmt(t)}
        </text>
      ))}
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
