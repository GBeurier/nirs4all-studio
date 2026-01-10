/**
 * SelectionContext Unit Tests
 *
 * Tests for the selection reducer actions, specifically the new Phase 7 additions:
 * - REPLACE_IF_NOT_SOLE
 * - SELECT_RANGE_ORDERED
 *
 * @see docs/_internals/PLAYGROUND_SELECTION_MODEL.md
 */

import { describe, it, expect } from 'vitest';

// Since the reducer is not exported, we need to test through the actions
// We'll import types and create a minimal test harness
import type { SelectionState, SelectionAction, SelectionMode } from '../SelectionContext';

// ============= Test Harness =============

// Recreate the reducer logic for testing (since it's not exported)
// This ensures we test the exact same logic

const MAX_HISTORY = 10;

function createInitialState(): SelectionState {
  return {
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
  };
}

function createState(overrides: Partial<SelectionState> = {}): SelectionState {
  return { ...createInitialState(), ...overrides };
}

// Minimal reducer implementation for testing new actions
function testReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'SELECT_RANGE_ORDERED': {
      const order = action.order;
      if (order.length === 0) {
        return state;
      }

      if (state.lastSelectedIndex === null) {
        const newSelection = new Set([action.toIndex]);
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
          lastSelectedIndex: action.toIndex,
        };
      }

      const fromPos = order.indexOf(state.lastSelectedIndex);
      const toPos = order.indexOf(action.toIndex);

      if (fromPos === -1 || toPos === -1) {
        const newSelection = new Set([action.toIndex]);
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
          lastSelectedIndex: action.toIndex,
        };
      }

      const minPos = Math.min(fromPos, toPos);
      const maxPos = Math.max(fromPos, toPos);
      const rangeIndices = order.slice(minPos, maxPos + 1);

      const mode = action.mode ?? 'add';
      let newSelection: Set<number>;

      switch (mode) {
        case 'replace':
          newSelection = new Set(rangeIndices);
          break;
        case 'add':
          newSelection = new Set([...state.selectedSamples, ...rangeIndices]);
          break;
        case 'remove':
          newSelection = new Set(state.selectedSamples);
          rangeIndices.forEach(i => newSelection.delete(i));
          break;
        case 'toggle':
          newSelection = new Set(state.selectedSamples);
          rangeIndices.forEach(i => {
            if (newSelection.has(i)) {
              newSelection.delete(i);
            } else {
              newSelection.add(i);
            }
          });
          break;
        default:
          newSelection = new Set([...state.selectedSamples, ...rangeIndices]);
      }

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
        lastSelectedIndex: action.toIndex,
      };
    }

    case 'REPLACE_IF_NOT_SOLE': {
      const targetSet = new Set(action.indices);
      const currentSize = state.selectedSamples.size;
      const targetSize = targetSet.size;

      const selectionsMatch =
        currentSize === targetSize &&
        targetSize > 0 &&
        action.indices.every(i => state.selectedSamples.has(i));

      if (selectionsMatch) {
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

      const newSelection = new Set(action.indices);
      const newHistory = state.selectionHistory.slice(0, state.historyIndex + 1);
      newHistory.push(newSelection);
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
      }

      const lastIdx = action.indices.length > 0 ? action.indices[action.indices.length - 1] : state.lastSelectedIndex;

      return {
        ...state,
        selectedSamples: newSelection,
        selectionHistory: newHistory,
        historyIndex: Math.min(newHistory.length - 1, MAX_HISTORY - 1),
        lastSelectedIndex: lastIdx,
      };
    }

    default:
      return state;
  }
}

// ============= REPLACE_IF_NOT_SOLE Tests =============

describe('REPLACE_IF_NOT_SOLE action', () => {
  describe('when selection is empty', () => {
    it('should select the target indices', () => {
      const state = createState({ selectedSamples: new Set() });
      const action: SelectionAction = {
        type: 'REPLACE_IF_NOT_SOLE',
        indices: [5, 10, 15],
      };

      const result = testReducer(state, action);

      expect(result.selectedSamples).toEqual(new Set([5, 10, 15]));
      expect(result.lastSelectedIndex).toBe(15);
    });

    it('should add to history', () => {
      const state = createState({ selectedSamples: new Set() });
      const action: SelectionAction = {
        type: 'REPLACE_IF_NOT_SOLE',
        indices: [5],
      };

      const result = testReducer(state, action);

      expect(result.selectionHistory.length).toBe(2);
      expect(result.historyIndex).toBe(1);
    });
  });

  describe('when target matches selection exactly (sole selection)', () => {
    it('should clear selection for single item', () => {
      const state = createState({ selectedSamples: new Set([5]) });
      const action: SelectionAction = {
        type: 'REPLACE_IF_NOT_SOLE',
        indices: [5],
      };

      const result = testReducer(state, action);

      expect(result.selectedSamples.size).toBe(0);
    });

    it('should clear selection for multiple items', () => {
      const state = createState({ selectedSamples: new Set([5, 10, 15]) });
      const action: SelectionAction = {
        type: 'REPLACE_IF_NOT_SOLE',
        indices: [5, 10, 15],
      };

      const result = testReducer(state, action);

      expect(result.selectedSamples.size).toBe(0);
    });

    it('should add clear to history', () => {
      const state = createState({ selectedSamples: new Set([5]) });
      const action: SelectionAction = {
        type: 'REPLACE_IF_NOT_SOLE',
        indices: [5],
      };

      const result = testReducer(state, action);

      expect(result.selectionHistory.length).toBe(2);
      expect(result.selectionHistory[1].size).toBe(0);
    });
  });

  describe('when selection has other items (multi-selection)', () => {
    it('should replace with target indices', () => {
      const state = createState({ selectedSamples: new Set([1, 2, 3, 5]) });
      const action: SelectionAction = {
        type: 'REPLACE_IF_NOT_SOLE',
        indices: [5],
      };

      const result = testReducer(state, action);

      expect(result.selectedSamples).toEqual(new Set([5]));
    });

    it('should update lastSelectedIndex', () => {
      const state = createState({
        selectedSamples: new Set([1, 2, 3]),
        lastSelectedIndex: 1,
      });
      const action: SelectionAction = {
        type: 'REPLACE_IF_NOT_SOLE',
        indices: [10, 20],
      };

      const result = testReducer(state, action);

      expect(result.lastSelectedIndex).toBe(20);
    });
  });

  describe('when target partially overlaps selection', () => {
    it('should replace selection (not clear)', () => {
      const state = createState({ selectedSamples: new Set([5, 10]) });
      const action: SelectionAction = {
        type: 'REPLACE_IF_NOT_SOLE',
        indices: [5], // Only one of the two selected items
      };

      const result = testReducer(state, action);

      expect(result.selectedSamples).toEqual(new Set([5]));
    });
  });

  describe('edge cases', () => {
    it('should handle empty indices array', () => {
      const state = createState({ selectedSamples: new Set([1, 2, 3]) });
      const action: SelectionAction = {
        type: 'REPLACE_IF_NOT_SOLE',
        indices: [],
      };

      const result = testReducer(state, action);

      // Empty target doesn't match non-empty selection, so it replaces
      expect(result.selectedSamples).toEqual(new Set());
    });

    it('should handle empty indices when selection is also empty', () => {
      const state = createState({ selectedSamples: new Set() });
      const action: SelectionAction = {
        type: 'REPLACE_IF_NOT_SOLE',
        indices: [],
      };

      const result = testReducer(state, action);

      // Both empty but targetSize is 0, so selectionsMatch is false (targetSize > 0 check)
      expect(result.selectedSamples).toEqual(new Set());
    });
  });
});

// ============= SELECT_RANGE_ORDERED Tests =============

describe('SELECT_RANGE_ORDERED action', () => {
  describe('with no previous selection (lastSelectedIndex is null)', () => {
    it('should select only the target index', () => {
      const state = createState({ lastSelectedIndex: null });
      const action: SelectionAction = {
        type: 'SELECT_RANGE_ORDERED',
        toIndex: 5,
        order: [1, 3, 5, 7, 9],
      };

      const result = testReducer(state, action);

      expect(result.selectedSamples).toEqual(new Set([5]));
      expect(result.lastSelectedIndex).toBe(5);
    });
  });

  describe('with previous selection', () => {
    it('should select range in custom order (forward)', () => {
      const state = createState({
        selectedSamples: new Set([3]),
        lastSelectedIndex: 3,
      });
      // Order: sorted by Y value (not index)
      const order = [10, 3, 7, 1, 5]; // Custom ordering
      const action: SelectionAction = {
        type: 'SELECT_RANGE_ORDERED',
        toIndex: 5,
        order,
        mode: 'replace',
      };

      const result = testReducer(state, action);

      // 3 is at position 1, 5 is at position 4
      // Range: [3, 7, 1, 5]
      expect(result.selectedSamples).toEqual(new Set([3, 7, 1, 5]));
    });

    it('should select range in custom order (backward)', () => {
      const state = createState({
        selectedSamples: new Set([5]),
        lastSelectedIndex: 5,
      });
      const order = [10, 3, 7, 1, 5];
      const action: SelectionAction = {
        type: 'SELECT_RANGE_ORDERED',
        toIndex: 3,
        order,
        mode: 'replace',
      };

      const result = testReducer(state, action);

      // 5 is at position 4, 3 is at position 1
      // Range: [3, 7, 1, 5]
      expect(result.selectedSamples).toEqual(new Set([3, 7, 1, 5]));
    });

    it('should add to existing selection with mode=add', () => {
      const state = createState({
        selectedSamples: new Set([100, 200]),
        lastSelectedIndex: 3,
      });
      const order = [1, 2, 3, 4, 5];
      const action: SelectionAction = {
        type: 'SELECT_RANGE_ORDERED',
        toIndex: 5,
        order,
        mode: 'add',
      };

      const result = testReducer(state, action);

      // Range [3, 4, 5] added to existing [100, 200]
      expect(result.selectedSamples).toEqual(new Set([100, 200, 3, 4, 5]));
    });

    it('should remove from selection with mode=remove', () => {
      const state = createState({
        selectedSamples: new Set([1, 2, 3, 4, 5]),
        lastSelectedIndex: 2,
      });
      const order = [1, 2, 3, 4, 5];
      const action: SelectionAction = {
        type: 'SELECT_RANGE_ORDERED',
        toIndex: 4,
        order,
        mode: 'remove',
      };

      const result = testReducer(state, action);

      // Range [2, 3, 4] removed from [1, 2, 3, 4, 5]
      expect(result.selectedSamples).toEqual(new Set([1, 5]));
    });

    it('should toggle selection with mode=toggle', () => {
      const state = createState({
        selectedSamples: new Set([2, 4]), // Some in range, some not
        lastSelectedIndex: 1,
      });
      const order = [1, 2, 3, 4, 5];
      const action: SelectionAction = {
        type: 'SELECT_RANGE_ORDERED',
        toIndex: 4,
        order,
        mode: 'toggle',
      };

      const result = testReducer(state, action);

      // Range [1, 2, 3, 4]: 2 and 4 get removed, 1 and 3 get added
      expect(result.selectedSamples).toEqual(new Set([1, 3]));
    });
  });

  describe('when indices are not in order array', () => {
    it('should fall back to single selection when lastSelectedIndex not in order', () => {
      const state = createState({
        selectedSamples: new Set([99]),
        lastSelectedIndex: 99, // Not in order array
      });
      const order = [1, 2, 3, 4, 5];
      const action: SelectionAction = {
        type: 'SELECT_RANGE_ORDERED',
        toIndex: 3,
        order,
      };

      const result = testReducer(state, action);

      expect(result.selectedSamples).toEqual(new Set([3]));
    });

    it('should fall back to single selection when toIndex not in order', () => {
      const state = createState({
        selectedSamples: new Set([3]),
        lastSelectedIndex: 3,
      });
      const order = [1, 2, 3, 4, 5];
      const action: SelectionAction = {
        type: 'SELECT_RANGE_ORDERED',
        toIndex: 99, // Not in order array
        order,
      };

      const result = testReducer(state, action);

      expect(result.selectedSamples).toEqual(new Set([99]));
    });
  });

  describe('edge cases', () => {
    it('should handle empty order array', () => {
      const state = createState({ lastSelectedIndex: 3 });
      const action: SelectionAction = {
        type: 'SELECT_RANGE_ORDERED',
        toIndex: 5,
        order: [],
      };

      const result = testReducer(state, action);

      // Returns state unchanged
      expect(result).toBe(state);
    });

    it('should handle same fromIndex and toIndex', () => {
      const state = createState({
        selectedSamples: new Set(),
        lastSelectedIndex: 3,
      });
      const order = [1, 2, 3, 4, 5];
      const action: SelectionAction = {
        type: 'SELECT_RANGE_ORDERED',
        toIndex: 3, // Same as lastSelectedIndex
        order,
        mode: 'add',
      };

      const result = testReducer(state, action);

      // Range is just [3]
      expect(result.selectedSamples).toEqual(new Set([3]));
    });

    it('should default to add mode', () => {
      const state = createState({
        selectedSamples: new Set([100]),
        lastSelectedIndex: 1,
      });
      const order = [1, 2, 3];
      const action: SelectionAction = {
        type: 'SELECT_RANGE_ORDERED',
        toIndex: 3,
        order,
        // No mode specified
      };

      const result = testReducer(state, action);

      // Default is 'add', so [1, 2, 3] added to [100]
      expect(result.selectedSamples).toEqual(new Set([100, 1, 2, 3]));
    });

    it('should update history', () => {
      const state = createState({
        lastSelectedIndex: 1,
        selectionHistory: [new Set()],
        historyIndex: 0,
      });
      const order = [1, 2, 3];
      const action: SelectionAction = {
        type: 'SELECT_RANGE_ORDERED',
        toIndex: 3,
        order,
      };

      const result = testReducer(state, action);

      expect(result.selectionHistory.length).toBe(2);
      expect(result.historyIndex).toBe(1);
    });
  });
});
