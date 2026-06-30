import { useMemo, useState } from "react";

import type { LayoutMode } from "@/context/useInspectorView";
import {
  useInspectorBiasVariance,
  useInspectorBranchTopology,
  useInspectorConfusionMatrix,
  useInspectorFoldStability,
  useInspectorScatter,
} from "@/hooks/useInspectorData";
import {
  buildInspectorMetricObservationReadModel,
  resolveInspectorSelectedScoreRef,
  type InspectorHeatmapAxisField,
  type InspectorMetricObservationReadModel,
} from "@/lib/inspector/chartInputs";
import { buildInspectorFocusStateFromStore, type InspectorFocusState } from "@/lib/inspector/focus";
import {
  getInspectorPanelGridClassName,
  getInspectorPanelIdsToRender,
} from "@/lib/inspector/panelLayout";
import { buildInspectorPanelDataFromStore, type InspectorPanelData } from "@/lib/inspector/panelData";
import {
  buildInspectorPanelQueryInputs,
  type InspectorPanelQueryInputs,
} from "@/lib/inspector/panelQueries";
import {
  buildInspectorWorkspaceSummaryFromStore,
  type InspectorWorkspaceSummary,
} from "@/lib/inspector/workspaceSummary";
import {
  buildResultAnalysisLeaderboardViewModel,
  buildResultAnalysisMatrixViewModel,
  buildResultAnalysisView,
} from "@/lib/inspector/resultAnalysisQuery";
import { buildResultAnalysisMetadataFacetReadModel } from "@/lib/inspector/resultAnalysisMetadataFacetReadModel";
import type { ResultAnalysisMetadataFacetCounter } from "@/lib/inspector/resultAnalysisMetadataFacets";
import {
  buildResultAnalysisViewModelSummaryCounters,
  type ResultAnalysisViewModelSummaryCounter,
} from "@/lib/inspector/resultAnalysisViewModels";
import {
  buildResultAnalysisStore,
  type ResultAnalysisStore,
} from "@/lib/inspector/resultAnalysisStore";
import type {
  InspectorChainSummary,
  InspectorGroup,
  InspectorPanelType,
  InspectorViewState,
  ScoreColumn,
  ScoreRef,
} from "@/types/inspector";
import type {
  InspectorPanelRendererControls,
  InspectorPanelRendererQueries,
} from "../InspectorPanelRenderer";
import { useInspectorPanelActions, type InspectorPanelActions } from "./useInspectorPanelActions";

const DEFAULT_FOCUS_LIMIT = 8;
const DEFAULT_RANKING_LIMIT = 80;

export interface UseInspectorPanelRuntimeInput {
  groups: InspectorGroup[];
  filteredChains: InspectorChainSummary[];
  filteredChainIds: ReadonlySet<string>;
  selectedChains: ReadonlySet<string>;
  pinnedChains: ReadonlySet<string>;
  scoreColumn: ScoreColumn;
  selectedScoreRefKey?: string | null;
  partition: string;
  targetIndex?: number;
  panelStates: Record<InspectorPanelType, InspectorViewState>;
  maximizedPanel: InspectorPanelType | null;
  hasMaximized: boolean;
  layoutMode: LayoutMode;
  focusLimit?: number;
  rankingLimit?: number;
}

export interface UseInspectorPanelRuntimeResult {
  visibleGroups: InspectorGroup[];
  analysisStore: ResultAnalysisStore;
  focus: InspectorFocusState;
  panelData: InspectorPanelData;
  metricObservations: InspectorMetricObservationReadModel;
  effectiveScoreColumn: ScoreColumn;
  effectiveScoreRef: ScoreRef | null;
  panelIdsToRender: InspectorPanelType[];
  panelQueryInputs: InspectorPanelQueryInputs;
  gridClassName: string;
  workspaceSummary: InspectorWorkspaceSummary;
  resultAnalysisSummaryCounters: ResultAnalysisViewModelSummaryCounter[];
  resultAnalysisMetadataFacetCounters: ResultAnalysisMetadataFacetCounter[];
  panelActions: Record<InspectorPanelType, InspectorPanelActions>;
  queries: InspectorPanelRendererQueries;
  controls: InspectorPanelRendererControls;
}

export function intersectInspectorGroups(
  groups: readonly InspectorGroup[],
  visibleIds: ReadonlySet<string>,
): InspectorGroup[] {
  return groups
    .map(group => ({
      ...group,
      chain_ids: group.chain_ids.filter(chainId => visibleIds.has(chainId)),
    }))
    .filter(group => group.chain_ids.length > 0);
}

export function useInspectorPanelRuntime({
  groups,
  filteredChains,
  filteredChainIds,
  selectedChains,
  pinnedChains,
  scoreColumn,
  selectedScoreRefKey = null,
  partition,
  targetIndex = 0,
  panelStates,
  maximizedPanel,
  hasMaximized,
  layoutMode,
  focusLimit = DEFAULT_FOCUS_LIMIT,
  rankingLimit = DEFAULT_RANKING_LIMIT,
}: UseInspectorPanelRuntimeInput): UseInspectorPanelRuntimeResult {
  const panelActions = useInspectorPanelActions();

  const [selectedHyperParam, setSelectedHyperParam] = useState("");
  const [biasVarianceGroupBy, setBiasVarianceGroupBy] = useState("model_class");
  const [heatmapXAxis, setHeatmapXAxis] = useState<InspectorHeatmapAxisField | null>(null);
  const [heatmapYAxis, setHeatmapYAxis] = useState<InspectorHeatmapAxisField | null>(null);

  const visibleGroups = useMemo(
    () => intersectInspectorGroups(groups, filteredChainIds),
    [filteredChainIds, groups],
  );
  const analysisStore = useMemo(
    () => buildResultAnalysisStore({ chains: filteredChains }),
    [filteredChains],
  );
  const metricObservations = useMemo(
    () => buildInspectorMetricObservationReadModel(filteredChains),
    [filteredChains],
  );
  const resolvedScoreRefSelection = useMemo(
    () => resolveInspectorSelectedScoreRef(scoreColumn, selectedScoreRefKey, metricObservations),
    [metricObservations, scoreColumn, selectedScoreRefKey],
  );
  const effectiveScoreColumn = resolvedScoreRefSelection.scoreColumn;
  const effectiveScoreRef = resolvedScoreRefSelection.scoreRef;
  const focus = useMemo(() => {
    return buildInspectorFocusStateFromStore({
      store: analysisStore,
      scoreColumn: effectiveScoreColumn,
      selectedChainIds: selectedChains,
      pinnedChainIds: pinnedChains,
      limit: focusLimit,
    });
  }, [analysisStore, effectiveScoreColumn, focusLimit, pinnedChains, selectedChains]);
  const panelData = useMemo(
    () => buildInspectorPanelDataFromStore({
      store: analysisStore,
      scoreColumn: effectiveScoreColumn,
      metricObservations,
      selection: {
        heatmapXAxis,
        heatmapYAxis,
        selectedHyperParam,
      },
      rankingLimit,
    }),
    [analysisStore, effectiveScoreColumn, heatmapXAxis, heatmapYAxis, metricObservations, rankingLimit, selectedHyperParam],
  );
  const resultAnalysisSummaryCounters = useMemo(() => {
    const leaderboardView = buildResultAnalysisView(analysisStore, {
      kind: "leaderboard",
      scoreColumn: effectiveScoreColumn,
      limit: rankingLimit,
    });
    const matrixView = buildResultAnalysisView(analysisStore, {
      kind: "matrix",
      scoreColumn: effectiveScoreColumn,
    });
    const leaderboard = buildResultAnalysisLeaderboardViewModel(leaderboardView, effectiveScoreColumn);
    const matrix = buildResultAnalysisMatrixViewModel(matrixView, {
      columnField: panelData.chartInputs.heatmapAxes.xVariable,
      rowField: panelData.chartInputs.heatmapAxes.yVariable,
      scoreColumn: effectiveScoreColumn,
    });

    return buildResultAnalysisViewModelSummaryCounters({ leaderboard, matrix });
  }, [
    analysisStore,
    effectiveScoreColumn,
    panelData.chartInputs.heatmapAxes.xVariable,
    panelData.chartInputs.heatmapAxes.yVariable,
    rankingLimit,
  ]);
  const resultAnalysisMetadataFacetCounters = useMemo(() => {
    return buildResultAnalysisMetadataFacetReadModel(analysisStore.chains).counters;
  }, [analysisStore]);

  const panelIdsToRender = useMemo(() => {
    return getInspectorPanelIdsToRender({
      panelStates,
      hasMaximized,
      maximizedPanel,
    });
  }, [hasMaximized, maximizedPanel, panelStates]);

  const activePanelSet = useMemo(
    () => new Set(panelIdsToRender),
    [panelIdsToRender],
  );
  const panelQueryInputs = useMemo(
    () => buildInspectorPanelQueryInputs({
      activePanels: activePanelSet,
      focus,
      partition,
      targetIndex,
      scoreColumn: effectiveScoreColumn,
      scoreRef: effectiveScoreRef,
      biasVarianceGroupBy,
    }),
    [activePanelSet, biasVarianceGroupBy, effectiveScoreColumn, effectiveScoreRef, focus, partition, targetIndex],
  );

  const scatterQuery = useInspectorScatter(panelQueryInputs.scatter);
  const foldStabilityQuery = useInspectorFoldStability(panelQueryInputs.foldStability);
  const confusionQuery = useInspectorConfusionMatrix(panelQueryInputs.confusion);
  const biasVarianceQuery = useInspectorBiasVariance(panelQueryInputs.biasVariance);
  const topologyQuery = useInspectorBranchTopology(panelQueryInputs.topology);

  const gridClassName = useMemo(() => {
    return getInspectorPanelGridClassName({ hasMaximized, layoutMode });
  }, [hasMaximized, layoutMode]);

  const workspaceSummary = useMemo(
    () => buildInspectorWorkspaceSummaryFromStore({ store: analysisStore, scoreColumn: effectiveScoreColumn, focus }),
    [analysisStore, effectiveScoreColumn, focus],
  );

  return {
    visibleGroups,
    analysisStore,
    focus,
    panelData,
    metricObservations,
    effectiveScoreColumn,
    effectiveScoreRef,
    panelIdsToRender,
    panelQueryInputs,
    gridClassName,
    workspaceSummary,
    resultAnalysisSummaryCounters,
    resultAnalysisMetadataFacetCounters,
    panelActions,
    queries: {
      scatter: scatterQuery,
      foldStability: foldStabilityQuery,
      confusion: confusionQuery,
      biasVariance: biasVarianceQuery,
      topology: topologyQuery,
    },
    controls: {
      biasVarianceGroupBy,
      onBiasVarianceGroupByChange: setBiasVarianceGroupBy,
      onHeatmapXAxisChange: setHeatmapXAxis,
      onHeatmapYAxisChange: setHeatmapYAxis,
      onHyperParamChange: setSelectedHyperParam,
    },
  };
}
