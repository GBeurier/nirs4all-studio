import { describe, expect, it } from 'vitest';

import type { BinnedImportanceData } from '@/types/shap';
import {
  buildShapFeatureImportanceCsv,
  buildShapFeatureImportanceExportRows,
  buildShapFeatureImportanceRows,
  getShapFeatureImportanceFill,
} from './shapFeatureImportanceData';

function binnedImportance(overrides: Partial<BinnedImportanceData> = {}): BinnedImportanceData {
  return {
    bin_centers: [1105, 1205, 1305],
    bin_values: [0.2, 0.8, 0.4],
    bin_ranges: [
      [1100, 1110],
      [1200, 1210],
      [1300, 1310],
    ],
    bin_size: 10,
    bin_stride: 5,
    aggregation: 'sum',
    ...overrides,
  };
}

describe('shapFeatureImportanceData', () => {
  it('builds ranked feature-importance rows sorted by importance', () => {
    expect(buildShapFeatureImportanceRows(binnedImportance())).toEqual([
      {
        label: '1200-1210',
        center: 1205,
        importance: 0.8,
        normalized: 1,
        rank: 1,
      },
      {
        label: '1300-1310',
        center: 1305,
        importance: 0.4,
        normalized: 0.5,
        rank: 2,
      },
      {
        label: '1100-1110',
        center: 1105,
        importance: 0.2,
        normalized: 0.25,
        rank: 3,
      },
    ]);
  });

  it('limits ranked rows when requested', () => {
    expect(buildShapFeatureImportanceRows(binnedImportance(), 2).map(row => row.label)).toEqual([
      '1200-1210',
      '1300-1310',
    ]);
  });

  it('keeps normalized importance finite when all bins are zero', () => {
    expect(buildShapFeatureImportanceRows(binnedImportance({ bin_values: [0, 0, 0] })).map(row => row.normalized)).toEqual([
      0,
      0,
      0,
    ]);
  });

  it('builds sorted export rows and CSV content', () => {
    expect(buildShapFeatureImportanceExportRows(binnedImportance())).toEqual([
      { wavelengthStart: 1200, wavelengthEnd: 1210, center: 1205, importance: 0.8 },
      { wavelengthStart: 1300, wavelengthEnd: 1310, center: 1305, importance: 0.4 },
      { wavelengthStart: 1100, wavelengthEnd: 1110, center: 1105, importance: 0.2 },
    ]);

    expect(buildShapFeatureImportanceCsv(binnedImportance())).toBe([
      'Rank,Wavelength Range (cm⁻¹),Center,Importance',
      '1,1200.0-1210.0,1205.0,0.800000',
      '2,1300.0-1310.0,1305.0,0.400000',
      '3,1100.0-1110.0,1105.0,0.200000',
    ].join('\n'));
  });

  it('builds the existing normalized teal fill', () => {
    expect(getShapFeatureImportanceFill(0.5)).toBe('rgba(13, 148, 136, 0.7)');
  });
});
