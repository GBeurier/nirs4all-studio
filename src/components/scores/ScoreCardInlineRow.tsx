import { Badge } from "@/components/ui/badge";
import { buildInlineScoreCardRowPresentation } from "@/lib/scoreCardRowPresentation";
import { cn } from "@/lib/utils";
import {
  Award, Box, ChevronDown, ChevronRight,
} from "lucide-react";
import { InlineScoreCardRowActions } from "./ScoreCardRowActions";
import { ScoreCardScoreDisplay } from "./ScoreCardScoreDisplay";
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
  const {
    borderClass,
    shellClass,
    detailClass,
    paramLabel,
    isRefit,
    isCrossval,
    isTrain,
  } = buildInlineScoreCardRowPresentation(row);

  return (
    <div className={cn("rounded-md border", borderClass, expanded && "bg-muted/5", indent > 0 && "ml-4")}>
      <div className={cn("min-h-[32px] p-1", shellClass)}>
        <button
          className={cn(
            "w-full min-w-0 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/30",
            detailClass,
            expandable || onToggleExpand ? "cursor-pointer" : "cursor-default",
          )}
          onClick={onToggleExpand}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {expandable ? (
              expanded
                ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
            ) : (
              <span className="w-3 shrink-0" />
            )}

            {isRefit && <Award className="h-3.5 w-3.5 text-emerald-500 shrink-0" />}

            {rank != null && (
              <span className={cn("text-xs font-bold shrink-0", isRefit ? "text-emerald-600" : "text-muted-foreground")}>#{rank}</span>
            )}

            <Badge variant="outline" className={cn(
              "min-w-0 max-w-full text-[10px] font-mono",
              isRefit && "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
              isCrossval && "border-chart-1/30 text-chart-1",
            )}>
              <Box className="mr-0.5 h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{row.modelName}</span>
            </Badge>
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-1.5 flex-wrap lg:mt-0 lg:flex-nowrap">
            <ScoreCardTypeBadge row={row} />

            {paramLabel && (
              <span className="min-w-0 truncate text-[10px] text-muted-foreground" title={paramLabel}>
                {paramLabel}
              </span>
            )}

            {isTrain && row.partition && <Badge variant="secondary" className="text-[9px] shrink-0">{row.partition}</Badge>}
            {row.nSamplesEval != null && <span className="text-[10px] text-muted-foreground shrink-0">n={row.nSamplesEval}</span>}
            {isCrossval && row.foldCount != null && row.foldCount > 0 && <span className="text-[10px] text-muted-foreground shrink-0">{row.foldCount} folds</span>}
          </div>
        </button>

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
