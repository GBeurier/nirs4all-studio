import { cx } from "./_cx.js";
import {
  buildFrame,
  extentOf,
  makeScale,
  niceExtent,
  round,
  ticks,
  type Extent,
  type PlotPadding,
} from "./geometry.js";
import {
  N4_PARTITION_COLORS,
  N4_VIZ_COLORS,
  categoricalColor,
  sequentialColor,
  type PartitionKey,
} from "./theme.js";

/** One projected sample in a 2D embedding (PCA / UMAP / t-SNE). */
export interface PcaPoint {
  x: number;
  y: number;
  group?: string;
  value?: number;
  color?: string;
}

export interface PcaScatterProps {
  points: readonly PcaPoint[];
  /** How to color points: by categorical group, continuous value, or partition. */
  colorMode?: "group" | "value" | "partition";
  /** Explicit group → color overrides (group mode). */
  groupColors?: Record<string, string>;
  /** Explained variance fractions → axis labels `PC1 (xx%)` / `PC2 (yy%)`. */
  explained?: readonly [number, number];
  xLabel?: string;
  yLabel?: string;
  pointRadius?: number;
  pointOpacity?: number;
  width?: number;
  height?: number;
  padding?: PlotPadding;
  /** Small swatch legend (top-right); defaults on for categorical modes. */
  legend?: boolean;
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
 * 2D projection scatter (PCA / UMAP) colored by categorical group, continuous
 * value, or train/validation/test partition — the Studio Playground and Web PCA
 * panel. Pure inline SVG; hosts pass already-projected points.
 */
export function PcaScatter({
  points,
  colorMode = "group",
  groupColors,
  explained,
  xLabel,
  yLabel,
  pointRadius = 3.5,
  pointOpacity = 0.8,
  width = 360,
  height = 320,
  padding,
  legend = true,
  title = "Projection",
  className,
}: PcaScatterProps) {
  const frame = buildFrame(width, height, padding);
  const { top, left } = frame.padding;
  const bottom = top + frame.innerHeight;
  const right = left + frame.innerWidth;

  const xDomain: Extent = niceExtent(points.map((p) => p.x), 0.06);
  const yDomain: Extent = niceExtent(points.map((p) => p.y), 0.06);
  const xScale = makeScale(xDomain, left, right);
  const yScale = makeScale(yDomain, bottom, top);
  const xTicks = ticks(xDomain, 5);
  const yTicks = ticks(yDomain, 5);

  const valueList = points
    .map((p) => p.value)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const valueDomain = extentOf(valueList.length ? valueList : [0, 1]);

  const groupOrder: string[] = [];
  for (const p of points) {
    if (p.group != null && !groupOrder.includes(p.group)) groupOrder.push(p.group);
  }
  const groupColorMap = new Map<string, string>();
  groupOrder.forEach((g, i) => {
    groupColorMap.set(g, groupColors?.[g] ?? categoricalColor(i));
  });

  const colorForGroup = (g: string): string => {
    if (colorMode === "partition") {
      return g in N4_PARTITION_COLORS ? N4_PARTITION_COLORS[g as PartitionKey] : N4_VIZ_COLORS.slate;
    }
    return groupColorMap.get(g) ?? N4_VIZ_COLORS.teal;
  };

  const resolveColor = (p: PcaPoint): string => {
    if (p.color) return p.color;
    if (colorMode === "value") {
      if (typeof p.value !== "number" || !Number.isFinite(p.value)) return N4_VIZ_COLORS.slate;
      const span = valueDomain.max - valueDomain.min || 1;
      return sequentialColor((p.value - valueDomain.min) / span);
    }
    if (p.group != null) return colorForGroup(p.group);
    return N4_VIZ_COLORS.teal;
  };

  const showLegend = legend && colorMode !== "value" && groupOrder.length > 0;
  const resolvedXLabel = xLabel ?? (explained ? `PC1 (${Math.round(explained[0] * 100)}%)` : "PC1");
  const resolvedYLabel = yLabel ?? (explained ? `PC2 (${Math.round(explained[1] * 100)}%)` : "PC2");

  return (
    <svg
      className={cx("n4viz", "n4viz-pca", className)}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{title}</title>

      {xTicks.map((t) => (
        <line
          key={`gx-${t}`}
          className="n4viz-grid"
          x1={round(xScale(t))}
          x2={round(xScale(t))}
          y1={top}
          y2={bottom}
        />
      ))}
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

      {points.map((p, i) => (
        <circle
          key={i}
          className="n4viz-dot"
          cx={round(xScale(p.x))}
          cy={round(yScale(p.y))}
          r={pointRadius}
          fill={resolveColor(p)}
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
        {resolvedXLabel}
      </text>
      <text
        className="n4viz-axis-label"
        transform={`translate(11 ${top + frame.innerHeight / 2}) rotate(-90)`}
        textAnchor="middle"
      >
        {resolvedYLabel}
      </text>

      {showLegend
        ? groupOrder.map((g, i) => {
            const ly = top + 6 + i * 14;
            return (
              <g key={`lg-${g}`} className="n4viz-legend-item">
                <rect className="n4viz-swatch" x={round(right - 10)} y={round(ly)} width={8} height={8} rx={2} fill={colorForGroup(g)} />
                <text className="n4viz-legend-label" x={round(right - 14)} y={round(ly + 8)} textAnchor="end">
                  {g}
                </text>
              </g>
            );
          })
        : null}
    </svg>
  );
}
