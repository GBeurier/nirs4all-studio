import { describe, expect, it, vi } from 'vitest';
import { getCategoricalColor, getContinuousColor } from './colorEncoding';
import {
  DEFAULT_POINT_COLOR,
  buildPointBufferData2D,
  buildSelectionStateData2D,
  calculate2DBounds,
  calculateTicks2D,
  calculateViewportBounds2D,
  clampScatter2DDevicePixelRatio,
  computePointColors2D,
  createIndexMap2D,
  createInteractionPickingPlan2D,
  createPointPickingPlan2D,
  createSelectionClickPlan2D,
  generateGridGeometry2D,
  prepareScatter2DRenderFrame,
  prepareScatter2DViewState,
  type Point2D,
} from './scatter2DData';

function expectArrayCloseTo(actual: ArrayLike<number>, expected: number[], precision = 6): void {
  expect(Array.from(actual)).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    expect(actual[index]).toBeCloseTo(value, precision);
  });
}

describe('scatter2DData', () => {
  it('builds identity index maps unless explicit indices are provided', () => {
    const points: Point2D[] = [[0, 0], [1, 1], [2, 2]];
    const explicit = [10, 20, 30];

    expect(createIndexMap2D(points)).toEqual([0, 1, 2]);
    expect(createIndexMap2D(points, explicit)).toBe(explicit);
  });

  it('calculates padded 2D bounds from finite points', () => {
    expect(calculate2DBounds([])).toEqual({
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
    });

    expect(calculate2DBounds([
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

    expect(calculate2DBounds([[5, 5]])).toEqual({
      minX: 4.9,
      maxX: 5.1,
      minY: 4.9,
      maxY: 5.1,
    });
  });

  it('calculates nice ticks for grid geometry', () => {
    expect(calculateTicks2D(-1, 1)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(calculateTicks2D(3, 3)).toEqual([3]);
  });

  it('generates stable grid and axis geometry in data coordinates', () => {
    const geometry = generateGridGeometry2D(
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

  it('computes point colors with explicit colors, values, labels, and defaults', () => {
    const points: Point2D[] = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]];
    const parseCssColor = vi.fn((_: string): [number, number, number, number] => [0.1, 0.2, 0.3, 0.4]);

    const colors = computePointColors2D(
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

  it('prepares a complete 2D view state without renderer side effects', () => {
    const points: Point2D[] = [[0, 0], [10, 20]];
    const customBounds = { minX: -5, maxX: 15, minY: -10, maxY: 30 };
    const parseCssColor = vi.fn((color: string): [number, number, number, number] => (
      color === 'red' ? [1, 0, 0, 1] : [0, 0, 1, 1]
    ));

    const viewState = prepareScatter2DViewState({
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

  it('packs positions, colors, sizes, and picking colors for WebGL buffers', () => {
    const bufferData = buildPointBufferData2D(
      [[0, 10], [20, 30]],
      [[1, 0, 0, 1], [0, 1, 0, 0.5]],
      7,
      [0, 255]
    );

    expectArrayCloseTo(bufferData.positions, [0, 10, 20, 30]);
    expectArrayCloseTo(bufferData.colors, [1, 0, 0, 1, 0, 1, 0, 0.5]);
    expectArrayCloseTo(bufferData.sizes, [7, 7]);
    expectArrayCloseTo(bufferData.pickColors, [0, 0, 1 / 255, 0, 1 / 255, 0]);
  });

  it('packs selection and hover state using sample indices', () => {
    const state = buildSelectionStateData2D(
      3,
      [10, 20, 30],
      new Set([20]),
      new Set([30]),
      10
    );

    expectArrayCloseTo(state.selected, [0, 1, 1]);
    expectArrayCloseTo(state.hovered, [1, 0, 0]);
  });

  it('calculates viewport bounds with optional aspect preservation', () => {
    const bounds = { minX: 0, maxX: 10, minY: 0, maxY: 10 };

    expect(calculateViewportBounds2D(bounds, 200, 100, false)).toEqual({
      left: 0,
      right: 10,
      bottom: 0,
      top: 10,
    });

    expect(calculateViewportBounds2D(bounds, 200, 100, true)).toEqual({
      left: -5,
      right: 15,
      bottom: 0,
      top: 10,
    });
  });

  it('prepares renderer frame dimensions, viewport bounds, and transform', () => {
    const frame = prepareScatter2DRenderFrame(
      { minX: 0, maxX: 10, minY: 0, maxY: 10 },
      { width: 101, height: 50 },
      3,
      true
    );

    expect(frame.dpr).toBe(2);
    expect(frame.width).toBe(202);
    expect(frame.height).toBe(100);
    expect(frame.viewportBounds).toEqual({
      left: -5.1,
      right: 15.1,
      bottom: 0,
      top: 10,
    });
    expectArrayCloseTo(frame.transform, [
      0.09900990099009901,
      0,
      0,
      0,
      0.2,
      0,
      -0.49504950495049505,
      -1,
      1,
    ]);
  });

  it('clamps scatter 2D device pixel ratios for render and picking prep', () => {
    expect(clampScatter2DDevicePixelRatio(1.5)).toBe(1.5);
    expect(clampScatter2DDevicePixelRatio(4)).toBe(2);
  });

  it('maps client coordinates into device pixels for point picking', () => {
    expect(createPointPickingPlan2D(25, 40, { left: 5, top: 10 }, 2)).toEqual({
      x: 40,
      y: 60,
    });
  });

  it('projects interactions into clamped device-pixel picking coordinates', () => {
    expect(createInteractionPickingPlan2D(25, 40, { left: 5, top: 10 }, 4)).toEqual({
      x: 40,
      y: 60,
    });
  });

  it('creates click selection plans without invoking context side effects', () => {
    const selected = new Set([5]);

    expect(createSelectionClickPlan2D(9, selected, {
      shiftKey: true,
      toggleKey: false,
      clearOnBackgroundClick: true,
      useSelectionContext: true,
    })).toEqual({ type: 'select', mode: 'add', index: 9 });

    expect(createSelectionClickPlan2D(9, selected, {
      shiftKey: false,
      toggleKey: true,
      clearOnBackgroundClick: true,
      useSelectionContext: true,
    })).toEqual({ type: 'toggle', index: 9 });

    expect(createSelectionClickPlan2D(5, selected, {
      shiftKey: false,
      toggleKey: false,
      clearOnBackgroundClick: true,
      useSelectionContext: true,
    })).toEqual({ type: 'clear' });

    expect(createSelectionClickPlan2D(null, selected, {
      shiftKey: false,
      toggleKey: false,
      clearOnBackgroundClick: true,
      useSelectionContext: true,
    })).toEqual({ type: 'clear' });

    expect(createSelectionClickPlan2D(9, selected, {
      shiftKey: false,
      toggleKey: false,
      clearOnBackgroundClick: true,
      useSelectionContext: false,
    })).toEqual({ type: 'none' });
  });
});
