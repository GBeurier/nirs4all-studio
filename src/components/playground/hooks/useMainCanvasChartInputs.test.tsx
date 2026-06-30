/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlaygroundChartInputReadModel } from '@/lib/playground/chartInputs';
import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

const chartInputMocks = vi.hoisted(() => {
  const currentReadModel = {
    dataAvailability: {
      hasSpectraData: false,
      hasHistogramData: true,
      hasDimensionReductionData: false,
      hasFoldDistributionData: false,
      hasRepetitionData: false,
    },
    metricObservationCapability: {
      hasFilterableMetrics: false,
      hasMetricObservations: false,
      metricKeys: [],
    },
  } satisfies PlaygroundChartInputReadModel;
  const deferredReadModel = {
    dataAvailability: {
      hasSpectraData: false,
      hasHistogramData: true,
      hasDimensionReductionData: true,
      hasFoldDistributionData: false,
      hasRepetitionData: true,
    },
    metricObservationCapability: {
      hasFilterableMetrics: false,
      hasMetricObservations: false,
      metricKeys: [],
    },
  } satisfies PlaygroundChartInputReadModel;

  return {
    currentReadModel,
    deferredReadModel,
    buildPlaygroundChartInputReadModel: vi.fn((context: { result: unknown }) => (
      context.result == null ? currentReadModel : deferredReadModel
    )),
  };
});

vi.mock('@/lib/playground/chartInputs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/playground/chartInputs')>();
  return {
    ...actual,
    buildPlaygroundChartInputReadModel: chartInputMocks.buildPlaygroundChartInputReadModel,
  };
});

import { useMainCanvasChartInputs } from './useMainCanvasChartInputs';

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
  chartInputMocks.buildPlaygroundChartInputReadModel.mockClear();
});

describe('useMainCanvasChartInputs', () => {
  it('propagates the centralized chart input read model to histogram inputs', async () => {
    const mounted = await renderHook(() => useMainCanvasChartInputs({
      rawData: null,
      result: null,
      deferredResult: null,
    }));

    expect(chartInputMocks.buildPlaygroundChartInputReadModel).toHaveBeenNthCalledWith(1, {
      rawData: null,
      result: null,
      dataView: expect.objectContaining({
        id: 'legacy-spectral:view:default',
      }),
    });
    expect(chartInputMocks.buildPlaygroundChartInputReadModel).toHaveBeenNthCalledWith(2, {
      rawData: null,
      result: null,
      dataView: expect.objectContaining({
        id: 'legacy-spectral:view:default',
      }),
    });
    expect(mounted.result.current?.histogramChartInput).toEqual({
      y: [],
      folds: null,
      metadata: undefined,
      hasYValues: true,
    });
    expect(mounted.result.current?.foldDistributionChartInput).toEqual({
      y: [],
      folds: null,
      metadata: undefined,
      hasFoldDistributionData: false,
    });
    expect(mounted.result.current?.dimensionReductionChartInput).toBeNull();
    expect(mounted.result.current?.repetitionsChartInput).toMatchObject({
      repetitionData: null,
      spectraData: undefined,
      y: [],
      hasRepetitionData: false,
    });

    await mounted.unmount();
  });

  it('uses a read model derived from deferred results for deferred chart inputs', async () => {
    const rawData: SpectralData = {
      spectra: [[1, 2], [3, 4]],
      wavelengths: [1100, 1200],
      y: [10, 20],
      sampleIds: ['raw-1', 'raw-2'],
    };
    const deferredResult: PlaygroundResult = {
      original: {
        spectra: [[1, 2], [3, 4]],
        wavelengths: [1100, 1200],
        y: [10, 20],
        shape: [2, 2],
      },
      processed: {
        spectra: [[2, 4], [6, 8]],
        wavelengths: [1100, 1200],
        sample_ids: ['processed-1', 'processed-2'],
        shape: [2, 2],
      },
      pca: {
        coordinates: [[0, 1], [1, 0]],
        explained_variance_ratio: [0.8, 0.2],
        explained_variance: [8, 2],
        n_components: 2,
      },
      repetitions: {
        has_repetitions: true,
        n_bio_samples: 1,
        n_with_reps: 1,
      },
      executionTimeMs: 1,
      trace: [],
      errors: [],
    };

    const mounted = await renderHook(() => useMainCanvasChartInputs({
      rawData,
      result: null,
      deferredResult,
    }));

    expect(chartInputMocks.buildPlaygroundChartInputReadModel).toHaveBeenNthCalledWith(2, {
      rawData,
      result: deferredResult,
      dataView: expect.objectContaining({
        id: 'playground:legacy:view:default',
      }),
    });
    expect(mounted.result.current?.dimensionReductionChartInput).toMatchObject({
      pca: deferredResult.pca,
      y: [10, 20],
    });
    expect(mounted.result.current?.repetitionsChartInput).toMatchObject({
      repetitionData: deferredResult.repetitions,
      hasRepetitionData: true,
    });

    await mounted.unmount();
  });
});
