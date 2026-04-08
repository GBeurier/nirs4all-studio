import { describe, expect, it } from 'vitest';

import { getPartitionIndices } from '../PartitionSelector';
import type { FoldsInfo } from '@/types/playground';

describe('getPartitionIndices', () => {
  it('keeps held-out test samples visible when CV folds cover only the train subset', () => {
    const folds: FoldsInfo = {
      splitter_name: 'KFold',
      n_folds: 3,
      kind: 'cv_folds',
      fold_labels: [0, 0, 1, 1, 2, 2, -1, -1],
      folds: [
        {
          fold_index: 0,
          train_count: 4,
          test_count: 2,
          train_indices: [2, 3, 4, 5],
          test_indices: [0, 1],
        },
        {
          fold_index: 1,
          train_count: 4,
          test_count: 2,
          train_indices: [0, 1, 4, 5],
          test_indices: [2, 3],
        },
        {
          fold_index: 2,
          train_count: 4,
          test_count: 2,
          train_indices: [0, 1, 2, 3],
          test_indices: [4, 5],
        },
      ],
    };

    expect(getPartitionIndices('train', folds, 8)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(getPartitionIndices('test', folds, 8)).toEqual([6, 7]);
    expect(getPartitionIndices('oof', folds, 8)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('falls back to fold test samples when there is no held-out partition', () => {
    const folds: FoldsInfo = {
      splitter_name: 'KFold',
      n_folds: 3,
      kind: 'cv_folds',
      fold_labels: [0, 0, 1, 1, 2, 2],
      folds: [
        {
          fold_index: 0,
          train_count: 4,
          test_count: 2,
          train_indices: [2, 3, 4, 5],
          test_indices: [0, 1],
        },
        {
          fold_index: 1,
          train_count: 4,
          test_count: 2,
          train_indices: [0, 1, 4, 5],
          test_indices: [2, 3],
        },
        {
          fold_index: 2,
          train_count: 4,
          test_count: 2,
          train_indices: [0, 1, 2, 3],
          test_indices: [4, 5],
        },
      ],
    };

    expect(getPartitionIndices('test', folds, 6)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
