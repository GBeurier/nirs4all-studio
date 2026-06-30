import { describe, expect, it } from 'vitest';

import {
  buildSelectionFilterData,
  getSamplesByFold,
  getSamplesByMetadata,
  getSamplesByPartition,
  getSelectionFilterCount,
} from '@/lib/playground/selectionFilterData';
import type { FoldsInfo } from '@/types/playground';

const folds: FoldsInfo = {
  splitter_name: 'KFold',
  n_folds: 2,
  split_index: 0,
  fold_labels: [0, 1, 0, -1],
  folds: [
    { fold_index: 0, train_count: 2, test_count: 2, train_indices: [0, 2], test_indices: [1, 3] },
    { fold_index: 1, train_count: 2, test_count: 2, train_indices: [1, 3], test_indices: [0, 2] },
  ],
};

describe('selection filter data helpers', () => {
  it('builds fold and metadata options for selectable filters', () => {
    expect(buildSelectionFilterData({
      folds,
      metadata: {
        batch: ['a', 'b', 'a', 'c'],
        constant: ['x', 'x', 'x', 'x'],
      },
    })).toMatchObject({
      uniqueFolds: [0, 1],
      currentFoldData: folds.folds[0],
      hasFoldSelection: true,
      hasSelectionOptions: true,
      metadataColumns: [{
        key: 'batch',
        uniqueValues: ['a', 'b', 'c'],
        totalValues: 3,
      }],
    });
  });

  it('returns indices for fold, partition, and metadata selections', () => {
    expect(getSamplesByFold(folds, 0)).toEqual([0, 2]);
    expect(getSamplesByPartition(folds.folds[0], 'test')).toEqual([1, 3]);
    expect(getSamplesByMetadata({ batch: ['a', 'b', 'a'] }, 'batch', 'a')).toEqual([0, 2]);
  });

  it('counts samples for rendered filter options', () => {
    expect(getSelectionFilterCount({
      type: 'fold',
      value: 0,
      folds,
      currentFoldData: folds.folds[0],
    })).toBe(2);
    expect(getSelectionFilterCount({
      type: 'partition',
      value: 'train',
      folds,
      currentFoldData: folds.folds[0],
    })).toBe(2);
    expect(getSelectionFilterCount({
      type: 'batch',
      value: 'a',
      currentFoldData: null,
      metadata: { batch: ['a', 'b', 'a'] },
    })).toBe(2);
  });
});
