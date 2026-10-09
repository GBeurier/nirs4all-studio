import { describe, expect, it } from 'vitest';

import {
  formatHyperparameterTrendCorrelation,
  formatHyperparameterTrendSlope,
  getHyperparameterAvailableParamTags,
  getHyperparameterEmptyDescription,
  getHyperparameterScaleDescription,
  getHyperparameterSelectionSummary,
} from '@/lib/inspector/hyperparameterSensitivityPresentation';
import { tStub } from './helpers/i18nStub';

describe('inspector hyperparameter sensitivity presentation helpers', () => {
  it('derives empty-state and scale descriptions', () => {
    expect(getHyperparameterEmptyDescription(null, tStub)).toBe('inspector.charts.empty.hyperparameter');
    expect(getHyperparameterEmptyDescription(' No numeric params ', tStub)).toBe('No numeric params');
    expect(getHyperparameterScaleDescription(false, true, tStub)).toBe('inspector.charts.hyperparameter.linearActive');
    expect(getHyperparameterScaleDescription(true, true, tStub)).toBe('inspector.charts.hyperparameter.logActive');
    expect(getHyperparameterScaleDescription(false, false, tStub)).toContain('inspector.charts.hyperparameter.logDisabled');
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
    expect(formatHyperparameterTrendSlope(trend, tStub)).toBe('inspector.charts.hyperparameter.slope {"value":"0.1235"}');
    expect(formatHyperparameterTrendCorrelation(trend)).toBe('r -0.988');
    expect(getHyperparameterSelectionSummary(false, 0, tStub)).toBe('inspector.charts.noSelection');
    expect(getHyperparameterSelectionSummary(true, 3, tStub)).toBe('inspector.counts.selected {"count":3}');
  });
});
