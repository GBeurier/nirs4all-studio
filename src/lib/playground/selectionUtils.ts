/**
 * Selection Utilities for Playground
 *
 * Helper functions for extracting modifiers, detecting background clicks,
 * and type guards for selection results.
 *
 * Phase 1: Foundation - Unified Selection Model
 *
 * @see docs/_internals/PLAYGROUND_SELECTION_MODEL.md
 */

import type { ClickModifiers, SelectionActionResult } from './selectionHandlers';

// ============= Modifier Extraction =============

/**
 * Extract click modifiers from a mouse event.
 *
 * Normalizes Ctrl (Windows/Linux) and Cmd (Mac) to a single `ctrl` flag.
 *
 * @param event - The mouse event (native or React synthetic)
 * @returns Normalized click modifiers
 *
 * @example
 * ```ts
 * const handleClick = (e: React.MouseEvent) => {
 *   const modifiers = extractModifiers(e);
 *   const action = computeSelectionAction(target, selection, modifiers);
 * };
 * ```
 */
export function extractModifiers(
  event: MouseEvent | React.MouseEvent | { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
): ClickModifiers {
  return {
    shift: event.shiftKey,
    ctrl: event.ctrlKey || event.metaKey,
  };
}

/**
 * Extract modifiers from a keyboard event.
 *
 * Useful for keyboard-driven selection (e.g., Shift+Arrow to extend selection).
 *
 * @param event - The keyboard event
 * @returns Normalized click modifiers
 */
export function extractKeyboardModifiers(
  event: KeyboardEvent | React.KeyboardEvent
): ClickModifiers {
  return {
    shift: event.shiftKey,
    ctrl: event.ctrlKey || event.metaKey,
  };
}

// ============= Background Detection =============

/**
 * CSS class names that indicate a data element (not background).
 * Used to determine if a click landed on chart data or empty space.
 */
const DATA_ELEMENT_CLASSES = [
  // Recharts elements
  'recharts-dot',
  'recharts-rectangle',
  'recharts-bar-rectangle',
  'recharts-line',
  'recharts-area',
  'recharts-scatter-symbol',
  'recharts-active-dot',
  // Custom chart elements
  'chart-point',
  'chart-bar',
  'chart-line',
  'spectrum-line',
  'data-point',
  // Selection UI elements (should not trigger background clear)
  'selection-box',
  'lasso-path',
] as const;

/**
 * SVG element tags that typically represent data points.
 */
const DATA_ELEMENT_TAGS = ['circle', 'rect', 'path', 'line', 'polygon', 'ellipse'] as const;

/**
 * Type guard to check if a target has Element-like properties.
 * Uses duck-typing to avoid dependency on DOM globals in Node.js tests.
 */
function isElementLike(target: unknown): target is {
  classList: { contains: (cls: string) => boolean };
  tagName: string;
  hasAttribute: (attr: string) => boolean;
  parentElement: unknown;
  closest: (selector: string) => Element | null;
} {
  return (
    target !== null &&
    typeof target === 'object' &&
    'classList' in target &&
    'tagName' in target &&
    'hasAttribute' in target
  );
}

/**
 * Check if an element is a background element (not a data point).
 *
 * Used to determine if a click should clear the selection (background click)
 * or if it landed on a data element that has its own handler.
 *
 * @param target - The event target (usually event.target)
 * @returns True if the element is a background (not a data element)
 *
 * @example
 * ```ts
 * const handleContainerClick = (e: React.MouseEvent) => {
 *   if (isBackgroundElement(e.target)) {
 *     selectionCtx.clear();
 *   }
 * };
 * ```
 */
export function isBackgroundElement(target: EventTarget | null): boolean {
  if (!target || !isElementLike(target)) {
    return true;
  }

  // Check class names for data element indicators
  const classList = target.classList;
  for (const className of DATA_ELEMENT_CLASSES) {
    if (classList.contains(className)) {
      return false;
    }
  }

  // Check if it's a typical data SVG element with data attributes
  const tagName = target.tagName.toLowerCase();
  if (DATA_ELEMENT_TAGS.includes(tagName as typeof DATA_ELEMENT_TAGS[number])) {
    // Only consider it a data element if it has data-* attributes
    // or is within a data group
    if (target.hasAttribute('data-index') || target.hasAttribute('data-sample')) {
      return false;
    }
    // Check parent for recharts wrapper
    const parent = target.parentElement;
    if (parent && isElementLike(parent)) {
      for (const className of DATA_ELEMENT_CLASSES) {
        if (parent.classList.contains(className)) {
          return false;
        }
      }
    }
  }

  // Check for recharts-specific structure
  // Recharts wraps data points in Layer groups
  const closestDataGroup = target.closest(
    '.recharts-scatter, .recharts-bar, .recharts-line, .recharts-area'
  );
  if (closestDataGroup && target !== closestDataGroup) {
    // We're inside a data group but not at the top level
    // This is likely a data element
    const closestSymbol = target.closest('.recharts-scatter-symbol, .recharts-bar-rectangle');
    if (closestSymbol) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a click event should trigger a background clear.
 *
 * Combines background element detection with modifier key checks.
 * Modifier keys on background prevent clearing (allows box/lasso selection).
 *
 * @param event - The mouse event
 * @param selectionToolMode - Current selection tool ('click', 'box', 'lasso')
 * @returns True if the click should clear the selection
 *
 * @example
 * ```ts
 * const handleContainerClick = (e: React.MouseEvent) => {
 *   if (shouldClearOnBackgroundClick(e, selectionToolMode)) {
 *     selectionCtx.clear();
 *   }
 * };
 * ```
 */
export function shouldClearOnBackgroundClick(
  event: MouseEvent | React.MouseEvent,
  selectionToolMode: 'click' | 'box' | 'lasso'
): boolean {
  // Only clear on background click in 'click' mode
  if (selectionToolMode !== 'click') {
    return false;
  }

  // Don't clear if modifier keys are held
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    return false;
  }

  // Check if clicked on background
  return isBackgroundElement(event.target);
}

// ============= Type Guards =============

/**
 * Type guard for 'select' action results.
 */
export function isSelectAction(
  action: SelectionActionResult
): action is { action: 'select'; indices: number[]; mode: 'replace' | 'add' | 'remove' | 'toggle' } {
  return action.action === 'select';
}

/**
 * Type guard for 'toggle' action results.
 */
export function isToggleAction(
  action: SelectionActionResult
): action is { action: 'toggle'; indices: number[] } {
  return action.action === 'toggle';
}

/**
 * Type guard for 'clear' action results.
 */
export function isClearAction(
  action: SelectionActionResult
): action is { action: 'clear' } {
  return action.action === 'clear';
}

/**
 * Type guard for 'replaceIfNotSole' action results.
 */
export function isReplaceIfNotSoleAction(
  action: SelectionActionResult
): action is { action: 'replaceIfNotSole'; indices: number[] } {
  return action.action === 'replaceIfNotSole';
}

// ============= Selection Comparison =============

/**
 * Check if two selections are equal.
 *
 * Useful for preventing unnecessary updates when selection hasn't changed.
 *
 * @param a - First selection set
 * @param b - Second selection set
 * @returns True if both sets contain the same indices
 */
export function selectionsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const idx of a) {
    if (!b.has(idx)) return false;
  }
  return true;
}

/**
 * Check if a set of indices matches the current selection exactly.
 *
 * @param indices - The indices to check
 * @param currentSelection - The current selection
 * @returns True if the indices exactly match the selection
 */
export function indicesMatchSelection(
  indices: number[],
  currentSelection: Set<number>
): boolean {
  if (indices.length !== currentSelection.size) return false;
  return indices.every(i => currentSelection.has(i));
}

// ============= Selection Predicates =============

/**
 * Check if all provided indices are currently selected.
 */
export function allIndicesSelected(
  indices: number[],
  currentSelection: Set<number>
): boolean {
  return indices.length > 0 && indices.every(i => currentSelection.has(i));
}

/**
 * Check if any of the provided indices are currently selected.
 */
export function anyIndicesSelected(
  indices: number[],
  currentSelection: Set<number>
): boolean {
  return indices.some(i => currentSelection.has(i));
}

/**
 * Check if none of the provided indices are currently selected.
 */
export function noIndicesSelected(
  indices: number[],
  currentSelection: Set<number>
): boolean {
  return !indices.some(i => currentSelection.has(i));
}

// ============= Index Utilities =============

/**
 * Get the intersection of indices with the current selection.
 */
export function getSelectedSubset(
  indices: number[],
  currentSelection: Set<number>
): number[] {
  return indices.filter(i => currentSelection.has(i));
}

/**
 * Get the indices that are not in the current selection.
 */
export function getUnselectedSubset(
  indices: number[],
  currentSelection: Set<number>
): number[] {
  return indices.filter(i => !currentSelection.has(i));
}
