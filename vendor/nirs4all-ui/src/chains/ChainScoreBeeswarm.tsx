import { buildFrame, clamp, makeScale, niceExtent, round, ticks, type PlotPadding } from "../viz/geometry.js";
import { N4_VIZ_COLORS } from "../viz/theme.js";
import { cx } from "./_cx.js";
import type { ChainEffectAnalysis, ChainPoint, Stat } from "./types.js";
import { CHAIN_LENS_LABELS } from "./types.js";

export interface ChainScoreBeeswarmProps {
  analysis: ChainEffectAnalysis;
  /** Split the corpus on the presence of this token. */
  focusToken: string;
  width?: number;
  height?: number;
  padding?: PlotPadding;
  /** Subsample dots above this count (medians stay exact). Default: draw all. */
  maxPoints?: number;
  withColor?: string;
  withoutColor?: string;
  title?: string;
  className?: string;
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

/** Deterministic [0,1) jitter from a point id (stable across SSR renders). */
function jitter(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function summarize(points: readonly ChainPoint[]): Stat {
  const values = points.map((point) => point.goodness).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (values.length === 0) return { n: 0, min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN, mean: NaN };
  const q = (p: number) => {
    const pos = clamp(p, 0, 1) * (values.length - 1);
    const lo = Math.floor(pos);
    const frac = pos - lo;
    return values[lo]! + ((values[Math.min(values.length - 1, lo + 1)]! - values[lo]!) * frac);
  };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return { n: values.length, min: values[0]!, q1: q(0.25), median: q(0.5), q3: q(0.75), max: values[values.length - 1]!, mean };
}

function subsample(points: readonly ChainPoint[], max?: number): readonly ChainPoint[] {
  if (!max || points.length <= max) return points;
  const step = points.length / max;
  const out: ChainPoint[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[Math.floor(i)]!);
  return out;
}

/**
 * Two-lane distribution comparison — the honest "does this node shift the whole
 * distribution?" picture that complements the forest's point estimate. Every
 * chain is a dot on a shared goodness axis (higher = better), split into a
 * *with* lane and a *without* lane for the focus token, each with a median line
 * and an IQR band. A dashed baseline marks the corpus median. Pure inline SVG.
 */
export function ChainScoreBeeswarm({
  analysis,
  focusToken,
  width = 460,
  height = 220,
  padding,
  maxPoints,
  withColor = N4_VIZ_COLORS.teal,
  withoutColor = N4_VIZ_COLORS.slate,
  title = "Distribution with vs without",
  className,
}: ChainScoreBeeswarmProps) {
  const withPoints = analysis.points.filter((point) => point.tokens.includes(focusToken));
  const withoutPoints = analysis.points.filter((point) => !point.tokens.includes(focusToken));
  const withStat = summarize(withPoints);
  const withoutStat = summarize(withoutPoints);
  const label = analysis.tokens.find((token) => token.token === focusToken)?.label ?? focusToken;

  const frame = buildFrame(width, height, {
    top: padding?.top ?? 30,
    right: padding?.right ?? 16,
    bottom: padding?.bottom ?? 30,
    left: padding?.left ?? 86,
  });
  const { top, left } = frame.padding;
  const plotRight = left + frame.innerWidth;
  const bottom = top + frame.innerHeight;

  const domain = niceExtent(
    [analysis.goodnessExtent.min, analysis.goodnessExtent.max, analysis.baseline],
    0.04,
  );
  const xScale = makeScale(domain, left, plotRight);
  const xTicks = ticks(domain, frame.innerWidth < 220 ? 4 : 5);
  const baselineX = round(clamp(xScale(analysis.baseline), left, plotRight));

  const laneH = frame.innerHeight / 2;
  const lanes = [
    { key: "with", label: `With ${label}`, color: withColor, stat: withStat, points: subsample(withPoints, maxPoints), y0: top },
    { key: "without", label: "Without", color: withoutColor, stat: withoutStat, points: subsample(withoutPoints, maxPoints), y0: top + laneH },
  ];
  const dotBand = laneH - 22;

  return (
    <svg
      className={cx("n4chains", "n4chains-beeswarm", className)}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{title}</title>
      <text className="n4chains-title" x={8} y={16} textAnchor="start">
        {title}
      </text>
      <text className="n4chains-caption" x={round(plotRight)} y={16} textAnchor="end">
        {CHAIN_LENS_LABELS[analysis.lens]} · higher = better
      </text>

      {xTicks.map((t) => (
        <line key={`gx-${t}`} className="n4chains-grid" x1={round(xScale(t))} x2={round(xScale(t))} y1={top} y2={bottom} />
      ))}
      <line className="n4chains-baseline" x1={baselineX} x2={baselineX} y1={top - 2} y2={bottom} />

      {lanes.map((lane) => {
        const laneMid = lane.y0 + laneH / 2;
        const hasIqr = Number.isFinite(lane.stat.q1) && Number.isFinite(lane.stat.q3);
        return (
          <g key={lane.key} className="n4chains-lane" data-lane={lane.key}>
            <text className="n4chains-lane-label" x={left - 8} y={round(laneMid - 4)} textAnchor="end">
              {lane.label}
            </text>
            <text className="n4chains-lane-readout" x={left - 8} y={round(laneMid + 9)} textAnchor="end">
              n={lane.stat.n} · med {fmt(lane.stat.median)}
            </text>

            {hasIqr ? (
              <rect
                className="n4chains-lane-iqr"
                x={round(xScale(lane.stat.q1))}
                y={round(laneMid - dotBand / 2)}
                width={round(Math.max(0, xScale(lane.stat.q3) - xScale(lane.stat.q1)))}
                height={round(dotBand)}
                fill={lane.color}
              />
            ) : null}

            {lane.points.map((point) => (
              <circle
                key={point.id}
                className="n4chains-dot"
                cx={round(xScale(point.goodness))}
                cy={round(laneMid - dotBand / 2 + jitter(point.id) * dotBand)}
                r={2.2}
                fill={lane.color}
              />
            ))}

            {Number.isFinite(lane.stat.median) ? (
              <line
                className="n4chains-lane-median"
                x1={round(xScale(lane.stat.median))}
                x2={round(xScale(lane.stat.median))}
                y1={round(laneMid - dotBand / 2 - 4)}
                y2={round(laneMid + dotBand / 2 + 4)}
                stroke={lane.color}
              />
            ) : null}
          </g>
        );
      })}

      <line className="n4chains-axis" x1={left} x2={plotRight} y1={round(top + laneH)} y2={round(top + laneH)} />
      <line className="n4chains-axis" x1={left} x2={plotRight} y1={bottom} y2={bottom} />
      {xTicks.map((t) => (
        <text key={`tx-${t}`} className="n4chains-tick" x={round(xScale(t))} y={bottom + 14} textAnchor="middle">
          {fmt(t)}
        </text>
      ))}
    </svg>
  );
}
