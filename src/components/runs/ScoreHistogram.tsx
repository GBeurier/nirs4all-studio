import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { ScoreDistribution } from "@/types/enriched-runs";

interface ScoreHistogramProps {
  distribution: ScoreDistribution | null;
  selectedPartitions: Set<string>;
}

const PARTITION_COLORS: Record<string, string> = {
  val: "hsl(var(--chart-1))",
  test: "hsl(var(--chart-2))",
  train: "hsl(var(--chart-3))",
  final: "hsl(var(--chart-4))",
};

export function ScoreHistogram({ distribution, selectedPartitions }: ScoreHistogramProps) {
  if (!distribution || Object.keys(distribution.partitions).length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        No score data available
      </div>
    );
  }

  // Build chart data: merge all selected partitions into bins
  // Use the first selected partition's bins as reference
  const activeParts = Array.from(selectedPartitions).filter((p) => distribution.partitions[p]);
  if (activeParts.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        Select a partition to view scores
      </div>
    );
  }

  // Build separate datasets per partition
  const chartData: Array<Record<string, number | string>> = [];
  for (const part of activeParts) {
    const pd = distribution.partitions[part];
    if (!pd) continue;
    for (let i = 0; i < pd.counts.length; i++) {
      const binLabel = `${pd.bins[i].toFixed(3)}-${pd.bins[i + 1]?.toFixed(3) ?? ""}`;
      const existing = chartData.find((d) => d.bin === binLabel);
      if (existing) {
        existing[part] = pd.counts[i];
      } else {
        const entry: Record<string, number | string> = { bin: binLabel };
        entry[part] = pd.counts[i];
        chartData.push(entry);
      }
    }
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="bin" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" height={50} />
        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
        <Tooltip />
        {activeParts.map((part) => (
          <Bar key={part} dataKey={part} fill={PARTITION_COLORS[part] || "hsl(var(--primary))"} opacity={0.8} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
