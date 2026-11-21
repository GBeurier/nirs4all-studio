import { TableCell, TableRow } from "@/components/ui/table";
import { getScoreCardAnyScore } from "@/lib/scoreRowData";
import { buildTableScoreCardRowPresentation } from "@/lib/scoreCardRowPresentation";
import { formatMetricValue } from "@/lib/scores";
import { cn } from "@/lib/utils";
import { Award, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TableScoreCardRowActions } from "./ScoreCardRowActions";
import { ScoreCardModelName } from "./ScoreCardModelName";
import { ScoreCardTypeBadge } from "./ScoreCardTypeBadge";
import type { ScoreCardTableRowProps } from "./ScoreCardRowViewProps";

export function ScoreCardTableRow({
  row,
  selectedMetrics,
  workspaceId,
  rank,
  expanded,
  onToggleExpand,
  onViewDetails,
  onViewPrediction,
  onViewChart,
  maxTableMetrics,
}: ScoreCardTableRowProps) {
  const { t } = useTranslation();
  const {
    isRefit,
    metric,
    foldDisplay,
    tableMetricKeys,
  } = buildTableScoreCardRowPresentation(row, selectedMetrics, maxTableMetrics);

  return (
    <TableRow className={cn("text-xs", isRefit && "bg-emerald-500/5", expanded && "bg-primary/5")}>
      <TableCell>
        {rank != null && (
          <span className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold", rank === 1 && isRefit ? "bg-emerald-500/20 text-emerald-500" : "bg-muted text-muted-foreground")}>{rank}</span>
        )}
      </TableCell>
      <TableCell><ScoreCardTypeBadge row={row} /></TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          {onToggleExpand && (
            <button
              type="button"
              className="rounded p-0.5 hover:bg-muted"
              aria-expanded={expanded ?? false}
              aria-label={t("predictions.table.cvOutputs")}
              onClick={onToggleExpand}
            >
              {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
          )}
          {isRefit && <Award className="h-3 w-3 text-emerald-500 shrink-0" />}
          <ScoreCardModelName row={row} onViewDetails={onViewDetails} />
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{row.datasetName || "\u2014"}</TableCell>
      <TableCell><span className="text-[10px] text-muted-foreground truncate max-w-[120px] block">{row.preprocessings || "\u2014"}</span></TableCell>
      <TableCell className="text-right">
        <span className={cn("font-mono font-semibold", isRefit ? "text-emerald-500" : "text-muted-foreground")}>
          {row.primaryTestScore != null ? formatMetricValue(row.primaryTestScore, metric) : "\u2014"}
        </span>
      </TableCell>
      <TableCell className="text-right font-mono text-chart-1">{row.primaryValScore != null ? formatMetricValue(row.primaryValScore, metric) : "\u2014"}</TableCell>
      <TableCell className="text-right text-muted-foreground">{foldDisplay}</TableCell>
      {tableMetricKeys.map(k => {
        const val = getScoreCardAnyScore(row, k);
        return <TableCell key={k} className="text-right font-mono text-[11px] text-muted-foreground">{val != null ? formatMetricValue(val, k) : "\u2014"}</TableCell>;
      })}
      <TableScoreCardRowActions
        row={row}
        workspaceId={workspaceId}
        onViewDetails={onViewDetails}
        onViewPrediction={onViewPrediction}
        onViewChart={onViewChart}
      />
    </TableRow>
  );
}
