import { describe, expect, it } from 'vitest';

import {
  buildRepetitionsDataBounds,
  buildRepetitionsXAxisViewport,
  buildRepetitionsZoomInfo,
  panRepetitionsXDomain,
  zoomRepetitionsXDomain,
} from '@/lib/playground/repetitionsChartViewport';

describe('repetitionsChartViewport', () => {
  it('builds data bounds from an explicit or full x-domain', () => {
    expect(buildRepetitionsDataBounds([0, 1], 4, [0, 4.6])).toEqual({
      minX: 0,
      maxX: 1,
      minY: 0,
      maxY: 4.6,
    });
    expect(buildRepetitionsDataBounds(null, 4, [1, 9])).toEqual({
      minX: -0.5,
      maxX: 3.5,
      minY: 1,
      maxY: 9,
    });
  });

  it('projects zoom information and x-axis ticks from the current viewport', () => {
    expect(buildRepetitionsZoomInfo([0, 4], 10)).toEqual({ level: 40, visible: 4, total: 10 });
    expect(buildRepetitionsZoomInfo(null, 0)).toEqual({ level: 100, visible: 0, total: 0 });
    expect(buildRepetitionsXAxisViewport([2.2, 9.1], 12, 3)).toEqual({
      effectiveXDomain: [2.2, 9.1],
      visibleStart: 2,
      visibleEnd: 10,
      visibleCount: 9,
      xTicks: [2, 5, 8, 10],
    });
  });

  it('computes clamped zoom and pan domains', () => {
    expect(zoomRepetitionsXDomain({
      xDomain: null,
      groupCount: 10,
      deltaY: -1,
    })).toEqual([0.5, 8.5]);

    expect(zoomRepetitionsXDomain({
      xDomain: [2, 4],
      groupCount: 10,
      deltaY: 1,
    })).toEqual([1.8, 4.2]);

    expect(panRepetitionsXDomain({
      xDomain: [2, 6],
      groupCount: 10,
      chartWidth: 100,
      deltaX: 25,
    })).toEqual([1, 5]);

    expect(panRepetitionsXDomain({
      xDomain: [0, 4],
      groupCount: 10,
      chartWidth: 100,
      deltaX: 100,
    })).toEqual([-0.5, 3.5]);
  });

  it('returns null for non-renderable viewport changes', () => {
    expect(zoomRepetitionsXDomain({ xDomain: null, groupCount: 0, deltaY: 1 })).toBeNull();
    expect(panRepetitionsXDomain({ xDomain: null, groupCount: 10, chartWidth: 0, deltaX: 1 })).toBeNull();
  });
});
