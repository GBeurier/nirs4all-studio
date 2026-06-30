import { describe, expect, it } from 'vitest';

import { buildSpectraWebGLAxisTicks } from '../spectraWebGLAxisTicks';

describe('buildSpectraWebGLAxisTicks', () => {
  it('builds evenly spaced tick positions and labels across a range', () => {
    expect(buildSpectraWebGLAxisTicks([1000, 1100], 6)).toEqual([
      { position: 0, label: 1000 },
      { position: 0.2, label: 1020 },
      { position: 0.4, label: 1040 },
      { position: 0.6, label: 1060 },
      { position: 0.8, label: 1080 },
      { position: 1, label: 1100 },
    ]);
  });

  it('supports descending ranges for zoomed axes', () => {
    expect(buildSpectraWebGLAxisTicks([2, -2], 5)).toEqual([
      { position: 0, label: 2 },
      { position: 0.25, label: 1 },
      { position: 0.5, label: 0 },
      { position: 0.75, label: -1 },
      { position: 1, label: -2 },
    ]);
  });

  it('handles empty and single-tick requests without division by zero', () => {
    expect(buildSpectraWebGLAxisTicks([10, 20], 0)).toEqual([]);
    expect(buildSpectraWebGLAxisTicks([10, 20], 1)).toEqual([
      { position: 0, label: 10 },
    ]);
  });
});
