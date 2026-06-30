import { describe, expect, it } from 'vitest';

import {
  buildCandlestickData,
  buildCandlestickLayout,
  buildCandlestickOutlierPoints,
  buildCandlestickTicks,
  getCandlestickCategoryGeometry,
  getCandlestickColor,
  getCandlestickSelectableChainIds,
  scaleCandlestickY,
} from '@/lib/inspector/candlestickData';
import { INSPECTOR_GROUP_COLORS } from '@/types/inspector';
import type { CandlestickCategory, CandlestickResponse } from '@/types/inspector';

function category(overrides: Partial<CandlestickCategory> = {}): CandlestickCategory {
  return {
    label: 'PLS',
    min: 0.1,
    q25: 0.2,
    median: 0.4,
    q75: 0.6,
    max: 0.7,
    mean: 0.42,
    count: 3,
    outlier_values: [0.85, -0.25],
    chain_ids: ['chain-a', 'chain-b'],
    ...overrides,
  };
}

function response(categories: CandlestickCategory[]): CandlestickResponse {
  return {
    categories,
    category_variable: 'model_class',
    score_column: 'cv_val_score',
  };
}

describe('inspector candlestick data helpers', () => {
  it('builds padded score domains from category extrema and outliers', () => {
    const data = buildCandlestickData(response([
      category(),
      category({
        label: 'Ridge',
        min: 0,
        q25: 0.05,
        median: 0.1,
        q75: 0.15,
        max: 0.2,
        outlier_values: [],
        chain_ids: ['chain-c'],
      }),
    ]));

    expect(data.categories).toHaveLength(2);
    expect(data.yMin).toBeCloseTo(-0.305);
    expect(data.yMax).toBeCloseTo(0.905);
    expect(buildCandlestickData(null)).toEqual({ yMin: 0, yMax: 1, categories: [] });
  });

  it('computes layout, y scales, ticks, category geometry, and outlier points', () => {
    const layout = buildCandlestickLayout({
      width: 600,
      height: 400,
      categoryCount: 3,
      yMin: -0.25,
      yMax: 0.85,
    });

    expect(layout.marginLeft).toBe(55);
    expect(layout.marginRight).toBe(15);
    expect(layout.marginTop).toBe(15);
    expect(layout.marginBottom).toBe(80);
    expect(layout.plotW).toBe(530);
    expect(layout.plotH).toBe(305);
    expect(layout.yRange).toBeCloseTo(1.1);
    expect(layout.categoryWidth).toBeCloseTo(176.66667);
    expect(layout.boxWidth).toBe(50);

    expect(scaleCandlestickY(0, -0.25, layout)).toBeCloseTo(250.68182);
    const ticks = buildCandlestickTicks(-0.25, layout.yRange);
    expect(ticks).toHaveLength(6);
    expect(ticks[0]).toBeCloseTo(-0.25);
    expect(ticks[5]).toBeCloseTo(0.85);

    const geometry = getCandlestickCategoryGeometry({
      category: category(),
      categoryIndex: 1,
      yMin: -0.25,
      layout,
      height: 400,
    });
    expect(geometry.cx).toBeCloseTo(320);
    expect(geometry.yQ25).toBeCloseTo(195.22727);
    expect(geometry.yQ75).toBeCloseTo(84.31818);
    expect(geometry.yMedian).toBeCloseTo(139.77273);
    expect(geometry.yMin).toBeCloseTo(222.95455);
    expect(geometry.yMax).toBeCloseTo(56.59091);
    expect(geometry.capX1).toBeCloseTo(305);
    expect(geometry.capX2).toBeCloseTo(335);
    expect(geometry.boxX).toBeCloseTo(295);
    expect(geometry.boxY).toBeCloseTo(84.31818);
    expect(geometry.boxHeight).toBeCloseTo(110.90909);
    expect(geometry.medianX1).toBeCloseTo(295);
    expect(geometry.medianX2).toBeCloseTo(345);
    expect(geometry.labelX).toBeCloseTo(320);
    expect(geometry.labelY).toBe(330);
    expect(geometry.labelTransform).toBe('rotate(-40, 320, 330)');

    const outliers = buildCandlestickOutlierPoints({
      values: [0.85, -0.25],
      cx: geometry.cx,
      yMin: -0.25,
      layout,
    });
    expect(outliers).toHaveLength(2);
    expect(outliers[0].value).toBe(0.85);
    expect(outliers[0].cx).toBeCloseTo(320);
    expect(outliers[0].cy).toBeCloseTo(15);
    expect(outliers[1].value).toBe(-0.25);
    expect(outliers[1].cx).toBeCloseTo(320);
    expect(outliers[1].cy).toBeCloseTo(320);
  });

  it('keeps colors and selectable category ids deterministic', () => {
    expect(getCandlestickColor(0)).toBe(INSPECTOR_GROUP_COLORS[0]);
    expect(getCandlestickColor(INSPECTOR_GROUP_COLORS.length)).toBe(INSPECTOR_GROUP_COLORS[0]);
    expect(getCandlestickSelectableChainIds(category())).toEqual(['chain-a', 'chain-b']);
    expect(getCandlestickSelectableChainIds(undefined)).toEqual([]);
  });
});
