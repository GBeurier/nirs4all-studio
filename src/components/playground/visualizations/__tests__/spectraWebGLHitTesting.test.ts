import { describe, expect, it } from 'vitest';

import {
  findClosestSpectraHitLine,
  findClosestSpectraHitLineFromPointer,
  pointerToSpectraChartPoint,
  type SpectraWebGLHitTestLine,
} from '../spectraWebGLHitTesting';

function hitLine(index: number, points: number[], isOriginal = false): SpectraWebGLHitTestLine {
  return {
    index,
    isOriginal,
    points: new Float32Array(points),
    pointCount: points.length / 2,
  };
}

describe('spectraWebGLHitTesting', () => {
  it('converts pointer coordinates into normalized chart coordinates with inverted y', () => {
    const point = pointerToSpectraChartPoint(60, 120, {
      left: 10,
      top: 20,
      width: 100,
      height: 200,
    });

    expect(point.x).toBeCloseTo(0.48);
    expect(point.y).toBeCloseTo(0.46);
  });

  it('finds the closest processed line and ignores original spectra', () => {
    const lines = [
      hitLine(99, [0.5, 0.5], true),
      hitLine(1, [0.5, 0.55]),
      hitLine(2, [0.5, 0.51]),
    ];

    expect(findClosestSpectraHitLine(lines, { x: 0.5, y: 0.5 })).toBe(2);
  });

  it('returns null when no line point falls inside x and y thresholds', () => {
    const lines = [
      hitLine(1, [0.9, 0.5]),
      hitLine(2, [0.5, 0.9]),
    ];

    expect(findClosestSpectraHitLine(lines, { x: 0.5, y: 0.5 })).toBeNull();
  });

  it('finds a hit directly from pointer coordinates and a DOM rect', () => {
    const lines = [
      hitLine(4, [0.48, 0.46]),
      hitLine(5, [0.2, 0.2]),
    ];

    expect(findClosestSpectraHitLineFromPointer(lines, 60, 120, {
      left: 10,
      top: 20,
      width: 100,
      height: 200,
    })).toBe(4);
  });
});
