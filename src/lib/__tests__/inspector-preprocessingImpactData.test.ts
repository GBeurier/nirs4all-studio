import { describe, expect, it } from 'vitest';

import {
  buildPreprocessingImpactBars,
  formatSignedPreprocessingImpact,
  getPreprocessingImpactBarColor,
  PREPROCESSING_IMPACT_NEGATIVE_COLOR,
  PREPROCESSING_IMPACT_POSITIVE_COLOR,
} from '@/lib/inspector/preprocessingImpactData';
import type { PreprocessingImpactResponse } from '@/types/inspector';

describe('inspector preprocessing impact data helpers', () => {
  it('maps backend entries to chart bars with numeric fallbacks', () => {
    const data: PreprocessingImpactResponse = {
      score_column: 'cv_val_score',
      total_chains: 4,
      entries: [
        {
          step_name: 'SNV',
          impact: 0,
          mean_with: 0,
          mean_without: 0.31,
          count_with: 2,
          count_without: 2,
        },
      ],
    };

    expect(buildPreprocessingImpactBars(data)).toEqual([
      {
        name: 'SNV',
        impact: 0,
        meanWith: 0,
        meanWithout: 0.31,
        countWith: 2,
        countWithout: 2,
      },
    ]);
    expect(buildPreprocessingImpactBars(null)).toEqual([]);
  });

  it('formats signed impacts and maps colors by direction', () => {
    expect(formatSignedPreprocessingImpact(0.12345)).toBe('+0.1235');
    expect(formatSignedPreprocessingImpact(-0.12345)).toBe('-0.1235');
    expect(getPreprocessingImpactBarColor(0)).toBe(PREPROCESSING_IMPACT_POSITIVE_COLOR);
    expect(getPreprocessingImpactBarColor(-0.1)).toBe(PREPROCESSING_IMPACT_NEGATIVE_COLOR);
  });
});
