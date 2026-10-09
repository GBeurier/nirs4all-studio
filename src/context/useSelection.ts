import { createContext, useContext } from 'react';
import type { SelectionModeBase } from './selection/createSelectionCore';

export type SelectionMode = SelectionModeBase;

/** Selection tool type for area selection (click, box, lasso) */
export type SelectionToolType = 'click' | 'box' | 'lasso';

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
  /** Last selected sample index for range selection (Shift+Click) */
  lastSelectedIndex: number | null;
  /** Current selection tool type (click, box, lasso) */
  selectionToolMode: SelectionToolType;
}

export type SelectionAction =
  | { type: 'SELECT'; indices: number[]; mode?: SelectionMode }
  | { type: 'DESELECT'; indices: number[] }
  | { type: 'TOGGLE'; indices: number[] }
  | { type: 'SELECT_ALL'; totalSamples: number }
  | { type: 'SELECT_RANGE'; toIndex: number; mode?: SelectionMode }
  | { type: 'SELECT_RANGE_ORDERED'; toIndex: number; order: number[]; mode?: SelectionMode }
  | { type: 'REPLACE_IF_NOT_SOLE'; indices: number[] }
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
  | { type: 'SET_SELECTION_TOOL'; tool: SelectionToolType }
  | { type: 'RESTORE'; state: Partial<SelectionState> }
  | { type: 'INTERSECT_WITH_AVAILABLE'; availableIndices: number[] };

export interface SelectionContextValue extends SelectionState {
  // Selection operations
  select: (indices: number[], mode?: SelectionMode) => void;
  deselect: (indices: number[]) => void;
  toggle: (indices: number[]) => void;
  selectAll: (totalSamples: number) => void;
  selectRange: (toIndex: number, mode?: SelectionMode) => void;
  /** Select range with custom ordering (e.g., sorted by Y value, bar position) */
  selectRangeOrdered: (toIndex: number, order: number[], mode?: SelectionMode) => void;
  /** Replace selection with indices, or clear if indices exactly match current selection */
  replaceIfNotSole: (indices: number[]) => void;
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
  setSelectionToolMode: (tool: SelectionToolType) => void;

  // Utilities
  isSelected: (index: number) => boolean;
  isPinned: (index: number) => boolean;
  selectedCount: number;
  pinnedCount: number;
  hasSelection: boolean;

  // Filter intersection
  intersectWithAvailable: (availableIndices: number[]) => void;
}

export const SelectionContext = createContext<SelectionContextValue | undefined>(undefined);

/**
 * Hover state lives in its own contexts so pointer movement over a chart only
 * re-renders components that actually render the hovered sample (see `useHoveredSample`),
 * never the ~40 selection consumers. Outside a provider the hovered sample is `null`
 * and the setter is a no-op, which suits charts that optionally use the shared selection.
 */
export const HoveredSampleContext = createContext<number | null>(null);
export const SetHoveredSampleContext = createContext<(index: number | null) => void>(() => {});

/** Sample currently hovered for cross-chart highlighting. Re-renders on every hover change. */
export function useHoveredSample(): number | null {
  return useContext(HoveredSampleContext);
}

/** Stable setter for the hovered sample; subscribing to it never re-renders on hover. */
export function useSetHoveredSample(): (index: number | null) => void {
  return useContext(SetHoveredSampleContext);
}

export function useSelection(): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (context === undefined) {
    throw new Error('useSelection must be used within a SelectionProvider');
  }
  return context;
}
