# Playground Selection Model Analysis

This document analyzes the selection system in the Playground and documents the unified, robust selection model for all chart types.

**Last Updated**: January 2026
**Status**: ✅ All Phases Complete

---

## Section 1: Current Functioning & Identified Flaws

### 1.1 Architecture Overview

The Playground's selection system is built around a centralized `SelectionContext` that manages:
- **Selected samples**: `Set<number>` of sample indices
- **Pinned samples**: Persistent visibility across filters
- **Hover state**: Cross-chart highlighting (separated into `HoverContext` for performance)
- **Selection history**: Undo/redo (max 10 entries, configurable via `MAX_HISTORY`)
- **Selection tool mode**: `'click' | 'box' | 'lasso'` (global)
- **Selection modes**: `'replace' | 'add' | 'remove' | 'toggle'`

Key files:
- [SelectionContext.tsx](../../src/context/SelectionContext.tsx) - Central state management with selector pattern
- [SelectionTools.tsx](../../src/components/playground/SelectionTools.tsx) - Box/lasso UI overlay, `SelectionContainer` wrapper
- [colorConfig.ts](../../src/lib/playground/colorConfig.ts) - Unified color computation (selection/hover visual feedback)
- Individual chart components implement their own click/selection handlers

### 1.2 Chart-by-Chart Click Handling

#### SpectraChartV2 (Lines)
```
Current State: NO direct click-to-select on spectrum lines
- Selection handled via:
  - rangeSelection state (wavelength range on X-axis)
  - rectSelection state (2D rectangle selection)
  - Cross-chart highlighting from other charts
- WebGL mode delegates to SpectraWebGL (no line-click either)
- No single-line click → select sample implementation exists
```

**Note**: Clicking on a spectrum line does NOT select that sample. This is a gap, not a bug—but should be considered for future phases.

#### DimensionReductionChart (Scatter Points)
```
Click via Recharts Scatter onClick → handleClick(data, index, event)
- Correct toggle/add/replace logic present
- BUT: selectionJustCompletedRef used to prevent double-fire after box/lasso
- WebGL (ScatterPureWebGL2D, ScatterRegl2D) have separate handlers
- 3D views (WebGL/Regl) use yet another handler (handleSelectionComplete3D)
- Background click clears selection (only in 'click' mode)
```

#### YHistogramV2 (Bars)
```
Click via onMouseUp → Checks if target is a bar (.recharts-rectangle)
- Uses BOTH lastMouseEventRef AND mouseDownEventRef to capture native events
- Range selection (drag) also uses onMouseUp, creating ambiguity
- Selection logic: checks if "exactly this bin's samples" are selected → clears
- Stacked modes have SEPARATE handlers (major duplication):
  - handleStackedPartitionMouseUp
  - handleStackedFoldMouseUp
  - handleStackedMetadataMouseUp
  - handleStackedSelectionMouseUp
  - handleClassChartMouseUp (for classification mode)
```

#### FoldDistributionChartV2 (Stacked Bars)
```
Click via partition bar click handlers
- Tracks clickedPartitionId state for UI feedback (stroke on clicked bar)
- Uses computeSegments() to calculate samples per color mode
- Selection logic similar to histogram (clear if exact match)
- No sub-bar (segment) selection - always selects entire partition
- Has useEffect to clear clickedPartitionId when selection changes externally
```

#### RepetitionsChart (Scatter Strip Plot)
```
Click via Recharts Scatter onClick → handlePointClick(point, event)
- Shift+click selects entire bio sample group (all repetitions)
- Proper single-click deselect logic (if only selection → clear)
- Custom drag-to-select with selectionBox state (NOT SelectionContainer)
- Right-drag for pan, left-drag for box selection
- Background click clears selection (handleChartClick)
- Sort options affect X-axis ordering
```

**Observations on RepetitionsChart:**
- Most complete click implementation: handles all modifiers correctly
- BUT: duplicates selection logic instead of using shared handler
- Uses custom box selection instead of global `SelectionContainer`
- Visual feedback similar to SelectionContainer (`border-2 border-dashed border-primary bg-primary/10`)
- No integration with global `selectionToolMode` (always uses custom mode)
- No lasso selection support (only box)

### 1.3 Identified Flaws & Antipatterns

#### Flaw #1: Inconsistent Click-to-Select Semantics
| Chart | Click unselected | Click selected (single) | Click selected (multi) |
|-------|------------------|------------------------|------------------------|
| Spectra | **No click-select** | N/A | N/A |
| PCA/Scatter | Select it | Clear selection | Replace (select only it) |
| Histogram | Select bin | Clear if exact match | Replace |
| Folds | Select partition | Clear if exact match | Replace |
| Repetitions | Select point | Clear selection | Replace (correct) |

**Problem**: No single, consistent behavior. SpectraChart doesn't support line-click at all.

#### Flaw #2: Duplicated Selection Logic
Each chart implements its own version of:
```ts
if (e.shiftKey) {
  selectionCtx.select([...], 'add');
} else if (e.ctrlKey || e.metaKey) {
  selectionCtx.toggle([...]);
} else {
  selectionCtx.select([...], 'replace');
}
```
This pattern is duplicated **10+ times** across:
- `DimensionReductionChart.handleClick`
- `YHistogramV2.handleMouseUp`
- `YHistogramV2.handleStackedPartitionMouseUp`
- `YHistogramV2.handleStackedFoldMouseUp`
- `YHistogramV2.handleStackedMetadataMouseUp`
- `YHistogramV2.handleStackedSelectionMouseUp`
- `YHistogramV2.handleClassChartMouseUp`
- `FoldDistributionChartV2` bar handlers
- `RepetitionsChart.handlePointClick`

#### Flaw #3: Mixed Responsibilities in mouseUp Handlers
The histogram's `handleMouseUp` handles both:
1. Completing a drag-range selection
2. Processing a click on a bar

This coupling leads to:
- Race conditions with `selectionJustCompletedRef`
- Difficulty distinguishing click vs. drag
- Stale closure issues requiring `lastMouseEventRef` AND `mouseDownEventRef`

#### Flaw #4: Inconsistent Click Target Detection
- Histogram: `target?.classList?.contains('recharts-rectangle')`
- Scatter: Relies on Recharts' `onClick` payload
- Spectra: No click handling for lines
- Folds: Similar to Histogram

No unified approach to "what was clicked."

#### Flaw #5: WebGL/Canvas Split
Each rendering mode has its own selection logic:
- **Canvas (Recharts)**: Relies on Recharts event system
- **WebGL (PureWebGL, Regl)**: Custom raycasting/picking

This creates 2-3x code paths for the same logical operation in DimensionReductionChart.

#### Flaw #6: selectionJustCompletedRef Anti-pattern
```ts
const selectionJustCompletedRef = useRef(false);

// In handleSelectionComplete:
selectionJustCompletedRef.current = true;

// In handleClick:
if (selectionJustCompletedRef.current) {
  selectionJustCompletedRef.current = false;
  return;
}
```
This is a code smell indicating event bubbling issues and unclear event ownership.

#### Flaw #7: No Click-Outside Handler Consistency

**Background Click Behavior by Chart:**

| Chart | Background Click (click mode) | Background Click (box/lasso) | Implementation |
|-------|-------------------------------|------------------------------|----------------|
| DimensionReductionChart | Clears selection | No-op (correct) | `handleChartClick` + `handleBackgroundClick` |
| YHistogramV2 | Not implemented | N/A (no box/lasso) | - |
| SpectraChartV2 | Not implemented | N/A | - |
| FoldDistributionChartV2 | Not implemented | N/A | - |
| RepetitionsChart | Clears selection | Uses own selection box | `handleChartClick` |

The `onBackgroundClick` callback exists in `SelectionContainer` but is inconsistently wired.

#### Flaw #8: Hover Toggle Pollution
`config.enableHover` is checked in multiple places but:
- Sometimes in the handler
- Sometimes in the component props
- Sometimes affects tooltip only, sometimes selection too

#### Flaw #9: No Stacked Bar Sub-Selection
In stacked bar charts (YHistogramV2, FoldDistributionChartV2), clicking always selects the **entire bar** (all segments). There is no way to:
- Select only samples from a specific fold/partition within a bin
- Drill down into a segment of a stacked bar
- Progressively narrow selection by repeated clicks

**Note**: The data structure already supports sub-selection. YHistogramV2's `BinData` includes `foldSamples?: Record<number, number[]>` which tracks samples per fold within each bin. The infrastructure exists but isn't wired to click handling.

#### Flaw #10: RepetitionsChart Uses Separate Selection System
RepetitionsChart implements its own box selection (`selectionBox` state) instead of using the global `SelectionContainer`:
- Doesn't respect global `selectionToolMode`
- Visual feedback is similar but not identical (`border-2 border-dashed border-primary bg-primary/10`)
- Duplicated coordinate conversion logic
- No lasso selection support

---

## Section 2: Unified Selection Logic Proposal

### 2.1 Core Interaction Model

For all interactive items (bar, stacked bar, point, line):

| Interaction | Behavior |
|-------------|----------|
| **Click unselected** | Replace selection with clicked item |
| **Click selected (only selection)** | Clear selection |
| **Click selected (multi-selection)** | Replace selection with clicked item |
| **Shift+click** | Add to selection |
| **Ctrl/Cmd+click** | Toggle (add if not selected, remove if selected) |
| **Click background** | Clear selection |
### 2.2 Stacked Bar Progressive Selection

For stacked bars (histogram with fold/partition stacking, fold distribution charts), implement a **progressive drill-down** model:

| Click # | Current State | Action | New State |
|---------|---------------|--------|----------|
| 1st | Nothing selected | Click on bar | Select **entire bar** (all segments) |
| 2nd | Entire bar selected | Click on same bar | Select **clicked segment only** |
| 3rd | Single segment selected | Click on same segment | **Clear selection** |

**Visual feedback:**
- Entire bar selected: stroke around entire bar stack
- Segment selected: stroke only around the specific segment, other segments dimmed

**State tracking:**
The selection system needs to track:
1. Which samples are selected (`selectedSamples: Set<number>`) - already exists
2. Selection granularity context (optional, for UI feedback)

Since `selectedSamples` already stores individual indices, the sub-selection naturally works:
- "Entire bar" = all indices from all segments of that bin
- "Segment only" = indices from that specific fold/partition within the bin

**Segment Detection Strategy:**

Recharts stacked bars don't expose which segment was clicked. The only viable approach:

> **Use mouse Y-position to determine segment**: Calculate which segment the click Y-coordinate falls within by comparing against the cumulative stack heights.

Alternative (render segments as separate `<Bar>` components) would require restructuring the chart data model and break Recharts' built-in stacking—not recommended.

**Implementation:**
```ts
interface StackedBarTarget {
  /** All samples in the entire bar (all segments) */
  barIndices: number[];
  /** Samples in the clicked segment only */
  segmentIndices: number[];
}

function computeStackedBarAction(
  target: StackedBarTarget,
  currentSelection: Set<number>,
  modifiers: ClickModifiers
): SelectionActionResult {
  const { barIndices, segmentIndices } = target;

  // Modifier keys bypass progressive logic
  if (modifiers.shift) {
    return { action: 'select', indices: segmentIndices, mode: 'add' };
  }
  if (modifiers.ctrl) {
    return { action: 'toggle', indices: segmentIndices };
  }

  // Check if entire bar is currently selected
  const barFullySelected = barIndices.every(i => currentSelection.has(i)) &&
    barIndices.length === currentSelection.size;

  // Check if just this segment is selected
  const segmentFullySelected = segmentIndices.every(i => currentSelection.has(i)) &&
    segmentIndices.length === currentSelection.size;

  if (segmentFullySelected) {
    // 3rd click: segment selected → clear
    return { action: 'clear', indices: [] };
  }

  if (barFullySelected) {
    // 2nd click: bar selected → select segment only
    return { action: 'select', indices: segmentIndices, mode: 'replace' };
  }

  // 1st click (or different bar): select entire bar
  return { action: 'select', indices: barIndices, mode: 'replace' };
}
```

**Shift/Ctrl behavior on stacked bars:**
- **Shift+click**: Always adds the **segment** (more granular) to selection
- **Ctrl+click**: Toggles the **segment** in/out of selection

### 2.3 Unified Handler Signature

Create a single, reusable selection handler with explicit types:

```ts
// lib/playground/selectionHandlers.ts

export interface SelectionTarget {
  /** Sample indices represented by this target (single point = [idx], bar = [idx1, idx2, ...]) */
  indices: number[];
}

export interface ClickModifiers {
  shift: boolean;
  ctrl: boolean; // includes metaKey for Mac
}

/** Result of computing a selection action */
export type SelectionActionResult = {
  action: 'select' | 'toggle' | 'clear';
  indices: number[];
  mode?: 'replace' | 'add';
};

/**
 * Unified click-to-select logic
 * Returns the action to dispatch to SelectionContext
 */
export function computeSelectionAction(
  target: SelectionTarget,
  currentSelection: Set<number>,
  modifiers: ClickModifiers
): { action: 'select' | 'toggle' | 'clear'; indices: number[]; mode?: 'replace' | 'add' } {
  const { indices } = target;
  const { shift, ctrl } = modifiers;

  if (shift) {
    return { action: 'select', indices, mode: 'add' };
  }

  if (ctrl) {
    return { action: 'toggle', indices };
  }

  // Plain click
  const allTargetSelected = indices.every(i => currentSelection.has(i));
  const selectionMatchesTarget =
    allTargetSelected &&
    currentSelection.size === indices.length;

  if (selectionMatchesTarget) {
    // Clicking the only selected item(s) → clear
    return { action: 'clear', indices: [] };
  }

  // Replace selection with target
  return { action: 'select', indices, mode: 'replace' };
}

/**
 * Execute the computed action on SelectionContext
 */
export function executeSelectionAction(
  ctx: SelectionContextValue,
  action: ReturnType<typeof computeSelectionAction>
) {
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
  }
}
```

### 2.4 Chart Implementation Pattern

Each chart should:

1. **Extract target indices** from the clicked element
2. **Extract modifiers** from the event
3. **Call unified handler**

```ts
// In any chart's click handler
const handleChartClick = useCallback((clickedIndices: number[], event: MouseEvent) => {
  const action = computeSelectionAction(
    { indices: clickedIndices },
    selectionCtx.selectedSamples,
    { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey }
  );
  executeSelectionAction(selectionCtx, action);
}, [selectionCtx]);
```

### 2.5 Background Click Handling

Standardize background click detection:

```ts
// In SelectionContainer or chart wrapper
const handleBackgroundClick = useCallback((event: MouseEvent) => {
  // Only clear if:
  // 1. Click mode is active (not box/lasso)
  // 2. Click was on background, not on a data element
  // 3. No modifier keys (Shift/Ctrl+click on background is no-op)

  if (selectionTool !== 'click') return;
  if (event.shiftKey || event.ctrlKey || event.metaKey) return;

  selectionCtx.clear();
}, [selectionTool, selectionCtx]);
```

### 2.6 Color & Visual Feedback Unified Model

| State | Stroke | Opacity | Z-Index |
|-------|--------|---------|---------|
| Default | none | 1.0 | normal |
| Selected | foreground, 2px | 1.0 | elevated |
| Hovered | primary, 1.5px | 1.0 | top |
| Pinned | gold, 1.5px | 1.0 | elevated |
| Unselected (when selection exists) | none | 0.3 | normal |
| Hidden (display filter) | transparent | 0 | - |

Color computation should be centralized in `colorConfig.ts` and consumed uniformly by all charts.

### 2.7 Selection Tool Mode Integration

The `selectionToolMode` from `SelectionContext` should control behavior globally:

| Mode | Primary Interaction | Drag Behavior |
|------|---------------------|---------------|
| `click` | Point/item selection | No drag selection |
| `box` | Rectangle marquee selection | Draw rectangle |
| `lasso` | Freeform area selection | Draw path |

When `mode !== 'click'`, individual item clicks are disabled to avoid conflicts.

---

## Section 3: Implementation Roadmap

### Migration Strategy

**Approach**: Incremental refactoring with feature flag for rollback safety.

```ts
// Feature flag in development settings or environment
const USE_UNIFIED_SELECTION = true; // false to revert to legacy handlers
```

Each chart can be migrated independently. When `USE_UNIFIED_SELECTION` is false, the old handlers remain active as fallback.

**Rollback Plan**: If issues arise post-migration:
1. Set `USE_UNIFIED_SELECTION = false` in development settings
2. The chart falls back to its original (preserved) handler
3. Debug and fix the unified handler
4. Re-enable once stable

---

### Phase 1: Foundation (Low Risk) ✅ COMPLETE
**Goal**: Create shared utilities without changing existing behavior

1. **Create `lib/playground/selectionHandlers.ts`** ✅
   - `computeSelectionAction(target, currentSelection, modifiers)`
   - `computeStackedBarAction(target, currentSelection, modifiers)`
   - `executeSelectionAction(ctx, action)`
   - Unit tests in `selectionHandlers.test.ts`

2. **Create `lib/playground/selectionUtils.ts`** ✅
   - `extractModifiers(event: MouseEvent | React.MouseEvent): ClickModifiers`
   - `isBackgroundElement(target: EventTarget): boolean`
   - Type guards for selection results
   - Unit tests in `selectionUtils.test.ts`

3. **Document expected behavior** ✅ (this document)

**Testing**: Unit tests implemented for all core functions

### Phase 2: DimensionReductionChart Refactor (Medium Risk) ✅ COMPLETE
**Goal**: Validate approach on the most complex chart

1. **Refactor handleClick** ✅
   - Replaced inline logic with `computeSelectionAction` + `executeSelectionAction`
   - Removed `selectionJustCompletedRef` anti-pattern
   - Unified Recharts/WebGL/Regl handlers to use same pattern

2. **Refactor handleSelectionComplete (box/lasso)** ✅
   - Uses same action computation for area selections
   - Properly batches selection updates

3. **Add background click handling** ✅
   - Wired `onBackgroundClick` from `SelectionContainer`
   - Respects `selectionToolMode`

4. **Verify behavior** ✅
   - Manual testing confirmed all interactions work correctly

**Testing**: Integration complete, all selection modes functional

### Phase 3: Histogram Refactor (Medium Risk) ✅ COMPLETE
**Goal**: Untangle range selection from click handling

1. **Separate concerns** ✅
   - `handleBarSelection` for single bar clicks (unified handler)
   - `handleStackedBarSelection` for stacked bar clicks (unified handler)
   - `handleDragSelection` for drag-range selection
   - Clear boundary between range drag and bar click

2. **Migrate to unified handlers** ✅
   - Bar click → `computeSelectionAction` with bar's sample indices
   - Range select → `computeSelectionAction` with all samples in range
   - Stacked bars → `computeStackedBarAction` with progressive drill-down

3. **Stacked mode handlers** ✅
   - Each mode (partition, fold, metadata, selection, class) has mode-specific segment detection
   - All call `handleStackedBarSelection` which uses unified handlers internally
   - **Note**: Handlers are not consolidated into one because segment detection differs per mode

4. **`lastMouseEventRef` kept** ⚠️
   - Required workaround due to Recharts limitation (no native event in callbacks)
   - Documented as known limitation, not a bug

**Testing**: All selection modes functional, range selection works

### Phase 4: SpectraChart Refactor (Low Risk) ✅ COMPLETE
**Goal**: Add line click-to-select if desired, otherwise document gap

**Decision**: Option A chosen - no line-click selection

1. **Keep as-is** ✅
   - Spectra chart supports box/lasso selection only
   - Background click clears selection via SelectionContainer
   - Line-click not implemented due to performance concerns with many overlapping spectra

2. **Range selection on X-axis** ✅
   - Kept as separate interaction (wavelength-based filtering)
   - Not conflated with sample selection

**Testing**: Box/lasso selection works, background click clears selection

### Phase 5: FoldDistributionChart Consolidation (Low-Medium Risk) ✅ COMPLETE
**Goal**: Deduplicate handlers across stacked modes

1. **Generic bar click handler** ✅
   - Uses `computeStackedBarAction` from unified handlers
   - Extracts samples from clicked segment using `computeSegments`

2. **Segment detection** ✅
   - Uses existing `computeSegments()` infrastructure
   - Click handler uses unified `computeStackedBarAction`

**Testing**: Progressive drill-down works (bar → segment → clear)

### Phase 6: RepetitionsChart Integration (Low-Medium Risk) ✅ COMPLETE
**Goal**: Align RepetitionsChart with global selection system

1. **Custom box selection replaced** ✅
   - Custom `selectionBox` state was already removed
   - Chart now uses SelectionContainer for box/lasso selection
   - Respects global `selectionToolMode`

2. **Point click uses unified handler** ✅
   - Uses `computeSelectionAction` for point clicks
   - Shift+click on point selects entire bio-sample group (special case preserved)

3. **Pan functionality kept** ✅
   - Right-click drag for pan works alongside SelectionContainer

**Testing**: SelectionContainer box select works, pan functional

### Phase 7: SelectionContext Enhancement (Low Risk) ✅ COMPLETE
**Goal**: Add missing capabilities

1. **`replaceIfNotSole` action** ✅
   - Added to SelectionContext reducer
   - Encapsulates "click selected when multi" logic
   - Used by `createSimpleClickHandler` convenience function

2. **`selectRange` improved** ✅
   - Works with line/bar ordering
   - Respects shift behavior

3. **Mode audit** ✅
   - All modes (`replace`, `add`, `remove`, `toggle`) are in use
   - None deprecated

**Testing**: Unit tests for new reducer actions added

### Phase 8: Testing & Validation ✅ COMPLETE
**Goal**: Ensure robustness across all refactored charts

1. **Unit tests** ✅
   - `computeSelectionAction` tested with all permutations (see `selectionHandlers.test.ts`)
   - `computeStackedBarAction` tested with all permutations
   - Edge cases covered: empty selection, selecting already-selected, modifier combinations

2. **Integration tests** ✅
   - Vitest component tests for chart handlers
   - SelectionContext mocked and verified

3. **E2E tests** ⏳ (future work)
   - Playwright tests planned but not yet implemented
   - Manual testing confirms all interactions work

### Phase 9: Cleanup & Documentation ✅ COMPLETE
**Goal**: Maintainability and finalization
**Status**: Completed January 2026

1. **Remove feature flag** ✅
   - The `USE_UNIFIED_SELECTION` feature flag was never implemented in code (only documented)
   - All charts now use the unified handlers directly without fallback

2. **Update PLAYGROUND_SPECIFICATION.md** ✅
   - Added Section 5.3 "Unified Click Behavior" with interaction model
   - Added Section 5.3.1 "Stacked Bar Progressive Selection"
   - Added Section 5.7 "Implementation Architecture" with code examples
   - Added link to this document for detailed reference

3. **Inline code comments** ✅
   - `selectionHandlers.ts` fully documented with JSDoc
   - `selectionUtils.ts` fully documented with JSDoc
   - All functions include examples and parameter descriptions

4. **Update this document** ✅
   - All phases marked complete
   - Added lessons learned section

---

## Appendix E: Lessons Learned

### What Worked Well

1. **Separation of computation and execution**: The `computeSelectionAction` / `executeSelectionAction` pattern allows pure functions to be easily unit tested.

2. **Stacked bar progressive drill-down**: The 3-click model (bar → segment → clear) provides intuitive interaction without adding complexity.

3. **Centralized modifier extraction**: `extractModifiers()` normalizes Ctrl/Cmd across platforms consistently.

4. **Mode-specific segment detection**: Each stacked chart mode (partition, fold, metadata, selection, class) has its own segment detection logic that feeds into the unified handler. This is intentional, not duplication.

### Known Limitations

1. **Recharts event workaround**: The `lastMouseEventRef` pattern is still required in YHistogramV2 because Recharts callbacks don't provide native MouseEvent with modifier keys. This is a Recharts limitation, not a design flaw.

2. **No line-click in SpectraChart**: Clicking on individual spectrum lines is not implemented due to hit-testing complexity with many overlapping lines. Selection uses box/lasso only.

3. **WebGL picking complexity**: WebGL renderers (ScatterPureWebGL2D, ScatterRegl2D) require custom raycasting, which adds code paths but follows the unified handler pattern.

### Future Improvements

1. Consider Recharts replacement with a library that provides native events (D3-based, Visx, etc.)
2. Evaluate GPU-based picking for WebGL scatter with >10k points
3. Add haptic/audio feedback for selection changes (accessibility)

---

## Appendix A: File Impact Summary (Post-Refactor)

| File | Final State | Notes |
|------|-------------|-------|
| `SelectionContext.tsx` | ✅ Updated | Added `replaceIfNotSole` action |
| `HoverContext.tsx` | ✅ Unchanged | Already separated from selection |
| `SelectionTools.tsx` | ✅ Complete | `onBackgroundClick` wired correctly |
| `selectionHandlers.ts` | ✅ Created | Core unified logic with full JSDoc |
| `selectionUtils.ts` | ✅ Created | Helper functions with full JSDoc |
| `DimensionReductionChart.tsx` | ✅ Refactored | Uses unified handlers, `selectionJustCompletedRef` removed |
| `YHistogramV2.tsx` | ✅ Refactored | Uses `handleBarSelection`/`handleStackedBarSelection`, mode-specific segment detection kept |
| `SpectraChartV2.tsx` | ✅ Complete | Box/lasso via SelectionContainer, no line-click (by design) |
| `FoldDistributionChartV2.tsx` | ✅ Refactored | Uses `computeStackedBarAction` |
| `RepetitionsChart.tsx` | ✅ Refactored | Uses SelectionContainer, unified click handler |
| `scatter/*.tsx` (WebGL/Regl) | ✅ Aligned | Follow unified handler pattern |
| `SpectraWebGL.tsx` | ✅ Aligned | Consistent with SpectraChartV2 |

---

## Appendix B: Quick Reference Card

### For Developers Implementing Selection

```ts
import { computeSelectionAction, executeSelectionAction, extractModifiers } from '@/lib/playground/selectionHandlers';

// Step 1: Get clicked item's sample indices
const clickedIndices: number[] = /* depends on chart type */;

// Step 2: Extract modifiers
const modifiers = extractModifiers(event);

// Step 3: Compute action
const action = computeSelectionAction(
  { indices: clickedIndices },
  selectionCtx.selectedSamples,
  modifiers
);

// Step 4: Execute
executeSelectionAction(selectionCtx, action);
```

### For Users (Expected Behavior)

**All Charts:**
- **Click** → Select this item
- **Click again (when only selection)** → Deselect (clear)
- **Click another (when multi-selected)** → Select only that item
- **Shift+Click** → Add to selection
- **Ctrl/Cmd+Click** → Toggle in/out of selection
- **Click background** → Clear selection
- **Escape** → Clear selection (already implemented)

**Stacked Bar Charts (Histogram, Folds):**
- **1st click** → Select entire bar (all segments)
- **2nd click (same bar)** → Select only the clicked segment
- **3rd click (same segment)** → Clear selection
- **Shift+Click segment** → Add segment to selection
- **Ctrl+Click segment** → Toggle segment in/out

---

## Appendix C: Handler Locations (Post-Refactor)

Current handler architecture after refactoring:

| Chart | Handler(s) | Status | Notes |
|-------|------------|--------|-------|
| DimensionReductionChart | `handleClick` → `computeSelectionAction` | ✅ | No `selectionJustCompletedRef` |
| YHistogramV2 | `handleBarSelection`, `handleStackedBarSelection` | ✅ | Mode-specific segment detection, unified action computation |
| SpectraChartV2 | SelectionContainer only | ✅ | Box/lasso selection, no line-click |
| FoldDistributionChartV2 | `computeStackedBarAction` | ✅ | Uses unified handler |
| RepetitionsChart | `computeSelectionAction` | ✅ | Uses SelectionContainer |

---

## Appendix D: Anti-Patterns Status

1. **`selectionJustCompletedRef`** — ✅ Removed from DimensionReductionChart

2. **`mouseDownEventRef`** — ⚠️ Kept in YHistogramV2 (Recharts limitation)

3. **`lastMouseEventRef`** — ⚠️ Kept in YHistogramV2 (Recharts limitation - documented as known limitation, not a bug)

4. **Duplicate handler functions** — ✅ Stacked handlers now share `handleStackedBarSelection` with mode-specific segment detection

5. **Custom `selectionBox` state** — ✅ Removed from RepetitionsChart

---

*Document version: 3.0 — Phase 9 Complete*
