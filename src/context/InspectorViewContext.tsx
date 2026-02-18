/**
 * InspectorViewContext — Panel visibility and layout state for Inspector.
 *
 * Follows the same pattern as PlaygroundViewContext but with InspectorPanelType.
 * Manages visible/hidden/maximized/minimized state for each panel.
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { InspectorPanelType, InspectorViewState } from '@/types/inspector';
import { useInspectorSessionOptional } from './InspectorSessionContext';

// ============= Types =============

export type LayoutMode = 'auto' | 'grid-2' | 'grid-3' | 'single-column';

export interface InspectorViewStateValue {
  panelStates: Record<InspectorPanelType, InspectorViewState>;
  maximizedPanel: InspectorPanelType | null;
  focusedPanel: InspectorPanelType | null;
  layoutMode: LayoutMode;
}

type InspectorViewAction =
  | { type: 'SET_PANEL_STATE'; panel: InspectorPanelType; state: InspectorViewState }
  | { type: 'TOGGLE_PANEL'; panel: InspectorPanelType }
  | { type: 'MAXIMIZE_PANEL'; panel: InspectorPanelType | null }
  | { type: 'MINIMIZE_PANEL'; panel: InspectorPanelType }
  | { type: 'RESTORE_PANEL'; panel: InspectorPanelType }
  | { type: 'SET_FOCUSED_PANEL'; panel: InspectorPanelType | null }
  | { type: 'SET_LAYOUT_MODE'; mode: LayoutMode }
  | { type: 'SHOW_ALL' }
  | { type: 'RESET' };

export interface InspectorViewContextValue extends InspectorViewStateValue {
  setPanelState: (panel: InspectorPanelType, state: InspectorViewState) => void;
  togglePanel: (panel: InspectorPanelType) => void;
  isPanelVisible: (panel: InspectorPanelType) => boolean;
  isPanelMinimized: (panel: InspectorPanelType) => boolean;
  maximizePanel: (panel: InspectorPanelType | null) => void;
  minimizePanel: (panel: InspectorPanelType) => void;
  restorePanel: (panel: InspectorPanelType) => void;
  toggleMaximize: (panel: InspectorPanelType) => void;
  setFocusedPanel: (panel: InspectorPanelType | null) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  showAll: () => void;
  resetView: () => void;
  visiblePanels: Set<InspectorPanelType>;
  visibleCount: number;
  hasMaximized: boolean;
}

// ============= Constants =============

const ALL_PANELS: InspectorPanelType[] = ['scatter', 'residuals', 'rankings', 'heatmap', 'histogram', 'candlestick', 'branch_comparison', 'branch_topology', 'fold_stability', 'confusion', 'robustness', 'correlation', 'preprocessing_impact', 'hyperparameter', 'bias_variance', 'learning_curve'];
const DEFAULT_VISIBLE: InspectorPanelType[] = ['scatter', 'residuals', 'rankings', 'heatmap', 'histogram', 'candlestick'];

// ============= Initial State =============

function createInitialState(): InspectorViewStateValue {
  const panelStates = {} as Record<InspectorPanelType, InspectorViewState>;
  for (const panel of ALL_PANELS) {
    panelStates[panel] = DEFAULT_VISIBLE.includes(panel) ? 'visible' : 'hidden';
  }
  return {
    panelStates,
    maximizedPanel: null,
    focusedPanel: null,
    layoutMode: 'auto',
  };
}

// ============= Reducer =============

function viewReducer(state: InspectorViewStateValue, action: InspectorViewAction): InspectorViewStateValue {
  switch (action.type) {
    case 'SET_PANEL_STATE': {
      if (action.state === 'maximized') {
        const newStates = { ...state.panelStates };
        for (const panel of ALL_PANELS) {
          if (newStates[panel] === 'maximized') newStates[panel] = 'visible';
        }
        newStates[action.panel] = 'maximized';
        return { ...state, panelStates: newStates, maximizedPanel: action.panel };
      }
      return {
        ...state,
        panelStates: { ...state.panelStates, [action.panel]: action.state },
        maximizedPanel: state.maximizedPanel === action.panel ? null : state.maximizedPanel,
      };
    }

    case 'TOGGLE_PANEL': {
      const current = state.panelStates[action.panel];
      const newState: InspectorViewState = current === 'hidden' ? 'visible' : 'hidden';
      return {
        ...state,
        panelStates: { ...state.panelStates, [action.panel]: newState },
        maximizedPanel: newState === 'hidden' && state.maximizedPanel === action.panel ? null : state.maximizedPanel,
      };
    }

    case 'MAXIMIZE_PANEL': {
      if (action.panel === null) {
        const newStates = { ...state.panelStates };
        for (const panel of ALL_PANELS) {
          if (newStates[panel] === 'maximized') newStates[panel] = 'visible';
        }
        return { ...state, panelStates: newStates, maximizedPanel: null };
      }
      const newStates = { ...state.panelStates };
      for (const panel of ALL_PANELS) {
        if (newStates[panel] === 'maximized') newStates[panel] = 'visible';
      }
      newStates[action.panel] = 'maximized';
      return { ...state, panelStates: newStates, maximizedPanel: action.panel };
    }

    case 'MINIMIZE_PANEL':
      return {
        ...state,
        panelStates: { ...state.panelStates, [action.panel]: 'minimized' },
        maximizedPanel: state.maximizedPanel === action.panel ? null : state.maximizedPanel,
      };

    case 'RESTORE_PANEL': {
      const current = state.panelStates[action.panel];
      if (current === 'minimized' || current === 'maximized') {
        return {
          ...state,
          panelStates: { ...state.panelStates, [action.panel]: 'visible' },
          maximizedPanel: state.maximizedPanel === action.panel ? null : state.maximizedPanel,
        };
      }
      return state;
    }

    case 'SET_FOCUSED_PANEL':
      return { ...state, focusedPanel: action.panel };

    case 'SET_LAYOUT_MODE':
      return { ...state, layoutMode: action.mode };

    case 'SHOW_ALL': {
      const newStates = {} as Record<InspectorPanelType, InspectorViewState>;
      for (const panel of ALL_PANELS) newStates[panel] = 'visible';
      return { ...state, panelStates: newStates, maximizedPanel: null };
    }

    case 'RESET':
      return createInitialState();

    default:
      return state;
  }
}

// ============= Context =============

const InspectorViewContext = createContext<InspectorViewContextValue | null>(null);

// ============= Provider =============

export function InspectorViewProvider({ children }: { children: ReactNode }) {
  const session = useInspectorSessionOptional();
  const restoredRef = useRef(false);

  const [state, dispatch] = useReducer(viewReducer, null, () => {
    const initial = createInitialState();
    const saved = session?.getSession();
    if (saved?.panelStates) {
      // Restore saved panel states, merging with defaults for any new panels
      const restored = { ...initial.panelStates };
      for (const [key, value] of Object.entries(saved.panelStates)) {
        if (key in restored) {
          restored[key as InspectorPanelType] = value as InspectorViewState;
        }
      }
      return {
        ...initial,
        panelStates: restored,
        layoutMode: saved.layoutMode ?? initial.layoutMode,
      };
    }
    return initial;
  });

  // Mark as restored after mount
  useEffect(() => { restoredRef.current = true; }, []);

  // Auto-save view state to session on changes
  useEffect(() => {
    if (!restoredRef.current || !session) return;
    session.saveSession({
      panelStates: state.panelStates as Record<string, InspectorViewState>,
      layoutMode: state.layoutMode,
    });
  }, [state.panelStates, state.layoutMode, session]);

  const setPanelState = useCallback((panel: InspectorPanelType, viewState: InspectorViewState) => {
    dispatch({ type: 'SET_PANEL_STATE', panel, state: viewState });
  }, []);

  const togglePanel = useCallback((panel: InspectorPanelType) => {
    dispatch({ type: 'TOGGLE_PANEL', panel });
  }, []);

  const isPanelVisible = useCallback((panel: InspectorPanelType) => {
    const s = state.panelStates[panel];
    return s === 'visible' || s === 'maximized';
  }, [state.panelStates]);

  const isPanelMinimized = useCallback((panel: InspectorPanelType) => {
    return state.panelStates[panel] === 'minimized';
  }, [state.panelStates]);

  const maximizePanel = useCallback((panel: InspectorPanelType | null) => {
    dispatch({ type: 'MAXIMIZE_PANEL', panel });
  }, []);

  const minimizePanel = useCallback((panel: InspectorPanelType) => {
    dispatch({ type: 'MINIMIZE_PANEL', panel });
  }, []);

  const restorePanel = useCallback((panel: InspectorPanelType) => {
    dispatch({ type: 'RESTORE_PANEL', panel });
  }, []);

  const toggleMaximize = useCallback((panel: InspectorPanelType) => {
    if (state.maximizedPanel === panel) {
      dispatch({ type: 'MAXIMIZE_PANEL', panel: null });
    } else {
      dispatch({ type: 'MAXIMIZE_PANEL', panel });
    }
  }, [state.maximizedPanel]);

  const setFocusedPanel = useCallback((panel: InspectorPanelType | null) => {
    dispatch({ type: 'SET_FOCUSED_PANEL', panel });
  }, []);

  const setLayoutMode = useCallback((mode: LayoutMode) => {
    dispatch({ type: 'SET_LAYOUT_MODE', mode });
  }, []);

  const showAll = useCallback(() => dispatch({ type: 'SHOW_ALL' }), []);
  const resetView = useCallback(() => dispatch({ type: 'RESET' }), []);

  const visiblePanels = useMemo(() => {
    const visible = new Set<InspectorPanelType>();
    for (const panel of ALL_PANELS) {
      const s = state.panelStates[panel];
      if (s === 'visible' || s === 'maximized' || s === 'minimized') visible.add(panel);
    }
    return visible;
  }, [state.panelStates]);

  const visibleCount = useMemo(() => {
    let count = 0;
    for (const panel of ALL_PANELS) {
      const s = state.panelStates[panel];
      if (s === 'visible' || s === 'maximized') count++;
    }
    return count;
  }, [state.panelStates]);

  const hasMaximized = state.maximizedPanel !== null;

  const value = useMemo<InspectorViewContextValue>(() => ({
    ...state,
    setPanelState,
    togglePanel,
    isPanelVisible,
    isPanelMinimized,
    maximizePanel,
    minimizePanel,
    restorePanel,
    toggleMaximize,
    setFocusedPanel,
    setLayoutMode,
    showAll,
    resetView,
    visiblePanels,
    visibleCount,
    hasMaximized,
  }), [
    state, setPanelState, togglePanel, isPanelVisible, isPanelMinimized,
    maximizePanel, minimizePanel, restorePanel, toggleMaximize, setFocusedPanel,
    setLayoutMode, showAll, resetView, visiblePanels, visibleCount, hasMaximized,
  ]);

  return (
    <InspectorViewContext.Provider value={value}>
      {children}
    </InspectorViewContext.Provider>
  );
}

// ============= Hook =============

export function useInspectorView(): InspectorViewContextValue {
  const context = useContext(InspectorViewContext);
  if (!context) {
    throw new Error('useInspectorView must be used within an InspectorViewProvider');
  }
  return context;
}

export { ALL_PANELS };
