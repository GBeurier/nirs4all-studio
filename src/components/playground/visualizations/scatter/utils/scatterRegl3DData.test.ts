import { describe, expect, it, vi } from 'vitest';
import { getCategoricalColor, getContinuousColor } from './colorEncoding';
import {
  DEFAULT_REGL_3D_POINT_COLOR,
  buildRegl3DPointBufferData,
  buildRegl3DSelectionData,
  calculateRegl3DBounds,
  calculateRegl3DViewportSize,
  computeRegl3DPointColors,
  createRegl3DCameraMatrices,
  createRegl3DIndexMap,
  createRegl3DRectPickingPlan,
  decodeRegl3DPickPixel,
  generateRegl3DGridGeometry,
  normalizeRegl3DPoint,
  type Regl3DPoint,
} from './scatterRegl3DData';

function expectArrayCloseTo(actual: ArrayLike<number>, expected: number[], precision = 6): void {
  expect(Array.from(actual)).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, precision);
  });
}

describe('scatterRegl3DData', () => {
  it('builds identity index maps unless explicit indices are provided', () => {
    const points: Regl3DPoint[] = [[0, 0, 0], [1, 1, 1], [2, 2, 2]];
    const explicit = [10, 20, 30];

    expect(createRegl3DIndexMap(points)).toEqual([0, 1, 2]);
    expect(createRegl3DIndexMap(points, explicit)).toBe(explicit);
  });

  it('calculates 3D bounds from finite points', () => {
    expect(calculateRegl3DBounds([])).toEqual({
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
      minZ: -1,
      maxZ: 1,
    });

    expect(calculateRegl3DBounds([
      [2, -4, 10],
      [Number.NaN, 0, 0],
      [-3, 8, -2],
      [6, Number.POSITIVE_INFINITY, 3],
    ])).toEqual({
      minX: -3,
      maxX: 2,
      minY: -4,
      maxY: 8,
      minZ: -2,
      maxZ: 10,
    });
  });

  it('normalizes points into Regl clip-space coordinates and handles collapsed ranges', () => {
    expect(normalizeRegl3DPoint(0, 5, 10, {
      minX: -10,
      maxX: 10,
      minY: 5,
      maxY: 5,
      minZ: 0,
      maxZ: 20,
    })).toEqual([0, -1, 0]);
  });

  it('computes point colors in the existing priority order', () => {
    const points: Regl3DPoint[] = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4]];
    const parseCssColor = vi.fn((_: string): [number, number, number, number] => [0.1, 0.2, 0.3, 0.4]);

    const colors = computeRegl3DPointColors(
      points,
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
    expect(colors[4]).toEqual(DEFAULT_REGL_3D_POINT_COLOR);
  });

  it('packs point attributes for Regl draw commands', () => {
    const points: Regl3DPoint[] = [[0, 10, 20], [10, 20, 30]];
    const bufferData = buildRegl3DPointBufferData(
      points,
      calculateRegl3DBounds(points),
      [[1, 0, 0, 1], [0, 1, 0, 0.5]],
      7,
      [0, 255]
    );

    expect(bufferData.count).toBe(2);
    expectArrayCloseTo(bufferData.position, [-1, -1, -1, 1, 1, 1]);
    expectArrayCloseTo(bufferData.color, [1, 0, 0, 1, 0, 1, 0, 0.5]);
    expectArrayCloseTo(bufferData.size, [7, 7]);
    expectArrayCloseTo(bufferData.pickColor, [0, 0, 1 / 255, 0, 1 / 255, 0]);
  });

  it('packs selection and hover state using sample indices', () => {
    const data = buildRegl3DSelectionData(
      3,
      [10, 20, 30],
      new Set([20]),
      new Set([30]),
      10
    );

    expectArrayCloseTo(data.selected, [0, 1, 1]);
    expectArrayCloseTo(data.hovered, [1, 0, 0]);
  });

  it('generates stable grid and axis line geometry', () => {
    const geometry = generateRegl3DGridGeometry();

    expect(geometry.count).toBe(26);
    expect(geometry.positions).toHaveLength(78);
    expect(geometry.colors).toHaveLength(104);
    expectArrayCloseTo(geometry.positions.slice(0, 6), [-1, -1, -1, 1, -1, -1]);
    expectArrayCloseTo(geometry.positions.slice(-6), [0, -1, -1.2, 0, -1, 1.2]);
    expectArrayCloseTo(geometry.colors.slice(-8), [0.3, 0.3, 1, 1, 0.3, 0.3, 1, 1]);
  });

  it('calculates device-pixel viewport size with the existing DPR cap', () => {
    expect(calculateRegl3DViewportSize(101.7, 49.2, 3)).toEqual({
      width: 203,
      height: 98,
      dpr: 2,
    });

    expect(calculateRegl3DViewportSize(200, 100, 1.25)).toEqual({
      width: 250,
      height: 125,
      dpr: 1.25,
    });
  });

  it('creates the fixed camera projection and identity model matrix', () => {
    const matrices = createRegl3DCameraMatrices(200, 100);

    expectArrayCloseTo(matrices.model, [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    expect(matrices.projection[0]).toBeCloseTo(1.2071068, 6);
    expect(matrices.projection[5]).toBeCloseTo(2.4142136, 6);
    expect(matrices.projection[10]).toBeCloseTo(-1.002002, 6);
    expect(matrices.projection[14]).toBeCloseTo(-0.2002002, 6);
  });

  it('creates a rectangle picking sampling plan in device pixels', () => {
    expect(createRegl3DRectPickingPlan(20, 10, 5, 40, 100, 2)).toEqual({
      startX: 10,
      endX: 40,
      startY: 120,
      endY: 180,
      width: 30,
      height: 60,
      stepSize: 2,
    });

    expect(createRegl3DRectPickingPlan(0, 0, 500, 500, 500, 1)?.stepSize).toBe(10);
    expect(createRegl3DRectPickingPlan(10, 10, 10, 20, 100, 1)).toBeNull();
  });

  it('decodes picking pixels back to sample indices', () => {
    expect(decodeRegl3DPickPixel([0, 0, 0, 255])).toBeNull();
    expect(decodeRegl3DPickPixel([0, 0, 1, 255])).toBe(0);
    expect(decodeRegl3DPickPixel([0, 1, 0, 255])).toBe(255);
    expect(decodeRegl3DPickPixel([1, 0, 0, 255])).toBe(65_535);
  });
});
