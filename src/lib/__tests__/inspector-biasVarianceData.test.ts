import { describe, expect, it } from 'vitest';

import {
  buildBiasVarianceBars,
  getBiasVarianceSelectionMode,
  sumBiasVarianceTotals,
} from '@/lib/inspector/biasVarianceData';
import type { BiasVarianceResponse } from '@/types/inspector';

describe('inspector bias variance data helpers', () => {
  it('normalizes entries, computes shares, and sums totals', () => {
    const data: BiasVarianceResponse = {
      score_column: 'cv_val_score',
      group_by: 'model_class',
      entries: [
        {
          group_label: 'PLS',
          bias_squared: 0.2,
          variance: 0.3,
          total_error: 0.5,
          n_chains: 2,
          n_folds: 6,
          n_samples: 30,
          chain_ids: ['a', 'b'],
        },
        {
          group_label: 'Ridge',
          bias_squared: 0.1,
          variance: 0.2,
          total_error: null as unknown as number,
          n_chains: 1,
          n_folds: 3,
          n_samples: 12,
          chain_ids: null as unknown as string[],
        },
      ],
    };

    const bars = buildBiasVarianceBars(data);
    expect(bars).toEqual([
      {
        group_label: 'PLS',
        bias_squared: 0.2,
        variance: 0.3,
        total_error: 0.5,
        n_chains: 2,
        n_folds: 6,
        n_samples: 30,
        chain_ids: ['a', 'b'],
        bias_share: 0.4,
        variance_share: 0.6,
      },
      {
        group_label: 'Ridge',
        bias_squared: 0.1,
        variance: 0.2,
        total_error: 0.30000000000000004,
        n_chains: 1,
        n_folds: 3,
        n_samples: 12,
        chain_ids: [],
        bias_share: 0.3333333333333333,
        variance_share: 0.6666666666666666,
      },
    ]);
    expect(sumBiasVarianceTotals(bars)).toEqual({
      totalBias: 0.30000000000000004,
      totalVariance: 0.5,
      totalError: 0.8,
    });
  });

  it('derives selection mode', () => {
    expect(getBiasVarianceSelectionMode({ chain_ids: [] }, new Set())).toBeNull();
    expect(getBiasVarianceSelectionMode({ chain_ids: ['a', 'b'] }, new Set(['a']))).toBe('add');
    expect(getBiasVarianceSelectionMode({ chain_ids: ['a', 'b'] }, new Set(['a', 'b']))).toBe('remove');
  });
});
