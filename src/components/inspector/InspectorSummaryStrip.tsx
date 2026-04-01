import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMetricValue, getMetricAbbreviation } from "@/lib/scores";
import type { InspectorChainSummary, ScoreColumn } from "@/types/inspector";
import type { InspectorOverviewData } from "@/lib/inspector/derived";

interface InspectorSummaryStripProps {
  overview: InspectorOverviewData;
  visibleCount: number;
  totalCount: number;
  selectedCount: number;
  scoreColumn: ScoreColumn;
}

function formatLabel(chain: InspectorChainSummary | null): string {
  if (!chain) return "No ranked chain";
  return `${chain.model_name ?? chain.model_class}${chain.preprocessings ? ` • ${chain.preprocessings}` : ""}`;
}

export function InspectorSummaryStrip({
  overview,
  visibleCount,
  totalCount,
  selectedCount,
  scoreColumn,
}: InspectorSummaryStripProps) {
  const scoreMetric = overview.metric ?? scoreColumn;
  const cards = [
    {
      label: "Scope",
      value: `${visibleCount}/${totalCount}`,
      detail: `${overview.datasetCount} datasets, ${overview.modelCount} model families`,
      tone: "neutral" as const,
    },
    {
      label: "Best Chain",
      value: overview.bestScore != null ? formatMetricValue(overview.bestScore, overview.metric ?? undefined) : "—",
      detail: formatLabel(overview.bestChain),
      tone: "positive" as const,
    },
    {
      label: "Metric",
      value: getMetricAbbreviation(scoreMetric),
      detail: overview.lowerIsBetter ? "Lower is better" : "Higher is better",
      tone: "neutral" as const,
    },
    {
      label: "Selection",
      value: String(selectedCount),
      detail: selectedCount > 0 ? "used for diagnostics" : "top-ranked chains drive diagnostics",
      tone: selectedCount > 0 ? "positive" as const : "neutral" as const,
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {cards.map(card => (
        <Card key={card.label} className="border-border/60 bg-card/90 shadow-sm">
          <CardContent className="flex items-start justify-between gap-3 p-4">
            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {card.label}
              </div>
              <div className="text-2xl font-semibold text-foreground">{card.value}</div>
              <div className="text-xs text-muted-foreground">{card.detail}</div>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "mt-0.5 border-border/60 bg-background/70 text-[10px] uppercase tracking-wide",
                card.tone === "positive" && "border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
              )}
            >
              {card.tone === "positive" ? "Focus" : "Context"}
            </Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
