import { describe, expect, it } from 'vitest';

import { buildFoldsTxt } from '@/lib/playground/exportFolds';
import type { FoldsInfo } from '@/types/playground';

describe('playground folds TXT export builder', () => {
  it('builds nirs4all fold TXT content with fold labels', () => {
    const folds: FoldsInfo = {
      splitter_name: 'KFold',
      n_folds: 2,
      folds: [
        { fold_index: 0, train_count: 2, test_count: 1, train_indices: [1, 2], test_indices: [0] },
        { fold_index: 1, train_count: 2, test_count: 1, train_indices: [0, 2], test_indices: [1] },
      ],
      fold_labels: [0, 1, -1],
    };

    expect(buildFoldsTxt(folds, {
      generatedAt: '2026-06-02T00:00:00.000Z',
    })).toEqual({
      success: true,
      content: [
        '# nirs4all folds export',
        '# Splitter: KFold',
        '# Folds: 2',
        '# Generated: 2026-06-02T00:00:00.000Z',
        '',
        '# Fold 1',
        'fold_1_train:1,2',
        'fold_1_test:0',
        '',
        '# Fold 2',
        'fold_2_train:0,2',
        'fold_2_test:1',
        '',
        '# Fold labels (sample_index -> fold_number)',
        '0:0',
        '1:1',
        '2:-1',
      ].join('\n'),
    });
  });

  it('returns a data error when no folds are available', () => {
    expect(buildFoldsTxt({
      splitter_name: 'None',
      n_folds: 0,
      folds: [],
    })).toEqual({
      success: false,
      error: 'No folds data to export',
    });
  });
});
