import { describe, expect, it } from 'vitest';

import {
  formatHyperparameterTrendCorrelation,
  formatHyperparameterTrendSlope,
  getHyperparameterAvailableParamTags,
  getHyperparameterEmptyDescription,
  getHyperparameterScaleDescription,
  getHyperparameterSelectionSummary,
  HYPERPARAMETER_EMPTY_DESCRIPTION,
} from '@/lib/inspector/hyperparameterSensitivityPresentation';

describe('inspector hyperparameter sensitivity presentation helpers', () => {
  it('derives empty-state and scale descriptions', () => {
    expect(getHyperparameterEmptyDescription(null)).toBe(HYPERPARAMETER_EMPTY_DESCRIPTION);
    expect(getHyperparameterEmptyDescription(' No numeric params ')).toBe('No numeric params');
    expect(getHyperparameterScaleDescription(false, true)).toBe('Linear scale is active.');
    expect(getHyperparameterScaleDescription(true, true)).toBe('Log scale is active.');
    expect(getHyperparameterScaleDescription(false, false)).toContain('Log scale is disabled');
  });

  it('splits available parameters into visible chips and overflow', () => {
    expect(getHyperparameterAvailableParamTags(['a', 'b', 'c'], 2)).toEqual({
      visibleParams: ['a', 'b'],
      overflowCount: 1,
    });
    expect(getHyperparameterAvailableParamTags(null)).toEqual({
      visibleParams: [],
      overflowCount: 0,
    });
  });

  it('formats trend and selection labels', () => {
    const trend = { slope: 0.123456, intercept: 1, r: -0.98765 };
    expect(formatHyperparameterTrendSlope(trend)).toBe('slope 0.1235');
    expect(formatHyperparameterTrendCorrelation(trend)).toBe('r -0.988');
    expect(getHyperparameterSelectionSummary(false, 0)).toBe('No selection');
    expect(getHyperparameterSelectionSummary(true, 3)).toBe('3 selected');
  });
});
