import { describe, expect, it } from 'vitest';

import { getCombinedGroupingNote } from '../visualizations/FoldDistributionChartV2';
import type { FoldsInfo } from '@/types/playground';

describe('getCombinedGroupingNote', () => {
  const combinedFolds: FoldsInfo = {
    splitter_name: 'KFold',
    n_folds: 5,
    folds: [],
    repetition_column: 'ID',
    group_by: 'Nlevel',
    effective_group_mode: 'combined',
    effective_group_label: 'ID + Nlevel',
  };

  it('returns the combined-constraints note when coloring by the runtime group_by column', () => {
    expect(getCombinedGroupingNote(combinedFolds, 'metadata', 'Nlevel')).toBe(
      'Splits enforce combined constraints (ID + Nlevel). Samples sharing either the dataset repetition or Nlevel stay in the same fold.',
    );
  });

  it('returns null when grouping is not combined', () => {
    expect(
      getCombinedGroupingNote(
        {
          ...combinedFolds,
          effective_group_mode: 'repetition_only',
          effective_group_label: 'ID',
        },
        'metadata',
        'Nlevel',
      ),
    ).toBeNull();
  });

  it('returns null when metadata coloring is not using the runtime group_by column', () => {
    expect(getCombinedGroupingNote(combinedFolds, 'metadata', 'Replicate')).toBeNull();
    expect(getCombinedGroupingNote(combinedFolds, 'partition', 'Nlevel')).toBeNull();
  });
});
