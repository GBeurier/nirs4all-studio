import { describe, expect, it } from 'vitest';

import {
  buildPartitionSelectorData,
  getPartitionCurrentCount,
} from '@/lib/playground/partitionSelectorData';
import type { PartitionCounts } from '@/lib/playground/partitionFilters';
import type { FoldsInfo } from '@/types/playground';

const folds: FoldsInfo = {
  splitter_name: 'KFold',
  n_folds: 2,
  split_index: 0,
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

describe('partition selector data helpers', () => {
  it('builds a compact no-fold display model', () => {
    expect(buildPartitionSelectorData({
      value: 'all',
      folds: null,
      totalSamples: 12,
      compact: true,
    })).toMatchObject({
      counts: { all: 12 },
      hasFolds: false,
      isKFold: false,
      emptyLabel: 'All',
      triggerLabel: 'All',
      currentCount: 12,
      showCurrentCount: false,
      foldOptions: [],
    });
  });

  it('builds basic, OOF, and individual fold options for k-fold data', () => {
    const data = buildPartitionSelectorData({
      value: 'fold-1',
      folds,
      totalSamples: 5,
      compact: false,
    });

    expect(data.basicOptions).toEqual([
      { value: 'all', label: 'All Samples', count: 5 },
      { value: 'train', label: 'Train', count: 4 },
      { value: 'test', label: 'Test', count: 1 },
    ]);
    expect(data.oofOption).toEqual({
      value: 'oof',
      label: 'OOF (All Test)',
      count: 4,
    });
    expect(data.foldOptions).toEqual([
      { value: 'fold-0', label: 'Fold 1', foldIndex: 0, trainCount: 2, testCount: 2 },
      { value: 'fold-1', label: 'Fold 2', foldIndex: 1, trainCount: 2, testCount: 2 },
    ]);
    expect(data.currentCount).toBe(4);
    expect(data.showCurrentCount).toBe(true);
  });

  it('resolves current counts for all supported partition values', () => {
    const counts: PartitionCounts = {
      all: 10,
      train: 6,
      test: 4,
      oof: 8,
      folds: {
        2: { train: 3, test: 2, total: 5 },
      },
    };

    expect(getPartitionCurrentCount('all', counts)).toBe(10);
    expect(getPartitionCurrentCount('train', counts)).toBe(6);
    expect(getPartitionCurrentCount('test', counts)).toBe(4);
    expect(getPartitionCurrentCount('train-test', counts)).toBe(6);
    expect(getPartitionCurrentCount('oof', counts)).toBe(8);
    expect(getPartitionCurrentCount('fold-2', counts)).toBe(5);
    expect(getPartitionCurrentCount('fold-9', counts)).toBe(0);
  });
});
