import type { ChartType, ViewState } from '@/context/usePlaygroundView';
import type { PerChartLoadingState } from '@/types/playground';

export interface CanvasGridLayout {
  gridCols: string;
  gridRows: string;
}

export interface CanvasChartRenderState {
  shouldRender: boolean;
  viewState: ViewState;
  isMaximized: boolean;
  isLoading: boolean;
  showSkeleton: boolean;
}

export type CanvasChartRenderStates = Record<ChartType, CanvasChartRenderState>;

interface CanvasChartRenderStateBaseInput {
  visibleCharts: Set<ChartType>;
  getChartViewState: (chart: ChartType) => ViewState;
  hasMaximized: boolean;
  maximizedChart: ChartType | null;
  chartLoading: PerChartLoadingState;
  showSkeletons: boolean;
  isChartMounted: (chart: ChartType) => boolean;
}

export function computeCanvasGridLayout(visibleCount: number, hasMaximized: boolean): CanvasGridLayout {
  if (hasMaximized) {
    return { gridCols: 'grid-cols-1', gridRows: 'grid-rows-1' };
  }

  switch (visibleCount) {
    case 1:
      return { gridCols: 'grid-cols-1', gridRows: 'grid-rows-1' };
    case 2:
      return { gridCols: 'grid-cols-1 sm:grid-cols-2', gridRows: 'grid-rows-1' };
    case 3:
      return { gridCols: 'grid-cols-2', gridRows: 'grid-rows-2' };
    case 4:
      return { gridCols: 'grid-cols-2', gridRows: 'grid-rows-2' };
    case 5:
    default:
      return { gridCols: 'grid-cols-2', gridRows: 'grid-rows-3' };
  }
}

export function buildEffectiveVisibleCharts(
  visibleCharts: Set<ChartType>,
  showFoldsChart: boolean
): Set<ChartType> {
  const visible = new Set(visibleCharts);
  if (!showFoldsChart && visible.has('folds')) {
    visible.delete('folds');
  }
  return visible;
}

export function countVisibleNonMinimizedCharts(
  visibleCharts: Set<ChartType>,
  getChartViewState: (chart: ChartType) => ViewState
): number {
  let count = 0;
  for (const chart of visibleCharts) {
    const state = getChartViewState(chart);
    if (state === 'visible' || state === 'maximized') {
      count++;
    }
  }
  return count;
}

export function shouldRenderCanvasChart({
  chart,
  visibleCharts,
  getChartViewState,
  hasMaximized,
  maximizedChart,
}: {
  chart: ChartType;
  visibleCharts: Set<ChartType>;
  getChartViewState: (chart: ChartType) => ViewState;
  hasMaximized: boolean;
  maximizedChart: ChartType | null;
}): boolean {
  if (!visibleCharts.has(chart)) return false;

  const state = getChartViewState(chart);
  if (state === 'hidden') return false;
  if (hasMaximized && maximizedChart !== chart) return false;

  return true;
}

export function buildCanvasChartRenderState({
  chart,
  visibleCharts,
  getChartViewState,
  hasMaximized,
  maximizedChart,
  chartLoading,
  showSkeletons,
  isChartMounted,
}: {
  chart: ChartType;
} & CanvasChartRenderStateBaseInput): CanvasChartRenderState {
  return {
    shouldRender: shouldRenderCanvasChart({
      chart,
      visibleCharts,
      getChartViewState,
      hasMaximized,
      maximizedChart,
    }),
    viewState: getChartViewState(chart),
    isMaximized: maximizedChart === chart,
    isLoading: chartLoading[chart],
    showSkeleton: showSkeletons || !isChartMounted(chart),
  };
}

export function buildCanvasChartRenderStates(input: CanvasChartRenderStateBaseInput): CanvasChartRenderStates {
  const buildRenderState = (chart: ChartType) => buildCanvasChartRenderState({
    chart,
    ...input,
  });

  return {
    spectra: buildRenderState('spectra'),
    histogram: buildRenderState('histogram'),
    folds: buildRenderState('folds'),
    pca: buildRenderState('pca'),
    repetitions: buildRenderState('repetitions'),
  };
}

export function getMinimizedCanvasCharts(
  visibleCharts: Set<ChartType>,
  getChartViewState: (chart: ChartType) => ViewState
): ChartType[] {
  return Array.from(visibleCharts).filter(chart => getChartViewState(chart) === 'minimized');
}

export function buildEffectiveChartLoading(
  chartLoadingStates: PerChartLoadingState | undefined,
  isUmapLoading: boolean
): PerChartLoadingState {
  if (chartLoadingStates) {
    return {
      spectra: chartLoadingStates.spectra,
      histogram: chartLoadingStates.histogram,
      pca: chartLoadingStates.pca || isUmapLoading,
      folds: chartLoadingStates.folds,
      repetitions: chartLoadingStates.repetitions,
    };
  }

  return {
    spectra: false,
    histogram: false,
    pca: isUmapLoading,
    folds: false,
    repetitions: false,
  };
}
