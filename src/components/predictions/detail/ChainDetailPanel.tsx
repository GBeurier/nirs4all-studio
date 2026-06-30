/**
 * ChainDetailPanel — single-view body rendered inside ChainDetailSheet.
 *
 * Replaces the former three-tab layout (Summary / Folds / Arrays) with a
 * scientifically-ordered scroll: identity header → hero metrics → evidence
 * charts → fold-level table → collapsed identity & arrays details.
 *
 * Composes the detail sheet from bounded presentation sections. Fetch,
 * selection, chart config, and preview projections live in
 * `useChainDetailPanelState`.
 */

import { foldLabel, foldLabelShort } from "@/lib/fold-utils";
import type {
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";
import { HeroMetrics } from "./HeroMetrics";
import {
  ChainDetailFoldSummary,
  ChainDetailSummaryHeader,
} from "./ChainDetailSummaryHeader";
import { ChainDetailRelatedPredictions } from "./ChainDetailRelatedPredictions";
import { ChainDetailPredictionBreakdown } from "./ChainDetailPredictionBreakdown";
import { ChainDetailChartPreview } from "./ChainDetailChartPreview";
import { ChainDetailChartBody } from "./ChainDetailChartBody";
import { ChainDetailPipelineIdentity } from "./ChainDetailPipelineIdentity";
import { ChainDetailArtifactSummary } from "./ChainDetailArtifactSummary";
import { ChainDetailRawVectors } from "./ChainDetailRawVectors";
import {
  useChainDetailPanelState,
  type ChainDetailFocus,
  type ChainDetailMetaHint,
} from "./useChainDetailPanelState";

export type { ChainDetailFocus, ChainDetailMetaHint } from "./useChainDetailPanelState";

interface ChainDetailPanelProps {
  chainId: string;
  metric?: string | null;
  metaHint?: ChainDetailMetaHint;
  focus?: ChainDetailFocus;
  onOpenViewer?: (
    partitions: ViewerPartitionTarget[],
    header: ViewerHeader,
    kind: ChartKind,
  ) => void;
  /** When true, hide the inline chart preview — the full viewer is mounted on
   *  top and the preview would otherwise live-update from shared config edits. */
  isViewerOpen?: boolean;
}

export function ChainDetailPanel({ chainId, metric, metaHint, focus, onOpenViewer, isViewerOpen }: ChainDetailPanelProps) {
  const {
    detail,
    prediction,
    loadingSummary,
    selectedFoldId,
    setSelectedFoldId,
    previewKind,
    setPreviewKind,
    panelConfig,
    taskKind,
    foldGroups,
    selectedGroup,
    selectedPrediction,
    selectedFoldPartitions,
    chartTargets,
    chartDatasets,
    chartsLoading,
    chartsError,
    canCustomize,
    handleCustomize,
    chartBodyKey,
    preprocessLabel,
    variantParams,
    bestParams,
    pipelineStats,
    pipelineTree,
    generatorChoices,
    branchPathLabel,
    vectorSummaries,
    arrayData,
    arrayArtifactRef,
    artifactSummary,
    loadingArrays,
    additionalCvMetricRows,
  } = useChainDetailPanelState({
    chainId,
    metric,
    metaHint,
    focus,
    onOpenViewer,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.06),hsl(var(--primary)/0)_32%)]">
      <ChainDetailSummaryHeader
        prediction={prediction}
        selectedFoldLabel={selectedGroup ? foldLabel(selectedGroup.foldId) : null}
        preprocessLabel={preprocessLabel}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 px-6 py-5">
          <HeroMetrics
            cvVal={prediction.cv_val_score}
            cvTest={prediction.cv_test_score}
            cvTrain={prediction.cv_train_score}
            foldCount={prediction.cv_fold_count}
            finalTest={prediction.final_test_score}
            metric={prediction.metric || "score"}
          />

          <ChainDetailFoldSummary
            selectedLabel={selectedGroup ? foldLabelShort(selectedGroup.foldId) : "Auto"}
            refitCount={foldGroups.filter((group) => group.kind === "refit").length}
            cvViewCount={foldGroups.filter((group) => group.kind === "cv").length}
            foldCount={foldGroups.filter((group) => group.kind === "fold" && !group.isAggregated).length}
          />

          <ChainDetailRelatedPredictions
            loading={loadingSummary}
            foldGroups={foldGroups}
            selectedFoldId={selectedFoldId}
            onSelectFold={setSelectedFoldId}
          />

          <ChainDetailChartPreview
            previewKind={previewKind}
            onPreviewKindChange={setPreviewKind}
            taskKind={taskKind}
            partitions={chartTargets}
            selectedFoldLabel={selectedGroup ? foldLabel(selectedGroup.foldId) : null}
            selectedPartitionCount={selectedFoldPartitions.length}
            canCustomize={canCustomize}
            onCustomize={handleCustomize}
            isViewerOpen={isViewerOpen}
          >
            <ChainDetailChartBody
              key={chartBodyKey}
              kind={previewKind}
              chartDatasets={chartDatasets}
              chartsLoading={chartsLoading}
              chartsError={chartsError}
              panelConfig={panelConfig}
              taskKind={taskKind}
            />
          </ChainDetailChartPreview>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <ChainDetailPredictionBreakdown
              selectedFoldLabel={selectedGroup ? foldLabel(selectedGroup.foldId) : null}
              selectedFoldPartitions={selectedFoldPartitions}
            />

            <ChainDetailPipelineIdentity
              title={detail?.pipeline?.name || prediction.model_class || "Pipeline structure and chosen variants for this chain."}
              modelClass={prediction.model_class || null}
              pipelineName={detail?.pipeline?.name ?? null}
              pipelineStats={pipelineStats}
              pipelineTree={pipelineTree}
              variantParams={variantParams}
              bestParams={bestParams}
              branchPathLabel={branchPathLabel}
              generatorChoiceCount={generatorChoices?.length ?? 0}
              additionalCvMetricRows={additionalCvMetricRows}
              cvFoldCount={prediction.cv_fold_count || 0}
            />
          </div>

          <ChainDetailArtifactSummary summary={artifactSummary} />

          <ChainDetailRawVectors
            hasSelectedPrediction={!!selectedPrediction}
            loading={loadingArrays || chartsLoading}
            vectorSummaries={vectorSummaries}
            arrayData={arrayData}
            arrayArtifactRef={arrayArtifactRef}
            metric={prediction.metric}
          />
        </div>
      </div>
    </div>
  );
}
