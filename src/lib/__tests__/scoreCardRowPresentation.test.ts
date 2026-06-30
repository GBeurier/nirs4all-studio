import { describe, expect, it } from 'vitest';

import {
  buildInlineScoreCardRowPresentation,
  buildTableScoreCardRowPresentation,
  getScoreCardRowDetailClass,
  getScoreCardRowShellClass,
  getScoreCardRowTypeFlags,
} from '@/lib/scoreCardRowPresentation';
import type { ScoreCardRow } from '@/types/score-cards';

function row(overrides: Partial<ScoreCardRow> = {}): ScoreCardRow {
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

describe('score card row presentation helpers', () => {
  it('derives card-type flags and layout classes', () => {
    expect(getScoreCardRowTypeFlags('crossval')).toEqual({
      isRefit: false,
      isCrossval: true,
      isTrain: false,
    });
    expect(getScoreCardRowShellClass('refit')).toBe('lg:grid lg:grid-cols-[25.5rem_minmax(0,1fr)_auto] lg:items-center lg:gap-2');
    expect(getScoreCardRowDetailClass('train')).toBe('lg:grid lg:grid-cols-[12rem_10rem] lg:items-center lg:gap-2');
  });

  it('builds inline row presentation data', () => {
    const presentation = buildInlineScoreCardRowPresentation(row({
      cardType: 'refit',
      bestParams: { n_components: 4 },
    }));

    expect(presentation.isRefit).toBe(true);
    expect(presentation.borderClass).toContain('emerald');
    expect(presentation.paramLabel).toContain('n_components');
    expect(presentation.paramLabel).toContain('4');
  });

  it('builds table row metric and fold projections', () => {
    const presentation = buildTableScoreCardRowPresentation(row({
      cardType: 'crossval',
      metric: 'RMSE',
      foldCount: 5,
    }), ['rmse', 'r2', 'mae'], 2);

    expect(presentation).toMatchObject({
      isCrossval: true,
      metric: 'rmse',
      foldDisplay: 5,
      tableMetricKeys: ['rmse', 'r2'],
    });
  });
});
