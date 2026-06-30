/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ShapResultsResponse } from '@/types/shap';

const apiMocks = vi.hoisted(() => ({
  computeShapExplanation: vi.fn(),
  getShapResults: vi.fn(),
  getShapStatus: vi.fn(),
}));

const websocketMockState = vi.hoisted(() => ({
  current: {
    status: null as 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | null,
    progress: 0,
    progressMessage: '',
    error: null as string | null,
  },
}));

vi.mock('@/api/shap', () => ({
  computeShapExplanation: apiMocks.computeShapExplanation,
  getShapResults: apiMocks.getShapResults,
  getShapStatus: apiMocks.getShapStatus,
}));

vi.mock('@/hooks/useWebSocket', () => ({
  useJobUpdates: () => websocketMockState.current,
}));

import { useShapAnalysisJob } from './useShapAnalysisJob';

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

async function flushAsyncEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function shapResults(overrides: Partial<ShapResultsResponse> = {}): ShapResultsResponse {
  return {
    job_id: 'job-1',
    model_id: 'chain-1',
    dataset_id: 'corn',
    explainer_type: 'auto',
    n_samples: 10,
    n_features: 3,
    base_value: 0.5,
    execution_time_ms: 42,
    feature_importance: [],
    wavelengths: [1100, 1200, 1300],
    mean_abs_shap: [0.1, 0.2, 0.3],
    mean_spectrum: [1, 2, 3],
    binned_importance: {
      bin_centers: [1150],
      bin_values: [0.6],
      bin_ranges: [[1100, 1200]],
      bin_size: 2,
      bin_stride: 1,
      aggregation: 'mean_abs',
    },
    sample_indices: [0, 1, 2],
    ...overrides,
  };
}

afterEach(() => {
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  websocketMockState.current = {
    status: null,
    progress: 0,
    progressMessage: '',
    error: null,
  };
});

describe('useShapAnalysisJob', () => {
  it('builds and runs a completed workspace-chain SHAP job', async () => {
    apiMocks.computeShapExplanation.mockResolvedValue({
      job_id: 'job-1',
      status: 'completed',
      message: 'done',
    });
    apiMocks.getShapResults.mockResolvedValue(shapResults({ job_id: 'job-1' }));

    const mounted = await renderHook(() => useShapAnalysisJob());

    await act(async () => {
      await mounted.result.current?.runAnalysis({
        chainId: 'chain-1',
        datasetName: 'corn',
        partition: 'test',
        explainerType: 'auto',
      });
    });

    expect(apiMocks.computeShapExplanation).toHaveBeenCalledWith({
      chain_id: 'chain-1',
      bundle_path: undefined,
      dataset_id: 'corn',
      partition: 'test',
      explainer_type: 'auto',
      n_samples: null,
      n_background: 100,
      bin_size: 20,
      bin_stride: 10,
      bin_aggregation: 'sum',
    });
    expect(apiMocks.getShapResults).toHaveBeenCalledWith('job-1');
    expect(mounted.result.current?.jobId).toBe('job-1');
    expect(mounted.result.current?.results?.job_id).toBe('job-1');
    expect(mounted.result.current?.isSubmitting).toBe(false);
    expect(mounted.result.current?.selectedSamples).toEqual([]);

    await mounted.unmount();
  });

  it('uses an explicit bundle model ref when the UI selection provides one', async () => {
    apiMocks.computeShapExplanation.mockResolvedValue({
      job_id: 'job-bundle',
      status: 'running',
      message: 'queued',
    });

    const mounted = await renderHook(() => useShapAnalysisJob());

    await act(async () => {
      await mounted.result.current?.runAnalysis({
        chainId: 'bundle-without-path-shape',
        modelRef: { modelSource: 'bundle', bundlePath: 'bundle-without-path-shape' },
        datasetName: 'corn',
        partition: 'train',
        explainerType: 'kernel',
      });
    });

    expect(apiMocks.computeShapExplanation).toHaveBeenCalledWith(expect.objectContaining({
      chain_id: undefined,
      bundle_path: 'bundle-without-path-shape',
      dataset_id: 'corn',
      partition: 'train',
      explainer_type: 'kernel',
    }));

    await mounted.unmount();
  });

  it('reports a selection error without calling the backend', async () => {
    const mounted = await renderHook(() => useShapAnalysisJob());

    await act(async () => {
      await mounted.result.current?.runAnalysis({
        chainId: null,
        datasetName: 'corn',
        partition: 'test',
        explainerType: 'auto',
      });
    });

    expect(apiMocks.computeShapExplanation).not.toHaveBeenCalled();
    expect(mounted.result.current?.error).toBe('Please select a model to explain.');

    await mounted.unmount();
  });

  it('restores a completed persisted SHAP job', async () => {
    apiMocks.getShapStatus.mockResolvedValue({ status: 'completed' });
    apiMocks.getShapResults.mockResolvedValue(shapResults({ job_id: 'job-restored' }));

    const mounted = await renderHook(() => useShapAnalysisJob({
      jobId: 'job-restored',
      isSubmitting: true,
      selectedSamples: [4, 8],
    }));

    await flushAsyncEffects();

    expect(apiMocks.getShapStatus).toHaveBeenCalledWith('job-restored');
    expect(apiMocks.getShapResults).toHaveBeenCalledWith('job-restored');
    expect(mounted.result.current?.results?.job_id).toBe('job-restored');
    expect(mounted.result.current?.selectedSamples).toEqual([]);
    expect(mounted.result.current?.isSubmitting).toBe(false);
    expect(mounted.result.current?.error).toBeNull();

    await mounted.unmount();
  });
});
