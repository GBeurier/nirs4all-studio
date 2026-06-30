import { describe, expect, it } from 'vitest';

import type { FeatureContribution, SampleExplanationResponse } from '@/types/shap';
import {
  buildShapWaterfallBars,
  getShapWaterfallBarStyle,
  getShapWaterfallNextSample,
  getShapWaterfallPreviousSample,
  parseShapWaterfallSampleInput,
  sortShapWaterfallContributions,
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
  it('sorts contributions by sign first, then absolute magnitude', () => {
    expect(sortShapWaterfallContributions(sampleExplanation().contributions).map(item => item.feature_name)).toEqual([
      'pos-large',
      'pos-small',
      'neg-large',
      'neg-small',
    ]);
  });

  it('builds cumulative waterfall bars with base and final markers', () => {
    expect(buildShapWaterfallBars(sampleExplanation())).toEqual([
      {
        name: 'Base Value',
        start: 0,
        end: 1,
        value: 1,
        isPositive: true,
        isBase: true,
        isFinal: false,
      },
      {
        name: 'pos-large',
        start: 1,
        end: 1.5,
        value: 0.5,
        isPositive: true,
        isBase: false,
        isFinal: false,
      },
      {
        name: 'pos-small',
        start: 1.5,
        end: 1.7,
        value: 0.2,
        isPositive: true,
        isBase: false,
        isFinal: false,
      },
      {
        name: 'neg-large',
        start: 1.7,
        end: 1.2999999999999998,
        value: -0.4,
        isPositive: false,
        isBase: false,
        isFinal: false,
      },
      {
        name: 'neg-small',
        start: 1.2999999999999998,
        end: 1.1999999999999997,
        value: -0.1,
        isPositive: false,
        isBase: false,
        isFinal: false,
      },
      {
        name: 'Prediction',
        start: 0,
        end: 1.6,
        value: 1.6,
        isPositive: true,
        isBase: false,
        isFinal: true,
      },
    ]);
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

  it('maps waterfall bars to the existing fill styles', () => {
    expect(getShapWaterfallBarStyle({ isBase: true, isFinal: false, isPositive: true })).toEqual({
      fill: 'hsl(var(--muted-foreground))',
      fillOpacity: 0.8,
    });
    expect(getShapWaterfallBarStyle({ isBase: false, isFinal: true, isPositive: true })).toEqual({
      fill: 'hsl(var(--primary))',
      fillOpacity: 0.8,
    });
    expect(getShapWaterfallBarStyle({ isBase: false, isFinal: false, isPositive: true })).toEqual({
      fill: '#22c55e',
      fillOpacity: 0.7,
    });
    expect(getShapWaterfallBarStyle({ isBase: false, isFinal: false, isPositive: false })).toEqual({
      fill: '#ef4444',
      fillOpacity: 0.7,
    });
  });
});
