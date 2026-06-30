import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2 } from "lucide-react";
import { deleteWorkspaceDatasetPredictions } from "@/api/linkedWorkspaces";
import { ScoreCardTree } from "./ScoreCardTree";
import { DatasetResultCardHeader } from "./DatasetResultCardHeader";
import { DatasetResultDeleteDialog } from "./DatasetResultDeleteDialog";
import { ChainDetailSheet } from "@/components/predictions/ChainDetailSheet";
import { PredictionViewer } from "@/components/predictions/viewer/PredictionViewer";
import { useDatasetResultCardQueries } from "./useDatasetResultCardQueries";
import { useDatasetResultCardViewState } from "./useDatasetResultCardViewState";
import { usePredictionDeletionAction } from "./usePredictionDeletionAction";
import type { TopChainResult, EnrichedDatasetRun } from "@/types/enriched-runs";

// ============================================================================
// Props
// ============================================================================

interface DatasetResultCardProps {
  dataset: EnrichedDatasetRun;
  allChains?: TopChainResult[];
  selectedMetrics: string[];
  runId?: string;
  workspaceId?: string;
  defaultExpanded?: boolean;
}

// ============================================================================
// DatasetResultCard — main component
// ============================================================================

/**
 * DatasetResultCard — displays results for a single dataset in a hierarchical layout.
 *
 * Uses ScoreCardTree with the unified REFIT/CROSSVAL/TRAIN card hierarchy.
 *
 * Reused in both Results page and Runs page (RunItem).
 */
export function DatasetResultCard({
  dataset, allChains, selectedMetrics, runId, workspaceId, defaultExpanded = false,
}: DatasetResultCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const {
    detailChainId,
    detailMetaHint,
    detailFocus,
    detailOpen,
    setDetailOpen,
    detailViewerHeader,
    detailViewerPartitions,
    detailViewerKind,
    detailViewerOpen,
    setDetailViewerOpen,
    quickViewPred,
    quickViewOpen,
    setQuickViewOpen,
    openDetail,
    openDetailViewer,
    openQuickViewPrediction,
  } = useDatasetResultCardViewState(dataset);
  const {
    deleteOpen,
    setDeleteOpen,
    deleteBusy,
    handleDelete: handleDeleteDataset,
  } = usePredictionDeletionAction({
    validate: () => workspaceId ? null : "No active workspace",
    deleteRequest: () => deleteWorkspaceDatasetPredictions(workspaceId!, dataset.dataset_name),
    failureMessage: "Dataset deletion failed",
  });
  const {
    useFullDatasetChains,
    isAllChainsLoading,
    scoreRows,
    handleViewDetails,
    viewerPartitions,
    viewerHeader,
    headerSummary,
    headerBestRow,
    headerTopChain,
  } = useDatasetResultCardQueries({
    dataset,
    allChains,
    runId,
    workspaceId,
    expanded,
    quickViewPred,
    quickViewOpen,
    onOpenDetail: openDetail,
  });

  return (
    <>
      <Card className="overflow-hidden">
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <DatasetResultCardHeader
              datasetName={dataset.dataset_name}
              taskType={dataset.task_type}
              expanded={expanded}
              selectedMetrics={selectedMetrics}
              workspaceId={workspaceId}
              headerSummary={headerSummary}
              headerBestRow={headerBestRow}
              headerTopChain={headerTopChain}
              onDeleteDataset={() => setDeleteOpen(true)}
              onOpenDetails={() => {
                if (headerTopChain) {
                  openDetail(headerTopChain, headerBestRow);
                }
              }}
            />
          </CollapsibleTrigger>

          <CollapsibleContent>
            <CardContent className="px-3 pb-3 pt-0">
              {expanded && useFullDatasetChains && isAllChainsLoading && (
                <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading full model history...
                </div>
              )}
              <ScoreCardTree
                rows={scoreRows}
                selectedMetrics={selectedMetrics}
                workspaceId={workspaceId}
                variant="card"
                onViewDetails={handleViewDetails}
                onViewPrediction={openQuickViewPrediction}
                showNonRefitSection
                startCollapsed={!defaultExpanded}
              />
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <ChainDetailSheet
        chainId={detailChainId}
        metric={detailMetaHint?.metric ?? null}
        metaHint={detailMetaHint}
        focus={detailFocus}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onOpenViewer={openDetailViewer}
      />

      {detailViewerHeader && (
        <PredictionViewer
          open={detailViewerOpen}
          onOpenChange={setDetailViewerOpen}
          header={detailViewerHeader}
          partitions={detailViewerPartitions}
          workspaceId={workspaceId}
          initialKind={detailViewerKind}
        />
      )}

      <PredictionViewer
        open={quickViewOpen}
        onOpenChange={setQuickViewOpen}
        header={viewerHeader}
        partitions={viewerPartitions}
        workspaceId={workspaceId}
      />

      <DatasetResultDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        datasetName={dataset.dataset_name}
        busy={deleteBusy}
        onDelete={handleDeleteDataset}
      />
    </>
  );
}
