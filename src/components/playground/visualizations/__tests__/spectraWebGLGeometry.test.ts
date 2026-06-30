import { describe, expect, it } from 'vitest';

import {
  computeSpectraDecimation,
  decimateSpectraPoints,
  normalizeSpectraValue,
} from '../spectraWebGLGeometry';

function toRoundedArray(values: Float32Array) {
  return Array.from(values, value => Number(value.toFixed(4)));
}

describe('spectraWebGLGeometry', () => {
  it('normalizes invalid and degenerate values to the midpoint', () => {
    expect(normalizeSpectraValue(Number.NaN, 0, 1)).toBe(0.5);
    expect(normalizeSpectraValue(10, 2, 2)).toBe(0.5);
    expect(normalizeSpectraValue(5, 0, 10)).toBe(0.5);
  });

  it('filters points to the visible x range and normalizes coordinates', () => {
    const points = decimateSpectraPoints(
      [100, 110, 120, 130],
      [0, 2, 4, 6],
      10,
      [110, 130],
      [0, 6]
    );

    expect(toRoundedArray(points)).toEqual([
      0, 0.3333,
      0.5, 0.6667,
      1, 1,
    ]);
  });

  it('applies LTTB decimation while preserving first and last visible points', () => {
    const points = decimateSpectraPoints(
      [0, 1, 2, 3, 4],
      [0, 8, 1, 7, 0],
      3,
      [0, 4],
      [0, 8]
    );

    expect(points).toHaveLength(6);
    expect(points[0]).toBe(0);
    expect(points[1]).toBe(0);
    expect(points[4]).toBe(1);
    expect(points[5]).toBe(0);
  });

  it('combines processed and original spectra with stable metadata offsets', () => {
    const result = computeSpectraDecimation(
      [
        [0, 1, 2],
        [2, 1, 0],
      ],
      [
        [1, 2, 3],
        [3, 2, 1],
      ],
      [10, 20, 30],
      [1, 0],
      [10, 30],
      [0, 3],
      10
    );

    expect(result.metadata).toEqual([
      { index: 1, isOriginal: false, pointCount: 3, offset: 0 },
      { index: 0, isOriginal: false, pointCount: 3, offset: 6 },
      { index: 1, isOriginal: true, pointCount: 3, offset: 12 },
      { index: 0, isOriginal: true, pointCount: 3, offset: 18 },
    ]);
    expect(result.allPoints).toHaveLength(24);
  });
});
