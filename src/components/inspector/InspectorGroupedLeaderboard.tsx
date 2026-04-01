import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatMetricValue } from "@/lib/scores";
import { useInspectorSelection } from "@/context/InspectorSelectionContext";
import type { InspectorGroupSummary } from "@/lib/inspector/derived";

interface InspectorGroupedLeaderboardProps {
  summaries: InspectorGroupSummary[];
  metric: string | null;
  emptyMessage: string;
  maxRows?: number;
}

export function InspectorGroupedLeaderboard({
  summaries,
  metric,
  emptyMessage,
  maxRows = 8,
}: InspectorGroupedLeaderboardProps) {
  const { select, selectedChains, hasSelection } = useInspectorSelection();

  const rows = useMemo(() => summaries.slice(0, maxRows), [maxRows, summaries]);

  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground">{emptyMessage}</div>;
  }

  return (
    <ScrollArea className="h-[320px] pr-3">
      <div className="space-y-2">
        {rows.map((row, index) => {
          const active = row.chainIds.length > 0 && row.chainIds.every(chainId => selectedChains.has(chainId));
          const muted = hasSelection && !active;
          return (
            <button
              key={row.label}
              type="button"
              className={cn(
                "flex w-full items-center justify-between rounded-lg border border-border/60 bg-background/70 px-3 py-3 text-left transition-colors",
                active && "border-primary/40 bg-primary/5",
                muted && "opacity-45",
                !active && "hover:bg-accent/30",
              )}
              onClick={() => select(row.chainIds, active ? "remove" : "replace")}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{row.label}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    #{index + 1}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.count} chains
                  {row.spread != null ? ` • spread ${formatMetricValue(row.spread, metric ?? undefined)}` : ""}
                </div>
              </div>

              <div className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 text-right">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Median</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Best</div>
                <div className="text-sm font-semibold text-foreground">
                  {formatMetricValue(row.median, metric ?? undefined)}
                </div>
                <div className="text-sm font-semibold text-foreground">
                  {formatMetricValue(row.best, metric ?? undefined)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
