import {
  buildBranchComparisonData,
  buildCandlestickData,
  buildHeatmapData,
  buildHistogramData,
  buildHyperparameterData,
  buildOverviewStats,
  buildPreprocessingImpactData,
  buildRankingsData,
  type InspectorOverviewStats,
} from "@/lib/inspector/analytics";
import {
  buildInspectorChartInputs,
  buildInspectorMetricObservationReadModel,
  resolveInspectorObservedScoreColumn,
  type InspectorChartInputs,
  type InspectorChartInputSelection,
  type InspectorMetricObservationReadModel,
} from "@/lib/inspector/chartInputs";
import { getResultAnalysisChains, type ResultAnalysisStore } from "@/lib/inspector/resultAnalysisStore";
import type {
  BranchComparisonResponse,
  CandlestickResponse,
  HeatmapResponse,
  HistogramResponse,
  HyperparameterResponse,
  InspectorChainSummary,
  PreprocessingImpactResponse,
  RankingsResponse,
  ScoreColumn,
} from "@/types/inspector";

export interface InspectorPanelDataInput {
  chains: readonly InspectorChainSummary[];
  scoreColumn: ScoreColumn;
  selection: InspectorChartInputSelection;
  metricObservations?: InspectorMetricObservationReadModel;
  rankingLimit?: number;
}

export interface InspectorPanelDataFromStoreInput extends Omit<InspectorPanelDataInput, "chains"> {
  store: ResultAnalysisStore;
}

export interface InspectorPanelData {
  overviewStats: InspectorOverviewStats;
  rankingsData: RankingsResponse;
  histogramData: HistogramResponse;
  chartInputs: InspectorChartInputs;
  heatmapData: HeatmapResponse;
  candlestickData: CandlestickResponse;
  preprocessingImpactData: PreprocessingImpactResponse;
  hyperparameterData: HyperparameterResponse;
  branchComparisonData: BranchComparisonResponse;
}

export function buildInspectorPanelData({
  chains,
  scoreColumn,
  selection,
  metricObservations,
  rankingLimit = 80,
}: InspectorPanelDataInput): InspectorPanelData {
  const chartInputs = buildInspectorChartInputs(chains, selection);
  const { heatmapAxes, candlestickField, activeHyperParam } = chartInputs;
  const metricObservationReadModel = metricObservations ?? buildInspectorMetricObservationReadModel(chains);
  const observedScoreColumn = resolveInspectorObservedScoreColumn(scoreColumn, metricObservationReadModel);

  return {
    overviewStats: buildOverviewStats(chains, observedScoreColumn),
    rankingsData: buildRankingsData(chains, observedScoreColumn, rankingLimit),
    histogramData: buildHistogramData(chains, observedScoreColumn),
    chartInputs,
    heatmapData: buildHeatmapData(chains, observedScoreColumn, heatmapAxes.xVariable, heatmapAxes.yVariable, "median"),
    candlestickData: buildCandlestickData(chains, observedScoreColumn, candlestickField),
    preprocessingImpactData: buildPreprocessingImpactData(chains, observedScoreColumn),
    hyperparameterData: buildHyperparameterData(chains, observedScoreColumn, activeHyperParam),
    branchComparisonData: buildBranchComparisonData(chains, observedScoreColumn),
  };
}

export function buildInspectorPanelDataFromStore({
  store,
  scoreColumn,
  selection,
  metricObservations,
  rankingLimit,
}: InspectorPanelDataFromStoreInput): InspectorPanelData {
  return buildInspectorPanelData({
    chains: getResultAnalysisChains(store),
    scoreColumn,
    selection,
    metricObservations,
    rankingLimit,
  });
}
