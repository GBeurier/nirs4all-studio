# Playground Implementation Roadmap

> **Created**: January 8, 2026
> **Last Updated**: January 8, 2026 (Post-Review Revision)
> **Based on**: PLAYGROUND_SPECIFICATION.md v1.0 & PLAYGROUND_DISCREPANCY_ANALYSIS.md
> **Status**: In Progress
> **Reference**: [PLAYGROUND_SPECIFICATION.md](./PLAYGROUND_SPECIFICATION.md)
> **Reference**: [PLAYGROUND_DISCREPANCY_ANALYSIS.md](./PLAYGROUND_DISCREPANCY_ANALYSIS.md)

---

## Overview

This roadmap addresses all gaps between the current Playground implementation and the specification. Phases are ordered by priority: critical fixes first, then core features, then enhancements.

**Post-Review Note**: This document has been revised following a comprehensive codebase review that identified 12 hidden problems, corrected inconsistencies, and adjusted effort estimates.

---

## Phase 1: Critical Selection System Fix

**Priority**: CRITICAL
**Estimated Effort**: 4-6 days *(revised from 3-5 days)*
**Goal**: Make the selection system fully functional

### Current Problem

The selection system has code in place (`SelectionContext`, click handlers) but clicking on chart elements does not reliably trigger selection. This breaks:
- Cross-chart highlighting
- Selection-based coloring
- Export of selected samples
- All selection-dependent features

### Technical Analysis

**Code Locations**:
- `SelectionContext`: [src/context/SelectionContext.tsx](../src/context/SelectionContext.tsx) - Well-designed with full API (746 lines)
- `SpectraChartV2.handleClick`: Line 518 - Uses regex `/[po](\d+)/` to parse dataKey
- `YHistogramV2.handleClick`: Line 425 - Click on histogram bars
- `PCAPlot.handleClick`: Line 177 - Click on scatter points
- `SpectraWebGL`: Has `useSelectionContext` prop (default false!) - not wired to context
- `ScatterWebGL`: Has `useSelectionContext` prop (default false!) - not wired to context

**Root Causes Identified**:
1. **Recharts onClick unreliable**: With many overlapping Line components, `activePayload` often undefined
2. **WebGL components disconnected**: `SpectraWebGL` and `ScatterWebGL` have `useSelectionContext=false` by default AND don't dispatch to context even when enabled
3. **Regex parsing fragile**: `key.match(/[po](\d+)/)` depends on specific dataKey format
4. **Hover propagation broken**: SpectraChartV2 and YHistogramV2 READ `hoveredSample` from context but NEVER SET it

**Critical Finding - Hover Not Propagated**:
```
Component              | Reads hoveredSample | Sets hoveredSample
-----------------------|--------------------|-----------------
SpectraChartV2         | YES (line 158)     | NO  <-- BROKEN
YHistogramV2           | YES (line 274)     | NO  <-- BROKEN
DimensionReductionChart| YES                | YES <-- WORKS (reference impl)
```

**Additional Issue - Tooltip Suppression**:
SpectraChartV2 line 1083 has `<Tooltip content={() => null} />` - custom tooltip is disabled, which may have been the intended location for hover handling.

### Tasks

| ID | Task | Component | Notes |
|----|------|-----------|-------|
| 1.1 | **Implement full SelectionContext integration in WebGL** | SpectraWebGL, ScatterWebGL | Not just enabling prop - must dispatch `select()` and `setHovered()` to context |
| 1.2 | **Implement hover-then-click pattern** | SpectraChartV2 | Track hovered sample via `onMouseMove`, select on click |
| 1.3 | **Add click handler to WebGL canvas** | SpectraWebGL | Use raycasting for nearest line detection |
| 1.4 | **Test YHistogramV2 selection** | YHistogramV2 | Verify bar clicks work correctly |
| 1.5 | **Test PCAPlot/DimensionReductionChart** | PCAPlot | Verify point clicks work |
| 1.6 | **Cross-chart sync verification** | SelectionContext | Add debug logging to verify updates propagate |
| 1.7 | **Visual feedback verification** | All charts | Test opacity/size changes on selection |
| 1.8 | **Implement hover propagation** | SpectraChartV2, YHistogramV2 | Call `selectionCtx.setHovered(index)` on mouse events |
| 1.9 | **Investigate tooltip suppression** | SpectraChartV2 | Determine if `content={() => null}` was intended for custom hover |

### Implementation Strategy

**Recommended: Hover-then-Click Pattern**

Following DimensionReductionChart's working implementation:

```typescript
// SpectraChartV2 - Add hover handlers (currently missing)
const handleMouseEnter = useCallback((sampleIdx: number) => {
  if (selectionCtx) {
    selectionCtx.setHovered(sampleIdx);  // Currently NOT called!
  }
}, [selectionCtx]);

const handleMouseLeave = useCallback(() => {
  if (selectionCtx) {
    selectionCtx.setHovered(null);  // Currently NOT called!
  }
}, [selectionCtx]);

// Then in click handler:
const handleChartClick = useCallback((e: React.MouseEvent) => {
  if (hoveredSampleIdx !== null && selectionCtx) {
    if (e.shiftKey) {
      selectionCtx.select([hoveredSampleIdx], 'add');
    } else if (e.ctrlKey || e.metaKey) {
      selectionCtx.toggle([hoveredSampleIdx]);
    } else {
      selectionCtx.select([hoveredSampleIdx], 'replace');
    }
  }
}, [hoveredSampleIdx, selectionCtx]);
```

**For WebGL Mode**: The WebGL components need FULL integration, not just prop enabling:
```typescript
// ScatterWebGL currently has (line 187, 198):
onHover?.(pointData[instanceId]?.index ?? null);
onClick?.(pointData[hoveredIndex].index, event);

// Need to add:
selectionCtx?.setHovered(index);  // For hover
selectionCtx?.select([index], mode);  // For click
```

### Success Criteria

- [ ] Clicking on a spectrum in SpectraChartV2 (Canvas mode) selects it
- [ ] Clicking on a spectrum in SpectraChartV2 (WebGL mode) selects it
- [ ] **Hovering on a spectrum highlights it across ALL charts** *(new)*
- [ ] Shift+Click adds to selection
- [ ] Ctrl+Click toggles selection
- [ ] Selection syncs across all visible charts
- [ ] Selected samples show visual distinction (opacity, size)
- [ ] YHistogramV2 bar click selects all samples in bin
- [ ] PCA/UMAP point click selects sample

---

## Phase 1 Review

### Reviewed: January 8, 2026

**Status**: Not Started

**Issues Found**:
- WebGL components not wired to SelectionContext by default
- Recharts click detection unreliable for overlapping lines
- Need hover-then-click pattern for reliable selection
- **Hover propagation completely missing in SpectraChartV2 and YHistogramV2**
- Tooltip intentionally suppressed - may indicate incomplete refactoring

**Decisions Made**:
- Use hover-then-click pattern for Canvas mode
- Implement FULL SelectionContext integration for WebGL (not just prop)
- Reference DimensionReductionChart as working implementation example

**Carry-over to Next Phase**:
- Area selection (box/lasso) improvements moved to Phase 9

---

## Phase 2: Core Layout & View Management

**Priority**: HIGH
**Estimated Effort**: 1-2 days *(revised from 2-3 days - ChartPanel exists)*
**Goal**: Implement proper view states and layout optimization

### Current State

**Code Location**: [MainCanvas.tsx](../src/components/playground/MainCanvas.tsx#L418-L425)

```typescript
// Current implementation (lines 420-425)
const gridCols = visibleCount === 1 ? 'grid-cols-1'
  : visibleCount === 5 ? 'grid-cols-1 sm:grid-cols-2'
  : 'grid-cols-2';
const gridRows = visibleCount <= 2 ? 'grid-rows-1'
  : visibleCount <= 4 ? 'grid-rows-2' : 'grid-rows-3';
```

- Simple 2-column CSS grid with responsive breakpoint
- No maximize/minimize for individual views
- **ChartPanel component EXISTS but is UNUSED** (96 lines)
- Each chart implements its own header/controls

**Existing ChartPanel** - [src/components/playground/ChartPanel.tsx](../src/components/playground/ChartPanel.tsx):
```typescript
// Already has:
- Ref forwarding for exports
- Loading overlay (ChartLoadingOverlay)
- Error boundary (ChartErrorBoundary)
- Standard styling (bg-card, rounded-lg, border, p-3)
- Minimum height enforcement (250px)
```

**State Fragmentation Issue**:
View state is currently split across 4 levels:
- Page-level (`Playground.tsx`): `chartVisibility`, `renderMode`, `selectedSample`
- MainCanvas-level: `visibleCharts`, `colorConfig`, `partitionFilter`
- Chart-level: individual internal states
- Context-level: `SelectionContext`

### Tasks

| ID | Task | Component | Notes |
|----|------|-----------|-------|
| 2.1 | **Integrate existing ChartPanel** | MainCanvas | Replace inline `<div>` wrappers with ChartPanel |
| 2.2 | **Extend ChartPanel with header/footer** | ChartPanel.tsx | Add title, icon, menu, max/min/hide buttons |
| 2.3 | **Add view state management** | ChartPanel + Context | Track VISIBLE/HIDDEN/MAXIMIZED/MINIMIZED per view |
| 2.4 | **Implement MAXIMIZED state** | ChartPanel + MainCanvas | Full playground area, hide others temporarily |
| 2.5 | **Implement MINIMIZED state** | ChartPanel | Collapse to header bar only |
| 2.6 | **Smart layout for 3 views** | MainCanvas | 2×2 grid with one cell spanning |
| 2.7 | **Add smooth transitions** | ChartPanel | CSS transitions for layout changes |
| 2.8 | **Add sample count footer** | ChartPanel | "150 samples | Selection: 12" |
| 2.9 | **Create PlaygroundViewContext** | New context | Centralize view state currently split across 4 levels |

### Extended ChartPanel API

```typescript
interface ChartPanelProps {
  // Existing props
  children: React.ReactNode;
  chartType: string;
  isLoading?: boolean;
  ariaLabel?: string;
  className?: string;
  minHeight?: string;
  visible?: boolean;

  // New props for enhanced functionality
  title: string;
  icon?: React.ReactNode;
  viewId: 'spectra' | 'histogram' | 'pca' | 'folds' | 'repetitions';

  // Stats for footer
  sampleCount?: number;
  selectedCount?: number;

  // Menu items specific to this view
  menuItems?: React.ReactNode;

  // Callbacks
  onMaximize?: () => void;
  onMinimize?: () => void;
  onHide?: () => void;
}
```

### PlaygroundViewContext Design

```typescript
interface PlaygroundViewState {
  chartVisibility: Record<ChartType, boolean>;
  maximizedChart: ChartType | null;
  minimizedCharts: Set<ChartType>;
  focusedChart: ChartType | null;
  layoutMode: 'auto' | 'horizontal' | 'vertical' | 'grid';
}

interface PlaygroundViewContextValue extends PlaygroundViewState {
  setChartVisibility: (chart: ChartType, visible: boolean) => void;
  toggleChart: (chart: ChartType) => void;
  maximizeChart: (chart: ChartType | null) => void;
  minimizeChart: (chart: ChartType) => void;
  restoreChart: (chart: ChartType) => void;
  setFocusedChart: (chart: ChartType | null) => void;
}
```

### ChartPanel Structure

```
┌─────────────────────────────────────────────────┐
│ [Icon] View Title          [Menu] [Max] [Hide] │  ← Header Bar
├─────────────────────────────────────────────────┤
│                                                 │
│              {children} - Visualization         │
│                                                 │
├─────────────────────────────────────────────────┤
│ 150 samples | 12 selected | 3 pinned           │  ← Footer
└─────────────────────────────────────────────────┘
```

### Success Criteria

- [ ] All views wrapped in consistent ChartPanel (using existing component)
- [ ] Double-click header to maximize/restore
- [ ] Maximize button expands view to full area
- [ ] Minimize button collapses to header only
- [ ] Hide button removes from grid (same as toolbar toggle)
- [ ] Layout adapts intelligently to 1-5 visible views
- [ ] Smooth CSS transitions between states
- [ ] Footer shows sample/selection stats
- [ ] **View state centralized in PlaygroundViewContext** *(new)*

---

## Phase 2 Review

### Reviewed: January 8, 2026

**Status**: Not Started

**Issues Found**:
- Current layout logic is functional but basic
- Each chart has inconsistent header implementations
- No per-view maximize/minimize capability
- **ChartPanel already exists but unused**
- **State fragmented across 4 levels**

**Decisions Made**:
- **Integrate** existing ChartPanel (not create new)
- Extend with header/footer functionality
- Create PlaygroundViewContext for centralized state
- Use CSS transitions for smooth state changes
- Keep current grid logic but enhance for 3-view spanning

---

## Phase 3: Missing Coloration Features

**Priority**: HIGH
**Estimated Effort**: 2-3 days *(revised from 2 days - includes cleanup)*
**Goal**: Complete the coloration system

### Current State

**Code Location**: [colorConfig.ts](../src/lib/playground/colorConfig.ts) (617 lines)

Current `GlobalColorMode` type (line 12-20):
```typescript
export type GlobalColorMode =
  | 'target'      // Continuous gradient by Y value
  | 'partition'   // Categorical: train=blue, test=orange
  | 'fold'        // Categorical by fold index
  | 'metadata'    // Continuous or categorical based on column type
  | 'selection'   // Selected=primary, unselected=grey
  | 'outlier';    // Outliers=red (front), non-outliers=grey
  // MISSING: 'index' - Color by sample position
```

**Gaps Identified**:
- INDEX coloration mode missing (color by sample position)
- No global color legend component
- Outliers not overlaid in red when using other color modes

**Additional Issues Found**:
- **Duplicate ColorModeSelector implementations**:
  1. `/components/playground/ColorModeSelector.tsx` (OLD, simpler)
  2. Inside `/components/playground/CanvasToolbar.tsx` (NEW, full-featured)
- **Type migration incomplete** - Old types still in `chartConfig.ts`:
  - `ExtendedColorMode` (deprecated)
  - `ExtendedColorConfig` (deprecated)

### Tasks

| ID | Task | Component | Notes |
|----|------|-----------|-------|
| 3.1 | **Add 'index' to GlobalColorMode** | colorConfig.ts | Add type + handler in getBaseSampleColor |
| 3.2 | **Add INDEX mode to color picker** | ColorModeSelector | Add icon option |
| 3.3 | **Create ColorLegend component** | New: `components/playground/ColorLegend.tsx` | Dynamic legend |
| 3.4 | **Gradient legend for continuous** | ColorLegend | Bar with min/max labels |
| 3.5 | **Swatch legend for categorical** | ColorLegend | Color boxes with labels |
| 3.6 | **Position legend in playground** | MainCanvas | Bottom-right, collapsible |
| 3.7 | **Outlier overlay in all modes** | getUnifiedSampleColor | Add red border when isOutlier && mode !== 'outlier' |
| 3.8 | **Add outlier overlay toggle** | GlobalColorConfig | `showOutlierOverlay: boolean` |
| 3.9 | **Consolidate ColorModeSelector** | ColorModeSelector.tsx | Remove old implementation, use CanvasToolbar version |
| 3.10 | **Remove deprecated types** | chartConfig.ts | Delete ExtendedColorMode, ExtendedColorConfig |

### INDEX Mode Implementation

```typescript
// Add to GlobalColorMode type:
| 'index'       // Gradient by sample position (first=start, last=end)

// Add to getBaseSampleColor function:
case 'index': {
  const totalSamples = context.totalSamples ?? 1;
  const t = sampleIndex / Math.max(1, totalSamples - 1);
  return getContinuousColor(t, config.continuousPalette);
}
```

### ColorLegend Component API

```typescript
interface ColorLegendProps {
  config: GlobalColorConfig;
  context: ColorContext;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
}

// Renders:
// - Gradient bar + min/max for continuous modes (target, metadata-continuous, index)
// - Color swatches + labels for categorical modes (partition, fold, metadata-categorical, selection, outlier)
```

### Outlier Overlay Behavior

**Spec says**: "In all other coloration modes, outliers are always overlaid in red."

```typescript
// In getUnifiedSampleColor, after computing base color:
if (isOutlier && config.mode !== 'outlier' && config.showOutlierOverlay !== false) {
  result.stroke = '#FF4444';  // Red border
  result.strokeWidth = 2;
}
```

### Success Criteria

- [x] INDEX mode in color picker, colors samples by position
- [x] ColorLegend component renders correctly for all modes
- [x] Legend updates when color mode changes
- [x] Legend collapsible via toggle
- [x] Outliers have red border/overlay in all modes (when enabled)
- [x] Toggle to disable outlier overlay in settings
- [x] **Single ColorModeSelector implementation** *(new)*
- [x] **No deprecated type references remain** *(new)*

---

## Phase 3 Review

### Reviewed: January 8, 2026

**Status**: COMPLETED

**Implementation Summary**:
- Added 'index' to GlobalColorMode type with handler in colorConfig.ts
- Added totalSamples to ColorContext interface
- Added showOutlierOverlay toggle to GlobalColorConfig (default: true)
- Created ColorLegend component with gradient/swatch modes
- Integrated ColorLegend in MainCanvas (bottom-right, collapsible)
- Added INDEX option to color picker in CanvasToolbar
- Implemented outlier overlay (red stroke) for all modes except 'outlier' mode
- Removed old ColorModeSelector.tsx component
- Removed deprecated ExtendedColorMode/ExtendedColorConfig from chartConfig.ts
- Removed unused PCAPlot.tsx component
- Removed unused colorUtils.ts and useColorMode.ts hook
- Cleaned up unused imports and props in CanvasToolbar and MainCanvas

**Files Changed**:
- `src/lib/playground/colorConfig.ts` - Added 'index' mode, totalSamples, showOutlierOverlay
- `src/components/playground/ColorLegend.tsx` - New component
- `src/components/playground/MainCanvas.tsx` - Integrated ColorLegend
- `src/components/playground/CanvasToolbar.tsx` - Added INDEX option, cleaned imports
- `src/components/playground/visualizations/DimensionReductionChart.tsx` - Removed deprecated colorConfig prop
- `src/components/playground/visualizations/chartConfig.ts` - Removed deprecated types
- `src/components/playground/visualizations/index.ts` - Removed PCAPlot export
- `src/components/playground/hooks/index.ts` - Removed useColorMode export
- `src/components/playground/index.ts` - Updated exports
- `src/types/spectral.ts` - Removed unused ColorMode/ColorConfig types

**Files Deleted**:
- `src/components/playground/ColorModeSelector.tsx`
- `src/components/playground/visualizations/PCAPlot.tsx`
- `src/components/playground/hooks/useColorMode.ts`
- `src/lib/colorUtils.ts`

**Issues Resolved**:
- Outlier overlay now applies in all modes (red stroke when showOutlierOverlay=true)
- Consolidated to single ColorModeSelector in CanvasToolbar
- All deprecated types removed from codebase
- Dead code cleaned up (colorUtils.ts, useColorMode.ts, PCAPlot.tsx)

---

## Phase 4: Display Filtering System

**Priority**: MEDIUM-HIGH
**Estimated Effort**: 2 days
**Goal**: Implement comprehensive sample filtering
**Dependencies**: Phase 3 (for INDEX mode filtering)

### Current State

**Existing Filter Components** (not previously documented):
- [PartitionSelector.tsx](../src/components/playground/PartitionSelector.tsx) (386 lines) - Partition filter
- [OutlierSelector.tsx](../src/components/playground/OutlierSelector.tsx) (501 lines) - Outlier detection with multiple methods
- [MetricsFilterPanel.tsx](../src/components/playground/MetricsFilterPanel.tsx) (733 lines) - Metric-based filtering
- [SimilarityFilter.tsx](../src/components/playground/SimilarityFilter.tsx) - Distance-based similarity
- [SelectionFilters.tsx](../src/components/playground/SelectionFilters.tsx) (341 lines) - Selection-based filtering

**Current Capabilities**:
- Partition filter exists (All, Train, Test, Specific Fold)
- Applied via `getPartitionIndices()` function
- Used in MainCanvas and CanvasToolbar

**Missing**:
- **Unified FilterContext** to coordinate all filters
- Outlier filter as display filter (not just detection)
- Selection filter (All, Selected Only, Unselected Only)
- Filter combination with AND logic

### Tasks

| ID | Task | Component | Notes |
|----|------|-----------|-------|
| 4.1 | **Create FilterContext** | New: `context/FilterContext.tsx` | Centralized filtering state |
| 4.2 | **Integrate PartitionSelector** | FilterContext | Move partition state to context |
| 4.3 | **Extend OutlierSelector for display filtering** | OutlierSelector.tsx | Add "Hide Outliers" / "Outliers Only" modes |
| 4.4 | **Add Selection Filter** | FilterToolbar or SelectionFilters | Dropdown: All / Selected Only / Unselected Only |
| 4.5 | **Add Metadata Filter** | MetricsFilterPanel or new | Column picker + value multi-select |
| 4.6 | **Apply filters to charts** | All visualizations | Use filtered indices from context |
| 4.7 | **Filter badge** | Toolbar | Badge showing active filter count |
| 4.8 | **Clear all filters button** | Toolbar | Quick reset |

### FilterContext Design

```typescript
interface FilterState {
  partition: PartitionFilter;  // Existing
  outlier: 'all' | 'hide' | 'only';
  selection: 'all' | 'selected' | 'unselected';
  metadata: {
    column: string | null;
    values: Set<unknown>;
  } | null;
}

interface FilterContextValue {
  filters: FilterState;
  setPartitionFilter: (f: PartitionFilter) => void;
  setOutlierFilter: (f: 'all' | 'hide' | 'only') => void;
  setSelectionFilter: (f: 'all' | 'selected' | 'unselected') => void;
  setMetadataFilter: (column: string | null, values: Set<unknown>) => void;
  clearAllFilters: () => void;

  // Computed
  activeFilterCount: number;
  getFilteredIndices: (allIndices: number[], context: FilterContext) => number[];
}
```

### Filter Combination Logic

Filters combine with AND logic:
```typescript
function getFilteredIndices(allIndices: number[], context: FilterContext): number[] {
  return allIndices
    .filter(i => applyPartitionFilter(i, filters.partition, context))
    .filter(i => applyOutlierFilter(i, filters.outlier, context))
    .filter(i => applySelectionFilter(i, filters.selection, context))
    .filter(i => applyMetadataFilter(i, filters.metadata, context));
}
```

### Success Criteria

- [x] FilterContext created and provided in Playground
- [x] Can hide outliers from all views
- [x] Can show only selected samples
- [ ] Can filter by metadata column + specific values *(deferred - needs MetadataFilter UI)*
- [x] Filter badge shows count of active filters (e.g., "2 filters")
- [x] Clear all filters button resets to defaults
- [x] All charts respect active filters
- [x] **Existing filter components integrated** (not duplicated) *(new)*

---

## Phase 4 Review

### Reviewed: January 8, 2026

**Status**: COMPLETED

**Implementation Summary**:
- Created `FilterContext` (`src/context/FilterContext.tsx`) with:
  - Partition filter (All/Train/Test/Fold) - integrated with existing PartitionSelector
  - Outlier filter (All/Hide Outliers/Outliers Only)
  - Selection filter (All/Selected Only/Unselected Only)
  - Metadata filter interface (ready for UI)
  - AND logic for combining filters
  - Active filter count and clear all functionality
- Created `DisplayFilters` component (`src/components/playground/DisplayFilters.tsx`):
  - Compact toolbar controls for outlier and selection filtering
  - Filter badge showing active count
  - Clear all button with tooltip
- Updated `colorConfig.ts`:
  - Added `displayFilteredIndices` to `ColorContext`
  - Added `hidden` property to `ColorResult`
  - `getUnifiedSampleColor` returns hidden=true for filtered samples
- Updated charts to respect display filtering:
  - `SpectraChartV2` - filters displayIndices
  - `YHistogramV2` - filters bins and stats computation
  - `DimensionReductionChart` - hides filtered cells
- Integrated FilterProvider in Playground.tsx

**Files Created**:
- `src/context/FilterContext.tsx` - Centralized filter state management
- `src/components/playground/DisplayFilters.tsx` - Filter toolbar controls

**Files Modified**:
- `src/pages/Playground.tsx` - Added FilterProvider wrapper
- `src/components/playground/MainCanvas.tsx` - Uses FilterContext, builds filterDataContext
- `src/components/playground/CanvasToolbar.tsx` - Added DisplayFilters, outlierCount prop
- `src/components/playground/index.ts` - Export DisplayFilters
- `src/lib/playground/colorConfig.ts` - Added displayFilteredIndices, hidden property
- `src/components/playground/visualizations/SpectraChartV2.tsx` - Filter by displayFilteredIndices
- `src/components/playground/visualizations/YHistogramV2.tsx` - Filter bins/stats
- `src/components/playground/visualizations/DimensionReductionChart.tsx` - Hide filtered cells

**Deferred**:
- Metadata filter UI (MetadataFilter component) - backend support exists, needs UI

---

## Phase 5: Classification Mode Support ✅ COMPLETED

**Priority**: MEDIUM
**Estimated Effort**: 3-4 days
**Actual Effort**: Completed January 8, 2026
**Goal**: Support classification datasets alongside regression
**Dependencies**: Phase 3 (for categorical colormap), Phase 4 (for class filtering)

### Implementation Summary

Classification mode support has been fully implemented with the following features:

1. **Target Type Detection** (`src/lib/playground/targetTypeDetection.ts`)
   - Automatic detection of regression, classification, and ordinal targets
   - Edge case handling: percentages, boolean-like values, small datasets
   - Confidence scoring and override suggestions

2. **ColorContext Integration** (`src/lib/playground/colorConfig.ts`)
   - Added `targetType`, `classLabels`, `classLabelMap` to ColorContext
   - Added `targetTypeOverride` to GlobalColorConfig for manual override
   - Updated `isContinuousMode()` and `getBaseColor()` for classification support

3. **Component Updates**:
   - **YHistogramV2**: Classification histogram with discrete class bars
   - **ColorLegend**: Class-based swatches with proper labels
   - **FoldDistributionChartV2**: Stack by class within partitions
   - **CanvasToolbar**: Target type override UI in palette dropdown
   - **DimensionReductionChart**: Automatic class coloring via unified system

### Tasks

| ID | Task | Component | Status |
|----|------|-----------|--------|
| 5.1 | **Create target type detection** | targetTypeDetection.ts | ✅ |
| 5.2 | **Add targetType to ColorContext** | colorConfig.ts | ✅ |
| 5.3 | **Store class labels** | ColorContext | ✅ |
| 5.4 | **Classification histogram mode** | YHistogramV2 | ✅ |
| 5.5 | **Auto-select qualitative colormap** | colorConfig | ✅ |
| 5.6 | **Class-based color legend** | ColorLegend | ✅ |
| 5.7 | **Update DimensionReductionChart** | DimensionReductionChart | ✅ |
| 5.8 | **Update FoldDistributionChart** | FoldDistributionChartV2 | ✅ |
| 5.9 | **Manual override toggle** | CanvasToolbar | ✅ |
| 5.10 | **Handle edge cases** | targetTypeDetection | ✅ |

### Target Type Detection

```typescript
// New utility: src/lib/playground/targetTypeDetection.ts

interface TargetTypeResult {
  type: 'regression' | 'classification' | 'ordinal';
  confidence: 'high' | 'medium' | 'low';
  classLabels?: string[];  // For classification
  classCount?: number;     // For classification
  suggestedOverride?: string;  // Hint for manual override
}

function detectTargetType(yValues: (number | string)[]): TargetTypeResult {
  const uniqueValues = [...new Set(yValues)];

  // String values = definitely classification
  if (typeof yValues[0] === 'string') {
    return {
      type: 'classification',
      confidence: 'high',
      classLabels: uniqueValues as string[],
      classCount: uniqueValues.length,
    };
  }

  // Check for binary values (0/1) - could be classification OR percentage
  if (uniqueValues.length === 2) {
    const sorted = (uniqueValues as number[]).sort();
    if (sorted[0] === 0 && sorted[1] === 1) {
      return {
        type: 'classification',
        confidence: 'medium',
        classLabels: ['0', '1'],
        classCount: 2,
        suggestedOverride: 'Values are 0/1 - could be binary classification or percentage. Override if needed.',
      };
    }
  }

  // Ordinal detection: integers 1-5 or 1-10 scale
  const allIntegers = (uniqueValues as number[]).every(v => Number.isInteger(v));
  const min = Math.min(...(uniqueValues as number[]));
  const max = Math.max(...(uniqueValues as number[]));
  if (allIntegers && min >= 0 && max <= 10 && uniqueValues.length <= 11) {
    return {
      type: 'ordinal',
      confidence: uniqueValues.length <= 5 ? 'high' : 'medium',
      classLabels: uniqueValues.map(String).sort((a, b) => Number(a) - Number(b)),
      classCount: uniqueValues.length,
      suggestedOverride: 'Values look like a rating scale. Treating as ordinal.',
    };
  }

  // Few unique numeric values = likely classification
  if (uniqueValues.length <= 10) {
    return {
      type: 'classification',
      confidence: uniqueValues.length <= 5 ? 'high' : 'medium',
      classLabels: uniqueValues.map(String),
      classCount: uniqueValues.length,
    };
  }

  // Many unique values = regression
  return { type: 'regression', confidence: 'high' };
}
```

### YHistogramV2 Classification Mode

```typescript
// When targetType === 'classification':
// - Render one bar per class (not binned histogram)
// - Each bar colored by class color from categorical palette
// - X-axis shows class labels
// - Y-axis shows count or proportion
```

### Success Criteria

- [ ] Target type auto-detected on dataset load
- [ ] Classification datasets show discrete class bars in histogram
- [ ] Qualitative colormap applied automatically for classification
- [ ] Legend shows class names with color swatches
- [ ] PCA/UMAP points colored by class
- [ ] User can manually override detected target type
- [ ] All views adapt correctly to classification mode
- [ ] **Edge cases handled** (binary, ordinal, percentages) *(new)*

---

## Phase 5 Review

### Reviewed: January 8, 2026

**Status**: Not Started

**Issues Found**:
- No target type detection exists
- YHistogramV2 hardcoded for continuous binning
- No class labels support
- **Edge cases not considered** (binary regression, ordinal, percentages)

**Decisions Made**:
- Auto-detect with confidence level
- Allow manual override
- Store classLabels in context for use across charts
- Add ordinal type for rating scales
- Include suggested override hints

---

## Phase 6: Dataset Reference Mode

**Priority**: MEDIUM
**Estimated Effort**: 5-7 days *(revised from 4-5 days - backend investigation needed)*
**Goal**: Enable comparison between two different datasets
**Dependencies**: Phase 1 (selection), Phase 3 (coloration), Phase 5 (classification for class comparison)

### Current State

**Step Reference Mode exists** - [CanvasToolbar.tsx](../src/components/playground/CanvasToolbar.tsx#L134-L137):
```typescript
stepComparisonEnabled: boolean;
onStepComparisonEnabledChange?: (enabled: boolean) => void;
activeStep: number;
onActiveStepChange?: (step: number) => void;
```

This allows comparing raw data (step 0) vs processed data (step N).

**Dataset Reference Mode is completely missing**:
- Cannot compare two different datasets through the same pipeline
- No UI to select a reference dataset
- No reference mode toggle

### Use Cases for Dataset Reference Mode

1. **Calibration Transfer**: Compare spectra from two instruments
2. **Batch Effects**: Compare acquisitions from different dates
3. **Quality Control**: Compare new batch against reference batch
4. **Before/After**: Compare samples before and after treatment

### Backend Investigation Required

Before implementing, investigate:
- [ ] API endpoint to load second dataset needed?
- [ ] Pipeline execution for both datasets - parallel or sequential?
- [ ] Memory management for two full datasets in browser
- [ ] How to handle large datasets (>5000 samples each)?

### Tasks

| ID | Task | Component | Notes |
|----|------|-----------|-------|
| 6.0 | **Backend investigation** | API/Architecture | Determine API requirements |
| 6.1 | **Add ReferenceMode type** | New types | `'step' \| 'dataset'` |
| 6.2 | **Add Reference Mode toggle** | CanvasToolbar | Switch between Step/Dataset reference |
| 6.3 | **Create Reference Dataset picker** | CanvasToolbar | Dropdown to select compatible dataset |
| 6.4 | **Store reference dataset in context** | PlaygroundContext | `referenceDataset: ProcessedData \| null` |
| 6.5 | **Load and process reference dataset** | usePlaygroundPipeline | Run through same pipeline on selection |
| 6.6 | **Dual dataset rendering in Spectra** | SpectraChartV2 | Visual distinction (solid vs dashed) |
| 6.7 | **Dual dataset in PCA/UMAP** | DimensionReductionChart | Different markers or shapes per dataset |
| 6.8 | **Default coloration for reference** | colorConfig | INDEX or neutral gradient |
| 6.9 | **Disable step slider in Dataset mode** | CanvasToolbar | Reference comes from other dataset |
| 6.10 | **Dataset labels in legend** | ColorLegend | "Primary" vs "Reference" indicators |
| 6.11 | **Implement sample alignment** | New utility | Options: by index, by ID column, by nearest neighbor |

### Sample Alignment Strategy

```typescript
type AlignmentMode = 'index' | 'id_column' | 'nearest_neighbor';

interface AlignmentResult {
  primaryIndices: number[];
  referenceIndices: number[];
  unmatchedPrimary: number[];
  unmatchedReference: number[];
  warnings: string[];
}

function alignDatasets(
  primary: RawData,
  reference: RawData,
  mode: AlignmentMode,
  idColumn?: string
): AlignmentResult {
  switch (mode) {
    case 'index':
      // Simple 1:1 by position (truncate longer dataset)
      break;
    case 'id_column':
      // Match by sample ID column
      break;
    case 'nearest_neighbor':
      // Match by spectral similarity
      break;
  }
}
```

### Compatibility Check

```typescript
interface DatasetCompatibility {
  compatible: boolean;
  warnings: string[];
}

function checkDatasetCompatibility(primary: RawData, reference: RawData): DatasetCompatibility {
  const warnings: string[] = [];

  // Required: same number of features
  if (primary.wavelengths.length !== reference.wavelengths.length) {
    return { compatible: false, warnings: ['Different number of features'] };
  }

  // Warning: wavelength mismatch
  const wlMismatch = primary.wavelengths.some((w, i) =>
    Math.abs(w - reference.wavelengths[i]) > 0.1
  );
  if (wlMismatch) {
    warnings.push('Wavelength values differ - spectra may not align correctly');
  }

  // Warning: different sample counts
  if (primary.spectra.length !== reference.spectra.length) {
    warnings.push(`Different sample counts (${primary.spectra.length} vs ${reference.spectra.length})`);
  }

  return { compatible: true, warnings };
}
```

### Reference Mode UI

```
┌─────────────────────────────────────────────────────────────────┐
│ Reference Mode: [Step ▼] [Dataset ▼]                            │
│                                                                 │
│ When Step mode:                                                 │
│   [Raw Data ──────○─────────── Processed] Step slider           │
│                                                                 │
│ When Dataset mode:                                              │
│   Reference: [Select dataset... ▼]  [⚠️ Warning badge]          │
│   Alignment: [By Index ▼]                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Visual Distinction in Charts

| Chart | Primary Dataset | Reference Dataset |
|-------|-----------------|-------------------|
| Spectra | Solid lines | Dashed lines (or lower opacity) |
| PCA/UMAP | Circle markers | Triangle markers |
| Histogram | Filled bars | Outlined bars |

### Success Criteria

- [ ] **Backend requirements documented** *(new)*
- [ ] Can toggle between Step and Dataset reference modes
- [ ] Can select another dataset as reference
- [ ] Compatibility check runs on selection
- [ ] Warnings displayed for wavelength mismatch
- [ ] Both datasets rendered in all views with clear distinction
- [ ] Pipeline applies to both datasets
- [ ] Step slider disabled in Dataset reference mode
- [ ] **Sample alignment strategy works** *(new)*

---

## Phase 6 Review

### Reviewed: January 8, 2026

**Status**: Not Started

**Issues Found**:
- Step comparison exists and works
- Dataset reference mode is entirely missing
- Need to handle incompatible datasets gracefully
- **Backend requirements not investigated**
- **Sample alignment not considered**

**Decisions Made**:
- Add reference mode toggle to toolbar
- Visual distinction via line style (solid/dashed) and marker shape (circle/triangle)
- Show warnings but allow comparison even with minor mismatches
- **Investigate backend first** (Task 6.0)
- Add sample alignment options

---

## Phase 7: Differences Chart Enhancements

**Priority**: MEDIUM
**Estimated Effort**: 1-2 days (reduced - base exists)
**Goal**: Enhance the Differences Chart view and make it a standalone toggleable view
**Dependencies**: Phase 6 (for dataset reference comparison)

### Current State

**Differences mode EXISTS** in SpectraChartV2!

**Code Location**: [SpectraChartV2.tsx](../src/components/playground/visualizations/SpectraChartV2.tsx#L194-L206)

```typescript
case 'difference': {
  // Compute difference between processed and original
  if (processed.spectra.length !== original.spectra.length) {
    return { spectra: processed.spectra, wavelengths: processed.wavelengths };
  }
  const diffSpectra = processed.spectra.map((proc, idx) => {
    const orig = original.spectra[idx];
    if (!orig || proc.length !== orig.length) return proc;
    return proc.map((v, i) => v - orig[i]);
  });
  return { spectra: diffSpectra, wavelengths: processed.wavelengths };
}
```

Also available in toolbar: [SpectraChartToolbar.tsx](../src/components/playground/visualizations/SpectraChartToolbar.tsx#L103)

**What's missing**:
- Dedicated toggle in global view controls
- Heatmap mode for differences
- Wavelength region highlighting

**Spec Inconsistency**: The specification mentions Differences Chart as a separate view with its own toggle, but the current implementation (and this roadmap) keeps it as a mode within SpectraChartV2. This is a pragmatic decision - document it clearly.

### Revised Scope

Since difference mode exists within SpectraChartV2, the question is:
1. **Option A**: Keep it as a view mode within Spectra Chart (current) - **RECOMMENDED**
2. **Option B**: Create a dedicated DifferencesChart component (per spec)

**Decision**: Option A is sufficient for most use cases. The spec's separate view can be achieved by making the mode switch more prominent.

### Tasks

| ID | Task | Component | Notes |
|----|------|-----------|-------|
| 7.1 | **Add Differences quick-toggle to toolbar** | CanvasToolbar | Prominent button to enable difference view in Spectra |
| 7.2 | **Add heatmap display mode** | SpectraChartV2 | X=wavelength, Y=sample, color=difference magnitude |
| 7.3 | **Highlight large differences** | SpectraChartV2 | Color-code regions with high mean absolute difference |
| 7.4 | **Add difference statistics** | Footer | Show mean, max, std of differences |
| 7.5 | **Absolute difference toggle** | Toolbar | Switch between signed and absolute differences |
| 7.6 | **Document spec deviation** | PLAYGROUND_SPECIFICATION.md | Note that Differences is a mode, not separate view |

### Optional: Standalone Differences Chart

If needed later, create as separate component:

```typescript
// DifferencesChart.tsx
interface DifferencesChartProps {
  referenceSpectra: number[][];
  finalSpectra: number[][];
  wavelengths: number[];
  displayMode: 'lines' | 'mean-std' | 'heatmap';
  showAbsolute: boolean;
}
```

### Success Criteria

- [ ] Can quickly toggle difference view from global controls
- [ ] Heatmap mode shows difference intensity across wavelengths
- [ ] Large difference regions highlighted
- [ ] Statistics shown (mean absolute difference, max, etc.)
- [ ] Toggle between signed and absolute differences
- [ ] **Spec deviation documented** *(new)*

---

## Phase 7 Review

### Reviewed: January 8, 2026

**Status**: Not Started

**Issues Found**:
- Difference mode already exists in SpectraChartV2!
- Just needs better accessibility and enhancements
- **Spec says separate view, but mode within Spectra is more practical**

**Decisions Made**:
- Keep difference as view mode in SpectraChartV2 (not separate component)
- Add quick toggle in global toolbar
- Add heatmap mode and statistics
- Document spec deviation

---

## Phase 8: Global Actions & Export Enhancements

**Priority**: MEDIUM
**Estimated Effort**: 2-3 days *(revised from 2 days)*
**Goal**: Complete global action buttons and export capabilities
**Dependencies**: Phase 1 (selection for export), Phase 4 (filtering for meaningful exports)

### Current State

**Export system is comprehensive** - [export.ts](../src/lib/playground/export.ts):
- PNG, SVG, CSV, TXT, JSON export all implemented
- Batch export for all visible charts
- Quality and scale options

**Missing**:
- Global "Reset View" action (reset all state)
- Combined report export (single PDF/PNG with all views)
- Mark as Outliers (Ctrl+O) not implemented

### Tasks

| ID | Task | Component | Notes |
|----|------|-----------|-------|
| 8.1 | **Create resetPlayground function** | PlaygroundContext or hook | Clears all state in one action |
| 8.2 | **Add Reset View button** | Toolbar | Calls resetPlayground |
| 8.3 | **Combined report export** | export.ts | Canvas-based composition (client-side) |
| 8.4 | **Mark as Outliers action** | SelectionContext | Ctrl+O marks selected as outliers |
| 8.5 | **Outlier storage** | Context | Persist outlier flags per session |
| 8.6 | **Export with outlier column** | export.ts | Add `is_outlier` column to CSV |
| 8.7 | **Confirm dialog for Reset** | UI | Prevent accidental reset |

### Combined Report Export Strategy

**Decision**: Use Canvas-based composition (client-side)
- Pros: No server dependency, works offline, fast
- Cons: Complex layout code, limited to PNG output
- Alternative considered: Server-side PDF (rejected - adds API dependency)

```typescript
async function exportCombinedReport(
  chartRefs: Record<string, HTMLElement>,
  options: ReportExportOptions
): Promise<Blob> {
  // 1. Create canvas with report dimensions
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // 2. Render header (dataset name, date)
  // 3. Render each chart into grid positions
  // 4. Render footer (pipeline, statistics)
  // 5. Return as PNG blob
}
```

### Reset View Behavior

```typescript
function resetPlayground() {
  // Selection
  selectionContext.clear();        // Clear selection
  selectionContext.clearPins();    // Clear pins

  // Filters
  filterContext?.clearAllFilters();

  // Chart state
  setPartitionFilter({ type: 'all' });
  setBrushDomain(null);            // Reset zoom
  setActiveStep(0);                // Reset step comparison

  // Coloration
  setGlobalColorConfig(DEFAULT_GLOBAL_COLOR_CONFIG);
}
```

### Mark as Outliers

```typescript
// In usePlaygroundShortcuts.ts
{
  key: 'Ctrl+O',
  action: () => {
    if (selectedSamples.size > 0) {
      markAsOutliers(selectedSamples);
      toast.success(`${selectedSamples.size} samples marked as outliers`);
    }
  },
  description: 'Mark selected samples as outliers',
}
```

### Combined Report Layout

```
┌───────────────────────────────────────┐
│  Dataset: sample_data/regression      │
│  Date: 2026-01-08 14:30              │
├───────────────┬───────────────────────┤
│               │                       │
│   Spectra     │      PCA/UMAP        │
│               │                       │
├───────────────┼───────────────────────┤
│               │                       │
│  Histogram    │     Partitions       │
│               │                       │
├───────────────┴───────────────────────┤
│ Pipeline: SNV → Detrend → PLS(10)     │
│ Statistics: N=500, Y range: 2.1-8.4   │
└───────────────────────────────────────┘
```

### Success Criteria

- [ ] Reset View button in toolbar (with confirmation)
- [ ] Reset clears selection, pins, filters, zoom, coloration
- [ ] Combined report export creates single image with all views
- [ ] Ctrl+O marks selected samples as outliers
- [ ] Outlier status persists within session
- [ ] CSV export includes `is_outlier` column
- [ ] **Canvas-based report composition works** *(new)*

---

## Phase 8 Review

### Reviewed: January 8, 2026

**Status**: Not Started

**Issues Found**:
- Export system well-implemented
- No global reset action exists
- Mark as Outliers not wired up
- **Combined report rendering approach not specified**

**Decisions Made**:
- Create resetPlayground function that clears all state
- Add confirmation dialog before reset
- Store outlier flags in context, include in exports
- **Use canvas-based client-side composition** for combined report

---

## Phase 9: Area Selection Enhancements

**Priority**: LOW-MEDIUM
**Estimated Effort**: 1-2 days *(revised from 2 days - much exists)*
**Goal**: Improve area selection across all views
**Dependencies**: Phase 1 (selection system must work first)

### Current State

**Substantial selection code already exists**:

**Box/Lasso selection for PCA** - [EmbeddingSelector.tsx](../src/components/playground/EmbeddingSelector.tsx):
- `SelectionMode = 'none' | 'box' | 'lasso'`
- Box selection with drag rectangle
- Lasso selection with freeform polygon
- `pointInPolygon` helper for lasso hit-testing
- Toolbar buttons to toggle selection mode

**SelectionTools.tsx** (624 lines) - Not previously documented:
- Contains substantial selection functionality
- Review before implementing new code

**Missing in other charts**:
- Spectra: Rectangle selection for spectra passing through region
- Range selection (Shift+Click from A to B)

### Tasks

| ID | Task | Component | Notes |
|----|------|-----------|-------|
| 9.0 | **Review SelectionTools.tsx** | SelectionTools.tsx | Understand existing functionality before adding new |
| 9.1 | **Verify box/lasso in EmbeddingSelector** | EmbeddingSelector | Test it works with SelectionContext |
| 9.2 | **Verify histogram bar click** | YHistogramV2 | Test bar click selects bin samples |
| 9.3 | **Add rectangle selection to Spectra** | SpectraChartV2 | Drag to select spectra in region |
| 9.4 | **Range selection (Shift+Click)** | SelectionContext | Track lastSelected, select range |
| 9.5 | **Selection mode indicator** | UI | Show current selection mode in toolbar |
| 9.6 | **Unified selection mode toggle** | Toolbar | Box/Lasso/Click for all applicable views |

### Range Selection Implementation

```typescript
// In SelectionContext
interface SelectionContextValue {
  // ...existing
  lastSelected: number | null;
  selectRange: (from: number, to: number) => void;
}

function handleSelection(indices: number[], event: MouseEvent) {
  if (event.shiftKey && lastSelected !== null) {
    // Select range from lastSelected to indices[0]
    const start = Math.min(lastSelected, indices[0]);
    const end = Math.max(lastSelected, indices[0]);
    const range = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    select(range, 'add');
  } else if (event.ctrlKey || event.metaKey) {
    toggle(indices);
  } else {
    select(indices, 'replace');
    setLastSelected(indices[0]);
  }
}
```

### Spectra Rectangle Selection

```typescript
// Drag rectangle on Spectra chart
// Select all spectra that pass through the rectangle (X-range AND Y-range)
function getSpectraInRectangle(
  spectra: number[][],
  wavelengths: number[],
  rect: { x1: number; x2: number; y1: number; y2: number }
): number[] {
  return spectra
    .map((spectrum, idx) => {
      // Check if any point of this spectrum is inside the rectangle
      const hasPointInRect = wavelengths.some((wl, wi) => {
        const y = spectrum[wi];
        return wl >= rect.x1 && wl <= rect.x2 && y >= rect.y1 && y <= rect.y2;
      });
      return hasPointInRect ? idx : -1;
    })
    .filter(idx => idx >= 0);
}
```

### Success Criteria

- [ ] **SelectionTools.tsx reviewed and documented** *(new)*
- [ ] Box selection works in EmbeddingSelector (PCA/UMAP)
- [ ] Lasso selection works in EmbeddingSelector
- [ ] Histogram bar click selects all samples in that bin
- [ ] Shift+Click selects range from last selection
- [ ] Rectangle selection in Spectra chart
- [ ] Selection mode clearly indicated in UI

---

## Phase 9 Review

### Reviewed: January 8, 2026

**Status**: Not Started

**Issues Found**:
- Box/Lasso selection code exists in EmbeddingSelector
- Need to verify it works with SelectionContext
- Spectra rectangle selection not implemented
- **SelectionTools.tsx (624 lines) not reviewed**

**Decisions Made**:
- **Review existing SelectionTools.tsx first**
- Reuse EmbeddingSelector pattern for other charts
- Add range selection via Shift+Click
- Add rectangle selection to Spectra chart

---

## Phase 10: Polish & Performance

**Priority**: LOW
**Estimated Effort**: 3-4 days *(revised from 2-3 days - includes baseline measurement)*
**Goal**: Final polish, performance optimization, UX improvements
**Dependencies**: All previous phases

### Tasks

| ID | Task | Component | Notes |
|----|------|-----------|-------|
| 10.0 | **Establish performance baselines** | Profiling | Measure current metrics before optimization |
| 10.1 | **Evaluate CSS-only resize first** | Layout | Test `:resizable` before adding react-resizable-panels |
| 10.2 | **Draggable dividers (if needed)** | Layout | Use react-resizable-panels only if CSS insufficient |
| 10.3 | **Undo/redo for selection** | SelectionContext | Already has history, verify it works |
| 10.4 | **Keyboard shortcuts help modal** | KeyboardShortcutsHelp | Already exists, verify completeness |
| 10.5 | **WebGL visual parity check** | SpectraWebGL vs SpectraChartV2 | Ensure identical rendering |
| 10.6 | **Large dataset performance test** | All charts | Test with 5000+ samples |
| 10.7 | **Loading states/skeletons** | All views | Show loading indicators |
| 10.8 | **Error boundaries** | All views | ChartErrorBoundary already exists, verify coverage |
| 10.9 | **Tooltips for all controls** | UI | Contextual help on hover |
| 10.10 | **Accessibility audit** | All UI | Keyboard navigation, ARIA labels |
| 10.11 | **Memory leak check** | All components | Verify cleanup on unmount |

### Performance Baselines (Task 10.0)

Measure BEFORE optimization:
```typescript
interface PerformanceBaseline {
  metric: string;
  current: number;
  target: number;
  unit: string;
}

const baselines: PerformanceBaseline[] = [
  { metric: 'Initial render (500 samples)', current: 0, target: 500, unit: 'ms' },
  { metric: 'Initial render (5000 samples)', current: 0, target: 2000, unit: 'ms' },
  { metric: 'Selection response', current: 0, target: 100, unit: 'ms' },
  { metric: 'Chart zoom/pan', current: 0, target: 16, unit: 'ms (60fps)' },
  { metric: 'WebGL toggle', current: 0, target: 200, unit: 'ms' },
];
```

### Performance Targets

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Initial render (500 samples) | <500ms | TBD | |
| Initial render (5000 samples) | <2s | TBD | |
| Selection response | <100ms | TBD | |
| Chart zoom/pan | 60fps | TBD | |
| WebGL toggle | <200ms | TBD | |

### Draggable Dividers Evaluation

**Step 1**: Test CSS-only approach:
```css
.chart-panel {
  resize: both;
  overflow: auto;
  min-width: 200px;
  min-height: 150px;
}
```

**Step 2**: Only if CSS insufficient, use `react-resizable-panels`:
- Check bundle size impact (~15KB gzipped)
- Verify compatibility with current CSS grid
- Plan migration strategy

```tsx
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

<PanelGroup direction="horizontal">
  <Panel defaultSize={50}>
    <SpectraChart />
  </Panel>
  <PanelResizeHandle />
  <Panel defaultSize={50}>
    <PCAChart />
  </Panel>
</PanelGroup>
```

### Error Boundary per View

**Note**: ChartErrorBoundary already exists in ChartPanel. Verify it's used consistently:

```tsx
<ChartPanel title="Spectra">
  <ErrorBoundary fallback={<ChartErrorFallback />}>
    <SpectraChartV2 {...props} />
  </ErrorBoundary>
</ChartPanel>
```

### Success Criteria

- [ ] **Performance baselines established and documented** *(new)*
- [ ] Can resize views (CSS or library)
- [ ] Undo/redo works for selection (Ctrl+Z/Ctrl+Y)
- [ ] Keyboard shortcuts modal shows all available shortcuts
- [ ] WebGL and Canvas render identically
- [ ] No perceptible lag with 5000 samples
- [ ] Loading indicators show during computation
- [ ] One chart error doesn't crash entire playground
- [ ] All controls have helpful tooltips

---

## Phase 10 Review

### Reviewed: January 8, 2026

**Status**: Not Started

**Issues Found**:
- **No baseline measurements exist**
- ChartErrorBoundary exists but usage not verified
- react-resizable-panels impact not evaluated

**Decisions Made**:
- Measure baselines FIRST
- Try CSS-only resize before adding dependencies
- Verify existing error boundary coverage

---

## Summary

### Phase Dependencies (Revised)

```
Phase 1 (Selection) ──┬──> Phase 3 (Coloration - visual feedback)
                      ├──> Phase 8 (Global Actions - partial)
                      └──> Phase 9 (Area Selection)

Phase 2 (Layout) ─────> Independent

Phase 3 (Coloration) ──┬──> Phase 4 (Filtering - INDEX mode)
                       └──> Phase 5 (Classification - colormap auto-select)

Phase 4 (Filtering) ──> Phase 8 (Export - meaningful exports)

Phase 5 (Classification) ──> Phase 6 (Dataset Reference - class comparison)

Phase 6 (Dataset Ref) ──> Phase 7 (Differences - uses reference)

Phase 7 (Differences) ──> Depends on Phase 6

Phase 8 (Export) ──> Depends on Phase 1, 4

Phase 9 (Area Select) ──> Depends on Phase 1

Phase 10 (Polish) ──> All above
```

### Recommended Execution Order

1. **Phase 1**: Selection System Fix (CRITICAL - blocks many other phases)
2. **Phase 2**: Layout & View Management (can parallel with Phase 1)
3. **Phase 3**: Coloration Features (needs Phase 1 for visual feedback)
4. **Phase 4**: Display Filtering (needs Phase 3 for INDEX mode)
5. **Phase 5**: Classification Mode
6. **Phase 8**: Global Actions & Export (needs Phase 1 + 4)
7. **Phase 6**: Dataset Reference Mode
8. **Phase 7**: Differences Chart Enhancements
9. **Phase 9**: Area Selection
10. **Phase 10**: Polish & Performance

### Effort Summary (Revised)

| Phase | Priority | Original | Revised | Reason |
|-------|----------|----------|---------|--------|
| 1. Selection Fix | CRITICAL | 3-5 days | **4-6 days** | Hover propagation adds work |
| 2. Layout | HIGH | 2-3 days | **1-2 days** | ChartPanel already exists |
| 3. Coloration | HIGH | 2 days | **2-3 days** | Type migration cleanup |
| 4. Filtering | MEDIUM-HIGH | 2 days | 2 days | OK if extending existing |
| 5. Classification | MEDIUM | 3-4 days | 3-4 days | OK |
| 6. Dataset Reference | MEDIUM | 4-5 days | **5-7 days** | Backend work likely needed |
| 7. Differences | MEDIUM | 1-2 days | 1-2 days | OK |
| 8. Global Actions | MEDIUM | 2 days | **2-3 days** | Combined report complexity |
| 9. Area Selection | LOW-MEDIUM | 2 days | **1-2 days** | Much already exists |
| 10. Polish | LOW | 2-3 days | **3-4 days** | Baseline measurements needed |

**Total Estimated Effort**: 26-37 days *(revised from 23-31 days)*

---

## Cross-Cutting Concerns

### Error Handling Strategy

Each phase should consider:
1. **Selection context unavailable**: Graceful degradation, show message
2. **Pipeline fails mid-comparison**: Show error in affected view only
3. **Reference dataset incompatible**: Clear error with resolution options
4. **WebGL unavailable**: Automatic fallback to Canvas mode

### Testing Strategy

| Phase | Test Type | Focus |
|-------|-----------|-------|
| 1 | Integration | Selection syncs across charts |
| 2 | Visual | Layout transitions are smooth |
| 3 | Unit | Color calculations correct |
| 4 | Integration | Filter combinations work |
| 5 | Unit | Target type detection accuracy |
| 6 | E2E | Full dataset comparison workflow |
| 7 | Visual | Difference display correct |
| 8 | Integration | Export produces valid files |
| 9 | E2E | Area selection across views |
| 10 | Performance | Meets targets |

### Documentation Updates Needed

After each phase:
- [ ] Update component JSDoc
- [ ] Update PLAYGROUND_SPECIFICATION.md if deviating
- [ ] Add to PLAYGROUND_DISCREPANCY_ANALYSIS.md changelog
- [ ] Update user guide (if exists)

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-08 | Initial roadmap created |
| 2026-01-08 | Phase 1-10 reviewed with code analysis |
| 2026-01-08 | Updated with specific code locations and implementation details |
| 2026-01-08 | **Post-review revision**: Integrated 12 hidden problems, corrected inconsistencies, revised estimates |
| 2026-01-08 | Added hover propagation to Phase 1 (tasks 1.8, 1.9) |
| 2026-01-08 | Corrected Phase 2 - ChartPanel exists, added PlaygroundViewContext |
| 2026-01-08 | Added type cleanup to Phase 3 (tasks 3.9, 3.10) |
| 2026-01-08 | Updated Phase 4 to reference existing filter components |
| 2026-01-08 | Added edge case handling to Phase 5 (task 5.10, ordinal type) |
| 2026-01-08 | Added backend investigation and sample alignment to Phase 6 |
| 2026-01-08 | Added spec deviation documentation to Phase 7 |
| 2026-01-08 | Specified canvas-based report composition in Phase 8 |
| 2026-01-08 | Added SelectionTools.tsx review to Phase 9 |
| 2026-01-08 | Added baseline measurement and CSS-only resize evaluation to Phase 10 |
| 2026-01-08 | Revised dependency graph and effort estimates |
| 2026-01-08 | Added cross-cutting concerns section |
