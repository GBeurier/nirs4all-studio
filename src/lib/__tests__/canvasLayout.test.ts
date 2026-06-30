import { describe, expect, it } from 'vitest';

import {
  buildCanvasChartRenderState,
  buildCanvasChartRenderStates,
  buildEffectiveChartLoading,
  buildEffectiveVisibleCharts,
  computeCanvasGridLayout,
  countVisibleNonMinimizedCharts,
  getMinimizedCanvasCharts,
  shouldRenderCanvasChart,
} from '@/lib/playground/canvasLayout';
import type { ChartType, ViewState } from '@/context/usePlaygroundView';

const allCharts = new Set<ChartType>(['spectra', 'histogram', 'pca', 'folds', 'repetitions']);

describe('canvas layout helpers', () => {
  it('computes grid classes from visible chart count and maximized state', () => {
    expect(computeCanvasGridLayout(1, false)).toEqual({ gridCols: 'grid-cols-1', gridRows: 'grid-rows-1' });
    expect(computeCanvasGridLayout(2, false)).toEqual({ gridCols: 'grid-cols-1 sm:grid-cols-2', gridRows: 'grid-rows-1' });
    expect(computeCanvasGridLayout(3, false)).toEqual({ gridCols: 'grid-cols-2', gridRows: 'grid-rows-2' });
    expect(computeCanvasGridLayout(5, false)).toEqual({ gridCols: 'grid-cols-2', gridRows: 'grid-rows-3' });
    expect(computeCanvasGridLayout(5, true)).toEqual({ gridCols: 'grid-cols-1', gridRows: 'grid-rows-1' });
  });

  it('removes folds from effective visibility when no fold or partition chart is available', () => {
    expect(Array.from(buildEffectiveVisibleCharts(allCharts, false))).toEqual([
      'spectra',
      'histogram',
      'pca',
      'repetitions',
    ]);
    expect(Array.from(buildEffectiveVisibleCharts(allCharts, true))).toEqual(Array.from(allCharts));
  });

  it('counts and lists charts by view state', () => {
    const states: Record<ChartType, ViewState> = {
      spectra: 'visible',
      histogram: 'minimized',
      pca: 'hidden',
      folds: 'maximized',
      repetitions: 'visible',
    };
    const getState = (chart: ChartType) => states[chart];

    expect(countVisibleNonMinimizedCharts(allCharts, getState)).toBe(3);
    expect(getMinimizedCanvasCharts(allCharts, getState)).toEqual(['histogram']);
  });

  it('decides whether a chart should render in normal and maximized layouts', () => {
    const states: Record<ChartType, ViewState> = {
      spectra: 'visible',
      histogram: 'hidden',
      pca: 'visible',
      folds: 'minimized',
      repetitions: 'visible',
    };
    const getState = (chart: ChartType) => states[chart];

    expect(shouldRenderCanvasChart({
      chart: 'spectra',
      visibleCharts: allCharts,
      getChartViewState: getState,
      hasMaximized: false,
      maximizedChart: null,
    })).toBe(true);
    expect(shouldRenderCanvasChart({
      chart: 'histogram',
      visibleCharts: allCharts,
      getChartViewState: getState,
      hasMaximized: false,
      maximizedChart: null,
    })).toBe(false);
    expect(shouldRenderCanvasChart({
      chart: 'spectra',
      visibleCharts: allCharts,
      getChartViewState: getState,
      hasMaximized: true,
      maximizedChart: 'pca',
    })).toBe(false);
    expect(shouldRenderCanvasChart({
      chart: 'pca',
      visibleCharts: allCharts,
      getChartViewState: getState,
      hasMaximized: true,
      maximizedChart: 'pca',
    })).toBe(true);
  });

  it('merges granular loading states with UMAP loading and supplies fallback states', () => {
    expect(buildEffectiveChartLoading({
      spectra: true,
      histogram: false,
      pca: false,
      folds: false,
      repetitions: true,
    }, true)).toEqual({
      spectra: true,
      histogram: false,
      pca: true,
      folds: false,
      repetitions: true,
    });

    expect(buildEffectiveChartLoading(undefined, true)).toEqual({
      spectra: false,
      histogram: false,
      pca: true,
      folds: false,
      repetitions: false,
    });
  });

  it('builds chart render state from layout, loading, and mount policy', () => {
    const states: Record<ChartType, ViewState> = {
      spectra: 'visible',
      histogram: 'hidden',
      pca: 'visible',
      folds: 'minimized',
      repetitions: 'visible',
    };
    const loading = {
      spectra: true,
      histogram: false,
      pca: false,
      folds: false,
      repetitions: false,
    };

    expect(buildCanvasChartRenderState({
      chart: 'spectra',
      visibleCharts: allCharts,
      getChartViewState: (chart) => states[chart],
      hasMaximized: false,
      maximizedChart: null,
      chartLoading: loading,
      showSkeletons: false,
      isChartMounted: (chart) => chart !== 'spectra',
    })).toEqual({
      shouldRender: true,
      viewState: 'visible',
      isMaximized: false,
      isLoading: true,
      showSkeleton: true,
    });

    expect(buildCanvasChartRenderState({
      chart: 'pca',
      visibleCharts: allCharts,
      getChartViewState: (chart) => states[chart],
      hasMaximized: true,
      maximizedChart: 'pca',
      chartLoading: loading,
      showSkeletons: true,
      isChartMounted: () => true,
    })).toMatchObject({
      shouldRender: true,
      viewState: 'visible',
      isMaximized: true,
      isLoading: false,
      showSkeleton: true,
    });
  });

  it('builds the complete chart render-state map for MainCanvas', () => {
    const states: Record<ChartType, ViewState> = {
      spectra: 'visible',
      histogram: 'hidden',
      pca: 'maximized',
      folds: 'minimized',
      repetitions: 'visible',
    };
    const loading = {
      spectra: false,
      histogram: true,
      pca: true,
      folds: false,
      repetitions: false,
    };

    const renderStates = buildCanvasChartRenderStates({
      visibleCharts: allCharts,
      getChartViewState: (chart) => states[chart],
      hasMaximized: true,
      maximizedChart: 'pca',
      chartLoading: loading,
      showSkeletons: false,
      isChartMounted: (chart) => chart !== 'repetitions',
    });

    expect(Object.keys(renderStates)).toEqual(['spectra', 'histogram', 'folds', 'pca', 'repetitions']);
    expect(renderStates.pca).toMatchObject({
      shouldRender: true,
      viewState: 'maximized',
      isMaximized: true,
      isLoading: true,
      showSkeleton: false,
    });
    expect(renderStates.spectra.shouldRender).toBe(false);
    expect(renderStates.repetitions.showSkeleton).toBe(true);
  });

  it('keeps folds hidden through effective visibility before render-state construction', () => {
    const visibleCharts = buildEffectiveVisibleCharts(allCharts, false);
    const states: Record<ChartType, ViewState> = {
      spectra: 'visible',
      histogram: 'visible',
      pca: 'visible',
      folds: 'visible',
      repetitions: 'visible',
    };
    const loading = {
      spectra: false,
      histogram: false,
      pca: false,
      folds: false,
      repetitions: false,
    };

    const renderStates = buildCanvasChartRenderStates({
      visibleCharts,
      getChartViewState: (chart) => states[chart],
      hasMaximized: false,
      maximizedChart: null,
      chartLoading: loading,
      showSkeletons: false,
      isChartMounted: () => true,
    });

    expect(renderStates.folds).toMatchObject({
      shouldRender: false,
      viewState: 'visible',
    });
    expect(renderStates.spectra.shouldRender).toBe(true);
  });
});
