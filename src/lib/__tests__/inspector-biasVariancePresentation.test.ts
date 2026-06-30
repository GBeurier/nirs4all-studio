import { describe, expect, it } from 'vitest';

import {
  formatBiasVariancePrecise,
  formatBiasVarianceSampleSummary,
  formatBiasVarianceSelectionStatus,
  formatBiasVarianceShare,
  formatBiasVarianceTotal,
  getBiasVarianceEmptyDescription,
} from '@/lib/inspector/biasVariancePresentation';

describe('inspector bias variance presentation helpers', () => {
  it('formats bias-variance copy and numeric labels', () => {
    expect(getBiasVarianceEmptyDescription(null)).toBe('This view needs chains with repeated fold-level predictions for the same samples.');
    expect(getBiasVarianceEmptyDescription('Backend reason')).toBe('Backend reason');
    expect(formatBiasVarianceTotal(12.345)).toBe('12.35');
    expect(formatBiasVarianceTotal(1.2345)).toBe('1.234');
    expect(formatBiasVarianceTotal(0.12345)).toBe('0.1235');
    expect(formatBiasVariancePrecise(0.1234567)).toBe('0.123457');
    expect(formatBiasVarianceShare(0.1234)).toBe('12.3%');
    expect(formatBiasVarianceSampleSummary({ chainCount: 2, foldCount: 6, sampleCount: 30 })).toBe('2 chains, 6 folds, 30 samples');
    expect(formatBiasVarianceSelectionStatus(false, 0)).toBe('No selection');
    expect(formatBiasVarianceSelectionStatus(true, 3)).toBe('3 selected');
  });
});
