import { describe, expect, it } from 'vitest';

import {
  buildScoreHistogramBarColors,
  buildScoreHistogramBars,
  buildScoreHistogramCellStyle,
  buildScoreHistogramChainColorMap,
  getScoreHistogramDominantColor,
  getScoreHistogramSelectionDecision,
  SCORE_HISTOGRAM_FALLBACK_COLOR,
} from '@/lib/inspector/scoreHistogramData';
import type { HistogramBin, HistogramResponse, InspectorGroup } from '@/types/inspector';

function bin(overrides: Partial<HistogramBin> = {}): HistogramBin {
  return {
    bin_start: 0,
    bin_end: 0.1,
    count: 2,
    chain_ids: ['chain-a', 'chain-c'],
    ...overrides,
  };
}

function response(bins: HistogramBin[]): HistogramResponse {
  return {
    bins,
    score_column: 'cv_val_score',
    total_chains: 4,
    min_score: 0,
    max_score: 0.3,
    mean_score: 0.123456,
  };
}

function group(overrides: Partial<InspectorGroup> = {}): InspectorGroup {
  return {
    id: 'group-a',
    label: 'Group A',
    color: '#111111',
    chain_ids: ['chain-a', 'chain-b'],
    ...overrides,
  };
}

describe('inspector score histogram data helpers', () => {
  it('builds chart bars and selected flags', () => {
    const bars = buildScoreHistogramBars({
      data: response([
        bin(),
        bin({ bin_start: 0.1, bin_end: 0.2, count: 1, chain_ids: ['chain-d'] }),
        bin({ bin_start: 0.2, bin_end: 0.3, count: 0, chain_ids: [] }),
      ]),
      selectedChains: new Set(['chain-a', 'chain-c']),
      hasSelection: true,
    });

    expect(bars).toEqual([
      {
        label: '0.000',
        count: 2,
        binStart: 0,
        binEnd: 0.1,
        chainIds: ['chain-a', 'chain-c'],
        hasSelected: true,
      },
      {
        label: '0.100',
        count: 1,
        binStart: 0.1,
        binEnd: 0.2,
        chainIds: ['chain-d'],
        hasSelected: false,
      },
      {
        label: '0.200',
        count: 0,
        binStart: 0.2,
        binEnd: 0.3,
        chainIds: [],
        hasSelected: false,
      },
    ]);
    expect(buildScoreHistogramBars({
      data: null,
      selectedChains: new Set(),
      hasSelection: false,
    })).toEqual([]);
  });

  it('computes dominant colors and cell styles from group membership', () => {
    const colorMap = buildScoreHistogramChainColorMap([
      group(),
      group({ id: 'group-b', label: 'Group B', color: '#222222', chain_ids: ['chain-c'] }),
    ]);
    const bars = buildScoreHistogramBars({
      data: response([
        bin(),
        bin({ bin_start: 0.1, bin_end: 0.2, count: 1, chain_ids: ['chain-d'] }),
        bin({ bin_start: 0.2, bin_end: 0.3, count: 0, chain_ids: [] }),
      ]),
      selectedChains: new Set(['chain-a']),
      hasSelection: true,
    });

    expect(colorMap.get('chain-a')).toBe('#111111');
    expect(colorMap.get('chain-c')).toBe('#222222');
    expect(getScoreHistogramDominantColor(['chain-a', 'chain-c'], colorMap)).toBe('#111111');
    expect(getScoreHistogramDominantColor(['unknown'], colorMap)).toBe(SCORE_HISTOGRAM_FALLBACK_COLOR);
    expect(buildScoreHistogramBarColors(bars, colorMap)).toEqual([
      '#111111',
      SCORE_HISTOGRAM_FALLBACK_COLOR,
      SCORE_HISTOGRAM_FALLBACK_COLOR,
    ]);
    expect(buildScoreHistogramCellStyle({
      color: '#111111',
      hasSelection: true,
      hasSelected: false,
    })).toEqual({
      fill: '#111111',
      fillOpacity: 0.3,
      stroke: 'none',
      strokeWidth: 0,
    });
    expect(buildScoreHistogramCellStyle({
      color: '#111111',
      hasSelection: true,
      hasSelected: true,
    })).toEqual({
      fill: '#111111',
      fillOpacity: 0.8,
      stroke: '#111111',
      strokeWidth: 2,
    });
  });

  it('builds selection decisions', () => {
    const bars = buildScoreHistogramBars({
      data: response([bin()]),
      selectedChains: new Set(['chain-a']),
      hasSelection: true,
    });
    const bar = bars[0];
    expect(bar).toBeDefined();
    if (!bar) throw new Error('Expected score histogram bar');

    expect(getScoreHistogramSelectionDecision(bar, new Set(['chain-a']))).toEqual({
      chainIds: ['chain-a', 'chain-c'],
      mode: 'add',
    });
    expect(getScoreHistogramSelectionDecision(bar, new Set(['chain-a', 'chain-c']))).toEqual({
      chainIds: ['chain-a', 'chain-c'],
      mode: 'remove',
    });
    expect(getScoreHistogramSelectionDecision({
      ...bar,
      chainIds: [],
    }, new Set())).toBeNull();
    expect(getScoreHistogramSelectionDecision(undefined, new Set())).toBeNull();
  });
});
