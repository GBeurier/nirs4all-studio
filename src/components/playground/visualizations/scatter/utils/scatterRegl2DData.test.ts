import { describe, expect, it, vi } from 'vitest';
import { getCategoricalColor, getContinuousColor } from './colorEncoding';
import {
  buildRegl2DPointBufferData,
  buildRegl2DSelectionData,
  calculateRegl2DBounds,
  calculateRegl2DTicks,
  calculateRegl2DViewportBounds,
  computeRegl2DPointColors,
  createRegl2DIndexMap,
  createRegl2DTransform,
  generateRegl2DGridGeometry,
  type Regl2DPoint,
} from './scatterRegl2DData';

function expectArrayCloseTo(actual: ArrayLike<number>, expected: number[], precision = 6): void {
  expect(Array.from(actual)).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, precision);
  });
}

describe('scatterRegl2DData', () => {
  it('builds the display-to-sample index map', () => {
    const points: Regl2DPoint[] = [[0, 0], [1, 1], [2, 2]];
    const explicit = [10, 20, 30];

    expect(createRegl2DIndexMap(points)).toEqual([0, 1, 2]);
    expect(createRegl2DIndexMap(points, explicit)).toBe(explicit);
  });

  it('calculates padded bounds from finite 2D points', () => {
    expect(calculateRegl2DBounds([])).toEqual({
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
    });

    expect(calculateRegl2DBounds([
      [0, 10],
      [Number.NaN, 0],
      [20, -10],
      [5, Number.POSITIVE_INFINITY],
    ])).toEqual({
      minX: -1,
      maxX: 21,
      minY: -11,
      maxY: 11,
    });

    expect(calculateRegl2DBounds([[5, 5]])).toEqual({
      minX: 4.9,
      maxX: 5.1,
      minY: 4.9,
      maxY: 5.1,
    });
  });

  it('computes point colors in the existing priority order', () => {
    const parseCssColor = vi.fn((_: string): [number, number, number, number] => [0.1, 0.2, 0.3, 0.4]);
    const colors = computeRegl2DPointColors(
      [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]],
      ['custom-color'],
      [0, 5, 10, Number.NaN, Number.NaN],
      ['a', 'b', 'a', 'c'],
      parseCssColor
    );

    expect(parseCssColor).toHaveBeenCalledWith('custom-color');
    expect(colors[0]).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(colors[1]).toEqual(getContinuousColor(0.5, 'blue_red'));
    expect(colors[2]).toEqual(getContinuousColor(1, 'blue_red'));
    expect(colors[3]).toEqual(getCategoricalColor(2));
    expect(colors[4]).toEqual([0.231, 0.510, 0.965, 1.0]);
  });

  it('packs point attributes for regl draw commands', () => {
    const bufferData = buildRegl2DPointBufferData(
      [[0, 10], [20, 30]],
      [[1, 0, 0, 1], [0, 1, 0, 0.5]],
      7,
      [0, 255]
    );

    expect(bufferData.count).toBe(2);
    expectArrayCloseTo(bufferData.position, [0, 10, 20, 30]);
    expectArrayCloseTo(bufferData.color, [1, 0, 0, 1, 0, 1, 0, 0.5]);
    expectArrayCloseTo(bufferData.size, [7, 7]);
    expectArrayCloseTo(bufferData.pickColor, [0, 0, 1 / 255, 0, 1 / 255, 0]);
  });

  it('packs selection and hover state using sample indices', () => {
    const data = buildRegl2DSelectionData(
      3,
      [10, 20, 30],
      new Set([20]),
      new Set([30]),
      10
    );

    expectArrayCloseTo(data.selected, [0, 1, 1]);
    expectArrayCloseTo(data.hovered, [1, 0, 0]);
  });

  it('generates grid and axis line geometry', () => {
    expect(calculateRegl2DTicks(-1, 1)).toEqual([-1, -0.5, 0, 0.5, 1]);

    const geometry = generateRegl2DGridGeometry(
      { minX: -1, maxX: 1, minY: -2, maxY: 2 },
      true,
      true
    );

    expect(geometry.count).toBe(24);
    expect(geometry.positions).toHaveLength(48);
    expect(geometry.colors).toHaveLength(96);
    expectArrayCloseTo(geometry.positions.slice(0, 4), [-1, -2, -1, 2]);
    expectArrayCloseTo(geometry.positions.slice(-4), [0, -2, 0, 2]);
    expectArrayCloseTo(geometry.colors.slice(0, 8), [0.5, 0.5, 0.5, 0.4, 0.5, 0.5, 0.5, 0.4]);
    expectArrayCloseTo(geometry.colors.slice(-8), [0.4, 0.4, 0.4, 0.8, 0.4, 0.4, 0.4, 0.8]);
  });

  it('calculates viewport bounds and transform matrix', () => {
    const bounds = { minX: 0, maxX: 10, minY: 0, maxY: 10 };

    expect(calculateRegl2DViewportBounds(bounds, 200, 100, false)).toEqual({
      left: 0,
      right: 10,
      bottom: 0,
      top: 10,
    });

    const preserved = calculateRegl2DViewportBounds(bounds, 200, 100, true);
    expect(preserved).toEqual({
      left: -5,
      right: 15,
      bottom: 0,
      top: 10,
    });
    expectArrayCloseTo(createRegl2DTransform(preserved), [0.1, 0, 0, 0, 0.2, 0, -0.5, -1, 1]);
  });
});
