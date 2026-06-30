import { describe, expect, it, vi } from 'vitest';

import { getCategoricalColor } from '@/lib/playground/colorConfig';
import {
  buildSpectraChartAxisInfo,
  buildSpectraRendererSampleColors,
  buildSpectraWebGLSampleColors,
} from '../useSpectraChartDerivedData';
import type { AggregatedStats } from '../SpectraAggregation';

const stats: AggregatedStats = {
  mean: [1, 2],
  median: [1, 2],
  min: [0, 1],
  max: [2, 3],
  std: [0.1, 0.2],
  quantileLower: [0.5, 1.5],
  quantileUpper: [1.5, 2.5],
  n: 2,
};

describe('useSpectraChartDerivedData helpers', () => {
  it('builds axis labels from processed header units first', () => {
    expect(buildSpectraChartAxisInfo(
      { header_unit: 'nm' },
      { header_unit: 'cm-1' }
    )).toEqual({
      wavelengthAxisName: 'Wavenumber',
      wavelengthAxisLabel: 'Wavenumber (cm⁻¹)',
      wavelengthUnitSymbol: 'cm⁻¹',
      wavelengthUnitSuffix: ' cm⁻¹',
    });
  });

  it('falls back to original header units when processed units are missing', () => {
    expect(buildSpectraChartAxisInfo(
      { header_unit: 'nm' },
      {}
    )).toMatchObject({
      wavelengthAxisName: 'Wavelength',
      wavelengthAxisLabel: 'Wavelength (nm)',
      wavelengthUnitSuffix: ' nm',
    });
  });

  it('builds sparse WebGL sample colors for the visible sample indices', () => {
    const getBaseColor = vi.fn((sampleIndex: number) => `sample-${sampleIndex}`);

    expect(buildSpectraWebGLSampleColors({
      isWebGLMode: false,
      displayIndices: [2],
      colorContext: {},
      getBaseColor,
    })).toBeUndefined();

    const colors = buildSpectraWebGLSampleColors({
      isWebGLMode: true,
      displayIndices: [2, 0],
      colorContext: {},
      getBaseColor,
    });

    expect(colors?.[0]).toBe('sample-0');
    expect(colors?.[2]).toBe('sample-2');
    expect(getBaseColor).toHaveBeenCalledTimes(2);
  });

  it('uses grouped palette colors for grouped WebGL rendering', () => {
    const groupedStats = new Map<string, AggregatedStats>([
      ['batch-a', stats],
      ['batch-b', stats],
    ]);

    expect(buildSpectraRendererSampleColors({
      displayMode: 'grouped',
      groupedStats,
      sampleColors: ['existing'],
    })).toEqual([
      getCategoricalColor(0, 'default'),
      getCategoricalColor(1, 'default'),
    ]);

    const sampleColors = ['#111', '#222'];
    expect(buildSpectraRendererSampleColors({
      displayMode: 'individual',
      groupedStats,
      sampleColors,
    })).toBe(sampleColors);
  });
});
