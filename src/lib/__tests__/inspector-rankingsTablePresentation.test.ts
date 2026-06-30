import { describe, expect, it } from 'vitest';

import {
  formatRankingModelLabel,
  formatRankingOptionalText,
  formatRankingScore,
  getRankingsTableEmptyMessage,
  RANKINGS_TABLE_COLUMNS,
} from '@/lib/inspector/rankingsTablePresentation';

describe('inspector rankings table presentation helpers', () => {
  it('formats ranking table columns and cell labels', () => {
    expect(getRankingsTableEmptyMessage()).toBe('No ranking data available.');
    expect(RANKINGS_TABLE_COLUMNS.map((column) => column.field)).toEqual([
      'rank',
      'model_class',
      'preprocessings',
      'cv_val_score',
      'cv_test_score',
      'final_test_score',
      'cv_fold_count',
      'dataset_name',
    ]);
    expect(formatRankingScore(0.123456)).toBe('0.1235');
    expect(formatRankingScore(null)).toBe('—');
    expect(formatRankingModelLabel({ model_name: 'PLS tuned', model_class: 'PLS' })).toBe('PLS tuned');
    expect(formatRankingModelLabel({ model_name: null, model_class: 'PLS' })).toBe('PLS');
    expect(formatRankingOptionalText('SNV')).toBe('SNV');
    expect(formatRankingOptionalText(null)).toBe('—');
  });
});
