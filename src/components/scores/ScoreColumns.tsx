/**
 * ScoreColumns — unified score display primitives.
 *
 * Consolidates the duplicated InlineMetrics / InlineScores patterns
 * from DatasetResultCard.tsx and ModelTreeView.tsx into reusable components.
 */

import { cn } from "@/lib/utils";
import {
  canonicalMetricKey,
  formatMetricValue,
} from "@/lib/scores";
import { TableCell } from "@/components/ui/table";
import type { ScoreCardRow } from "@/types/score-cards";
import {
  extractDisplayScores,
  getScoreContextLabel,
} from "@/lib/scoreColumnData";
import { filterScoreRowMetricsForTaskType } from "@/lib/scoreRowData";

// ============================================================================
// InlineScoreDisplay — horizontal flex row of label/value pairs (card layout)
// ============================================================================

interface InlineScoreDisplayProps {
  row: ScoreCardRow;
  selectedMetrics: string[];
  colorClass?: string;
}

export function InlineScoreDisplay({ row, selectedMetrics, colorClass }: InlineScoreDisplayProps) {
  const pm = canonicalMetricKey(row.metric);
  const filteredMetrics = filterScoreRowMetricsForTaskType(selectedMetrics, row.taskType);
  const scores = extractDisplayScores(row, filteredMetrics);
  const visibleMetrics = filteredMetrics.filter(metric => scores[metric] != null);

  if (visibleMetrics.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 items-start gap-1.5 flex-wrap">
      {visibleMetrics.map(k => {
        const val = scores[k];
        const safeVal = val != null && Number.isFinite(val) ? val : null;
        const normalized = canonicalMetricKey(k);
        const isPrimary = !!normalized && normalized === pm;
        return (
          <span key={k} className="inline-flex w-[4.5rem] shrink-0 flex-col items-center justify-center text-center">
            <span
              className={cn(
                "min-h-[0.75rem] uppercase text-[8px] leading-none",
                isPrimary ? "font-bold text-foreground" : "text-muted-foreground font-medium",
              )}
            >
              {getScoreContextLabel(normalized || k, row.cardType, row.metric, row.taskType)}
            </span>
            <span className={cn(
              "font-mono tabular-nums text-[11px] leading-tight",
              isPrimary ? "font-bold" : "font-semibold",
              colorClass || "text-foreground/80",
            )}>
              {safeVal != null ? formatMetricValue(safeVal, normalized || k) : "\u2014"}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ============================================================================
// TableScoreCells — returns <TableCell> elements for table layouts
// ============================================================================

interface TableScoreCellsProps {
  row: ScoreCardRow;
  selectedMetrics: string[];
  /** Max number of metric columns to render (default: 4) */
  maxMetrics?: number;
}

export function TableScoreCells({ row, selectedMetrics, maxMetrics = 4 }: TableScoreCellsProps) {
  const scores = extractDisplayScores(row, selectedMetrics);

  return (
    <>
      {selectedMetrics.slice(0, maxMetrics).map(k => {
        const val = scores[k];
        return (
          <TableCell key={k} className="text-right font-mono text-[11px] text-muted-foreground">
            {val != null ? formatMetricValue(val, k) : "\u2014"}
          </TableCell>
        );
      })}
    </>
  );
}
