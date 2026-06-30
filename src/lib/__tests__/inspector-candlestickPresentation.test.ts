import { describe, expect, it } from 'vitest';

import {
  formatCandlestickCount,
  formatCandlestickIqr,
  formatCandlestickLabel,
  formatCandlestickScore,
  formatCandlestickTick,
  getCandlestickEmptyMessage,
} from '@/lib/inspector/candlestickPresentation';

describe('inspector candlestick presentation helpers', () => {
  it('formats candlestick labels and numeric display values', () => {
    expect(getCandlestickEmptyMessage()).toBe('No box plot data available.');
    expect(formatCandlestickLabel('short')).toBe('short');
    expect(formatCandlestickLabel('very-long-candlestick-category')).toBe('very-long-candlest\u2026');
    expect(formatCandlestickTick(0.123456)).toBe('0.123');
    expect(formatCandlestickScore(0.123456)).toBe('0.1235');
    expect(formatCandlestickIqr(0.1, 0.42)).toBe('0.3200');
    expect(formatCandlestickCount(8)).toBe('n = 8');
  });
});
