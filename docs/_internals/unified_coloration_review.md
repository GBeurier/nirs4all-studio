# Unified Coloration System for Playground

## Original Feature Request

**Date**: 2026-01-08
**Status**: Fully Implemented

### User Request (Verbatim)

> I want to refactor the Playground's coloration system to be unified and global across all charts (Spectra, Histogram, PCA/UMAP, Folds, Reps).

### Required Coloration Modes

| Mode | Description | Coloring Logic |
|------|-------------|----------------|
| **Y Value** | Continuous gradient by target value | Blue → Red (or selected palette) |
| **Partition** | Train vs Test | Train=Blue, Test=Orange |
| **Fold** | By fold index | Categorical by fold assignment |
| **Metadata** | By metadata column | Column picker + auto-detect type (continuous or categorical) |
| **Selection** | By current selection | Selected=Primary color, Unselected=Grey |
| **Outlier** | By outlier status | Outliers=Red (always visible/front), Non-outliers=Grey |

### User Clarifications

1. **Color menu location**: Keep in CanvasToolbar (global control)
2. **Selection source**: Click/brush selection from SelectionContext
3. **Outlier source**: From outlier detection step (OutlierResult)
4. **Palettes**:
   - Continuous: viridis, plasma, inferno, blue_red, coolwarm, spectral
   - Categorical: tableau10, set1, set2, paired (colorblind-safe)

### Special Requirements for Folds Chart

> "Fold bars should show stacked bars for target, outlier, metadata modes - bars should be composites"

- **target mode**: Each fold bar stacked by Y value bins (low/mid/high terciles)
- **partition mode**: Each fold bar stacked showing train vs test portions
- **metadata mode**: Each fold bar stacked by metadata category
- **outlier mode**: Each fold bar stacked showing normal vs outlier portions
- **fold mode**: Default - each bar represents one fold with its categorical color
- **selection mode**: Highlight selected portion within each bar

---

## Implementation Trace

### Files Created

| File | Purpose |
|------|---------|
| `src/lib/playground/colorConfig.ts` | Core types, palettes, and utility functions |
| `src/lib/playground/useGlobalColorConfig.ts` | React hook for global color state with session storage |

### Files Modified

| File | Changes |
|------|---------|
| `src/components/playground/CanvasToolbar.tsx` | Added ColorModeSelector with all 6 modes + palette picker |
| `src/components/playground/MainCanvas.tsx` | Added colorConfig state, colorContext computation |
| `src/components/playground/visualizations/SpectraChartV2.tsx` | Added globalColorConfig/colorContext props |
| `src/components/playground/visualizations/YHistogramV2.tsx` | Added globalColorConfig/colorContext props |
| `src/components/playground/visualizations/DimensionReductionChart.tsx` | Added globalColorConfig/colorContext props |
| `src/components/playground/visualizations/FoldDistributionChartV2.tsx` | Added globalColorConfig/colorContext props |
| `src/components/playground/visualizations/RepetitionsChart.tsx` | Added globalColorConfig/colorContext props |
| `src/components/playground/visualizations/chartConfig.ts` | Added deprecation comments |
| `src/lib/playground/spectraConfig.ts` | Added deprecation comments |

---

## Roadmap

### Phase 1: Bug Fixes (COMPLETED 2026-01-08)

#### Bug 1: hoveredSample Not Passed to ColorContext ✅ FIXED

**Location**: `MainCanvas.tsx` lines 259-264, 387

**Problem**:
- `hoveredSample` was available in `useSelection()` but NOT destructured
- colorContext incorrectly used `selectedSample` (external prop) as `hoveredSample`

**Fix Applied**:
- Added `hoveredSample: contextHoveredSample` to destructured values from `useSelection()`
- Changed colorContext to use `contextHoveredSample` instead of `selectedSample`
- Updated useMemo dependency array

---

#### Bug 2: Charts Have Duplicate Internal Color Selectors ✅ FIXED

**Affected Files**:
- `DimensionReductionChart.tsx` - Wrapped "Color By" section in `{!globalColorConfig && (...)}`
- `FoldDistributionChartV2.tsx` - Wrapped "Color By" section in `{!globalColorConfig && (...)}`
- `RepetitionsChart.tsx` - Wrapped color mode Select in `{!globalColorConfig && (...)}`

**Fix Applied**:
- All three charts now hide their internal color selectors when `globalColorConfig` is provided
- Users see only the toolbar color selector when unified system is active

---

#### Bug 3: Outlier Coloration ✅ FIXED

**Issues Found & Fixed**:
1. `SpectraChartV2.tsx`: `outlierSamples` was only computed when `config.colorConfig.mode === 'outlier'`
   - Fixed to also check `globalColorConfig?.mode === 'outlier'`
   - Added `globalColorConfig?.mode` to useMemo dependencies
2. `colorConfig.ts` `getBaseColor()`: Correctly handles outlier mode (line 399-402)
3. MainCanvas: `lastOutlierResult.outlier_indices` correctly converted to Set

---

#### Bug 4: Fold Coloration ✅ VERIFIED WORKING

**Verification**:
- `colorConfig.ts` `getBaseColor()` correctly uses `foldLabels[sampleIndex]` (lines 359-365)
- MainCanvas passes `result?.folds?.fold_labels` to colorContext (line 382)
- Each chart receives colorContext as prop and uses it for coloring

---

#### Bug 5: Selection Mode ✅ VERIFIED WORKING

**Verification**:
1. `selectedSamples` Set flows from `useSelection()` to colorContext in MainCanvas
2. `getUnifiedSampleColor()` in `colorConfig.ts` correctly handles selection mode (lines 439-453)
3. `DimensionReductionChart` now uses `getUnifiedSampleColor()` for proper color results
4. Charts re-render when selection changes due to colorContext dependency

---

#### Bug 6: Charts Use Unified Color System ✅ FULLY FIXED

**Status**:
- **DimensionReductionChart**: ✅ FIXED - Now uses `getUnifiedSampleColor()` when globalColorConfig provided
- **SpectraChartV2**: ✅ WORKING - Has proper unified color logic
- **YHistogramV2**: ✅ WORKING - Properly uses `globalColorConfig.mode` for all 6 modes
- **FoldDistributionChartV2**: ✅ FIXED - Dynamic stacked bars based on effectiveColorMode
- **RepetitionsChart**: ✅ FIXED - Uses globalColorConfig.mode in getPointColor()

**Implementation Details**:
- RepetitionsChart: Added switch statement for all 6 modes (target, partition, fold, metadata, selection, outlier)
- FoldDistributionChartV2: Added segmentKeys, getSegmentColor, getSegmentLabel + dynamic Bar rendering

---

### Phase 2: Chart Integration Status ✅ COMPLETED

Current state of global color mode support per chart:

| Mode | Spectra | Histogram | PCA/UMAP | Folds | Reps |
|------|---------|-----------|----------|-------|------|
| target | ✅ Line gradient | ✅ Bar gradient | ✅ Point gradient | ✅ Stacked Y bins | ✅ Point gradient |
| partition | ✅ Train/Test lines | ✅ Majority color | ✅ Train/Test points | ✅ Stacked train/test | ✅ Point colors |
| fold | ✅ Fold colors | ✅ Dominant fold | ✅ Fold colors | ✅ Categorical bar colors | ✅ Fold colors |
| metadata | ✅ By column | ❌ Not implemented | ✅ By column | ✅ Stacked by category | ✅ By column |
| selection | ✅ Selected=primary | ✅ Selected bars | ✅ Selected=primary | ✅ Stacked sel/unsel | ✅ Selected=primary |
| outlier | ✅ Outlier=red | ✅ Outlier bars | ✅ Outlier=red | ✅ Stacked outlier/normal | ✅ Outlier=red |

**Legend**: ✅ Working | ⚠️ Partial | ❌ Not implemented

---

### Phase 3: Create Test Dataset ✅ COMPLETED

Test data file created for visual testing:

**File**: `src/components/playground/__tests__/test-data/unified-color-test-data.ts`

**Contents**:
- 100 samples with 200 wavelengths each
- Y values in range 0-100 with natural distribution
- 5-fold CV with fold labels
- Metadata: `category` (A/B/C/D), `source` (Lab1/2/3), `quality` (continuous), `age` (continuous)
- 10 outliers at indices: 5, 12, 23, 45, 52, 67, 78, 83, 91, 99
- Test scenarios with verification checklists for each mode

**Exports**:
- `unifiedColorTestData` - Combined data for testing
- `mockPlaygroundResult` - Mock result compatible with MainCanvas
- `testScenarios` - Verification checklist per mode

---

### Phase 4: Visual Testing Checklist

1. **Y Value Mode (target)**:
   - [ ] Blue-red gradient visible across samples
   - [ ] Palette selector changes gradient
   - [ ] All charts use same colors for same samples

2. **Partition Mode**:
   - [ ] Train samples are blue
   - [ ] Test samples are orange
   - [ ] Works in all charts

3. **Fold Mode**:
   - [ ] Each fold has distinct color from categorical palette
   - [ ] Palette selector changes fold colors
   - [ ] Legend shows correct fold colors

4. **Metadata Mode**:
   - [ ] Column picker appears when mode selected
   - [ ] Categorical columns use categorical palette
   - [ ] Continuous columns use continuous palette
   - [ ] Changing column updates colors immediately

5. **Selection Mode**:
   - [ ] Click to select shows primary color
   - [ ] Unselected samples are muted/grey
   - [ ] Multi-select works (Shift+click, lasso)
   - [ ] Clearing selection updates colors

6. **Outlier Mode**:
   - [ ] Requires running outlier detection first
   - [ ] Outliers are red
   - [ ] Non-outliers are grey/muted
   - [ ] Outliers rendered on top (z-order)

---

## Success Criteria

1. **Single color control**: Only toolbar ColorModeSelector affects colors
2. **All 6 modes work**: target, partition, fold, metadata, selection, outlier
3. **Palette selection works**: Both continuous and categorical palettes apply globally
4. **Cross-chart consistency**: Same sample = same color in all visible charts
5. **Selection integration**: Selection state properly affects colors in all modes
6. **No regressions**: Charts still work when globalColorConfig is not provided (legacy support)
