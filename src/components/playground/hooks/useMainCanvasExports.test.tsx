/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChartType } from '@/context/usePlaygroundView';
import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

const exportMocks = vi.hoisted(() => ({
  usePlaygroundExport: vi.fn(() => ({
    exportChartPng: vi.fn(),
    exportSpectraCsv: vi.fn(),
    exportSelectionsJson: vi.fn(),
    batchExportCharts: vi.fn(),
    exportCombinedReportPng: vi.fn(),
  })),
}));

vi.mock('./usePlaygroundExport', () => ({
  usePlaygroundExport: exportMocks.usePlaygroundExport,
}));

import { useMainCanvasExports } from './useMainCanvasExports';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function renderHook<T>(hook: () => T) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  await act(async () => {
    root.render(<TestComponent />);
  });

  return {
    result,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

afterEach(() => {
  exportMocks.usePlaygroundExport.mockClear();
});

describe('useMainCanvasExports', () => {
  it('creates chart refs and passes processed export data to usePlaygroundExport', async () => {
    const rawData: SpectralData = {
      spectra: [[1, 2], [3, 4]],
      wavelengths: [1000, 1100],
      y: [10, 20],
      sampleIds: ['raw-a', 'raw-b'],
    };
    const result: PlaygroundResult = {
      original: {
        spectra: [[1, 2], [3, 4]],
        wavelengths: [1000, 1100],
        shape: [2, 2],
      },
      processed: {
        spectra: [[10, 20]],
        wavelengths: [1010, 1110],
        sample_ids: ['processed-a'],
        shape: [1, 2],
      },
      executionTimeMs: 0,
      trace: [],
      errors: [],
    };
    const selectedSamples = new Set([0]);
    const pinnedSamples = new Set([1]);
    const visibleCharts = new Set<ChartType>(['spectra', 'pca']);

    const mounted = await renderHook(() => useMainCanvasExports({
      rawData,
      result,
      selectedSamples,
      pinnedSamples,
      outlierIndices: [0],
      visibleCharts,
    }));

    expect(mounted.result.current?.chartRefs).toMatchObject({
      spectra: { current: null },
      histogram: { current: null },
      pca: { current: null },
      folds: { current: null },
      repetitions: { current: null },
    });
    expect(exportMocks.usePlaygroundExport).toHaveBeenCalledWith({
      chartRefs: mounted.result.current?.chartRefs,
      exportData: {
        spectra: [[10, 20]],
        wavelengths: [1010, 1110],
        sampleIds: ['processed-a'],
        selectedSamples,
        pinnedSamples,
        outlierIndices: new Set([0]),
      },
      visibleCharts,
    });

    await mounted.unmount();
  });
});
