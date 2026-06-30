import { useCallback, useMemo, useState } from 'react';

import {
  type ChartType,
  type ViewState,
  usePlaygroundViewOptional,
} from '@/context/usePlaygroundView';

const DEFAULT_LOCAL_VISIBLE_CHARTS: ChartType[] = ['spectra', 'histogram', 'pca'];

export interface MainCanvasChartActions {
  onMaximize: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onHide: () => void;
}

export interface UseMainCanvasViewStateOptions {
  onChartToggle?: (chart: ChartType) => void;
}

export interface UseMainCanvasViewStateResult {
  visibleCharts: Set<ChartType>;
  maximizedChart: ChartType | null;
  toggleChart: (chart: ChartType) => void;
  getChartViewState: (chart: ChartType) => ViewState;
  handleMaximize: (chart: ChartType) => void;
  handleMinimize: (chart: ChartType) => void;
  handleRestore: (chart: ChartType) => void;
  handleHide: (chart: ChartType) => void;
  chartActions: Record<ChartType, MainCanvasChartActions>;
}

export function useMainCanvasViewState({
  onChartToggle,
}: UseMainCanvasViewStateOptions = {}): UseMainCanvasViewStateResult {
  const viewContext = usePlaygroundViewOptional();

  const [localVisibleCharts, setLocalVisibleCharts] = useState<Set<ChartType>>(
    () => new Set(DEFAULT_LOCAL_VISIBLE_CHARTS)
  );
  const [localMaximizedChart, setLocalMaximizedChart] = useState<ChartType | null>(null);
  const [localMinimizedCharts, setLocalMinimizedCharts] = useState<Set<ChartType>>(() => new Set());

  const visibleCharts = viewContext?.visibleCharts ?? localVisibleCharts;
  const maximizedChart = viewContext?.maximizedChart ?? localMaximizedChart;

  const toggleChart = useCallback((chart: ChartType) => {
    if (viewContext) {
      viewContext.toggleChart(chart);
    } else {
      setLocalVisibleCharts(prev => {
        const next = new Set(prev);
        if (next.has(chart)) {
          next.delete(chart);
        } else {
          next.add(chart);
        }
        return next;
      });
    }

    onChartToggle?.(chart);
  }, [viewContext, onChartToggle]);

  const getChartViewState = useCallback((chart: ChartType): ViewState => {
    if (viewContext) {
      return viewContext.chartStates[chart];
    }
    if (!localVisibleCharts.has(chart)) return 'hidden';
    if (localMaximizedChart === chart) return 'maximized';
    if (localMinimizedCharts.has(chart)) return 'minimized';
    return 'visible';
  }, [viewContext, localVisibleCharts, localMaximizedChart, localMinimizedCharts]);

  const handleMaximize = useCallback((chart: ChartType) => {
    if (viewContext) {
      viewContext.maximizeChart(chart);
    } else {
      setLocalMaximizedChart(chart);
    }
  }, [viewContext]);

  const handleMinimize = useCallback((chart: ChartType) => {
    if (viewContext) {
      viewContext.minimizeChart(chart);
    } else {
      setLocalMinimizedCharts(prev => new Set([...prev, chart]));
    }
  }, [viewContext]);

  const handleRestore = useCallback((chart: ChartType) => {
    if (viewContext) {
      viewContext.restoreChart(chart);
    } else {
      if (localMaximizedChart === chart) {
        setLocalMaximizedChart(null);
      }
      setLocalMinimizedCharts(prev => {
        const next = new Set(prev);
        next.delete(chart);
        return next;
      });
    }
  }, [viewContext, localMaximizedChart]);

  const handleHide = useCallback((chart: ChartType) => {
    toggleChart(chart);
  }, [toggleChart]);

  const chartActions = useMemo<Record<ChartType, MainCanvasChartActions>>(() => ({
    spectra: {
      onMaximize: () => handleMaximize('spectra'),
      onMinimize: () => handleMinimize('spectra'),
      onRestore: () => handleRestore('spectra'),
      onHide: () => handleHide('spectra'),
    },
    histogram: {
      onMaximize: () => handleMaximize('histogram'),
      onMinimize: () => handleMinimize('histogram'),
      onRestore: () => handleRestore('histogram'),
      onHide: () => handleHide('histogram'),
    },
    folds: {
      onMaximize: () => handleMaximize('folds'),
      onMinimize: () => handleMinimize('folds'),
      onRestore: () => handleRestore('folds'),
      onHide: () => handleHide('folds'),
    },
    pca: {
      onMaximize: () => handleMaximize('pca'),
      onMinimize: () => handleMinimize('pca'),
      onRestore: () => handleRestore('pca'),
      onHide: () => handleHide('pca'),
    },
    repetitions: {
      onMaximize: () => handleMaximize('repetitions'),
      onMinimize: () => handleMinimize('repetitions'),
      onRestore: () => handleRestore('repetitions'),
      onHide: () => handleHide('repetitions'),
    },
  }), [handleHide, handleMaximize, handleMinimize, handleRestore]);

  return {
    visibleCharts,
    maximizedChart,
    toggleChart,
    getChartViewState,
    handleMaximize,
    handleMinimize,
    handleRestore,
    handleHide,
    chartActions,
  };
}
