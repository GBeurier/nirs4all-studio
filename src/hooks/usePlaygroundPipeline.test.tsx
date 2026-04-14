/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const toastMocks = vi.hoisted(() => ({
  warning: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

const queryMocks = vi.hoisted(() => ({
  usePlaygroundQuery: vi.fn(() => ({
    result: null,
    isLoading: false,
    isFetching: false,
    isDebouncing: false,
    error: null,
    refetch: vi.fn(),
  })),
  useChangeDetection: vi.fn(() => ({
    chartLoadingStates: {
      spectra: false,
      histogram: false,
      pca: false,
      folds: false,
      repetitions: false,
    },
    markStable: vi.fn(),
  })),
}));

vi.mock('sonner', () => ({
  toast: toastMocks,
}));

vi.mock('./usePlaygroundQuery', () => ({
  usePlaygroundQuery: queryMocks.usePlaygroundQuery,
}));

vi.mock('./useChangeDetection', () => ({
  useChangeDetection: queryMocks.useChangeDetection,
}));

import { usePlaygroundPipeline } from './usePlaygroundPipeline';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function createLegacySessionState(operators: Array<{
  id: string;
  name: string;
  type: 'preprocessing' | 'splitting' | 'filter' | 'augmentation';
  params: Record<string, unknown>;
  enabled: boolean;
}>) {
  return JSON.stringify({
    datasetId: null,
    datasetName: null,
    dataSource: null,
    operators,
    chartVisibility: {
      spectra: true,
      histogram: true,
      pca: true,
      folds: true,
      repetitions: false,
    },
    renderMode: 'auto',
    stepComparisonEnabled: false,
    activeStep: 0,
    savedAt: Date.now(),
  });
}

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
  sessionStorage.clear();
  toastMocks.warning.mockReset();
  toastMocks.success.mockReset();
  toastMocks.info.mockReset();
  toastMocks.error.mockReset();
  queryMocks.usePlaygroundQuery.mockClear();
  queryMocks.useChangeDetection.mockClear();
});

describe('usePlaygroundPipeline', () => {
  it('starts empty even when legacy session operators exist', async () => {
    sessionStorage.setItem(
      'playground-session-state',
      createLegacySessionState([
        {
          id: 'legacy-splitter',
          name: 'KFold',
          type: 'splitting',
          params: { n_splits: 5 },
          enabled: true,
        },
      ]),
    );

    const mounted = await renderHook(() => usePlaygroundPipeline(null, { enableBackend: false }));

    expect(mounted.result.current?.operators).toEqual([]);
    expect(mounted.result.current?.hasSplitter).toBe(false);

    await mounted.unmount();
  });

  it('keeps sequential additions in the same tick instead of dropping earlier operators', async () => {
    const mounted = await renderHook(() => usePlaygroundPipeline(null, { enableBackend: false }));

    await act(async () => {
      mounted.result.current?.addOperatorByName('SNV', 'preprocessing');
      mounted.result.current?.addOperatorByName('KFold', 'splitting', { n_splits: 5 });
    });

    expect(mounted.result.current?.operators.map((operator) => operator.name)).toEqual(['SNV', 'KFold']);
    expect(mounted.result.current?.hasSplitter).toBe(true);

    await mounted.unmount();
  });

  it('does not warn about replacing a splitter after the pipeline was cleared in the same interaction', async () => {
    sessionStorage.setItem(
      'playground-pipeline-state',
      JSON.stringify([
        {
          id: 'existing-splitter',
          name: 'ShuffleSplit',
          type: 'splitting',
          params: { test_size: 0.25 },
          enabled: true,
        },
      ]),
    );

    const mounted = await renderHook(() => usePlaygroundPipeline(null, { enableBackend: false }));

    await act(async () => {
      mounted.result.current?.clearPipeline();
      mounted.result.current?.addOperatorByName('KFold', 'splitting', { n_splits: 5 });
    });

    expect(toastMocks.warning).not.toHaveBeenCalled();
    expect(mounted.result.current?.operators).toHaveLength(1);
    expect(mounted.result.current?.operators[0]).toMatchObject({
      name: 'KFold',
      type: 'splitting',
      params: { n_splits: 5 },
    });

    await mounted.unmount();
  });
});
