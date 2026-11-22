import { buildFoldTree } from '@/lib/fold-utils';
import { scoredPartitionRows } from '@/lib/partitionColors';
import {
  buildFoldTrainCards,
  enrichCrossvalRow,
  partitionPredToTrainCard,
} from '@/lib/score-adapters';
import { canonicalMetricKey, getScoreMapValue, isLowerBetter } from '@/lib/scores';
import { filterScoreRowMetricsForTaskType, getScoreCardPrimaryMetric } from '@/lib/scoreRowData';
import type { PartitionPrediction } from '@/types/aggregated-predictions';
import type { ScoreCardRow } from '@/types/score-cards';

export type ScoreCardFoldVariant = 'raw' | 'aggregated';

export interface ScoreCardTreeSections {
  refitRows: ScoreCardRow[];
  cvRows: ScoreCardRow[];
  trainRows: ScoreCardRow[];
}

export interface ModelTreeDisplayData {
  rootRow: ScoreCardRow;
  childRows: ScoreCardRow[];
}

type ScoreCardTrainParent = Pick<
  ScoreCardRow,
  'runId' | 'pipelineId' | 'datasetName' | 'modelName' | 'modelClass' | 'preprocessings' | 'bestParams' | 'metric' | 'taskType'
>;

export function partitionScoreCardRows(rows: ScoreCardRow[]): ScoreCardTreeSections {
  return rows.reduce<ScoreCardTreeSections>((sections, row) => {
    if (row.cardType === 'refit') {
      sections.refitRows.push(row);
    } else if (row.cardType === 'crossval') {
      sections.cvRows.push(row);
    } else if (row.cardType === 'train') {
      sections.trainRows.push(row);
    }
    return sections;
  }, { refitRows: [], cvRows: [], trainRows: [] });
}

/**
 * Metric used to rank score rows: the first selected metric that rows actually
 * carry, else the rows' primary metric.
 */
export function resolveScoreCardRankMetric(rows: ScoreCardRow[], selectedMetrics: readonly string[]): string {
  const primary = rows[0] ? getScoreCardPrimaryMetric(rows[0]) : '';
  const candidates = filterScoreRowMetricsForTaskType(selectedMetrics, rows[0]?.taskType);
  return candidates.find((metric) => rows.some((row) => scoreCardRankScore(row, metric) != null)) ?? primary;
}

/**
 * Ranking score of a row for one metric. Refit and CV rows rank on the
 * cross-validation (validation/OOF) score, never on the retained test score.
 * Training-only rows have no CV score and rank on their training score.
 */
export function scoreCardRankScore(row: ScoreCardRow, metric: string): number | null {
  const key = canonicalMetricKey(metric);
  const isPrimary = key === getScoreCardPrimaryMetric(row);
  if (row.cardType === 'refit') {
    return getScoreMapValue(row.avgValScores, key) ?? (isPrimary ? row.primaryValScore ?? null : null);
  }
  if (row.cardType === 'crossval') {
    return getScoreMapValue(row.valScores, key)
      ?? getScoreMapValue(row.avgValScores, key)
      ?? (isPrimary ? row.primaryValScore ?? null : null);
  }
  return getScoreMapValue(row.trainScores, key) ?? (isPrimary ? row.primaryTrainScore ?? null : null);
}

function compareNullable(a: number | null, b: number | null, lowerBetter: boolean): number {
  if (a == null || !Number.isFinite(a)) return b == null || !Number.isFinite(b) ? 0 : 1;
  if (b == null || !Number.isFinite(b)) return -1;
  return lowerBetter ? a - b : b - a;
}

/**
 * Sorts rows best-first on {@link scoreCardRankScore}; ties keep their incoming order.
 * An aggregated refit row without its own CV score ranks with its chain's CV score.
 */
export function sortScoreCardRowsByRank(rows: ScoreCardRow[], metric: string): ScoreCardRow[] {
  const lowerBetter = isLowerBetter(metric);
  const chainScores = new Map<string, number>();
  for (const row of rows) {
    const score = scoreCardRankScore(row, metric);
    if (row.cardType === 'refit' && score != null && !chainScores.has(row.chainId)) chainScores.set(row.chainId, score);
  }
  const rank = (row: ScoreCardRow) => scoreCardRankScore(row, metric)
    ?? (row.cardType === 'refit' ? chainScores.get(row.chainId) ?? null : null);
  return [...rows].sort((a, b) => compareNullable(rank(a), rank(b), lowerBetter));
}

export function getScoreCardCrossvalChildren(row: ScoreCardRow): ScoreCardRow[] {
  return row.children?.filter((child) => child.cardType === 'crossval') ?? [];
}

export function getScoreCardFoldVariant(row: Pick<ScoreCardRow, 'foldId'>): ScoreCardFoldVariant {
  return row.foldId?.endsWith('_agg') ? 'aggregated' : 'raw';
}

export function getScoreCardTrainParent(row: ScoreCardTrainParent): ScoreCardTrainParent {
  return {
    runId: row.runId,
    pipelineId: row.pipelineId,
    datasetName: row.datasetName,
    modelName: row.modelName,
    modelClass: row.modelClass,
    preprocessings: row.preprocessings,
    bestParams: row.bestParams,
    metric: row.metric,
    taskType: row.taskType,
  };
}

export function buildScoreCardTrainChildren(
  row: ScoreCardRow,
  predictions: PartitionPrediction[] | null | undefined,
): ScoreCardRow[] {
  if (!predictions) return [];
  return buildFoldTrainCards(
    predictions,
    getScoreCardTrainParent(row),
    getScoreCardFoldVariant(row),
  );
}

export function buildScoreCardDisplayRow(
  row: ScoreCardRow,
  predictions: PartitionPrediction[] | null | undefined,
): ScoreCardRow {
  if (row.cardType !== 'crossval' || !predictions) return row;
  return enrichCrossvalRow(row, predictions);
}

export function findScoreCardPrediction(
  predictions: PartitionPrediction[] | null | undefined,
  predictionId: string,
): PartitionPrediction | undefined {
  return predictions?.find((prediction) => prediction.prediction_id === predictionId);
}

export function selectPreferredScoreCardPrediction(
  predictions: PartitionPrediction[] | null | undefined,
): PartitionPrediction | undefined {
  if (!predictions || predictions.length === 0) return undefined;
  // Prediction-only rows (missing targets) share the refit fold but carry no scores.
  const scored = scoredPartitionRows(predictions);
  return scored.find((prediction) => prediction.fold_id === 'final')
    ?? scored.find((prediction) => prediction.fold_id === 'macro')
    ?? scored.find((prediction) => prediction.fold_id === 'avg')
    ?? scored.find((prediction) => prediction.fold_id === 'w_avg')
    ?? scored.find((prediction) => prediction.partition === 'test')
    ?? scored[0]
    ?? predictions[0];
}

export function buildModelTreeDisplayData(
  predictions: PartitionPrediction[] | null | undefined,
  foldArtifacts?: Record<string, string> | null,
): ModelTreeDisplayData | null {
  if (!predictions || predictions.length === 0) return null;
  const tree = buildFoldTree(predictions);
  if (!tree) return null;
  return {
    rootRow: {
      ...partitionPredToTrainCard(tree.prediction),
      foldArtifacts,
    },
    childRows: tree.children.map((child) => partitionPredToTrainCard(child.prediction)),
  };
}

export function getModelTreePredictionSiblings(
  predictions: PartitionPrediction[] | null | undefined,
  predictionId: string,
): PartitionPrediction[] | null {
  const prediction = findScoreCardPrediction(predictions, predictionId);
  if (!prediction) return null;
  return prediction.fold_id
    ? (predictions ?? []).filter((candidate) => candidate.fold_id === prediction.fold_id)
    : [prediction];
}
