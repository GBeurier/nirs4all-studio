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

import type { SelectionContextValue, SelectionMode } from '@/context/useSelection';
import {
  isPointInBox,
  isPointInPolygon,
  type Point,
  type SelectionResult,
} from '@/components/playground/selectionGeometry';

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
 * Area selection logic for box/lasso selection (drag-based).
 *
 * Unlike point clicks, area selection does NOT toggle/clear when selecting the same area.
 * This is because dragging a box over points always means "I want these selected".
 *
 * Implements the following interaction model:
 * - Drag select: Replace selection with all points in the area
 * - Shift+drag: Add all points in area to selection
 * - Ctrl/Cmd+drag: Toggle all points in area
 *
 * @param target - The target with sample indices in the selection area
 * @param currentSelection - The current selection state (not used for plain drag, only for modifiers)
 * @param modifiers - Keyboard modifiers (shift, ctrl)
 * @returns The action to dispatch to SelectionContext
 *
 * @example
 * ```ts
 * const action = computeAreaSelectionAction(
 *   { indices: selectedIndicesInBox },
 *   selectionCtx.selectedSamples,
 *   { shift: modifiers.shift, ctrl: modifiers.ctrl }
 * );
 * executeSelectionAction(selectionCtx, action);
 * ```
 */
export function computeAreaSelectionAction(
  target: SelectionTarget,
  _currentSelection: Set<number>,
  modifiers: ClickModifiers
): SelectionActionResult {
  const { indices } = target;
  const { shift, ctrl } = modifiers;

  // Shift+drag: Add to selection
  if (shift) {
    return { action: 'select', indices, mode: 'add' };
  }

  // Ctrl/Cmd+drag: Toggle selection
  if (ctrl) {
    return { action: 'toggle', indices };
  }

  // Plain drag: Always replace selection with the dragged area
  // (never clear even if selecting the same points again)
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

// ============= Area-Selection Geometry Helpers =============

/**
 * Recharts renders scatter symbols inside nested layer groups whose class names
 * have shifted between versions. This fallback list is tried in order; the first
 * selector that matches any element wins. Shared by every Recharts-backed chart so
 * a DOM-class change only has to be fixed in one place.
 */
const RECHARTS_SCATTER_SELECTORS = [
  '.recharts-scatter-symbol',
  '.recharts-symbols',
  '.recharts-layer.recharts-scatter .recharts-symbols',
  '.recharts-scatter path',
  '.recharts-layer path[fill]',
] as const;

/**
 * Resolve the sample indices covered by a box/lasso selection over a Recharts
 * scatter chart, using the rendered SVG symbols' on-screen positions.
 *
 * Each chart maps the Nth rendered symbol to its own data index (e.g. PCA points
 * use `chartData[n].index`, repetition points use `plotData[n].sampleIndex`), so
 * the per-chart mapping is supplied via `getDataIndex`. Only the first
 * `pointCount` symbols are considered, skipping trailing reference-dataset symbols.
 *
 * @param container - The chart's container element (queried for `.recharts-*` symbols)
 * @param pointCount - Number of leading symbols that belong to the chart's own data
 * @param result - The box/lasso selection in container-local screen coordinates
 * @param getDataIndex - Maps a 0-based symbol index to the sample's data index
 * @returns Data indices whose symbol centers fall inside the selection (empty if none)
 */
export function selectRechartsPointsInArea(
  container: HTMLElement,
  pointCount: number,
  result: SelectionResult,
  getDataIndex: (domIndex: number) => number
): number[] {
  const containerRect = container.getBoundingClientRect();

  let scatterSymbols: NodeListOf<Element> | null = null;
  for (const selector of RECHARTS_SCATTER_SELECTORS) {
    const elements = container.querySelectorAll(selector);
    if (elements.length > 0) {
      scatterSymbols = elements;
      break;
    }
  }

  if (!scatterSymbols || scatterSymbols.length === 0) {
    return [];
  }

  // Build screen positions for each point from getBoundingClientRect (more robust
  // than parsing SVG attributes).
  const pointScreenPositions: Array<{ screenX: number; screenY: number; dataIndex: number }> = [];
  scatterSymbols.forEach((symbol, idx) => {
    if (idx < pointCount) {
      const rect = symbol.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2 - containerRect.left;
      const centerY = rect.top + rect.height / 2 - containerRect.top;
      if (Number.isFinite(centerX) && Number.isFinite(centerY) && rect.width > 0) {
        pointScreenPositions.push({ screenX: centerX, screenY: centerY, dataIndex: getDataIndex(idx) });
      }
    }
  });

  const selectedIndices: number[] = [];
  if ('path' in result) {
    const screenPath = result.path;
    if (screenPath.length < 3) return [];
    pointScreenPositions.forEach(point => {
      if (isPointInPolygon({ x: point.screenX, y: point.screenY }, screenPath)) {
        selectedIndices.push(point.dataIndex);
      }
    });
  } else {
    const bounds = {
      minX: Math.min(result.start.x, result.end.x),
      maxX: Math.max(result.start.x, result.end.x),
      minY: Math.min(result.start.y, result.end.y),
      maxY: Math.max(result.start.y, result.end.y),
    };
    pointScreenPositions.forEach(point => {
      if (isPointInBox({ x: point.screenX, y: point.screenY }, bounds)) {
        selectedIndices.push(point.dataIndex);
      }
    });
  }

  return selectedIndices;
}

/**
 * Resolve the sample indices covered by a box/lasso selection in data space.
 *
 * Used by WebGL/Regl renderers, where points are already known in data
 * coordinates. The selection geometry is converted from screen to data space via
 * the caller-supplied `screenToData` (each chart binds its own axis offsets /
 * view bounds), then each point is tested against the resulting polygon/box.
 *
 * @param points - The chart's data points (data-space x/y plus the sample index)
 * @param result - The box/lasso selection in screen coordinates
 * @param screenToData - Converts a screen point to data coordinates
 * @returns Data indices of points inside the selection (empty if none)
 */
export function selectPointsInDataSpace(
  points: ReadonlyArray<{ x: number; y: number; index: number }>,
  result: SelectionResult,
  screenToData: (screenX: number, screenY: number) => Point
): number[] {
  const selectedIndices: number[] = [];

  if ('path' in result) {
    const dataPath = result.path.map(p => screenToData(p.x, p.y));
    if (dataPath.length < 3) return [];
    for (const point of points) {
      if (isPointInPolygon({ x: point.x, y: point.y }, dataPath)) {
        selectedIndices.push(point.index);
      }
    }
  } else {
    const startData = screenToData(result.start.x, result.start.y);
    const endData = screenToData(result.end.x, result.end.y);
    const dataBounds = {
      minX: Math.min(startData.x, endData.x),
      maxX: Math.max(startData.x, endData.x),
      minY: Math.min(startData.y, endData.y),
      maxY: Math.max(startData.y, endData.y),
    };
    for (const point of points) {
      if (isPointInBox({ x: point.x, y: point.y }, dataBounds)) {
        selectedIndices.push(point.index);
      }
    }
  }

  return selectedIndices;
}
