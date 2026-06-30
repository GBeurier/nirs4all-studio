import { describe, expect, it } from 'vitest';

import {
  cardTypeBgClass,
  cardTypeBorderClass,
  cardTypeColorClass,
  extractDisplayScores,
  getScoreContextLabel,
} from '@/lib/scoreColumnData';
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

describe('score column data helpers', () => {
  it('extracts refit scores from test scores before primary fallback', () => {
    expect(extractDisplayScores(row({
      cardType: 'refit',
      testScores: { rmse: 0.2, r2: 0.9 },
      primaryTestScore: 0.3,
    }), ['rmse', 'r2'])).toEqual({
      rmse: 0.2,
      r2: 0.9,
    });

    expect(extractDisplayScores(row({
      cardType: 'refit',
      testScores: {},
      primaryTestScore: 0.3,
    }), ['rmse'])).toEqual({ rmse: 0.3 });
  });

  it('extracts crossval scores from val, average val, test, then primary fallbacks', () => {
    expect(extractDisplayScores(row({
      cardType: 'crossval',
      valScores: { r2: 0.8 },
      avgValScores: { rmse: 0.21 },
      testScores: { mae: 0.11 },
      avgTestScores: { sep: 0.25 },
      primaryValScore: 0.19,
      primaryTestScore: 0.22,
    }), ['r2', 'rmse', 'mae', 'sep'])).toEqual({
      r2: 0.8,
      rmse: 0.21,
      mae: 0.11,
      sep: 0.25,
    });
  });

  it('extracts train rows from test, val, train, then primary fallbacks', () => {
    expect(extractDisplayScores(row({
      cardType: 'train',
      testScores: { r2: 0.7 },
      valScores: { mae: 0.12 },
      trainScores: { rmse: 0.18 },
      primaryTrainScore: 0.2,
    }), ['r2', 'mae', 'rmse'])).toEqual({
      r2: 0.7,
      mae: 0.12,
      rmse: 0.18,
    });
  });

  it('formats score context labels and card classes', () => {
    expect(getScoreContextLabel('rmse', 'refit', 'rmse', 'regression')).toBe('RMSEP');
    expect(getScoreContextLabel('rmse', 'crossval', 'rmse', 'regression')).toBe('RMSECV');
    expect(getScoreContextLabel('accuracy', 'refit', 'accuracy', 'classification')).toBe('AccP');
    expect(getScoreContextLabel('accuracy', 'train', 'rmse', 'classification')).toBe('Acc');
    expect(getScoreContextLabel('r2', 'train', 'rmse', 'regression')).toBe('R²');
    expect(cardTypeColorClass('refit')).toBe('text-emerald-500');
    expect(cardTypeBorderClass('crossval')).toBe('border-chart-1/20');
    expect(cardTypeBgClass('train')).toBe('');
  });

  it('formats unknown runtime metric labels with the shared display policy', () => {
    expect(getScoreContextLabel('benchmark-latency-ms', 'train', 'rmse', 'regression')).toBe('Benchmark Latency MS');
    expect(getScoreContextLabel('repository custom score', 'refit', 'repository custom score', 'classification')).toBe('Repository Custom Score');
  });
});
