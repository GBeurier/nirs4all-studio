/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';

import {
  getDimensionReduction3DSelectionBounds,
  getDimensionReductionMousePosition,
  getDimensionReductionPointIndex,
  selectDimensionReduction3DPoints,
  selectDimensionReductionRechartsPoints,
  selectDimensionReductionWebglPoints,
} from '@/lib/playground/dimensionReductionInteraction';
import type { DimensionReductionDataPoint } from '@/lib/playground/dimensionReductionData';
import {
  getBoundsFromCorners,
  getBoundsFromPoints,
  type Point,
  type SelectionResult,
} from '@/components/playground/selectionGeometry';

const points: DimensionReductionDataPoint[] = [
  { x: 0, y: 0, z: 0, index: 10, name: 'A', yValue: 1 },
  { x: 10, y: 10, z: 1, index: 20, name: 'B', yValue: 2 },
];

function boxSelection(start: Point, end: Point): SelectionResult {
  return {
    start,
    end,
    bounds: getBoundsFromCorners(start, end),
  };
}

function lassoSelection(path: Point[]): SelectionResult {
  return {
    path,
    bounds: getBoundsFromPoints(path),
  };
}

describe('dimensionReductionInteraction', () => {
  it('extracts sample indices from renderer payload shapes and mouse positions from container rects', () => {
    expect(getDimensionReductionPointIndex({ payload: { index: 42 } })).toBe(42);
    expect(getDimensionReductionPointIndex({ index: 12 })).toBe(12);
    expect(getDimensionReductionPointIndex({ payload: {} })).toBeUndefined();
    expect(getDimensionReductionMousePosition(115, 240, { left: 100, top: 200 })).toEqual({ x: 15, y: 40 });
  });

  it('selects WebGL points by converting screen selections into data space', () => {
    const box = boxSelection({ x: 0, y: 80 }, { x: 30, y: 100 });

    expect(selectDimensionReductionWebglPoints(points, box, { width: 100, height: 100 }, false)).toEqual([10]);

    const lasso = lassoSelection([
        { x: 0, y: 80 },
        { x: 30, y: 80 },
        { x: 30, y: 100 },
        { x: 0, y: 100 },
    ]);
    expect(selectDimensionReductionWebglPoints(points, lasso, { width: 100, height: 100 }, false)).toEqual([10]);
  });

  it('maps Recharts DOM symbol centers back to sample indices', () => {
    const container = document.createElement('div');
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 100,
      height: 100,
      right: 110,
      bottom: 120,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);

    const first = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    first.classList.add('recharts-symbols');
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      top: 30,
      width: 10,
      height: 10,
      right: 30,
      bottom: 40,
      x: 20,
      y: 30,
      toJSON: () => ({}),
    } as DOMRect);

    const second = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    second.classList.add('recharts-symbols');
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({
      left: 90,
      top: 90,
      width: 10,
      height: 10,
      right: 100,
      bottom: 100,
      x: 90,
      y: 90,
      toJSON: () => ({}),
    } as DOMRect);

    container.append(first, second);

    expect(selectDimensionReductionRechartsPoints(
      container,
      points,
      boxSelection({ x: 0, y: 0 }, { x: 20, y: 20 }),
    )).toEqual([10]);
  });

  it('converts 3D lasso and box selections into screen rect calls', () => {
    const pathResult = lassoSelection([
        { x: 30, y: 10 },
        { x: 50, y: 40 },
        { x: 20, y: 20 },
    ]);
    expect(getDimensionReduction3DSelectionBounds(pathResult)).toEqual({
      minX: 20,
      minY: 10,
      maxX: 50,
      maxY: 40,
    });

    const getPointsInScreenRect = vi.fn(() => [10, 20]);
    expect(selectDimensionReduction3DPoints(pathResult, getPointsInScreenRect)).toEqual([10, 20]);
    expect(getPointsInScreenRect).toHaveBeenCalledWith(20, 10, 50, 40);

    expect(getDimensionReduction3DSelectionBounds(
      boxSelection({ x: 40, y: 80 }, { x: 10, y: 20 }),
    )).toEqual({
      minX: 10,
      minY: 20,
      maxX: 40,
      maxY: 80,
    });
  });
});
