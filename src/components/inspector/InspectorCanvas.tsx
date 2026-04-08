import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, Pin, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorState, InlineError, LoadingState } from "@/components/ui/state-display";
import { useInspectorData } from "@/context/InspectorDataContext";
import { useInspectorFilter } from "@/context/InspectorFilterContext";
import { useInspectorSelection } from "@/context/InspectorSelectionContext";
import { useInspectorView } from "@/context/InspectorViewContext";
import {
  useInspectorBiasVariance,
  useInspectorBranchTopology,
  useInspectorConfusionMatrix,
  useInspectorFoldStability,
  useInspectorScatter,
} from "@/hooks/useInspectorData";
import {
  buildBranchComparisonData,
  buildCandlestickData,
  buildHeatmapData,
  buildHistogramData,
  buildHyperparameterData,
  buildOverviewStats,
  buildPreprocessingImpactData,
  buildRankingsData,
  chooseCandlestickField,
  chooseHeatmapAxes,
  getAvailableHyperparameters,
  sortChainsByScore,
} from "@/lib/inspector/analytics";
import { PANEL_MAP } from "@/lib/inspector/chartRegistry";
import { cn } from "@/lib/utils";
import { formatMetricValue } from "@/lib/scores";
import type { InspectorGroup, InspectorPanelType } from "@/types/inspector";
import { BranchComparisonChart } from "./visualizations/BranchComparisonChart";
import { BranchTopologyDiagram } from "./visualizations/BranchTopologyDiagram";
import { BiasVariance } from "./visualizations/BiasVariance";
import { CandlestickChart } from "./visualizations/CandlestickChart";
import { ConfusionMatrixChart } from "./visualizations/ConfusionMatrixChart";
import { FoldStabilityChart } from "./visualizations/FoldStabilityChart";
import { HyperparameterSensitivity } from "./visualizations/HyperparameterSensitivity";
import { PerformanceHeatmap } from "./visualizations/PerformanceHeatmap";
import { PredVsObsChart } from "./visualizations/PredVsObsChart";
import { PreprocessingImpact } from "./visualizations/PreprocessingImpact";
import { RankingsTable } from "./visualizations/RankingsTable";
import { ResidualsChart } from "./visualizations/ResidualsChart";
import { ScoreHistogram } from "./visualizations/ScoreHistogram";
import { InspectorPanel } from "./InspectorPanel";
import { InspectorSelectionActionsBar } from "./InspectorSelectionTools";
import { InspectorToolbar } from "./InspectorToolbar";

const FOCUS_LIMIT = 8;

const BIAS_VARIANCE_GROUP_OPTIONS = [
  { value: "model_class", label: "Model" },
  { value: "preprocessings", label: "Preprocessing" },
  { value: "dataset_name", label: "Dataset" },
] as const;

const FIELD_LABELS = {
  model_class: "Model family",
  model_name: "Model",
  preprocessings: "Preprocessing",
  dataset_name: "Dataset",
  run_id: "Run",
  task_type: "Task",
  pipeline_id: "Pipeline",
} as const;

function isClassificationTask(taskType: string | null | undefined): boolean {
  return taskType === "classification" || taskType === "binary_classification" || taskType === "multiclass_classification";
}

function intersectGroups(groups: InspectorGroup[], visibleIds: Set<string>): InspectorGroup[] {
  return groups
    .map(group => ({
      ...group,
      chain_ids: group.chain_ids.filter(chainId => visibleIds.has(chainId)),
    }))
    .filter(group => group.chain_ids.length > 0);
}

function getQueryErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

function PanelNotice({
  title,
  body,
  tone = "default",
}: {
  title: string;
  body: string;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center rounded-lg border px-4 py-6 text-center",
        tone === "warning"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100"
          : "border-border/60 bg-muted/20 text-muted-foreground",
      )}
    >
      <div className="max-w-sm space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className={cn("text-xs leading-5", tone === "warning" ? "text-amber-900 dark:text-amber-100" : "text-muted-foreground")}>
          {body}
        </div>
      </div>
    </div>
  );
}

function WorkspaceStrip({
  bestScoreLabel,
  bestChainLabel,
  focusChains,
  focusMode,
  filteredCount,
  totalCount,
  modelCount,
  datasetCount,
  activeFilterCount,
  pinnedCount,
  mixedMetrics,
  mixedTaskTypes,
  selectionBar,
}: {
  bestScoreLabel: string | null;
  bestChainLabel: string | null;
  focusChains: Array<{ chain_id: string; label: string }>;
  focusMode: "selection" | "pinned" | "top";
  filteredCount: number;
  totalCount: number;
  modelCount: number;
  datasetCount: number;
  activeFilterCount: number;
  pinnedCount: number;
  mixedMetrics: boolean;
  mixedTaskTypes: boolean;
  selectionBar: React.ReactNode;
}) {
  const focusLabel = focusMode === "selection" ? "selection focus" : focusMode === "pinned" ? "pinned focus" : "auto focus";

  return (
    <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{filteredCount}/{totalCount} visible</Badge>
        <Badge variant="outline">{modelCount} models</Badge>
        <Badge variant="outline">{datasetCount} datasets</Badge>
        <Badge variant={focusMode === "top" ? "outline" : "secondary"}>{focusLabel}</Badge>
        {activeFilterCount > 0 ? <Badge variant="outline">{activeFilterCount} local filters</Badge> : null}
        {pinnedCount > 0 ? (
          <Badge variant="outline" className="gap-1">
            <Pin className="h-3 w-3" />
            {pinnedCount} pinned
          </Badge>
        ) : null}
        {bestScoreLabel ? <Badge variant="secondary">best {bestScoreLabel}</Badge> : null}
        {bestChainLabel ? (
          <span className="truncate text-xs text-muted-foreground">leader: {bestChainLabel}</span>
        ) : null}
        {mixedMetrics || mixedTaskTypes ? (
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
            mixed scope
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Current Focus
        </span>
        {focusChains.length > 0 ? (
          focusChains.map(chain => (
            <Badge key={chain.chain_id} variant="secondary" className="max-w-[220px] truncate">
              {chain.label}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No chains in scope.</span>
        )}
      </div>

      {selectionBar ? <div className="mt-3">{selectionBar}</div> : null}
    </div>
  );
}

export function InspectorCanvas() {
  const { groups, scoreColumn, partition, refresh, chains, isLoading, error, totalChains } = useInspectorData();
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
    togglePanel,
    minimizePanel,
    restorePanel,
    toggleMaximize,
    isPanelVisible,
  } = useInspectorView();

  const [selectedHyperParam, setSelectedHyperParam] = useState("");
  const [biasVarianceGroupBy, setBiasVarianceGroupBy] = useState("model_class");

  const visibleGroups = useMemo(
    () => intersectGroups(groups, filteredChainIds),
    [filteredChainIds, groups],
  );
  const chainMap = useMemo(
    () => new Map(filteredChains.map(chain => [chain.chain_id, chain])),
    [filteredChains],
  );
  const sortedChains = useMemo(
    () => sortChainsByScore(filteredChains, scoreColumn),
    [filteredChains, scoreColumn],
  );
  const orderedVisibleIds = useMemo(
    () => sortedChains.map(chain => chain.chain_id),
    [sortedChains],
  );
  const selectedVisibleIds = useMemo(
    () => orderedVisibleIds.filter(chainId => selectedChains.has(chainId)).slice(0, FOCUS_LIMIT),
    [orderedVisibleIds, selectedChains],
  );
  const pinnedVisibleIds = useMemo(
    () => orderedVisibleIds.filter(chainId => pinnedChains.has(chainId) && !selectedChains.has(chainId)).slice(0, FOCUS_LIMIT),
    [orderedVisibleIds, pinnedChains, selectedChains],
  );

  const focus = useMemo(() => {
    if (selectedVisibleIds.length > 0) {
      return { chainIds: selectedVisibleIds, mode: "selection" as const };
    }
    if (pinnedVisibleIds.length > 0) {
      return { chainIds: pinnedVisibleIds, mode: "pinned" as const };
    }
    return {
      chainIds: sortedChains.slice(0, FOCUS_LIMIT).map(chain => chain.chain_id),
      mode: "top" as const,
    };
  }, [selectedVisibleIds, pinnedVisibleIds, sortedChains]);

  const focusedChains = useMemo(
    () => focus.chainIds.map(chainId => chainMap.get(chainId)).filter((chain): chain is NonNullable<typeof chain> => Boolean(chain)),
    [focus.chainIds, chainMap],
  );
  const focusClassificationCount = focusedChains.filter(chain => isClassificationTask(chain.task_type)).length;
  const focusTask =
    focusedChains.length === 0
      ? "none"
      : focusClassificationCount === focusedChains.length
        ? "classification"
        : focusClassificationCount === 0
          ? "regression"
          : "mixed";
  const focusPipelineIds = [...new Set(focusedChains.map(chain => chain.pipeline_id).filter(Boolean))];
  const topologyPipelineId = focusPipelineIds.length === 1 ? focusPipelineIds[0] : null;

  const overviewStats = useMemo(
    () => buildOverviewStats(filteredChains, scoreColumn),
    [filteredChains, scoreColumn],
  );
  const rankingsData = useMemo(
    () => buildRankingsData(filteredChains, scoreColumn, 80),
    [filteredChains, scoreColumn],
  );
  const histogramData = useMemo(
    () => buildHistogramData(filteredChains, scoreColumn),
    [filteredChains, scoreColumn],
  );
  const heatmapAxes = useMemo(
    () => chooseHeatmapAxes(filteredChains),
    [filteredChains],
  );
  const heatmapData = useMemo(
    () => buildHeatmapData(filteredChains, scoreColumn, heatmapAxes.xVariable, heatmapAxes.yVariable, "median"),
    [filteredChains, scoreColumn, heatmapAxes],
  );
  const candlestickField = useMemo(
    () => chooseCandlestickField(filteredChains),
    [filteredChains],
  );
  const candlestickData = useMemo(
    () => buildCandlestickData(filteredChains, scoreColumn, candlestickField),
    [filteredChains, scoreColumn, candlestickField],
  );
  const preprocessingImpactData = useMemo(
    () => buildPreprocessingImpactData(filteredChains, scoreColumn),
    [filteredChains, scoreColumn],
  );
  const availableHyperParams = useMemo(
    () => getAvailableHyperparameters(filteredChains),
    [filteredChains],
  );
  const activeHyperParam = useMemo(
    () => (selectedHyperParam && availableHyperParams.includes(selectedHyperParam) ? selectedHyperParam : availableHyperParams[0] || ""),
    [availableHyperParams, selectedHyperParam],
  );
  const hyperparameterData = useMemo(
    () => buildHyperparameterData(filteredChains, scoreColumn, activeHyperParam),
    [filteredChains, scoreColumn, activeHyperParam],
  );
  const branchComparisonData = useMemo(
    () => buildBranchComparisonData(filteredChains, scoreColumn),
    [filteredChains, scoreColumn],
  );

  const isPanelActive = (panel: InspectorPanelType) => {
    if (hasMaximized) return maximizedPanel === panel;
    return isPanelVisible(panel);
  };

  const scatterQuery = useInspectorScatter(
    (isPanelActive("scatter") || isPanelActive("residuals")) && focusTask === "regression" && focus.chainIds.length > 0
      ? { chain_ids: focus.chainIds, partition }
      : null,
  );
  const foldStabilityQuery = useInspectorFoldStability(
    isPanelActive("fold_stability") && focusTask === "regression" && focus.chainIds.length > 0
      ? { chain_ids: focus.chainIds, score_column: scoreColumn, partition }
      : null,
  );
  const confusionQuery = useInspectorConfusionMatrix(
    isPanelActive("confusion") && focusTask === "classification" && focus.chainIds.length > 0
      ? { chain_ids: focus.chainIds, partition }
      : null,
  );
  const biasVarianceQuery = useInspectorBiasVariance(
    isPanelActive("bias_variance") && focusTask === "regression" && focus.chainIds.length > 0
      ? { chain_ids: focus.chainIds, score_column: scoreColumn, group_by: biasVarianceGroupBy }
      : null,
  );
  const topologyQuery = useInspectorBranchTopology(
    isPanelActive("branch_topology") && topologyPipelineId
      ? { pipeline_id: topologyPipelineId, score_column: scoreColumn }
      : null,
  );

  const panelIdsToRender = useMemo(() => {
    if (hasMaximized && maximizedPanel) return [maximizedPanel];
    const visible = Object.entries(panelStates)
      .filter(([, state]) => state !== "hidden")
      .map(([panel]) => panel as InspectorPanelType);
    return visible.sort((left, right) => {
      const leftPriority = PANEL_MAP.get(left)?.priority ?? 0;
      const rightPriority = PANEL_MAP.get(right)?.priority ?? 0;
      return leftPriority - rightPriority;
    });
  }, [hasMaximized, maximizedPanel, panelStates]);

  const gridClassName = useMemo(() => {
    if (hasMaximized) return "grid grid-cols-1";
    if (layoutMode === "single-column") return "grid grid-cols-1 gap-4";
    if (layoutMode === "grid-2") return "grid grid-cols-1 gap-4 xl:grid-cols-2";
    if (layoutMode === "grid-3") return "grid grid-cols-1 gap-4 xl:grid-cols-3";
    return "grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3";
  }, [hasMaximized, layoutMode]);

  const bestScoreLabel = overviewStats.bestScore != null
    ? formatMetricValue(overviewStats.bestScore, overviewStats.bestChain?.metric ?? undefined)
    : null;
  const bestChainLabel = overviewStats.bestChain?.model_name ?? overviewStats.bestChain?.model_class ?? null;
  const focusLabelChains = focusedChains.map(chain => ({
    chain_id: chain.chain_id,
    label: chain.model_name ?? chain.model_class,
  }));

  const selectionBar = hasSelection ? (
    <InspectorSelectionActionsBar
      totalCount={filteredChains.length}
      allChainIds={filteredChains.map(chain => chain.chain_id)}
    />
  ) : null;

  const renderRegressionPanelState = (panelName: string) => {
    if (focus.chainIds.length === 0) {
      return (
        <PanelNotice
          title={`${panelName} unavailable`}
          body="No chains are available in the current scope."
        />
      );
    }
    if (focusTask === "classification") {
      return (
        <PanelNotice
          title={`${panelName} requires regression`}
          body="Current focus is classification. Select or pin regression chains to populate this panel."
          tone="warning"
        />
      );
    }
    if (focusTask === "mixed") {
      return (
        <PanelNotice
          title={`${panelName} needs a coherent focus`}
          body="Selected chains mix regression and classification. Narrow the shared selection or rely on auto focus."
          tone="warning"
        />
      );
    }
    return null;
  };

  const renderClassificationPanelState = (panelName: string) => {
    if (focus.chainIds.length === 0) {
      return (
        <PanelNotice
          title={`${panelName} unavailable`}
          body="No chains are available in the current scope."
        />
      );
    }
    if (focusTask === "regression") {
      return (
        <PanelNotice
          title={`${panelName} requires classification`}
          body="Current focus is regression. Select or pin classification chains to populate this panel."
          tone="warning"
        />
      );
    }
    if (focusTask === "mixed") {
      return (
        <PanelNotice
          title={`${panelName} needs a coherent focus`}
          body="Selected chains mix regression and classification. Narrow the shared selection or rely on auto focus."
          tone="warning"
        />
      );
    }
    return null;
  };

  const renderPanel = (panelType: InspectorPanelType) => {
    const commonProps = {
      panelType,
      viewState: panelStates[panelType],
      isMaximized: maximizedPanel === panelType,
      onMaximize: () => toggleMaximize(panelType),
      onMinimize: () => minimizePanel(panelType),
      onRestore: () => restorePanel(panelType),
      onHide: () => togglePanel(panelType),
      selectedCount,
    };

    switch (panelType) {
      case "rankings":
        return (
          <InspectorPanel
            {...commonProps}
            minHeight="420px"
            itemCount={filteredChains.length}
            headerContent={<Badge variant="outline">{rankingsData.rankings.length} rows</Badge>}
          >
            <RankingsTable data={rankingsData} groups={visibleGroups} isLoading={false} />
          </InspectorPanel>
        );

      case "heatmap":
        return (
          <InspectorPanel
            {...commonProps}
            minHeight="420px"
            itemCount={filteredChains.length}
            headerContent={<Badge variant="outline">{FIELD_LABELS[heatmapAxes.xVariable]} × {FIELD_LABELS[heatmapAxes.yVariable]}</Badge>}
          >
            <PerformanceHeatmap data={heatmapData} isLoading={false} />
          </InspectorPanel>
        );

      case "histogram":
        return (
          <InspectorPanel
            {...commonProps}
            minHeight="360px"
            itemCount={filteredChains.length}
          >
            <ScoreHistogram data={histogramData} groups={visibleGroups} isLoading={false} />
          </InspectorPanel>
        );

      case "candlestick":
        return (
          <InspectorPanel
            {...commonProps}
            minHeight="360px"
            itemCount={filteredChains.length}
            headerContent={<Badge variant="outline">{FIELD_LABELS[candlestickField]}</Badge>}
          >
            <CandlestickChart data={candlestickData} isLoading={false} />
          </InspectorPanel>
        );

      case "preprocessing_impact":
        return (
          <InspectorPanel
            {...commonProps}
            minHeight="360px"
            itemCount={filteredChains.length}
          >
            <PreprocessingImpact data={preprocessingImpactData} isLoading={false} />
          </InspectorPanel>
        );

      case "hyperparameter":
        return (
          <InspectorPanel
            {...commonProps}
            minHeight="420px"
            itemCount={filteredChains.length}
            headerContent={availableHyperParams.length > 0 ? (
              <Select value={activeHyperParam} onValueChange={setSelectedHyperParam}>
                <SelectTrigger className="h-8 w-[190px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableHyperParams.map(param => (
                    <SelectItem key={param} value={param}>
                      {param}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : undefined}
          >
            <HyperparameterSensitivity data={hyperparameterData} isLoading={false} />
          </InspectorPanel>
        );

      case "branch_comparison":
        return (
          <InspectorPanel
            {...commonProps}
            minHeight="360px"
            itemCount={filteredChains.length}
          >
            <BranchComparisonChart data={branchComparisonData} isLoading={false} />
          </InspectorPanel>
        );

      case "branch_topology":
        return (
          <InspectorPanel
            {...commonProps}
            minHeight="420px"
            itemCount={focusedChains.length}
            headerContent={topologyPipelineId ? (
              <Badge variant="outline" className="max-w-[220px] truncate">{topologyPipelineId}</Badge>
            ) : undefined}
            isLoading={topologyQuery.isLoading}
          >
            {!topologyPipelineId ? (
              <PanelNotice
                title="Topology needs one pipeline"
                body="Select or pin chains from a single pipeline to inspect topology."
                tone="warning"
              />
            ) : topologyQuery.error ? (
              <InlineError message={getQueryErrorMessage(topologyQuery.error, "Failed to load topology.")} />
            ) : (
              <BranchTopologyDiagram data={topologyQuery.data} isLoading={topologyQuery.isLoading} />
            )}
          </InspectorPanel>
        );

      case "scatter": {
        const state = renderRegressionPanelState("Predicted vs observed");
        return (
          <InspectorPanel
            {...commonProps}
            minHeight="420px"
            itemCount={focusedChains.length}
            headerContent={<Badge variant={focus.mode === "top" ? "outline" : "secondary"}>{focus.mode}</Badge>}
            isLoading={scatterQuery.isLoading}
          >
            {state ? (
              state
            ) : scatterQuery.error ? (
              <InlineError message={getQueryErrorMessage(scatterQuery.error, "Failed to load scatter data.")} />
            ) : (
              <PredVsObsChart data={scatterQuery.data} groups={visibleGroups} isLoading={scatterQuery.isLoading} />
            )}
          </InspectorPanel>
        );
      }

      case "residuals": {
        const state = renderRegressionPanelState("Residuals");
        return (
          <InspectorPanel
            {...commonProps}
            minHeight="420px"
            itemCount={focusedChains.length}
            headerContent={<Badge variant={focus.mode === "top" ? "outline" : "secondary"}>{focus.mode}</Badge>}
            isLoading={scatterQuery.isLoading}
          >
            {state ? (
              state
            ) : scatterQuery.error ? (
              <InlineError message={getQueryErrorMessage(scatterQuery.error, "Failed to load residual data.")} />
            ) : (
              <ResidualsChart data={scatterQuery.data} isLoading={scatterQuery.isLoading} />
            )}
          </InspectorPanel>
        );
      }

      case "fold_stability": {
        const state = renderRegressionPanelState("Fold stability");
        return (
          <InspectorPanel
            {...commonProps}
            minHeight="360px"
            itemCount={focusedChains.length}
            headerContent={<Badge variant={focus.mode === "top" ? "outline" : "secondary"}>{partition}</Badge>}
            isLoading={foldStabilityQuery.isLoading}
          >
            {state ? (
              state
            ) : foldStabilityQuery.error ? (
              <InlineError message={getQueryErrorMessage(foldStabilityQuery.error, "Failed to load fold stability.")} />
            ) : (
              <FoldStabilityChart data={foldStabilityQuery.data} groups={visibleGroups} isLoading={foldStabilityQuery.isLoading} />
            )}
          </InspectorPanel>
        );
      }

      case "confusion": {
        const state = renderClassificationPanelState("Confusion matrix");
        return (
          <InspectorPanel
            {...commonProps}
            minHeight="420px"
            itemCount={focusedChains.length}
            headerContent={<Badge variant={focus.mode === "top" ? "outline" : "secondary"}>{partition}</Badge>}
            isLoading={confusionQuery.isLoading}
          >
            {state ? (
              state
            ) : confusionQuery.error ? (
              <InlineError message={getQueryErrorMessage(confusionQuery.error, "Failed to load confusion matrix.")} />
            ) : (
              <ConfusionMatrixChart data={confusionQuery.data} isLoading={confusionQuery.isLoading} />
            )}
          </InspectorPanel>
        );
      }

      case "bias_variance": {
        const state = renderRegressionPanelState("Bias-variance");
        return (
          <InspectorPanel
            {...commonProps}
            minHeight="360px"
            itemCount={focusedChains.length}
            headerContent={
              <Select value={biasVarianceGroupBy} onValueChange={setBiasVarianceGroupBy}>
                <SelectTrigger className="h-8 w-[170px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BIAS_VARIANCE_GROUP_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
            isLoading={biasVarianceQuery.isLoading}
          >
            {state ? (
              state
            ) : biasVarianceQuery.error ? (
              <InlineError message={getQueryErrorMessage(biasVarianceQuery.error, "Failed to load bias-variance data.")} />
            ) : (
              <BiasVariance data={biasVarianceQuery.data} isLoading={biasVarianceQuery.isLoading} />
            )}
          </InspectorPanel>
        );
      }

      default:
        return null;
    }
  };

  if (isLoading && chains.length === 0) {
    return (
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <InspectorToolbar />
        <div className="p-4">
          <LoadingState message="Loading predictions inspector..." className="min-h-[420px]" />
        </div>
      </div>
    );
  }

  if (error && chains.length === 0) {
    return (
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <InspectorToolbar />
        <div className="p-4">
          <ErrorState
            title="Inspector unavailable"
            message={error}
            onRetry={refresh}
            retryLabel="Reload inspector"
          />
        </div>
      </div>
    );
  }

  if (chains.length === 0) {
    return (
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <InspectorToolbar />
        <div className="p-4">
          <EmptyState
            icon={Target}
            title="No predictions to inspect"
            description="Run or import predictions first, then reopen the inspector."
            action={{ label: "Refresh", onClick: refresh }}
          />
        </div>
      </div>
    );
  }

  if (filteredChains.length === 0) {
    return (
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <InspectorToolbar />
        <div className="p-4">
          <EmptyState
            icon={AlertTriangle}
            title="No chains match the current scope"
            description={hasActiveFilters
              ? "Clear local inspector filters to bring chains back into view."
              : "Adjust source filters to broaden the comparison scope."
            }
            action={hasActiveFilters ? { label: "Clear local filters", onClick: clearAllFilters } : { label: "Refresh", onClick: refresh }}
            secondaryAction={hasActiveFilters ? { label: "Refresh", onClick: refresh } : undefined}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <InspectorToolbar />

      <div className="flex-1 overflow-auto">
        <div className="space-y-4 p-4">
          <WorkspaceStrip
            bestScoreLabel={bestScoreLabel}
            bestChainLabel={bestChainLabel}
            focusChains={focusLabelChains}
            focusMode={focus.mode}
            filteredCount={filteredChains.length}
            totalCount={totalChains}
            modelCount={overviewStats.modelCount}
            datasetCount={overviewStats.datasetCount}
            activeFilterCount={activeFilterCount}
            pinnedCount={pinnedCount}
            mixedMetrics={overviewStats.mixedMetrics}
            mixedTaskTypes={overviewStats.mixedTaskTypes}
            selectionBar={selectionBar}
          />

          {panelIdsToRender.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No panels open"
              description="Use the Panels control in the toolbar to reopen views, or restore the default workspace."
              action={{ label: "Show all panels", onClick: showAll }}
            />
          ) : (
            <div className={gridClassName}>
              {panelIdsToRender.map(panelType => {
                const panel = renderPanel(panelType);
                return panel ? <Fragment key={panelType}>{panel}</Fragment> : null;
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
