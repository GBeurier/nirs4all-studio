import { Badge } from "@/components/ui/badge";
import { foldBadgeClasses, foldLabel } from "@/lib/fold-utils";
import { cn } from "@/lib/utils";
import type { ScoreCardRow } from "@/types/score-cards";

export function ScoreCardTypeBadge({ row }: { row: ScoreCardRow }) {
  if (row.cardType === "refit") {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
          Refit
        </Badge>
        {row.foldId?.endsWith("_agg") && (
          <Badge variant="outline" className="text-[9px] border-purple-500/30 text-purple-500">
            Aggregated
          </Badge>
        )}
      </div>
    );
  }

  if (row.cardType === "crossval") {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant="outline" className="text-[9px] border-chart-1/30 text-chart-1">
          CV
        </Badge>
        {row.foldId?.endsWith("_agg") && (
          <Badge variant="outline" className="text-[9px] border-purple-500/30 text-purple-500">
            Aggregated
          </Badge>
        )}
      </div>
    );
  }

  if (row.foldId) {
    return (
      <Badge variant="outline" className={cn("text-[9px] shrink-0", foldBadgeClasses(row.foldId))}>
        {foldLabel(row.foldId)}
      </Badge>
    );
  }

  return null;
}
