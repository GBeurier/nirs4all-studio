import { describe, expect, it } from 'vitest';

import {
  buildSpectraWebGLLines,
  getSpectraTargetColor,
} from '../spectraWebGLLines';

function toRoundedArray(values: Float32Array) {
  return Array.from(values, value => Number(value.toFixed(4)));
}

describe('spectraWebGLLines', () => {
  it('returns no line data when decimation metadata is empty', () => {
    expect(buildSpectraWebGLLines({
      decimation: { allPoints: new Float32Array(), metadata: [] },
      yTargetMin: 0,
      yTargetMax: 1,
      baseColor: '#3b82f6',
    })).toEqual([]);
  });

  it('builds line slices and applies processed/original color precedence', () => {
    const lines = buildSpectraWebGLLines({
      decimation: {
        allPoints: new Float32Array([
          0, 0,
          0.5, 0.5,
          1, 1,
          0.25, 0.75,
        ]),
        metadata: [
          { index: 1, isOriginal: false, pointCount: 2, offset: 0 },
          { index: 1, isOriginal: true, pointCount: 2, offset: 4 },
        ],
      },
      y: [0, 10],
      yTargetMin: 0,
      yTargetMax: 10,
      baseColor: '#3b82f6',
      originalColor: '#ff0000',
      sampleColors: ['#0000ff', '#00ff00'],
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ index: 1, isOriginal: false, pointCount: 2 });
    expect(lines[0].color.getHexString()).toBe('00ff00');
    expect(toRoundedArray(lines[0].points)).toEqual([0, 0, 0.5, 0.5]);

    expect(lines[1]).toMatchObject({ index: 1, isOriginal: true, pointCount: 2 });
    expect(lines[1].color.getHexString()).toBe('ff0000');
    expect(toRoundedArray(lines[1].points)).toEqual([1, 1, 0.25, 0.75]);
  });

  it('uses the shared target gradient when no explicit sample color is available', () => {
    const minHsl = getSpectraTargetColor(0, 0, 10).getHSL({ h: 0, s: 0, l: 0 });
    const maxHsl = getSpectraTargetColor(10, 0, 10).getHSL({ h: 0, s: 0, l: 0 });

    expect(minHsl.h).toBeCloseTo(2 / 3, 4);
    expect(maxHsl.h).toBeCloseTo(1 / 6, 4);
    expect(minHsl.s).toBeCloseTo(1);
    expect(maxHsl.l).toBeCloseTo(0.3);
  });
});
