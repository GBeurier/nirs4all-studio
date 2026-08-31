import { cx } from "./_cx.js";
import {
  buildFrame,
  fiveNumberSummary,
  makeScale,
  niceExtent,
  round,
  ticks,
  type PlotPadding,
} from "./geometry.js";
import { categoricalColor } from "./theme.js";

/** One category's raw score distribution (summarized into a box internally). */
export interface BoxPlotGroup {
  label: string;
  values: readonly number[];
  color?: string;
}

export interface BoxPlotProps {
  groups: readonly BoxPlotGroup[];
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
 * Box-and-whisker plot per category — a score distribution across categories
 * (Studio's Inspector candlestick view). Each box is a five-number summary with
 * a median line, whiskers over the min→max span, and dots for 1.5·IQR outliers.
 * Pure inline SVG; hosts pass grouped raw values.
 */
export function BoxPlot({
  groups,
  width = 420,
  height = 260,
  padding,
  yLabel = "Score",
  title = "Score distribution",
  className,
}: BoxPlotProps) {
  const frame = buildFrame(width, height, padding);
  const { top, left } = frame.padding;
  const bottom = top + frame.innerHeight;
  const right = left + frame.innerWidth;

  const allValues = groups.flatMap((g) => [...g.values].filter((v) => Number.isFinite(v)));
  const yDomain = niceExtent(allValues.length > 0 ? allValues : [0, 1], 0.06);
  const yScale = makeScale(yDomain, bottom, top);
  const yTicks = ticks(yDomain, 5);

  const slotW = groups.length > 0 ? frame.innerWidth / groups.length : frame.innerWidth;
  const boxHalf = Math.min(slotW * 0.28, 26);

  return (
    <svg
      className={cx("n4viz", "n4viz-boxplot", className)}
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

      {groups.map((group, i) => {
        const center = left + (i + 0.5) * slotW;
        const summary = fiveNumberSummary(group.values);
        const color = group.color ?? categoricalColor(i);
        const hasData = Number.isFinite(summary.q1) && Number.isFinite(summary.q3);
        if (!hasData) return <g key={`box-${group.label}-${i}`} />;

        const iqr = summary.q3 - summary.q1;
        const lowerFence = summary.q1 - 1.5 * iqr;
        const upperFence = summary.q3 + 1.5 * iqr;
        const outliers = [...group.values].filter(
          (v) => Number.isFinite(v) && (v < lowerFence || v > upperFence),
        );

        const yMax = yScale(summary.max);
        const yMin = yScale(summary.min);
        const yq1 = yScale(summary.q1);
        const yq3 = yScale(summary.q3);
        const yMedian = yScale(summary.median);

        return (
          <g key={`box-${group.label}-${i}`}>
            <line
              className="n4viz-whisker"
              x1={round(center)}
              x2={round(center)}
              y1={round(yMax)}
              y2={round(yMin)}
              stroke={color}
              strokeWidth={1.2}
            />
            <line
              className="n4viz-whisker"
              x1={round(center - boxHalf / 2)}
              x2={round(center + boxHalf / 2)}
              y1={round(yMax)}
              y2={round(yMax)}
              stroke={color}
              strokeWidth={1.2}
            />
            <line
              className="n4viz-whisker"
              x1={round(center - boxHalf / 2)}
              x2={round(center + boxHalf / 2)}
              y1={round(yMin)}
              y2={round(yMin)}
              stroke={color}
              strokeWidth={1.2}
            />
            <rect
              className="n4viz-box"
              x={round(center - boxHalf)}
              y={round(yq3)}
              width={round(boxHalf * 2)}
              height={round(Math.max(0, yq1 - yq3))}
              fill={color}
              fillOpacity={0.18}
              stroke={color}
              strokeWidth={1.2}
            />
            <line
              className="n4viz-median"
              x1={round(center - boxHalf)}
              x2={round(center + boxHalf)}
              y1={round(yMedian)}
              y2={round(yMedian)}
              stroke={color}
              strokeWidth={1.8}
            />
            {outliers.map((v, k) => (
              <circle
                key={`out-${i}-${k}`}
                className="n4viz-dot"
                cx={round(center)}
                cy={round(yScale(v))}
                r={2.4}
                fill={color}
                fillOpacity={0.7}
              />
            ))}
          </g>
        );
      })}

      <line className="n4viz-axis" x1={left} x2={right} y1={bottom} y2={bottom} />
      <line className="n4viz-axis" x1={left} x2={left} y1={top} y2={bottom} />

      {groups.map((group, i) => (
        <text
          key={`lx-${group.label}-${i}`}
          className="n4viz-tick"
          x={round(left + (i + 0.5) * slotW)}
          y={bottom + 15}
          textAnchor="middle"
        >
          {group.label}
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
