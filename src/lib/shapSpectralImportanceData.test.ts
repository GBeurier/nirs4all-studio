import { describe, expect, it } from 'vitest';

import type { BinnedImportanceData } from '@/types/shap';
import {
  buildShapSpectralRegions,
  getShapBinValueKind,
  hasShapSpectralAbsorbance,
} from './shapSpectralImportanceData';

function binnedImportance(overrides: Partial<BinnedImportanceData> = {}): BinnedImportanceData {
  return {
    bin_centers: [1105, 1205, 1305],
    bin_values: [0.1, -0.5, 0.05],
    bin_ranges: [
      [1100, 1110],
      [1200, 1210],
      [1300, 1310],
    ],
    bin_size: 2,
    bin_stride: 2,
    aggregation: 'mean',
    ...overrides,
  };
}

describe('shapSpectralImportanceData', () => {
  it('projects bins onto spectral regions without altering signs or order', () => {
    expect(buildShapSpectralRegions(binnedImportance())).toEqual([
      { start: 1100, end: 1110, value: 0.1 },
      { start: 1200, end: 1210, value: -0.5 },
      { start: 1300, end: 1310, value: 0.05 },
    ]);
  });

  it('marks a missing bin value as unavailable instead of zero', () => {
    const regions = buildShapSpectralRegions(binnedImportance({ bin_values: [0.1] }));
    expect(regions[1].value).toBeNaN();
    expect(regions[2].value).toBeNaN();
  });

  it('reads sum and mean aggregations as signed and absolute aggregations as magnitudes', () => {
    expect(getShapBinValueKind('sum')).toBe('signed');
    expect(getShapBinValueKind('mean')).toBe('signed');
    expect(getShapBinValueKind('sum_abs')).toBe('magnitude');
    expect(getShapBinValueKind('mean_abs')).toBe('magnitude');
    expect(getShapBinValueKind('unknown')).toBe('magnitude');
  });

  it('detects whether a finite non-zero mean spectrum is available', () => {
    expect(hasShapSpectralAbsorbance([0, 0, 0])).toBe(false);
    expect(hasShapSpectralAbsorbance([0, Number.NaN])).toBe(false);
    expect(hasShapSpectralAbsorbance([0, 0.2])).toBe(true);
  });
});
