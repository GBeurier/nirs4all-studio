import {
  BarChart3,
  Box,
  Database,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { AggregatedResultsStats } from "@/lib/aggregatedResultsData";

interface AggregatedResultsStatsBarProps {
  stats: AggregatedResultsStats;
}

interface StatItem {
  label: string;
  value: number;
  icon: LucideIcon;
}

export function AggregatedResultsStatsBar({ stats }: AggregatedResultsStatsBarProps) {
  const items: StatItem[] = [
    { label: "Chains", value: stats.total, icon: Layers },
    { label: "Datasets", value: stats.datasets, icon: Database },
    { label: "Models", value: stats.models, icon: Box },
    { label: "Metrics", value: stats.metrics, icon: BarChart3 },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {items.map(({ label, value, icon: Icon }) => (
        <Card key={label}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{label}</span>
            </div>
            <p className="text-2xl font-bold mt-1">{value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
