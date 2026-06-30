/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';

import {
  getBoundsFromCorners,
  getBoundsFromPoints,
  type SelectionResult,
} from '@/components/playground/selectionGeometry';
import {
  getRepetitionsWebglPlotArea,
  screenToRepetitionsData,
  selectRepetitionsRechartsPoints,
  selectRepetitionsWebglPoints,
} from '@/lib/playground/repetitionsChartInteraction';
import type { RepetitionsDataBounds, RepetitionsPlotDataPoint } from '@/lib/playground/repetitionsChartData';

const bounds: RepetitionsDataBounds = {
  minX: 0,
  maxX: 10,
  minY: 0,
  maxY: 10,
};

const plotData: RepetitionsPlotDataPoint[] = [
  {
    x: 2,
    groupIndex: 0,
    groupSize: 1,
    y: 8,
    bioSample: 'a',
    repIndex: 0,
    sampleIndex: 10,
    sampleId: 'a-1',
    isOutlier: false,
    isSelected: false,
  },
  {
    x: 8,
    groupIndex: 1,
    groupSize: 1,
    y: 2,
    bioSample: 'b',
    repIndex: 0,
    sampleIndex: 20,
    sampleId: 'b-1',
    isOutlier: false,
    isSelected: false,
  },
];

function rect({ left, top, width, height }: { left: number; top: number; width: number; height: number }): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('repetitionsChartInteraction', () => {
  it('builds WebGL plot area dimensions and converts screen coordinates to data coordinates', () => {
    const plotArea = getRepetitionsWebglPlotArea({ width: 140, height: 124 });

    expect(plotArea).toEqual({
      axisLeftOffset: 40,
      axisBottomOffset: 24,
      width: 100,
      height: 100,
    });
    expect(screenToRepetitionsData(60, 20, plotArea, bounds)).toEqual({ x: 2, y: 8 });
    expect(getRepetitionsWebglPlotArea({ width: 20, height: 10 })).toMatchObject({ width: 1, height: 1 });
  });

  it('selects WebGL repetition points by mapping selection screen space into data space', () => {
    const box: SelectionResult = {
      start: { x: 55, y: 15 },
      end: { x: 65, y: 25 },
      bounds: getBoundsFromCorners({ x: 55, y: 15 }, { x: 65, y: 25 }),
    };

    expect(selectRepetitionsWebglPoints(plotData, box, { width: 140, height: 124 }, bounds)).toEqual([10]);

    const lassoPath = [
      { x: 50, y: 10 },
      { x: 70, y: 10 },
      { x: 70, y: 30 },
      { x: 50, y: 30 },
    ];
    const lasso: SelectionResult = {
      path: lassoPath,
      bounds: getBoundsFromPoints(lassoPath),
    };
    expect(selectRepetitionsWebglPoints(plotData, lasso, { width: 140, height: 124 }, bounds)).toEqual([10]);
  });

  it('maps Recharts DOM symbol centers back to repetition sample indices', () => {
    const container = document.createElement('div');
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rect({ left: 10, top: 20, width: 100, height: 100 }));

    const first = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    first.classList.add('recharts-symbols');
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(rect({ left: 20, top: 30, width: 10, height: 10 }));

    const second = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    second.classList.add('recharts-symbols');
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(rect({ left: 90, top: 90, width: 10, height: 10 }));

    container.append(first, second);

    expect(selectRepetitionsRechartsPoints(container, plotData, {
      start: { x: 0, y: 0 },
      end: { x: 20, y: 20 },
      bounds: getBoundsFromCorners({ x: 0, y: 0 }, { x: 20, y: 20 }),
    })).toEqual([10]);
  });
});
