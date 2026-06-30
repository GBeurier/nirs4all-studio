import {
  computeInspectorOutlierChainIds,
  computeInspectorScoreStats,
  isInspectorScoreInRange,
  type InspectorScoreStats,
} from "@/lib/inspector/scoreAccess";
import {
  getResultAnalysisChains,
  type ResultAnalysisStore,
} from "@/lib/inspector/resultAnalysisStore";
import type {
  InspectorChainSummary,
  InspectorOutlierFilter,
  InspectorSelectionFilter,
  ScoreColumn,
} from "@/types/inspector";

export interface ResultAnalysisFilterInput {
  store: Pick<ResultAnalysisStore, "chains">;
  scoreColumn: ScoreColumn;
  scoreRange: [number, number] | null;
  outlier: InspectorOutlierFilter;
  outlierChainIds: ReadonlySet<string>;
  selection: InspectorSelectionFilter;
  selectedChainIds: ReadonlySet<string>;
  hasSelection: boolean;
}

export function computeResultAnalysisScoreStats(
  store: Pick<ResultAnalysisStore, "chains">,
  scoreColumn: ScoreColumn,
): InspectorScoreStats | null {
  return computeInspectorScoreStats(getResultAnalysisChains(store), scoreColumn);
}

export function computeResultAnalysisOutlierChainIds(
  store: Pick<ResultAnalysisStore, "chains">,
  scoreColumn: ScoreColumn,
): Set<string> {
  return computeInspectorOutlierChainIds(getResultAnalysisChains(store), scoreColumn);
}

export function filterResultAnalysisChains({
  store,
  scoreColumn,
  scoreRange,
  outlier,
  outlierChainIds,
  selection,
  selectedChainIds,
  hasSelection,
}: ResultAnalysisFilterInput): InspectorChainSummary[] {
  let result = [...getResultAnalysisChains(store)];

  if (scoreRange) {
    const [min, max] = scoreRange;
    result = result.filter(chain => isInspectorScoreInRange(chain, scoreColumn, min, max));
  }

  if (outlier !== "all") {
    result = result.filter(chain => (
      outlier === "hide"
        ? !outlierChainIds.has(chain.chain_id)
        : outlierChainIds.has(chain.chain_id)
    ));
  }

  if (selection !== "all" && hasSelection) {
    result = result.filter(chain => (
      selection === "selected"
        ? selectedChainIds.has(chain.chain_id)
        : !selectedChainIds.has(chain.chain_id)
    ));
  }

  return result;
}
