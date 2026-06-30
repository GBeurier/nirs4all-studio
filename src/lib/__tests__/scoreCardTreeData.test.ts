import { describe, expect, it } from 'vitest';

import {
  buildModelTreeDisplayData,
  buildScoreCardDisplayRow,
  buildScoreCardTrainChildren,
  getModelTreePredictionSiblings,
  getScoreCardCrossvalChildren,
  getScoreCardFoldVariant,
  partitionScoreCardRows,
  selectPreferredScoreCardPrediction,
} from '@/lib/scoreCardTreeData';
import type { PartitionPrediction } from '@/types/aggregated-predictions';
import type { ScoreCardRow } from '@/types/score-cards';

function row(overrides: Partial<ScoreCardRow> = {}): ScoreCardRow {
  return {
    id: 'row-1',
    chainId: 'chain-1',
    modelName: 'PLS',
    modelClass: 'PLSRegression',
    preprocessings: 'SNV',
    bestParams: { n_components: 4 },
    cardType: 'crossval',
    foldId: 'avg',
    metric: 'rmse',
    taskType: 'regression',
    testScores: {},
    valScores: {},
    trainScores: {},
    primaryTestScore: null,
    primaryValScore: null,
    primaryTrainScore: null,
    hasRefitArtifact: false,
    ...overrides,
  };
}

function prediction(overrides: Partial<PartitionPrediction> = {}): PartitionPrediction {
  return {
    prediction_id: 'pred-test',
    pipeline_id: 'pipe-1',
    chain_id: 'chain-1',
    dataset_name: 'dataset-a',
    model_name: 'PLS',
    model_class: 'PLSRegression',
    fold_id: '0',
    partition: 'test',
    val_score: null,
    test_score: 0.25,
    train_score: null,
    scores: { rmse: 0.25 },
    best_params: null,
    metric: 'rmse',
    task_type: 'regression',
    n_samples: 10,
    n_features: 128,
    preprocessings: 'SNV',
    ...overrides,
  };
}

describe('score card tree data helpers', () => {
  it('partitions top-level rows into refit and crossval sections', () => {
    const refit = row({ id: 'refit', cardType: 'refit' });
    const crossval = row({ id: 'crossval', cardType: 'crossval' });
    const train = row({ id: 'train', cardType: 'train' });

    expect(partitionScoreCardRows([crossval, train, refit])).toEqual({
      refitRows: [refit],
      cvRows: [crossval],
    });
  });

  it('selects only crossval children from refit rows', () => {
    const crossvalChild = row({ id: 'child-cv', cardType: 'crossval' });
    const trainChild = row({ id: 'child-train', cardType: 'train' });

    expect(getScoreCardCrossvalChildren(row({
      cardType: 'refit',
      children: [crossvalChild, trainChild],
    }))).toEqual([crossvalChild]);
    expect(getScoreCardCrossvalChildren(row({ cardType: 'refit' }))).toEqual([]);
  });

  it('detects raw versus aggregated fold variants from the parent row', () => {
    expect(getScoreCardFoldVariant(row({ foldId: 'avg' }))).toBe('raw');
    expect(getScoreCardFoldVariant(row({ foldId: 'avg_agg' }))).toBe('aggregated');
  });

  it('builds train children for the matching fold variant', () => {
    const predictions = [
      prediction({ prediction_id: 'raw-test', fold_id: '0', partition: 'test', test_score: 0.25, scores: { rmse: 0.25 } }),
      prediction({ prediction_id: 'raw-train', fold_id: '0', partition: 'train', train_score: 0.15, scores: { rmse: 0.15 } }),
      prediction({ prediction_id: 'agg-test', fold_id: '0_agg', partition: 'test', test_score: 0.2, scores: { rmse: 0.2 } }),
    ];

    const rawChildren = buildScoreCardTrainChildren(row({ foldId: 'avg' }), predictions);
    expect(rawChildren).toHaveLength(1);
    expect(rawChildren[0]).toMatchObject({
      foldId: '0',
      modelName: 'PLS',
      primaryTestScore: 0.25,
      primaryTrainScore: 0.15,
      bestParams: { n_components: 4 },
    });

    const aggregatedChildren = buildScoreCardTrainChildren(row({ foldId: 'avg_agg' }), predictions);
    expect(aggregatedChildren).toHaveLength(1);
    expect(aggregatedChildren[0]).toMatchObject({
      foldId: '0_agg',
      primaryTestScore: 0.2,
    });
  });

  it('enriches crossval rows from loaded partition predictions', () => {
    const enriched = buildScoreCardDisplayRow(row(), [
      prediction({ prediction_id: 'avg-val', fold_id: 'avg', partition: 'val', val_score: 0.21, scores: { rmse: 0.21 } }),
      prediction({ prediction_id: 'avg-test', fold_id: 'avg', partition: 'test', test_score: 0.26, scores: { rmse: 0.26 } }),
      prediction({ prediction_id: 'avg-train', fold_id: 'avg', partition: 'train', train_score: 0.16, scores: { rmse: 0.16 } }),
      prediction({ prediction_id: 'fold-val', fold_id: '0', partition: 'val', val_score: 0.2, scores: { rmse: 0.2 } }),
    ]);

    expect(enriched).toMatchObject({
      primaryValScore: 0.21,
      primaryTestScore: 0.26,
      primaryTrainScore: 0.16,
      foldCount: 1,
    });
    expect(enriched.avgValScores).toEqual({ rmse: 0.21 });
    expect(enriched.avgTestScores).toEqual({ rmse: 0.26 });
  });

  it('selects the best prediction to open in the chart viewer', () => {
    const fallback = prediction({ prediction_id: 'fallback', fold_id: '0', partition: 'val' });
    const test = prediction({ prediction_id: 'test', fold_id: '1', partition: 'test' });
    const weightedAverage = prediction({ prediction_id: 'weighted', fold_id: 'w_avg', partition: 'test' });
    const average = prediction({ prediction_id: 'average', fold_id: 'avg', partition: 'test' });
    const final = prediction({ prediction_id: 'final', fold_id: 'final', partition: 'test' });

    expect(selectPreferredScoreCardPrediction([fallback, test])?.prediction_id).toBe('test');
    expect(selectPreferredScoreCardPrediction([fallback, test, weightedAverage])?.prediction_id).toBe('weighted');
    expect(selectPreferredScoreCardPrediction([fallback, weightedAverage, average])?.prediction_id).toBe('average');
    expect(selectPreferredScoreCardPrediction([fallback, average, final])?.prediction_id).toBe('final');
    expect(selectPreferredScoreCardPrediction([])).toBeUndefined();
  });

  it('builds model tree display rows from partition predictions', () => {
    const display = buildModelTreeDisplayData([
      prediction({ prediction_id: 'fold-0', fold_id: '0', partition: 'test' }),
      prediction({ prediction_id: 'average', fold_id: 'avg', partition: 'val' }),
      prediction({ prediction_id: 'final', fold_id: 'final', partition: 'test' }),
    ], { final: 'model.joblib' });

    expect(display?.rootRow).toMatchObject({
      id: 'final',
      cardType: 'train',
      foldId: 'final',
      foldArtifacts: { final: 'model.joblib' },
    });
    expect(display?.childRows.map((child) => child.foldId)).toEqual(['avg', '0']);
  });

  it('selects model tree prediction siblings from the same fold', () => {
    const predictions = [
      prediction({ prediction_id: 'fold-0-test', fold_id: '0', partition: 'test' }),
      prediction({ prediction_id: 'fold-0-val', fold_id: '0', partition: 'val' }),
      prediction({ prediction_id: 'fold-1-test', fold_id: '1', partition: 'test' }),
    ];

    expect(getModelTreePredictionSiblings(predictions, 'fold-0-test')?.map((item) => item.prediction_id)).toEqual([
      'fold-0-test',
      'fold-0-val',
    ]);
    expect(getModelTreePredictionSiblings(predictions, 'missing')).toBeNull();
  });
});
