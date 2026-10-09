import { describe, expect, it } from 'vitest';

import {
  buildScoreHistogramStatsSegments,
  buildScoreHistogramTooltipData,
  formatScoreHistogramMeanReference,
  formatScoreHistogramValue,
  getScoreHistogramEmptyMessage,
} from '@/lib/inspector/scoreHistogramPresentation';
import type { HistogramResponse } from '@/types/inspector';
import { tStub } from './helpers/i18nStub';

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

    expect(getScoreHistogramEmptyMessage(tStub)).toBe('inspector.charts.empty.histogram');
    expect(formatScoreHistogramValue(0.123456)).toBe('0.1235');
    expect(buildScoreHistogramStatsSegments(response, tStub)).toEqual([
      'inspector.charts.histogram.statMin {"value":"0.0000"}',
      'inspector.charts.histogram.statMean {"value":"0.1235"}',
      'inspector.charts.histogram.statMax {"value":"0.3000"}',
    ]);
    expect(buildScoreHistogramStatsSegments(null, tStub)).toEqual([]);
    expect(formatScoreHistogramMeanReference(0.123456)).toBe('0.123');
    expect(formatScoreHistogramMeanReference(null)).toBeNull();
    expect(buildScoreHistogramTooltipData(bar, 4, tStub)).toEqual({
      rangeLabel: '[0.0000, 0.1000)',
      countLabel: '2',
      percentageLabel: 'inspector.charts.tooltip.percentOfTotal {"value":"50.0"}',
    });
    expect(buildScoreHistogramTooltipData(bar, 0, tStub).percentageLabel).toBe('inspector.charts.tooltip.percentOfTotal {"value":"200.0"}');
  });
});
