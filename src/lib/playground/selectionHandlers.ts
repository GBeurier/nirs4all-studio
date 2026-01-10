/**
 * Unified Selection Handlers for Playground
 *
 * Provides centralized, reusable selection logic that can be used across all chart types.
 * This eliminates code duplication and ensures consistent click-to-select behavior.
 *
 * Phase 1: Foundation - Unified Selection Model
 *
 * @see docs/_internals/PLAYGROUND_SELECTION_MODEL.md
 */

import type { SelectionContextValue, SelectionMode } from '@/context/SelectionContext';

// ============= Type Definitions =============

/**
 * Target of a click interaction
 */
export interface SelectionTarget {
  /** Sample indices represented by this target (single point = [idx], bar = [idx1, idx2, ...]) */
  indices: number[];
}

/**
 * Target for stacked bar clicks with both bar-level and segment-level indices
 */
export interface StackedBarTarget {
  /** All samples in the entire bar (all segments) */
  barIndices: number[];
  /** Samples in the clicked segment only */
  segmentIndices: number[];
}

/**
 * Keyboard modifiers at click time
 */
export interface ClickModifiers {
  /** Shift key held - adds to selection */
  shift: boolean;
  /** Ctrl/Cmd key held - toggles selection */
  ctrl: boolean;
}

/**
 * Result of computing a selection action
 */
export type SelectionActionResult =
  | { action: 'select'; indices: number[]; mode: SelectionMode }
  | { action: 'toggle'; indices: number[] }
  | { action: 'clear' }
  | { action: 'replaceIfNotSole'; indices: number[] };

// ============= Core Selection Logic =============

/**
 * Unified click-to-select logic for simple targets (points, bars, lines).
 *
 * Implements the following interaction model:
 * - Click unselected: Replace selection with clicked item
 * - Click selected (only selection): Clear selection
 * - Click selected (multi-selection): Replace selection with clicked item
 * - Shift+click: Add to selection
 * - Ctrl/Cmd+click: Toggle in/out of selection
 *
 * @param target - The clicked target with its sample indices
 * @param currentSelection - The current selection state (Set of selected indices)
 * @param modifiers - Keyboard modifiers (shift, ctrl)
 * @returns The action to dispatch to SelectionContext
 *
 * @example
 * ```ts
 * const action = computeSelectionAction(
 *   { indices: [42] },
 *   selectionCtx.selectedSamples,
 *   { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey }
 * );
 * executeSelectionAction(selectionCtx, action);
 * ```
 */
export function computeSelectionAction(
  target: SelectionTarget,
  currentSelection: Set<number>,
  modifiers: ClickModifiers
): SelectionActionResult {
  const { indices } = target;
  const { shift, ctrl } = modifiers;

  // Shift+click: Add to selection
  if (shift) {
    return { action: 'select', indices, mode: 'add' };
  }

  // Ctrl/Cmd+click: Toggle selection
  if (ctrl) {
    return { action: 'toggle', indices };
  }

  // Plain click: Check if target is already selected
  const allTargetSelected = indices.length > 0 && indices.every(i => currentSelection.has(i));
  const selectionMatchesTarget =
    allTargetSelected &&
    currentSelection.size === indices.length;

  if (selectionMatchesTarget) {
    // Clicking the only selected item(s) → clear
    return { action: 'clear' };
  }

  // Replace selection with target
  return { action: 'select', indices, mode: 'replace' };
}

/**
 * Stacked bar progressive selection logic.
 *
 * Implements a 3-click drill-down model for stacked bars:
 * 1. First click: Select entire bar (all segments)
 * 2. Second click on same bar: Select only the clicked segment
 * 3. Third click on same segment: Clear selection
 *
 * Modifier keys bypass the progressive logic:
 * - Shift+click: Add the segment to selection
 * - Ctrl/Cmd+click: Toggle the segment
 *
 * @param target - The clicked stacked bar target with bar and segment indices
 * @param currentSelection - The current selection state
 * @param modifiers - Keyboard modifiers
 * @returns The action to dispatch to SelectionContext
 *
 * @example
 * ```ts
 * const action = computeStackedBarAction(
 *   { barIndices: [10, 11, 12, 13], segmentIndices: [10, 11] },
 *   selectionCtx.selectedSamples,
 *   { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey }
 * );
 * executeSelectionAction(selectionCtx, action);
 * ```
 */
export function computeStackedBarAction(
  target: StackedBarTarget,
  currentSelection: Set<number>,
  modifiers: ClickModifiers
): SelectionActionResult {
  const { barIndices, segmentIndices } = target;
  const { shift, ctrl } = modifiers;

  // Modifier keys bypass progressive logic and work on segment level
  if (shift) {
    return { action: 'select', indices: segmentIndices, mode: 'add' };
  }

  if (ctrl) {
    return { action: 'toggle', indices: segmentIndices };
  }

  // Check if entire bar is currently selected (exactly the bar, nothing more/less)
  const barFullySelected =
    barIndices.length > 0 &&
    barIndices.every(i => currentSelection.has(i)) &&
    barIndices.length === currentSelection.size;

  // Check if just this segment is selected (exactly the segment, nothing more/less)
  const segmentFullySelected =
    segmentIndices.length > 0 &&
    segmentIndices.every(i => currentSelection.has(i)) &&
    segmentIndices.length === currentSelection.size;

  if (segmentFullySelected) {
    // 3rd click: segment selected → clear
    return { action: 'clear' };
  }

  if (barFullySelected) {
    // 2nd click: bar selected → select segment only
    return { action: 'select', indices: segmentIndices, mode: 'replace' };
  }

  // 1st click (or different bar): select entire bar
  return { action: 'select', indices: barIndices, mode: 'replace' };
}

// ============= Action Execution =============

/**
 * Execute a computed selection action on the SelectionContext.
 *
 * This function bridges the pure action computation with the context's
 * imperative API, keeping the logic testable and the execution side-effect-free.
 *
 * @param ctx - The SelectionContext value (from useSelection)
 * @param action - The action result from computeSelectionAction or computeStackedBarAction
 *
 * @example
 * ```ts
 * const action = computeSelectionAction(target, selection, modifiers);
 * executeSelectionAction(selectionCtx, action);
 * ```
 */
export function executeSelectionAction(
  ctx: Pick<SelectionContextValue, 'select' | 'toggle' | 'clear' | 'replaceIfNotSole'>,
  action: SelectionActionResult
): void {
  switch (action.action) {
    case 'clear':
      ctx.clear();
      break;
    case 'toggle':
      ctx.toggle(action.indices);
      break;
    case 'select':
      ctx.select(action.indices, action.mode);
      break;
    case 'replaceIfNotSole':
      ctx.replaceIfNotSole(action.indices);
      break;
  }
}

// ============= Convenience Handlers =============

/**
 * Create a unified click handler for a chart.
 *
 * This is a convenience function that combines computeSelectionAction and executeSelectionAction
 * into a single reusable callback factory.
 *
 * @param ctx - The SelectionContext value
 * @returns A click handler function that takes indices and event
 *
 * @example
 * ```ts
 * const handleClick = createClickHandler(selectionCtx);
 *
 * // In your chart component:
 * onClick={(data) => handleClick(data.indices, event)}
 * ```
 */
export function createClickHandler(
  ctx: Pick<SelectionContextValue, 'select' | 'toggle' | 'clear' | 'replaceIfNotSole' | 'selectedSamples'>
): (indices: number[], event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void {
  return (indices, event) => {
    const action = computeSelectionAction(
      { indices },
      ctx.selectedSamples,
      { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey }
    );
    executeSelectionAction(ctx, action);
  };
}

/**
 * Create a stacked bar click handler for histogram/fold charts.
 *
 * @param ctx - The SelectionContext value
 * @returns A click handler function that takes bar indices, segment indices, and event
 *
 * @example
 * ```ts
 * const handleStackedClick = createStackedBarClickHandler(selectionCtx);
 *
 * // In your histogram component:
 * onClick={(barIdx, segIdx, e) => handleStackedClick(barSamples, segmentSamples, e)}
 * ```
 */
export function createStackedBarClickHandler(
  ctx: Pick<SelectionContextValue, 'select' | 'toggle' | 'clear' | 'replaceIfNotSole' | 'selectedSamples'>
): (
  barIndices: number[],
  segmentIndices: number[],
  event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
) => void {
  return (barIndices, segmentIndices, event) => {
    const action = computeStackedBarAction(
      { barIndices, segmentIndices },
      ctx.selectedSamples,
      { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey }
    );
    executeSelectionAction(ctx, action);
  };
}

/**
 * Create a simplified click handler that uses replaceIfNotSole for plain clicks.
 *
 * This is the most common pattern for click-to-select:
 * - Plain click: Select item (or clear if it's the sole selection)
 * - Shift+click: Add to selection
 * - Ctrl/Cmd+click: Toggle selection
 *
 * Uses `replaceIfNotSole` context action directly for cleaner handling.
 *
 * @param ctx - The SelectionContext value
 * @returns A click handler function
 *
 * @example
 * ```ts
 * const handleClick = createSimpleClickHandler(selectionCtx);
 *
 * // In your chart component:
 * onClick={(e) => handleClick([pointIndex], e)}
 * ```
 */
export function createSimpleClickHandler(
  ctx: Pick<SelectionContextValue, 'select' | 'toggle' | 'replaceIfNotSole'>
): (indices: number[], event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void {
  return (indices, event) => {
    if (event.shiftKey) {
      ctx.select(indices, 'add');
    } else if (event.ctrlKey || event.metaKey) {
      ctx.toggle(indices);
    } else {
      // Plain click: use replaceIfNotSole (clears if sole selection, replaces otherwise)
      ctx.replaceIfNotSole(indices);
    }
  };
}
