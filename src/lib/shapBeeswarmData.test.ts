import { describe, expect, it } from 'vitest';

import type { BeeswarmBin } from '@/types/shap';
import { buildShapBeeswarmFeatures } from './shapBeeswarmData';

function beeswarmBin(label: string, points: BeeswarmBin['points']): BeeswarmBin {
  return { label, center: 0, start_wavelength: 0, end_wavelength: 1, points };
}

describe('shapBeeswarmData', () => {
  it('keeps backend row order, signed SHAP values and sample identities', () => {
    const bins = [
      beeswarmBin('1400–1450', [
        { sample_idx: 2, shap_value: -0.25, feature_value: 0.1 },
        { sample_idx: 5, shap_value: 0.4, feature_value: 0.9 },
      ]),
      beeswarmBin('1100–1150', [{ sample_idx: 2, shap_value: 0.01, feature_value: 0.5 }]),
    ];
    expect(buildShapBeeswarmFeatures(bins)).toEqual([
      {
        label: '1400–1450',
        points: [
          { shap: -0.25, featureValue: 0.1, sampleId: 2 },
          { shap: 0.4, featureValue: 0.9, sampleId: 5 },
        ],
      },
      { label: '1100–1150', points: [{ shap: 0.01, featureValue: 0.5, sampleId: 2 }] },
    ]);
  });

  it('limits rows to the strongest backend bins when requested', () => {
    const bins = ['a', 'b', 'c'].map((label) => beeswarmBin(label, []));
    expect(buildShapBeeswarmFeatures(bins, 2).map((feature) => feature.label)).toEqual(['a', 'b']);
  });
});
