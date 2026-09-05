import { isLowerBetter } from '@/lib/scores';
import type { PartitionPrediction, ChainPartitionDetailResponse } from '@/types/aggregated-predictions';
import type { AllChainEntry, EnrichedDatasetRun, TopChainResult } from '@/types/enriched-runs';
import type { ScoreCardRow, ScoreCardType } from '@/types/score-cards';

export interface DatasetResultDetailMetaHint {
  modelName?: string | null;
  modelClass?: string | null;
  datasetName?: string | null;
  metric?: string | null;
  taskType?: string | null;
  preprocessings?: string | null;
}

export interface DatasetResultDetailFocus {
  cardType?: ScoreCardType | null;
  foldId?: string | null;
}

export interface DatasetResultViewerPartitionTarget {
  predictionId: string;
  partition: string;
  label?: string;
  source: 'aggregated';
}

export interface DatasetResultViewerHeader {
  datasetName: string;
  modelName: string | null;
  preprocessings?: string | null;
  foldId?: string | null;
  taskType?: string | null;
  valScore?: number | null;
  testScore?: number | null;
  trainScore?: number | null;
  nSamples?: number | null;
  nFeatures?: number | null;
}

export interface DatasetResultHeaderSummary {
  bestRow: ScoreCardRow | undefined;
  bestContext: Extract<ScoreCardType, 'refit' | 'crossval'>;
  bestSummaryLabel: string;
  delta: number | null;
  deltaDirection: 'up' | 'down';
  topChain: TopChainResult | null;
  refitCount: number;
}

export function normalizeAllChainEntry(chain: AllChainEntry, runId?: string): TopChainResult {
  const displayParams = chain.variant_params ?? chain.best_params ?? null;
  return {
    chain_id: chain.chain_id,
    run_id: chain.run_id ?? runId,
    pipeline_id: chain.pipeline_id,
    pipeline_name: chain.pipeline_name,
    model_name: chain.model_name,
    model_class: chain.model_class,
    preprocessings: chain.preprocessings || '',
    avg_val_score: chain.cv_val_score,
    avg_test_score: chain.cv_test_score,
    avg_train_score: chain.cv_train_score,
    fold_count: chain.cv_fold_count,
    scores: {
      val: chain.cv_scores?.val ?? {},
      test: chain.cv_scores?.test ?? {},
    },
    cv_source_chain_id: chain.cv_source_chain_id ?? null,
    final_test_score: chain.final_test_score,
    final_train_score: chain.final_train_score,
    final_scores: (chain.final_scores as Record<string, unknown>) ?? {},
    final_agg_test_score: chain.final_agg_test_score ?? null,
    final_agg_train_score: chain.final_agg_train_score ?? null,
    final_agg_scores: (chain.final_agg_scores as Record<string, unknown>) ?? {},
    best_params: displayParams,
    variant_params: chain.variant_params ?? null,
    is_refit_only: chain.is_refit_only ?? (chain.final_test_score != null && chain.cv_fold_count <= 0 && chain.cv_val_score == null),
    synthetic_refit: chain.synthetic_refit ?? false,
  };
}

export function shouldUseFullDatasetChains({
  allChains,
  workspaceId,
}: {
  allChains?: TopChainResult[];
  workspaceId?: string;
}): boolean {
  return !allChains && Boolean(workspaceId);
}

export function resolveDatasetResultChains({
  allChains,
  allChainEntries,
  fallbackChains,
  runId,
}: {
  allChains?: TopChainResult[];
  allChainEntries?: AllChainEntry[] | null;
  fallbackChains: TopChainResult[];
  runId?: string;
}): TopChainResult[] {
  if (allChains) return allChains;
  if (allChainEntries) return allChainEntries.map((chain) => normalizeAllChainEntry(chain, runId));
  return fallbackChains;
}

export function hasBestParams(params: Record<string, unknown> | null | undefined): boolean {
  return Boolean(params && Object.keys(params).length > 0);
}

export function resolveDetailChain(chain: TopChainResult, focusRow?: ScoreCardRow): TopChainResult {
  const focusBestParams = focusRow?.bestParams;
  return hasBestParams(chain.best_params) || !hasBestParams(focusBestParams)
    ? chain
    : { ...chain, best_params: focusBestParams };
}

export function buildDatasetResultDetailMetaHint(
  chain: TopChainResult,
  dataset: Pick<EnrichedDatasetRun, 'dataset_name' | 'metric' | 'task_type'>,
): DatasetResultDetailMetaHint {
  return {
    modelName: chain.model_name,
    modelClass: chain.model_class,
    datasetName: dataset.dataset_name,
    metric: dataset.metric,
    taskType: dataset.task_type,
    preprocessings: chain.preprocessings,
  };
}

export function buildDatasetResultDetailFocus(
  chain: TopChainResult,
  focusRow?: ScoreCardRow,
): DatasetResultDetailFocus {
  const isRefit = chain.final_test_score != null;
  return {
    cardType: focusRow?.cardType ?? (isRefit ? 'refit' : 'crossval'),
    foldId: focusRow?.foldId ?? (isRefit ? 'final' : 'avg'),
  };
}

export function buildPredictionViewerPartitions(
  quickViewPrediction: PartitionPrediction | null,
  chainDetail?: Pick<ChainPartitionDetailResponse, 'predictions'> | null,
): DatasetResultViewerPartitionTarget[] {
  if (!quickViewPrediction) return [];
  const siblings = chainDetail?.predictions?.filter(
    (prediction) => prediction.fold_id === quickViewPrediction.fold_id,
  );
  const source = siblings && siblings.length > 0 ? siblings : [quickViewPrediction];
  return source.map((prediction) => ({
    predictionId: prediction.prediction_id,
    partition: (prediction.partition ?? '').toLowerCase(),
    label: prediction.partition ?? '',
    source: 'aggregated' as const,
  }));
}

export function buildPredictionViewerHeader({
  quickViewPrediction,
  datasetName,
  taskType,
}: {
  quickViewPrediction: PartitionPrediction | null;
  datasetName: string;
  taskType: string | null;
}): DatasetResultViewerHeader {
  if (!quickViewPrediction) {
    return {
      datasetName,
      modelName: null,
      taskType,
    };
  }
  return {
    datasetName: quickViewPrediction.dataset_name,
    modelName: quickViewPrediction.model_name,
    preprocessings: quickViewPrediction.preprocessings,
    foldId: quickViewPrediction.fold_id,
    taskType: quickViewPrediction.task_type,
    valScore: quickViewPrediction.val_score,
    testScore: quickViewPrediction.test_score,
    trainScore: quickViewPrediction.train_score,
    nSamples: quickViewPrediction.n_samples,
    nFeatures: quickViewPrediction.n_features,
  };
}

export function buildDatasetResultHeaderSummary({
  scoreRows,
  chains,
  metric,
}: {
  scoreRows: ScoreCardRow[];
  chains: TopChainResult[];
  metric: string | null;
}): DatasetResultHeaderSummary {
  const bestRow = scoreRows[0];
  const bestContext = bestRow?.cardType === 'refit' ? 'refit' : 'crossval';
  const topRefitRow = scoreRows.find((row) => row.cardType === 'refit' && !row.syntheticRefit);
  const pairedCvRow = topRefitRow?.children?.find((child) => child.cardType === 'crossval');
  const lowerBetter = isLowerBetter(metric);
  const delta = topRefitRow?.primaryTestScore != null && pairedCvRow?.primaryValScore != null
    ? (lowerBetter
      ? pairedCvRow.primaryValScore - topRefitRow.primaryTestScore
      : topRefitRow.primaryTestScore - pairedCvRow.primaryValScore)
    : null;

  return {
    bestRow,
    bestContext,
    bestSummaryLabel: bestRow?.syntheticRefit ? 'CV estimate' : (bestContext === 'refit' ? 'Best Refit' : 'Best CV'),
    delta,
    deltaDirection: lowerBetter ? 'down' : 'up',
    topChain: bestRow ? chains.find((chain) => chain.chain_id === bestRow.chainId) ?? null : null,
    refitCount: scoreRows.filter((row) => row.cardType === 'refit' && !row.syntheticRefit).length,
  };
}
