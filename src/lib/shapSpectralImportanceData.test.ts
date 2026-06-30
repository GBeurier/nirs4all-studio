import { describe, expect, it } from 'vitest';

import type { BinnedImportanceData } from '@/types/shap';
import {
  buildShapSpectralBinnedBarData,
  buildShapSpectralChartData,
  buildShapSpectralHighlightRegions,
  downsampleShapSpectralPoints,
  getShapSpectralImportanceColor,
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
  it('downsamples evenly while preserving the first and last points', () => {
    expect(downsampleShapSpectralPoints([0, 1, 2, 3, 4], 3)).toEqual([0, 2, 4]);
    expect(downsampleShapSpectralPoints([0, 1, 2], 5)).toEqual([0, 1, 2]);
  });

  it('builds spectral chart points with zero fallbacks and display downsampling', () => {
    expect(buildShapSpectralChartData([1100, 1110, 1120, 1130, 1140], [0.1, 0.2], [1, 0, 3], 3)).toEqual([
      { wavelength: 1100, importance: 0.1, absorbance: 1 },
      { wavelength: 1120, importance: 0, absorbance: 3 },
      { wavelength: 1140, importance: 0, absorbance: 0 },
    ]);
  });

  it('builds normalized highlight regions from absolute binned importance', () => {
    expect(buildShapSpectralHighlightRegions(binnedImportance(), [1100, 1200, 1300], [1, 2, 3])).toEqual([
      { start: 1200, end: 1210, normalized: 1 },
    ]);
  });

  it('falls back to curve-derived highlight regions when binned scores are empty', () => {
    expect(buildShapSpectralHighlightRegions(
      binnedImportance({
        bin_centers: [],
        bin_values: [],
        bin_ranges: [],
        bin_size: 2,
        bin_stride: 2,
      }),
      [1000, 1010, 1020, 1030],
      [0.2, 0.2, 1.0, 0.6],
    )).toEqual([
      { start: 1000, end: 1010, normalized: 0.25 },
      { start: 1020, end: 1030, normalized: 1 },
    ]);
  });

  it('builds binned bar rows and detects absorbance visibility', () => {
    expect(buildShapSpectralBinnedBarData(binnedImportance())).toEqual([
      { center: 1105, importance: 0.1, label: '1100-1110' },
      { center: 1205, importance: -0.5, label: '1200-1210' },
      { center: 1305, importance: 0.05, label: '1300-1310' },
    ]);

    expect(hasShapSpectralAbsorbance([0, 0, 0])).toBe(false);
    expect(hasShapSpectralAbsorbance([0, 0.01, 0])).toBe(true);
  });

  it('keeps the existing spectral highlight color buckets', () => {
    expect(getShapSpectralImportanceColor(0.9)).toBe('rgba(13, 148, 136, 0.7)');
    expect(getShapSpectralImportanceColor(0.7)).toBe('rgba(20, 184, 166, 0.5)');
    expect(getShapSpectralImportanceColor(0.5)).toBe('rgba(45, 212, 191, 0.35)');
    expect(getShapSpectralImportanceColor(0.3)).toBe('rgba(94, 234, 212, 0.25)');
    expect(getShapSpectralImportanceColor(0.2)).toBe('rgba(153, 246, 228, 0.15)');
  });
});
