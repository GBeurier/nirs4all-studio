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

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getChainPartitionDetail } from "@/api/client";
import { buildFoldTrainCards, enrichCrossvalRow } from "@/lib/score-adapters";
import { ScoreCardRowView } from "./ScoreCardRowView";
import type { ScoreCardRow } from "@/types/score-cards";
import type { PartitionPrediction } from "@/types/aggregated-predictions";

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

// ============================================================================
// CrossvalExpandable — a CROSSVAL row that lazily loads TRAIN children
// ============================================================================

function CrossvalExpandable({
  row,
  selectedMetrics,
  workspaceId,
  rank,
  variant,
  onViewDetails,
  onViewPrediction,
  maxTableMetrics,
  indent = 0,
  defaultExpanded = false,
}: {
  row: ScoreCardRow;
  selectedMetrics: string[];
  workspaceId?: string;
  rank?: number;
  variant: "card" | "table";
  onViewDetails?: (row: ScoreCardRow) => void;
  onViewPrediction?: (predictionId: string, prediction?: PartitionPrediction) => void;
  maxTableMetrics?: number;
  indent?: number;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Lazy-fetch fold details → build TRAIN children (numbered folds only)
  const { data: foldData, isLoading } = useQuery({
    queryKey: ["chain-partition-detail", row.chainId],
    queryFn: () => getChainPartitionDetail(row.chainId),
    enabled: !!row.chainId,
    staleTime: 60000,
  });

  const trainChildren = useMemo(() => {
    if (!foldData?.predictions) return [];
    return buildFoldTrainCards(foldData.predictions, {
      runId: row.runId,
      pipelineId: row.pipelineId,
      datasetName: row.datasetName,
      modelName: row.modelName,
      modelClass: row.modelClass,
      preprocessings: row.preprocessings,
      bestParams: row.bestParams,
      metric: row.metric,
      taskType: row.taskType,
    }, row.foldId?.endsWith("_agg") ? "aggregated" : "raw");
  }, [foldData, row]);

  const displayRow = useMemo(() => {
    if (!foldData?.predictions) return row;
    return enrichCrossvalRow(row, foldData.predictions);
  }, [foldData, row]);

  const handleViewPred = (predictionId: string) => {
    if (!onViewPrediction) return;
    const pred = foldData?.predictions?.find(p => p.prediction_id === predictionId);
    onViewPrediction(predictionId, pred);
  };

  if (variant === "card") {
    return (
      <div>
        <ScoreCardRowView
          row={displayRow}
          selectedMetrics={selectedMetrics}
          workspaceId={workspaceId}
          rank={rank}
          variant="inline"
          expandable
          expanded={expanded}
          onToggleExpand={() => setExpanded(!expanded)}
          onViewDetails={onViewDetails ? () => onViewDetails(displayRow) : undefined}
          indent={indent}
        />
        {expanded && (
          <div className="ml-6 mt-0.5 space-y-0.5 border-l-2 border-border/30 pl-2">
            {isLoading && (
              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading folds...
              </div>
            )}
            {trainChildren.map(child => (
              <ScoreCardRowView
                key={child.id}
                row={child}
                selectedMetrics={selectedMetrics}
                workspaceId={workspaceId}
                variant="inline"
                onViewPrediction={onViewPrediction ? handleViewPred : undefined}
              />
            ))}
            {!isLoading && trainChildren.length === 0 && (
              <div className="text-xs text-muted-foreground py-1">No fold data</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Table variant
  return (
    <>
      <ScoreCardRowView
        row={displayRow}
        selectedMetrics={selectedMetrics}
        workspaceId={workspaceId}
        rank={rank}
        variant="table-row"
        expandable
        expanded={expanded}
        onToggleExpand={() => setExpanded(!expanded)}
        onViewDetails={onViewDetails ? () => onViewDetails(displayRow) : undefined}
        maxTableMetrics={maxTableMetrics}
      />
      {expanded && (
        <tr>
          <td colSpan={100} className="p-0">
            <div className="border-t bg-muted/10 px-4 py-2 space-y-0.5 ml-8 border-l-2 border-border/30">
              {isLoading && (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading folds...
                </div>
              )}
              {trainChildren.map(child => (
                <ScoreCardRowView
                  key={child.id}
                  row={child}
                  selectedMetrics={selectedMetrics}
                  workspaceId={workspaceId}
                  variant="inline"
                  onViewPrediction={onViewPrediction ? handleViewPred : undefined}
                />
              ))}
              {!isLoading && trainChildren.length === 0 && (
                <div className="text-xs text-muted-foreground py-1">No fold data</div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ============================================================================
// RefitExpandable — a REFIT row whose children are pre-attached CROSSVAL cards
// ============================================================================

function RefitExpandable({
  row,
  selectedMetrics,
  workspaceId,
  rank,
  variant,
  onViewDetails,
  onViewPrediction,
  maxTableMetrics,
  defaultExpanded = false,
}: {
  row: ScoreCardRow;
  selectedMetrics: string[];
  workspaceId?: string;
  rank?: number;
  variant: "card" | "table";
  onViewDetails?: (row: ScoreCardRow) => void;
  onViewPrediction?: (predictionId: string, prediction?: PartitionPrediction) => void;
  maxTableMetrics?: number;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Pre-attached CROSSVAL children (from topChainToRows / chainSummaryToRow)
  const crossvalChildren = row.children?.filter(c => c.cardType === "crossval") || [];

  if (variant === "card") {
    return (
      <div>
        <ScoreCardRowView
          row={row}
          selectedMetrics={selectedMetrics}
          workspaceId={workspaceId}
          rank={rank}
          variant="inline"
          expandable
          expanded={expanded}
          onToggleExpand={() => setExpanded(!expanded)}
          onViewDetails={onViewDetails ? () => onViewDetails(row) : undefined}
        />
        {expanded && (
          <div className="ml-4 mt-0.5 space-y-0.5">
            {crossvalChildren.map(cvRow => (
              <CrossvalExpandable
                key={cvRow.id}
                row={cvRow}
                selectedMetrics={selectedMetrics}
                workspaceId={workspaceId}
                variant="card"
                onViewDetails={onViewDetails}
                onViewPrediction={onViewPrediction}
                maxTableMetrics={maxTableMetrics}
                indent={1}
                defaultExpanded
              />
            ))}
            {crossvalChildren.length === 0 && (
              <div className="text-xs text-muted-foreground py-1 ml-2">No CV data</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Table variant
  return (
    <>
      <ScoreCardRowView
        row={row}
        selectedMetrics={selectedMetrics}
        workspaceId={workspaceId}
        rank={rank}
        variant="table-row"
        expandable
        expanded={expanded}
        onToggleExpand={() => setExpanded(!expanded)}
        onViewDetails={onViewDetails ? () => onViewDetails(row) : undefined}
        maxTableMetrics={maxTableMetrics}
      />
      {expanded && (
        <tr>
          <td colSpan={100} className="p-0">
            <div className="border-t bg-muted/10 px-4 py-2 space-y-1">
              {crossvalChildren.map(cvRow => (
                <CrossvalExpandable
                  key={cvRow.id}
                  row={cvRow}
                  selectedMetrics={selectedMetrics}
                  workspaceId={workspaceId}
                  variant="card"
                  onViewDetails={onViewDetails}
                  onViewPrediction={onViewPrediction}
                  maxTableMetrics={maxTableMetrics}
                />
              ))}
              {crossvalChildren.length === 0 && (
                <div className="text-xs text-muted-foreground py-1">No CV data</div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ============================================================================
// ScoreCardTree — main component
// ============================================================================

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

  const { refitRows, cvRows } = useMemo(() => {
    const refit = rows.filter(r => r.cardType === "refit");
    const cv = rows.filter(r => r.cardType === "crossval");
    return { refitRows: refit, cvRows: cv };
  }, [rows]);

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
              <RefitExpandable
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
                  <CrossvalExpandable
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
        <RefitExpandable
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
        <CrossvalExpandable
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
