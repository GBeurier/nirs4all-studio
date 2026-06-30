import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SPECTRA_CHART_CONFIG } from '@/lib/playground/spectraConfig';
import {
  buildSpectraRechartsPlotProps,
  buildSpectraWebGLBranchProps,
} from '../spectraRendererProps';
import type { AggregatedStats } from '../SpectraAggregation';
import type { FoldsInfo } from '@/types/playground';

const stats: AggregatedStats = {
  mean: [1, 2],
  median: [1.1, 2.1],
  min: [0.5, 1.5],
  max: [1.5, 2.5],
  std: [0.2, 0.3],
  quantileLower: [0.8, 1.8],
  quantileUpper: [1.2, 2.2],
  n: 2,
};

const folds: FoldsInfo = {
  splitter_name: 'KFold',
  n_folds: 1,
  fold_labels: [0],
  folds: [
    {
      fold_index: 0,
      train_count: 1,
      test_count: 0,
      train_indices: [0],
      test_indices: [],
    },
  ],
};

describe('spectraRendererProps', () => {
  it('builds WebGL props for individual/both rendering', () => {
    const props = buildSpectraWebGLBranchProps({
      config: {
        ...DEFAULT_SPECTRA_CHART_CONFIG,
        viewMode: 'both',
        displayMode: 'individual',
        colorConfig: {
          ...DEFAULT_SPECTRA_CHART_CONFIG.colorConfig,
          selectionColor: '#00ff00',
          unselectedOpacity: 0.2,
        },
        enableHover: true,
      },
      wavelengthAxisLabel: 'Wavenumber (cm-1)',
      originalSpectra: [[0.8, 1.8]],
      focusedSpectra: [[1, 2]],
      focusedWavelengths: [1000, 1002],
      y: [0.4],
      sampleIds: ['sample-a'],
      folds,
      displayIndices: [0],
      sampleColors: ['#ff0000'],
      aggregatedStats: stats,
      groupedStats: new Map([['train', stats]]),
      useSelectionContext: true,
      isLoading: false,
    });

    expect(props.xLabel).toBe('Wavenumber (cm-1)');
    expect(props.spectra).toEqual([[1, 2]]);
    expect(props.originalSpectra).toEqual([[0.8, 1.8]]);
    expect(props.y).toEqual([0.4]);
    expect(props.visibleIndices).toEqual([0]);
    expect(props.aggregatedStats).toBeUndefined();
    expect(props.groupedStats).toBeUndefined();
    expect(props.useSelectionContext).toBe(true);
    expect(props.selectedColor).toBe('#00ff00');
    expect(props.unselectedOpacity).toBe(0.2);
    expect(props.showHoverTooltip).toBe(true);
    expect(props.className).toBe('absolute inset-0');
  });

  it('builds WebGL props for aggregated rendering without sample-level inputs', () => {
    const props = buildSpectraWebGLBranchProps({
      config: {
        ...DEFAULT_SPECTRA_CHART_CONFIG,
        viewMode: 'processed',
        displayMode: 'aggregated',
        enableHover: false,
      },
      wavelengthAxisLabel: 'Wavelength (nm)',
      originalSpectra: [[0.8, 1.8]],
      focusedSpectra: [[1, 2]],
      focusedWavelengths: [1000, 1002],
      y: [0.4],
      sampleIds: ['sample-a'],
      folds,
      displayIndices: [0],
      sampleColors: ['#ff0000'],
      aggregatedStats: stats,
      groupedStats: new Map([['train', stats]]),
      useSelectionContext: true,
      isLoading: true,
    });

    expect(props.spectra).toEqual([]);
    expect(props.originalSpectra).toBeUndefined();
    expect(props.y).toBeUndefined();
    expect(props.visibleIndices).toBeUndefined();
    expect(props.aggregatedStats).toBe(stats);
    expect(props.groupedStats).toBeUndefined();
    expect(props.useSelectionContext).toBe(false);
    expect(props.enableHover).toBe(false);
    expect(props.showHoverTooltip).toBe(false);
    expect(props.isLoading).toBe(true);
  });

  it('builds Recharts props with derived mode flags and normalized line color config', () => {
    const props = buildSpectraRechartsPlotProps({
      config: {
        ...DEFAULT_SPECTRA_CHART_CONFIG,
        viewMode: 'difference',
        aggregation: {
          ...DEFAULT_SPECTRA_CHART_CONFIG.aggregation,
          mode: 'median_quantiles',
        },
        colorConfig: {
          ...DEFAULT_SPECTRA_CHART_CONFIG.colorConfig,
          selectionColor: '#00ff00',
          unselectedOpacity: 0.35,
        },
        enableHover: false,
      },
      filteredData: [{ wavelength: 1000, p0: 1 }],
      highDifferenceRegions: [],
      rangeSelectionBounds: null,
      rectSelectionBounds: null,
      showGroupedAggregation: false,
      groupKeys: [],
      categoricalPalette: 'default',
      showOriginal: false,
      showProcessed: true,
      displayIndices: [0, 1],
      selectedSamples: new Set([1]),
      pinnedSamples: new Set([0]),
      hoveredSample: 1,
      hasSelection: true,
      isSelectedOnlyMode: false,
      getBaseLineColor: vi.fn(() => ({ color: 'blue', terminal: false, isOriginalBoth: false })),
      referenceSpectraCount: 5,
      sampleIds: ['a', 'b'],
      targetValues: [1, 2],
      foldLabels: [0, 1],
      wavelengthAxisName: 'Wavelength',
      wavelengthUnitSuffix: ' nm',
      onClick: vi.fn(),
      onMouseDown: vi.fn(),
      onMouseMove: vi.fn(),
      onMouseLeave: vi.fn(),
    });

    expect(props.aggregationMode).toBe('median_quantiles');
    expect(props.viewMode).toBe('difference');
    expect(props.showDifference).toBe(true);
    expect(props.viewModeBoth).toBe(false);
    expect(props.referenceLineCount).toBe(2);
    expect(props.enableHover).toBe(false);
    expect(props.colorConfig).toEqual({
      selectionOverride: false,
      highlightPinned: true,
      selectionColor: '#00ff00',
      unselectedOpacity: 0.35,
    });
  });
});
