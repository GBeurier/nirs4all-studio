import { describe, expect, it } from 'vitest';

import type { BinnedImportanceData, ShapResultsResponse } from '@/types/shap';
import {
  getShapInitialBinningParams,
  getShapResultsHeaderSummary,
  getShapWaterfallSampleIndex,
  getShapWaterfallSelection,
  toggleShapSelectedSample,
} from './shapResultsPanelData';

function binnedImportance(overrides: Partial<BinnedImportanceData> = {}): BinnedImportanceData {
  return {
    bin_centers: [1150],
    bin_values: [0.6],
    bin_ranges: [[1100, 1200]],
    bin_size: 20,
    bin_stride: 10,
    aggregation: 'sum',
    ...overrides,
  };
}

function shapResults(overrides: Partial<ShapResultsResponse> = {}): ShapResultsResponse {
  return {
    job_id: 'job-1',
    model_id: 'chain-1',
    dataset_id: 'corn',
    explainer_type: 'auto',
    n_samples: 10,
    n_features: 3,
    base_value: 0.5,
    execution_time_ms: 42.6,
    feature_importance: [],
    wavelengths: [1100, 1200, 1300],
    mean_abs_shap: [0.1, 0.2, 0.3],
    mean_spectrum: [1, 2, 3],
    binned_importance: binnedImportance(),
    sample_indices: [0, 1, 2],
    ...overrides,
  };
}

describe('shapResultsPanelData', () => {
  it('resolves the waterfall sample index from selected samples', () => {
    expect(getShapWaterfallSampleIndex([])).toBe(0);
    expect(getShapWaterfallSampleIndex([7, 2])).toBe(7);
    expect(getShapWaterfallSelection(4)).toEqual([4]);
  });

  it('toggles beeswarm selected samples with stable ascending order', () => {
    expect(toggleShapSelectedSample([5, 1], 3)).toEqual([1, 3, 5]);
    expect(toggleShapSelectedSample([5, 1, 3], 1)).toEqual([3, 5]);
    expect(toggleShapSelectedSample([2, 2, 1], 2)).toEqual([1]);
  });

  it('uses rebinned data for initial binning params when available', () => {
    const results = shapResults({
      binned_importance: binnedImportance({
        bin_size: 20,
        bin_stride: 10,
        aggregation: 'sum',
      }),
    });
    const rebinned = binnedImportance({
      bin_size: 30,
      bin_stride: 15,
      aggregation: 'mean_abs',
    });

    expect(getShapInitialBinningParams(results, null)).toEqual({
      binSize: 20,
      binStride: 10,
      aggregation: 'sum',
    });
    expect(getShapInitialBinningParams(results, rebinned)).toEqual({
      binSize: 30,
      binStride: 15,
      aggregation: 'mean_abs',
    });
  });

  it('builds header summary values without JSX formatting rules', () => {
    expect(getShapResultsHeaderSummary(shapResults({
      n_samples: 42,
      explainer_type: 'kernel',
      execution_time_ms: 99.6,
    }))).toEqual({
      sampleCount: 42,
      explainerType: 'kernel',
      executionTimeLabel: '100ms',
    });
  });
});
