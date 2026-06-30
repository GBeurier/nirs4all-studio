import {
  getResultAnalysisDisplayCellKey,
  getResultAnalysisInternalCellKey,
  getResultAnalysisMeanScore,
  isPreferredResultAnalysisScore,
  type ResultAnalysisScoredView,
} from "@/lib/inspector/resultAnalysisAggregations";
import {
  getResultAnalysisAxisLabel,
  type ResultAnalysisMatrixAxisField,
} from "@/lib/inspector/resultAnalysisDimensions";
import {
  getInspectorFiniteScore,
  isInspectorLowerBetter,
} from "@/lib/inspector/scoreAccess";
import type { ScoreColumn } from "@/types/inspector";

export interface ResultAnalysisLeaderboardRow {
  rank: number;
  chainId: string;
  score: number | null;
  runId: string;
  pipelineId: string;
  pipelineName: string | null;
  datasetName: string | null;
  modelClass: string;
  metric: string | null;
  taskType: string | null;
}

export interface ResultAnalysisLeaderboardViewModel<TView extends ResultAnalysisScoredView = ResultAnalysisScoredView> {
  view: TView;
  scoreColumn: ScoreColumn;
  rows: ResultAnalysisLeaderboardRow[];
  finiteScoreCount: number;
  missingScoreCount: number;
}

export interface ResultAnalysisMatrixCell {
  rowKey: string;
  columnKey: string;
  chainIds: string[];
  count: number;
  bestChainId: string | null;
  bestScore: number | null;
  meanScore: number | null;
}

export interface ResultAnalysisMatrixViewModelOptions {
  columnField: ResultAnalysisMatrixAxisField;
  rowField: ResultAnalysisMatrixAxisField;
  scoreColumn?: ScoreColumn;
  lowerBetter?: boolean;
}

export interface ResultAnalysisMatrixViewModel<TView extends ResultAnalysisScoredView = ResultAnalysisScoredView> {
  view: TView;
  scoreColumn: ScoreColumn;
  rowField: ResultAnalysisMatrixAxisField;
  columnField: ResultAnalysisMatrixAxisField;
  rowKeys: string[];
  columnKeys: string[];
  cells: ResultAnalysisMatrixCell[];
  cellByKey: ReadonlyMap<string, ResultAnalysisMatrixCell>;
}

export type ResultAnalysisViewModelSummaryCounterSource = "leaderboard" | "matrix";

export type ResultAnalysisViewModelSummaryCounterId =
  | "leaderboard.total"
  | "leaderboard.scored"
  | "leaderboard.missing"
  | "matrix.rows"
  | "matrix.columns"
  | "matrix.cells"
  | "matrix.scoredCells"
  | "matrix.assignments";

export interface ResultAnalysisViewModelSummaryCounter {
  id: ResultAnalysisViewModelSummaryCounterId;
  source: ResultAnalysisViewModelSummaryCounterSource;
  label: string;
  value: number;
  formattedValue: string;
}

export interface ResultAnalysisViewModelSummaryCountersInput {
  leaderboard?: ResultAnalysisLeaderboardViewModel | null;
  matrix?: ResultAnalysisMatrixViewModel | null;
}

export function buildResultAnalysisLeaderboardViewModel<TView extends ResultAnalysisScoredView>(
  view: TView,
  scoreColumn = view.scoreColumn,
): ResultAnalysisLeaderboardViewModel<TView> {
  if (!scoreColumn) {
    throw new Error("buildResultAnalysisLeaderboardViewModel requires a score column");
  }

  let finiteScoreCount = 0;
  const rows = view.chains.map((chain, index) => {
    const score = getInspectorFiniteScore(chain, scoreColumn);
    if (score != null) finiteScoreCount += 1;
    return {
      rank: index + 1,
      chainId: chain.chain_id,
      score,
      runId: chain.run_id,
      pipelineId: chain.pipeline_id,
      pipelineName: chain.pipeline_name,
      datasetName: chain.dataset_name,
      modelClass: chain.model_class,
      metric: chain.metric,
      taskType: chain.task_type,
    };
  });

  return {
    view,
    scoreColumn,
    rows,
    finiteScoreCount,
    missingScoreCount: rows.length - finiteScoreCount,
  };
}

export function buildResultAnalysisMatrixViewModel<TView extends ResultAnalysisScoredView>(
  view: TView,
  {
    columnField,
    rowField,
    scoreColumn = view.scoreColumn,
    lowerBetter,
  }: ResultAnalysisMatrixViewModelOptions,
): ResultAnalysisMatrixViewModel<TView> {
  if (!scoreColumn) {
    throw new Error("buildResultAnalysisMatrixViewModel requires a score column");
  }

  const inferredLowerBetter = lowerBetter ?? isInspectorLowerBetter(view.chains);
  const rowKeys = new Set<string>();
  const columnKeys = new Set<string>();
  const grouped = new Map<string, { chainIds: string[]; scores: number[]; bestChainId: string | null; bestScore: number | null }>();

  for (const chain of view.chains) {
    const rowKey = getResultAnalysisAxisLabel(chain, rowField);
    const columnKey = getResultAnalysisAxisLabel(chain, columnField);
    rowKeys.add(rowKey);
    columnKeys.add(columnKey);

    const key = getResultAnalysisInternalCellKey(rowKey, columnKey);
    const current = grouped.get(key) ?? { chainIds: [], scores: [], bestChainId: null, bestScore: null };
    current.chainIds.push(chain.chain_id);

    const score = getInspectorFiniteScore(chain, scoreColumn);
    if (score != null) {
      current.scores.push(score);
      if (isPreferredResultAnalysisScore(score, current.bestScore, chain.chain_id, current.bestChainId, inferredLowerBetter)) {
        current.bestScore = score;
        current.bestChainId = chain.chain_id;
      }
    }

    grouped.set(key, current);
  }

  const sortedRowKeys = [...rowKeys].sort((left, right) => left.localeCompare(right));
  const sortedColumnKeys = [...columnKeys].sort((left, right) => left.localeCompare(right));
  const cells: ResultAnalysisMatrixCell[] = [];
  const cellByKey = new Map<string, ResultAnalysisMatrixCell>();

  for (const rowKey of sortedRowKeys) {
    for (const columnKey of sortedColumnKeys) {
      const current = grouped.get(getResultAnalysisInternalCellKey(rowKey, columnKey));
      if (!current) continue;
      const cell: ResultAnalysisMatrixCell = {
        rowKey,
        columnKey,
        chainIds: current.chainIds,
        count: current.chainIds.length,
        bestChainId: current.bestChainId,
        bestScore: current.bestScore,
        meanScore: getResultAnalysisMeanScore(current.scores),
      };
      cells.push(cell);
      cellByKey.set(getResultAnalysisDisplayCellKey(rowKey, columnKey), cell);
    }
  }

  return {
    view,
    scoreColumn,
    rowField,
    columnField,
    rowKeys: sortedRowKeys,
    columnKeys: sortedColumnKeys,
    cells,
    cellByKey,
  };
}

export function buildResultAnalysisViewModelSummaryCounters({
  leaderboard,
  matrix,
}: ResultAnalysisViewModelSummaryCountersInput): ResultAnalysisViewModelSummaryCounter[] {
  const counters: ResultAnalysisViewModelSummaryCounter[] = [];

  if (leaderboard) {
    counters.push(
      buildResultAnalysisViewModelSummaryCounter("leaderboard.total", "leaderboard", "Chains", leaderboard.rows.length),
      buildResultAnalysisViewModelSummaryCounter("leaderboard.scored", "leaderboard", "Scored chains", leaderboard.finiteScoreCount),
      buildResultAnalysisViewModelSummaryCounter("leaderboard.missing", "leaderboard", "Missing scores", leaderboard.missingScoreCount),
    );
  }

  if (matrix) {
    const scoredCellCount = matrix.cells.filter(cell => cell.bestScore != null).length;
    const assignmentCount = matrix.cells.reduce((total, cell) => total + cell.count, 0);

    counters.push(
      buildResultAnalysisViewModelSummaryCounter("matrix.rows", "matrix", "Matrix rows", matrix.rowKeys.length),
      buildResultAnalysisViewModelSummaryCounter("matrix.columns", "matrix", "Matrix columns", matrix.columnKeys.length),
      buildResultAnalysisViewModelSummaryCounter("matrix.cells", "matrix", "Observed cells", matrix.cells.length),
      buildResultAnalysisViewModelSummaryCounter("matrix.scoredCells", "matrix", "Scored cells", scoredCellCount),
      buildResultAnalysisViewModelSummaryCounter("matrix.assignments", "matrix", "Cell assignments", assignmentCount),
    );
  }

  return counters;
}

function buildResultAnalysisViewModelSummaryCounter(
  id: ResultAnalysisViewModelSummaryCounterId,
  source: ResultAnalysisViewModelSummaryCounterSource,
  label: string,
  value: number,
): ResultAnalysisViewModelSummaryCounter {
  return {
    id,
    source,
    label,
    value,
    formattedValue: String(value),
  };
}
