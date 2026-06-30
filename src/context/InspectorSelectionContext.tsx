/**
 * InspectorSelectionContext — Shared selection state for Inspector.
 *
 * Operates on chain_ids (strings) rather than sample indices (numbers).
 * Adapted from SelectionContext (Playground) with chain-level operations.
 *
 * Phase 1: Selected chains, undo/redo, session storage.
 * Phase 3: Pinned chains, saved selections, selection tool mode (lasso/box/click).
 *
 * Features:
 * - Selected chains shared across all panels
 * - Pinned chains (not affected by clear/undo)
 * - Saved selections (name + color + chain_ids)
 * - Selection tool mode (click, box, lasso)
 * - Selection history with undo/redo
 * - Separate hover context for performance
 * - Session storage persistence
 * - Keyboard shortcuts (Ctrl+Z, Escape)
 */

import {
  useReducer,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { InspectorSelectionToolMode, InspectorSavedSelection } from '@/types/inspector';
import {
  persistSelection,
  loadPersistedSelection,
  type PersistFieldNames,
} from './selection/createSelectionCore';
import {
  createInspectorSavedSelection,
  getInspectorSelectionDerivedState,
  inspectorSelectionReducer,
  restoreInspectorSelectionState,
} from '@/lib/inspector/selectionState';
import {
  InspectorHoverContext,
  InspectorSelectionContext,
  type InspectorHoverContextValue,
  type InspectorSelectionContextValue,
  type InspectorSelectionMode,
} from './useInspectorSelection';

// ============= Constants =============

const STORAGE_KEY = 'inspector-selection-state';
const PERSIST_FIELDS: PersistFieldNames = {
  selected: 'selectedChains',
  pinned: 'pinnedChains',
  savedSelections: 'savedSelections',
};

// ============= Storage Helpers =============

function loadPersistedState() {
  return loadPersistedSelection<string, InspectorSavedSelection>(STORAGE_KEY, PERSIST_FIELDS);
}

// ============= Provider =============

export function InspectorSelectionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    inspectorSelectionReducer,
    loadPersistedState(),
    restoreInspectorSelectionState,
  );

  const [hoveredChain, setHoveredChainState] = useState<string | null>(null);

  // Persist state changes
  useEffect(() => {
    const timeout = setTimeout(() => {
      persistSelection(
        STORAGE_KEY,
        PERSIST_FIELDS,
        state.selectedChains,
        state.pinnedChains,
        state.savedSelections,
      );
    }, 500);
    return () => clearTimeout(timeout);
  }, [state.selectedChains, state.pinnedChains, state.savedSelections]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'REDO' });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        dispatch({ type: 'REDO' });
        return;
      }
      if (e.key === 'Escape') {
        dispatch({ type: 'CLEAR' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Action creators — Selection
  const select = useCallback((chainIds: string[], mode?: InspectorSelectionMode) => {
    dispatch({ type: 'SELECT', chainIds, mode });
  }, []);
  const deselect = useCallback((chainIds: string[]) => dispatch({ type: 'DESELECT', chainIds }), []);
  const toggle = useCallback((chainIds: string[]) => dispatch({ type: 'TOGGLE', chainIds }), []);
  const clear = useCallback(() => dispatch({ type: 'CLEAR' }), []);
  const selectAll = useCallback((chainIds: string[]) => dispatch({ type: 'SELECT_ALL', chainIds }), []);
  const invert = useCallback((allChainIds: string[]) => dispatch({ type: 'INVERT', allChainIds }), []);
  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);
  const setSelectionMode = useCallback((mode: InspectorSelectionMode) => dispatch({ type: 'SET_MODE', mode }), []);
  const setSelectionToolMode = useCallback((tool: InspectorSelectionToolMode) => dispatch({ type: 'SET_TOOL_MODE', tool }), []);

  // Action creators — Pins
  const pin = useCallback((chainIds: string[]) => dispatch({ type: 'PIN', chainIds }), []);
  const unpin = useCallback((chainIds: string[]) => dispatch({ type: 'UNPIN', chainIds }), []);
  const clearPins = useCallback(() => dispatch({ type: 'CLEAR_PINS' }), []);
  const togglePin = useCallback((chainId: string) => dispatch({ type: 'TOGGLE_PIN', chainId }), []);

  // Action creators — Saved selections
  const saveSelection = useCallback((name: string, color?: string) => {
    dispatch({
      type: 'SAVE_SELECTION',
      selection: createInspectorSavedSelection({
        chainIds: state.selectedChains,
        color,
        name,
      }),
    });
  }, [state.selectedChains]);
  const loadSelection = useCallback((id: string) => dispatch({ type: 'LOAD_SELECTION', id }), []);
  const deleteSavedSelection = useCallback((id: string) => dispatch({ type: 'DELETE_SAVED_SELECTION', id }), []);

  // Derived state
  const isSelected = useCallback((chainId: string) => state.selectedChains.has(chainId), [state.selectedChains]);
  const isPinned = useCallback((chainId: string) => state.pinnedChains.has(chainId), [state.pinnedChains]);
  const {
    canRedo,
    canUndo,
    hasSelection,
    pinnedCount,
    selectedCount,
  } = useMemo(() => getInspectorSelectionDerivedState(state), [state]);

  const setHovered = useCallback((chainId: string | null) => setHoveredChainState(chainId), []);

  const value = useMemo<InspectorSelectionContextValue>(() => ({
    ...state,
    select, deselect, toggle, clear, selectAll, invert, undo, redo,
    setSelectionMode, setSelectionToolMode,
    isSelected, selectedCount, hasSelection, canUndo, canRedo,
    pin, unpin, clearPins, togglePin, isPinned, pinnedCount,
    saveSelection, loadSelection, deleteSavedSelection,
  }), [
    state, select, deselect, toggle, clear, selectAll, invert, undo, redo,
    setSelectionMode, setSelectionToolMode,
    isSelected, selectedCount, hasSelection, canUndo, canRedo,
    pin, unpin, clearPins, togglePin, isPinned, pinnedCount,
    saveSelection, loadSelection, deleteSavedSelection,
  ]);

  const hoverValue = useMemo<InspectorHoverContextValue>(() => ({
    hoveredChain, setHovered,
  }), [hoveredChain, setHovered]);

  return (
    <InspectorHoverContext.Provider value={hoverValue}>
      <InspectorSelectionContext.Provider value={value}>
        {children}
      </InspectorSelectionContext.Provider>
    </InspectorHoverContext.Provider>
  );
}
