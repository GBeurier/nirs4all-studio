/**
 * TargetHistogram - Recharts-based histogram for target distribution
 *
 * Displays distribution of target values for regression or classification tasks.
 * Used in dataset previews and quick views.
 */
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import type { TargetDistribution } from "@/types/datasets";

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
  /** Chart width (default: 100%) */
  width?: number | string;
  /** Chart height (default: 150) */
  height?: number | string;
  /** X-axis label (default: based on type) */
  xLabel?: string;
  /** Show axis labels (default: true) */
  showLabels?: boolean;
  /** Bar color override (default: primary) */
  barColor?: string;
  /** Bar fill opacity (default: 0.7) */
  barOpacity?: number;
}

export function buildTargetHistogramData(
  distribution:
    | Pick<TargetDistribution, "type" | "histogram" | "class_counts" | "classes">
    | null
    | undefined,
): HistogramData[] {
  if (!distribution) {
    return [];
  }

  if (distribution.histogram?.length) {
    return distribution.histogram.map(({ bin, count }) => ({ bin, count }));
  }

  if (distribution.type !== "classification" || !distribution.class_counts) {
    return [];
  }

  const orderedLabels = distribution.classes?.length
    ? Array.from(new Set([...distribution.classes, ...Object.keys(distribution.class_counts)]))
    : Object.keys(distribution.class_counts);

  return orderedLabels.map((label) => ({
    bin: label,
    count: distribution.class_counts?.[label] ?? 0,
  }));
}

export function TargetHistogram({
  data,
  type,
  width = "100%",
  height = 150,
  xLabel,
  showLabels = true,
  barColor,
  barOpacity = 0.7,
}: TargetHistogramProps) {
  // Handle empty data
  if (!data?.length) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground text-sm"
        style={{ width, height }}
      >
        No distribution data
      </div>
    );
  }

  // Default label based on type
  const displayLabel = xLabel ?? (type === "regression" ? "Value" : "Class");
  const defaultColor = "hsl(var(--primary))";
  const totalCount = data.reduce((sum, entry) => sum + entry.count, 0);
  const hasDenseCategories = type === "classification" && data.length > 6;

  return (
    <div style={{ width, height }} className="min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{
            top: 20,
            right: 20,
            left: -15, // Compress redundant left padding as Y axis has ticks
            bottom: showLabels ? (hasDenseCategories ? 38 : 20) : 5,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="bin"
            minTickGap={type === "classification" ? 4 : 15}
            interval={type === "classification" && data.length <= 10 ? 0 : "preserveStartEnd"}
            angle={hasDenseCategories ? -30 : 0}
            textAnchor={hasDenseCategories ? "end" : "middle"}
            height={showLabels ? (hasDenseCategories ? 50 : 30) : 20}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={{ stroke: "hsl(var(--border))" }}
            tickFormatter={(value) => {
              if (type === "classification") return String(value);
              const num = Number(value);
              return typeof value === "number" || !isNaN(num) ? num.toFixed(2) : String(value);
            }}
            label={
              showLabels
                ? {
                    value: displayLabel,
                    position: "insideBottom",
                    offset: -15,
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 12,
                  }
                : undefined
            }
          />
          <YAxis
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            width={40}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted))", opacity: 0.2 }}
            contentStyle={{
              borderRadius: "var(--radius)",
              border: "1px solid hsl(var(--border))",
              backgroundColor: "hsl(var(--background))",
              fontSize: "12px",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
            }}
            itemStyle={{ color: "hsl(var(--foreground))" }}
            labelStyle={{ color: "hsl(var(--foreground))", fontWeight: "bold", marginBottom: "4px" }}
            formatter={(value: number) => {
              if (type === "classification") {
                const percentage = totalCount > 0 ? (value / totalCount) * 100 : 0;
                return [`${value.toLocaleString()} (${percentage.toFixed(1)}%)`, "Samples"];
              }
              return [value, "Count"];
            }}
            labelFormatter={(label) => {
              if (type === "regression") {
                const num = Number(label);
                return "Bin: " + (!isNaN(num) ? num.toFixed(3) : label);
              }
              return "Class: " + String(label);
            }}
          />
          <Bar
            dataKey="count"
            fill={barColor ?? defaultColor}
            fillOpacity={barOpacity}
            radius={[4, 4, 0, 0]}
            maxBarSize={type === "classification" ? 72 : 60}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Alias for backward compatibility
export { TargetHistogram as Histogram };
