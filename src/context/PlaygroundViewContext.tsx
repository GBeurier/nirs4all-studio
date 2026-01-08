/**
 * PlaygroundViewContext - Centralized view state management for Playground
 *
 * Phase 2: Core Layout & View Management
 *
 * Features:
 * - Chart visibility state (VISIBLE/HIDDEN)
 * - Maximized chart state (one chart full screen)
 * - Minimized charts state (collapsed to header)
 * - Focused chart tracking
 * - Layout mode selection
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

// ============= Types =============

export type ChartType = 'spectra' | 'histogram' | 'folds' | 'pca' | 'repetitions';

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

export type PlaygroundViewAction =
  | { type: 'SET_CHART_STATE'; chart: ChartType; state: ViewState }
  | { type: 'TOGGLE_CHART'; chart: ChartType }
  | { type: 'MAXIMIZE_CHART'; chart: ChartType | null }
  | { type: 'MINIMIZE_CHART'; chart: ChartType }
  | { type: 'RESTORE_CHART'; chart: ChartType }
  | { type: 'SET_FOCUSED_CHART'; chart: ChartType | null }
  | { type: 'SET_LAYOUT_MODE'; mode: LayoutMode }
  | { type: 'SHOW_ALL_CHARTS' }
  | { type: 'HIDE_ALL_CHARTS' }
  | { type: 'RESET_VIEW' };

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

// ============= Initial State =============

const ALL_CHARTS: ChartType[] = ['spectra', 'histogram', 'folds', 'pca', 'repetitions'];

const DEFAULT_VISIBLE_CHARTS: ChartType[] = ['spectra', 'histogram', 'pca'];

function createInitialState(): PlaygroundViewState {
  const chartStates: Record<ChartType, ViewState> = {} as Record<ChartType, ViewState>;
  for (const chart of ALL_CHARTS) {
    chartStates[chart] = DEFAULT_VISIBLE_CHARTS.includes(chart) ? 'visible' : 'hidden';
  }
  return {
    chartStates,
    maximizedChart: null,
    focusedChart: null,
    layoutMode: 'auto',
  };
}

const initialState = createInitialState();

// ============= Reducer =============

function viewReducer(state: PlaygroundViewState, action: PlaygroundViewAction): PlaygroundViewState {
  switch (action.type) {
    case 'SET_CHART_STATE': {
      // If setting to maximized, clear other maximized states
      if (action.state === 'maximized') {
        const newStates = { ...state.chartStates };
        for (const chart of ALL_CHARTS) {
          if (newStates[chart] === 'maximized') {
            newStates[chart] = 'visible';
          }
        }
        newStates[action.chart] = 'maximized';
        return {
          ...state,
          chartStates: newStates,
          maximizedChart: action.chart,
        };
      }
      // If we're here, action.state is not 'maximized' (handled above)
      // Clear maximized state if this chart was maximized
      return {
        ...state,
        chartStates: {
          ...state.chartStates,
          [action.chart]: action.state,
        },
        maximizedChart: state.maximizedChart === action.chart ? null : state.maximizedChart,
      };
    }

    case 'TOGGLE_CHART': {
      const currentState = state.chartStates[action.chart];
      const newState: ViewState = currentState === 'hidden' ? 'visible' : 'hidden';
      return {
        ...state,
        chartStates: {
          ...state.chartStates,
          [action.chart]: newState,
        },
        maximizedChart: newState === 'hidden' && state.maximizedChart === action.chart
          ? null
          : state.maximizedChart,
      };
    }

    case 'MAXIMIZE_CHART': {
      if (action.chart === null) {
        // Restore all maximized charts to visible
        const newStates = { ...state.chartStates };
        for (const chart of ALL_CHARTS) {
          if (newStates[chart] === 'maximized') {
            newStates[chart] = 'visible';
          }
        }
        return {
          ...state,
          chartStates: newStates,
          maximizedChart: null,
        };
      }
      // Maximize specific chart
      const newStates = { ...state.chartStates };
      for (const chart of ALL_CHARTS) {
        if (newStates[chart] === 'maximized') {
          newStates[chart] = 'visible';
        }
      }
      newStates[action.chart] = 'maximized';
      return {
        ...state,
        chartStates: newStates,
        maximizedChart: action.chart,
      };
    }

    case 'MINIMIZE_CHART': {
      return {
        ...state,
        chartStates: {
          ...state.chartStates,
          [action.chart]: 'minimized',
        },
        maximizedChart: state.maximizedChart === action.chart ? null : state.maximizedChart,
      };
    }

    case 'RESTORE_CHART': {
      const currentState = state.chartStates[action.chart];
      if (currentState === 'minimized' || currentState === 'maximized') {
        return {
          ...state,
          chartStates: {
            ...state.chartStates,
            [action.chart]: 'visible',
          },
          maximizedChart: state.maximizedChart === action.chart ? null : state.maximizedChart,
        };
      }
      return state;
    }

    case 'SET_FOCUSED_CHART': {
      return {
        ...state,
        focusedChart: action.chart,
      };
    }

    case 'SET_LAYOUT_MODE': {
      return {
        ...state,
        layoutMode: action.mode,
      };
    }

    case 'SHOW_ALL_CHARTS': {
      const newStates = { ...state.chartStates };
      for (const chart of ALL_CHARTS) {
        newStates[chart] = 'visible';
      }
      return {
        ...state,
        chartStates: newStates,
        maximizedChart: null,
      };
    }

    case 'HIDE_ALL_CHARTS': {
      const newStates = { ...state.chartStates };
      for (const chart of ALL_CHARTS) {
        newStates[chart] = 'hidden';
      }
      return {
        ...state,
        chartStates: newStates,
        maximizedChart: null,
      };
    }

    case 'RESET_VIEW': {
      return createInitialState();
    }

    default:
      return state;
  }
}

// ============= Context =============

const PlaygroundViewContext = createContext<PlaygroundViewContextValue | null>(null);

// ============= Provider =============

export interface PlaygroundViewProviderProps {
  children: ReactNode;
  /** Initial visible charts (overrides default) */
  initialVisibleCharts?: ChartType[];
}

export function PlaygroundViewProvider({
  children,
  initialVisibleCharts,
}: PlaygroundViewProviderProps) {
  const [state, dispatch] = useReducer(viewReducer, initialState, (init) => {
    if (initialVisibleCharts) {
      const chartStates: Record<ChartType, ViewState> = {} as Record<ChartType, ViewState>;
      for (const chart of ALL_CHARTS) {
        chartStates[chart] = initialVisibleCharts.includes(chart) ? 'visible' : 'hidden';
      }
      return { ...init, chartStates };
    }
    return init;
  });

  // ============= Actions =============

  const setChartState = useCallback((chart: ChartType, viewState: ViewState) => {
    dispatch({ type: 'SET_CHART_STATE', chart, state: viewState });
  }, []);

  const toggleChart = useCallback((chart: ChartType) => {
    dispatch({ type: 'TOGGLE_CHART', chart });
  }, []);

  const isChartVisible = useCallback((chart: ChartType) => {
    const chartState = state.chartStates[chart];
    return chartState === 'visible' || chartState === 'maximized';
  }, [state.chartStates]);

  const isChartMinimized = useCallback((chart: ChartType) => {
    return state.chartStates[chart] === 'minimized';
  }, [state.chartStates]);

  const maximizeChart = useCallback((chart: ChartType | null) => {
    dispatch({ type: 'MAXIMIZE_CHART', chart });
  }, []);

  const minimizeChart = useCallback((chart: ChartType) => {
    dispatch({ type: 'MINIMIZE_CHART', chart });
  }, []);

  const restoreChart = useCallback((chart: ChartType) => {
    dispatch({ type: 'RESTORE_CHART', chart });
  }, []);

  const toggleMaximize = useCallback((chart: ChartType) => {
    if (state.maximizedChart === chart) {
      dispatch({ type: 'MAXIMIZE_CHART', chart: null });
    } else {
      dispatch({ type: 'MAXIMIZE_CHART', chart });
    }
  }, [state.maximizedChart]);

  const setFocusedChart = useCallback((chart: ChartType | null) => {
    dispatch({ type: 'SET_FOCUSED_CHART', chart });
  }, []);

  const setLayoutMode = useCallback((mode: LayoutMode) => {
    dispatch({ type: 'SET_LAYOUT_MODE', mode });
  }, []);

  const showAllCharts = useCallback(() => {
    dispatch({ type: 'SHOW_ALL_CHARTS' });
  }, []);

  const hideAllCharts = useCallback(() => {
    dispatch({ type: 'HIDE_ALL_CHARTS' });
  }, []);

  const resetView = useCallback(() => {
    dispatch({ type: 'RESET_VIEW' });
  }, []);

  // ============= Computed Values =============

  const visibleCharts = useMemo(() => {
    const visible = new Set<ChartType>();
    for (const chart of ALL_CHARTS) {
      const chartState = state.chartStates[chart];
      if (chartState === 'visible' || chartState === 'maximized' || chartState === 'minimized') {
        visible.add(chart);
      }
    }
    return visible;
  }, [state.chartStates]);

  const visibleCount = useMemo(() => {
    let count = 0;
    for (const chart of ALL_CHARTS) {
      const chartState = state.chartStates[chart];
      if (chartState === 'visible' || chartState === 'maximized') {
        count++;
      }
    }
    return count;
  }, [state.chartStates]);

  const hasMaximized = state.maximizedChart !== null;

  // ============= Context Value =============

  const value = useMemo<PlaygroundViewContextValue>(() => ({
    // State
    ...state,

    // Chart visibility
    setChartState,
    toggleChart,
    isChartVisible,
    isChartMinimized,

    // Maximize/minimize
    maximizeChart,
    minimizeChart,
    restoreChart,
    toggleMaximize,

    // Focus
    setFocusedChart,

    // Layout
    setLayoutMode,

    // Bulk operations
    showAllCharts,
    hideAllCharts,
    resetView,

    // Computed
    visibleCharts,
    visibleCount,
    hasMaximized,
  }), [
    state,
    setChartState,
    toggleChart,
    isChartVisible,
    isChartMinimized,
    maximizeChart,
    minimizeChart,
    restoreChart,
    toggleMaximize,
    setFocusedChart,
    setLayoutMode,
    showAllCharts,
    hideAllCharts,
    resetView,
    visibleCharts,
    visibleCount,
    hasMaximized,
  ]);

  return (
    <PlaygroundViewContext.Provider value={value}>
      {children}
    </PlaygroundViewContext.Provider>
  );
}

// ============= Hook =============

export function usePlaygroundView(): PlaygroundViewContextValue {
  const context = useContext(PlaygroundViewContext);
  if (!context) {
    throw new Error('usePlaygroundView must be used within a PlaygroundViewProvider');
  }
  return context;
}

/**
 * Optional hook that returns null if not within provider
 * Useful for components that can work with or without the context
 */
export function usePlaygroundViewOptional(): PlaygroundViewContextValue | null {
  return useContext(PlaygroundViewContext);
}

export { ALL_CHARTS };
