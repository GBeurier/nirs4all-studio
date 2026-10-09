import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { foldBadgeClasses, foldLabel } from "@/lib/fold-utils";
import { cn } from "@/lib/utils";
import type { ScoreCardRow } from "@/types/score-cards";

export function ScoreCardTypeBadge({ row }: { row: ScoreCardRow }) {
  const { t } = useTranslation();
  if (row.cardType === "refit" && row.syntheticRefit) {
    return (
      <span className="text-[10px] text-muted-foreground">
        {t("results.scores.cvEstimate")}
      </span>
    );
  }

  if (row.cardType === "refit") {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
          {t("results.scores.badge.refit")}
        </Badge>
        {row.foldId?.endsWith("_agg") && (
          <Badge variant="outline" className="text-[9px] border-purple-500/30 text-purple-500">
            {t("results.scores.badge.aggregated")}
          </Badge>
        )}
      </div>
    );
  }

  if (row.cardType === "crossval") {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant="outline" className="text-[9px] border-chart-1/30 text-chart-1">
          {t("results.scores.badge.cv")}
        </Badge>
        {row.foldId?.endsWith("_agg") && (
          <Badge variant="outline" className="text-[9px] border-purple-500/30 text-purple-500">
            {t("results.scores.badge.aggregated")}
          </Badge>
        )}
      </div>
    );
  }

  if (row.cardType === "train" && row.foldCount === 0 && row.partition === "train") {
    return <Badge variant="outline" className="text-[9px] shrink-0">{t("results.scores.badge.trainingOnly")}</Badge>;
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
