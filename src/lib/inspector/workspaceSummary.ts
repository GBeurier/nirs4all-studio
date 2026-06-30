import type { InspectorFocusLabelChain, InspectorFocusMode } from "@/lib/inspector/focus";
import type { InspectorOverviewStats } from "@/lib/inspector/analytics";
import {
  getResultAnalysisBestScoreEntry,
  getResultAnalysisScope,
  type ResultAnalysisStore,
} from "@/lib/inspector/resultAnalysisStore";
import { formatMetricValue } from "@/lib/scores";
import type { ScoreColumn } from "@/types/inspector";

export interface InspectorWorkspaceSummaryInput {
  overviewStats: Pick<
    InspectorOverviewStats,
    "bestScore" | "bestChain" | "modelCount" | "datasetCount" | "mixedMetrics" | "mixedTaskTypes"
  >;
  focus: {
    labelChains: InspectorFocusLabelChain[];
    mode: InspectorFocusMode;
  };
}

export interface InspectorWorkspaceSummaryFromStoreInput {
  store: Pick<ResultAnalysisStore, "chains" | "scope">;
  scoreColumn: ScoreColumn;
  focus: {
    labelChains: InspectorFocusLabelChain[];
    mode: InspectorFocusMode;
  };
}

export interface InspectorWorkspaceSummary {
  bestScoreLabel: string | null;
  bestChainLabel: string | null;
  focusChains: InspectorFocusLabelChain[];
  focusMode: InspectorFocusMode;
  modelCount: number;
  datasetCount: number;
  mixedMetrics: boolean;
  mixedTaskTypes: boolean;
}

export function buildInspectorWorkspaceSummary({
  overviewStats,
  focus,
}: InspectorWorkspaceSummaryInput): InspectorWorkspaceSummary {
  return {
    bestScoreLabel: overviewStats.bestScore != null
      ? formatMetricValue(overviewStats.bestScore, overviewStats.bestChain?.metric ?? undefined)
      : null,
    bestChainLabel: overviewStats.bestChain?.model_name ?? overviewStats.bestChain?.model_class ?? null,
    focusChains: focus.labelChains,
    focusMode: focus.mode,
    modelCount: overviewStats.modelCount,
    datasetCount: overviewStats.datasetCount,
    mixedMetrics: overviewStats.mixedMetrics,
    mixedTaskTypes: overviewStats.mixedTaskTypes,
  };
}

export function buildInspectorWorkspaceSummaryFromStore({
  store,
  scoreColumn,
  focus,
}: InspectorWorkspaceSummaryFromStoreInput): InspectorWorkspaceSummary {
  const scope = getResultAnalysisScope(store);
  const bestEntry = getResultAnalysisBestScoreEntry(store, scoreColumn);

  return {
    bestScoreLabel: bestEntry
      ? formatMetricValue(bestEntry.score, bestEntry.chain.metric ?? undefined)
      : null,
    bestChainLabel: bestEntry?.chain.model_name ?? bestEntry?.chain.model_class ?? null,
    focusChains: focus.labelChains,
    focusMode: focus.mode,
    modelCount: scope.modelClasses.length,
    datasetCount: scope.datasetNames.length,
    mixedMetrics: scope.hasMixedMetrics,
    mixedTaskTypes: scope.hasMixedTaskTypes,
  };
}
