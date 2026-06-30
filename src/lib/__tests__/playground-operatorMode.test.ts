import { describe, expect, it } from 'vitest';

import { isPlaygroundRawDataMode } from '@/lib/playground/operatorMode';

describe('playground operator mode helpers', () => {
  it('treats missing operator lists as raw data mode', () => {
    expect(isPlaygroundRawDataMode(undefined)).toBe(true);
    expect(isPlaygroundRawDataMode(null)).toBe(true);
  });

  it('treats empty operator lists as raw data mode', () => {
    expect(isPlaygroundRawDataMode([])).toBe(true);
  });

  it('treats disabled or legacy sparse operators as raw data mode', () => {
    expect(isPlaygroundRawDataMode([
      { enabled: false },
      {},
    ])).toBe(true);
  });

  it('leaves raw data mode when any operator is enabled', () => {
    expect(isPlaygroundRawDataMode([
      { enabled: false },
      { enabled: true },
    ])).toBe(false);
  });
});
