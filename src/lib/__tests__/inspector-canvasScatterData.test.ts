import { describe, expect, it } from 'vitest';

import {
  buildCanvasScatterDomain,
  buildCanvasScatterSpatialGrid,
  calculateCanvasScatterTicks,
  formatCanvasScatterTickValue,
  getCanvasScatterHoveredPoint,
  getCanvasScatterPointerPosition,
  getCanvasScatterTooltipStyle,
  projectCanvasScatterPoints,
  findNearestCanvasScatterPoint,
} from '@/lib/inspector/canvasScatterData';
import type { CanvasScatterPoint } from '@/lib/inspector/canvasScatterData';

function point(overrides: Partial<CanvasScatterPoint> = {}): CanvasScatterPoint {
  return {
    x: 0,
    y: 0,
    color: '#111111',
    opacity: 0.8,
    radius: 3,
    chainId: 'chain-a',
    ...overrides,
  };
}

describe('inspector canvas scatter data helpers', () => {
  it('builds padded domains, fixed-domain overrides, ticks, and tick labels', () => {
    const points = [
      point({ x: -1, y: 2 }),
      point({ x: 3, y: 6 }),
    ];

    expect(buildCanvasScatterDomain({ points })).toEqual({
      xMin: -1.2,
      xMax: 3.2,
      yMin: 1.8,
      yMax: 6.2,
    });
    expect(buildCanvasScatterDomain({
      points,
      xDomain: [0, 10],
      yDomain: [1, 9],
    })).toEqual({
      xMin: 0,
      xMax: 10,
      yMin: 1,
      yMax: 9,
    });
    expect(buildCanvasScatterDomain({ points: [] })).toEqual({
      xMin: 0,
      xMax: 1,
      yMin: 0,
      yMax: 1,
    });
    expect(calculateCanvasScatterTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(formatCanvasScatterTickValue(0)).toBe('0');
    expect(formatCanvasScatterTickValue(1234)).toBe('1234');
    expect(formatCanvasScatterTickValue(1.23456)).toBe('1.235');
    expect(formatCanvasScatterTickValue(0.123456)).toBe('0.123');
  });

  it('projects points, builds a spatial grid, and resolves nearest points', () => {
    const points = [
      point({ x: 0, y: 0 }),
      point({ x: 10, y: 5, chainId: 'chain-b' }),
      point({ x: 6, y: 1, chainId: 'chain-c' }),
    ];
    const target = new Float64Array(6);
    const screenPositions = projectCanvasScatterPoints({
      points,
      plotW: 100,
      plotH: 50,
      xMin: 0,
      xMax: 10,
      yMin: 0,
      yMax: 5,
      target,
    });

    expect(screenPositions).toBe(target);
    expect(Array.from(screenPositions)).toEqual([0, 50, 100, 0, 60, 40]);

    const grid = buildCanvasScatterSpatialGrid(
      new Float64Array([5, 5, 25, 5, 60, 60]),
      3,
      10,
    );
    expect(grid.cells.get('0,0')).toEqual([0]);
    expect(grid.cells.get('2,0')).toEqual([1]);
    expect(grid.cells.get('6,6')).toEqual([2]);
    expect(findNearestCanvasScatterPoint(grid, new Float64Array([5, 5, 25, 5, 60, 60]), 24, 7, 8)).toBe(1);
    expect(findNearestCanvasScatterPoint(grid, new Float64Array([5, 5, 25, 5, 60, 60]), 50, 50, 5)).toBeNull();
  });

  it('computes pointer positions, tooltip placement, and hovered points', () => {
    expect(getCanvasScatterPointerPosition({
      clientX: 100,
      clientY: 50,
      rectLeft: 10,
      rectTop: 5,
      dpr: 2,
    })).toEqual({
      x: 68,
      y: 42,
    });
    expect(getCanvasScatterTooltipStyle({
      x: 200,
      y: 50,
      containerWidth: 300,
    })).toEqual({
      left: 140,
      top: 4,
    });
    expect(getCanvasScatterTooltipStyle({
      x: 10,
      y: 100,
      containerWidth: 500,
    })).toEqual({
      left: 22,
      top: 40,
    });

    const points = [point(), point({ chainId: 'chain-b' })];
    expect(getCanvasScatterHoveredPoint(points, 1)?.chainId).toBe('chain-b');
    expect(getCanvasScatterHoveredPoint(points, null)).toBeNull();
    expect(getCanvasScatterHoveredPoint(points, 99)).toBeNull();
  });
});
