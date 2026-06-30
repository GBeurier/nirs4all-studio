import { describe, expect, it } from 'vitest';

import {
  buildSpectraWebGLGroupedAreaEntries,
  type SpectraWebGLAreaStats,
} from '../spectraWebGLAreaEntries';

const stats: SpectraWebGLAreaStats = {
  mean: [1, 2],
  median: [1.1, 2.1],
  min: [0.5, 1.5],
  max: [1.5, 2.5],
  std: [0.2, 0.3],
  quantileLower: [0.8, 1.8],
  quantileUpper: [1.2, 2.2],
};

describe('buildSpectraWebGLGroupedAreaEntries', () => {
  it('preserves group order and cycles colors by group index', () => {
    const entries = buildSpectraWebGLGroupedAreaEntries(
      new Map([
        ['train', stats],
        ['validation', stats],
        ['test', stats],
      ]),
      ['red', 'blue']
    );

    expect(entries.map(entry => entry.label)).toEqual(['train', 'validation', 'test']);
    expect(entries.map(entry => entry.color)).toEqual(['red', 'blue', 'red']);
    expect(entries.every(entry => entry.stats === stats)).toBe(true);
  });

  it('uses a stable fallback color when no palette is provided', () => {
    const entries = buildSpectraWebGLGroupedAreaEntries(
      new Map([['train', stats]]),
      []
    );

    expect(entries).toEqual([
      {
        label: 'train',
        stats,
        color: 'hsl(217, 70%, 50%)',
      },
    ]);
  });
});
