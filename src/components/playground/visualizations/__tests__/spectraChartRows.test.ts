import { describe, expect, it } from 'vitest';

import { buildSpectraChartRows } from '../spectraChartRows';
import type { AggregatedStats } from '../SpectraAggregation';

const stats: AggregatedStats = {
  mean: [10, 20],
  std: [1, 2],
  min: [8, 16],
  max: [12, 24],
  median: [9, 18],
  quantileLower: [8.5, 17],
  quantileUpper: [11.5, 23],
  n: 2,
};

describe('buildSpectraChartRows', () => {
  it('returns no rows for WebGL mode', () => {
    expect(buildSpectraChartRows({
      isWebGLMode: true,
      focusedData: { wavelengths: [1000], spectra: [[1]] },
      focusedOriginalData: { wavelengths: [1000], spectra: [[1]] },
      displayIndices: [0],
      aggregationMode: 'none',
      showIndividualLines: true,
      viewMode: 'processed',
      displayMode: 'individual',
      aggregatedStats: null,
      originalAggregatedStats: null,
      groupedStats: null,
    })).toEqual([]);
  });

  it('aligns original and processed lines after wavelength focus', () => {
    expect(buildSpectraChartRows({
      isWebGLMode: false,
      focusedData: {
        wavelengths: [1100, 1200],
        spectra: [[20, 30]],
      },
      focusedOriginalData: {
        wavelengths: [1100, 1200],
        spectra: [[2, 3]],
      },
      displayIndices: [0],
      aggregationMode: 'none',
      showIndividualLines: true,
      viewMode: 'both',
      displayMode: 'individual',
      aggregatedStats: null,
      originalAggregatedStats: null,
      groupedStats: null,
      referenceDataset: {
        spectra: [[200, 300]],
      },
    })).toEqual([
      { wavelength: 1100, p0: 20, o0: 2, r0: 200 },
      { wavelength: 1200, p0: 30, o0: 3, r0: 300 },
    ]);
  });

  it('adds aggregate and grouped rows when requested', () => {
    const groupedStats = new Map<string, AggregatedStats>([['batch-a', stats]]);

    expect(buildSpectraChartRows({
      isWebGLMode: false,
      focusedData: {
        wavelengths: [1100, 1200],
        spectra: [[20, 30]],
      },
      focusedOriginalData: {
        wavelengths: [1100, 1200],
        spectra: [[2, 3]],
      },
      displayIndices: [0],
      aggregationMode: 'mean_std',
      showIndividualLines: false,
      viewMode: 'both',
      displayMode: 'grouped',
      aggregatedStats: stats,
      originalAggregatedStats: stats,
      groupedStats,
    })[0]).toMatchObject({
      wavelength: 1100,
      'grp_batch-a_mean': 10,
      'grp_batch-a_std_low': 9,
      'grp_batch-a_std_high': 11,
      'grp_batch-a_q_low': 8.5,
      'grp_batch-a_q_high': 11.5,
      'grp_batch-a_median': 9,
      'grp_batch-a_min': 8,
      'grp_batch-a_max': 12,
    });
  });
});
