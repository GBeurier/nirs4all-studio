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
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { InspectorSelectionToolMode, InspectorSavedSelection } from '@/types/inspector';

// ============= Types =============

export type InspectorSelectionMode = 'replace' | 'add' | 'remove' | 'toggle';

export interface InspectorSelectionState {
  selectedChains: Set<string>;
  pinnedChains: Set<string>;
  savedSelections: InspectorSavedSelection[];
  selectionHistory: Set<string>[];
  historyIndex: number;
  selectionMode: InspectorSelectionMode;
  selectionToolMode: InspectorSelectionToolMode;
}

type InspectorSelectionAction =
  | { type: 'SELECT'; chainIds: string[]; mode?: InspectorSelectionMode }
  | { type: 'DESELECT'; chainIds: string[] }
  | { type: 'TOGGLE'; chainIds: string[] }
  | { type: 'CLEAR' }
  | { type: 'SELECT_ALL'; chainIds: string[] }
  | { type: 'INVERT'; allChainIds: string[] }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_MODE'; mode: InspectorSelectionMode }
  | { type: 'SET_TOOL_MODE'; tool: InspectorSelectionToolMode }
  | { type: 'PIN'; chainIds: string[] }
  | { type: 'UNPIN'; chainIds: string[] }
  | { type: 'CLEAR_PINS' }
  | { type: 'TOGGLE_PIN'; chainId: string }
  | { type: 'SAVE_SELECTION'; name: string; color?: string }
  | { type: 'LOAD_SELECTION'; id: string }
  | { type: 'DELETE_SAVED_SELECTION'; id: string }
  | { type: 'RESTORE'; selectedChains: string[]; pinnedChains?: string[]; savedSelections?: InspectorSavedSelection[] };

export interface InspectorSelectionContextValue extends InspectorSelectionState {
  // Selection
  select: (chainIds: string[], mode?: InspectorSelectionMode) => void;
  deselect: (chainIds: string[]) => void;
  toggle: (chainIds: string[]) => void;
  clear: () => void;
  selectAll: (chainIds: string[]) => void;
  invert: (allChainIds: string[]) => void;
  undo: () => void;
  redo: () => void;
  setSelectionMode: (mode: InspectorSelectionMode) => void;
  isSelected: (chainId: string) => boolean;
  selectedCount: number;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;

  // Pins
  pin: (chainIds: string[]) => void;
  unpin: (chainIds: string[]) => void;
  clearPins: () => void;
  togglePin: (chainId: string) => void;
  isPinned: (chainId: string) => boolean;
  pinnedCount: number;

  // Saved selections
  saveSelection: (name: string, color?: string) => void;
  loadSelection: (id: string) => void;
  deleteSavedSelection: (id: string) => void;

  // Tool mode
  setSelectionToolMode: (tool: InspectorSelectionToolMode) => void;
}

// ============= Constants =============

const MAX_HISTORY = 10;
const STORAGE_KEY = 'inspector-selection-state';

// ============= Initial State =============

const createInitialState = (): InspectorSelectionState => ({
  selectedChains: new Set<string>(),
  pinnedChains: new Set<string>(),
  savedSelections: [],
  selectionHistory: [new Set<string>()],
  historyIndex: 0,
  selectionMode: 'replace',
  selectionToolMode: 'click',
});

// ============= Helpers =============

function pushHistory(state: InspectorSelectionState, newSelection: Set<string>): Pick<InspectorSelectionState, 'selectionHistory' | 'historyIndex'> {
  const newHistory = state.selectionHistory.slice(0, state.historyIndex + 1);
  newHistory.push(newSelection);
  if (newHistory.length > MAX_HISTORY) newHistory.shift();
  return {
    selectionHistory: newHistory,
    historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY - 1),
  };
}

function generateId(): string {
  return `sel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============= Reducer =============

function selectionReducer(state: InspectorSelectionState, action: InspectorSelectionAction): InspectorSelectionState {
  switch (action.type) {
    case 'SELECT': {
      const mode = action.mode ?? state.selectionMode;
      let newSelection: Set<string>;

      switch (mode) {
        case 'replace':
          newSelection = new Set(action.chainIds);
          break;
        case 'add':
          newSelection = new Set([...state.selectedChains, ...action.chainIds]);
          break;
        case 'remove':
          newSelection = new Set(state.selectedChains);
          action.chainIds.forEach(id => newSelection.delete(id));
          break;
        case 'toggle':
          newSelection = new Set(state.selectedChains);
          action.chainIds.forEach(id => {
            if (newSelection.has(id)) newSelection.delete(id);
            else newSelection.add(id);
          });
          break;
        default:
          newSelection = new Set(action.chainIds);
      }

      return { ...state, selectedChains: newSelection, ...pushHistory(state, newSelection) };
    }

    case 'DESELECT': {
      const newSelection = new Set(state.selectedChains);
      action.chainIds.forEach(id => newSelection.delete(id));
      return { ...state, selectedChains: newSelection, ...pushHistory(state, newSelection) };
    }

    case 'TOGGLE': {
      const newSelection = new Set(state.selectedChains);
      action.chainIds.forEach(id => {
        if (newSelection.has(id)) newSelection.delete(id);
        else newSelection.add(id);
      });
      return { ...state, selectedChains: newSelection, ...pushHistory(state, newSelection) };
    }

    case 'CLEAR': {
      if (state.selectedChains.size === 0) return state;
      const newSelection = new Set<string>();
      return { ...state, selectedChains: newSelection, ...pushHistory(state, newSelection) };
    }

    case 'SELECT_ALL': {
      const newSelection = new Set(action.chainIds);
      return { ...state, selectedChains: newSelection, ...pushHistory(state, newSelection) };
    }

    case 'INVERT': {
      const newSelection = new Set<string>();
      for (const id of action.allChainIds) {
        if (!state.selectedChains.has(id)) newSelection.add(id);
      }
      return { ...state, selectedChains: newSelection, ...pushHistory(state, newSelection) };
    }

    case 'UNDO': {
      if (state.historyIndex <= 0) return state;
      const newIndex = state.historyIndex - 1;
      return { ...state, selectedChains: state.selectionHistory[newIndex], historyIndex: newIndex };
    }

    case 'REDO': {
      if (state.historyIndex >= state.selectionHistory.length - 1) return state;
      const newIndex = state.historyIndex + 1;
      return { ...state, selectedChains: state.selectionHistory[newIndex], historyIndex: newIndex };
    }

    case 'SET_MODE':
      return { ...state, selectionMode: action.mode };

    case 'SET_TOOL_MODE':
      return { ...state, selectionToolMode: action.tool };

    // Pin operations
    case 'PIN': {
      const newPinned = new Set(state.pinnedChains);
      action.chainIds.forEach(id => newPinned.add(id));
      return { ...state, pinnedChains: newPinned };
    }

    case 'UNPIN': {
      const newPinned = new Set(state.pinnedChains);
      action.chainIds.forEach(id => newPinned.delete(id));
      return { ...state, pinnedChains: newPinned };
    }

    case 'CLEAR_PINS': {
      if (state.pinnedChains.size === 0) return state;
      return { ...state, pinnedChains: new Set<string>() };
    }

    case 'TOGGLE_PIN': {
      const newPinned = new Set(state.pinnedChains);
      if (newPinned.has(action.chainId)) newPinned.delete(action.chainId);
      else newPinned.add(action.chainId);
      return { ...state, pinnedChains: newPinned };
    }

    // Saved selections
    case 'SAVE_SELECTION': {
      if (state.selectedChains.size === 0) return state;
      const newSaved: InspectorSavedSelection = {
        id: generateId(),
        name: action.name,
        chain_ids: Array.from(state.selectedChains),
        createdAt: new Date().toISOString(),
        color: action.color,
      };
      return { ...state, savedSelections: [...state.savedSelections, newSaved] };
    }

    case 'LOAD_SELECTION': {
      const saved = state.savedSelections.find(s => s.id === action.id);
      if (!saved) return state;
      const newSelection = new Set(saved.chain_ids);
      return { ...state, selectedChains: newSelection, ...pushHistory(state, newSelection) };
    }

    case 'DELETE_SAVED_SELECTION': {
      return { ...state, savedSelections: state.savedSelections.filter(s => s.id !== action.id) };
    }

    case 'RESTORE':
      return {
        ...state,
        selectedChains: new Set(action.selectedChains),
        pinnedChains: action.pinnedChains ? new Set(action.pinnedChains) : state.pinnedChains,
        savedSelections: action.savedSelections ?? state.savedSelections,
      };

    default:
      return state;
  }
}

// ============= Contexts =============

const InspectorSelectionContext = createContext<InspectorSelectionContextValue | undefined>(undefined);

interface InspectorHoverContextValue {
  hoveredChain: string | null;
  setHovered: (chainId: string | null) => void;
}

const InspectorHoverContext = createContext<InspectorHoverContextValue | undefined>(undefined);

// ============= Storage Helpers =============

function persistState(state: InspectorSelectionState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      selectedChains: Array.from(state.selectedChains),
      pinnedChains: Array.from(state.pinnedChains),
      savedSelections: state.savedSelections,
    }));
  } catch { /* ignore */ }
}

function loadPersistedState(): { selectedChains?: string[]; pinnedChains?: string[]; savedSelections?: InspectorSavedSelection[] } | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch { /* ignore */ }
  return null;
}

// ============= Provider =============

export function InspectorSelectionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(selectionReducer, null, () => {
    const initial = createInitialState();
    const persisted = loadPersistedState();
    if (persisted) {
      return {
        ...initial,
        selectedChains: persisted.selectedChains ? new Set(persisted.selectedChains) : initial.selectedChains,
        pinnedChains: persisted.pinnedChains ? new Set(persisted.pinnedChains) : initial.pinnedChains,
        savedSelections: persisted.savedSelections ?? initial.savedSelections,
      };
    }
    return initial;
  });

  const [hoveredChain, setHoveredChainState] = useState<string | null>(null);

  // Persist state changes
  useEffect(() => {
    const timeout = setTimeout(() => persistState(state), 500);
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
  const saveSelection = useCallback((name: string, color?: string) => dispatch({ type: 'SAVE_SELECTION', name, color }), []);
  const loadSelection = useCallback((id: string) => dispatch({ type: 'LOAD_SELECTION', id }), []);
  const deleteSavedSelection = useCallback((id: string) => dispatch({ type: 'DELETE_SAVED_SELECTION', id }), []);

  // Derived state
  const isSelected = useCallback((chainId: string) => state.selectedChains.has(chainId), [state.selectedChains]);
  const isPinned = useCallback((chainId: string) => state.pinnedChains.has(chainId), [state.pinnedChains]);
  const canUndo = state.historyIndex > 0;
  const canRedo = state.historyIndex < state.selectionHistory.length - 1;
  const selectedCount = state.selectedChains.size;
  const hasSelection = selectedCount > 0;
  const pinnedCount = state.pinnedChains.size;

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

// ============= Hooks =============

export function useInspectorSelection(): InspectorSelectionContextValue {
  const context = useContext(InspectorSelectionContext);
  if (context === undefined) {
    throw new Error('useInspectorSelection must be used within an InspectorSelectionProvider');
  }
  return context;
}

export function useInspectorHover(): InspectorHoverContextValue {
  const context = useContext(InspectorHoverContext);
  if (context === undefined) {
    throw new Error('useInspectorHover must be used within an InspectorSelectionProvider');
  }
  return context;
}
