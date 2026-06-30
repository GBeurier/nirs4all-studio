import { describe, expect, it } from 'vitest';

import {
  canUseSelectedReference,
  getOutlierPreviewValues,
  getOutlierSelectionIndices,
  getReferenceSampleLabel,
  getSelectedReferenceIndex,
  getSimilaritySearchArgs,
  getSimilaritySelectionIndices,
  parseReferenceIndexInput,
} from '@/lib/playground/analysisSelection';
import type { MetricsResult, OutlierResult, SimilarityResult } from '@/types/playground';

const similarityResult: SimilarityResult = {
  success: true,
  reference_idx: 1,
  metric: 'euclidean',
  similar_indices: [2, 4],
  distances: [0.1, 0.2],
  n_similar: 2,
};

const outlierResult: OutlierResult = {
  success: true,
  inlier_mask: [true, false, true, false, true],
  outlier_indices: [1, 3],
  n_outliers: 2,
  n_inliers: 3,
  method: 'hotelling_t2',
  threshold: 0.95,
  values: [0.1, 0.8, 0.2, 1.4, 0.3],
};

describe('playground analysis selection helpers', () => {
  it('resolves reference samples from explicit and context selection state', () => {
    expect(getSelectedReferenceIndex({
      selectedSample: 3,
      selectedSamples: new Set([1]),
      selectedCount: 1,
    })).toBe(3);
    expect(getSelectedReferenceIndex({
      selectedSample: null,
      selectedSamples: new Set([1]),
      selectedCount: 1,
    })).toBe(1);
    expect(canUseSelectedReference({
      selectedSample: null,
      selectedSamples: new Set([1, 2]),
      selectedCount: 2,
    })).toBe(false);
  });

  it('formats and clamps similarity reference inputs', () => {
    expect(getReferenceSampleLabel(null, ['a'])).toBe('Not selected');
    expect(getReferenceSampleLabel(1, ['a', 'sample-b'])).toBe('sample-b');
    expect(getReferenceSampleLabel(2, ['a'])).toBe('Sample 2');
    expect(parseReferenceIndexInput('12', 5)).toBe(4);
    expect(parseReferenceIndexInput('-3', 5)).toBe(0);
    expect(parseReferenceIndexInput('', 5)).toBeNull();
  });

  it('builds similarity query args and inverted selection indices', () => {
    expect(getSimilaritySearchArgs({ useTopK: true, threshold: 0.3, topK: 8 })).toEqual({
      topK: 8,
    });
    expect(getSimilaritySearchArgs({ useTopK: false, threshold: 0.3, topK: 8 })).toEqual({
      threshold: 0.3,
    });
    expect(getSimilaritySelectionIndices({
      result: similarityResult,
      referenceIdx: 1,
      selectDifferent: false,
      totalSamples: 6,
    })).toEqual([2, 4]);
    expect(getSimilaritySelectionIndices({
      result: similarityResult,
      referenceIdx: 1,
      selectDifferent: true,
      totalSamples: 6,
    })).toEqual([0, 3, 5]);
  });

  it('maps outlier metrics to preview values', () => {
    const metrics: MetricsResult = {
      values: {
        hotelling_t2: [1, 2],
        lof_score: [3, 4],
      },
      statistics: {},
      computed_metrics: ['hotelling_t2', 'lof_score'],
      available_metrics: ['outlier'],
      n_samples: 2,
    };

    expect(getOutlierPreviewValues(metrics, 'hotelling_t2')).toEqual([1, 2]);
    expect(getOutlierPreviewValues(metrics, 'lof')).toEqual([3, 4]);
    expect(getOutlierPreviewValues(metrics, 'distance')).toBeUndefined();
  });

  it('selects outliers, inliers, and top-k outliers from detection results', () => {
    expect(getOutlierSelectionIndices({
      result: outlierResult,
      topKMode: false,
      topK: 1,
      selectInliers: false,
    })).toEqual([1, 3]);
    expect(getOutlierSelectionIndices({
      result: outlierResult,
      topKMode: false,
      topK: 1,
      selectInliers: true,
    })).toEqual([0, 2, 4]);
    expect(getOutlierSelectionIndices({
      result: outlierResult,
      topKMode: true,
      topK: 1,
      selectInliers: true,
    })).toEqual([3]);
  });
});
