import type { ReactNode } from "react";

import { cx } from "./_cx.js";
import {
  buildFrame,
  makeScale,
  niceExtent,
  round,
  ticks,
  type Extent,
  type PlotPadding,
} from "./geometry.js";
import { N4_VIZ_COLORS, rampAt } from "./theme.js";
import type { ConformalPredictionRow } from "../conformal/result.js";

/** One nested prediction interval at a nominal coverage level. */
export interface ConformalBand {
  /** Nominal (target) coverage in [0, 1], e.g. 0.9 for a 90% interval. */
  coverage: number;
  lower: number;
  upper: number;
}

/** A single calibrated prediction: a point estimate wrapped by nested intervals. */
export interface ConformalStripSample {
  prediction: number;
  bands: readonly ConformalBand[];
  /** Ground-truth value, when known — drives the covered/missed marker. */
  actual?: number | null;
  label?: string | null;
}

export interface ConformalIntervalStripProps {
  samples: readonly ConformalStripSample[];
  width?: number;
  height?: number;
  padding?: PlotPadding;
  /** Ordering of the sample columns along x. */
  sort?: "index" | "prediction" | "width";
  /**
   * Coverage level treated as the headline guarantee: its band drives the
   * covered/missed classification and the observed-coverage badge. Defaults to
   * the widest coverage present.
   */
  targetCoverage?: number | null;
  unit?: string;
  /** Cap the number of drawn columns (keeps very large test sets responsive). */
  maxSamples?: number;
  coveredColor?: string;
  missedColor?: string;
  predictionColor?: string;
  /** Sequential ramp (pale → dark) for widest → narrowest nested band. */
  bandStops?: readonly string[];
  title?: string;
  yLabel?: string;
  xLabel?: string;
  className?: string;
  children?: ReactNode;
}

/** Sequential teal ramp: widest coverage (least certain area) is palest. */
export const CONFORMAL_BAND_STOPS = ["#5eead4", "#2dd4bf", "#14b8a6", "#0d9488", "#0f766e"] as const;

const COVERED_COLOR = "#059669";
const MISSED_COLOR = N4_VIZ_COLORS.rose;
const PREDICTION_COLOR = N4_VIZ_COLORS.indigo;

/** Map a widest→narrowest rank fraction in [0, 1] to a band shade. */
export function conformalBandShade(rankFraction: number, stops: readonly string[] = CONFORMAL_BAND_STOPS): string {
  return rampAt(stops, rankFraction);
}

/**
 * Adapt the `conformal` domain's per-sample prediction rows (from
 * {@link file://../conformal/result.ts createConformalPredictionRows}) into
 * strip samples, optionally attaching aligned ground-truth values.
 */
export function conformalStripSamplesFromRows(
  rows: readonly ConformalPredictionRow[],
  actuals?: readonly (number | null | undefined)[],
): ConformalStripSample[] {
  return rows.map((row, index) => ({
    prediction: row.yPred,
    label: row.sampleId,
    actual: actuals?.[index] ?? null,
    bands: row.intervals.map((cell) => ({ coverage: cell.coverage, lower: cell.lower, upper: cell.upper })),
  }));
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

function fmtCoverage(coverage: number): string {
  const percent = coverage * 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function sampleWidth(sample: ConformalStripSample, coverage: number): number {
  const band = sample.bands.find((candidate) => candidate.coverage === coverage) ?? widestBand(sample);
  return band ? band.upper - band.lower : Number.POSITIVE_INFINITY;
}

function widestBand(sample: ConformalStripSample): ConformalBand | null {
  let widest: ConformalBand | null = null;
  for (const band of sample.bands) {
    if (widest === null || band.coverage > widest.coverage) widest = band;
  }
  return widest;
}

function isCovered(sample: ConformalStripSample, coverage: number): boolean | null {
  if (sample.actual == null || !Number.isFinite(sample.actual)) return null;
  const band = sample.bands.find((candidate) => candidate.coverage === coverage);
  if (!band) return null;
  return sample.actual >= band.lower && sample.actual <= band.upper;
}

/**
 * Per-sample **nested prediction-interval envelope** — the whole calibrated
 * prediction set at a glance. Each sample is a column of concentric conformal
 * bands (widest coverage palest at the back, narrowest core darkest at the
 * front) centered on the point estimate; when ground truth is supplied it is
 * dropped in as a covered/missed marker so empirical coverage and heteroscedastic
 * uncertainty read together. Pure inline SVG; hosts pass already-shaped samples
 * (adapt `conformal` rows with {@link conformalStripSamplesFromRows}).
 */
export function ConformalIntervalStrip({
  samples,
  width = 640,
  height = 340,
  padding,
  sort = "index",
  targetCoverage = null,
  unit,
  maxSamples = 400,
  coveredColor = COVERED_COLOR,
  missedColor = MISSED_COLOR,
  predictionColor = PREDICTION_COLOR,
  bandStops = CONFORMAL_BAND_STOPS,
  title = "Conformal prediction intervals",
  yLabel,
  xLabel,
  className,
  children,
}: ConformalIntervalStripProps) {
  const frame = buildFrame(width, height, padding ?? { top: 58, right: 18, bottom: 38, left: 50 });
  const { top, left } = frame.padding;
  const bottom = top + frame.innerHeight;
  const right = left + frame.innerWidth;

  const valid = samples.filter(
    (sample) => Number.isFinite(sample.prediction)
      && sample.bands.some((band) => Number.isFinite(band.lower) && Number.isFinite(band.upper)),
  );

  const coverages = [...new Set(valid.flatMap((sample) => sample.bands.map((band) => band.coverage)))]
    .filter((coverage) => Number.isFinite(coverage))
    .sort((leftCoverage, rightCoverage) => rightCoverage - leftCoverage);

  const target = targetCoverage != null && coverages.includes(targetCoverage)
    ? targetCoverage
    : (coverages[0] ?? Number.NaN);

  const shadeOf = (coverage: number): string => {
    if (coverages.length <= 1) return rampAt(bandStops, 0.62);
    const rank = coverages.indexOf(coverage);
    return rampAt(bandStops, rank / (coverages.length - 1));
  };

  const ordered = [...valid];
  if (sort === "prediction") {
    ordered.sort((a, b) => a.prediction - b.prediction);
  } else if (sort === "width") {
    ordered.sort((a, b) => sampleWidth(a, target) - sampleWidth(b, target));
  }
  const drawn = ordered.slice(0, Math.max(1, maxSamples));
  const truncated = ordered.length - drawn.length;

  const valuePool: number[] = [];
  for (const sample of drawn) {
    valuePool.push(sample.prediction);
    if (sample.actual != null && Number.isFinite(sample.actual)) valuePool.push(sample.actual);
    for (const band of sample.bands) {
      if (Number.isFinite(band.lower)) valuePool.push(band.lower);
      if (Number.isFinite(band.upper)) valuePool.push(band.upper);
    }
  }
  const yDomain: Extent = niceExtent(valuePool, 0.06);
  const yScale = makeScale(yDomain, bottom, top);
  const yTicks = ticks(yDomain, 5);

  const slot = frame.innerWidth / Math.max(1, drawn.length);
  const barHalf = Math.max(1, Math.min(13, slot * 0.4));

  // Observed coverage at the target level (over samples with ground truth).
  let covered = 0;
  let evaluated = 0;
  for (const sample of drawn) {
    const state = isCovered(sample, target);
    if (state === null) continue;
    evaluated += 1;
    if (state) covered += 1;
  }
  const observed = evaluated > 0 ? covered / evaluated : null;
  const hasActuals = evaluated > 0;

  const axisLabelY = yLabel ?? (unit ? `Value (${unit})` : "Value");
  const axisLabelX = xLabel ?? `Samples (n = ${valid.length})`;

  // ---- SVG legend (deterministic mono-width slots) ----
  const legendItems: Array<{ kind: "band" | "covered" | "missed"; color: string; label: string }> = [
    ...coverages.map((coverage) => ({ kind: "band" as const, color: shadeOf(coverage), label: fmtCoverage(coverage) })),
  ];
  if (hasActuals) {
    legendItems.push({ kind: "covered", color: coveredColor, label: "covered" });
    legendItems.push({ kind: "missed", color: missedColor, label: "missed" });
  }
  let legendCursor = left;
  const legendY = top - 16;

  return (
    <svg
      className={cx("n4viz", "n4viz-conformal-strip", className)}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{title}</title>

      <text className="n4viz-conf-title" x={left} y={top - 34}>{title}</text>

      {legendItems.map((item, index) => {
        const swatchX = legendCursor;
        const textX = swatchX + 15;
        const advance = 15 + item.label.length * 6.2 + 16;
        legendCursor += advance;
        return (
          <g key={`legend-${item.kind}-${index}`}>
            {item.kind === "band" ? (
              <rect x={swatchX} y={legendY - 8} width={11} height={11} rx={2} fill={item.color} />
            ) : item.kind === "covered" ? (
              <circle cx={swatchX + 5} cy={legendY - 2.5} r={4} fill={item.color} stroke="var(--n4-color-surface, #fff)" strokeWidth={1.5} />
            ) : (
              <path
                d={diamond(swatchX + 5, legendY - 2.5, 4.5)}
                fill="none"
                stroke={item.color}
                strokeWidth={1.8}
              />
            )}
            <text className="n4viz-legend-label" x={textX} y={legendY + 1}>{item.label}</text>
          </g>
        );
      })}

      {observed != null ? (
        <text className="n4viz-conf-readout" x={right} y={top - 34} textAnchor="end">
          {`target ${fmtCoverage(target)} · obs ${fmtCoverage(observed)} (${covered}/${evaluated})`}
        </text>
      ) : Number.isFinite(target) ? (
        <text className="n4viz-conf-readout" x={right} y={top - 34} textAnchor="end">
          {`target ${fmtCoverage(target)}`}
        </text>
      ) : null}

      {yTicks.map((tick) => (
        <line
          key={`grid-${tick}`}
          className="n4viz-grid"
          x1={left}
          x2={right}
          y1={round(yScale(tick))}
          y2={round(yScale(tick))}
        />
      ))}

      {drawn.map((sample, index) => {
        const xc = left + (index + 0.5) * slot;
        const bands = [...sample.bands]
          .filter((band) => Number.isFinite(band.lower) && Number.isFinite(band.upper))
          .sort((a, b) => b.coverage - a.coverage);
        const state = isCovered(sample, target);
        return (
          <g key={sample.label ?? index} className="n4viz-conf-col">
            {bands.map((band) => {
              const yUpper = round(yScale(band.upper));
              const yLower = round(yScale(band.lower));
              const y = Math.min(yUpper, yLower);
              const bandHeight = Math.max(1, Math.abs(yLower - yUpper));
              const emphasized = band.coverage === target;
              return (
                <rect
                  key={`band-${band.coverage}`}
                  className={cx("n4viz-conf-band", emphasized && "n4viz-conf-band--target")}
                  x={round(xc - barHalf)}
                  y={y}
                  width={round(barHalf * 2)}
                  height={bandHeight}
                  rx={Math.min(2.5, barHalf)}
                  fill={shadeOf(band.coverage)}
                />
              );
            })}

            <line
              className="n4viz-conf-point"
              x1={round(xc - barHalf)}
              x2={round(xc + barHalf)}
              y1={round(yScale(sample.prediction))}
              y2={round(yScale(sample.prediction))}
              stroke={predictionColor}
              strokeWidth={2}
            />

            {state != null && sample.actual != null && Number.isFinite(sample.actual) ? (
              state ? (
                <circle
                  className="n4viz-conf-actual"
                  cx={round(xc)}
                  cy={round(yScale(sample.actual))}
                  r={3.4}
                  fill={coveredColor}
                  stroke="var(--n4-color-surface, #fff)"
                  strokeWidth={1.6}
                />
              ) : (
                <path
                  className="n4viz-conf-actual"
                  d={diamond(xc, yScale(sample.actual), 4.2)}
                  fill={missedColor}
                  stroke="var(--n4-color-surface, #fff)"
                  strokeWidth={1.6}
                />
              )
            ) : null}
          </g>
        );
      })}

      <line className="n4viz-axis" x1={left} x2={right} y1={bottom} y2={bottom} />
      <line className="n4viz-axis" x1={left} x2={left} y1={top} y2={bottom} />
      {yTicks.map((tick) => (
        <text key={`ty-${tick}`} className="n4viz-tick" x={left - 6} y={round(yScale(tick)) + 3} textAnchor="end">
          {fmt(tick)}
        </text>
      ))}
      <text className="n4viz-axis-label" x={left + frame.innerWidth / 2} y={height - 2} textAnchor="middle">
        {truncated > 0 ? `${axisLabelX} · showing ${drawn.length}` : axisLabelX}
      </text>
      <text
        className="n4viz-axis-label"
        transform={`translate(12 ${top + frame.innerHeight / 2}) rotate(-90)`}
        textAnchor="middle"
      >
        {axisLabelY}
      </text>

      {valid.length === 0 ? (
        <text className="n4viz-conf-empty" x={left + frame.innerWidth / 2} y={top + frame.innerHeight / 2} textAnchor="middle">
          No calibrated intervals
        </text>
      ) : null}
      {children}
    </svg>
  );
}

function diamond(cx: number, cy: number, radius: number): string {
  const x = round(cx);
  const y = round(cy);
  const r = round(radius);
  return `M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`;
}
