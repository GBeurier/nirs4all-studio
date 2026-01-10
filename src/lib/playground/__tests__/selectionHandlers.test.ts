/**
 * Selection Handlers Unit Tests
 *
 * Tests for the unified selection logic functions.
 *
 * @see docs/_internals/PLAYGROUND_SELECTION_MODEL.md
 */

import { describe, it, expect, vi } from 'vitest';
import {
  computeSelectionAction,
  computeStackedBarAction,
  executeSelectionAction,
  createClickHandler,
  createStackedBarClickHandler,
  createSimpleClickHandler,
  type SelectionTarget,
  type StackedBarTarget,
  type ClickModifiers,
  type SelectionActionResult,
} from '../selectionHandlers';

// ============= computeSelectionAction Tests =============

describe('computeSelectionAction', () => {
  describe('with empty selection', () => {
    const emptySelection = new Set<number>();

    it('should replace selection on plain click', () => {
      const target: SelectionTarget = { indices: [5] };
      const modifiers: ClickModifiers = { shift: false, ctrl: false };

      const result = computeSelectionAction(target, emptySelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [5],
        mode: 'replace',
      });
    });

    it('should add to selection on shift+click', () => {
      const target: SelectionTarget = { indices: [5] };
      const modifiers: ClickModifiers = { shift: true, ctrl: false };

      const result = computeSelectionAction(target, emptySelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [5],
        mode: 'add',
      });
    });

    it('should toggle on ctrl+click', () => {
      const target: SelectionTarget = { indices: [5] };
      const modifiers: ClickModifiers = { shift: false, ctrl: true };

      const result = computeSelectionAction(target, emptySelection, modifiers);

      expect(result).toEqual({
        action: 'toggle',
        indices: [5],
      });
    });
  });

  describe('clicking selected item (single selection)', () => {
    const singleSelection = new Set<number>([5]);

    it('should clear when clicking the only selected item', () => {
      const target: SelectionTarget = { indices: [5] };
      const modifiers: ClickModifiers = { shift: false, ctrl: false };

      const result = computeSelectionAction(target, singleSelection, modifiers);

      expect(result).toEqual({ action: 'clear' });
    });

    it('should add on shift+click even if already selected', () => {
      const target: SelectionTarget = { indices: [5] };
      const modifiers: ClickModifiers = { shift: true, ctrl: false };

      const result = computeSelectionAction(target, singleSelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [5],
        mode: 'add',
      });
    });

    it('should toggle on ctrl+click (removes from selection)', () => {
      const target: SelectionTarget = { indices: [5] };
      const modifiers: ClickModifiers = { shift: false, ctrl: true };

      const result = computeSelectionAction(target, singleSelection, modifiers);

      expect(result).toEqual({
        action: 'toggle',
        indices: [5],
      });
    });
  });

  describe('clicking selected item (multi selection)', () => {
    const multiSelection = new Set<number>([3, 5, 7]);

    it('should replace selection with clicked item', () => {
      const target: SelectionTarget = { indices: [5] };
      const modifiers: ClickModifiers = { shift: false, ctrl: false };

      const result = computeSelectionAction(target, multiSelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [5],
        mode: 'replace',
      });
    });

    it('should add on shift+click', () => {
      const target: SelectionTarget = { indices: [5] };
      const modifiers: ClickModifiers = { shift: true, ctrl: false };

      const result = computeSelectionAction(target, multiSelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [5],
        mode: 'add',
      });
    });
  });

  describe('clicking unselected item (with existing selection)', () => {
    const existingSelection = new Set<number>([3, 7]);

    it('should replace selection with clicked item', () => {
      const target: SelectionTarget = { indices: [5] };
      const modifiers: ClickModifiers = { shift: false, ctrl: false };

      const result = computeSelectionAction(target, existingSelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [5],
        mode: 'replace',
      });
    });

    it('should add to selection on shift+click', () => {
      const target: SelectionTarget = { indices: [5] };
      const modifiers: ClickModifiers = { shift: true, ctrl: false };

      const result = computeSelectionAction(target, existingSelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [5],
        mode: 'add',
      });
    });

    it('should toggle (add) on ctrl+click', () => {
      const target: SelectionTarget = { indices: [5] };
      const modifiers: ClickModifiers = { shift: false, ctrl: true };

      const result = computeSelectionAction(target, existingSelection, modifiers);

      expect(result).toEqual({
        action: 'toggle',
        indices: [5],
      });
    });
  });

  describe('multi-index targets (bars)', () => {
    const emptySelection = new Set<number>();
    const barSelection = new Set<number>([10, 11, 12]);

    it('should select all bar indices on plain click', () => {
      const target: SelectionTarget = { indices: [10, 11, 12] };
      const modifiers: ClickModifiers = { shift: false, ctrl: false };

      const result = computeSelectionAction(target, emptySelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [10, 11, 12],
        mode: 'replace',
      });
    });

    it('should clear when clicking bar that matches selection exactly', () => {
      const target: SelectionTarget = { indices: [10, 11, 12] };
      const modifiers: ClickModifiers = { shift: false, ctrl: false };

      const result = computeSelectionAction(target, barSelection, modifiers);

      expect(result).toEqual({ action: 'clear' });
    });

    it('should replace when bar is partially selected', () => {
      const partialSelection = new Set<number>([10, 11]); // Missing 12
      const target: SelectionTarget = { indices: [10, 11, 12] };
      const modifiers: ClickModifiers = { shift: false, ctrl: false };

      const result = computeSelectionAction(target, partialSelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [10, 11, 12],
        mode: 'replace',
      });
    });
  });

  describe('empty target', () => {
    it('should handle empty indices array', () => {
      const selection = new Set<number>([1, 2, 3]);
      const target: SelectionTarget = { indices: [] };
      const modifiers: ClickModifiers = { shift: false, ctrl: false };

      const result = computeSelectionAction(target, selection, modifiers);

      // Empty target should replace with empty (not clear)
      expect(result).toEqual({
        action: 'select',
        indices: [],
        mode: 'replace',
      });
    });
  });
});

// ============= computeStackedBarAction Tests =============

describe('computeStackedBarAction', () => {
  describe('3-click progressive drill-down', () => {
    it('should select entire bar on first click (nothing selected)', () => {
      const emptySelection = new Set<number>();
      const target: StackedBarTarget = {
        barIndices: [10, 11, 12, 13],
        segmentIndices: [10, 11],
      };
      const modifiers: ClickModifiers = { shift: false, ctrl: false };

      const result = computeStackedBarAction(target, emptySelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [10, 11, 12, 13],
        mode: 'replace',
      });
    });

    it('should select segment only on second click (bar fully selected)', () => {
      const barSelection = new Set<number>([10, 11, 12, 13]);
      const target: StackedBarTarget = {
        barIndices: [10, 11, 12, 13],
        segmentIndices: [10, 11],
      };
      const modifiers: ClickModifiers = { shift: false, ctrl: false };

      const result = computeStackedBarAction(target, barSelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [10, 11],
        mode: 'replace',
      });
    });

    it('should clear on third click (segment fully selected)', () => {
      const segmentSelection = new Set<number>([10, 11]);
      const target: StackedBarTarget = {
        barIndices: [10, 11, 12, 13],
        segmentIndices: [10, 11],
      };
      const modifiers: ClickModifiers = { shift: false, ctrl: false };

      const result = computeStackedBarAction(target, segmentSelection, modifiers);

      expect(result).toEqual({ action: 'clear' });
    });
  });

  describe('clicking different bar resets cycle', () => {
    it('should select new bar when different bar is selected', () => {
      const otherBarSelection = new Set<number>([20, 21, 22]);
      const target: StackedBarTarget = {
        barIndices: [10, 11, 12, 13],
        segmentIndices: [10, 11],
      };
      const modifiers: ClickModifiers = { shift: false, ctrl: false };

      const result = computeStackedBarAction(target, otherBarSelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [10, 11, 12, 13],
        mode: 'replace',
      });
    });
  });

  describe('modifier keys bypass progressive logic', () => {
    it('should add segment on shift+click (regardless of current selection)', () => {
      const someSelection = new Set<number>([20, 21]);
      const target: StackedBarTarget = {
        barIndices: [10, 11, 12, 13],
        segmentIndices: [10, 11],
      };
      const modifiers: ClickModifiers = { shift: true, ctrl: false };

      const result = computeStackedBarAction(target, someSelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [10, 11], // Segment, not bar
        mode: 'add',
      });
    });

    it('should toggle segment on ctrl+click', () => {
      const barSelection = new Set<number>([10, 11, 12, 13]);
      const target: StackedBarTarget = {
        barIndices: [10, 11, 12, 13],
        segmentIndices: [10, 11],
      };
      const modifiers: ClickModifiers = { shift: false, ctrl: true };

      const result = computeStackedBarAction(target, barSelection, modifiers);

      expect(result).toEqual({
        action: 'toggle',
        indices: [10, 11], // Segment, not bar
      });
    });

    it('should add segment with shift even when nothing selected', () => {
      const emptySelection = new Set<number>();
      const target: StackedBarTarget = {
        barIndices: [10, 11, 12, 13],
        segmentIndices: [10, 11],
      };
      const modifiers: ClickModifiers = { shift: true, ctrl: false };

      const result = computeStackedBarAction(target, emptySelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [10, 11],
        mode: 'add',
      });
    });
  });

  describe('edge cases', () => {
    it('should handle bar with single segment', () => {
      const emptySelection = new Set<number>();
      const target: StackedBarTarget = {
        barIndices: [10, 11],
        segmentIndices: [10, 11], // Same as bar
      };
      const modifiers: ClickModifiers = { shift: false, ctrl: false };

      // First click: select bar (which equals segment)
      const result1 = computeStackedBarAction(target, emptySelection, modifiers);
      expect(result1).toEqual({
        action: 'select',
        indices: [10, 11],
        mode: 'replace',
      });

      // Second click: would drill to segment, but segment = bar, so clears
      const barSelection = new Set<number>([10, 11]);
      const result2 = computeStackedBarAction(target, barSelection, modifiers);
      // Since segment matches selection exactly, it should clear
      expect(result2).toEqual({ action: 'clear' });
    });

    it('should handle empty segment indices', () => {
      const emptySelection = new Set<number>();
      const target: StackedBarTarget = {
        barIndices: [10, 11, 12],
        segmentIndices: [],
      };
      const modifiers: ClickModifiers = { shift: false, ctrl: false };

      const result = computeStackedBarAction(target, emptySelection, modifiers);

      expect(result).toEqual({
        action: 'select',
        indices: [10, 11, 12],
        mode: 'replace',
      });
    });
  });
});

// ============= executeSelectionAction Tests =============

describe('executeSelectionAction', () => {
  it('should call clear() for clear action', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      clear: vi.fn(),
      replaceIfNotSole: vi.fn(),
    };
    const action: SelectionActionResult = { action: 'clear' };

    executeSelectionAction(mockCtx, action);

    expect(mockCtx.clear).toHaveBeenCalledOnce();
    expect(mockCtx.select).not.toHaveBeenCalled();
    expect(mockCtx.toggle).not.toHaveBeenCalled();
  });

  it('should call toggle() with indices for toggle action', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      clear: vi.fn(),
      replaceIfNotSole: vi.fn(),
    };
    const action: SelectionActionResult = { action: 'toggle', indices: [5, 10] };

    executeSelectionAction(mockCtx, action);

    expect(mockCtx.toggle).toHaveBeenCalledWith([5, 10]);
    expect(mockCtx.select).not.toHaveBeenCalled();
    expect(mockCtx.clear).not.toHaveBeenCalled();
  });

  it('should call select() with indices and mode for select action', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      clear: vi.fn(),
      replaceIfNotSole: vi.fn(),
    };
    const action: SelectionActionResult = {
      action: 'select',
      indices: [1, 2, 3],
      mode: 'add',
    };

    executeSelectionAction(mockCtx, action);

    expect(mockCtx.select).toHaveBeenCalledWith([1, 2, 3], 'add');
    expect(mockCtx.toggle).not.toHaveBeenCalled();
    expect(mockCtx.clear).not.toHaveBeenCalled();
  });

  it('should handle replace mode', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      clear: vi.fn(),
      replaceIfNotSole: vi.fn(),
    };
    const action: SelectionActionResult = {
      action: 'select',
      indices: [42],
      mode: 'replace',
    };

    executeSelectionAction(mockCtx, action);

    expect(mockCtx.select).toHaveBeenCalledWith([42], 'replace');
  });
});

// ============= createClickHandler Tests =============

describe('createClickHandler', () => {
  it('should create a handler that computes and executes action', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      clear: vi.fn(),
      replaceIfNotSole: vi.fn(),
      selectedSamples: new Set<number>(),
    };

    const handler = createClickHandler(mockCtx);
    const event = { shiftKey: false, ctrlKey: false, metaKey: false };

    handler([5], event);

    expect(mockCtx.select).toHaveBeenCalledWith([5], 'replace');
  });

  it('should handle shift+click correctly', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      clear: vi.fn(),
      replaceIfNotSole: vi.fn(),
      selectedSamples: new Set<number>([1, 2]),
    };

    const handler = createClickHandler(mockCtx);
    const event = { shiftKey: true, ctrlKey: false, metaKey: false };

    handler([5], event);

    expect(mockCtx.select).toHaveBeenCalledWith([5], 'add');
  });

  it('should handle ctrl+click correctly', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      clear: vi.fn(),
      replaceIfNotSole: vi.fn(),
      selectedSamples: new Set<number>([1, 2]),
    };

    const handler = createClickHandler(mockCtx);
    const event = { shiftKey: false, ctrlKey: true, metaKey: false };

    handler([5], event);

    expect(mockCtx.toggle).toHaveBeenCalledWith([5]);
  });

  it('should handle metaKey as ctrl', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      clear: vi.fn(),
      replaceIfNotSole: vi.fn(),
      selectedSamples: new Set<number>([1, 2]),
    };

    const handler = createClickHandler(mockCtx);
    const event = { shiftKey: false, ctrlKey: false, metaKey: true };

    handler([5], event);

    expect(mockCtx.toggle).toHaveBeenCalledWith([5]);
  });
});

// ============= createStackedBarClickHandler Tests =============

describe('createStackedBarClickHandler', () => {
  it('should create a handler that uses stacked bar logic', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      clear: vi.fn(),
      replaceIfNotSole: vi.fn(),
      selectedSamples: new Set<number>(),
    };

    const handler = createStackedBarClickHandler(mockCtx);
    const event = { shiftKey: false, ctrlKey: false, metaKey: false };

    handler([10, 11, 12], [10, 11], event);

    // First click: select entire bar
    expect(mockCtx.select).toHaveBeenCalledWith([10, 11, 12], 'replace');
  });

  it('should drill down to segment on second click', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      clear: vi.fn(),
      replaceIfNotSole: vi.fn(),
      selectedSamples: new Set<number>([10, 11, 12]),
    };

    const handler = createStackedBarClickHandler(mockCtx);
    const event = { shiftKey: false, ctrlKey: false, metaKey: false };

    handler([10, 11, 12], [10, 11], event);

    expect(mockCtx.select).toHaveBeenCalledWith([10, 11], 'replace');
  });
});

// ============= executeSelectionAction with replaceIfNotSole Tests =============

describe('executeSelectionAction with replaceIfNotSole', () => {
  it('should call replaceIfNotSole() for replaceIfNotSole action', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      clear: vi.fn(),
      replaceIfNotSole: vi.fn(),
    };
    const action: SelectionActionResult = { action: 'replaceIfNotSole', indices: [5, 10] };

    executeSelectionAction(mockCtx, action);

    expect(mockCtx.replaceIfNotSole).toHaveBeenCalledWith([5, 10]);
    expect(mockCtx.select).not.toHaveBeenCalled();
    expect(mockCtx.toggle).not.toHaveBeenCalled();
    expect(mockCtx.clear).not.toHaveBeenCalled();
  });
});

// ============= createSimpleClickHandler Tests =============

describe('createSimpleClickHandler', () => {
  it('should use replaceIfNotSole for plain click', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      replaceIfNotSole: vi.fn(),
    };

    const handler = createSimpleClickHandler(mockCtx);
    const event = { shiftKey: false, ctrlKey: false, metaKey: false };

    handler([5], event);

    expect(mockCtx.replaceIfNotSole).toHaveBeenCalledWith([5]);
    expect(mockCtx.select).not.toHaveBeenCalled();
    expect(mockCtx.toggle).not.toHaveBeenCalled();
  });

  it('should use select with add mode for shift+click', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      replaceIfNotSole: vi.fn(),
    };

    const handler = createSimpleClickHandler(mockCtx);
    const event = { shiftKey: true, ctrlKey: false, metaKey: false };

    handler([5], event);

    expect(mockCtx.select).toHaveBeenCalledWith([5], 'add');
    expect(mockCtx.replaceIfNotSole).not.toHaveBeenCalled();
    expect(mockCtx.toggle).not.toHaveBeenCalled();
  });

  it('should use toggle for ctrl+click', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      replaceIfNotSole: vi.fn(),
    };

    const handler = createSimpleClickHandler(mockCtx);
    const event = { shiftKey: false, ctrlKey: true, metaKey: false };

    handler([5], event);

    expect(mockCtx.toggle).toHaveBeenCalledWith([5]);
    expect(mockCtx.select).not.toHaveBeenCalled();
    expect(mockCtx.replaceIfNotSole).not.toHaveBeenCalled();
  });

  it('should use toggle for meta+click (Mac)', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      replaceIfNotSole: vi.fn(),
    };

    const handler = createSimpleClickHandler(mockCtx);
    const event = { shiftKey: false, ctrlKey: false, metaKey: true };

    handler([5], event);

    expect(mockCtx.toggle).toHaveBeenCalledWith([5]);
    expect(mockCtx.select).not.toHaveBeenCalled();
    expect(mockCtx.replaceIfNotSole).not.toHaveBeenCalled();
  });

  it('should handle multi-index targets', () => {
    const mockCtx = {
      select: vi.fn(),
      toggle: vi.fn(),
      replaceIfNotSole: vi.fn(),
    };

    const handler = createSimpleClickHandler(mockCtx);
    const event = { shiftKey: false, ctrlKey: false, metaKey: false };

    handler([10, 11, 12], event);

    expect(mockCtx.replaceIfNotSole).toHaveBeenCalledWith([10, 11, 12]);
  });
});
