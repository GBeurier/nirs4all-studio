import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { buildInlineScoreCardRowPresentation } from "@/lib/scoreCardRowPresentation";
import { cn } from "@/lib/utils";
import {
  Award, ChevronDown, ChevronRight,
} from "lucide-react";
import { InlineScoreCardRowActions } from "./ScoreCardRowActions";
import { ScoreCardScoreDisplay } from "./ScoreCardScoreDisplay";
import { ScoreCardModelName } from "./ScoreCardModelName";
import { ScoreCardTypeBadge } from "./ScoreCardTypeBadge";
import type { ScoreCardInlineRowProps } from "./ScoreCardRowViewProps";

export function ScoreCardInlineRow({
  row,
  selectedMetrics,
  workspaceId,
  rank,
  expandable,
  expanded,
  onToggleExpand,
  onViewDetails,
  onViewPrediction,
  onViewChart,
  indent = 0,
}: ScoreCardInlineRowProps) {
  const { t } = useTranslation();
  const {
    borderClass,
    shellClass,
    detailClass,
    isRefit,
    isCrossval,
    isTrain,
  } = buildInlineScoreCardRowPresentation(row);

  return (
    <div className={cn("rounded-md border", borderClass, expanded && "bg-muted/5", indent > 0 && "ml-4")}>
      <div className={cn("min-h-[32px] p-1", shellClass)}>
        <div className={cn("w-full min-w-0 px-2 py-1 text-left", detailClass)}>
          <div className="flex min-w-0 items-center gap-1.5">
            {expandable && onToggleExpand ? (
              <button
                type="button"
                className="rounded p-0.5 hover:bg-muted"
                aria-expanded={expanded ?? false}
                aria-label={t("predictions.table.cvOutputs")}
                onClick={onToggleExpand}
              >
                {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              </button>
            ) : (
              <span className="w-3 shrink-0" />
            )}

            {isRefit && <Award className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}

            {rank != null && (
              <span className={cn("text-xs font-bold shrink-0", isRefit ? "text-emerald-600" : "text-muted-foreground")}>#{rank}</span>
            )}

            <ScoreCardModelName row={row} onViewDetails={onViewDetails} />
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-1.5 flex-wrap lg:mt-0 lg:flex-nowrap">
            <ScoreCardTypeBadge row={row} />

            {isTrain && row.partition && <Badge variant="secondary" className="text-[9px] shrink-0">{row.partition}</Badge>}
            {row.nSamplesEval != null && <span className="text-[10px] text-muted-foreground shrink-0">n={row.nSamplesEval}</span>}
            {isCrossval && row.foldCount != null && row.foldCount > 0 && <span className="text-[10px] text-muted-foreground shrink-0">{t("results.scores.row.folds", { count: row.foldCount })}</span>}
          </div>
        </div>

        <div className="mt-1 flex min-w-0 items-center justify-start gap-2 px-2 lg:mt-0 lg:justify-end lg:px-0">
          <ScoreCardScoreDisplay row={row} selectedMetrics={selectedMetrics} />
        </div>

        <InlineScoreCardRowActions
          row={row}
          workspaceId={workspaceId}
          isRefit={isRefit}
          isTrain={isTrain}
          onViewDetails={onViewDetails}
          onViewPrediction={onViewPrediction}
          onViewChart={onViewChart}
        />
      </div>
    </div>
  );
}
