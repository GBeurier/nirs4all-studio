/**
 * InspectorViewContext — Panel visibility and layout state for Inspector.
 *
 * Follows the same pattern as PlaygroundViewContext but with InspectorPanelType.
 * Manages visible/hidden/maximized/minimized state for each panel.
 */

import {
  useReducer,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { InspectorPanelType, InspectorViewState } from '@/types/inspector';
import {
  getInspectorVisiblePanelCount,
  getInspectorVisiblePanels,
  inspectorViewReducer,
  isInspectorPanelMinimized as isInspectorPanelMinimizedState,
  isInspectorPanelVisible as isInspectorPanelVisibleState,
  restoreInspectorViewState,
} from '@/lib/inspector/viewState';
import { useInspectorSessionOptional } from './useInspectorSession';
import {
  InspectorViewContext,
  type InspectorViewContextValue,
  type LayoutMode,
} from '@/context/useInspectorView';

// ============= Provider =============

export function InspectorViewProvider({ children }: { children: ReactNode }) {
  const session = useInspectorSessionOptional();
  const restoredRef = useRef(false);

  const [state, dispatch] = useReducer(
    inspectorViewReducer,
    session?.getSession(),
    restoreInspectorViewState,
  );

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
    return isInspectorPanelVisibleState(state.panelStates, panel);
  }, [state.panelStates]);

  const isPanelMinimized = useCallback((panel: InspectorPanelType) => {
    return isInspectorPanelMinimizedState(state.panelStates, panel);
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

  const visiblePanels = useMemo(
    () => getInspectorVisiblePanels(state.panelStates),
    [state.panelStates],
  );

  const visibleCount = useMemo(
    () => getInspectorVisiblePanelCount(state.panelStates),
    [state.panelStates],
  );

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
