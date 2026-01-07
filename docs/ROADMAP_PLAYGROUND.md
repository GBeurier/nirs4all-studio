# Playground Roadmap

> **Document Purpose**: Detailed roadmap for improving and extending the Playground feature.
> This document covers code quality improvements, new features, and backend enhancements.
> Generated: 2026-01-07

---

## Table of Contents

1. [Current State Overview](#current-state-overview)
2. [Architecture Summary](#architecture-summary)
3. [Phase 1: Code Quality & Refactoring](#phase-1-code-quality--refactoring)
4. [Phase 2: Selection System Enhancement](#phase-2-selection-system-enhancement)
5. [Phase 3: Spectra Visualization Enhancement](#phase-3-spectra-visualization-enhancement)
6. [Phase 4: Target Histogram Enhancement](#phase-4-target-histogram-enhancement)
7. [Phase 5: PCA/UMAP Visualization Enhancement](#phase-5-pcaumap-visualization-enhancement)
8. [Phase 6: Fold Distribution Enhancement](#phase-6-fold-distribution-enhancement)
9. [Phase 7: Repetitions Distance Chart (New)](#phase-7-repetitions-distance-chart-new)
10. [Phase 8: Pipeline Editor Integration](#phase-8-pipeline-editor-integration)
11. [Phase 9: Backend Improvements](#phase-9-backend-improvements)
12. [Phase 10: Testing & Documentation](#phase-10-testing--documentation)
13. [Implementation Priority](#implementation-priority)
14. [Technical Debt](#technical-debt)

---

## Current State Overview

### What Exists

The Playground is already well-implemented with the following capabilities:

| Category | Implementation Status |
|----------|----------------------|
| **Data Loading** | ✅ File upload, demo data, workspace datasets |
| **Pipeline Execution** | ✅ Backend processing via `/api/playground/execute` |
| **Operator Types** | ✅ Preprocessing, augmentation, splitting, filters |
| **Selection System** | ✅ SelectionContext with undo/redo, pinning, saved selections |
| **Visualizations** | ✅ Spectra, Y Histogram, PCA/UMAP, Folds, Repetitions |
| **Step Comparison** | ✅ View intermediate pipeline steps |
| **Export** | ✅ PNG, CSV, JSON exports |
| **Keyboard Shortcuts** | ✅ Global shortcuts system |
| **Render Optimization** | ✅ Auto/Canvas/WebGL modes |

### Key Files Structure

```
Frontend:
├── src/pages/Playground.tsx                 # Main page orchestrator
├── src/context/SelectionContext.tsx         # Global selection state
├── src/components/playground/
│   ├── MainCanvas.tsx                       # Chart grid & controls
│   ├── PlaygroundSidebar.tsx                # Left panel with operators
│   ├── PipelineBuilder.tsx                  # Operator list management
│   ├── OperatorPalette.tsx                  # Available operators
│   ├── visualizations/
│   │   ├── SpectraChart.tsx                 # Spectra line chart
│   │   ├── SpectraChartV2.tsx               # Enhanced spectra
│   │   ├── YHistogram.tsx                   # Target histogram
│   │   ├── YHistogramV2.tsx                 # Enhanced histogram
│   │   ├── PCAPlot.tsx                      # PCA scatter plot
│   │   ├── DimensionReductionChart.tsx      # PCA/UMAP unified
│   │   ├── FoldDistributionChart.tsx        # Fold bar chart
│   │   ├── FoldDistributionChartV2.tsx      # Enhanced folds
│   │   └── RepetitionsChart.tsx             # Repetition variability
│   └── ...                                  # Selection tools, filters
├── src/hooks/
│   ├── usePlaygroundPipeline.ts             # Pipeline state & execution
│   ├── useSpectralData.ts                   # Data loading
│   └── usePlaygroundShortcuts.ts            # Keyboard shortcuts
├── src/lib/playground/
│   ├── spectraConfig.ts                     # Chart configuration types
│   ├── renderOptimizer.ts                   # WebGL/Canvas selection
│   ├── export.ts                            # Export utilities
│   └── operatorFormat.ts                    # Pipeline format conversion
└── src/types/playground.ts                  # TypeScript types

Backend:
├── api/playground.py                        # Main API routes
├── api/shared/
│   ├── pipeline_service.py                  # Operator registry
│   ├── filter_operators.py                  # Filter implementations
│   └── metrics_computer.py                  # Spectral metrics
```

---

## Architecture Summary

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                          PLAYGROUND PAGE                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐    ┌────────────────────────────────────────┐  │
│  │ useSpectralData │───▶│          usePlaygroundPipeline         │  │
│  │  (data loading) │    │  (operators, execution, step compare)  │  │
│  └─────────────────┘    └───────────────────┬────────────────────┘  │
│                                             │                        │
│                                             ▼                        │
│                         ┌───────────────────────────────────────┐   │
│                         │     POST /api/playground/execute       │   │
│                         │  (preprocessing, splitting, metrics)   │   │
│                         └───────────────────┬───────────────────┘   │
│                                             │                        │
│                                             ▼                        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     SelectionProvider                         │   │
│  │  (global selection state: selected, pinned, hovered, saved)  │   │
│  └───────────────────────────────┬──────────────────────────────┘   │
│                                  │                                   │
│                                  ▼                                   │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                         MainCanvas                              │ │
│  │  ┌──────────┐ ┌───────────┐ ┌─────────┐ ┌───────┐ ┌──────────┐ │ │
│  │  │ Spectra  │ │ Histogram │ │ PCA/UMAP│ │ Folds │ │Repetition│ │ │
│  │  │  Chart   │ │   (Y)     │ │ Scatter │ │ Dist  │ │  Chart   │ │ │
│  │  └──────────┘ └───────────┘ └─────────┘ └───────┘ └──────────┘ │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Selection Synchronization Model

All charts share the same selection state via `SelectionContext`:
- **selectedSamples**: `Set<number>` - currently selected sample indices
- **pinnedSamples**: `Set<number>` - samples that stay visible after filtering
- **hoveredSample**: `number | null` - cross-chart hover highlight
- Selection in any chart updates all charts in real-time

---

## Phase 1: Code Quality & Refactoring

### 1.1 Component Modularization

**Current Issues:**
- `MainCanvas.tsx` is 650+ lines with many responsibilities
- Duplicate chart rendering logic
- Multiple V1/V2 versions of charts coexist

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| Extract toolbar into `CanvasToolbar.tsx` | High | 2h |
| Create `ChartPanel` wrapper component for consistent chart containers | High | 3h |
| Consolidate V1/V2 chart components (keep only enhanced versions) | Medium | 4h |
| Extract export handlers into dedicated hook `usePlaygroundExport.ts` | Medium | 2h |
| Move color mode logic into `useColorMode.ts` hook | Low | 1h |

**Proposed Structure:**
```
components/playground/
├── MainCanvas.tsx           # Simplified: layout + chart grid only
├── CanvasToolbar.tsx        # NEW: toolbar with all controls
├── ChartPanel.tsx           # NEW: reusable chart wrapper
├── hooks/
│   ├── usePlaygroundExport.ts  # NEW: export handlers
│   └── useColorMode.ts         # NEW: color configuration
└── visualizations/
    ├── SpectraChart.tsx        # Merged V1/V2
    ├── YHistogram.tsx          # Merged V1/V2
    ├── FoldDistributionChart.tsx  # Merged V1/V2
    ├── DimensionReductionChart.tsx
    └── RepetitionsChart.tsx
```

### 1.2 Type Safety Improvements

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| Add strict null checks to visualization components | High | 3h |
| Create discriminated union types for chart props | Medium | 2h |
| Add runtime validation for API responses with Zod | Medium | 4h |
| Document all types in `types/playground.ts` with JSDoc | Low | 2h |

### 1.3 Performance Optimizations

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| Audit and optimize useMemo/useCallback dependencies | High | 3h |
| Implement virtualization for operator lists (>50 items) | Medium | 4h |
| Add React.memo to pure chart components | Medium | 2h |
| Profile and optimize re-renders during selection | Medium | 3h |

---

## Phase 2: Selection System Enhancement

### 2.1 Current Selection Model

The `SelectionContext` already provides:
- Multi-selection with modes (replace, add, remove, toggle)
- Selection history with undo/redo (max 50)
- Pinned samples
- Saved selections with names
- Keyboard shortcuts (Ctrl+Z, Escape, Ctrl+A)

### 2.2 Enhanced Selection Features

**Specification (from UI annotations):**
> All views are connected to the same selection model. A selection in a view selects in all views. Selection can be multiple.

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| Add lasso selection tool for scatter plots (PCA/UMAP) | High | 6h |
| Add brush selection for spectra chart (wavelength range → samples) | High | 4h |
| Add range selection on histogram (Y range → samples) | High | 3h |
| Add selection by metadata column (dropdown filter) | Medium | 4h |
| Add selection by fold/partition | Medium | 2h |
| Improve selection visualization (glow, outline styles) | Low | 2h |
| Add selection statistics panel (mean, std of selected) | Low | 3h |

### 2.3 Selection Export/Import

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| Export selection as sample IDs (not just indices) | High | 2h |
| Import selection from CSV/JSON file | Medium | 3h |
| Sync selections with workspace metadata | Low | 4h |

---

## Phase 3: Spectra Visualization Enhancement

### 3.1 Current Capabilities

- Before/after view modes
- Color by Y value, fold, dataset
- Sample subset via sampling
- Aggregation modes (mean_std, median_quantiles, minmax, density)
- Wavelength range focus
- ROI presets (water bands, protein, etc.)

### 3.2 Enhanced Visualization Modes

**Specification (from UI annotations):**
> Spectra can be seen before and after. Before is by default raw but can be any step in the pipeline. After is the last step active.
> Spectra should have many modes of visualization: with quantile area, selected, median, median per quantile, per group, per metadata column, etc.
> Colored by y / metadata / partitions, selection, outliers, before/after, etc.
> The spectra should have a complex popup settings for choice of visualization.

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| **View Mode Selector** | | |
| Add "Reference Step" selector for before view (not just raw) | High | 4h |
| Add "Current Step" selector for after view | High | 2h |
| Add difference view (after - before) | Medium | 3h |
| | | |
| **Display Modes** | | |
| Quantile envelope mode (show p5-p95 as shaded area) | High | 4h |
| Median line with quantile bands | High | 3h |
| Per-group aggregation (group by metadata column) | High | 5h |
| Selected-only mode (show only selected samples) | Medium | 2h |
| Outlier highlighting mode | Medium | 3h |
| | | |
| **Coloring Modes** | | |
| Color by Y value (continuous gradient) | ✅ Done | - |
| Color by fold/partition | ✅ Done | - |
| Color by metadata column (categorical) | High | 4h |
| Color by selection state (selected/unselected/pinned) | High | 2h |
| Color by outlier status | Medium | 2h |
| Color by before/after (dual overlay) | Medium | 3h |
| | | |
| **Settings Popup** | | |
| Create `SpectraSettingsPopup.tsx` with tabbed interface | High | 6h |
| - Tab 1: View Mode (before/after/both/difference) | | |
| - Tab 2: Display Mode (lines/envelope/median/grouped) | | |
| - Tab 3: Coloring (source, palette, opacity) | | |
| - Tab 4: Sampling (strategy, count, seed) | | |
| - Tab 5: Focus (wavelength range, ROI presets, edge mask) | | |

### 3.3 Spectra Interaction

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| Click on spectrum line to select sample | ✅ Done | - |
| Hover tooltip with sample details | ✅ Done | - |
| Brush selection on X-axis (wavelength range) | High | 4h |
| Context menu on selected spectra (pin, remove, export) | Medium | 3h |
| Zoom to selection (focus on selected samples' range) | Low | 3h |

---

## Phase 4: Target Histogram Enhancement

### 4.1 Current Capabilities

- Basic histogram with Y distribution
- KDE overlay
- Ridge plot mode
- Color by Y value or fold

### 4.2 Enhanced Histogram Modes

**Specification (from UI annotations):**
> Target is a histogram that displays Y in many ways. It can also display folds and partitions, color by metadata, etc. Same as spectra.

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| **Display Modes** | | |
| Stacked histogram by partition (train/test/val) | High | 4h |
| Grouped histogram by fold | High | 4h |
| Box plot mode (show distribution summary) | Medium | 3h |
| Violin plot mode | Medium | 4h |
| Swarm/strip plot mode (show individual points) | Medium | 4h |
| | | |
| **Coloring** | | |
| Color by metadata column | High | 3h |
| Color by selection state | High | 2h |
| Color by outlier status | Medium | 2h |
| | | |
| **Interaction** | | |
| Brush selection on histogram (Y range → select samples) | High | 3h |
| Click on bar to select samples in that bin | Medium | 2h |
| Sync selected range with other charts | Medium | 2h |

---

## Phase 5: PCA/UMAP Visualization Enhancement

### 5.1 Current Capabilities

- PCA projection (up to 10 components, auto 99.9% variance)
- UMAP projection (optional, on-demand)
- 2D/3D scatter plot
- Color by Y, fold
- Component selector

### 5.2 Enhanced Features

**Specification (from UI annotations):**
> PCA/UMAP displays the projection of either before/after/both in PCA(99.9) or UMAP.
> User can choose the components visible (2 in 2D view, 3 in 3D view).
> Coloring and display is the same as others (selected, metadata, y, outliers, etc.)

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| **View Modes** | | |
| Before/after toggle (project raw vs processed) | High | 4h |
| Overlay mode (show both projections with connecting lines) | Medium | 5h |
| | | |
| **Component Selection** | | |
| Dropdown for X/Y/Z component selection | ✅ Done | - |
| Variance explained display per component | ✅ Done | - |
| Scree plot mini-chart for component selection | Medium | 3h |
| | | |
| **Coloring** | | |
| Color by metadata column | High | 3h |
| Color by selection/pinned state | High | 2h |
| Color by outlier status (Hotelling T², Q residual) | High | 3h |
| Color by cluster assignment | Medium | 4h |
| | | |
| **Interaction** | | |
| Lasso selection tool | High | 5h |
| Rectangle selection tool | High | 3h |
| Point size by metric (e.g., leverage) | Medium | 2h |
| Confidence ellipses by group | Medium | 4h |
| | | |
| **3D Mode** | | |
| Rotation controls | ✅ Done | - |
| Animation (auto-rotate) | Low | 2h |
| Better depth perception (size/opacity falloff) | Low | 3h |

---

## Phase 6: Fold Distribution Enhancement

### 6.1 Current Capabilities

- Stacked bar chart showing train/test per fold
- Y statistics per fold

### 6.2 Enhanced Features

**Specification (from UI annotations):**
> Fold is stacked bar plot or bar plot or ridge that shows partitions train/test/val/fold_val/fold_train etc.
> Coloration same as others. No before/after, just the result of the split.

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| **Display Modes** | | |
| Stacked bar (current) | ✅ Done | - |
| Grouped bar (side by side) | High | 3h |
| Ridge plot (density per fold) | Medium | 4h |
| Heatmap mode (fold × Y bins) | Low | 4h |
| | | |
| **Partitions** | | |
| Show validation split (train/val/test) | High | 3h |
| Show OOF (out-of-fold) assignments | Medium | 2h |
| | | |
| **Coloring** | | |
| Color bars by Y statistics (mean, range) | Medium | 3h |
| Color by metadata distribution | Low | 3h |
| | | |
| **Interaction** | | |
| Click on bar segment to select those samples | High | 2h |
| Hover to show fold statistics | ✅ Done | - |

---

## Phase 7: Repetitions Distance Chart (New)

### 7.1 Specification

**From UI annotations:**
> For datasets with repetitions, the diff repetition is a scatter plot to display distance between repetitions.
> X = index of sample. Y = a point per repetition depending on distance to a reference (one rep, mean, median, global mean, from PCA, etc.) with a given metric (euclidean, mahalanobis, etc.).
> The idea here is to have a powerful tool to explore variability between repetitions. And if it's easy UX speaking, between samples.

### 7.2 Current State

`RepetitionsChart.tsx` exists with basic functionality:
- Detection of repetitions via patterns or metadata
- Distance calculation (PCA, UMAP, Euclidean, Mahalanobis)
- Strip plot showing distance to reference

### 7.3 Enhanced Features

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| **Distance Metrics** | | |
| Euclidean distance | ✅ Done | - |
| Mahalanobis distance | ✅ Done | - |
| PCA-space distance | ✅ Done | - |
| UMAP-space distance | ✅ Done | - |
| Cosine distance | High | 2h |
| Spectral angle mapper (SAM) | Medium | 3h |
| | | |
| **Reference Modes** | | |
| First repetition as reference | ✅ Done | - |
| Mean of repetitions as reference | ✅ Done | - |
| Median of repetitions as reference | High | 1h |
| Global mean as reference | High | 1h |
| PCA centroid as reference | Medium | 2h |
| | | |
| **Visualization** | | |
| Strip plot (current) | ✅ Done | - |
| Connected line plot (join repetitions) | High | 3h |
| Box plot per biological sample | High | 3h |
| Heatmap (bio_sample × repetition) | Medium | 4h |
| Parallel coordinates (all reps of selected sample) | Low | 5h |
| | | |
| **Coloring** | | |
| Color by mean Y of biological sample | High | 2h |
| Color by variability (high = red) | High | 2h |
| Color by metadata | Medium | 3h |
| Highlight outlier repetitions | High | 2h |
| | | |
| **Interaction** | | |
| Click on point to select that repetition | High | 2h |
| Click on biological sample group to select all reps | High | 2h |
| Threshold line to flag high-variability samples | Medium | 3h |
| Export high-variability list | Medium | 2h |

### 7.4 Backend Enhancements

**Current:** `_compute_repetition_analysis()` in `playground.py`

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| Add cosine and SAM distance metrics | High | 2h |
| Add median reference mode | High | 1h |
| Compute per-wavelength variability | Medium | 3h |
| Return full pairwise distance matrix (optional) | Low | 2h |

---

## Phase 8: Pipeline Editor Integration

### 8.1 Current State

- Export to Pipeline Editor: `exportToPipelineEditor()`
- Import from Pipeline Editor: `importFromPipelineEditor()`
- Model steps are stripped when importing to Playground

### 8.2 Enhanced Integration

**Specification (from UI annotations):**
> Pipeline (if compatible - no branchings) can be imported/exported between Pipeline Editor and Playground.
> If models exist, they are just removed in Playground.

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| **Export Improvements** | | |
| Add confirmation dialog showing what will be exported | Medium | 2h |
| Preserve step ordering and params exactly | High | 1h |
| Export with metadata (source dataset, execution time) | Low | 1h |
| | | |
| **Import Improvements** | | |
| Show warning for removed steps (models, branches) | High | 2h |
| Allow partial import (user selects which steps) | Medium | 3h |
| Validate imported operators exist in registry | High | 2h |
| | | |
| **Bidirectional Sync** | | |
| "Send to Playground" button in Pipeline Editor | High | 3h |
| "Use in Experiment" from Playground (bypass editor) | Medium | 4h |
| Show Playground preview in Pipeline Editor sidebar | Low | 6h |

---

## Phase 9: Backend Improvements

### 9.1 API Refactoring

**Current Issues:**
- `playground.py` is 900+ lines
- `PlaygroundExecutor` class handles everything

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| Extract `PlaygroundExecutor` to separate module | High | 3h |
| Create `repetition_service.py` for repetition analysis | Medium | 2h |
| Create `projection_service.py` for PCA/UMAP | Medium | 2h |
| Add proper error handling with custom exceptions | Medium | 3h |
| Add request/response logging for debugging | Low | 2h |

### 9.2 Caching Improvements

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| Use Redis for distributed caching (optional) | Low | 6h |
| Add cache invalidation on operator registry changes | Medium | 2h |
| Cache PCA/UMAP projections separately | High | 3h |
| Add cache stats endpoint for monitoring | Low | 2h |

### 9.3 Operator Registry

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| Complete operator definitions with all params | High | 4h |
| Add param validation with ranges and types | High | 3h |
| Add operator dependencies (e.g., requires Y) | Medium | 2h |
| Add operator incompatibilities | Medium | 2h |
| Document all operators in `/api/playground/operators` | Medium | 3h |

### 9.4 Metrics & Filtering

**Current:** `metrics_computer.py` provides spectral metrics

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| Add more metrics: skewness, kurtosis, entropy | Medium | 3h |
| Add wavelength-specific metrics (peak detection) | Medium | 4h |
| Optimize metric computation with vectorization | Medium | 3h |
| Add batch outlier detection endpoints | Medium | 3h |

---

## Phase 10: Testing & Documentation

### 10.1 Unit Tests

**Current:** `tests/test_playground.py` exists with basic tests

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| Add tests for all operator types | High | 4h |
| Add tests for sampling methods | High | 2h |
| Add tests for PCA/UMAP computation | High | 2h |
| Add tests for repetition detection | High | 2h |
| Add tests for metrics computation | Medium | 3h |
| Add tests for cache hit/miss scenarios | Medium | 2h |

### 10.2 Integration Tests

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| E2E test: load data → add operators → export | High | 4h |
| E2E test: Pipeline Editor round-trip | High | 3h |
| E2E test: selection sync across charts | Medium | 3h |
| Performance benchmark suite | Low | 4h |

### 10.3 Frontend Tests

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| Add Vitest tests for hooks | High | 4h |
| Add component tests for visualizations | Medium | 4h |
| Add Storybook stories for all chart components | Medium | 4h |
| Add accessibility tests (keyboard navigation) | Low | 3h |

### 10.4 Documentation

**Tasks:**

| Task | Priority | Effort |
|------|----------|--------|
| Document all API endpoints in OpenAPI spec | High | 3h |
| Add JSDoc to all exported functions | Medium | 4h |
| Create user guide for Playground features | Medium | 4h |
| Add inline help tooltips for complex features | Low | 3h |
| Create video tutorial for Playground | Low | 6h |

---

## Implementation Priority

### Phase Prioritization

| Phase | Priority | Total Effort | Dependencies |
|-------|----------|--------------|--------------|
| Phase 1: Code Quality | 🔴 High | ~30h | None |
| Phase 2: Selection Enhancement | 🔴 High | ~26h | Phase 1 partial |
| Phase 3: Spectra Enhancement | 🔴 High | ~50h | Phase 2 |
| Phase 9: Backend Improvements | 🟡 Medium | ~40h | None |
| Phase 8: Pipeline Integration | 🟡 Medium | ~21h | None |
| Phase 4: Histogram Enhancement | 🟡 Medium | ~32h | Phase 2 |
| Phase 5: PCA/UMAP Enhancement | 🟡 Medium | ~38h | Phase 2 |
| Phase 6: Fold Enhancement | 🟢 Low | ~24h | Phase 2 |
| Phase 7: Repetitions Enhancement | 🟡 Medium | ~40h | Phase 2 |
| Phase 10: Testing & Docs | 🟡 Medium | ~50h | All phases |

### Suggested Implementation Order

```
Sprint 1 (2 weeks): Foundation
├── Phase 1.1: Component Modularization
├── Phase 1.2: Type Safety
└── Phase 9.1: Backend Refactoring

Sprint 2 (2 weeks): Selection & Interaction
├── Phase 2.2: Enhanced Selection Features
├── Phase 2.3: Selection Export/Import
└── Phase 3.3: Spectra Interaction

Sprint 3 (2 weeks): Spectra Visualization
├── Phase 3.2: Enhanced Visualization Modes
└── Phase 3.2: Settings Popup

Sprint 4 (2 weeks): Other Charts
├── Phase 4.2: Histogram Enhancement
├── Phase 5.2: PCA/UMAP Enhancement
└── Phase 6.2: Fold Enhancement

Sprint 5 (2 weeks): Repetitions & Integration
├── Phase 7.3: Repetitions Visualization
├── Phase 7.4: Backend Enhancements
└── Phase 8.2: Pipeline Editor Integration

Sprint 6 (1 week): Polish
├── Phase 10.1: Unit Tests
├── Phase 10.4: Documentation
└── Bug fixes and performance tuning
```

---

## Technical Debt

### Known Issues to Address

| Issue | Location | Priority | Fix |
|-------|----------|----------|-----|
| V1/V2 duplicate components | `visualizations/` | High | Consolidate, keep V2 |
| Large MainCanvas.tsx | `MainCanvas.tsx` | High | Extract components |
| Hardcoded max samples | Multiple | Medium | Make configurable |
| Missing error boundaries | Some charts | Medium | Add ChartErrorBoundary |
| Inconsistent prop naming | Multiple | Low | Standardize |
| Unused imports | Multiple | Low | Clean up |

### Performance Bottlenecks

| Bottleneck | Impact | Solution |
|------------|--------|----------|
| Re-render on any selection change | Medium | Optimize SelectionContext |
| PCA computed on every pipeline change | High | Cache projections |
| WebGL not used for all charts | Medium | Extend WebGL to histogram/folds |
| Large spectra arrays in state | Medium | Use immutable updates |

---

## Appendix: Color Mode Specification

### Unified Coloring System

All charts should support the same coloring modes:

| Mode | Description | Applicable Charts |
|------|-------------|-------------------|
| `target` | Color by Y value (continuous gradient) | All |
| `fold` | Color by CV fold assignment | All |
| `partition` | Color by train/test/val | All |
| `metadata` | Color by metadata column | All |
| `selection` | Selected (primary) vs unselected (gray) | All |
| `pinned` | Pinned (gold) vs others | All |
| `outlier` | Outlier (red) vs inlier (normal) | All |
| `before_after` | Original (dashed) vs processed (solid) | Spectra only |

### Color Palette

```typescript
const PLAYGROUND_COLORS = {
  // Selection states
  selected: 'hsl(var(--primary))',
  unselected: 'hsl(var(--muted-foreground) / 0.3)',
  pinned: 'hsl(45, 90%, 50%)', // Gold
  hovered: 'hsl(var(--primary) / 0.8)',

  // Outlier states
  inlier: 'hsl(var(--foreground))',
  outlier: 'hsl(0, 80%, 50%)', // Red
  warning: 'hsl(45, 80%, 50%)', // Orange

  // Partitions
  train: 'hsl(200, 70%, 50%)', // Blue
  test: 'hsl(150, 70%, 45%)', // Green
  validation: 'hsl(280, 60%, 50%)', // Purple

  // Fold palette (categorical)
  folds: [
    'hsl(200, 70%, 50%)',
    'hsl(150, 70%, 45%)',
    'hsl(45, 80%, 50%)',
    'hsl(280, 60%, 50%)',
    'hsl(350, 70%, 50%)',
    'hsl(180, 60%, 45%)',
    'hsl(100, 60%, 45%)',
    'hsl(320, 60%, 50%)',
    'hsl(60, 70%, 45%)',
    'hsl(220, 60%, 50%)',
  ],
};
```

---

*Document generated: 2026-01-07*
*Based on codebase analysis of nirs4all_webapp Playground feature*
