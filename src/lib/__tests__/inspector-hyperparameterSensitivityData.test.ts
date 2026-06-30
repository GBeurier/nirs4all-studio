import { describe, expect, it } from 'vitest';

import {
  buildHyperparameterColorMap,
  buildHyperparameterModelCounts,
  buildHyperparameterScaleData,
  buildHyperparameterTickValues,
  computeHyperparameterTrend,
  filterFiniteHyperparameterPoints,
  formatHyperparameterXValue,
} from '@/lib/inspector/hyperparameterSensitivityData';
import type { HyperparameterPoint } from '@/types/inspector';

function point(overrides: Partial<HyperparameterPoint> = {}): HyperparameterPoint {
  return {
    chain_id: 'chain-1',
    param_value: 1,
    score: 0.2,
    model_class: 'PLS',
    ...overrides,
  };
}

describe('inspector hyperparameter sensitivity data helpers', () => {
  it('filters invalid points and builds stable model colors/counts', () => {
    const points = [
      point({ chain_id: 'a', model_class: 'PLS' }),
      point({ chain_id: 'b', model_class: 'Ridge' }),
      point({ chain_id: 'c', model_class: 'PLS', score: Number.NaN }),
    ];

    expect(filterFiniteHyperparameterPoints(points).map((entry) => entry.chain_id)).toEqual(['a', 'b']);
    expect([...buildHyperparameterColorMap(points).keys()]).toEqual(['PLS', 'Ridge']);
    expect(buildHyperparameterModelCounts(points)).toEqual(new Map([
      ['PLS', 2],
      ['Ridge', 1],
    ]));
  });

  it('computes linear trend and domains for linear scale', () => {
    const data = buildHyperparameterScaleData([
      point({ param_value: 1, score: 2 }),
      point({ param_value: 2, score: 4 }),
      point({ param_value: 3, score: 6 }),
    ], 'linear');

    expect(data.useLogX).toBe(false);
    expect(data.logAllowed).toBe(true);
    expect(data.xDomain).toEqual([1, 3]);
    expect(data.yDomain).toEqual([2, 6]);
    expect(data.trend?.slope).toBeCloseTo(2);
    expect(data.trend?.r).toBeCloseTo(1);
  });

  it('uses log10 transformed values only when all parameters are positive', () => {
    const logData = buildHyperparameterScaleData([
      point({ param_value: 1, score: 2 }),
      point({ param_value: 10, score: 4 }),
      point({ param_value: 100, score: 6 }),
    ], 'log');

    expect(logData.useLogX).toBe(true);
    expect(logData.xValues).toEqual([0, 1, 2]);
    expect(logData.trend?.slope).toBeCloseTo(2);

    const blockedLogData = buildHyperparameterScaleData([
      point({ param_value: 0, score: 1 }),
      point({ param_value: 10, score: 2 }),
    ], 'log');
    expect(blockedLogData.useLogX).toBe(false);
    expect(blockedLogData.logAllowed).toBe(false);
    expect(blockedLogData.xValues).toEqual([0, 10]);
  });

  it('builds ticks, formats log ticks, and rejects degenerate trends', () => {
    expect(buildHyperparameterTickValues([0, 8], 4)).toEqual([0, 2, 4, 6, 8]);
    expect(formatHyperparameterXValue(2, true)).toBe('100');
    expect(computeHyperparameterTrend([1, 1, 1], [2, 3, 4])).toBeNull();
  });
});
