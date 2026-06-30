import { type InspectorHeatmapAxisField } from "@/lib/inspector/chartInputs";
import type { InspectorFocusState } from "@/lib/inspector/focus";
import type { InspectorPanelData } from "@/lib/inspector/panelData";
import type { ResultAnalysisViewModelSummaryCounter } from "@/lib/inspector/resultAnalysisViewModels";
import type {
  BiasVarianceResponse,
  BranchTopologyResponse,
  ConfusionMatrixResponse,
  FoldStabilityResponse,
  InspectorGroup,
  InspectorPanelType,
  InspectorViewState,
  ScatterResponse,
} from "@/types/inspector";
import { BiasVariance } from "./visualizations/BiasVariance";
import { BranchComparisonChart } from "./visualizations/BranchComparisonChart";
import { BranchTopologyDiagram } from "./visualizations/BranchTopologyDiagram";
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
import { InspectorPanelRendererDiagnosticPanel } from "./InspectorPanelRendererDiagnosticPanel";
import {
  InspectorBiasVarianceGroupSelect,
  InspectorFieldBadge,
  InspectorFocusModeBadge,
  InspectorHeatmapAxisControls,
  InspectorHyperparameterSelect,
  InspectorPartitionBadge,
  InspectorPipelineBadge,
  InspectorRowsBadge,
  InspectorViewModelSummaryCounters,
} from "./InspectorPanelHeaderControls";
import type { InspectorPanelActions } from "./hooks/useInspectorPanelActions";
import {
  INSPECTOR_PANEL_RENDERER_CONFIGS,
  getInspectorPanelClassName,
  getInspectorPanelItemCount,
} from "./inspectorPanelRegistry";

interface InspectorPanelQueryResult<TData> {
  data: TData | undefined;
  error: unknown;
  isLoading: boolean;
}

export interface InspectorPanelRendererQueries {
  scatter: InspectorPanelQueryResult<ScatterResponse>;
  foldStability: InspectorPanelQueryResult<FoldStabilityResponse>;
  confusion: InspectorPanelQueryResult<ConfusionMatrixResponse>;
  biasVariance: InspectorPanelQueryResult<BiasVarianceResponse>;
  topology: InspectorPanelQueryResult<BranchTopologyResponse>;
}

export interface InspectorPanelRendererControls {
  biasVarianceGroupBy: string;
  onBiasVarianceGroupByChange: (value: string) => void;
  onHeatmapXAxisChange: (value: InspectorHeatmapAxisField) => void;
  onHeatmapYAxisChange: (value: InspectorHeatmapAxisField) => void;
  onHyperParamChange: (value: string) => void;
}

export interface InspectorPanelRendererProps {
  panelType: InspectorPanelType;
  viewState: InspectorViewState;
  isMaximized: boolean;
  selectedCount: number;
  actions: InspectorPanelActions;
  filteredChainCount: number;
  focusedChainCount: number;
  visibleGroups: InspectorGroup[];
  panelData: InspectorPanelData;
  resultAnalysisSummaryCounters?: ResultAnalysisViewModelSummaryCounter[];
  focus: InspectorFocusState;
  partition: string;
  queries: InspectorPanelRendererQueries;
  controls: InspectorPanelRendererControls;
}

export function InspectorPanelRenderer({
  panelType,
  viewState,
  isMaximized,
  selectedCount,
  actions,
  filteredChainCount,
  focusedChainCount,
  visibleGroups,
  panelData,
  resultAnalysisSummaryCounters = [],
  focus,
  partition,
  queries,
  controls,
}: InspectorPanelRendererProps) {
  const {
    rankingsData,
    histogramData,
    chartInputs,
    heatmapData,
    candlestickData,
    preprocessingImpactData,
    hyperparameterData,
    branchComparisonData,
  } = panelData;
  const {
    heatmapAxes,
    candlestickField,
    availableHyperParams,
    activeHyperParam,
  } = chartInputs;
  const config = INSPECTOR_PANEL_RENDERER_CONFIGS[panelType];
  const hasLeaderboardCounters = resultAnalysisSummaryCounters.some(counter => counter.source === "leaderboard");
  const itemCount = getInspectorPanelItemCount(config, {
    filteredChainCount,
    focusedChainCount,
  });
  const commonProps = {
    panelType,
    viewState,
    isMaximized,
    itemCount,
    selectedCount,
    minHeight: config.minHeight,
    ...actions,
  };

  switch (panelType) {
    case "rankings":
      return (
        <InspectorPanel
          {...commonProps}
          className={getInspectorPanelClassName(config, isMaximized)}
          headerContent={hasLeaderboardCounters ? (
            <InspectorViewModelSummaryCounters counters={resultAnalysisSummaryCounters} source="leaderboard" />
          ) : (
            <InspectorRowsBadge rowCount={rankingsData.rankings.length} />
          )}
        >
          <RankingsTable data={rankingsData} groups={visibleGroups} isLoading={false} />
        </InspectorPanel>
      );

    case "heatmap":
      return (
        <InspectorPanel
          {...commonProps}
          headerContent={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <InspectorViewModelSummaryCounters
                counters={resultAnalysisSummaryCounters}
                source="matrix"
                maxItems={2}
              />
              <InspectorHeatmapAxisControls
                axes={heatmapAxes}
                onXAxisChange={controls.onHeatmapXAxisChange}
                onYAxisChange={controls.onHeatmapYAxisChange}
              />
            </div>
          }
        >
          <PerformanceHeatmap data={heatmapData} isLoading={false} />
        </InspectorPanel>
      );

    case "histogram":
      return (
        <InspectorPanel
          {...commonProps}
        >
          <ScoreHistogram data={histogramData} groups={visibleGroups} isLoading={false} />
        </InspectorPanel>
      );

    case "candlestick":
      return (
        <InspectorPanel
          {...commonProps}
          headerContent={<InspectorFieldBadge field={candlestickField} />}
        >
          <CandlestickChart data={candlestickData} isLoading={false} />
        </InspectorPanel>
      );

    case "preprocessing_impact":
      return (
        <InspectorPanel
          {...commonProps}
        >
          <PreprocessingImpact data={preprocessingImpactData} isLoading={false} />
        </InspectorPanel>
      );

    case "hyperparameter":
      return (
        <InspectorPanel
          {...commonProps}
          headerContent={(
            <InspectorHyperparameterSelect
              availableHyperParams={availableHyperParams}
              activeHyperParam={activeHyperParam}
              onChange={controls.onHyperParamChange}
            />
          )}
        >
          <HyperparameterSensitivity data={hyperparameterData} isLoading={false} />
        </InspectorPanel>
      );

    case "branch_comparison":
      return (
        <InspectorPanel
          {...commonProps}
        >
          <BranchComparisonChart data={branchComparisonData} isLoading={false} />
        </InspectorPanel>
      );

    case "branch_topology": {
      return (
        <InspectorPanelRendererDiagnosticPanel
          {...commonProps}
          config={config}
          error={queries.topology.error}
          focus={focus}
          headerContent={<InspectorPipelineBadge pipelineId={focus.topologyPipelineId} />}
          isLoading={queries.topology.isLoading}
        >
          <BranchTopologyDiagram data={queries.topology.data} isLoading={queries.topology.isLoading} />
        </InspectorPanelRendererDiagnosticPanel>
      );
    }

    case "scatter": {
      return (
        <InspectorPanelRendererDiagnosticPanel
          {...commonProps}
          config={config}
          error={queries.scatter.error}
          focus={focus}
          headerContent={<InspectorFocusModeBadge mode={focus.mode} />}
          isLoading={queries.scatter.isLoading}
        >
          <PredVsObsChart data={queries.scatter.data} groups={visibleGroups} isLoading={queries.scatter.isLoading} />
        </InspectorPanelRendererDiagnosticPanel>
      );
    }

    case "residuals": {
      return (
        <InspectorPanelRendererDiagnosticPanel
          {...commonProps}
          config={config}
          error={queries.scatter.error}
          focus={focus}
          headerContent={<InspectorFocusModeBadge mode={focus.mode} />}
          isLoading={queries.scatter.isLoading}
        >
          <ResidualsChart data={queries.scatter.data} isLoading={queries.scatter.isLoading} />
        </InspectorPanelRendererDiagnosticPanel>
      );
    }

    case "fold_stability": {
      return (
        <InspectorPanelRendererDiagnosticPanel
          {...commonProps}
          config={config}
          error={queries.foldStability.error}
          focus={focus}
          headerContent={<InspectorPartitionBadge partition={partition} mode={focus.mode} />}
          isLoading={queries.foldStability.isLoading}
        >
          <FoldStabilityChart data={queries.foldStability.data} groups={visibleGroups} isLoading={queries.foldStability.isLoading} />
        </InspectorPanelRendererDiagnosticPanel>
      );
    }

    case "confusion": {
      return (
        <InspectorPanelRendererDiagnosticPanel
          {...commonProps}
          config={config}
          error={queries.confusion.error}
          focus={focus}
          headerContent={<InspectorPartitionBadge partition={partition} mode={focus.mode} />}
          isLoading={queries.confusion.isLoading}
        >
          <ConfusionMatrixChart data={queries.confusion.data} isLoading={queries.confusion.isLoading} />
        </InspectorPanelRendererDiagnosticPanel>
      );
    }

    case "bias_variance": {
      return (
        <InspectorPanelRendererDiagnosticPanel
          {...commonProps}
          config={config}
          error={queries.biasVariance.error}
          focus={focus}
          headerContent={
            <InspectorBiasVarianceGroupSelect
              value={controls.biasVarianceGroupBy}
              onChange={controls.onBiasVarianceGroupByChange}
            />
          }
          isLoading={queries.biasVariance.isLoading}
        >
          <BiasVariance data={queries.biasVariance.data} isLoading={queries.biasVariance.isLoading} />
        </InspectorPanelRendererDiagnosticPanel>
      );
    }

    default:
      return null;
  }
}
