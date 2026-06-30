import { describe, expect, it } from 'vitest';

import {
  FOLD_STABILITY_EMPTY_MESSAGE,
  formatFoldStabilityChainPreview,
  formatFoldStabilityFoldLabel,
  formatFoldStabilityScore,
  getFoldStabilityEmptyMessage,
} from '@/lib/inspector/foldStabilityPresentation';

describe('inspector fold stability presentation helpers', () => {
  it('formats fold stability labels and fallback copy', () => {
    expect(getFoldStabilityEmptyMessage()).toBe(FOLD_STABILITY_EMPTY_MESSAGE);
    expect(formatFoldStabilityChainPreview('short')).toBe('short');
    expect(formatFoldStabilityChainPreview('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijkl…');
    expect(formatFoldStabilityScore(0.123456)).toBe('0.1235');
    expect(formatFoldStabilityFoldLabel(2)).toBe('F3');
  });
});
