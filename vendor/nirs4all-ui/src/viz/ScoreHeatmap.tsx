import { cx } from "./_cx.js";
import { clamp, extentOf, round } from "./geometry.js";
import { viridisColor } from "./theme.js";

export interface ScoreHeatmapProps {
  /** Row (y) labels, index-aligned to `values`. */
  rows: readonly string[];
  /** Column (x) labels, index-aligned to each `values` row. */
  cols: readonly string[];
  /** `values[rowIdx][colIdx]`; non-finite entries render as blank cells. */
  values: ReadonlyArray<readonly number[]>;
  /** Maps a 0..1 intensity to a fill (default viridis). */
  colorScale?: (t: number) => string;
  showValues?: boolean;
  valueFormat?: (v: number) => string;
  /** Fixed intensity domain; computed from finite values when omitted. */
  min?: number;
  max?: number;
  width?: number;
  /** Auto-sized from the row count when omitted. */
  height?: number;
  xLabel?: string;
  yLabel?: string;
  title?: string;
  className?: string;
}

function defaultFormat(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

/**
 * 2D performance heatmap (model × preprocessing scores) — the Studio Inspector
 * matrix view. Cells are colored by normalized value through `colorScale`,
 * non-finite entries drop out as blanks, and a compact gradient legend keys the
 * scale. Pure inline SVG; hosts pass labels + a values matrix.
 */
export function ScoreHeatmap({
  rows,
  cols,
  values,
  colorScale = viridisColor,
  showValues = true,
  valueFormat = defaultFormat,
  min,
  max,
  width = 420,
  height,
  xLabel,
  yLabel,
  title = "Performance heatmap",
  className,
}: ScoreHeatmapProps) {
  const resolvedHeight = height ?? Math.max(160, rows.length * 34 + 60);

  const padLeft = 88;
  const padTop = 34;
  const padRight = 52;
  const padBottom = 30;
  const gridLeft = padLeft;
  const gridRight = width - padRight;
  const gridTop = padTop;
  const gridBottom = resolvedHeight - padBottom;
  const gridWidth = Math.max(0, gridRight - gridLeft);
  const gridHeight = Math.max(0, gridBottom - gridTop);
  const cellW = cols.length > 0 ? gridWidth / cols.length : gridWidth;
  const cellH = rows.length > 0 ? gridHeight / rows.length : gridHeight;

  const finiteValues = values.flatMap((row) => row.filter((v): v is number => Number.isFinite(v)));
  const ext = extentOf(finiteValues);
  const lo = min ?? ext.min;
  const hi = max ?? ext.max;
  const span = hi - lo || 1;

  const rotate = cols.length > 6;
  const legendX = gridRight + 14;
  const legendW = 10;
  const segCount = 16;

  return (
    <svg
      className={cx("n4viz", "n4viz-heatmap", className)}
      viewBox={`0 0 ${width} ${resolvedHeight}`}
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{title}</title>

      {rows.map((_, r) =>
        cols.map((__, c) => {
          const raw = values[r]?.[c];
          const hasValue = typeof raw === "number" && Number.isFinite(raw);
          const t = typeof raw === "number" && Number.isFinite(raw) ? clamp((raw - lo) / span, 0, 1) : 0;
          const x = gridLeft + c * cellW;
          const y = gridTop + r * cellH;
          const textFill = t > 0.55 ? "#0f172a" : "#f8fafc";
          return (
            <g key={`cell-${r}-${c}`}>
              <rect
                className="n4viz-cell"
                x={round(x + 1)}
                y={round(y + 1)}
                width={round(cellW - 2)}
                height={round(cellH - 2)}
                rx={4}
                fill={hasValue ? colorScale(t) : "transparent"}
                stroke={hasValue ? "transparent" : "currentColor"}
                strokeOpacity={hasValue ? 0 : 0.18}
              />
              {hasValue && showValues ? (
                <text
                  className="n4viz-cell-value"
                  x={round(x + cellW / 2)}
                  y={round(y + cellH / 2 + 4)}
                  textAnchor="middle"
                  fill={textFill}
                >
                  {typeof raw === "number" ? valueFormat(raw) : ""}
                </text>
              ) : null}
            </g>
          );
        }),
      )}

      {rows.map((label, r) => (
        <text
          key={`row-${label}-${r}`}
          className="n4viz-tick"
          x={gridLeft - 6}
          y={round(gridTop + r * cellH + cellH / 2 + 3)}
          textAnchor="end"
        >
          {label}
        </text>
      ))}
      {cols.map((label, c) => {
        const cx0 = gridLeft + c * cellW + cellW / 2;
        const y = gridTop - 6;
        return rotate ? (
          <text
            key={`col-${label}-${c}`}
            className="n4viz-tick"
            transform={`rotate(-35 ${round(cx0)} ${y})`}
            x={round(cx0)}
            y={y}
            textAnchor="end"
          >
            {label}
          </text>
        ) : (
          <text key={`col-${label}-${c}`} className="n4viz-tick" x={round(cx0)} y={y} textAnchor="middle">
            {label}
          </text>
        );
      })}

      {Array.from({ length: segCount }, (_, k) => {
        const segT = 1 - k / (segCount - 1);
        const segY = gridTop + (k / segCount) * gridHeight;
        return (
          <rect
            key={`legend-${k}`}
            className="n4viz-legend-cell"
            x={legendX}
            y={round(segY)}
            width={legendW}
            height={round(gridHeight / segCount + 0.6)}
            fill={colorScale(segT)}
          />
        );
      })}
      <text className="n4viz-tick" x={round(legendX + legendW / 2)} y={gridTop - 4} textAnchor="middle">
        {valueFormat(hi)}
      </text>
      <text className="n4viz-tick" x={round(legendX + legendW / 2)} y={gridBottom + 11} textAnchor="middle">
        {valueFormat(lo)}
      </text>

      {xLabel ? (
        <text className="n4viz-axis-label" x={gridLeft + gridWidth / 2} y={resolvedHeight - 4} textAnchor="middle">
          {xLabel}
        </text>
      ) : null}
      {yLabel ? (
        <text
          className="n4viz-axis-label"
          transform={`translate(12 ${gridTop + gridHeight / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {yLabel}
        </text>
      ) : null}
    </svg>
  );
}
