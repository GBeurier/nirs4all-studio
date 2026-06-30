import { describe, expect, it } from 'vitest';

import {
  computeSpectraPanRange,
  computeSpectraWheelZoomRange,
  resetSpectraXViewRange,
  shouldResetSpectraXViewRange,
} from '../spectraWebGLZoom';

describe('spectraWebGLZoom', () => {
  it('zooms around the pointer with the existing WebGL wheel factors', () => {
    expect(computeSpectraWheelZoomRange({
      xRange: [100, 200],
      viewRange: [120, 180],
      mouseXNorm: 0.5,
      deltaY: -1,
    })).toEqual([123.9, 176.1]);

    expect(computeSpectraWheelZoomRange({
      xRange: [100, 200],
      viewRange: [120, 180],
      mouseXNorm: 0.5,
      deltaY: 1,
    })).toEqual([115.5, 184.5]);
  });

  it('clamps wheel zoom to the full data range and the minimum zoom ratio', () => {
    expect(computeSpectraWheelZoomRange({
      xRange: [100, 200],
      viewRange: [100, 200],
      mouseXNorm: 0.5,
      deltaY: 1,
    })).toEqual([100, 200]);

    expect(computeSpectraWheelZoomRange({
      xRange: [100, 200],
      viewRange: [140, 145],
      mouseXNorm: 0.5,
      deltaY: -1,
    })).toEqual([140, 145]);
  });

  it('pans proportionally to viewport width and clamps to data bounds', () => {
    expect(computeSpectraPanRange({
      xRange: [100, 200],
      viewRange: [120, 180],
      dxPixels: 10,
      viewportWidth: 100,
    })).toEqual([114, 174]);

    expect(computeSpectraPanRange({
      xRange: [100, 200],
      viewRange: [120, 180],
      dxPixels: -100,
      viewportWidth: 100,
    })).toEqual([140, 200]);
  });

  it('decides when x-view refs should reset and returns a fresh full range', () => {
    expect(shouldResetSpectraXViewRange([100, 200], [100.5, 200], true)).toBe(false);
    expect(shouldResetSpectraXViewRange([100, 200], [102, 200], true)).toBe(true);
    expect(shouldResetSpectraXViewRange([100, 200], [100, 200], false)).toBe(true);

    const original: [number, number] = [100, 200];
    const range = resetSpectraXViewRange(original);
    expect(range).toEqual([100, 200]);
    expect(range).not.toBe(original);
  });
});
