# Playground Implementation Discrepancy Analysis

> **Date**: January 8, 2026
> **Revised**: January 2026 — Critical reassessment
> **Reference**: [PLAYGROUND_SPECIFICATION.md](./PLAYGROUND_SPECIFICATION.md) v1.0
> **Purpose**: Identify gaps between the specification and current implementation to guide development priorities.

---

## 🚨 Executive Summary: Critical Issues

Before detailed analysis, these are the **show-stopper issues** that must be fixed:

### 1. Selection System is Completely Broken 💔

**Symptom**: Clicking on chart elements does not select samples. Selection never appears.

**Root Cause**:
- Recharts' `onClick` events don't fire reliably for overlapping `Line` components
- The regex parsing `dataKey.match(/[po](\d+)/)` in `handleClick` may fail silently
- Even when clicks register, visual feedback may not appear due to rendering issues

**Code Location**: [SpectraChartV2.tsx](../src/components/playground/visualizations/SpectraChartV2.tsx#L518-L550)

**Impact**: The entire selection system is unusable. Cross-chart highlighting, selection-based coloring, and export of selected samples cannot work.

### 2. ~~Keyboard Shortcuts Trigger Browser Shortcuts~~ ✅ FIXED

**Status**: **RESOLVED** (January 8, 2026)

**Fix Applied**: Added `totalSamples: rawData?.spectra?.length ?? 0` to the `usePlaygroundShortcuts()` hook call in [Playground.tsx](../src/pages/Playground.tsx#L473).

Keyboard shortcuts (Ctrl+A, Ctrl+I, Ctrl+S, etc.) now work correctly when data is loaded.

### 3. ~~Pinned Samples Feature Has No UI~~ ✅ FIXED

**Status**: **RESOLVED** (January 8, 2026)

**Fix Applied**: Added keyboard shortcuts for pinning in [usePlaygroundShortcuts.ts](../src/hooks/usePlaygroundShortcuts.ts):
- **Ctrl+P**: Pin selected samples (keeps them always visible)
- **Ctrl+Shift+P**: Clear all pins

The pinning feature is now accessible via keyboard shortcuts. Pinned samples remain visible during filtering and are highlighted in visualizations.

---

## ⚠️ Assessment Methodology Note

This document distinguishes between:
- **Code exists**: The functionality is coded but may not work in practice
- **Functionally working**: The feature works when tested by a user
- **Wired up correctly**: The code is connected to the UI and responds to user actions

Many features have code written but are **not wired up** or have **broken integration**.

## Legend

| Status | Meaning |
|--------|---------|
| ✅ | Fully Implemented and Working |
| ⚠️ | Partially Implemented / Code Exists but Broken |
| ❌ | Not Implemented |
| 🔄 | Different from Spec |
| 💔 | Code exists but not functional |

---

## 1. Overview

### 1.1 Purpose ⚠️
The Playground is implemented as an interactive data visualization dashboard, but core features (selection, shortcuts) are not fully functional.

### 1.2 Core Concept ⚠️

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Dual-dataset comparison model | Reference vs Final dataset | Partially - step comparison exists | ⚠️ |
| Reference Dataset selection (any step) | Any pipeline step output | Step comparison slider exists, but limited | ⚠️ |
| Final Dataset | Last enabled step output | ✅ Implemented | ✅ |

**Gaps**:
- Step comparison mode exists but is accessed via a slider toggle, not integrated as the primary paradigm
- The "Reference vs Final" terminology is not used in the UI (uses "Step Comparison" instead)

### 1.3 Reference Modes ❌

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Step Reference Mode | Reference is a pipeline step | ⚠️ Basic via step slider | ⚠️ |
| Dataset Reference Mode | Compare two different datasets | ❌ Not implemented | ❌ |
| Reference mode selector in top bar | Toggle between modes | ❌ Not implemented | ❌ |
| Reference dataset picker | Select another dataset | ❌ Not implemented | ❌ |

**Gaps**:
- **Dataset Reference Mode is completely missing** - cannot compare two different datasets through the same pipeline
- No UI for selecting a reference dataset
- No handling of coloration differences between reference and primary datasets

### 1.4 Key Principles 💔

| Feature | Status | Notes |
|---------|--------|-------|
| Synchronized Views (shared selection, coloration) | 💔 | Code exists via `SelectionContext` and `GlobalColorConfig`, but selection is **not functional** — click handlers are present but clicking on chart elements does not reliably update selection across views |
| Non-Destructive Exploration | ✅ | Works |
| Performance-Aware (WebGL option) | ⚠️ | WebGL code exists in SpectraChartV2 but visual parity with Canvas not guaranteed |
| Scientific Rigor | ⚠️ | Basic statistical overlays work |

**Critical Issue**: Selection system has code in place but is **far from functional**. Charts have `onClick` handlers that call `selectionCtx.select()`, but:
1. Click detection on chart elements is unreliable
2. Cross-chart highlighting appears broken in practice
3. Selection state doesn't sync properly between views

### 1.5 Regression vs Classification Mode ⚠️

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Auto-detection of target type | Auto-adapt to regression/classification | ❌ Always assumes regression | ❌ |
| Classification: Discrete class bars in histogram | Discrete colors per class | ❌ Not implemented | ❌ |
| Classification: Qualitative colormap | Tab10, categorical palettes | ⚠️ Palettes exist, not auto-selected | ⚠️ |
| Legend adaptation | Gradient bar vs class swatches | ❌ No adaptive legend | ❌ |

**Gaps**:
- **Classification mode is not implemented** - all visualizations assume continuous target values
- No auto-detection of target type (regression vs classification)
- Histogram always uses continuous binning

---

## 2. Architecture & Layout

### 2.1 Layout System ⚠️

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Adaptive grid layout (1-5 views) | Auto-adjust based on visible views | ⚠️ Simple 2-column grid | ⚠️ |
| 1 view: Full-width | - | ✅ Works naturally | ✅ |
| 2 views: 1×2 or 2×1 split | User preference | ❌ Always 2-column | 🔄 |
| 3 views: 2×2 with spanning | - | ❌ Simple grid, no spanning | ❌ |
| 4+ views: Optimal arrangement | - | ⚠️ Basic grid | ⚠️ |

**Current Implementation**: Uses CSS grid with `grid-cols-1 sm:grid-cols-2` and `grid-rows-{n}` based on visible count, but no sophisticated layout optimization.

### 2.2 View States ⚠️

| State | Spec | Current | Status |
|-------|------|---------|--------|
| `VISIBLE` | Normal display | ✅ Via toggle | ✅ |
| `HIDDEN` | Deactivated | ✅ Via toggle | ✅ |
| `MAXIMIZED` | Full playground area | ❌ Not implemented | ❌ |
| `MINIMIZED` | Collapsed to header | ❌ Not implemented | ❌ |

**Gaps**:
- **No maximize/minimize functionality** for individual views
- Cannot expand a single chart to full screen within the playground

### 2.3 View Container Structure ⚠️

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Header Bar with Icon + Title | Yes | ⚠️ Title only in chart components | ⚠️ |
| Menu button | Per-view settings | ✅ Via dropdowns in charts | ✅ |
| Maximize button | Expand view | ❌ Missing | ❌ |
| Hide button | Hide view | ❌ Missing (only in toolbar) | ❌ |
| Footer with stats | Sample count, selection count | ⚠️ Partial in some charts | ⚠️ |

**Gaps**:
- View containers are not standardized - each chart implements its own header
- No unified `ChartPanel` wrapper with max/min/hide controls

### 2.4 Resize Behavior ⚠️

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Proportional resize | Views resize with window | ✅ Via CSS | ✅ |
| Minimum dimensions | Enforced min size | ❌ Not enforced | ❌ |
| Smooth animation | Between layout changes | ❌ No transitions | ❌ |
| Draggable dividers | User-adjustable | ❌ Not implemented | ❌ |

---

## 3. Global Controls

### 3.1 Top Menu Bar - View Toggles ✅

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Spectra toggle | 📈 icon | ✅ Eye icon + label | ✅ |
| Target Histogram toggle | 📊 icon | ✅ | ✅ |
| PCA/UMAP toggle | 🎯 icon | ✅ | ✅ |
| Partitions toggle | 📋 icon | ✅ (called "Folds") | ✅ |
| Differences toggle | 📐 icon | ❌ Differences Chart not implemented | ❌ |
| Repetitions toggle | - | ✅ Extra feature (not in spec) | ✅ |

### 3.2 Reference Mode Selector ❌

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Step Reference toggle | 🔗 icon | ❌ Not as toggle | ❌ |
| Dataset Reference toggle | 📁 icon | ❌ Not implemented | ❌ |
| Dataset picker dropdown | Select reference dataset | ❌ Not implemented | ❌ |

**Gap**: The reference mode selector is completely missing from the global controls.

### 3.3 Colormap Selector ✅

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Sequential colormaps | viridis, plasma, etc. | ✅ blue_red, viridis, plasma, inferno, spectral | ✅ |
| Diverging colormaps | coolwarm, RdBu, etc. | ⚠️ Only coolwarm | ⚠️ |
| Qualitative colormaps | Set1, Set2, tab10, etc. | ✅ default, tableau10, set1, set2, paired | ✅ |

**Note**: Implementation is good, minor gap in diverging palette options.

### 3.4 Coloration Logic Selector ⚠️

| Mode | Spec Icon | Current | Status |
|------|-----------|---------|--------|
| `TARGET` | 🎯 | ✅ "By Y Value" | ✅ |
| `PARTITION` | 📂 | ✅ "By Partition" | ✅ |
| `METADATA` | 📋 | ✅ "By Metadata" + column picker | ✅ |
| `SELECTION` | ✓ | ✅ "By Selection" | ✅ |
| `OUTLIER` | ⚠️ | ✅ "By Outlier" | ✅ |
| `INDEX` | 🔢 | ❌ Not implemented | ❌ |

**Gap**: `INDEX` coloration mode (color by sample position) is not implemented.

### 3.5 Display Filtering ⚠️

| Filter | Spec | Current | Status |
|--------|------|---------|--------|
| Partition Filter | All, Train, Test, Specific Fold | ✅ `PartitionSelector` | ✅ |
| Outlier Filter | All, Hide Outliers, Outliers Only | ❌ Not as filter | ❌ |
| Selection Filter | All, Selected Only, Unselected Only | ❌ Not as filter | ❌ |
| Metadata Filter | Filter by column values | ❌ Not implemented | ❌ |

**Gaps**:
- Outlier/Selection/Metadata filtering is not implemented as display filters
- These would filter what samples are displayed across all views

### 3.6 Rendering Mode ✅

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Canvas mode | Standard rendering | ✅ | ✅ |
| WebGL mode | High-performance | ✅ | ✅ |
| Auto mode | Auto-select based on data size | ✅ `renderOptimizer` | ✅ |

### 3.7 Global Actions ⚠️

| Action | Spec | Current | Status | Notes |
|--------|------|---------|--------|-------|
| Reset View | 🔄 Reset all views | ❌ Not implemented | ❌ | |
| Clear Selection | ✕ | ✅ Via Escape key | ✅ | **FIXED**: Works when data loaded |
| Invert Selection | ⇄ | ✅ Via Ctrl+I | ✅ | **FIXED**: Works when selection exists |
| Pin Selection | 📌 | ✅ Via Ctrl+P | ✅ | **NEW**: Pin selected samples |
| Clear Pins | 📌✕ | ✅ Via Ctrl+Shift+P | ✅ | **NEW**: Unpin all samples |
| Export All Views | 📄 Combined report | ⚠️ Batch export exists, not combined | ⚠️ | |
| Export Selected Data | 📤 CSV | ⚠️ Export menu exists | ⚠️ | Selection needed first |

---

## 4. Coloration System

### 4.1 Coloration Modes ✅

All six modes from the spec are implemented in `colorConfig.ts`:
- ✅ TARGET
- ✅ PARTITION
- ✅ METADATA (with auto-detection of categorical/continuous)
- ✅ SELECTION
- ✅ OUTLIER
- ❌ INDEX (missing)

### 4.2 Color Legend ❌

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Dynamic legend | Shows current colormap | ❌ Not implemented globally | ❌ |
| Gradient bar for continuous | With min/max labels | ❌ | ❌ |
| Swatches for discrete | List with labels | ⚠️ In some charts only | ⚠️ |
| Collapsible legend | Save space | ❌ | ❌ |
| Bottom-right position | Configurable | ❌ | ❌ |

**Gap**: There is no global color legend component. Each chart shows minimal legend info.

### 4.3 Outlier Overlay ⚠️

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Red overlay in all modes | Always visible on outliers | ⚠️ Only in outlier mode | ⚠️ |
| Toggle option | Can be disabled | ❌ No toggle | ❌ |

**Spec says**: "In all other coloration modes, outliers are always overlaid in red."
**Current**: Outliers only shown in red when outlier color mode is active.

---

## 5. Selection Model

### 5.1 Selection State 💔

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| `selectedIndices` | Set<number> | Code: `selectedSamples` | 💔 Code exists but selection doesn't work |
| `hoveredIndex` | number \| null | Code: `hoveredSample` | ⚠️ |
| `pinnedIndices` | Set<number> | Code: `pinnedSamples` | ❌ Not visually implemented |
| `timestamp` | For undo/redo | ❌ Not tracked | ❌ |

**Critical Issue**: The `SelectionContext` has a full implementation with `select()`, `toggle()`, `clear()`, `undo()`, `redo()` methods. Charts have `onClick` handlers that call these methods. **However, selection is NOT FUNCTIONAL in practice**:

1. **SpectraChartV2**: Has `handleClick` that calls `selectionCtx.select()` — but Recharts' `onClick` event doesn't fire reliably for individual lines when many lines overlap
2. **YHistogramV2**: Has bar click handlers — these may work better
3. **DimensionReductionChart**: Has point click handlers — partially works in 2D mode
4. **FoldDistributionChartV2**: Has segment click handlers

The fundamental issue is that **clicking on chart elements does not reliably trigger selection**, making the entire selection system non-functional despite the code being present.

### 5.2 Selection Modes 💔

| Mode | Spec | Current | Status |
|------|------|---------|--------|
| `SINGLE` | Click = replace | 💔 Code exists, doesn't work | 💔 |
| `ADD` | Shift+Click | 💔 Code exists, doesn't work | 💔 |
| `TOGGLE` | Ctrl+Click | 💔 Code exists, doesn't work | 💔 |
| `RANGE` | Shift+Click range | ❌ Not implemented | ❌ |
| `AREA` | Drag selection | ⚠️ Box/Lasso in PCA exists | ⚠️ |

### 5.3 Area Selection ⚠️

| View | Spec | Current | Status |
|------|------|---------|--------|
| Spectra | Rectangle selects passing spectra | ⚠️ Y-range selection code exists | ⚠️ Untested |
| PCA/UMAP | Rectangle/lasso | ⚠️ Code exists | ⚠️ May work |
| Differences | Rectangle | ❌ Chart not implemented | ❌ |
| Histogram | Click bar selects bin samples | ⚠️ Code exists | ⚠️ May work |
| Partitions | Click segment | ⚠️ Code exists | ⚠️ May work |

### 5.4 Selection Visualization ⚠️

| View | Selected | Unselected | Status |
|------|----------|------------|--------|
| Spectra | Full opacity, thicker | Reduced opacity | ⚠️ Visual code exists, but selection doesn't trigger |
| PCA/UMAP | Full opacity, larger | Reduced opacity, smaller | ⚠️ |
| Histogram | Highlighted bar | Normal bar | ⚠️ |

### 5.5 Selection Actions ⚠️

| Action | Shortcut | Status | Notes |
|--------|----------|--------|-------|
| Select All | Ctrl+A | ✅ | **FIXED**: `totalSamples` now passed to hook |
| Deselect All | Escape | ✅ | Works when selection exists |
| Invert Selection | Ctrl+I | ✅ | **FIXED**: Works when selection exists |
| Pin Selection | Ctrl+P | ✅ | **NEW**: Pin selected samples |
| Clear Pins | Ctrl+Shift+P | ✅ | **NEW**: Unpin all samples |
| Mark as Outliers | Ctrl+O | ❌ | Not implemented |

---

## 6. Views

### 6.1 Spectra Chart

#### 6.1.0 View Menu Bar ⚠️

| Control | Spec | Current | Status |
|---------|------|---------|--------|
| Display Mode toggle | Lines, Mean±Std, Quantiles, Rep Means | ✅ Multiple modes | ✅ |
| Dataset toggle | Reference, Final, Both, Difference | ⚠️ Has viewMode but tied to operators | ⚠️ |
| Line Limit dropdown | 50-All, Per-Quantile, Extrema | ✅ Sampling strategies | ✅ |
| Rendering toggle | Canvas/WebGL | ✅ | ✅ |
| More Options menu | Grid, Labels, Line Style | ⚠️ Some options | ⚠️ |

#### 6.1.1 Display Modes ✅

| Mode | Status |
|------|--------|
| Individual Lines | ✅ |
| Mean±Std | ✅ `mean_std` |
| Mean Quantiles | ✅ `median_quantiles` |
| Repetition Means | ⚠️ Separate RepetitionsChart |

#### 6.1.2-6.1.3 Configuration ⚠️

| Setting | Spec | Current | Status |
|---------|------|---------|--------|
| Line Limit | 50-1000, All | ✅ Via sampling config | ✅ |
| Line Style | Solid, Dashed, Dotted | ⚠️ Only solid/dashed for original vs processed | ⚠️ |
| Line Width | 0.5-3.0 px | ❌ Not configurable | ❌ |
| Area Opacity | 0.1-0.5 | ❌ Fixed | ❌ |
| Show Grid | On/Off | ❌ Always on | ❌ |

#### 6.1.4 Axis Controls ⚠️

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| X-Axis zoom (mousewheel) | Yes | ✅ `handleWheel` | ✅ |
| X-Axis pan (drag) | Yes | ❌ Only zoom | ❌ |
| Y-Axis auto-scale | Yes | ✅ | ✅ |
| Y-Axis fixed range | Option | ❌ | ❌ |
| Double-click reset | Yes | ✅ `handleDoubleClick` | ✅ |

#### 6.1.5 Selection Behavior 💔

| Action | Spec | Current | Status | Notes |
|--------|------|---------|--------|-------|
| Click on line | Select spectrum | 💔 Code exists | 💔 | **BROKEN**: Recharts onClick unreliable for overlapping lines |
| Shift+Click | Add | 💔 Code exists | 💔 | Depends on click working |
| Ctrl+Click | Toggle | 💔 Code exists | 💔 | Depends on click working |
| Drag rectangle | Select passing spectra | ⚠️ Code exists | ⚠️ | Wavelength range only, untested |

**Root Cause**: `handleClick` in SpectraChartV2 extracts `dataKey` from `chartEvent.activePayload[0].dataKey` and parses it with regex `/[po](\d+)/`. This works in theory but Recharts doesn't reliably fire click events for individual Line components when many overlap.

#### 6.1.6-6.1.7 Rendering ✅

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Canvas mode | Full styling | ✅ | ✅ |
| WebGL mode | Hardware accelerated | ✅ `SpectraWebGL` | ✅ |
| Visual parity | Same output | ⚠️ Close but not identical | ⚠️ |
| Quality selector | Low/Medium/High/Full | ❌ | ❌ |

---

### 6.2 Target Histogram

#### 6.2.0 View Menu Bar ⚠️

| Control | Spec | Current | Status |
|---------|------|---------|--------|
| Dataset Source toggle | Primary/Reference (Dataset mode) | ❌ Not implemented | ❌ |
| Bin Count | 5-50, Auto | ✅ Auto, 10, 20, 30, 50 | ✅ |
| Y-Axis Mode | Count, Density, Frequency | ✅ | ✅ |
| Overlays | KDE, Mean, Median, σ bands | ✅ All available | ✅ |
| Orientation | Vertical/Horizontal | ❌ Always vertical | ❌ |

#### 6.2.1 Independence from Pipeline ✅

Correctly implemented - histogram shows Y values which don't change through preprocessing.

#### 6.2.2 Dataset Reference Mode Behavior ❌

Not applicable - Dataset Reference mode not implemented.

#### 6.2.3 Statistical Overlays ✅

| Overlay | Status |
|---------|--------|
| KDE | ✅ |
| Mean line | ✅ |
| Median line | ✅ |
| 1σ Range | ✅ |
| 2σ Range | ❌ Only 1σ |
| 3σ Range | ❌ |
| Min/Max | ❌ As overlay |
| Quartiles | ❌ |

#### 6.2.4 Stacked Bar Coloration ✅

Implemented - bars show stacked segments based on coloration mode.

#### 6.2.5 Selection Behavior ⚠️

| Action | Status | Notes |
|--------|--------|-------|
| Click bar | ⚠️ | Code looks solid, more likely to work than spectra click |
| Shift+Click | ⚠️ | Adds samples in bin |
| Drag across bars | ⚠️ | Range selection code exists |
| Ctrl+Click | ⚠️ | Toggle samples in bin |

**Note**: Histogram selection uses `handleClick` on `Bar` components which is more reliable than detecting clicks on Line components. This may actually work but is **untested** due to the broader selection system issues.

---

### 6.3 PCA/UMAP Projection

#### 6.3.0 View Menu Bar ✅

| Control | Spec | Current | Status |
|---------|------|---------|--------|
| Method toggle | PCA/UMAP | ✅ | ✅ |
| Dimensions toggle | 2D/3D | ✅ | ✅ |
| X/Y/Z Component | Dropdown | ✅ | ✅ |
| Dataset toggle | Reference, Final, Both | ❌ Not implemented | ❌ |
| Settings menu | Point size, opacity, etc. | ✅ | ✅ |

#### 6.3.1 Projection Methods ✅

| Method | Status |
|--------|--------|
| PCA | ✅ |
| UMAP | ✅ With on-demand computation |

#### 6.3.2-6.3.3 Configuration ✅

| Setting | Status |
|---------|--------|
| 2D/3D mode | ✅ |
| Component selection | ✅ |
| Variance threshold (PCA) | ⚠️ Fixed at 99.9% |
| Show variance % | ✅ In axis labels |
| Show loadings | ❌ Not implemented |

**Gap**: PCA loadings visualization is not implemented.

---

### 6.4 Partitions Chart ⚠️

The specification says "Partitions" but implementation calls it "Fold Distribution". Features are largely implemented as `FoldDistributionChartV2`.

| Feature | Status | Notes |
|---------|--------|-------|
| Count view | ✅ | Works |
| Y Distribution view | ✅ | Works |
| Color by partition | ✅ | Works |
| Color by Y mean | ✅ | Works |
| Click to select | ⚠️ | Code exists via `onClick` on Bar - untested in practice |

**Note**: Selection code looks more reliable here than in SpectraChart since it uses Bar clicks rather than Line clicks. May actually work.

---

### 6.5 Differences Chart ❌

**The entire Differences Chart view is NOT IMPLEMENTED.**

| Feature | Spec | Status |
|---------|------|--------|
| Reference vs Final difference | Plot the difference | ❌ |
| Per-wavelength difference | Heatmap or line plot | ❌ |
| Aggregated stats | Mean/std of differences | ❌ |
| Selection behavior | Same as other charts | ❌ |

**Note**: There is a "difference" view mode in SpectraChartV2 (`viewMode: 'difference'`), but this is not a dedicated Differences Chart as specified.

---

## 7. Pipeline Editor Integration

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Reference step selection | Select any step as reference | ⚠️ Step slider | ⚠️ |
| Step-by-step comparison | Compare original to step N | ✅ Via slider | ✅ |
| Disable during Dataset Reference mode | - | N/A (Dataset mode not implemented) | - |

---

## 8. Export Capabilities

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Export chart as PNG | Per chart | ✅ | ✅ |
| Export all charts | Combined report | ⚠️ Batch, not combined | ⚠️ |
| Export as PDF | - | ❌ | ❌ |
| Export data as CSV | Selected samples | ✅ | ✅ |
| Export selections as JSON | Save/restore | ✅ | ✅ |

---

## 9. Keyboard Shortcuts 💔

**CRITICAL ISSUE**: Keyboard shortcuts trigger browser shortcuts instead of app shortcuts.

### Root Cause Analysis

The `usePlaygroundShortcuts.ts` hook is well-designed but **broken in integration**:

1. **Missing `totalSamples` parameter**: Playground.tsx calls `usePlaygroundShortcuts({...})` but does NOT pass `totalSamples`. This means:
   - `enabled: totalSamples > 0` evaluates to `enabled: false`
   - **Ctrl+A (Select All) is disabled** → Browser's select-all triggers
   - **Ctrl+I (Invert Selection) is disabled** (depends on `selectedCount > 0` which can never be > 0 if selection is broken)

2. **Missing `onRefresh` parameter**: Ctrl+R refresh shortcut is disabled

3. **Conditional shortcut enabling**: Many shortcuts have `enabled: !!callback && someCondition` patterns. If the condition is never met, the shortcut is disabled and the browser's default behavior fires.

### Shortcuts Status

| Shortcut | Action | Spec | Status | Notes |
|----------|--------|------|--------|-------|
| ? | Show help | ✅ | ⚠️ | May work (no condition) |
| Ctrl+A | Select all | ✅ | 💔 | **BROKEN**: `totalSamples` not passed → disabled |
| Escape | Clear selection | ✅ | ⚠️ | May work (no condition) |
| Ctrl+I | Invert selection | ✅ | 💔 | **BROKEN**: `selectedCount > 0` never true |
| Ctrl+Z | Undo | ✅ | 💔 | Only works if `canUndo || canUndoSelection` |
| Ctrl+Shift+Z | Redo | ✅ | 💔 | Only works if `canRedo || canRedoSelection` |
| Ctrl+Y | Redo (alt) | ✅ | 💔 | Same as above |
| 1-5 | Toggle charts | ✅ | ⚠️ | Works if `onToggleChart` is passed |
| Ctrl+S | Save selection | ✅ | 💔 | `selectedCount > 0` never true |
| Ctrl+Shift+E | Export PNG | ✅ | ⚠️ | Works if `onExportPng` is passed |
| Ctrl+Shift+D | Export Data | ✅ | ⚠️ | Works if `onExportData` is passed |
| Ctrl+O | Mark as outliers | ❌ | ❌ | Not implemented in hook |
| Ctrl+R | Refresh | ✅ | ❌ | `onRefresh` not passed |
| Ctrl+Backspace | Clear pipeline | ✅ | ⚠️ | Works if `onClearPipeline` is passed |

### Code Quality

The hook implementation itself is solid:
- Has `preventDefault: true` on appropriate shortcuts
- Properly normalizes key combinations
- Detects conflicts
- Skips input fields

**The problem is 100% integration**: the hook is not receiving the data it needs to enable shortcuts.

---

## 10. Tooltips & Contextual Help

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| Toolbar tooltips | Explain each control | ⚠️ Some present | ⚠️ |
| Chart tooltips | Sample details on hover | ✅ | ✅ |
| Keyboard shortcuts help | ? key overlay | ✅ | ✅ |

---

## 11. Performance Considerations

| Feature | Spec | Current | Status |
|---------|------|---------|--------|
| WebGL for >1000 samples | Auto-switch | ✅ `renderOptimizer` | ✅ |
| Sampling strategies | Reduce rendered samples | ✅ Various strategies | ✅ |
| Memoization | useMemo, useCallback | ✅ Extensive use | ✅ |
| Lazy loading | Charts load on demand | ⚠️ All loaded together | ⚠️ |

---

## Summary of Critical Gaps

### 🚨 Urgent Fixes (Core Features Broken)

1. **Selection System is Non-Functional** 💔
   - `SelectionContext` exists with full API
   - Charts have click handlers calling `selectionCtx.select()`
   - **But clicking on chart elements does NOT reliably trigger selection**
   - Cross-chart highlighting doesn't work
   - Selection visual feedback never appears
   - **ROOT CAUSE**: Recharts `onClick` events don't fire reliably for overlapping elements / Line charts

2. **Keyboard Shortcuts Trigger Browser Shortcuts** 💔
   - Hook is well-designed with proper `preventDefault`
   - **But `totalSamples` is not passed to the hook**
   - Ctrl+A → browser select-all instead of app select-all
   - Ctrl+I → browser italics/other instead of invert-selection
   - Ctrl+S → browser save-page instead of save-selection
   - **FIX**: Pass `totalSamples={rawData?.X?.length ?? 0}` to `usePlaygroundShortcuts()`

3. **Pinned Samples Not Visible** 💔
   - `pinnedSamples` state exists in `SelectionContext`
   - `pin()`, `unpin()`, `togglePin()` methods exist
   - **But there's no UI to show pinned samples or trigger pinning**

### High Priority (Core Features Missing)

4. **Dataset Reference Mode** ❌ — Cannot compare two different datasets through the same pipeline
5. **Differences Chart** ❌ — Entire view is missing
6. **INDEX Coloration Mode** ❌ — Color by sample position not implemented
7. **Classification Mode** ❌ — No support for discrete target variables

### Medium Priority (Enhanced UX)

8. **View Maximize/Minimize** ❌ — Cannot expand individual charts
9. **Global Color Legend** ❌ — No persistent legend showing current colormap
10. **Outlier Overlay in All Modes** ⚠️ — Outliers only highlighted in outlier mode
11. **Display Filters** (Outlier/Selection/Metadata) ❌ — Cannot filter displayed samples
12. **Range Selection** ❌ — Shift+click for contiguous range not implemented

### Lower Priority (Polish)

13. **Adaptive Grid Layout** ⚠️ — Simple grid, no spanning optimization
14. **Draggable Dividers** ❌ — Cannot resize views manually
15. **PCA Loadings** ❌ — Cannot visualize feature contributions
16. **Line Width/Style Customization** ❌ — Fixed styling in spectra chart
17. **PDF Export** ❌ — Only PNG available

---

## Root Cause Analysis

### Why Selection Doesn't Work

1. **Recharts Limitation**: The `ComposedChart` with many overlapping `Line` components doesn't fire reliable click events. When you click on a spectrum, Recharts' `onClick` callback receives `activePayload` but:
   - It may be undefined if clicking on whitespace
   - It may return wrong sample if lines overlap
   - The `dataKey` extraction with regex `match(/[po](\d+)/)` may fail

2. **Conditional Context**: Charts check `useSelectionContext` prop (default `true`) but then access:
   ```tsx
   const selectionCtx = useSelectionContext ? useSelection() : null;
   ```
   If `SelectionContext` is not provided higher up, `selectionCtx` is null and all selection code is skipped.

3. **WebGL Path**: When in WebGL mode (`isWebGLMode = true`), selection code still runs but the WebGL canvas doesn't integrate with Recharts' event system.

### Why Shortcuts Don't Work

1. **Missing Parameters**: `Playground.tsx` line ~472:
   ```tsx
   const { shortcutsByCategory } = usePlaygroundShortcuts({
     onUndo: undo,
     onRedo: redo,
     ...
     // MISSING: totalSamples
   });
   ```

2. **Conditional Enabling**: Many shortcuts have:
   ```tsx
   enabled: totalSamples > 0,  // totalSamples defaults to 0
   enabled: selectedCount > 0, // selectedCount comes from broken selection
   ```

---

## Recommended Implementation Order

### Phase 0: Critical Bug Fixes (Immediate)

1. **Fix Keyboard Shortcuts**
   - Pass `totalSamples` to `usePlaygroundShortcuts`
   - Pass `onRefresh` callback
   - Test each shortcut manually

2. **Fix Selection System**
   - Option A: Rewrite click detection to use SVG element inspection instead of Recharts events
   - Option B: Add invisible hit areas on top of chart for selection
   - Option C: Use a different charting library that supports reliable click events

3. **Add Selection UI Feedback**
   - Show selection count in toolbar
   - Add selection visual indicator (border around charts with selection active)

### Phase A: Reference System

- Implement Dataset Reference Mode
- Add reference mode selector to toolbar
- Update all charts to support dual-dataset comparison

### Phase B: Missing Views

- Implement dedicated Differences Chart
- Add to view toggles

### Phase C: Classification Support

- Auto-detect target type
- Adapt histogram for discrete values
- Update color system for classification

### Phase D: UX Enhancements

- Add maximize/minimize to view containers
- Implement global color legend
- Add INDEX coloration mode
- Add display filters

### Phase E: Polish

- Improve layout adaptivity
- Add more configuration options
- Implement remaining shortcuts

---

## Appendix: Quick Fixes

### Fix 1: Enable Keyboard Shortcuts (5 minutes)

**File**: `src/pages/Playground.tsx` around line 472

```diff
  const { shortcutsByCategory } = usePlaygroundShortcuts({
+   totalSamples: rawData?.X?.length ?? 0,
    onUndo: undo,
    onRedo: redo,
    onClearPipeline: () => { /* ... */ },
    onSaveSelection: () => toast.info('Save Selection: Use toolbar button'),
    onExportPng: () => toast.info('Export PNG: Use Export menu'),
    onExportData: () => toast.info('Export Data: Use Export menu'),
    onToggleChart: (index: number) => { /* ... */ },
    onShowHelp: () => setShowShortcutsHelp(true),
+   onRefresh: () => rerunPipeline?.(),
    canUndo,
    canRedo,
  });
```

### Fix 2: Add Selection Count Display (15 minutes)

Add to CanvasToolbar.tsx a selection count indicator that reads from SelectionContext:

```tsx
const { selectedCount, hasSelection } = useSelection();
// Display: "Selected: 42 samples" or hide when no selection
```

### Fix 3: Verify SelectionProvider Wrapping

Ensure the charts are inside the `<SelectionProvider>` in Playground.tsx (currently they are - lines 306-365).

### Fix 4: Test Histogram/Bar Selection

Before attempting to fix Spectra selection, verify that clicking histogram bars actually works. Bar-based clicks are more reliable than Line clicks in Recharts.

---

*End of Analysis*
