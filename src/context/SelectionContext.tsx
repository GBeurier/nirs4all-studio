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
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';

// ============= Types =============

export type SelectionMode = 'replace' | 'add' | 'remove' | 'toggle';

export interface SavedSelection {
  id: string;
  name: string;
  indices: number[];
  createdAt: Date;
  color?: string;
}

export interface SelectionState {
  /** Currently selected sample indices */
  selectedSamples: Set<number>;
  /** Pinned samples (always visible, not affected by filters) */
  pinnedSamples: Set<number>;
  /** Named saved selections */
  savedSelections: SavedSelection[];
  /** Selection history for undo */
  selectionHistory: Set<number>[];
  /** Current position in history */
  historyIndex: number;
  /** Whether selection is active (being modified) */
  isSelecting: boolean;
  /** Current selection mode */
  selectionMode: SelectionMode;
  /** Hover state for cross-chart highlighting */
  hoveredSample: number | null;
}

export type SelectionAction =
  | { type: 'SELECT'; indices: number[]; mode?: SelectionMode }
  | { type: 'DESELECT'; indices: number[] }
  | { type: 'TOGGLE'; indices: number[] }
  | { type: 'SELECT_ALL'; totalSamples: number }
  | { type: 'CLEAR' }
  | { type: 'INVERT'; totalSamples: number }
  | { type: 'PIN'; indices: number[] }
  | { type: 'UNPIN'; indices: number[] }
  | { type: 'CLEAR_PINS' }
  | { type: 'SAVE_SELECTION'; name: string; color?: string }
  | { type: 'LOAD_SELECTION'; id: string }
  | { type: 'DELETE_SAVED_SELECTION'; id: string }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_SELECTING'; isSelecting: boolean }
  | { type: 'SET_SELECTION_MODE'; mode: SelectionMode }
  | { type: 'SET_HOVERED'; index: number | null }
  | { type: 'RESTORE'; state: Partial<SelectionState> }
  | { type: 'INTERSECT_WITH_AVAILABLE'; availableIndices: number[] };

export interface SelectionContextValue extends SelectionState {
  // Selection operations
  select: (indices: number[], mode?: SelectionMode) => void;
  deselect: (indices: number[]) => void;
  toggle: (indices: number[]) => void;
  selectAll: (totalSamples: number) => void;
  clear: () => void;
  invert: (totalSamples: number) => void;

  // Pin operations
  pin: (indices: number[]) => void;
  unpin: (indices: number[]) => void;
  clearPins: () => void;
  togglePin: (index: number) => void;

  // Saved selections
  saveSelection: (name: string, color?: string) => void;
  loadSelection: (id: string) => void;
  deleteSavedSelection: (id: string) => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // State setters
  setSelecting: (isSelecting: boolean) => void;
  setSelectionMode: (mode: SelectionMode) => void;
  setHovered: (index: number | null) => void;

  // Utilities
  isSelected: (index: number) => boolean;
  isPinned: (index: number) => boolean;
  selectedCount: number;
  pinnedCount: number;
  hasSelection: boolean;

  // Filter intersection
  intersectWithAvailable: (availableIndices: number[]) => void;
}

// ============= Constants =============

const MAX_HISTORY = 50;
const STORAGE_KEY = 'playground-selection-state';

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
});

// ============= Reducer =============

function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'SELECT': {
      const mode = action.mode ?? state.selectionMode;
      let newSelection: Set<number>;

      switch (mode) {
        case 'replace':
          newSelection = new Set(action.indices);
          break;
        case 'add':
          newSelection = new Set([...state.selectedSamples, ...action.indices]);
          break;
        case 'remove':
          newSelection = new Set(state.selectedSamples);
          action.indices.forEach(i => newSelection.delete(i));
          break;
        case 'toggle':
          newSelection = new Set(state.selectedSamples);
          action.indices.forEach(i => {
            if (newSelection.has(i)) {
              newSelection.delete(i);
            } else {
              newSelection.add(i);
            }
          });
          break;
        default:
          newSelection = new Set(action.indices);
      }

      // Update history
      const newHistory = state.selectionHistory.slice(0, state.historyIndex + 1);
      newHistory.push(newSelection);
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
      }

      return {
        ...state,
        selectedSamples: newSelection,
        selectionHistory: newHistory,
        historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY - 1),
      };
    }

    case 'DESELECT': {
      const newSelection = new Set(state.selectedSamples);
      action.indices.forEach(i => newSelection.delete(i));

      const newHistory = state.selectionHistory.slice(0, state.historyIndex + 1);
      newHistory.push(newSelection);
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
      }

      return {
        ...state,
        selectedSamples: newSelection,
        selectionHistory: newHistory,
        historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY - 1),
      };
    }

    case 'TOGGLE': {
      const newSelection = new Set(state.selectedSamples);
      action.indices.forEach(i => {
        if (newSelection.has(i)) {
          newSelection.delete(i);
        } else {
          newSelection.add(i);
        }
      });

      const newHistory = state.selectionHistory.slice(0, state.historyIndex + 1);
      newHistory.push(newSelection);
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
      }

      return {
        ...state,
        selectedSamples: newSelection,
        selectionHistory: newHistory,
        historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY - 1),
      };
    }

    case 'SELECT_ALL': {
      const newSelection = new Set(
        Array.from({ length: action.totalSamples }, (_, i) => i)
      );

      const newHistory = state.selectionHistory.slice(0, state.historyIndex + 1);
      newHistory.push(newSelection);
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
      }

      return {
        ...state,
        selectedSamples: newSelection,
        selectionHistory: newHistory,
        historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY - 1),
      };
    }

    case 'CLEAR': {
      if (state.selectedSamples.size === 0) {
        return state;
      }

      const newSelection = new Set<number>();
      const newHistory = state.selectionHistory.slice(0, state.historyIndex + 1);
      newHistory.push(newSelection);
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
      }

      return {
        ...state,
        selectedSamples: newSelection,
        selectionHistory: newHistory,
        historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY - 1),
      };
    }

    case 'INVERT': {
      const newSelection = new Set(
        Array.from({ length: action.totalSamples }, (_, i) => i)
          .filter(i => !state.selectedSamples.has(i))
      );

      const newHistory = state.selectionHistory.slice(0, state.historyIndex + 1);
      newHistory.push(newSelection);
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
      }

      return {
        ...state,
        selectedSamples: newSelection,
        selectionHistory: newHistory,
        historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY - 1),
      };
    }

    case 'PIN': {
      const newPinned = new Set([...state.pinnedSamples, ...action.indices]);
      return {
        ...state,
        pinnedSamples: newPinned,
      };
    }

    case 'UNPIN': {
      const newPinned = new Set(state.pinnedSamples);
      action.indices.forEach(i => newPinned.delete(i));
      return {
        ...state,
        pinnedSamples: newPinned,
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
      const newHistory = state.selectionHistory.slice(0, state.historyIndex + 1);
      newHistory.push(newSelection);
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
      }

      return {
        ...state,
        selectedSamples: newSelection,
        selectionHistory: newHistory,
        historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY - 1),
      };
    }

    case 'DELETE_SAVED_SELECTION': {
      return {
        ...state,
        savedSelections: state.savedSelections.filter(s => s.id !== action.id),
      };
    }

    case 'UNDO': {
      if (state.historyIndex <= 0) {
        return state;
      }

      const newIndex = state.historyIndex - 1;
      return {
        ...state,
        selectedSamples: new Set(state.selectionHistory[newIndex]),
        historyIndex: newIndex,
      };
    }

    case 'REDO': {
      if (state.historyIndex >= state.selectionHistory.length - 1) {
        return state;
      }

      const newIndex = state.historyIndex + 1;
      return {
        ...state,
        selectedSamples: new Set(state.selectionHistory[newIndex]),
        historyIndex: newIndex,
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

      const newHistory = state.selectionHistory.slice(0, state.historyIndex + 1);
      newHistory.push(newSelection);
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
      }

      return {
        ...state,
        selectedSamples: newSelection,
        pinnedSamples: newPinned,
        selectionHistory: newHistory,
        historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY - 1),
      };
    }

    default:
      return state;
  }
}

// ============= Context =============

const SelectionContext = createContext<SelectionContextValue | undefined>(undefined);

// ============= Storage Helpers =============

interface SerializedState {
  selectedSamples: number[];
  pinnedSamples: number[];
  savedSelections: SavedSelection[];
}

function persistState(state: SelectionState): void {
  try {
    const serialized: SerializedState = {
      selectedSamples: Array.from(state.selectedSamples),
      pinnedSamples: Array.from(state.pinnedSamples),
      savedSelections: state.savedSelections,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch (e) {
    console.warn('Failed to persist selection state:', e);
  }
}

function loadPersistedState(): Partial<SelectionState> | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: SerializedState = JSON.parse(stored);
      return {
        selectedSamples: new Set(parsed.selectedSamples || []),
        pinnedSamples: new Set(parsed.pinnedSamples || []),
        savedSelections: (parsed.savedSelections || []).map(s => ({
          ...s,
          createdAt: new Date(s.createdAt),
        })),
      };
    }
  } catch (e) {
    console.warn('Failed to load persisted selection state:', e);
  }
  return null;
}

// ============= Provider =============

interface SelectionProviderProps {
  children: ReactNode;
}

export function SelectionProvider({ children }: SelectionProviderProps) {
  const [state, dispatch] = useReducer(selectionReducer, null, () => {
    const initial = createInitialState();
    const persisted = loadPersistedState();
    if (persisted) {
      return { ...initial, ...persisted };
    }
    return initial;
  });

  // Persist state changes (debounced)
  useEffect(() => {
    const timeout = setTimeout(() => {
      persistState(state);
    }, 100);
    return () => clearTimeout(timeout);
  }, [state.selectedSamples, state.pinnedSamples, state.savedSelections]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in input fields
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }

      // Ctrl+Z or Cmd+Z - Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'UNDO' });
        return;
      }

      // Ctrl+Shift+Z or Cmd+Shift+Z - Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'REDO' });
        return;
      }

      // Ctrl+Y or Cmd+Y - Redo (alternative)
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        dispatch({ type: 'REDO' });
        return;
      }

      // Escape - Clear selection
      if (e.key === 'Escape') {
        dispatch({ type: 'CLEAR' });
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Memoized action creators
  const select = useCallback((indices: number[], mode?: SelectionMode) => {
    dispatch({ type: 'SELECT', indices, mode });
  }, []);

  const deselect = useCallback((indices: number[]) => {
    dispatch({ type: 'DESELECT', indices });
  }, []);

  const toggle = useCallback((indices: number[]) => {
    dispatch({ type: 'TOGGLE', indices });
  }, []);

  const selectAll = useCallback((totalSamples: number) => {
    dispatch({ type: 'SELECT_ALL', totalSamples });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'CLEAR' });
  }, []);

  const invert = useCallback((totalSamples: number) => {
    dispatch({ type: 'INVERT', totalSamples });
  }, []);

  const pin = useCallback((indices: number[]) => {
    dispatch({ type: 'PIN', indices });
  }, []);

  const unpin = useCallback((indices: number[]) => {
    dispatch({ type: 'UNPIN', indices });
  }, []);

  const clearPins = useCallback(() => {
    dispatch({ type: 'CLEAR_PINS' });
  }, []);

  const togglePin = useCallback((index: number) => {
    if (state.pinnedSamples.has(index)) {
      dispatch({ type: 'UNPIN', indices: [index] });
    } else {
      dispatch({ type: 'PIN', indices: [index] });
    }
  }, [state.pinnedSamples]);

  const saveSelection = useCallback((name: string, color?: string) => {
    dispatch({ type: 'SAVE_SELECTION', name, color });
  }, []);

  const loadSelection = useCallback((id: string) => {
    dispatch({ type: 'LOAD_SELECTION', id });
  }, []);

  const deleteSavedSelection = useCallback((id: string) => {
    dispatch({ type: 'DELETE_SAVED_SELECTION', id });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: 'UNDO' });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: 'REDO' });
  }, []);

  const setSelecting = useCallback((isSelecting: boolean) => {
    dispatch({ type: 'SET_SELECTING', isSelecting });
  }, []);

  const setSelectionMode = useCallback((mode: SelectionMode) => {
    dispatch({ type: 'SET_SELECTION_MODE', mode });
  }, []);

  const setHovered = useCallback((index: number | null) => {
    dispatch({ type: 'SET_HOVERED', index });
  }, []);

  const intersectWithAvailable = useCallback((availableIndices: number[]) => {
    dispatch({ type: 'INTERSECT_WITH_AVAILABLE', availableIndices });
  }, []);

  const isSelected = useCallback((index: number) => {
    return state.selectedSamples.has(index);
  }, [state.selectedSamples]);

  const isPinned = useCallback((index: number) => {
    return state.pinnedSamples.has(index);
  }, [state.pinnedSamples]);

  // Derived values
  const canUndo = state.historyIndex > 0;
  const canRedo = state.historyIndex < state.selectionHistory.length - 1;
  const selectedCount = state.selectedSamples.size;
  const pinnedCount = state.pinnedSamples.size;
  const hasSelection = selectedCount > 0;

  const value = useMemo<SelectionContextValue>(() => ({
    ...state,
    select,
    deselect,
    toggle,
    selectAll,
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
    setHovered,
    isSelected,
    isPinned,
    selectedCount,
    pinnedCount,
    hasSelection,
    intersectWithAvailable,
  }), [
    state,
    select,
    deselect,
    toggle,
    selectAll,
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

// ============= Hook =============

export function useSelection(): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (context === undefined) {
    throw new Error('useSelection must be used within a SelectionProvider');
  }
  return context;
}

/**
 * Hook to get selection state without actions (for performance-sensitive components)
 */
export function useSelectionState() {
  const { selectedSamples, pinnedSamples, hoveredSample, isSelected, isPinned } = useSelection();
  return { selectedSamples, pinnedSamples, hoveredSample, isSelected, isPinned };
}

export default SelectionProvider;
