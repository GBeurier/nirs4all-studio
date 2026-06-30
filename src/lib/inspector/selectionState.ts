import type { InspectorSavedSelection, InspectorSelectionToolMode } from '@/types/inspector';
import {
  addToSet,
  applySelectionMode,
  redoHistory,
  removeFromSet,
  toggleInSet,
  undoHistory,
  pushHistory as pushHistoryCore,
  type PersistedSelection,
  type SelectionModeBase,
} from '@/context/selection/createSelectionCore';

export type InspectorSelectionMode = SelectionModeBase;

export interface InspectorSelectionState {
  selectedChains: Set<string>;
  pinnedChains: Set<string>;
  savedSelections: InspectorSavedSelection[];
  selectionHistory: Set<string>[];
  historyIndex: number;
  selectionMode: InspectorSelectionMode;
  selectionToolMode: InspectorSelectionToolMode;
}

export type InspectorSelectionAction =
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
  | { type: 'SAVE_SELECTION'; selection: InspectorSavedSelection }
  | { type: 'LOAD_SELECTION'; id: string }
  | { type: 'DELETE_SAVED_SELECTION'; id: string }
  | { type: 'RESTORE'; selectedChains: string[]; pinnedChains?: string[]; savedSelections?: InspectorSavedSelection[] };

export function createInitialInspectorSelectionState(): InspectorSelectionState {
  return {
    selectedChains: new Set<string>(),
    pinnedChains: new Set<string>(),
    savedSelections: [],
    selectionHistory: [new Set<string>()],
    historyIndex: 0,
    selectionMode: 'replace',
    selectionToolMode: 'click',
  };
}

export function restoreInspectorSelectionState(
  persisted: PersistedSelection<string, InspectorSavedSelection> | null | undefined,
): InspectorSelectionState {
  const initial = createInitialInspectorSelectionState();
  if (!persisted) {
    return initial;
  }
  return {
    ...initial,
    selectedChains: persisted.selected ? new Set(persisted.selected) : initial.selectedChains,
    pinnedChains: persisted.pinned ? new Set(persisted.pinned) : initial.pinnedChains,
    savedSelections: persisted.savedSelections ?? initial.savedSelections,
  };
}

export function createInspectorSavedSelection({
  chainIds,
  color,
  createdAt = new Date().toISOString(),
  id = `sel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  name,
}: {
  chainIds: Iterable<string>;
  color?: string;
  createdAt?: string;
  id?: string;
  name: string;
}): InspectorSavedSelection {
  return {
    id,
    name,
    chain_ids: Array.from(chainIds),
    createdAt,
    color,
  };
}

function withInspectorSelectionHistory(
  state: InspectorSelectionState,
  selectedChains: Set<string>,
): InspectorSelectionState {
  return {
    ...state,
    selectedChains,
    ...pushHistoryCore(state.selectionHistory, state.historyIndex, selectedChains),
  };
}

export function getInspectorSelectionDerivedState(state: InspectorSelectionState): {
  selectedCount: number;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  pinnedCount: number;
} {
  const selectedCount = state.selectedChains.size;
  return {
    selectedCount,
    hasSelection: selectedCount > 0,
    canUndo: state.historyIndex > 0,
    canRedo: state.historyIndex < state.selectionHistory.length - 1,
    pinnedCount: state.pinnedChains.size,
  };
}

export function inspectorSelectionReducer(
  state: InspectorSelectionState,
  action: InspectorSelectionAction,
): InspectorSelectionState {
  switch (action.type) {
    case 'SELECT':
      return withInspectorSelectionHistory(
        state,
        applySelectionMode(state.selectedChains, action.chainIds, action.mode ?? state.selectionMode),
      );

    case 'DESELECT':
      return withInspectorSelectionHistory(state, removeFromSet(state.selectedChains, action.chainIds));

    case 'TOGGLE':
      return withInspectorSelectionHistory(
        state,
        applySelectionMode(state.selectedChains, action.chainIds, 'toggle'),
      );

    case 'CLEAR':
      if (state.selectedChains.size === 0) {
        return state;
      }
      return withInspectorSelectionHistory(state, new Set<string>());

    case 'SELECT_ALL':
      return withInspectorSelectionHistory(state, new Set(action.chainIds));

    case 'INVERT': {
      const selectedChains = new Set<string>();
      for (const id of action.allChainIds) {
        if (!state.selectedChains.has(id)) {
          selectedChains.add(id);
        }
      }
      return withInspectorSelectionHistory(state, selectedChains);
    }

    case 'UNDO': {
      const result = undoHistory(state.selectionHistory, state.historyIndex);
      if (!result) {
        return state;
      }
      return { ...state, selectedChains: result.selection, historyIndex: result.historyIndex };
    }

    case 'REDO': {
      const result = redoHistory(state.selectionHistory, state.historyIndex);
      if (!result) {
        return state;
      }
      return { ...state, selectedChains: result.selection, historyIndex: result.historyIndex };
    }

    case 'SET_MODE':
      return { ...state, selectionMode: action.mode };

    case 'SET_TOOL_MODE':
      return { ...state, selectionToolMode: action.tool };

    case 'PIN':
      return { ...state, pinnedChains: addToSet(state.pinnedChains, action.chainIds) };

    case 'UNPIN':
      return { ...state, pinnedChains: removeFromSet(state.pinnedChains, action.chainIds) };

    case 'CLEAR_PINS':
      if (state.pinnedChains.size === 0) {
        return state;
      }
      return { ...state, pinnedChains: new Set<string>() };

    case 'TOGGLE_PIN':
      return { ...state, pinnedChains: toggleInSet(state.pinnedChains, action.chainId) };

    case 'SAVE_SELECTION':
      if (action.selection.chain_ids.length === 0) {
        return state;
      }
      return { ...state, savedSelections: [...state.savedSelections, action.selection] };

    case 'LOAD_SELECTION': {
      const saved = state.savedSelections.find(selection => selection.id === action.id);
      if (!saved) {
        return state;
      }
      return withInspectorSelectionHistory(state, new Set(saved.chain_ids));
    }

    case 'DELETE_SAVED_SELECTION':
      return {
        ...state,
        savedSelections: state.savedSelections.filter(selection => selection.id !== action.id),
      };

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
