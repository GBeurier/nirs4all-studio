/**
 * TargetHistogram - Histogram visualization for target values
 *
 * Shows distribution of target values:
 * - Regression: Continuous histogram with bins
 * - Classification: Bar chart with class counts
 */

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts";
import type { PreviewData } from "../contexts";
import { cn } from "@/lib/utils";

interface TargetHistogramProps {
  data: PreviewData;
  className?: string;
}

const CLASS_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

function getGradientColor(normalizedValue: number): string {
  // Blue to teal to red gradient
  const r = Math.round(normalizedValue * 239 + (1 - normalizedValue) * 59);
  const g = Math.round(normalizedValue * 68 + (1 - normalizedValue) * 130);
  const b = Math.round(normalizedValue * 68 + (1 - normalizedValue) * 246);
  return `rgb(${r}, ${g}, ${b})`;
}

export function TargetHistogram({ data, className }: TargetHistogramProps) {
  const chartData = useMemo(() => {
    const { targets, target_type, statistics } = data;

    if (target_type === "classification" && statistics?.class_distribution) {
      // Classification: bar chart from class distribution
      return {
        type: "classification" as const,
        data: Object.entries(statistics.class_distribution).map(
          ([cls, count], idx) => ({
            name: `Class ${cls}`,
            value: count as number,
            color: CLASS_COLORS[idx % CLASS_COLORS.length],
          })
        ),
      };
    }

    // Regression: create histogram bins
    const numBins = 15;
    const minTarget = Math.min(...targets);
    const maxTarget = Math.max(...targets);
    const range = maxTarget - minTarget || 1;
    const binWidth = range / numBins;

    const bins: number[] = new Array(numBins).fill(0);
    targets.forEach((t) => {
      const binIndex = Math.min(
        Math.floor((t - minTarget) / binWidth),
        numBins - 1
      );
      bins[binIndex]++;
    });

    return {
      type: "regression" as const,
      data: bins.map((count, idx) => {
        const binStart = minTarget + idx * binWidth;
        const binCenter = binStart + binWidth / 2;
        const normalizedValue = (binCenter - minTarget) / range;
        return {
          name: binCenter.toFixed(1),
          value: count,
          color: getGradientColor(normalizedValue),
        };
      }),
    };
  }, [data]);

  if (chartData.data.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <p className="text-sm text-muted-foreground">No target data</p>
      </div>
    );
  }

  return (
    <div className={cn("w-full h-full", className)}>
      <div className="text-xs font-medium text-muted-foreground mb-1 px-2">
        Target Distribution (
        {chartData.type === "classification" ? "Classes" : "Regression"})
      </div>
      <ResponsiveContainer width="100%" height="90%">
        <BarChart
          data={chartData.data}
          margin={{ top: 5, right: 10, left: 0, bottom: 20 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            opacity={0.3}
            vertical={false}
          />
          <XAxis
            dataKey="name"
            stroke="hsl(var(--muted-foreground))"
            fontSize={9}
            tickLine={false}
            axisLine={false}
            interval={chartData.type === "regression" ? 2 : 0}
            angle={chartData.type === "regression" ? -45 : 0}
            textAnchor={chartData.type === "regression" ? "end" : "middle"}
          />
          <YAxis
            stroke="hsl(var(--muted-foreground))"
            fontSize={9}
            tickLine={false}
            axisLine={false}
            width={30}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
              fontSize: 11,
            }}
            formatter={(value: number) => [value, "Count"]}
          />
          <Bar dataKey="value" radius={[2, 2, 0, 0]}>
            {chartData.data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
