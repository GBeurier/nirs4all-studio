/**
 * ModelTreeView — renders a chain's fold hierarchy as a tree.
 *
 * Uses the unified ScoreCardRowView for each fold node.
 * Lazy-loads fold data via getChainPartitionDetail.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { getChainPartitionDetail } from "@/api/client";
import { buildFoldTree, type FoldTreeNode } from "@/lib/fold-utils";
import { partitionPredToTrainCard } from "@/lib/score-adapters";
import { ScoreCardRowView } from "./ScoreCardRowView";
import type { PartitionPrediction } from "@/types/aggregated-predictions";

// ============================================================================
// Props
// ============================================================================

interface ModelTreeViewProps {
  chainId: string;
  selectedMetrics: string[];
  metric: string | null;
  foldArtifacts?: Record<string, string> | null;
  onViewPrediction?: (predictionId: string, siblings: PartitionPrediction[]) => void;
  defaultExpanded?: boolean;
}

// ============================================================================
// ModelTreeView — main component
// ============================================================================

export function ModelTreeView({
  chainId,
  selectedMetrics,
  metric,
  foldArtifacts,
  onViewPrediction,
  defaultExpanded = true,
}: ModelTreeViewProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const { data, isLoading } = useQuery({
    queryKey: ["chain-partition-detail", chainId],
    queryFn: () => getChainPartitionDetail(chainId),
    staleTime: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground justify-center">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading fold details...
      </div>
    );
  }

  const predictions = data?.predictions || [];
  if (predictions.length === 0) {
    return <div className="text-xs text-muted-foreground text-center py-3">No fold data available</div>;
  }

  const tree = buildFoldTree(predictions);
  if (!tree) {
    return <div className="text-xs text-muted-foreground text-center py-3">No fold data available</div>;
  }

  // Convert tree nodes to ScoreCardRows
  const rootRow = partitionPredToTrainCard(tree.prediction);
  rootRow.foldArtifacts = foldArtifacts;

  const handleViewPred = (predictionId: string) => {
    if (!onViewPrediction) return;
    const pred = predictions.find(p => p.prediction_id === predictionId);
    if (!pred) return;
    // Collect all predictions for the same fold so the viewer shows all partitions
    const siblings = pred.fold_id
      ? predictions.filter(p => p.fold_id === pred.fold_id)
      : [pred];
    onViewPrediction(predictionId, siblings);
  };

  return (
    <div className="space-y-0.5">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        {/* Root row */}
        <div className="flex items-center gap-1">
          <CollapsibleTrigger asChild>
            <button className="shrink-0 p-0.5 hover:bg-muted/50 rounded">
              {expanded
                ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                : <ChevronRight className="h-3 w-3 text-muted-foreground" />
              }
            </button>
          </CollapsibleTrigger>
          <div className="flex-1 min-w-0">
            <ScoreCardRowView
              row={rootRow}
              selectedMetrics={selectedMetrics}
              variant="inline"
              onViewPrediction={handleViewPred}
            />
          </div>
        </div>

        {/* Children */}
        <CollapsibleContent>
          <div className="space-y-0.5">
            {tree.children.map(child => {
              const childRow = partitionPredToTrainCard(child.prediction);
              return (
                <ScoreCardRowView
                  key={childRow.id}
                  row={childRow}
                  selectedMetrics={selectedMetrics}
                  variant="inline"
                  indent={1}
                  onViewPrediction={handleViewPred}
                />
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
