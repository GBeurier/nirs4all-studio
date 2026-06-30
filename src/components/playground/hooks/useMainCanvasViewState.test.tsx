/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlaygroundViewProvider } from '@/context/PlaygroundViewContext';
import type { ChartType } from '@/context/usePlaygroundView';

import { useMainCanvasViewState } from './useMainCanvasViewState';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

interface RenderHookOptions {
  wrapper?: (props: { children: ReactNode }) => ReactNode;
}

async function renderHook<T>(hook: () => T, options: RenderHookOptions = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  const element = options.wrapper
    ? options.wrapper({ children: <TestComponent /> })
    : <TestComponent />;

  await act(async () => {
    root.render(element);
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

function sortedCharts(charts: Set<ChartType>) {
  return [...charts].sort();
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useMainCanvasViewState', () => {
  it('manages fallback chart visibility and local view state without a provider', async () => {
    const onChartToggle = vi.fn();
    const mounted = await renderHook(() => useMainCanvasViewState({ onChartToggle }));

    expect(sortedCharts(mounted.result.current!.visibleCharts)).toEqual(['histogram', 'pca', 'spectra']);
    expect(mounted.result.current!.maximizedChart).toBeNull();
    expect(mounted.result.current!.getChartViewState('folds')).toBe('hidden');

    await act(async () => {
      mounted.result.current!.toggleChart('folds');
    });
    expect(onChartToggle).toHaveBeenCalledWith('folds');
    expect(mounted.result.current!.visibleCharts.has('folds')).toBe(true);
    expect(mounted.result.current!.getChartViewState('folds')).toBe('visible');

    await act(async () => {
      mounted.result.current!.handleMaximize('pca');
    });
    expect(mounted.result.current!.maximizedChart).toBe('pca');
    expect(mounted.result.current!.getChartViewState('pca')).toBe('maximized');

    await act(async () => {
      mounted.result.current!.handleMinimize('histogram');
    });
    expect(mounted.result.current!.getChartViewState('histogram')).toBe('minimized');

    await act(async () => {
      mounted.result.current!.handleRestore('histogram');
      mounted.result.current!.handleRestore('pca');
    });
    expect(mounted.result.current!.maximizedChart).toBeNull();
    expect(mounted.result.current!.getChartViewState('histogram')).toBe('visible');
    expect(mounted.result.current!.getChartViewState('pca')).toBe('visible');

    await act(async () => {
      mounted.result.current!.handleHide('pca');
    });
    expect(onChartToggle).toHaveBeenCalledWith('pca');
    expect(mounted.result.current!.getChartViewState('pca')).toBe('hidden');

    await mounted.unmount();
  });

  it('delegates chart state to PlaygroundViewProvider when available', async () => {
    const onChartToggle = vi.fn();
    const mounted = await renderHook(
      () => useMainCanvasViewState({ onChartToggle }),
      {
        wrapper: ({ children }) => (
          <PlaygroundViewProvider initialVisibleCharts={['spectra']}>
            {children}
          </PlaygroundViewProvider>
        ),
      }
    );

    expect(sortedCharts(mounted.result.current!.visibleCharts)).toEqual(['spectra']);

    await act(async () => {
      mounted.result.current!.toggleChart('repetitions');
    });
    expect(onChartToggle).toHaveBeenCalledWith('repetitions');
    expect(mounted.result.current!.visibleCharts.has('repetitions')).toBe(true);
    expect(mounted.result.current!.getChartViewState('repetitions')).toBe('visible');

    await act(async () => {
      mounted.result.current!.handleMinimize('repetitions');
    });
    expect(mounted.result.current!.getChartViewState('repetitions')).toBe('minimized');

    await act(async () => {
      mounted.result.current!.handleRestore('repetitions');
    });
    expect(mounted.result.current!.getChartViewState('repetitions')).toBe('visible');

    await mounted.unmount();
  });

  it('exposes reusable per-chart panel actions', async () => {
    const onChartToggle = vi.fn();
    const mounted = await renderHook(() => useMainCanvasViewState({ onChartToggle }));

    await act(async () => {
      mounted.result.current!.chartActions.spectra.onMaximize();
    });
    expect(mounted.result.current!.maximizedChart).toBe('spectra');
    expect(mounted.result.current!.getChartViewState('spectra')).toBe('maximized');

    await act(async () => {
      mounted.result.current!.chartActions.spectra.onRestore();
    });
    expect(mounted.result.current!.maximizedChart).toBeNull();
    expect(mounted.result.current!.getChartViewState('spectra')).toBe('visible');

    await act(async () => {
      mounted.result.current!.chartActions.histogram.onMinimize();
    });
    expect(mounted.result.current!.getChartViewState('histogram')).toBe('minimized');

    await act(async () => {
      mounted.result.current!.chartActions.histogram.onHide();
    });
    expect(onChartToggle).toHaveBeenCalledWith('histogram');
    expect(mounted.result.current!.getChartViewState('histogram')).toBe('hidden');

    await mounted.unmount();
  });
});
