import { describe, expect, it } from 'vitest';

import {
  generateExportFilename,
  getExportTimestamp,
} from '@/lib/playground/exportDownload';

describe('playground export download helpers', () => {
  it('formats stable export timestamps for filenames', () => {
    expect(getExportTimestamp(new Date('2026-06-29T14:05:06Z'))).toBe('20260629_140506');
  });

  it('generates filenames with or without timestamps', () => {
    const now = new Date('2026-06-29T14:05:06Z');

    expect(generateExportFilename('spectra', 'csv', true, now)).toBe('spectra_20260629_140506.csv');
    expect(generateExportFilename('spectra', 'csv', false, now)).toBe('spectra.csv');
  });
});
