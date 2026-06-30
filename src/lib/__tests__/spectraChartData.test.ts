import { describe, expect, it } from 'vitest';

import {
  applySpectraWavelengthFocus,
  buildFocusedSpectraData,
  buildSpectraDifferenceStats,
  buildSpectraExportRows,
  buildSpectraMatrixForView,
  buildSpectraYAxisDomain,
  chartYToSpectraValue,
  findHighSpectraDifferenceRegions,
  getSpectraBaseWavelengths,
  getSpectraRangeBounds,
  getSpectraRectBounds,
  getSpectraWavelengthRange,
  selectSpectraRangeSamples,
  selectSpectraRectSamples,
  zoomSpectraBrushDomain,
} from '@/lib/playground/spectraChartData';
import { DEFAULT_WAVELENGTH_FOCUS_CONFIG } from '@/lib/playground/spectraConfig';
import type { DataSection } from '@/types/playground';

const original: DataSection = {
  spectra: [
    [1, 2, 3, 4],
    [2, 3, 4, 5],
  ],
  wavelengths: [1000, 1100, 1200, 1300],
  shape: [2, 4],
};

const processed: DataSection = {
  spectra: [
    [2, 1, 5, 3],
    [3, 2, 6, 4],
  ],
  wavelengths: [1000, 1100, 1200, 1300],
  shape: [2, 4],
};

describe('spectra chart data helpers', () => {
  it('selects base wavelengths and range for the active view', () => {
    expect(getSpectraBaseWavelengths(original, processed, 'original')).toBe(original.wavelengths);
    expect(getSpectraBaseWavelengths(original, processed, 'processed')).toBe(processed.wavelengths);
    expect(getSpectraWavelengthRange(processed.wavelengths)).toEqual([1000, 1300]);
    expect(getSpectraWavelengthRange([])).toEqual([0, 1000]);
  });

  it('builds processed, original, and signed difference matrices', () => {
    expect(buildSpectraMatrixForView({
      original,
      processed,
      viewMode: 'original',
      showAbsoluteDifference: false,
    })).toEqual({
      spectra: original.spectra,
      wavelengths: original.wavelengths,
    });
    expect(buildSpectraMatrixForView({
      original,
      processed,
      viewMode: 'processed',
      showAbsoluteDifference: false,
    })).toEqual({
      spectra: processed.spectra,
      wavelengths: processed.wavelengths,
    });
    expect(buildSpectraMatrixForView({
      original,
      processed,
      viewMode: 'difference',
      showAbsoluteDifference: false,
    }).spectra).toEqual([
      [1, -1, 2, -1],
      [1, -1, 2, -1],
    ]);
  });

  it('builds absolute difference matrices', () => {
    expect(buildSpectraMatrixForView({
      original,
      processed,
      viewMode: 'difference',
      showAbsoluteDifference: true,
    }).spectra).toEqual([
      [1, 1, 2, 1],
      [1, 1, 2, 1],
    ]);
  });

  it('applies wavelength range and derivative focus', () => {
    expect(applySpectraWavelengthFocus(
      { spectra: original.spectra, wavelengths: original.wavelengths },
      {
        ...DEFAULT_WAVELENGTH_FOCUS_CONFIG,
        range: [1100, 1200],
      }
    )).toEqual({
      spectra: [
        [2, 3],
        [3, 4],
      ],
      wavelengths: [1100, 1200],
    });

    expect(applySpectraWavelengthFocus(
      { spectra: [[1, 3, 6]], wavelengths: [1000, 1100, 1200] },
      {
        ...DEFAULT_WAVELENGTH_FOCUS_CONFIG,
        derivative: 1,
      }
    ).spectra[0]).toEqual([0.02, 0.025, 0.03]);
  });

  it('combines view selection and focus', () => {
    expect(buildFocusedSpectraData({
      original,
      processed,
      viewMode: 'difference',
      wavelengthFocus: {
        ...DEFAULT_WAVELENGTH_FOCUS_CONFIG,
        range: [1000, 1100],
      },
      showAbsoluteDifference: false,
    })).toEqual({
      spectra: [
        [1, -1],
        [1, -1],
      ],
      wavelengths: [1000, 1100],
    });
  });

  it('computes difference statistics from aligned original and processed spectra', () => {
    const stats = buildSpectraDifferenceStats(original.spectra, processed.spectra);

    expect(stats?.meanAbsDiff).toBeCloseTo(1.25);
    expect(stats?.maxAbsDiff).toBe(2);
    expect(stats?.rmse).toBeCloseTo(Math.sqrt(1.75));
    expect(buildSpectraDifferenceStats(original.spectra, processed.spectra.slice(0, 1))).toBeNull();
  });

  it('finds contiguous high-difference wavelength regions', () => {
    const wavelengths = Array.from({ length: 20 }, (_, idx) => 1000 + idx * 10);
    const differenceSpectra = [
      wavelengths.map((_, idx) => (idx >= 5 && idx <= 7 ? 10 : 0)),
      wavelengths.map((_, idx) => (idx >= 5 && idx <= 7 ? 8 : 0)),
    ];

    expect(findHighSpectraDifferenceRegions({
      wavelengths,
      differenceSpectra,
    })).toEqual([{ start: 1050, end: 1070 }]);

    expect(findHighSpectraDifferenceRegions({
      wavelengths,
      differenceSpectra: [
        wavelengths.map((_, idx) => (idx >= 5 && idx <= 6 ? 10 : 0)),
      ],
    })).toEqual([]);
  });

  it('builds Y domains and zoom brush domains for canvas interactions', () => {
    expect(buildSpectraYAxisDomain([[1, 3], [2, 5]])).toEqual([0.8, 5.2]);
    expect(buildSpectraYAxisDomain([[], [Number.NaN, Number.POSITIVE_INFINITY]])).toEqual([0, 1]);
    expect(buildSpectraYAxisDomain([[5], []])).toEqual([4.75, 5.25]);
    expect(zoomSpectraBrushDomain({
      wavelengthRange: [1000, 1300],
      brushDomain: null,
      mouseXNorm: 0.5,
      deltaY: -1,
    })).toEqual([1019.5, 1280.5]);
    expect(zoomSpectraBrushDomain({
      wavelengthRange: [1000, 1300],
      brushDomain: null,
      mouseXNorm: 0.5,
      deltaY: 1,
    })).toBeNull();
  });

  it('builds export rows for selected spectra indices', () => {
    expect(buildSpectraExportRows({
      wavelengths: [1000, 1100],
      spectra: [[1, 2], [3, 4]],
      sampleIndices: [1, 0],
      sampleIds: ['sample-a', 'sample-b'],
    })).toEqual([
      { wavelength: 1000, 'sample-b': 3, 'sample-a': 1 },
      { wavelength: 1100, 'sample-b': 4, 'sample-a': 2 },
    ]);
  });

  it('builds selection bounds and maps chart Y pixels to spectra values', () => {
    expect(getSpectraRangeBounds({
      isSelecting: true,
      startWavelength: 1300,
      endWavelength: 1000,
    })).toEqual({ min: 1000, max: 1300 });
    expect(getSpectraRangeBounds({
      isSelecting: false,
      startWavelength: 1000,
      endWavelength: 1300,
    })).toBeNull();

    expect(getSpectraRectBounds({
      isSelecting: true,
      startX: 0,
      endX: 2,
      startY: 5,
      endY: 1,
    })).toEqual({ x1: 0, x2: 2, y1: 1, y2: 5 });

    expect(getSpectraRectBounds({
      isSelecting: true,
      startX: 1300,
      endX: 1000,
      startY: 5,
      endY: 1,
    })).toEqual({ x1: 1000, x2: 1300, y1: 1, y2: 5 });

    expect(chartYToSpectraValue({
      chartY: 145,
      containerHeight: 300,
      marginTop: 20,
      marginBottom: 30,
      yAxisDomain: [0, 10],
    })).toBe(5);
  });

  it('selects spectra from wavelength ranges and 2D rectangles', () => {
    const wavelengths = [1000, 1100, 1200, 1300];
    const spectra = [
      [1, 1, 1, 1],
      [2, 2, 2, 2],
      [3, 3, 3, 3],
      [4, 4, 4, 4],
      [100, 100, 100, 100],
    ];

    expect(selectSpectraRangeSamples({
      wavelengths,
      spectra,
      startWavelength: 1000,
      endWavelength: 1300,
    })).toEqual([0, 4]);
    expect(selectSpectraRangeSamples({
      wavelengths,
      spectra,
      startWavelength: 1000,
      endWavelength: 1100,
    })).toEqual([]);

    expect(selectSpectraRectSamples({
      wavelengths,
      spectra,
      bounds: { x1: 1000, x2: 1300, y1: 3.5, y2: 4.5 },
      yAxisDomain: [0, 10],
    })).toEqual([3]);
  });
});
