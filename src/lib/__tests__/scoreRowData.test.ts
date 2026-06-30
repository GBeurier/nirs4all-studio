import { describe, expect, it } from 'vitest';

import {
  buildCrossvalScorePairs,
  buildRefitScorePairs,
  buildTrainScorePairs,
  filterScoreRowMetricsForTaskType,
  getScoreCardAnyScore,
  getScoreCardPrimaryMetric,
  getScoreCardRelevantMetricKeys,
} from '@/lib/scoreRowData';
import type { ScoreCardRow } from '@/types/score-cards';

function row(overrides: Partial<ScoreCardRow>): ScoreCardRow {
  return {
    id: 'row-1',
    chainId: 'chain-1',
    modelName: 'PLS',
    modelClass: 'PLSRegression',
    preprocessings: null,
    bestParams: null,
    cardType: 'refit',
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

describe('score row data helpers', () => {
  it('filters known metrics by task type without dropping custom runtime metrics', () => {
    expect(filterScoreRowMetricsForTaskType(['rmse', 'accuracy', 'benchmark-latency-ms'], 'classification')).toEqual([
      'accuracy',
      'benchmark_latency_ms',
    ]);
  });

  it('builds refit score pairs with primary, train, and selected secondary metrics', () => {
    expect(buildRefitScorePairs(row({
      cardType: 'refit',
      testScores: { rmse: 0.2, r2: 0.91 },
      trainScores: { rmse: 0.15 },
    }), ['rmse', 'r2'])).toEqual([
      { label: 'RMSEP', value: 0.2, metric: 'rmse', colorClass: 'text-emerald-500 font-semibold' },
      { label: 'Train', value: 0.15, metric: 'rmse', colorClass: 'text-orange-400' },
      { label: 'R²', value: 0.91, metric: 'r2' },
    ]);
  });

  it('keeps custom runtime score metrics with shared display labels', () => {
    const customRow = row({
      cardType: 'refit',
      testScores: {
        rmse: 0.2,
        r2: 0.91,
        'benchmark-latency-ms': 12.5,
        repository_custom_score: 0.77,
      },
      trainScores: { rmse: 0.15 },
    });

    expect(getScoreCardRelevantMetricKeys(customRow, ['rmse', 'r2', 'benchmark-latency-ms', 'repository custom score'])).toEqual([
      'r2',
      'rmse',
      'benchmark_latency_ms',
      'repository_custom_score',
    ]);
    expect(buildRefitScorePairs(customRow, ['rmse', 'r2', 'benchmark-latency-ms', 'repository custom score'])).toEqual([
      { label: 'RMSEP', value: 0.2, metric: 'rmse', colorClass: 'text-emerald-500 font-semibold' },
      { label: 'Train', value: 0.15, metric: 'rmse', colorClass: 'text-orange-400' },
      { label: 'R²', value: 0.91, metric: 'r2' },
      { label: 'Benchmark Latency MS', value: 12.5, metric: 'benchmark_latency_ms' },
      { label: 'Repository Custom Score', value: 0.77, metric: 'repository_custom_score' },
    ]);
  });

  it('uses shared display labels for custom primary metrics without changing row context labels', () => {
    expect(buildTrainScorePairs(row({
      cardType: 'train',
      metric: 'repository custom score',
      testScores: { repository_custom_score: 0.7 },
      valScores: { repository_custom_score: 0.6 },
    }), ['repository custom score'])).toEqual([
      { label: 'Repository Custom Score', value: 0.7, metric: 'repository_custom_score', colorClass: 'font-semibold' },
      { label: 'Val', value: 0.6, metric: 'repository_custom_score', colorClass: 'text-blue-400' },
    ]);
  });

  it('builds regression crossval score pairs from aggregate maps', () => {
    const pairs = buildCrossvalScorePairs(row({
      cardType: 'crossval',
      avgValScores: { rmse: 0.22, r2: 0.82 },
      meanValScores: { rmse: 0.23 },
      minValScores: { rmse: 0.18 },
      maxValScores: { rmse: 0.29 },
      avgTestScores: { rmse: 0.25, benchmark_latency_ms: 11.5 },
      wAvgTestScores: { rmse: 0.24 },
      meanTestScores: { rmse: 0.26 },
      minTestScores: { rmse: 0.2 },
      maxTestScores: { rmse: 0.31 },
    }), ['rmse', 'r2', 'benchmark-latency-ms']);

    expect(pairs.map(({ label, value, metric }) => ({ label, value, metric }))).toEqual([
      { label: 'RMSECV', value: 0.22, metric: 'rmse' },
      { label: 'Mean Val', value: 0.23, metric: 'rmse' },
      { label: 'Min Val', value: 0.18, metric: 'rmse' },
      { label: 'Max Val', value: 0.29, metric: 'rmse' },
      { label: 'RMSEP Avg', value: 0.25, metric: 'rmse' },
      { label: 'RMSEP W-Avg', value: 0.24, metric: 'rmse' },
      { label: 'Mean RMSEP', value: 0.26, metric: 'rmse' },
      { label: 'Min Test', value: 0.2, metric: 'rmse' },
      { label: 'Max Test', value: 0.31, metric: 'rmse' },
      { label: 'R²', value: 0.82, metric: 'r2' },
      { label: 'Benchmark Latency MS', value: 11.5, metric: 'benchmark_latency_ms' },
    ]);
  });

  it('builds classification crossval pairs with selected secondary metrics', () => {
    const pairs = buildCrossvalScorePairs(row({
      cardType: 'crossval',
      metric: 'accuracy',
      taskType: 'classification',
      avgValScores: { accuracy: 0.9, f1: 0.88 },
      meanValScores: { accuracy: 0.89 },
      minValScores: { accuracy: 0.8 },
      maxValScores: { accuracy: 0.95 },
      avgTestScores: { accuracy: 0.87, f1: 0.84 },
    }), ['accuracy', 'f1']);

    expect(pairs.map(({ label, value, metric }) => ({ label, value, metric }))).toEqual([
      { label: 'Acc CV', value: 0.9, metric: 'accuracy' },
      { label: 'Mean Val', value: 0.89, metric: 'accuracy' },
      { label: 'Min Val', value: 0.8, metric: 'accuracy' },
      { label: 'Max Val', value: 0.95, metric: 'accuracy' },
      { label: 'Acc Test', value: 0.87, metric: 'accuracy' },
      { label: 'F1', value: 0.88, metric: 'f1' },
    ]);
  });

  it('builds train pairs and exposes score lookup helpers', () => {
    const trainRow = row({
      cardType: 'train',
      testScores: { rmse: 0.3, r2: 0.7 },
      valScores: { rmse: 0.28 },
      trainScores: { mae: 0.1 },
    });

    expect(buildTrainScorePairs(trainRow, ['rmse', 'r2', 'mae'])).toEqual([
      { label: 'RMSEP', value: 0.3, metric: 'rmse', colorClass: 'font-semibold' },
      { label: 'Val', value: 0.28, metric: 'rmse', colorClass: 'text-blue-400' },
      { label: 'R²', value: 0.7, metric: 'r2' },
      { label: 'MAE', value: 0.1, metric: 'mae' },
    ]);
    expect(getScoreCardAnyScore(trainRow, 'mae')).toBe(0.1);
    expect(getScoreCardPrimaryMetric(trainRow)).toBe('rmse');
    expect(getScoreCardRelevantMetricKeys(trainRow, ['r2'])).toEqual(['r2', 'rmse']);
  });
});
