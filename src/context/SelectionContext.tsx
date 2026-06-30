/**
 * SelectionContext - Global selection state management for Playground V2
 *
 * Features:
 * - Unified selection state across all charts
 * - Selection history with undo/redo (max 50 entries)
 * - Pinned samples that remain visible during filtering
 * - Saved selections with names for later recall
 * - Session storage persistence
 * - Keyboard shortcuts (Ctrl+Z, Escape, Ctrl+A, Ctrl+Shift+Z)
 *
 * Phase 1 Implementation - Foundation & Selection System
 */

import {
  useReducer,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applySelectionMode,
  toggleInSet,
  addToSet,
  removeFromSet,
  pushHistory as pushHistoryCore,
  undoHistory,
  redoHistory,
  rangeIndices,
} from './selection/createSelectionCore';
import {
  loadPlaygroundSelectionState,
  persistPlaygroundSelectionState,
} from './selection/playgroundSelectionStorage';
import {
  SelectionContext,
  type SavedSelection,
  type SelectionAction,
  type SelectionContextValue,
  type SelectionMode,
  type SelectionState,
  type SelectionToolType,
} from './useSelection';

// History depth (MAX_HISTORY=10) and the set/history primitives are shared via
// ./selection/createSelectionCore so this twin and InspectorSelectionContext
// cannot drift apart on the common selection logic (FE-05-state).

// ============= Initial State =============

const createInitialState = (): SelectionState => ({
  selectedSamples: new Set<number>(),
  pinnedSamples: new Set<number>(),
  savedSelections: [],
  selectionHistory: [new Set<number>()],
  historyIndex: 0,
  isSelecting: false,
  selectionMode: 'replace',
  hoveredSample: null,
  lastSelectedIndex: null,
  selectionToolMode: 'click',
});

// ============= Helpers =============

/** Record a new selection snapshot in the shared bounded undo history. */
function pushHistory(
  state: SelectionState,
  newSelection: Set<number>
): Pick<SelectionState, 'selectionHistory' | 'historyIndex'> {
  return pushHistoryCore(state.selectionHistory, state.historyIndex, newSelection);
}

/**
 * Collapse the selection onto a single index and snapshot it — the shared
 * fallback used by both range actions when there is no anchor or the anchor /
 * target is outside the supplied order.
 */
function selectSingle(state: SelectionState, toIndex: number): SelectionState {
  const newSelection = new Set([toIndex]);
  return {
    ...state,
    selectedSamples: newSelection,
    ...pushHistory(state, newSelection),
    lastSelectedIndex: toIndex,
  };
}

// ============= Reducer =============

function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'SELECT': {
      const mode = action.mode ?? state.selectionMode;
      const newSelection = applySelectionMode(state.selectedSamples, action.indices, mode);

      // Track last selected index for range selection (use the last index in the array)
      const lastIdx = action.indices.length > 0 ? action.indices[action.indices.length - 1] : state.lastSelectedIndex;

      return {
        ...state,
        selectedSamples: newSelection,
        ...pushHistory(state, newSelection),
        lastSelectedIndex: lastIdx,
      };
    }

    case 'DESELECT': {
      const newSelection = removeFromSet(state.selectedSamples, action.indices);

      return {
        ...state,
        selectedSamples: newSelection,
        ...pushHistory(state, newSelection),
      };
    }

    case 'TOGGLE': {
      let newSelection = state.selectedSamples;
      action.indices.forEach(i => {
        newSelection = toggleInSet(newSelection, i);
      });

      return {
        ...state,
        selectedSamples: newSelection,
        ...pushHistory(state, newSelection),
      };
    }

    case 'SELECT_ALL': {
      const newSelection = new Set(rangeIndices(action.totalSamples));

      return {
        ...state,
        selectedSamples: newSelection,
        ...pushHistory(state, newSelection),
      };
    }

    case 'SELECT_RANGE': {
      // Range selection: select all indices between lastSelectedIndex and toIndex
      if (state.lastSelectedIndex === null) {
        // No previous selection, just select the target index
        return selectSingle(state, action.toIndex);
      }

      // Generate range indices
      const fromIdx = state.lastSelectedIndex;
      const toIdx = action.toIndex;
      const minIdx = Math.min(fromIdx, toIdx);
      const maxIdx = Math.max(fromIdx, toIdx);
      const range = Array.from({ length: maxIdx - minIdx + 1 }, (_, i) => minIdx + i);

      const mode = action.mode ?? 'add'; // Default to 'add' for range selection
      const newSelection = applySelectionMode(state.selectedSamples, range, mode);

      return {
        ...state,
        selectedSamples: newSelection,
        ...pushHistory(state, newSelection),
        lastSelectedIndex: action.toIndex,
      };
    }

    case 'SELECT_RANGE_ORDERED': {
      // Range selection with custom ordering (e.g., sorted by Y value, bar position)
      // The order array defines the visual/logical order of samples
      const order = action.order;
      if (order.length === 0) {
        return state;
      }

      if (state.lastSelectedIndex === null) {
        // No previous selection, just select the target index
        return selectSingle(state, action.toIndex);
      }

      // Find positions in the order array
      const fromPos = order.indexOf(state.lastSelectedIndex);
      const toPos = order.indexOf(action.toIndex);

      // If either index is not in the order array, fall back to single selection
      if (fromPos === -1 || toPos === -1) {
        return selectSingle(state, action.toIndex);
      }

      // Extract indices between the two positions (inclusive)
      const minPos = Math.min(fromPos, toPos);
      const maxPos = Math.max(fromPos, toPos);
      const range = order.slice(minPos, maxPos + 1);

      const mode = action.mode ?? 'add'; // Default to 'add' for range selection
      const newSelection = applySelectionMode(state.selectedSamples, range, mode);

      return {
        ...state,
        selectedSamples: newSelection,
        ...pushHistory(state, newSelection),
        lastSelectedIndex: action.toIndex,
      };
    }

    case 'REPLACE_IF_NOT_SOLE': {
      // If target indices exactly match current selection, clear
      // Otherwise, replace selection with target indices
      // This encapsulates the common "click selected when multi" pattern
      const targetSet = new Set(action.indices);
      const currentSize = state.selectedSamples.size;
      const targetSize = targetSet.size;

      // Check if selections match exactly
      const selectionsMatch =
        currentSize === targetSize &&
        targetSize > 0 &&
        action.indices.every(i => state.selectedSamples.has(i));

      if (selectionsMatch) {
        // Clear selection (same as clicking sole selected item)
        const newSelection = new Set<number>();
        return {
          ...state,
          selectedSamples: newSelection,
          ...pushHistory(state, newSelection),
        };
      }

      // Replace selection with target
      const newSelection = new Set(action.indices);

      // Track last selected index for range selection
      const lastIdx = action.indices.length > 0 ? action.indices[action.indices.length - 1] : state.lastSelectedIndex;

      return {
        ...state,
        selectedSamples: newSelection,
        ...pushHistory(state, newSelection),
        lastSelectedIndex: lastIdx,
      };
    }

    case 'CLEAR': {
      if (state.selectedSamples.size === 0) {
        return state;
      }

      const newSelection = new Set<number>();
      return {
        ...state,
        selectedSamples: newSelection,
        ...pushHistory(state, newSelection),
      };
    }

    case 'INVERT': {
      const newSelection = new Set(
        rangeIndices(action.totalSamples).filter(i => !state.selectedSamples.has(i))
      );

      return {
        ...state,
        selectedSamples: newSelection,
        ...pushHistory(state, newSelection),
      };
    }

    case 'PIN': {
      return {
        ...state,
        pinnedSamples: addToSet(state.pinnedSamples, action.indices),
      };
    }

    case 'UNPIN': {
      return {
        ...state,
        pinnedSamples: removeFromSet(state.pinnedSamples, action.indices),
      };
    }

    case 'CLEAR_PINS': {
      return {
        ...state,
        pinnedSamples: new Set<number>(),
      };
    }

    case 'SAVE_SELECTION': {
      const newSaved: SavedSelection = {
        id: `sel-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        name: action.name,
        indices: Array.from(state.selectedSamples),
        createdAt: new Date(),
        color: action.color,
      };

      return {
        ...state,
        savedSelections: [...state.savedSelections, newSaved],
      };
    }

    case 'LOAD_SELECTION': {
      const saved = state.savedSelections.find(s => s.id === action.id);
      if (!saved) {
        return state;
      }

      const newSelection = new Set(saved.indices);
      return {
        ...state,
        selectedSamples: newSelection,
        ...pushHistory(state, newSelection),
      };
    }

    case 'DELETE_SAVED_SELECTION': {
      return {
        ...state,
        savedSelections: state.savedSelections.filter(s => s.id !== action.id),
      };
    }

    case 'UNDO': {
      // undoHistory reuses the existing Set from history (no allocation).
      const result = undoHistory(state.selectionHistory, state.historyIndex);
      if (!result) {
        return state;
      }
      return {
        ...state,
        selectedSamples: result.selection,
        historyIndex: result.historyIndex,
      };
    }

    case 'REDO': {
      // redoHistory reuses the existing Set from history (no allocation).
      const result = redoHistory(state.selectionHistory, state.historyIndex);
      if (!result) {
        return state;
      }
      return {
        ...state,
        selectedSamples: result.selection,
        historyIndex: result.historyIndex,
      };
    }

    case 'SET_SELECTING': {
      return {
        ...state,
        isSelecting: action.isSelecting,
      };
    }

    case 'SET_SELECTION_MODE': {
      return {
        ...state,
        selectionMode: action.mode,
      };
    }

    case 'SET_SELECTION_TOOL': {
      return {
        ...state,
        selectionToolMode: action.tool,
      };
    }

    case 'SET_HOVERED': {
      return {
        ...state,
        hoveredSample: action.index,
      };
    }

    case 'RESTORE': {
      return {
        ...state,
        ...action.state,
        selectedSamples: action.state.selectedSamples
          ? new Set(action.state.selectedSamples)
          : state.selectedSamples,
        pinnedSamples: action.state.pinnedSamples
          ? new Set(action.state.pinnedSamples)
          : state.pinnedSamples,
        selectionHistory: action.state.selectionHistory
          ? action.state.selectionHistory.map(s => new Set(s))
          : state.selectionHistory,
      };
    }

    case 'INTERSECT_WITH_AVAILABLE': {
      // When samples are filtered out, intersect selection with remaining indices
      const availableSet = new Set(action.availableIndices);
      const newSelection = new Set(
        [...state.selectedSamples].filter(i => availableSet.has(i))
      );
      const newPinned = new Set(
        [...state.pinnedSamples].filter(i => availableSet.has(i))
      );

      // Only update history if selection actually changed
      if (newSelection.size === state.selectedSamples.size) {
        return {
          ...state,
          pinnedSamples: newPinned,
        };
      }

      return {
        ...state,
        selectedSamples: newSelection,
        pinnedSamples: newPinned,
        ...pushHistory(state, newSelection),
      };
    }

    default:
      return state;
  }
}

// ============= Provider =============

interface SelectionProviderProps {
  children: ReactNode;
}

export function SelectionProvider({ children }: SelectionProviderProps) {
  const [state, dispatch] = useReducer(selectionReducer, null, () => {
    const initial = createInitialState();
    const persisted = loadPlaygroundSelectionState();
    if (persisted) {
      return { ...initial, ...persisted };
    }
    return initial;
  });

  // Separate hover state for performance - hover changes don't trigger selection re-renders
  const [hoveredSample, setHoveredSampleState] = useState<number | null>(null);

  // Persist state changes (debounced) - 500ms to reduce GC pressure in Firefox
  useEffect(() => {
    const timeout = setTimeout(() => {
      persistPlaygroundSelectionState(state.selectedSamples, state.pinnedSamples, state.savedSelections);
    }, 500);
    return () => clearTimeout(timeout);
  }, [state.selectedSamples, state.pinnedSamples, state.savedSelections]);

  // Keyboard shortcuts (undo/redo/clear) are owned exclusively by
  // usePlaygroundShortcuts — the only consumer of SelectionProvider — so they are
  // not bound here. A second window 'keydown' listener double-dispatched UNDO/CLEAR
  // and clobbered selection on Ctrl+Z/Escape (FE-01-state).

  // Memoized action creators
  const select = useCallback(
    (indices: number[], mode?: SelectionMode) => dispatch({ type: 'SELECT', indices, mode }),
    [],
  );
  const deselect = useCallback(
    (indices: number[]) => dispatch({ type: 'DESELECT', indices }),
    [],
  );
  const toggle = useCallback(
    (indices: number[]) => dispatch({ type: 'TOGGLE', indices }),
    [],
  );
  const selectAll = useCallback(
    (totalSamples: number) => dispatch({ type: 'SELECT_ALL', totalSamples }),
    [],
  );
  const selectRange = useCallback(
    (toIndex: number, mode?: SelectionMode) => dispatch({ type: 'SELECT_RANGE', toIndex, mode }),
    [],
  );
  const selectRangeOrdered = useCallback(
    (toIndex: number, order: number[], mode?: SelectionMode) => {
      dispatch({ type: 'SELECT_RANGE_ORDERED', toIndex, order, mode });
    },
    [],
  );
  const replaceIfNotSole = useCallback(
    (indices: number[]) => dispatch({ type: 'REPLACE_IF_NOT_SOLE', indices }),
    [],
  );
  const clear = useCallback(() => dispatch({ type: 'CLEAR' }), []);
  const invert = useCallback((totalSamples: number) => dispatch({ type: 'INVERT', totalSamples }), []);
  const pin = useCallback((indices: number[]) => dispatch({ type: 'PIN', indices }), []);
  const unpin = useCallback((indices: number[]) => dispatch({ type: 'UNPIN', indices }), []);
  const clearPins = useCallback(() => dispatch({ type: 'CLEAR_PINS' }), []);

  const togglePin = useCallback((index: number) => {
    dispatch(
      state.pinnedSamples.has(index)
        ? { type: 'UNPIN', indices: [index] }
        : { type: 'PIN', indices: [index] },
    );
  }, [state.pinnedSamples]);

  const saveSelection = useCallback(
    (name: string, color?: string) => dispatch({ type: 'SAVE_SELECTION', name, color }),
    [],
  );
  const loadSelection = useCallback((id: string) => dispatch({ type: 'LOAD_SELECTION', id }), []);
  const deleteSavedSelection = useCallback((id: string) => dispatch({ type: 'DELETE_SAVED_SELECTION', id }), []);
  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);
  const setSelecting = useCallback(
    (isSelecting: boolean) => dispatch({ type: 'SET_SELECTING', isSelecting }),
    [],
  );
  const setSelectionMode = useCallback(
    (mode: SelectionMode) => dispatch({ type: 'SET_SELECTION_MODE', mode }),
    [],
  );
  const setSelectionToolMode = useCallback(
    (tool: SelectionToolType) => dispatch({ type: 'SET_SELECTION_TOOL', tool }),
    [],
  );
  // setHovered uses separate state for performance — hover never re-renders selection consumers.
  const setHovered = useCallback((index: number | null) => setHoveredSampleState(index), []);
  const intersectWithAvailable = useCallback(
    (availableIndices: number[]) => {
      dispatch({ type: 'INTERSECT_WITH_AVAILABLE', availableIndices });
    },
    [],
  );
  const isSelected = useCallback((index: number) => state.selectedSamples.has(index), [state.selectedSamples]);
  const isPinned = useCallback((index: number) => state.pinnedSamples.has(index), [state.pinnedSamples]);

  // Derived values
  const canUndo = state.historyIndex > 0;
  const canRedo = state.historyIndex < state.selectionHistory.length - 1;
  const selectedCount = state.selectedSamples.size;
  const pinnedCount = state.pinnedSamples.size;
  const hasSelection = selectedCount > 0;

  const value = useMemo<SelectionContextValue>(() => ({
    ...state,
    hoveredSample, // Override with separate hover state
    select,
    deselect,
    toggle,
    selectAll,
    selectRange,
    selectRangeOrdered,
    replaceIfNotSole,
    clear,
    invert,
    pin,
    unpin,
    clearPins,
    togglePin,
    saveSelection,
    loadSelection,
    deleteSavedSelection,
    undo,
    redo,
    canUndo,
    canRedo,
    setSelecting,
    setSelectionMode,
    setSelectionToolMode,
    setHovered,
    isSelected,
    isPinned,
    selectedCount,
    pinnedCount,
    hasSelection,
    intersectWithAvailable,
  }), [
    state,
    hoveredSample,
    select,
    deselect,
    toggle,
    selectAll,
    selectRange,
    selectRangeOrdered,
    replaceIfNotSole,
    clear,
    invert,
    pin,
    unpin,
    clearPins,
    togglePin,
    saveSelection,
    loadSelection,
    deleteSavedSelection,
    undo,
    redo,
    canUndo,
    canRedo,
    setSelecting,
    setSelectionMode,
    setSelectionToolMode,
    setHovered,
    isSelected,
    isPinned,
    selectedCount,
    pinnedCount,
    hasSelection,
    intersectWithAvailable,
  ]);

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

export default SelectionProvider;
