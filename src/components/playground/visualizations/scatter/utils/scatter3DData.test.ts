import { describe, expect, it, vi } from 'vitest';
import { getCategoricalColor, getContinuousColor } from './colorEncoding';
import {
  DEFAULT_POINT_COLOR,
  buildPointBufferData3D,
  buildSelectionStateData3D,
  calculate3DBounds,
  clampScatter3DDevicePixelRatio,
  computePointColors3D,
  createIndexMap,
  createInteractionPickingPlan3D,
  createInteractionRectPickingPlan3D,
  createPointPickingPlan3D,
  createRectPickingPlan,
  createSelectionClickPlan3D,
  generateGridGeometry3D,
  normalizePoint3D,
  pickPixelToIndex,
  prepareScatter3DRenderFrame,
  prepareScatter3DViewState,
  type Point3D,
} from './scatter3DData';

function expectArrayCloseTo(actual: ArrayLike<number>, expected: number[], precision = 6): void {
  expect(Array.from(actual)).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, precision);
  });
}

describe('scatter3DData', () => {
  it('builds identity index maps unless explicit indices are provided', () => {
    const points: Point3D[] = [[0, 0, 0], [1, 1, 1], [2, 2, 2]];
    const explicit = [10, 20, 30];

    expect(createIndexMap(points)).toEqual([0, 1, 2]);
    expect(createIndexMap(points, explicit)).toBe(explicit);
  });

  it('calculates 3D bounds from finite points', () => {
    expect(calculate3DBounds([])).toEqual({
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
      minZ: -1,
      maxZ: 1,
    });

    expect(calculate3DBounds([
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

  it('normalizes points into clip-space coordinates and handles collapsed ranges', () => {
    expect(normalizePoint3D(0, 5, 10, {
      minX: -10,
      maxX: 10,
      minY: 5,
      maxY: 5,
      minZ: 0,
      maxZ: 20,
    })).toEqual([0, -1, 0]);
  });

  it('computes point colors with explicit colors, values, labels, and defaults', () => {
    const points: Point3D[] = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3], [4, 4, 4]];
    const parseCssColor = vi.fn((_: string): [number, number, number, number] => [0.1, 0.2, 0.3, 0.4]);

    const colors = computePointColors3D(
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
    expect(colors[4]).toEqual(DEFAULT_POINT_COLOR);
  });

  it('prepares a complete 3D view state without renderer side effects', () => {
    const points: Point3D[] = [[0, 0, 0], [10, 20, 30]];
    const customBounds = { minX: -5, maxX: 15, minY: -10, maxY: 30, minZ: -15, maxZ: 45 };
    const parseCssColor = vi.fn((color: string): [number, number, number, number] => (
      color === 'red' ? [1, 0, 0, 1] : [0, 0, 1, 1]
    ));

    const viewState = prepareScatter3DViewState({
      points,
      indices: [100, 200],
      colors: ['red', 'blue'],
      customBounds,
      parseCssColor,
    });

    expect(viewState.points).toBe(points);
    expect(viewState.indexMap).toEqual([100, 200]);
    expect(viewState.bounds).toBe(customBounds);
    expect(viewState.pointColors).toEqual([[1, 0, 0, 1], [0, 0, 1, 1]]);
    expect(parseCssColor).toHaveBeenCalledTimes(2);
  });

  it('packs normalized positions, colors, sizes, and picking colors for WebGL buffers', () => {
    const points: Point3D[] = [[0, 10, 20], [10, 20, 30]];
    const bounds = calculate3DBounds(points);
    const bufferData = buildPointBufferData3D(
      points,
      bounds,
      [[1, 0, 0, 1], [0, 1, 0, 0.5]],
      7,
      [0, 255]
    );

    expectArrayCloseTo(bufferData.positions, [-1, -1, -1, 1, 1, 1]);
    expectArrayCloseTo(bufferData.colors, [1, 0, 0, 1, 0, 1, 0, 0.5]);
    expectArrayCloseTo(bufferData.sizes, [7, 7]);
    expectArrayCloseTo(bufferData.pickColors, [0, 0, 1 / 255, 0, 1 / 255, 0]);
  });

  it('packs selection and hover state using sample indices', () => {
    const state = buildSelectionStateData3D(
      3,
      [10, 20, 30],
      new Set([20]),
      new Set([30]),
      10
    );

    expectArrayCloseTo(state.selected, [0, 1, 1]);
    expectArrayCloseTo(state.hovered, [1, 0, 0]);
  });

  it('generates the stable 3D grid and axis geometry', () => {
    const geometry = generateGridGeometry3D();

    expect(geometry.positions).toHaveLength(78);
    expect(geometry.colors).toHaveLength(104);
    expectArrayCloseTo(geometry.positions.slice(0, 6), [-1, -1, -1, 1, -1, -1]);
    expectArrayCloseTo(geometry.positions.slice(-6), [0, -1, -1.2, 0, -1, 1.2]);
  });

  it('prepares renderer frame dimensions and camera matrices', () => {
    const frame = prepareScatter3DRenderFrame({ width: 101, height: 50 }, 3);

    expect(frame.dpr).toBe(2);
    expect(frame.width).toBe(202);
    expect(frame.height).toBe(100);
    expectArrayCloseTo(frame.projectionMatrix, [
      1.195155,
      0,
      0,
      0,
      0,
      2.414214,
      0,
      0,
      0,
      0,
      -1.002002,
      -1,
      0,
      0,
      -0.2002,
      0,
    ], 5);
    expectArrayCloseTo(frame.modelMatrix, [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
  });

  it('clamps scatter 3D device pixel ratios for render and picking prep', () => {
    expect(clampScatter3DDevicePixelRatio(1.5)).toBe(1.5);
    expect(clampScatter3DDevicePixelRatio(4)).toBe(2);
  });

  it('maps client coordinates into device pixels for point picking', () => {
    expect(createPointPickingPlan3D(25, 40, { left: 5, top: 10, height: 100 }, 2)).toEqual({
      x: 40,
      y: 60,
    });
  });

  it('projects interactions into clamped 3D point-picking coordinates', () => {
    expect(createInteractionPickingPlan3D(25, 40, { left: 5, top: 10, height: 100 }, 4)).toEqual({
      x: 40,
      y: 60,
    });
  });

  it('creates a rectangle picking sampling plan in device pixels', () => {
    expect(createRectPickingPlan(20, 10, 5, 40, 100, 2)).toEqual({
      startX: 10,
      endX: 40,
      startY: 120,
      endY: 180,
      width: 30,
      height: 60,
      stepSize: 2,
    });

    expect(createRectPickingPlan(0, 0, 500, 500, 500, 1)?.stepSize).toBe(10);
    expect(createRectPickingPlan(10, 10, 10, 20, 100, 1)).toBeNull();
  });

  it('projects interactions into clamped 3D rectangle-picking sampling plans', () => {
    expect(createInteractionRectPickingPlan3D(20, 10, 5, 40, { left: 0, top: 0, height: 100 }, 4)).toEqual({
      startX: 10,
      endX: 40,
      startY: 120,
      endY: 180,
      width: 30,
      height: 60,
      stepSize: 2,
    });
  });

  it('decodes picking pixels back to sample indices', () => {
    expect(pickPixelToIndex([0, 0, 0, 255])).toBeNull();
    expect(pickPixelToIndex([0, 0, 1, 255])).toBe(0);
    expect(pickPixelToIndex([0, 1, 0, 255])).toBe(255);
    expect(pickPixelToIndex([1, 0, 0, 255])).toBe(65_535);
  });

  it('plans selection click side effects without mutating selection state', () => {
    expect(createSelectionClickPlan3D(7, new Set(), {
      shiftKey: true,
      toggleKey: false,
      clearOnBackgroundClick: true,
      useSelectionContext: true,
    })).toEqual({ type: 'select', mode: 'add', index: 7 });

    expect(createSelectionClickPlan3D(7, new Set(), {
      shiftKey: false,
      toggleKey: true,
      clearOnBackgroundClick: true,
      useSelectionContext: true,
    })).toEqual({ type: 'toggle', index: 7 });

    expect(createSelectionClickPlan3D(7, new Set([7]), {
      shiftKey: false,
      toggleKey: false,
      clearOnBackgroundClick: true,
      useSelectionContext: true,
    })).toEqual({ type: 'clear' });

    expect(createSelectionClickPlan3D(7, new Set([8]), {
      shiftKey: false,
      toggleKey: false,
      clearOnBackgroundClick: true,
      useSelectionContext: true,
    })).toEqual({ type: 'select', mode: 'replace', index: 7 });

    expect(createSelectionClickPlan3D(null, new Set([8]), {
      shiftKey: false,
      toggleKey: false,
      clearOnBackgroundClick: true,
      useSelectionContext: true,
    })).toEqual({ type: 'clear' });

    expect(createSelectionClickPlan3D(null, new Set([8]), {
      shiftKey: true,
      toggleKey: false,
      clearOnBackgroundClick: true,
      useSelectionContext: true,
    })).toEqual({ type: 'none' });

    expect(createSelectionClickPlan3D(7, new Set(), {
      shiftKey: false,
      toggleKey: false,
      clearOnBackgroundClick: true,
      useSelectionContext: false,
    })).toEqual({ type: 'none' });
  });
});
