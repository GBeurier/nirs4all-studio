import { describe, expect, it } from 'vitest';

import {
  buildFoldDistributionExportRows,
  buildFoldDistributionMetadataCategories,
  buildFoldDistributionPartitionBars,
  buildFoldDistributionSegmentKeys,
  buildFoldDistributionYStatsData,
  computeFoldDistributionSegments,
  getFoldDistributionTargetMean,
  getFoldDistributionTargetRange,
  type FoldDistributionSegmentOptions,
} from '@/lib/playground/foldDistributionData';
import type { FoldsInfo } from '@/types/playground';

const baseSegmentOptions: FoldDistributionSegmentOptions = {
  colorMode: 'partition',
  yBins: [],
  isClassificationMode: false,
  classLabels: [],
  selectedSamples: new Set(),
  metadataCategories: [],
};

describe('foldDistributionData', () => {
  it('builds Y distribution rows only for folds with complete train/test stats', () => {
    const folds: FoldsInfo = {
      splitter_name: 'kfold',
      n_folds: 2,
      folds: [
        {
          fold_index: 0,
          train_count: 2,
          test_count: 2,
          train_indices: [0, 1],
          test_indices: [2, 3],
          y_train_stats: { mean: 2, std: 0.5, min: 1, max: 3 },
          y_test_stats: { mean: 5, std: 1.5, min: 4, max: 7 },
        },
        {
          fold_index: 1,
          train_count: 3,
          test_count: 1,
          train_indices: [0, 2, 3],
          test_indices: [1],
          y_train_stats: { mean: 3, std: 1, min: 1, max: 5 },
        },
      ],
    };

    expect(buildFoldDistributionYStatsData(folds, {
      formatFoldLabel: foldIndex => `CV ${foldIndex}`,
    })).toEqual([{
      fold: 'CV 0',
      foldIndex: 0,
      trainMean: 2,
      trainStd: 0.5,
      trainMin: 1,
      trainMax: 3,
      testMean: 5,
      testStd: 1.5,
      testMin: 4,
      testMax: 7,
      trainLower: 0.5,
      trainUpper: 0.5,
      testLower: 1.5,
      testUpper: 1.5,
    }]);
  });

  it('computes target range and mean defaults for distribution overlays', () => {
    expect(getFoldDistributionTargetRange(undefined)).toEqual({ min: 0, max: 1 });
    expect(getFoldDistributionTargetRange([])).toEqual({ min: 0, max: 1 });
    expect(getFoldDistributionTargetRange([4, -2, 8, 1])).toEqual({ min: -2, max: 8 });

    expect(getFoldDistributionTargetMean(undefined)).toBeNull();
    expect(getFoldDistributionTargetMean([])).toBeNull();
    expect(getFoldDistributionTargetMean([2, 4, 9])).toBe(5);
  });

  it('builds export rows without leaking chart-side formatting details', () => {
    const folds: FoldsInfo = {
      splitter_name: 'split',
      n_folds: 2,
      folds: [
        {
          fold_index: 0,
          train_count: 3,
          test_count: 1,
          train_indices: [0, 1, 2],
          test_indices: [3],
          y_train_stats: { mean: 1.5, std: 0.2, min: 1, max: 2 },
          y_test_stats: { mean: 4, std: 0, min: 4, max: 4 },
        },
        {
          fold_index: 1,
          train_count: 2,
          test_count: 2,
          train_indices: [0, 3],
          test_indices: [1, 2],
        },
      ],
    };

    expect(buildFoldDistributionExportRows(folds, {
      formatFoldLabel: foldIndex => `Fold#${foldIndex + 1}`,
    })).toEqual([
      {
        fold: 'Fold#1',
        train_count: 3,
        test_count: 1,
        train_y_mean: 1.5,
        train_y_std: 0.2,
        test_y_mean: 4,
        test_y_std: 0,
      },
      {
        fold: 'Fold#2',
        train_count: 2,
        test_count: 2,
      },
    ]);
  });

  it('builds metadata categories from non-empty values with a stable limit', () => {
    expect(buildFoldDistributionMetadataCategories({
      batch: ['a', null, 'b', 'a', undefined, 'c'],
    }, 'batch', 2)).toEqual(['a', 'b']);
  });

  it('segments target regression values by uniform bins and preserves sample indices', () => {
    expect(computeFoldDistributionSegments([0, 1, 2, 3], {
      ...baseSegmentOptions,
      colorMode: 'target',
      y: [0, 4, 6, 10],
      yBins: [
        { min: 0, max: 5 },
        { min: 5, max: 10 },
      ],
    })).toEqual({
      counts: { bin_0: 2, bin_1: 2 },
      indices: { bin_0: [0, 1], bin_1: [2, 3] },
    });
  });

  it('segments by metadata, selection, and outlier state', () => {
    expect(computeFoldDistributionSegments([0, 1, 2, 3], {
      ...baseSegmentOptions,
      colorMode: 'metadata',
      metadataKey: 'batch',
      metadata: { batch: ['a', 'b', 'a', 'z'] },
      metadataCategories: ['a', 'b'],
    })).toEqual({
      counts: { meta_0: 2, meta_1: 1, other: 1 },
      indices: { meta_0: [0, 2], meta_1: [1], other: [3] },
    });

    expect(computeFoldDistributionSegments([0, 1, 2], {
      ...baseSegmentOptions,
      colorMode: 'selection',
      selectedSamples: new Set([1]),
    }).counts).toEqual({ selected: 1, unselected: 2 });

    expect(computeFoldDistributionSegments([0, 1, 2], {
      ...baseSegmentOptions,
      colorMode: 'outlier',
      outlierIndices: new Set([0, 2]),
    }).indices).toEqual({ outlier: [0, 2], normal: [1] });
  });

  it('builds simple train/test partition bars with display filtering applied', () => {
    const folds: FoldsInfo = {
      splitter_name: 'split',
      n_folds: 1,
      folds: [{
        fold_index: 0,
        train_count: 3,
        test_count: 2,
        train_indices: [0, 1, 2],
        test_indices: [3, 4],
        y_train_stats: { mean: 2, std: 1, min: 1, max: 3 },
        y_test_stats: { mean: 5, std: 0.5, min: 4, max: 6 },
      }],
    };

    expect(buildFoldDistributionPartitionBars({
      folds,
      displayFilteredIndices: new Set([1, 3, 4]),
      segmentOptions: baseSegmentOptions,
    })).toMatchObject([
      {
        index: 0,
        label: 'Train',
        partitionId: 'train-0',
        count: 1,
        indices: [1],
        yMean: 2,
        segments: { total: 1 },
      },
      {
        index: 1,
        label: 'Test',
        partitionId: 'test-0',
        count: 2,
        indices: [3, 4],
        yStd: 0.5,
        segmentIndices: { total: [3, 4] },
      },
    ]);
  });

  it('builds k-fold partition bars and held-out test stats from fold labels', () => {
    const folds: FoldsInfo = {
      splitter_name: 'kfold',
      n_folds: 2,
      fold_labels: [0, 0, 1, 1, -1],
      folds: [
        {
          fold_index: 0,
          train_count: 2,
          test_count: 2,
          train_indices: [2, 3],
          test_indices: [0, 1],
        },
        {
          fold_index: 1,
          train_count: 2,
          test_count: 2,
          train_indices: [0, 1],
          test_indices: [2, 3],
        },
      ],
    };

    expect(buildFoldDistributionPartitionBars({
      folds,
      y: [1, 2, 3, 4, 10],
      segmentOptions: {
        ...baseSegmentOptions,
        colorMode: 'selection',
        selectedSamples: new Set([4]),
      },
    })).toMatchObject([
      { index: 0, label: 'Train 1', partitionId: 'train-0', indices: [2, 3] },
      { index: 1, label: 'Val 1', partitionId: 'val-0', indices: [0, 1] },
      { index: 2, label: 'Train 2', partitionId: 'train-1', indices: [0, 1] },
      { index: 3, label: 'Val 2', partitionId: 'val-1', indices: [2, 3] },
      {
        index: 4,
        label: 'Test',
        partitionId: 'test-holdout',
        indices: [4],
        yMean: 10,
        yStd: 0,
        segments: { selected: 1, unselected: 0 },
      },
    ]);
  });

  it('builds segment keys from the active color mode', () => {
    expect(buildFoldDistributionSegmentKeys({
      colorMode: 'target',
      yBins: [{ min: 0, max: 1 }, { min: 1, max: 2 }],
      isClassificationMode: false,
      classLabels: [],
      metadataCategories: [],
    })).toEqual(['bin_0', 'bin_1']);

    expect(buildFoldDistributionSegmentKeys({
      colorMode: 'metadata',
      yBins: [],
      isClassificationMode: false,
      classLabels: [],
      metadataCategories: ['a', 'b'],
    })).toEqual(['meta_0', 'meta_1', 'other']);
  });
});
