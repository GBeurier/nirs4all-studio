import { describe, expect, it } from 'vitest';

import {
  getBranchComparisonEmptyMessage,
  formatBranchComparisonChainCount,
  formatBranchComparisonConfidenceInterval,
  formatBranchComparisonCountBadge,
  formatBranchComparisonLabel,
  formatBranchComparisonScore,
  formatBranchComparisonTick,
} from '@/lib/inspector/branchComparisonPresentation';

describe('inspector branch comparison presentation helpers', () => {
  it('formats branch comparison labels and numeric display values', () => {
    expect(getBranchComparisonEmptyMessage()).toBe('No branch comparison data available.');
    expect(formatBranchComparisonLabel('short')).toBe('short');
    expect(formatBranchComparisonLabel('very-long-branch-label')).toBe('very-long-bran\u2026');
    expect(formatBranchComparisonTick(0.123456)).toBe('0.123');
    expect(formatBranchComparisonScore(0.123456)).toBe('0.1235');
    expect(formatBranchComparisonCountBadge(12)).toBe('n=12');
    expect(formatBranchComparisonChainCount(12)).toBe('Chains: 12');
    expect(formatBranchComparisonConfidenceInterval(0.123456, 0.987654)).toBe('CI: [0.1235, 0.9877]');
  });
});
