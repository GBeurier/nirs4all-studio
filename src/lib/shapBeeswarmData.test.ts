import { describe, expect, it } from 'vitest';

import type { BeeswarmBin } from '@/types/shap';
import {
  SHAP_BEESWARM_SELECTED_COLOR,
  buildShapBeeswarmBinPoints,
  buildShapBeeswarmPoints,
  buildShapBeeswarmYTicks,
  getShapBeeswarmPointColor,
  getShapBeeswarmPointStyle,
} from './shapBeeswarmData';

function beeswarmBin(overrides: Partial<BeeswarmBin> = {}): BeeswarmBin {
  return {
    label: '1100.0-1200.0',
    center: 1150,
    start_wavelength: 1100,
    end_wavelength: 1200,
    points: [
      { sample_idx: 2, shap_value: -0.25, feature_value: 0.1 },
      { sample_idx: 5, shap_value: 0.5, feature_value: 0.9 },
    ],
    ...overrides,
  };
}

function sequenceRandom(values: number[]) {
  let index = 0;
  return () => values[index++ % values.length];
}

describe('shapBeeswarmData', () => {
  it('builds jittered beeswarm points with an injectable random source', () => {
    expect(buildShapBeeswarmBinPoints(
      beeswarmBin(),
      3,
      sequenceRandom([0, 0.5]),
    )).toEqual([
      {
        x: -0.25,
        y: 2.7,
        color: 0.1,
        sampleIdx: 2,
        binLabel: '1100.0-1200.0',
      },
      {
        x: 0.5,
        y: 3,
        color: 0.9,
        sampleIdx: 5,
        binLabel: '1100.0-1200.0',
      },
    ]);
  });

  it('flattens points across bins and keeps bin-relative y positions', () => {
    const points = buildShapBeeswarmPoints([
      beeswarmBin({ label: 'A', points: [{ sample_idx: 1, shap_value: 0.1, feature_value: 0.2 }] }),
      beeswarmBin({ label: 'B', points: [{ sample_idx: 2, shap_value: 0.2, feature_value: 0.4 }] }),
    ], sequenceRandom([1]));

    expect(points).toEqual([
      { x: 0.1, y: 0.3, color: 0.2, sampleIdx: 1, binLabel: 'A' },
      { x: 0.2, y: 1.3, color: 0.4, sampleIdx: 2, binLabel: 'B' },
    ]);
  });

  it('builds y-axis ticks from bin labels', () => {
    expect(buildShapBeeswarmYTicks([
      beeswarmBin({ label: 'A' }),
      beeswarmBin({ label: 'B' }),
    ])).toEqual([
      { value: 0, label: 'A' },
      { value: 1, label: 'B' },
    ]);
  });

  it('maps feature values to the existing beeswarm color buckets', () => {
    expect(getShapBeeswarmPointColor(0.95)).toBe('#ef4444');
    expect(getShapBeeswarmPointColor(0.8)).toBe('#f97316');
    expect(getShapBeeswarmPointColor(0.6)).toBe('#eab308');
    expect(getShapBeeswarmPointColor(0.4)).toBe('#22c55e');
    expect(getShapBeeswarmPointColor(0.2)).toBe('#3b82f6');
  });

  it('builds selected and unselected cell styles', () => {
    expect(getShapBeeswarmPointStyle(0.9, false)).toEqual({
      fill: '#ef4444',
      fillOpacity: 0.7,
      stroke: 'none',
      strokeWidth: 0,
    });
    expect(getShapBeeswarmPointStyle(0.1, true)).toEqual({
      fill: SHAP_BEESWARM_SELECTED_COLOR,
      fillOpacity: 1,
      stroke: SHAP_BEESWARM_SELECTED_COLOR,
      strokeWidth: 2,
    });
  });
});
