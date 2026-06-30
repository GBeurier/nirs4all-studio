import { describe, expect, it } from 'vitest';

import type { OperatorParamInfo } from '@/types/playground';

import {
  coerceWindowLengthValue,
  formatNumericParamDisplayValue,
  formatParamDisplayName,
  getNumericParamConfig,
  getVisibleParamEntries,
  normalizeNumericParamValue,
} from '../UnifiedOperatorCardParamsData';
import { getFilterStatsBadgeViewModel } from '../UnifiedOperatorCardViewData';

describe('UnifiedOperatorCardParamsData', () => {
  it('keeps only user-facing parameter definitions', () => {
    const paramDefs: Record<string, OperatorParamInfo> = {
      n_splits: { required: false, type: 'int' },
      _internal_seed: { required: false, type: 'int' },
      expert_mode: { required: false, isAdvanced: true },
      values_to_keep: { required: false, type: 'array' },
    };

    expect(getVisibleParamEntries(paramDefs).map(([key]) => key)).toEqual([
      'n_splits',
      'values_to_keep',
    ]);
  });

  it('formats parameter labels without needing React rendering', () => {
    expect(formatParamDisplayName('values_to_keep')).toBe('Values To Keep');
    expect(formatParamDisplayName('window_length')).toBe('Window Length');
  });

  it('derives numeric slider config from definitions before fallbacks', () => {
    expect(getNumericParamConfig('window_length', { required: false, type: 'int' }, true)).toEqual({
      min: 3,
      max: 51,
      step: 2,
    });

    expect(getNumericParamConfig('custom_ratio', {
      required: false,
      type: 'float',
      min: -1,
      max: 2,
      step: 0.25,
    }, false)).toEqual({
      min: -1,
      max: 2,
      step: 0.25,
    });
  });

  it('normalizes and displays numeric values with the card rules', () => {
    expect(normalizeNumericParamValue(undefined, true, 3)).toBe(3);
    expect(normalizeNumericParamValue(null, false, 0.1)).toBe(0);
    expect(normalizeNumericParamValue(0.42, false, 0)).toBe(0.42);

    expect(coerceWindowLengthValue('window_length', 10)).toBe(11);
    expect(coerceWindowLengthValue('polyorder', 2)).toBe(2);

    expect(formatNumericParamDisplayValue(undefined, true)).toBe('-');
    expect(formatNumericParamDisplayValue(4.6, true)).toBe('5');
    expect(formatNumericParamDisplayValue(0.1234, false)).toBe('0.12');
  });
});

describe('UnifiedOperatorCardViewData', () => {
  it('hides filter stats when the operator is not an active filter stat case', () => {
    expect(getFilterStatsBadgeViewModel({
      isFilter: false,
      filterStats: { removed_count: 3 },
    })).toBeNull();
    expect(getFilterStatsBadgeViewModel({
      isFilter: true,
      filterStats: { removed_count: 0 },
    })).toBeNull();
  });

  it('builds the tagged stats badge copy', () => {
    expect(getFilterStatsBadgeViewModel({
      isFilter: true,
      filterStats: {
        removed_count: 2,
        mode: 'tag',
        reason: 'high leverage',
      },
    })).toMatchObject({
      variant: 'outline',
      label: '2 tagged',
      tooltip: '2 samples tagged as outliers (visible in charts): high leverage',
    });
  });

  it('builds the removed stats badge copy', () => {
    expect(getFilterStatsBadgeViewModel({
      isFilter: true,
      filterStats: {
        removed_count: 1,
        mode: 'remove',
      },
    })).toMatchObject({
      variant: 'destructive',
      label: '1 removed',
      tooltip: '1 sample filtered out',
    });
  });
});
