import { Target } from "lucide-react";
import { EmptyState } from "@/components/ui/state-display";
import { useInspectorData } from "@/context/useInspectorDataContext";
import { useInspectorFilter } from "@/context/useInspectorFilter";
import { useInspectorSelection } from "@/context/useInspectorSelection";
import { useInspectorView } from "@/context/useInspectorView";
import { InspectorCanvasFrame } from "./InspectorCanvasFrame";
import {
  InspectorCanvasErrorState,
  InspectorCanvasFilteredEmptyState,
  InspectorCanvasLoadingState,
  InspectorCanvasNoPredictionsState,
} from "./InspectorCanvasStatusStates";
import { InspectorPanelRenderer } from "./InspectorPanelRenderer";
import { InspectorMetadataFacetCounters } from "./InspectorPanelHeaderControls";
import { InspectorSelectionActionsBar } from "./InspectorSelectionTools";
import { InspectorWorkspaceStrip } from "./InspectorWorkspaceStrip";
import { useInspectorPanelRuntime } from "./hooks/useInspectorPanelRuntime";

export function InspectorCanvas() {
  const { groups, scoreColumn, selectedScoreRefKey, partition, targetIndex, refresh, chains, isLoading, error, totalChains } = useInspectorData();
  const { filteredChains, filteredChainIds, activeFilterCount, hasActiveFilters, clearAllFilters } = useInspectorFilter();
  const {
    selectedChains,
    selectedCount,
    hasSelection,
    pinnedChains,
    pinnedCount,
  } = useInspectorSelection();
  const {
    panelStates,
    maximizedPanel,
    hasMaximized,
    layoutMode,
    showAll,
  } = useInspectorView();

  const {
    visibleGroups,
    focus,
    panelData,
    panelIdsToRender,
    gridClassName,
    workspaceSummary,
    resultAnalysisSummaryCounters,
    resultAnalysisMetadataFacetCounters,
    panelActions,
    queries,
    controls,
  } = useInspectorPanelRuntime({
    groups,
    filteredChains,
    filteredChainIds,
    selectedChains,
    pinnedChains,
    scoreColumn,
    selectedScoreRefKey,
    partition,
    targetIndex,
    panelStates,
    maximizedPanel,
    hasMaximized,
    layoutMode,
  });

  const selectionBar = hasSelection ? (
    <InspectorSelectionActionsBar
      totalCount={filteredChains.length}
      allChainIds={filteredChains.map(chain => chain.chain_id)}
    />
  ) : null;

  if (isLoading && chains.length === 0) {
    return (
      <InspectorCanvasFrame>
        <InspectorCanvasLoadingState />
      </InspectorCanvasFrame>
    );
  }

  if (error && chains.length === 0) {
    return (
      <InspectorCanvasFrame>
        <InspectorCanvasErrorState error={error} onRefresh={refresh} />
      </InspectorCanvasFrame>
    );
  }

  if (chains.length === 0) {
    return (
      <InspectorCanvasFrame>
        <InspectorCanvasNoPredictionsState onRefresh={refresh} />
      </InspectorCanvasFrame>
    );
  }

  if (filteredChains.length === 0) {
    return (
      <InspectorCanvasFrame>
        <InspectorCanvasFilteredEmptyState
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearAllFilters}
          onRefresh={refresh}
        />
      </InspectorCanvasFrame>
    );
  }

  return (
    <InspectorCanvasFrame contentClassName="space-y-4 p-4" scrollable>
      <InspectorWorkspaceStrip
        bestScoreLabel={workspaceSummary.bestScoreLabel}
        bestChainLabel={workspaceSummary.bestChainLabel}
        focusChains={workspaceSummary.focusChains}
        focusMode={workspaceSummary.focusMode}
        filteredCount={filteredChains.length}
        totalCount={totalChains}
        modelCount={workspaceSummary.modelCount}
        datasetCount={workspaceSummary.datasetCount}
        activeFilterCount={activeFilterCount}
        pinnedCount={pinnedCount}
        mixedMetrics={workspaceSummary.mixedMetrics}
        mixedTaskTypes={workspaceSummary.mixedTaskTypes}
        selectionBar={selectionBar}
      />

      <InspectorMetadataFacetCounters counters={resultAnalysisMetadataFacetCounters} />

      {panelIdsToRender.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No panels open"
          description="Use the Panels control in the toolbar to reopen views, or restore the default workspace."
          action={{ label: "Show all panels", onClick: showAll }}
        />
      ) : (
        <div className={gridClassName}>
          {panelIdsToRender.map(panelType => (
            <InspectorPanelRenderer
              key={panelType}
              panelType={panelType}
              viewState={panelStates[panelType]}
              isMaximized={maximizedPanel === panelType}
              selectedCount={selectedCount}
              actions={panelActions[panelType]}
              filteredChainCount={filteredChains.length}
              focusedChainCount={focus.chains.length}
              visibleGroups={visibleGroups}
              panelData={panelData}
              resultAnalysisSummaryCounters={resultAnalysisSummaryCounters}
              focus={focus}
              partition={partition}
              queries={queries}
              controls={controls}
            />
          ))}
        </div>
      )}
    </InspectorCanvasFrame>
  );
}
