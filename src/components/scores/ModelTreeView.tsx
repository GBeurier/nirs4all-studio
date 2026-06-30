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
import { getChainPartitionDetail } from "@/api/aggregatedPredictions";
import {
  buildModelTreeDisplayData,
  getModelTreePredictionSiblings,
} from "@/lib/scoreCardTreeData";
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
  onViewDetails?: () => void;
  defaultExpanded?: boolean;
}

// ============================================================================
// ModelTreeView — main component
// ============================================================================

export function ModelTreeView({
  chainId,
  selectedMetrics,
  foldArtifacts,
  onViewPrediction,
  onViewDetails,
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

  const treeDisplay = buildModelTreeDisplayData(predictions, foldArtifacts);
  if (!treeDisplay) {
    return <div className="text-xs text-muted-foreground text-center py-3">No fold data available</div>;
  }

  const handleViewPred = (predictionId: string) => {
    if (!onViewPrediction) return;
    const siblings = getModelTreePredictionSiblings(predictions, predictionId);
    if (!siblings) return;
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
              row={treeDisplay.rootRow}
              selectedMetrics={selectedMetrics}
              variant="inline"
              onViewPrediction={handleViewPred}
              onViewDetails={onViewDetails}
            />
          </div>
        </div>

        {/* Children */}
        <CollapsibleContent>
          <div className="space-y-0.5">
            {treeDisplay.childRows.map(childRow => (
              <ScoreCardRowView
                key={childRow.id}
                row={childRow}
                selectedMetrics={selectedMetrics}
                variant="inline"
                indent={1}
                onViewPrediction={handleViewPred}
                onViewDetails={onViewDetails}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
