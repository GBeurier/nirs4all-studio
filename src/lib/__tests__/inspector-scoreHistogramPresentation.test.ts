import { describe, expect, it } from 'vitest';

import {
  buildScoreHistogramStatsSegments,
  buildScoreHistogramTooltipData,
  formatScoreHistogramMeanReference,
  formatScoreHistogramValue,
  getScoreHistogramEmptyMessage,
} from '@/lib/inspector/scoreHistogramPresentation';
import type { HistogramResponse } from '@/types/inspector';

const response: HistogramResponse = {
  bins: [],
  score_column: 'cv_val_score',
  total_chains: 4,
  min_score: 0,
  max_score: 0.3,
  mean_score: 0.123456,
};

describe('inspector score histogram presentation helpers', () => {
  it('formats empty copy, stats, mean reference, and tooltip labels', () => {
    const bar = {
      label: '0.000',
      count: 2,
      binStart: 0,
      binEnd: 0.1,
      chainIds: ['chain-a', 'chain-c'],
      hasSelected: true,
    };

    expect(getScoreHistogramEmptyMessage()).toBe('No score data available.');
    expect(formatScoreHistogramValue(0.123456)).toBe('0.1235');
    expect(buildScoreHistogramStatsSegments(response)).toEqual([
      'min: 0.0000',
      'mean: 0.1235',
      'max: 0.3000',
    ]);
    expect(buildScoreHistogramStatsSegments(null)).toEqual([]);
    expect(formatScoreHistogramMeanReference(0.123456)).toBe('0.123');
    expect(formatScoreHistogramMeanReference(null)).toBeNull();
    expect(buildScoreHistogramTooltipData(bar, 4)).toEqual({
      rangeLabel: '[0.0000, 0.1000)',
      countLabel: '2',
      percentageLabel: '50.0% of total',
    });
    expect(buildScoreHistogramTooltipData(bar, 0).percentageLabel).toBe('200.0% of total');
  });
});
