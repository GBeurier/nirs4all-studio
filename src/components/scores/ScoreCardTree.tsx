/**
 * ScoreCardTree — hierarchy container for the 3-level score display.
 *
 * Correct hierarchy (max 3 levels, never recursive):
 *
 * REFIT_CARD                      ← level 0 (top-level, expandable)
 *   └─ CROSSVAL_CARD              ← level 1 (pre-attached child, expandable)
 *        ├─ TRAIN_CARD (fold 0)   ← level 2 (lazy-loaded, leaf)
 *        ├─ TRAIN_CARD (fold 1)
 *        └─ ...
 *
 * CROSSVAL_CARD                   ← level 0 (in foldable "CV models" section)
 *   ├─ TRAIN_CARD (fold 0)        ← level 1 (lazy-loaded, leaf)
 *   ├─ TRAIN_CARD (fold 1)
 *   └─ ...
 *
 * TRAIN_CARD                      ← always leaf, never expandable
 */

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { partitionScoreCardRows } from "@/lib/scoreCardTreeData";
import type { ScoreCardRow } from "@/types/score-cards";
import type { PartitionPrediction } from "@/types/aggregated-predictions";
import {
  CrossvalExpandableRow,
  RefitExpandableRow,
} from "./ScoreCardExpandableRows";

// ============================================================================
// Props
// ============================================================================

interface ScoreCardTreeProps {
  rows: ScoreCardRow[];
  selectedMetrics: string[];
  workspaceId?: string;
  variant: "card" | "table";
  onViewDetails?: (row: ScoreCardRow) => void;
  onViewPrediction?: (predictionId: string, prediction?: PartitionPrediction) => void;
  showNonRefitSection?: boolean;
  maxTableMetrics?: number;
  startCollapsed?: boolean;
}

export function ScoreCardTree({
  rows,
  selectedMetrics,
  workspaceId,
  variant,
  onViewDetails,
  onViewPrediction,
  showNonRefitSection = true,
  maxTableMetrics,
  startCollapsed = false,
}: ScoreCardTreeProps) {
  const [nonRefitExpanded, setNonRefitExpanded] = useState(false);

  const { refitRows, cvRows } = useMemo(() => partitionScoreCardRows(rows), [rows]);

  if (variant === "card") {
    return (
      <div className="space-y-3">
        {/* Refit models section */}
        {refitRows.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="font-medium uppercase tracking-wide text-emerald-600">Refit models</span>
              <div className="flex-1 border-t border-emerald-500/20" />
              <span className="text-muted-foreground">{refitRows.length}</span>
            </div>
            {refitRows.map((row, idx) => (
              <RefitExpandableRow
                key={row.id}
                row={row}
                selectedMetrics={selectedMetrics}
                workspaceId={workspaceId}
                rank={idx + 1}
                variant="card"
                onViewDetails={onViewDetails}
                onViewPrediction={onViewPrediction}
                maxTableMetrics={maxTableMetrics}
                defaultExpanded={!startCollapsed}
              />
            ))}
          </div>
        )}

        {/* Non-refit models section (foldable) */}
        {showNonRefitSection && cvRows.length > 0 && (
          <Collapsible open={nonRefitExpanded} onOpenChange={setNonRefitExpanded}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-2 text-[10px] text-muted-foreground w-full hover:bg-muted/20 rounded py-1 px-1 transition-colors">
                {nonRefitExpanded
                  ? <ChevronDown className="h-3 w-3" />
                  : <ChevronRight className="h-3 w-3" />
                }
                <span className="font-medium uppercase tracking-wide">CV models (not refit)</span>
                <div className="flex-1 border-t border-border/40" />
                <span>{cvRows.length}</span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-1 mt-1">
                {cvRows.map((row, idx) => (
                  <CrossvalExpandableRow
                    key={row.id}
                    row={row}
                    selectedMetrics={selectedMetrics}
                    workspaceId={workspaceId}
                    rank={refitRows.length + idx + 1}
                    variant="card"
                    onViewDetails={onViewDetails}
                    onViewPrediction={onViewPrediction}
                    maxTableMetrics={maxTableMetrics}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {rows.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">
            No scored models available
          </div>
        )}
      </div>
    );
  }

  // Table variant
  return (
    <>
      {/* Refit section header */}
      {refitRows.length > 0 && (
        <tr className="hover:bg-transparent">
          <td colSpan={100} className="py-1.5 px-3">
            <div className="flex items-center gap-2 text-[10px]">
              <span className="font-medium uppercase tracking-wide text-emerald-600">Refit models</span>
              <div className="flex-1 border-t border-emerald-500/20" />
              <span className="text-muted-foreground">{refitRows.length}</span>
            </div>
          </td>
        </tr>
      )}
      {refitRows.map((row, idx) => (
        <RefitExpandableRow
          key={row.id}
          row={row}
          selectedMetrics={selectedMetrics}
          workspaceId={workspaceId}
          rank={idx + 1}
          variant="table"
          onViewDetails={onViewDetails}
          onViewPrediction={onViewPrediction}
          maxTableMetrics={maxTableMetrics}
        />
      ))}

      {/* CV section header */}
      {showNonRefitSection && cvRows.length > 0 && (
        <tr className="hover:bg-transparent">
          <td colSpan={100} className="py-1.5 px-3">
            <div className="flex items-center gap-2 text-[10px]">
              <span className="font-medium uppercase tracking-wide text-muted-foreground">CV models (not refit)</span>
              <div className="flex-1 border-t border-border/40" />
              <span className="text-muted-foreground">{cvRows.length}</span>
            </div>
          </td>
        </tr>
      )}
      {showNonRefitSection && cvRows.map((row, idx) => (
        <CrossvalExpandableRow
          key={row.id}
          row={row}
          selectedMetrics={selectedMetrics}
          workspaceId={workspaceId}
          rank={refitRows.length + idx + 1}
          variant="table"
          onViewDetails={onViewDetails}
          onViewPrediction={onViewPrediction}
          maxTableMetrics={maxTableMetrics}
        />
      ))}
    </>
  );
}
