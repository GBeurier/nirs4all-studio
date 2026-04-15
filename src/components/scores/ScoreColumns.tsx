/**
 * ScoreColumns — unified score display primitives.
 *
 * Consolidates the duplicated InlineMetrics / InlineScores patterns
 * from DatasetResultCard.tsx and ModelTreeView.tsx into reusable components.
 */

import { cn } from "@/lib/utils";
import {
  formatMetricValue,
  getMetricAbbreviation,
  getPrimaryContextMetricLabel,
  isClassificationTaskType,
  isLowerBetter,
} from "@/lib/scores";
import { safeNumber } from "@/lib/fold-utils";
import { TableCell } from "@/components/ui/table";
import type { ScoreCardRow, ScoreCardType } from "@/types/score-cards";

// ============================================================================
// Context label (RMSEP for refit, RMSECV for crossval, etc.)
// ============================================================================

/** Get the display label for a metric key based on card type. */
export function getScoreContextLabel(
  key: string,
  cardType: ScoreCardType,
  primaryMetric: string | null,
  taskType?: string | null,
): string {
  const k = key.toLowerCase();
  const pm = (primaryMetric || "").toLowerCase();
  const isPrimaryMetric = k === pm || ((k === "rmse" || k === "rmsep" || k === "rmsecv") && pm === "rmse");

  if ((cardType === "refit" || cardType === "crossval") && isPrimaryMetric) {
    return getPrimaryContextMetricLabel(primaryMetric || key, cardType, taskType);
  }

  if ((k === "rmse" || k === pm) && isLowerBetter(key)) {
    if (cardType === "refit") return "RMSEP";
    if (cardType === "crossval") return "RMSECV";
  }
  return getMetricAbbreviation(key);
}

// ============================================================================
// extractDisplayScores — get the best available score for each metric
// ============================================================================

/**
 * Extract the best available score for each selected metric from a ScoreCardRow.
 *
 * Priority depends on card type:
 * - refit: testScores → primaryTestScore fallback
 * - crossval: valScores → avgValScores → testScores → avgTestScores
 * - train: testScores → valScores → trainScores
 */
export function extractDisplayScores(
  row: ScoreCardRow,
  selectedMetrics: string[],
): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  const pm = (row.metric || "rmse").toLowerCase();

  for (const k of selectedMetrics) {
    const kl = k.toLowerCase();
    let val: number | null = null;

    if (row.cardType === "refit") {
      val = safeNumber(row.testScores[k]);
      if (val == null && (kl === pm || kl === "rmse")) {
        val = row.primaryTestScore;
      }
    } else if (row.cardType === "crossval") {
      val = safeNumber(row.valScores[k]) ?? safeNumber(row.avgValScores?.[k]);
      if (val == null) val = safeNumber(row.testScores[k]) ?? safeNumber(row.avgTestScores?.[k]);
      if (val == null && (kl === pm || kl === "rmse")) {
        val = row.primaryValScore ?? row.primaryTestScore;
      }
    } else {
      // train card: show the partition's score
      val = safeNumber(row.testScores[k]) ?? safeNumber(row.valScores[k]) ?? safeNumber(row.trainScores[k]);
      if (val == null && (kl === pm || kl === "rmse")) {
        val = row.primaryTestScore ?? row.primaryValScore ?? row.primaryTrainScore;
      }
    }

    result[k] = val;
  }
  return result;
}

// ============================================================================
// InlineScoreDisplay — horizontal flex row of label/value pairs (card layout)
// ============================================================================

interface InlineScoreDisplayProps {
  row: ScoreCardRow;
  selectedMetrics: string[];
  colorClass?: string;
}

export function InlineScoreDisplay({ row, selectedMetrics, colorClass }: InlineScoreDisplayProps) {
  const isClassification = isClassificationTaskType(row.taskType);
  const pm = (row.metric || "").toLowerCase();
  const filteredMetrics = selectedMetrics.filter(metric => {
    const kl = metric.toLowerCase();
    if (isClassification && (kl === "rmse" || kl === "rmsep" || kl === "rmsecv")) return false;
    return true;
  });
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
        const kl = k.toLowerCase();
        const isPrimary = kl === pm
          || ((kl === "rmse" || kl === "rmsep" || kl === "rmsecv") && (pm === "rmse" || pm === "rmsep" || pm === "rmsecv"));
        return (
          <span key={k} className="inline-flex w-[4.5rem] shrink-0 flex-col items-center justify-center text-center">
            <span
              className={cn(
                "min-h-[0.75rem] uppercase text-[8px] leading-none",
                isPrimary ? "font-bold text-foreground" : "text-muted-foreground font-medium",
              )}
            >
              {getScoreContextLabel(k, row.cardType, row.metric, row.taskType)}
            </span>
            <span className={cn(
              "font-mono tabular-nums text-[11px] leading-tight",
              isPrimary ? "font-bold" : "font-semibold",
              colorClass || "text-foreground/80",
            )}>
              {safeVal != null ? formatMetricValue(safeVal, k) : "\u2014"}
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

// ============================================================================
// Utility: color class for card type
// ============================================================================

export function cardTypeColorClass(cardType: ScoreCardType): string {
  switch (cardType) {
    case "refit": return "text-emerald-500";
    case "crossval": return "text-chart-1";
    case "train": return "text-foreground/70";
  }
}

export function cardTypeBorderClass(cardType: ScoreCardType): string {
  switch (cardType) {
    case "refit": return "border-emerald-500/20";
    case "crossval": return "border-chart-1/20";
    case "train": return "border-border/50";
  }
}

export function cardTypeBgClass(cardType: ScoreCardType): string {
  switch (cardType) {
    case "refit": return "bg-emerald-500/5";
    case "crossval": return "bg-chart-1/5";
    case "train": return "";
  }
}
