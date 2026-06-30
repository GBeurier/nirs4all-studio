import { describe, expect, it } from 'vitest';

import {
  computeEffectiveSpectraVisibleIndices,
  computeSpectraTargetValueRange,
  computeSpectraWebGLRanges,
  computeSpectraZoomLevel,
  shouldSyncSpectraXViewRange,
} from '../spectraWebGLViewport';

describe('spectraWebGLViewport', () => {
  it('samples visible indices while preserving selected and pinned spectra first', () => {
    expect(computeEffectiveSpectraVisibleIndices({
      visibleIndices: [0, 1, 2, 3, 4, 5],
      spectraCount: 6,
      maxSamples: 4,
      selectedIndices: new Set([4, 1]),
      pinnedIndices: new Set([5]),
    })).toEqual([4, 1, 5, 0]);
  });

  it('computes padded ranges from processed and original spectra', () => {
    expect(computeSpectraWebGLRanges({
      spectra: [[0, 2], [100, 200]],
      originalSpectra: [[-2, 4], [300, 400]],
      wavelengths: [100, 200],
      visibleIndices: [0],
    })).toEqual({
      xRange: [100, 200],
      yRange: [-2.3, 4.3],
    });
  });

  it('uses stats and explicit y-range overrides before applying range padding', () => {
    expect(computeSpectraWebGLRanges({
      spectra: [[0, 1]],
      wavelengths: [10, 20],
      visibleIndices: [0],
      aggregatedStats: { min: [10, 12], max: [18, 20] },
    }).yRange).toEqual([9.5, 20.5]);

    expect(computeSpectraWebGLRanges({
      spectra: [[0, 1]],
      wavelengths: [10, 20],
      visibleIndices: [0],
      propYRange: [0, 10],
    }).yRange).toEqual([-0.5, 10.5]);
  });

  it('computes target and zoom ranges without renderer dependencies', () => {
    expect(computeSpectraTargetValueRange()).toEqual({ yMin: 0, yMax: 1 });
    expect(computeSpectraTargetValueRange([5, 2, 8])).toEqual({ yMin: 2, yMax: 8 });
    expect(computeSpectraZoomLevel([100, 200], [120, 140])).toBe(5);
  });

  it('detects when the x view range should be resynchronized', () => {
    expect(shouldSyncSpectraXViewRange({
      previousWavelengths: null,
      wavelengths: [100, 200],
      xRange: [100, 200],
      xViewRange: [100, 200],
      userHasZoomed: false,
      hasInitialized: false,
    })).toBe(true);

    expect(shouldSyncSpectraXViewRange({
      previousWavelengths: [100, 200],
      wavelengths: [100, 200],
      xRange: [100, 200],
      xViewRange: [110, 150],
      userHasZoomed: true,
      hasInitialized: true,
    })).toBe(false);

    expect(shouldSyncSpectraXViewRange({
      previousWavelengths: [100, 200],
      wavelengths: [100, 200],
      xRange: [200, 100],
      xViewRange: [100, 200],
      userHasZoomed: false,
      hasInitialized: true,
    })).toBe(false);
  });
});
