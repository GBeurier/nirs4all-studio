import { describe, expect, it } from 'vitest';

import {
  formatBiasVariancePrecise,
  formatBiasVarianceSampleSummary,
  formatBiasVarianceSelectionStatus,
  formatBiasVarianceShare,
  formatBiasVarianceTotal,
  getBiasVarianceEmptyDescription,
} from '@/lib/inspector/biasVariancePresentation';
import { tStub } from './helpers/i18nStub';

describe('inspector bias variance presentation helpers', () => {
  it('formats bias-variance copy and numeric labels', () => {
    expect(getBiasVarianceEmptyDescription(null, tStub)).toBe('inspector.charts.empty.biasVariance');
    expect(getBiasVarianceEmptyDescription('Backend reason', tStub)).toBe('Backend reason');
    expect(formatBiasVarianceTotal(12.345)).toBe('12.35');
    expect(formatBiasVarianceTotal(1.2345)).toBe('1.234');
    expect(formatBiasVarianceTotal(0.12345)).toBe('0.1235');
    expect(formatBiasVariancePrecise(0.1234567)).toBe('0.123457');
    expect(formatBiasVarianceShare(0.1234)).toBe('12.3%');
    expect(formatBiasVarianceSampleSummary({ chainCount: 2, foldCount: 6, sampleCount: 30, t: tStub })).toBe(
      'inspector.counts.chains {"count":2}, inspector.counts.folds {"count":6}, inspector.counts.samples {"count":30}',
    );
    expect(formatBiasVarianceSelectionStatus(false, 0, tStub)).toBe('inspector.charts.noSelection');
    expect(formatBiasVarianceSelectionStatus(true, 3, tStub)).toBe('inspector.counts.selected {"count":3}');
  });
});
