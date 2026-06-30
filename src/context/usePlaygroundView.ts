import { createContext, useContext } from 'react';
import {
  PLAYGROUND_CHART_IDS,
  type PlaygroundChartId,
} from '@/lib/playground/chartIds';

export type ChartType = PlaygroundChartId;

export type ViewState = 'visible' | 'hidden' | 'maximized' | 'minimized';

export type LayoutMode = 'auto' | 'horizontal' | 'vertical' | 'grid';

export interface PlaygroundViewState {
  /** Visibility state for each chart */
  chartStates: Record<ChartType, ViewState>;
  /** Currently maximized chart (null if none) */
  maximizedChart: ChartType | null;
  /** Currently focused chart for keyboard navigation */
  focusedChart: ChartType | null;
  /** Layout mode for the grid */
  layoutMode: LayoutMode;
}

export interface PlaygroundViewContextValue extends PlaygroundViewState {
  // Chart visibility
  setChartState: (chart: ChartType, state: ViewState) => void;
  toggleChart: (chart: ChartType) => void;
  isChartVisible: (chart: ChartType) => boolean;
  isChartMinimized: (chart: ChartType) => boolean;

  // Maximize/minimize
  maximizeChart: (chart: ChartType | null) => void;
  minimizeChart: (chart: ChartType) => void;
  restoreChart: (chart: ChartType) => void;
  toggleMaximize: (chart: ChartType) => void;

  // Focus
  setFocusedChart: (chart: ChartType | null) => void;

  // Layout
  setLayoutMode: (mode: LayoutMode) => void;

  // Bulk operations
  showAllCharts: () => void;
  hideAllCharts: () => void;
  resetView: () => void;

  // Computed values
  visibleCharts: Set<ChartType>;
  visibleCount: number;
  hasMaximized: boolean;
}

export const ALL_CHARTS: ChartType[] = [...PLAYGROUND_CHART_IDS];

export const PlaygroundViewContext = createContext<PlaygroundViewContextValue | null>(null);

export function usePlaygroundView(): PlaygroundViewContextValue {
  const context = useContext(PlaygroundViewContext);
  if (!context) {
    throw new Error('usePlaygroundView must be used within a PlaygroundViewProvider');
  }
  return context;
}

/**
 * Optional hook that returns null if not within provider.
 * Useful for components that can work with or without the context.
 */
export function usePlaygroundViewOptional(): PlaygroundViewContextValue | null {
  return useContext(PlaygroundViewContext);
}
