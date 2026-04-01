import { isLowerBetter } from "@/lib/scores";
import type {
  CandlestickResponse,
  HeatmapResponse,
  HistogramResponse,
  HyperparameterResponse,
  InspectorChainSummary,
  PreprocessingImpactResponse,
  RankingsResponse,
  ScoreColumn,
} from "@/types/inspector";

export type NormalizedTaskType = "regression" | "classification" | "unknown";

export interface InspectorGroupSummary {
  label: string;
  count: number;
  best: number | null;
  mean: number | null;
  median: number | null;
  spread: number | null;
  chainIds: string[];
  topChainId: string | null;
}

export interface InspectorInsight {
  title: string;
  body: string;
  tone: "neutral" | "positive" | "warning";
}

export interface InspectorOverviewData {
  metric: string | null;
  lowerIsBetter: boolean;
  scoreableCount: number;
  datasetCount: number;
  runCount: number;
  modelCount: number;
  preprocessingStepCount: number;
  bestChain: InspectorChainSummary | null;
  bestScore: number | null;
  scoreRange: [number, number] | null;
  taskKinds: NormalizedTaskType[];
  metrics: string[];
  modelSummaries: InspectorGroupSummary[];
  datasetSummaries: InspectorGroupSummary[];
  insights: InspectorInsight[];
}

function getFiniteScore(chain: InspectorChainSummary, scoreColumn: ScoreColumn): number | null {
  const value = chain[scoreColumn];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = average(values);
  if (mean == null) return null;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function normalizeTaskType(taskType: string | null | undefined): NormalizedTaskType {
  const normalized = (taskType || "").toLowerCase();
  if (normalized.includes("classification")) return "classification";
  if (normalized.includes("regression")) return "regression";
  return "unknown";
}

export function splitPreprocessingSteps(preprocessings: string | null | undefined): string[] {
  if (!preprocessings) return [];
  return preprocessings
    .split(" | ")
    .map(step => step.trim())
    .filter(Boolean);
}

export function flattenNumericParams(
  params: Record<string, unknown> | null | undefined,
  prefix = "",
): Record<string, number> {
  const flattened: Record<string, number> = {};
  if (!params) return flattened;

  for (const [key, value] of Object.entries(params)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(flattened, flattenNumericParams(value as Record<string, unknown>, name));
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      flattened[name] = value;
    }
  }

  return flattened;
}

function sortChainsByScore(
  chains: InspectorChainSummary[],
  scoreColumn: ScoreColumn,
  metric: string | null,
): InspectorChainSummary[] {
  return [...chains].sort((left, right) => {
    const leftScore = getFiniteScore(left, scoreColumn);
    const rightScore = getFiniteScore(right, scoreColumn);
    if (leftScore == null && rightScore == null) return 0;
    if (leftScore == null) return 1;
    if (rightScore == null) return -1;
    if (leftScore === rightScore) return left.chain_id.localeCompare(right.chain_id);
    return isLowerBetter(metric) ? leftScore - rightScore : rightScore - leftScore;
  });
}

function buildGroupSummaries(
  chains: InspectorChainSummary[],
  scoreColumn: ScoreColumn,
  metric: string | null,
  getLabel: (chain: InspectorChainSummary) => string,
): InspectorGroupSummary[] {
  const groups = new Map<string, { chains: InspectorChainSummary[]; scores: number[] }>();

  for (const chain of chains) {
    const label = getLabel(chain);
    const group = groups.get(label) ?? { chains: [], scores: [] };
    group.chains.push(chain);

    const score = getFiniteScore(chain, scoreColumn);
    if (score != null) {
      group.scores.push(score);
    }

    groups.set(label, group);
  }

  const summaries = [...groups.entries()].map(([label, group]) => {
    const sortedChains = sortChainsByScore(group.chains, scoreColumn, metric);
    return {
      label,
      count: group.chains.length,
      best: group.scores.length ? sortedChains.map(chain => getFiniteScore(chain, scoreColumn)).find(score => score != null) ?? null : null,
      mean: average(group.scores),
      median: median(group.scores),
      spread: standardDeviation(group.scores),
      chainIds: group.chains.map(chain => chain.chain_id),
      topChainId: sortedChains[0]?.chain_id ?? null,
    } satisfies InspectorGroupSummary;
  });

  return summaries.sort((left, right) => {
    if (left.median != null && right.median != null && left.median !== right.median) {
      return isLowerBetter(metric) ? left.median - right.median : right.median - left.median;
    }
    if (left.best != null && right.best != null && left.best !== right.best) {
      return isLowerBetter(metric) ? left.best - right.best : right.best - left.best;
    }
    return right.count - left.count;
  });
}

export function getAvailableHyperparameters(chains: InspectorChainSummary[]): string[] {
  const counts = new Map<string, number>();
  const distinctValues = new Map<string, Set<number>>();

  for (const chain of chains) {
    const params = flattenNumericParams(
      (chain.variant_params ?? chain.best_params) as Record<string, unknown> | null | undefined,
    );
    for (const [key, value] of Object.entries(params)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const values = distinctValues.get(key) ?? new Set<number>();
      values.add(value);
      distinctValues.set(key, values);
    }
  }

  return [...counts.entries()]
    .filter(([key, count]) => count >= 2 && (distinctValues.get(key)?.size ?? 0) >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key]) => key);
}

export function buildRankingsData(
  chains: InspectorChainSummary[],
  scoreColumn: ScoreColumn,
): RankingsResponse {
  const metric = chains.find(chain => chain.metric)?.metric ?? null;
  const sortAscending = isLowerBetter(metric);
  const sorted = sortChainsByScore(chains, scoreColumn, metric);

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
    total: sorted.length,
    score_column: scoreColumn,
    sort_ascending: sortAscending,
  };
}

export function buildHistogramData(
  chains: InspectorChainSummary[],
  scoreColumn: ScoreColumn,
  nBins = 16,
): HistogramResponse {
  const scored = chains
    .map(chain => ({ chainId: chain.chain_id, score: getFiniteScore(chain, scoreColumn) }))
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

  const values = scored.map(entry => entry.score);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = average(values);

  if (min === max) {
    return {
      bins: [{
        bin_start: min,
        bin_end: max,
        count: scored.length,
        chain_ids: scored.map(entry => entry.chainId),
      }],
      score_column: scoreColumn,
      total_chains: scored.length,
      min_score: min,
      max_score: max,
      mean_score: mean,
    };
  }

  const bins = Math.max(5, Math.min(nBins, Math.ceil(Math.sqrt(scored.length)) * 2));
  const width = (max - min) / bins;

  return {
    bins: Array.from({ length: bins }, (_, index) => {
      const start = min + index * width;
      const end = index === bins - 1 ? max : start + width;
      const chainIds = scored
        .filter(entry => entry.score >= start && (index === bins - 1 ? entry.score <= end : entry.score < end))
        .map(entry => entry.chainId);

      return {
        bin_start: start,
        bin_end: end,
        count: chainIds.length,
        chain_ids: chainIds,
      };
    }),
    score_column: scoreColumn,
    total_chains: scored.length,
    min_score: min,
    max_score: max,
    mean_score: mean,
  };
}

export function buildHeatmapData(
  chains: InspectorChainSummary[],
  scoreColumn: ScoreColumn,
): HeatmapResponse {
  const buckets = new Map<string, { xLabel: string; yLabel: string; scores: number[]; chainIds: string[] }>();

  for (const chain of chains) {
    const xLabel = chain.model_class || "(empty)";
    const yLabel = chain.preprocessings || "(empty)";
    const key = `${xLabel}|${yLabel}`;
    const bucket = buckets.get(key) ?? { xLabel, yLabel, scores: [], chainIds: [] };
    const score = getFiniteScore(chain, scoreColumn);
    if (score != null) {
      bucket.scores.push(score);
    }
    bucket.chainIds.push(chain.chain_id);
    buckets.set(key, bucket);
  }

  const cells = [...buckets.values()].map(bucket => ({
    x_label: bucket.xLabel,
    y_label: bucket.yLabel,
    value: median(bucket.scores),
    count: bucket.chainIds.length,
    chain_ids: bucket.chainIds,
  }));

  const values = cells
    .map(cell => cell.value)
    .filter((value): value is number => value != null);

  return {
    cells,
    x_labels: [...new Set(cells.map(cell => cell.x_label))].sort((left, right) => left.localeCompare(right)),
    y_labels: [...new Set(cells.map(cell => cell.y_label))].sort((left, right) => left.localeCompare(right)),
    x_variable: "model_class",
    y_variable: "preprocessings",
    score_column: scoreColumn,
    min_value: values.length ? Math.min(...values) : null,
    max_value: values.length ? Math.max(...values) : null,
  };
}

export function buildCandlestickData(
  chains: InspectorChainSummary[],
  scoreColumn: ScoreColumn,
  categoryVariable: keyof InspectorChainSummary = "model_class",
): CandlestickResponse {
  const metric = chains.find(chain => chain.metric)?.metric ?? null;
  const groups = new Map<string, { scores: number[]; chainIds: string[] }>();

  for (const chain of chains) {
    const label = String(chain[categoryVariable] || "(empty)");
    const score = getFiniteScore(chain, scoreColumn);
    const group = groups.get(label) ?? { scores: [], chainIds: [] };
    if (score != null) {
      group.scores.push(score);
    }
    group.chainIds.push(chain.chain_id);
    groups.set(label, group);
  }

  const categories = [...groups.entries()]
    .map(([label, group]) => {
      if (group.scores.length === 0) return null;
      const sorted = [...group.scores].sort((a, b) => a - b);
      const q25 = percentile(sorted, 0.25);
      const q75 = percentile(sorted, 0.75);
      const iqr = q75 - q25;
      const lowerFence = q25 - 1.5 * iqr;
      const upperFence = q75 + 1.5 * iqr;
      return {
        label,
        min: sorted[0],
        q25,
        median: percentile(sorted, 0.5),
        q75,
        max: sorted[sorted.length - 1],
        mean: average(sorted) ?? 0,
        count: sorted.length,
        outlier_values: sorted.filter(value => value < lowerFence || value > upperFence),
        chain_ids: group.chainIds,
      };
    })
    .filter((category): category is NonNullable<typeof category> => category != null)
    .sort((left, right) => {
      if (left.median === right.median) return right.count - left.count;
      return isLowerBetter(metric) ? left.median - right.median : right.median - left.median;
    });

  return {
    categories,
    category_variable: String(categoryVariable),
    score_column: scoreColumn,
  };
}

export function buildPreprocessingImpactData(
  chains: InspectorChainSummary[],
  scoreColumn: ScoreColumn,
): PreprocessingImpactResponse {
  const metric = chains.find(chain => chain.metric)?.metric ?? null;
  const lowerBetter = isLowerBetter(metric);
  const stepMembership = new Map<string, number[]>();

  chains.forEach((chain, index) => {
    splitPreprocessingSteps(chain.preprocessings).forEach(step => {
      const members = stepMembership.get(step) ?? [];
      members.push(index);
      stepMembership.set(step, members);
    });
  });

  const allIndices = new Set(chains.map((_, index) => index));

  const entries = [...stepMembership.entries()]
    .map(([stepName, indicesWith]) => {
      const withSet = new Set(indicesWith);
      const withoutIndices = [...allIndices].filter(index => !withSet.has(index));

      const scoresWith = indicesWith
        .map(index => getFiniteScore(chains[index], scoreColumn))
        .filter((value): value is number => value != null);
      const scoresWithout = withoutIndices
        .map(index => getFiniteScore(chains[index], scoreColumn))
        .filter((value): value is number => value != null);

      if (scoresWith.length === 0 || scoresWithout.length === 0) {
        return null;
      }

      const meanWith = average(scoresWith) ?? 0;
      const meanWithout = average(scoresWithout) ?? 0;
      const rawImpact = meanWith - meanWithout;

      return {
        step_name: stepName,
        impact: lowerBetter ? -rawImpact : rawImpact,
        mean_with: meanWith,
        mean_without: meanWithout,
        count_with: scoresWith.length,
        count_without: scoresWithout.length,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null)
    .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact));

  return {
    entries,
    score_column: scoreColumn,
    total_chains: chains.length,
  };
}

export function buildHyperparameterData(
  chains: InspectorChainSummary[],
  paramName: string,
  scoreColumn: ScoreColumn,
): HyperparameterResponse {
  const points = chains
    .map(chain => {
      const score = getFiniteScore(chain, scoreColumn);
      if (score == null) return null;
      const params = flattenNumericParams(
        (chain.variant_params ?? chain.best_params) as Record<string, unknown> | null | undefined,
      );
      const paramValue = params[paramName];
      if (paramValue == null) return null;

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
    available_params: getAvailableHyperparameters(chains),
  };
}

export function buildOverviewData(
  chains: InspectorChainSummary[],
  scoreColumn: ScoreColumn,
): InspectorOverviewData {
  const metric = chains.find(chain => chain.metric)?.metric ?? null;
  const lowerIsBetter = isLowerBetter(metric);
  const sortedChains = sortChainsByScore(chains, scoreColumn, metric);
  const scoreValues = sortedChains
    .map(chain => getFiniteScore(chain, scoreColumn))
    .filter((value): value is number => value != null);
  const modelSummaries = buildGroupSummaries(chains, scoreColumn, metric, chain => chain.model_class || "(empty)");
  const datasetSummaries = buildGroupSummaries(chains, scoreColumn, metric, chain => chain.dataset_name || "(empty)");
  const preprocessingImpact = buildPreprocessingImpactData(chains, scoreColumn);
  const bestChain = sortedChains[0] ?? null;
  const bestScore = bestChain ? getFiniteScore(bestChain, scoreColumn) : null;
  const scoreRange = scoreValues.length ? [Math.min(...scoreValues), Math.max(...scoreValues)] as [number, number] : null;
  const taskKinds = [...new Set(chains.map(chain => normalizeTaskType(chain.task_type)))];
  const metrics = [...new Set(chains.map(chain => chain.metric).filter((value): value is string => !!value))];
  const preprocessingStepCount = new Set(chains.flatMap(chain => splitPreprocessingSteps(chain.preprocessings))).size;

  const insights: InspectorInsight[] = [];

  const topModel = modelSummaries[0];
  if (topModel?.median != null) {
    insights.push({
      title: "Strongest family",
      body: `${topModel.label} has the best typical score across ${topModel.count} chains.`,
      tone: "positive",
    });
  }

  const topPreprocessing = preprocessingImpact.entries.find(entry => entry.impact > 0);
  if (topPreprocessing) {
    insights.push({
      title: "Best preprocessing lift",
      body: `${topPreprocessing.step_name} is associated with a positive ${metric ?? scoreColumn} lift of ${topPreprocessing.impact.toFixed(4)}.`,
      tone: "positive",
    });
  }

  const biggestGap = chains
    .map(chain => {
      if (chain.cv_train_score == null || chain.cv_val_score == null) return null;
      return {
        chain,
        gap: Math.abs(chain.cv_train_score - chain.cv_val_score),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null)
    .sort((left, right) => right.gap - left.gap)[0];

  if (biggestGap && biggestGap.gap > 0) {
    insights.push({
      title: "Largest train/val gap",
      body: `${biggestGap.chain.model_name ?? biggestGap.chain.model_class} shows a ${biggestGap.gap.toFixed(4)} train-validation gap.`,
      tone: "warning",
    });
  }

  if (taskKinds.length > 1 || metrics.length > 1) {
    insights.push({
      title: "Mixed comparison scope",
      body: "This view mixes multiple task types or metrics. Filter to one task and one metric for cleaner comparisons.",
      tone: "warning",
    });
  }

  return {
    metric,
    lowerIsBetter,
    scoreableCount: scoreValues.length,
    datasetCount: new Set(chains.map(chain => chain.dataset_name).filter(Boolean)).size,
    runCount: new Set(chains.map(chain => chain.run_id).filter(Boolean)).size,
    modelCount: new Set(chains.map(chain => chain.model_class).filter(Boolean)).size,
    preprocessingStepCount,
    bestChain,
    bestScore,
    scoreRange,
    taskKinds,
    metrics,
    modelSummaries,
    datasetSummaries,
    insights,
  };
}

export function selectTopChains(
  chains: InspectorChainSummary[],
  scoreColumn: ScoreColumn,
  limit: number,
): InspectorChainSummary[] {
  const metric = chains.find(chain => chain.metric)?.metric ?? null;
  return sortChainsByScore(chains, scoreColumn, metric)
    .filter(chain => getFiniteScore(chain, scoreColumn) != null)
    .slice(0, limit);
}

export function formatScopeLabel(taskKinds: NormalizedTaskType[]): string {
  if (taskKinds.length === 1) return taskKinds[0];
  if (taskKinds.length === 0) return "unknown";
  return "mixed";
}
