import { describe, expect, it } from 'vitest';

import type { FeatureContribution, SampleExplanationResponse } from '@/types/shap';
import {
  buildShapWaterfallContributions,
  formatShapWaterfallValue,
  getShapWaterfallNextSample,
  getShapWaterfallPreviousSample,
  parseShapWaterfallSampleInput,
} from './shapWaterfallData';

function contribution(overrides: Partial<FeatureContribution> = {}): FeatureContribution {
  return {
    feature_name: 'feature',
    wavelength: null,
    shap_value: 0,
    feature_value: 0,
    cumulative: 0,
    ...overrides,
  };
}

function sampleExplanation(overrides: Partial<SampleExplanationResponse> = {}): SampleExplanationResponse {
  return {
    sample_idx: 0,
    predicted_value: 1.6,
    base_value: 1,
    contributions: [
      contribution({ feature_name: 'neg-small', shap_value: -0.1 }),
      contribution({ feature_name: 'pos-small', shap_value: 0.2 }),
      contribution({ feature_name: 'pos-large', shap_value: 0.5 }),
      contribution({ feature_name: 'neg-large', shap_value: -0.4 }),
    ],
    ...overrides,
  };
}

describe('shapWaterfallData', () => {
  it('keeps the backend contribution order and signed values so the walk reaches the prediction', () => {
    const data = sampleExplanation({
      contributions: [
        contribution({ feature_name: '1400–1450', shap_value: 0.5 }),
        contribution({ feature_name: '1100–1150', shap_value: -0.4 }),
        contribution({ feature_name: 'Other features', shap_value: 0.5 }),
      ],
    });
    const contributions = buildShapWaterfallContributions(data);
    expect(contributions).toEqual([
      { label: '1400–1450', value: 0.5 },
      { label: '1100–1150', value: -0.4 },
      { label: 'Other features', value: 0.5 },
    ]);
    expect(data.base_value + contributions.reduce((sum, item) => sum + item.value, 0)).toBeCloseTo(data.predicted_value);
  });

  it('resolves previous and next sample navigation bounds', () => {
    expect(getShapWaterfallPreviousSample(0)).toBeNull();
    expect(getShapWaterfallPreviousSample(3)).toBe(2);
    expect(getShapWaterfallNextSample(3, 5)).toBe(4);
    expect(getShapWaterfallNextSample(4, 5)).toBeNull();
    expect(getShapWaterfallNextSample(0, 0)).toBeNull();
  });

  it('parses valid sample input and rejects out-of-range values', () => {
    expect(parseShapWaterfallSampleInput('3', 5)).toBe(3);
    expect(parseShapWaterfallSampleInput('3abc', 5)).toBe(3);
    expect(parseShapWaterfallSampleInput('-1', 5)).toBeNull();
    expect(parseShapWaterfallSampleInput('5', 5)).toBeNull();
    expect(parseShapWaterfallSampleInput('abc', 5)).toBeNull();
  });

  it('keeps model outputs distinguishable and small contributions compact', () => {
    expect(formatShapWaterfallValue(12.41763)).toBe('12.4176');
    expect(formatShapWaterfallValue(-0.00661)).toBe('-0.00661');
    expect(formatShapWaterfallValue(0.000724)).toBe('7.24e-4');
  });
});
