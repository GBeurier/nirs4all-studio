/**
 * TargetHistogram - SVG-based histogram for target distribution
 *
 * Displays distribution of target values for regression or classification tasks.
 * Used in dataset previews and quick views.
 */

export interface HistogramData {
  /** Bin value or class name */
  bin: number | string;
  /** Count of samples in this bin */
  count: number;
}

export interface TargetHistogramProps {
  /** Histogram data with bins and counts */
  data: HistogramData[];
  /** Type of target: regression (continuous) or classification (categorical) */
  type: "regression" | "classification";
  /** Chart width (default: 300) */
  width?: number;
  /** Chart height (default: 150) */
  height?: number;
  /** X-axis label (default: based on type) */
  xLabel?: string;
  /** Show axis labels (default: true) */
  showLabels?: boolean;
}

export function TargetHistogram({
  data,
  type,
  width = 300,
  height = 150,
  xLabel,
  showLabels = true,
}: TargetHistogramProps) {
  const padding = { top: 10, right: 10, bottom: 25, left: 40 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Handle empty data
  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground text-sm"
        style={{ width, height }}
      >
        No distribution data
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count));
  const barWidth = chartWidth / data.length - 2;

  // Default label based on type
  const displayLabel = xLabel ?? (type === "regression" ? "Value" : "Class");

  return (
    <svg width={width} height={height} className="w-full h-auto">
      {/* Bars */}
      {data.map((d, i) => (
        <rect
          key={i}
          x={padding.left + (chartWidth / data.length) * i + 1}
          y={padding.top + chartHeight * (1 - d.count / maxCount)}
          width={barWidth}
          height={(d.count / maxCount) * chartHeight}
          fill="hsl(var(--primary))"
          fillOpacity={0.7}
          rx={2}
        />
      ))}

      {/* X-axis */}
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={height - padding.bottom}
        y2={height - padding.bottom}
        stroke="currentColor"
        strokeOpacity={0.3}
      />
      {showLabels && (
        <text
          x={width / 2}
          y={height - 5}
          textAnchor="middle"
          className="text-xs fill-muted-foreground"
        >
          {displayLabel}
        </text>
      )}
    </svg>
  );
}

// Alias for backward compatibility
export { TargetHistogram as Histogram };
