import { describe, expect, it } from 'vitest';

import {
  clampInspectorRangeBinCount,
  clampInspectorTopK,
  getInspectorGroupModeOptions,
  getInspectorRangeConfigForColumn,
  getInspectorTopKConfigForScore,
  isInspectorAdvancedGroupMode,
} from '@/lib/inspector/groupBuilder';

describe('inspector group builder helpers', () => {
  it('separates primary and advanced group modes', () => {
    expect(getInspectorGroupModeOptions(false).map(option => option.value)).toEqual([
      'by_variable',
      'by_top_k',
    ]);
    expect(getInspectorGroupModeOptions(true).map(option => option.value)).toEqual([
      'by_variable',
      'by_top_k',
      'by_range',
      'by_branch',
      'by_expression',
    ]);
    expect(isInspectorAdvancedGroupMode('by_expression')).toBe(true);
    expect(isInspectorAdvancedGroupMode('by_variable')).toBe(false);
  });

  it('clamps numeric group configuration inputs', () => {
    expect(clampInspectorRangeBinCount(1)).toBe(2);
    expect(clampInspectorRangeBinCount(99)).toBe(20);
    expect(clampInspectorRangeBinCount(Number.NaN)).toBe(5);
    expect(clampInspectorTopK(0)).toBe(5);
    expect(clampInspectorTopK(150)).toBe(100);
    expect(clampInspectorTopK(Number.NaN)).toBe(5);
  });

  it('preserves existing range and top-k config defaults', () => {
    expect(getInspectorRangeConfigForColumn('cv_val_score')).toEqual({
      column: 'cv_val_score',
      binCount: 5,
    });
    expect(getInspectorRangeConfigForColumn('cv_val_score', {
      column: 'final_test_score',
      binCount: 8,
    })).toEqual({
      column: 'final_test_score',
      binCount: 8,
    });
    expect(getInspectorTopKConfigForScore('cv_test_score', {
      scoreColumn: 'final_train_score',
      k: 12,
    })).toEqual({
      scoreColumn: 'final_train_score',
      k: 12,
    });
  });
});
