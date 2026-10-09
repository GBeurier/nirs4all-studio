import { describe, expect, it } from 'vitest';

import {
  formatFoldStabilityChainPreview,
  formatFoldStabilityFoldLabel,
  formatFoldStabilityScore,
  getFoldStabilityEmptyMessage,
} from '@/lib/inspector/foldStabilityPresentation';
import { tStub } from './helpers/i18nStub';

describe('inspector fold stability presentation helpers', () => {
  it('formats fold stability labels and fallback copy', () => {
    expect(getFoldStabilityEmptyMessage(tStub)).toBe('inspector.charts.empty.foldStability');
    expect(formatFoldStabilityChainPreview('short')).toBe('short');
    expect(formatFoldStabilityChainPreview('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijkl…');
    expect(formatFoldStabilityScore(0.123456)).toBe('0.1235');
    expect(formatFoldStabilityFoldLabel(2)).toBe('F3');
  });
});
