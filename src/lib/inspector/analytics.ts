import { isLowerBetter } from "@/lib/scores";
import type {
  BranchComparisonResponse,
  CandlestickCategory,
  CandlestickResponse,
  HeatmapResponse,
  HistogramResponse,
  HyperparameterResponse,
  InspectorChainSummary,
  PreprocessingImpactResponse,
  RankingsResponse,
  ScoreColumn,
} from "@/types/inspector";

type ChainField =
  | "model_class"
  | "model_name"
  | "preprocessings"
  | "dataset_name"
  | "run_id"
  | "task_type"
  | "pipeline_id";

type AggregateMode = "best" | "mean" | "median" | "worst";

export interface FocusedChainsResult {
  chainIds: string[];
  mode: "selection" | "top";
}

export interface OverviewLeader {
  label: string;
  score: number;
  count: number;
}

export interface InspectorOverviewStats {
  totalChains: number;
  scoredChains: number;
  modelCount: number;
  datasetCount: number;
  runCount: number;
  preprocessingCount: number;
  bestChain: InspectorChainSummary | null;
  bestScore: number | null;
  medianScore: number | null;
  meanScore: number | null;
  iqr: number | null;
  mixedMetrics: boolean;
  mixedTaskTypes: boolean;
  hasClassification: boolean;
  hasRegression: boolean;
  topModelLeader: OverviewLeader | null;
  topPreprocessingLeader: OverviewLeader | null;
}

function getFiniteScore(chain: InspectorChainSummary, scoreColumn: ScoreColumn): number | null {
  const value = chain[scoreColumn];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getMetricDirection(chains: readonly InspectorChainSummary[]): boolean {
  const metric = chains.find(chain => chain.metric)?.metric ?? null;
  return isLowerBetter(metric);
}

function toLabel(value: unknown, emptyLabel = "(empty)"): string {
  if (value == null) return emptyLabel;
  const text = String(value).trim();
  return text.length > 0 ? text : emptyLabel;
}

function normalizeBranchPath(branchPath: unknown): string {
  if (branchPath == null) return "(no branch)";
  if (Array.isArray(branchPath)) {
    if (branchPath.length === 0) return "(no branch)";
    return branchPath.map(part => String(part)).join(" > ");
  }
  return toLabel(branchPath, "(no branch)");
}

function splitPreprocessingSteps(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(" | ")
    .map(step => step.trim())
    .filter(Boolean);
}

function quantile(sortedValues: number[], q: number): number {
  if (sortedValues.length === 0) return Number.NaN;
  const clampedQ = Math.min(1, Math.max(0, q));
  const position = (sortedValues.length - 1) * clampedQ;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function summarizeScores(values: number[]): { mean: number; median: number; q25: number; q75: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    mean,
    median: quantile(sorted, 0.5),
    q25: quantile(sorted, 0.25),
    q75: quantile(sorted, 0.75),
  };
}

function compareScores(a: number, b: number, lowerBetter: boolean): number {
  return lowerBetter ? a - b : b - a;
}

function getDistinctCount(chains: readonly InspectorChainSummary[], field: ChainField): number {
  return new Set(
    chains
      .map(chain => toLabel(chain[field], ""))
      .filter(Boolean),
  ).size;
}

function countPreprocessingVariants(chains: readonly InspectorChainSummary[]): number {
  return new Set(
    chains
      .map(chain => toLabel(chain.preprocessings, ""))
      .filter(Boolean),
  ).size;
}

function groupScores(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
  field: ChainField,
): Map<string, { chainIds: string[]; scores: number[] }> {
  const groups = new Map<string, { chainIds: string[]; scores: number[] }>();
  for (const chain of chains) {
    const score = getFiniteScore(chain, scoreColumn);
    if (score == null) continue;
    const label = toLabel(chain[field]);
    const current = groups.get(label) ?? { chainIds: [], scores: [] };
    current.chainIds.push(chain.chain_id);
    current.scores.push(score);
    groups.set(label, current);
  }
  return groups;
}

function aggregateScores(scores: number[], lowerBetter: boolean, aggregate: AggregateMode): number {
  const sorted = [...scores].sort((a, b) => a - b);
  if (aggregate === "best") return lowerBetter ? sorted[0] : sorted[sorted.length - 1];
  if (aggregate === "worst") return lowerBetter ? sorted[sorted.length - 1] : sorted[0];
  if (aggregate === "median") return quantile(sorted, 0.5);
  return sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
}

function chooseLeader(
  groups: Map<string, { chainIds: string[]; scores: number[] }>,
  lowerBetter: boolean,
): OverviewLeader | null {
  let leader: OverviewLeader | null = null;
  for (const [label, entry] of groups) {
    if (entry.scores.length === 0) continue;
    const summary = summarizeScores(entry.scores);
    const candidate = {
      label,
      score: summary.median,
      count: entry.scores.length,
    };
    if (!leader || compareScores(candidate.score, leader.score, lowerBetter) < 0) {
      leader = candidate;
    }
  }
  return leader;
}

export function sortChainsByScore(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
): InspectorChainSummary[] {
  const lowerBetter = getMetricDirection(chains);
  const sorted = [...chains];
  sorted.sort((left, right) => {
    const leftScore = getFiniteScore(left, scoreColumn);
    const rightScore = getFiniteScore(right, scoreColumn);
    if (leftScore == null && rightScore == null) return 0;
    if (leftScore == null) return 1;
    if (rightScore == null) return -1;
    return compareScores(leftScore, rightScore, lowerBetter);
  });
  return sorted;
}

export function pickFocusedChainIds(
  chains: readonly InspectorChainSummary[],
  selectedChains: ReadonlySet<string>,
  scoreColumn: ScoreColumn,
  limit = 6,
): FocusedChainsResult {
  const sorted = sortChainsByScore(chains, scoreColumn);
  const selectedIds = sorted
    .map(chain => chain.chain_id)
    .filter(chainId => selectedChains.has(chainId))
    .slice(0, limit);

  if (selectedIds.length > 0) {
    return { chainIds: selectedIds, mode: "selection" };
  }

  return {
    chainIds: sorted.slice(0, limit).map(chain => chain.chain_id),
    mode: "top",
  };
}

export function buildOverviewStats(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
): InspectorOverviewStats {
  const scoredChains = chains.filter(chain => getFiniteScore(chain, scoreColumn) != null);
  const scores = scoredChains
    .map(chain => getFiniteScore(chain, scoreColumn))
    .filter((value): value is number => value != null);
  const sortedScoredChains = sortChainsByScore(scoredChains, scoreColumn);
  const metrics = new Set(chains.map(chain => chain.metric).filter(Boolean));
  const taskTypes = new Set(chains.map(chain => chain.task_type).filter(Boolean));
  const lowerBetter = getMetricDirection(chains);

  let medianScore: number | null = null;
  let meanScore: number | null = null;
  let iqr: number | null = null;

  if (scores.length > 0) {
    const summary = summarizeScores(scores);
    medianScore = summary.median;
    meanScore = summary.mean;
    iqr = summary.q75 - summary.q25;
  }

  return {
    totalChains: chains.length,
    scoredChains: scores.length,
    modelCount: getDistinctCount(chains, "model_class"),
    datasetCount: getDistinctCount(chains, "dataset_name"),
    runCount: getDistinctCount(chains, "run_id"),
    preprocessingCount: countPreprocessingVariants(chains),
    bestChain: sortedScoredChains[0] ?? null,
    bestScore: scores.length > 0 ? getFiniteScore(sortedScoredChains[0], scoreColumn) : null,
    medianScore,
    meanScore,
    iqr,
    mixedMetrics: metrics.size > 1,
    mixedTaskTypes: taskTypes.size > 1,
    hasClassification: [...taskTypes].some(task =>
      task === "classification" || task === "binary_classification" || task === "multiclass_classification",
    ),
    hasRegression: [...taskTypes].some(task =>
      task === "regression" || task === "continuous" || task == null,
    ),
    topModelLeader: chooseLeader(groupScores(chains, scoreColumn, "model_class"), lowerBetter),
    topPreprocessingLeader: chooseLeader(groupScores(chains, scoreColumn, "preprocessings"), lowerBetter),
  };
}

export function chooseHeatmapAxes(chains: readonly InspectorChainSummary[]): { xVariable: ChainField; yVariable: ChainField } {
  const candidates: ChainField[] = ["model_class", "preprocessings", "dataset_name", "run_id"];
  const usable = candidates.filter(field => {
    const count = getDistinctCount(chains, field);
    return count >= 2 && count <= 8;
  });

  if (usable.length >= 2) {
    return { xVariable: usable[0], yVariable: usable[1] };
  }

  if (usable.length === 1) {
    const fallback = usable[0] === "model_class" ? "dataset_name" : "model_class";
    return { xVariable: usable[0], yVariable: fallback };
  }

  return { xVariable: "model_class", yVariable: "preprocessings" };
}

export function chooseCandlestickField(chains: readonly InspectorChainSummary[]): ChainField {
  const candidates: ChainField[] = ["model_class", "preprocessings", "dataset_name", "run_id"];
  for (const field of candidates) {
    const count = getDistinctCount(chains, field);
    if (count >= 2 && count <= 10) {
      return field;
    }
  }
  return "model_class";
}

export function buildHistogramData(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
  nBins = 12,
): HistogramResponse {
  const scored = chains
    .map(chain => ({
      chainId: chain.chain_id,
      score: getFiniteScore(chain, scoreColumn),
    }))
    .filter((entry): entry is { chainId: string; score: number } => entry.score != null);

  if (scored.length === 0) {
    return {
      bins: [],
      score_column: scoreColumn,
      total_chains: 0,
      min_score: null,
      max_score: null,
      mean_score: null,
    };
  }

  const scores = scored.map(entry => entry.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const meanScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;

  if (minScore === maxScore) {
    return {
      bins: [{
        bin_start: minScore,
        bin_end: maxScore,
        count: scored.length,
        chain_ids: scored.map(entry => entry.chainId),
      }],
      score_column: scoreColumn,
      total_chains: scored.length,
      min_score: minScore,
      max_score: maxScore,
      mean_score: meanScore,
    };
  }

  const binCount = Math.max(5, Math.min(nBins, scored.length));
  const binWidth = (maxScore - minScore) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    bin_start: minScore + index * binWidth,
    bin_end: index === binCount - 1 ? maxScore : minScore + (index + 1) * binWidth,
    count: 0,
    chain_ids: [] as string[],
  }));

  for (const entry of scored) {
    const rawIndex = Math.floor((entry.score - minScore) / binWidth);
    const index = Math.min(binCount - 1, Math.max(0, rawIndex));
    bins[index].count += 1;
    bins[index].chain_ids.push(entry.chainId);
  }

  return {
    bins,
    score_column: scoreColumn,
    total_chains: scored.length,
    min_score: minScore,
    max_score: maxScore,
    mean_score: meanScore,
  };
}

export function buildRankingsData(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
  limit = 50,
): RankingsResponse {
  const lowerBetter = getMetricDirection(chains);
  const scoredCount = chains.filter(chain => getFiniteScore(chain, scoreColumn) != null).length;
  const sorted = sortChainsByScore(chains, scoreColumn).slice(0, limit);
  return {
    rankings: sorted.map((chain, index) => ({
      rank: index + 1,
      chain_id: chain.chain_id,
      model_class: chain.model_class,
      model_name: chain.model_name,
      preprocessings: chain.preprocessings,
      cv_val_score: chain.cv_val_score,
      cv_test_score: chain.cv_test_score,
      cv_train_score: chain.cv_train_score,
      final_test_score: chain.final_test_score,
      final_train_score: chain.final_train_score,
      cv_fold_count: chain.cv_fold_count,
      dataset_name: chain.dataset_name,
      best_params: chain.best_params,
    })),
    total: scoredCount,
    score_column: scoreColumn,
    sort_ascending: lowerBetter,
  };
}

export function buildHeatmapData(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
  xVariable: ChainField,
  yVariable: ChainField,
  aggregate: AggregateMode = "median",
): HeatmapResponse {
  const lowerBetter = getMetricDirection(chains);
  const grouped = new Map<string, { x: string; y: string; scores: number[]; chainIds: string[] }>();

  for (const chain of chains) {
    const score = getFiniteScore(chain, scoreColumn);
    if (score == null) continue;
    const x = toLabel(chain[xVariable]);
    const y = toLabel(chain[yVariable]);
    const key = `${x}__${y}`;
    const current = grouped.get(key) ?? { x, y, scores: [], chainIds: [] };
    current.scores.push(score);
    current.chainIds.push(chain.chain_id);
    grouped.set(key, current);
  }

  if (grouped.size === 0) {
    return {
      cells: [],
      x_labels: [],
      y_labels: [],
      x_variable: xVariable,
      y_variable: yVariable,
      score_column: scoreColumn,
      min_value: null,
      max_value: null,
    };
  }

  const cells = [...grouped.values()].map(entry => ({
    x_label: entry.x,
    y_label: entry.y,
    value: aggregateScores(entry.scores, lowerBetter, aggregate),
    count: entry.scores.length,
    chain_ids: entry.chainIds,
  }));

  const values = cells.map(cell => cell.value).filter((value): value is number => value != null);

  return {
    cells,
    x_labels: [...new Set(cells.map(cell => cell.x_label))],
    y_labels: [...new Set(cells.map(cell => cell.y_label))],
    x_variable: xVariable,
    y_variable: yVariable,
    score_column: scoreColumn,
    min_value: values.length > 0 ? Math.min(...values) : null,
    max_value: values.length > 0 ? Math.max(...values) : null,
  };
}

export function buildCandlestickData(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
  categoryVariable: ChainField,
): CandlestickResponse {
  const grouped = new Map<string, { scores: number[]; chainIds: string[] }>();

  for (const chain of chains) {
    const score = getFiniteScore(chain, scoreColumn);
    if (score == null) continue;
    const label = toLabel(chain[categoryVariable]);
    const current = grouped.get(label) ?? { scores: [], chainIds: [] };
    current.scores.push(score);
    current.chainIds.push(chain.chain_id);
    grouped.set(label, current);
  }

  const categories: CandlestickCategory[] = [...grouped.entries()]
    .map(([label, entry]) => {
      const sorted = [...entry.scores].sort((a, b) => a - b);
      const q25 = quantile(sorted, 0.25);
      const q75 = quantile(sorted, 0.75);
      const median = quantile(sorted, 0.5);
      const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
      const iqr = q75 - q25;
      const lowerFence = q25 - 1.5 * iqr;
      const upperFence = q75 + 1.5 * iqr;
      return {
        label,
        min: sorted[0],
        q25,
        median,
        q75,
        max: sorted[sorted.length - 1],
        mean,
        count: sorted.length,
        outlier_values: sorted.filter(value => value < lowerFence || value > upperFence),
        chain_ids: entry.chainIds,
      };
    })
    .sort((left, right) => right.count - left.count);

  return {
    categories,
    category_variable: categoryVariable,
    score_column: scoreColumn,
  };
}

export function buildPreprocessingImpactData(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
): PreprocessingImpactResponse {
  const lowerBetter = getMetricDirection(chains);
  const scoredChains = chains.filter(chain => getFiniteScore(chain, scoreColumn) != null);
  const allIndices = new Set(scoredChains.map((_, index) => index));
  const stepIndexes = new Map<string, Set<number>>();

  for (const [index, chain] of scoredChains.entries()) {
    for (const step of splitPreprocessingSteps(chain.preprocessings)) {
      const indices = stepIndexes.get(step) ?? new Set<number>();
      indices.add(index);
      stepIndexes.set(step, indices);
    }
  }

  const entries = [...stepIndexes.entries()]
    .map(([step, withIndexes]) => {
      const withoutIndexes = [...allIndices].filter(index => !withIndexes.has(index));
      const withScores = [...withIndexes]
        .map(index => getFiniteScore(scoredChains[index], scoreColumn))
        .filter((value): value is number => value != null);
      const withoutScores = withoutIndexes
        .map(index => getFiniteScore(scoredChains[index], scoreColumn))
        .filter((value): value is number => value != null);

      if (withScores.length === 0 || withoutScores.length === 0) return null;

      const meanWith = withScores.reduce((sum, value) => sum + value, 0) / withScores.length;
      const meanWithout = withoutScores.reduce((sum, value) => sum + value, 0) / withoutScores.length;
      const rawImpact = meanWith - meanWithout;
      const impact = lowerBetter ? -rawImpact : rawImpact;

      return {
        step_name: step,
        impact,
        mean_with: meanWith,
        mean_without: meanWithout,
        count_with: withScores.length,
        count_without: withoutScores.length,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null)
    .sort((left, right) => Math.abs(right.impact ?? 0) - Math.abs(left.impact ?? 0));

  return {
    entries,
    score_column: scoreColumn,
    total_chains: scoredChains.length,
  };
}

export function getAvailableHyperparameters(chains: readonly InspectorChainSummary[]): string[] {
  const counts = new Map<string, number>();
  for (const chain of chains) {
    if (!chain.best_params || typeof chain.best_params !== "object") continue;
    for (const [key, value] of Object.entries(chain.best_params)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1])
    .map(([key]) => key);
}

export function buildHyperparameterData(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
  paramName: string,
): HyperparameterResponse {
  const available_params = getAvailableHyperparameters(chains);
  const points = chains
    .map(chain => {
      const score = getFiniteScore(chain, scoreColumn);
      const bestParams = chain.best_params;
      if (score == null || !bestParams || typeof bestParams !== "object") return null;
      const paramValue = (bestParams as Record<string, unknown>)[paramName];
      if (typeof paramValue !== "number" || !Number.isFinite(paramValue)) return null;
      return {
        chain_id: chain.chain_id,
        param_value: paramValue,
        score,
        model_class: chain.model_class,
      };
    })
    .filter((point): point is NonNullable<typeof point> => point != null);

  return {
    points,
    param_name: paramName,
    score_column: scoreColumn,
    available_params,
  };
}

export function buildBranchComparisonData(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
): BranchComparisonResponse {
  const lowerBetter = getMetricDirection(chains);
  const grouped = new Map<string, { scores: number[]; chainIds: string[] }>();

  for (const chain of chains) {
    const score = getFiniteScore(chain, scoreColumn);
    if (score == null) continue;
    const label = normalizeBranchPath(chain.branch_path);
    const current = grouped.get(label) ?? { scores: [], chainIds: [] };
    current.scores.push(score);
    current.chainIds.push(chain.chain_id);
    grouped.set(label, current);
  }

  const branches = [...grouped.entries()]
    .map(([label, entry]) => {
      const mean = entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length;
      const variance = entry.scores.length > 1
        ? entry.scores.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (entry.scores.length - 1)
        : 0;
      const std = Math.sqrt(variance);
      const ciHalf = entry.scores.length > 1 ? (1.96 * std) / Math.sqrt(entry.scores.length) : 0;
      return {
        branch_path: label,
        label,
        mean,
        std,
        min: Math.min(...entry.scores),
        max: Math.max(...entry.scores),
        ci_lower: mean - ciHalf,
        ci_upper: mean + ciHalf,
        count: entry.scores.length,
        chain_ids: entry.chainIds,
      };
    })
    .sort((left, right) => compareScores(left.mean, right.mean, lowerBetter));

  return {
    branches,
    score_column: scoreColumn,
    total_chains: branches.reduce((sum, branch) => sum + branch.count, 0),
  };
}
