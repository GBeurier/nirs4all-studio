import { buildFoldTree } from '@/lib/fold-utils';
import {
  buildFoldTrainCards,
  enrichCrossvalRow,
  partitionPredToTrainCard,
} from '@/lib/score-adapters';
import type { PartitionPrediction } from '@/types/aggregated-predictions';
import type { ScoreCardRow } from '@/types/score-cards';

export type ScoreCardFoldVariant = 'raw' | 'aggregated';

export interface ScoreCardTreeSections {
  refitRows: ScoreCardRow[];
  cvRows: ScoreCardRow[];
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
    }
    return sections;
  }, { refitRows: [], cvRows: [] });
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
  return predictions.find((prediction) => prediction.fold_id === 'final')
    ?? predictions.find((prediction) => prediction.fold_id === 'avg')
    ?? predictions.find((prediction) => prediction.fold_id === 'w_avg')
    ?? predictions.find((prediction) => prediction.partition === 'test')
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
