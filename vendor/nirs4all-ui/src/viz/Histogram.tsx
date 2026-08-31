import { cx } from "./_cx.js";
import {
  buildFrame,
  extentOf,
  histogram,
  makeScale,
  mean,
  round,
  ticks,
  type PlotPadding,
} from "./geometry.js";
import { N4_VIZ_COLORS } from "./theme.js";

/** A precomputed categorical bar (e.g. one class of a classification target). */
export interface HistogramBar {
  label: string;
  count: number;
}

export interface HistogramProps {
  /** Raw numeric samples, binned internally (regression variant). */
  values?: readonly number[];
  /** Precomputed categorical counts (classification variant). */
  bins?: readonly HistogramBar[];
  variant?: "regression" | "classification";
  /** Number of equal-width bins for the regression variant. */
  binCount?: number;
  barColor?: string;
  /** Draw a dashed vertical mean reference (regression variant only). */
  meanLine?: boolean;
  width?: number;
  height?: number;
  padding?: PlotPadding;
  xLabel?: string;
  yLabel?: string;
  title?: string;
  className?: string;
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

function fmtCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Bar histogram of a target / score / prediction distribution. Regression bins
 * raw `values` into equal-width buckets (optionally with a dashed mean line);
 * classification renders precomputed categorical `bins`. Pure inline SVG — no
 * chart library, no state.
 */
export function Histogram({
  values,
  bins,
  variant = "regression",
  binCount = 12,
  barColor = N4_VIZ_COLORS.teal,
  meanLine = false,
  width = 360,
  height = 220,
  padding,
  xLabel,
  yLabel = "Count",
  title = "Distribution",
  className,
}: HistogramProps) {
  const frame = buildFrame(width, height, padding);
  const { top, left } = frame.padding;
  const bottom = top + frame.innerHeight;
  const right = left + frame.innerWidth;

  const isClassification = variant === "classification";
  const numericBins = isClassification ? [] : histogram(values ?? [], binCount);
  const categorical = bins ?? [];

  const counts = isClassification ? categorical.map((b) => b.count) : numericBins.map((b) => b.count);
  const maxCount = Math.max(1, ...counts.filter((c) => Number.isFinite(c)));
  const yDomain = { min: 0, max: maxCount };
  const yScale = makeScale(yDomain, bottom, top);
  const yTicks = ticks(yDomain, 4);

  const firstBin = numericBins[0];
  const lastBin = numericBins[numericBins.length - 1];
  const xDomain = firstBin && lastBin ? { min: firstBin.x0, max: lastBin.x1 } : extentOf(values ?? []);
  const xScale = makeScale(xDomain, left, right);
  const xTicks = ticks(xDomain, 5);

  const slotW = categorical.length > 0 ? frame.innerWidth / categorical.length : frame.innerWidth;
  const barW = slotW * 0.62;
  const rotateLabels = categorical.length > 6;

  const meanValue = mean(values ?? []);
  const showMean = meanLine && !isClassification && numericBins.length > 0 && Number.isFinite(meanValue);

  return (
    <svg
      className={cx("n4viz", "n4viz-histogram", className)}
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

      {isClassification
        ? categorical.map((bar, i) => {
            const center = left + (i + 0.5) * slotW;
            const y = yScale(bar.count);
            return (
              <rect
                key={`${bar.label}-${i}`}
                className="n4viz-bar"
                x={round(center - barW / 2)}
                y={round(y)}
                width={round(barW)}
                height={round(Math.max(0, bottom - y))}
                fill={barColor}
              />
            );
          })
        : numericBins.map((bin, i) => {
            const x0 = xScale(bin.x0);
            const x1 = xScale(bin.x1);
            const y = yScale(bin.count);
            return (
              <rect
                key={`bin-${i}`}
                className="n4viz-bar"
                x={round(x0 + 0.5)}
                y={round(y)}
                width={round(Math.max(0, x1 - x0 - 1))}
                height={round(Math.max(0, bottom - y))}
                fill={barColor}
              />
            );
          })}

      {showMean ? (
        <line
          className="n4viz-reference n4viz-mean"
          x1={round(xScale(meanValue))}
          x2={round(xScale(meanValue))}
          y1={top}
          y2={bottom}
          stroke={N4_VIZ_COLORS.amber}
          strokeDasharray="5 4"
          strokeWidth={1.4}
        />
      ) : null}

      <line className="n4viz-axis" x1={left} x2={right} y1={bottom} y2={bottom} />
      <line className="n4viz-axis" x1={left} x2={left} y1={top} y2={bottom} />

      {isClassification
        ? categorical.map((bar, i) => {
            const center = left + (i + 0.5) * slotW;
            return rotateLabels ? (
              <text
                key={`lx-${bar.label}-${i}`}
                className="n4viz-tick"
                transform={`translate(${round(center)} ${bottom + 12}) rotate(-30)`}
                textAnchor="end"
              >
                {bar.label}
              </text>
            ) : (
              <text
                key={`lx-${bar.label}-${i}`}
                className="n4viz-tick"
                x={round(center)}
                y={bottom + 15}
                textAnchor="middle"
              >
                {bar.label}
              </text>
            );
          })
        : xTicks.map((t) => (
            <text key={`tx-${t}`} className="n4viz-tick" x={round(xScale(t))} y={bottom + 15} textAnchor="middle">
              {fmt(t)}
            </text>
          ))}

      {yTicks.map((t) => (
        <text key={`ty-${t}`} className="n4viz-tick" x={left - 6} y={round(yScale(t)) + 3} textAnchor="end">
          {fmtCount(t)}
        </text>
      ))}

      {xLabel ? (
        <text className="n4viz-axis-label" x={left + frame.innerWidth / 2} y={height - 2} textAnchor="middle">
          {xLabel}
        </text>
      ) : null}
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
