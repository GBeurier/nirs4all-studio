/**
 * Selection Utilities Unit Tests
 *
 * Tests for selection helper functions.
 *
 * @see docs/_internals/PLAYGROUND_SELECTION_MODEL.md
 */

import { describe, it, expect } from 'vitest';
import {
  extractModifiers,
  extractKeyboardModifiers,
  isBackgroundElement,
  shouldClearOnBackgroundClick,
  isSelectAction,
  isToggleAction,
  isClearAction,
  isReplaceIfNotSoleAction,
  selectionsEqual,
  indicesMatchSelection,
  allIndicesSelected,
  anyIndicesSelected,
  noIndicesSelected,
  getSelectedSubset,
  getUnselectedSubset,
} from '../selectionUtils';
import type { SelectionActionResult } from '../selectionHandlers';

// ============= Mock Element Helpers =============

/**
 * Create a mock element with classList and attribute support for testing
 */
function createMockElement(options: {
  tagName?: string;
  classes?: string[];
  attributes?: Record<string, string>;
  parentClasses?: string[];
} = {}): Element {
  const { tagName = 'div', classes = [], attributes = {}, parentClasses = [] } = options;

  const classSet = new Set(classes);

  const mockParent = parentClasses.length > 0 ? {
    classList: {
      contains: (cls: string) => parentClasses.includes(cls),
    },
  } : null;

  return {
    tagName: tagName.toUpperCase(),
    classList: {
      contains: (cls: string) => classSet.has(cls),
    },
    hasAttribute: (attr: string) => attr in attributes,
    getAttribute: (attr: string) => attributes[attr] ?? null,
    parentElement: mockParent,
    closest: () => null, // Simplified - no ancestor matching
  } as unknown as Element;
}

// ============= extractModifiers Tests =============

describe('extractModifiers', () => {
  it('should extract shift modifier', () => {
    const event = { shiftKey: true, ctrlKey: false, metaKey: false };
    const result = extractModifiers(event);

    expect(result).toEqual({ shift: true, ctrl: false });
  });

  it('should extract ctrl modifier', () => {
    const event = { shiftKey: false, ctrlKey: true, metaKey: false };
    const result = extractModifiers(event);

    expect(result).toEqual({ shift: false, ctrl: true });
  });

  it('should treat metaKey as ctrl', () => {
    const event = { shiftKey: false, ctrlKey: false, metaKey: true };
    const result = extractModifiers(event);

    expect(result).toEqual({ shift: false, ctrl: true });
  });

  it('should combine ctrl and meta as ctrl', () => {
    const event = { shiftKey: false, ctrlKey: true, metaKey: true };
    const result = extractModifiers(event);

    expect(result).toEqual({ shift: false, ctrl: true });
  });

  it('should handle multiple modifiers', () => {
    const event = { shiftKey: true, ctrlKey: true, metaKey: false };
    const result = extractModifiers(event);

    expect(result).toEqual({ shift: true, ctrl: true });
  });

  it('should handle no modifiers', () => {
    const event = { shiftKey: false, ctrlKey: false, metaKey: false };
    const result = extractModifiers(event);

    expect(result).toEqual({ shift: false, ctrl: false });
  });
});

// ============= extractKeyboardModifiers Tests =============

describe('extractKeyboardModifiers', () => {
  it('should work with keyboard events', () => {
    const event = {
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
    } as KeyboardEvent;
    const result = extractKeyboardModifiers(event);

    expect(result).toEqual({ shift: true, ctrl: false });
  });

  it('should handle metaKey for Mac keyboard events', () => {
    const event = {
      shiftKey: false,
      ctrlKey: false,
      metaKey: true,
    } as KeyboardEvent;
    const result = extractKeyboardModifiers(event);

    expect(result).toEqual({ shift: false, ctrl: true });
  });
});

// ============= isBackgroundElement Tests =============

describe('isBackgroundElement', () => {
  it('should return true for null target', () => {
    expect(isBackgroundElement(null)).toBe(true);
  });

  it('should return true for non-Element target', () => {
    // A plain object that is not an Element
    const notAnElement = { nodeType: 3 }; // Text node type
    expect(isBackgroundElement(notAnElement as unknown as EventTarget)).toBe(true);
  });

  it('should return false for element with recharts-dot class', () => {
    const element = createMockElement({ tagName: 'circle', classes: ['recharts-dot'] });
    expect(isBackgroundElement(element)).toBe(false);
  });

  it('should return false for element with recharts-rectangle class', () => {
    const element = createMockElement({ tagName: 'rect', classes: ['recharts-rectangle'] });
    expect(isBackgroundElement(element)).toBe(false);
  });

  it('should return false for element with chart-point class', () => {
    const element = createMockElement({ tagName: 'circle', classes: ['chart-point'] });
    expect(isBackgroundElement(element)).toBe(false);
  });

  it('should return false for element with data-index attribute', () => {
    const element = createMockElement({ tagName: 'circle', attributes: { 'data-index': '5' } });
    expect(isBackgroundElement(element)).toBe(false);
  });

  it('should return false for element with data-sample attribute', () => {
    const element = createMockElement({ tagName: 'rect', attributes: { 'data-sample': '10' } });
    expect(isBackgroundElement(element)).toBe(false);
  });

  it('should return true for plain div', () => {
    const element = createMockElement({ tagName: 'div' });
    expect(isBackgroundElement(element)).toBe(true);
  });

  it('should return true for svg without data attributes', () => {
    const element = createMockElement({ tagName: 'svg' });
    expect(isBackgroundElement(element)).toBe(true);
  });

  it('should return false for element with selection-box class', () => {
    const element = createMockElement({ tagName: 'div', classes: ['selection-box'] });
    expect(isBackgroundElement(element)).toBe(false);
  });
});

// ============= shouldClearOnBackgroundClick Tests =============

describe('shouldClearOnBackgroundClick', () => {
  it('should return false when selection tool is box', () => {
    const div = createMockElement({ tagName: 'div' });
    const event = { target: div, shiftKey: false, ctrlKey: false, metaKey: false } as unknown as MouseEvent;

    expect(shouldClearOnBackgroundClick(event, 'box')).toBe(false);
  });

  it('should return false when selection tool is lasso', () => {
    const div = createMockElement({ tagName: 'div' });
    const event = { target: div, shiftKey: false, ctrlKey: false, metaKey: false } as unknown as MouseEvent;

    expect(shouldClearOnBackgroundClick(event, 'lasso')).toBe(false);
  });

  it('should return false when shift key is pressed', () => {
    const div = createMockElement({ tagName: 'div' });
    const event = { target: div, shiftKey: true, ctrlKey: false, metaKey: false } as unknown as MouseEvent;

    expect(shouldClearOnBackgroundClick(event, 'click')).toBe(false);
  });

  it('should return false when ctrl key is pressed', () => {
    const div = createMockElement({ tagName: 'div' });
    const event = { target: div, shiftKey: false, ctrlKey: true, metaKey: false } as unknown as MouseEvent;

    expect(shouldClearOnBackgroundClick(event, 'click')).toBe(false);
  });

  it('should return false when meta key is pressed', () => {
    const div = createMockElement({ tagName: 'div' });
    const event = { target: div, shiftKey: false, ctrlKey: false, metaKey: true } as unknown as MouseEvent;

    expect(shouldClearOnBackgroundClick(event, 'click')).toBe(false);
  });

  it('should return true for background click in click mode without modifiers', () => {
    const div = createMockElement({ tagName: 'div' });
    const event = { target: div, shiftKey: false, ctrlKey: false, metaKey: false } as unknown as MouseEvent;

    expect(shouldClearOnBackgroundClick(event, 'click')).toBe(true);
  });

  it('should return false for data element click', () => {
    const dot = createMockElement({ tagName: 'circle', classes: ['recharts-dot'] });
    const event = { target: dot, shiftKey: false, ctrlKey: false, metaKey: false } as unknown as MouseEvent;

    expect(shouldClearOnBackgroundClick(event, 'click')).toBe(false);
  });
});

// ============= Type Guards Tests =============

describe('isSelectAction', () => {
  it('should return true for select action', () => {
    const action: SelectionActionResult = {
      action: 'select',
      indices: [1, 2],
      mode: 'replace',
    };
    expect(isSelectAction(action)).toBe(true);
  });

  it('should return false for toggle action', () => {
    const action: SelectionActionResult = {
      action: 'toggle',
      indices: [1, 2],
    };
    expect(isSelectAction(action)).toBe(false);
  });

  it('should return false for clear action', () => {
    const action: SelectionActionResult = { action: 'clear' };
    expect(isSelectAction(action)).toBe(false);
  });
});

describe('isToggleAction', () => {
  it('should return true for toggle action', () => {
    const action: SelectionActionResult = {
      action: 'toggle',
      indices: [1, 2],
    };
    expect(isToggleAction(action)).toBe(true);
  });

  it('should return false for select action', () => {
    const action: SelectionActionResult = {
      action: 'select',
      indices: [1, 2],
      mode: 'add',
    };
    expect(isToggleAction(action)).toBe(false);
  });
});

describe('isClearAction', () => {
  it('should return true for clear action', () => {
    const action: SelectionActionResult = { action: 'clear' };
    expect(isClearAction(action)).toBe(true);
  });

  it('should return false for select action', () => {
    const action: SelectionActionResult = {
      action: 'select',
      indices: [],
      mode: 'replace',
    };
    expect(isClearAction(action)).toBe(false);
  });
});

describe('isReplaceIfNotSoleAction', () => {
  it('should return true for replaceIfNotSole action', () => {
    const action: SelectionActionResult = {
      action: 'replaceIfNotSole',
      indices: [1, 2],
    };
    expect(isReplaceIfNotSoleAction(action)).toBe(true);
  });

  it('should return false for select action', () => {
    const action: SelectionActionResult = {
      action: 'select',
      indices: [1, 2],
      mode: 'replace',
    };
    expect(isReplaceIfNotSoleAction(action)).toBe(false);
  });

  it('should return false for clear action', () => {
    const action: SelectionActionResult = { action: 'clear' };
    expect(isReplaceIfNotSoleAction(action)).toBe(false);
  });
});

// ============= selectionsEqual Tests =============

describe('selectionsEqual', () => {
  it('should return true for identical sets', () => {
    const a = new Set([1, 2, 3]);
    const b = new Set([1, 2, 3]);
    expect(selectionsEqual(a, b)).toBe(true);
  });

  it('should return true for both empty', () => {
    const a = new Set<number>();
    const b = new Set<number>();
    expect(selectionsEqual(a, b)).toBe(true);
  });

  it('should return false for different sizes', () => {
    const a = new Set([1, 2]);
    const b = new Set([1, 2, 3]);
    expect(selectionsEqual(a, b)).toBe(false);
  });

  it('should return false for same size but different values', () => {
    const a = new Set([1, 2, 3]);
    const b = new Set([1, 2, 4]);
    expect(selectionsEqual(a, b)).toBe(false);
  });

  it('should handle sets with different insertion order', () => {
    const a = new Set([3, 1, 2]);
    const b = new Set([1, 2, 3]);
    expect(selectionsEqual(a, b)).toBe(true);
  });
});

// ============= indicesMatchSelection Tests =============

describe('indicesMatchSelection', () => {
  it('should return true when indices exactly match selection', () => {
    const indices = [1, 2, 3];
    const selection = new Set([1, 2, 3]);
    expect(indicesMatchSelection(indices, selection)).toBe(true);
  });

  it('should return false when selection has extra items', () => {
    const indices = [1, 2];
    const selection = new Set([1, 2, 3]);
    expect(indicesMatchSelection(indices, selection)).toBe(false);
  });

  it('should return false when indices have extra items', () => {
    const indices = [1, 2, 3];
    const selection = new Set([1, 2]);
    expect(indicesMatchSelection(indices, selection)).toBe(false);
  });

  it('should return true for empty match', () => {
    const indices: number[] = [];
    const selection = new Set<number>();
    expect(indicesMatchSelection(indices, selection)).toBe(true);
  });
});

// ============= Selection Predicates Tests =============

describe('allIndicesSelected', () => {
  it('should return true when all indices are selected', () => {
    const indices = [1, 2, 3];
    const selection = new Set([1, 2, 3, 4, 5]);
    expect(allIndicesSelected(indices, selection)).toBe(true);
  });

  it('should return false when some indices are not selected', () => {
    const indices = [1, 2, 3];
    const selection = new Set([1, 2]);
    expect(allIndicesSelected(indices, selection)).toBe(false);
  });

  it('should return false for empty indices', () => {
    const indices: number[] = [];
    const selection = new Set([1, 2, 3]);
    expect(allIndicesSelected(indices, selection)).toBe(false);
  });
});

describe('anyIndicesSelected', () => {
  it('should return true when at least one index is selected', () => {
    const indices = [1, 5, 10];
    const selection = new Set([5]);
    expect(anyIndicesSelected(indices, selection)).toBe(true);
  });

  it('should return false when no indices are selected', () => {
    const indices = [1, 2, 3];
    const selection = new Set([4, 5, 6]);
    expect(anyIndicesSelected(indices, selection)).toBe(false);
  });

  it('should return false for empty indices', () => {
    const indices: number[] = [];
    const selection = new Set([1, 2, 3]);
    expect(anyIndicesSelected(indices, selection)).toBe(false);
  });
});

describe('noIndicesSelected', () => {
  it('should return true when no indices are selected', () => {
    const indices = [1, 2, 3];
    const selection = new Set([4, 5, 6]);
    expect(noIndicesSelected(indices, selection)).toBe(true);
  });

  it('should return false when at least one is selected', () => {
    const indices = [1, 2, 3];
    const selection = new Set([3, 4, 5]);
    expect(noIndicesSelected(indices, selection)).toBe(false);
  });

  it('should return true for empty indices', () => {
    const indices: number[] = [];
    const selection = new Set([1, 2, 3]);
    expect(noIndicesSelected(indices, selection)).toBe(true);
  });
});

// ============= Index Utilities Tests =============

describe('getSelectedSubset', () => {
  it('should return only selected indices', () => {
    const indices = [1, 2, 3, 4, 5];
    const selection = new Set([2, 4]);
    expect(getSelectedSubset(indices, selection)).toEqual([2, 4]);
  });

  it('should return empty array when none selected', () => {
    const indices = [1, 2, 3];
    const selection = new Set([4, 5, 6]);
    expect(getSelectedSubset(indices, selection)).toEqual([]);
  });

  it('should preserve order', () => {
    const indices = [5, 3, 1, 4, 2];
    const selection = new Set([3, 5]);
    expect(getSelectedSubset(indices, selection)).toEqual([5, 3]);
  });
});

describe('getUnselectedSubset', () => {
  it('should return only unselected indices', () => {
    const indices = [1, 2, 3, 4, 5];
    const selection = new Set([2, 4]);
    expect(getUnselectedSubset(indices, selection)).toEqual([1, 3, 5]);
  });

  it('should return all indices when none selected', () => {
    const indices = [1, 2, 3];
    const selection = new Set<number>();
    expect(getUnselectedSubset(indices, selection)).toEqual([1, 2, 3]);
  });

  it('should return empty when all selected', () => {
    const indices = [1, 2, 3];
    const selection = new Set([1, 2, 3]);
    expect(getUnselectedSubset(indices, selection)).toEqual([]);
  });
});
