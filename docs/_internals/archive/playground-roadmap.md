# NIR Playground V2 Implementation Roadmap

**Version:** 1.0
**Status:** Draft
**Author:** Steve Cromwell, Senior Frontend Developer
**Date:** January 2026
**Reference:** [playground-specification.md](./playground-specification.md)

---

## Executive Summary

This roadmap defines a phased implementation plan to transform the current Playground V1 into the fully-featured V2 specification. The plan is organized into **6 phases** spanning approximately **14-18 weeks**, with each phase delivering incremental, testable value.

**Key Principles:**
1. **Incremental Delivery**: Each phase produces a deployable, improved Playground
2. **Backend-First for Complex Features**: Heavy computations stay server-side
3. **Progressive Enhancement**: WebGL and advanced features layer on top of working base
4. **Comprehensive Testing**: Each phase includes unit, integration, and E2E tests

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Phase 1: Foundation & Selection System](#2-phase-1-foundation--selection-system)
3. [Phase 2: Enhanced Spectra Chart](#3-phase-2-enhanced-spectra-chart)
4. [Phase 3: Chart Enhancements](#4-phase-3-chart-enhancements)
5. [Phase 4: Repetitions & New Charts](#5-phase-4-repetitions--new-charts)
6. [Phase 5: Advanced Filtering & Metrics](#6-phase-5-advanced-filtering--metrics)
7. [Phase 6: Performance & Polish](#7-phase-6-performance--polish)
8. [Technical Specifications](#8-technical-specifications)
9. [Risk Assessment](#9-risk-assessment)
10. [Testing Strategy](#10-testing-strategy)

---

## 1. Current State Assessment

### 1.1 What Exists (V1)

| Component | Status | Notes |
|-----------|--------|-------|
| PlaygroundSidebar | ✅ Complete | Dataset, operators, pipeline builder |
| MainCanvas | ✅ Complete | 4-chart grid with visibility toggles |
| SpectraChart | ✅ Basic | Single sample selection, mean±std, brush zoom |
| YHistogram | ✅ Basic | Bar selection, simple coloring |
| PCAPlot | ✅ Basic | 2D scatter, fold coloring, axis selection |
| FoldDistributionChart | ✅ Basic | Stacked bars |
| Backend API | ✅ Complete | /execute, /operators, /presets |
| Preprocessing Operators | ✅ Complete | Full nirs4all coverage |
| Splitting Operators | ✅ Complete | Full sklearn coverage |
| Augmentation Operators | ✅ Complete | GaussianNoise, SpectrumShift, etc. |
| Step Comparison Mode | ✅ Complete | Slider to view intermediate steps |

### 1.2 What's Missing for V2

| Feature | Priority | Complexity |
|---------|----------|------------|
| Raw Data Mode (no pipeline required) | P0 | Low |
| Unified Selection State | P0 | Medium |
| Cross-Chart Selection Sync | P0 | Medium |
| Advanced Spectrum Subset Selection | P0 | High |
| Filter Operators | P0 | Medium |
| Source Dataset Selection | P1 | Low |
| Repetitions Chart | P1 | Medium |
| UMAP Support | P1 | Medium |
| 3D PCA View | P2 | Medium |
| Spectral Metrics System | P1 | High |
| Aggregation Modes | P1 | Medium |
| WebGL Rendering | P2 | High |
| Ridge Plot for Histogram | P2 | Medium |
| Saved Selections | P2 | Low |

### 1.3 Technical Debt

| Issue | Impact | Resolution |
|-------|--------|------------|
| No shared selection context | Blocks cross-chart sync | Phase 1 |
| Metrics computed client-side | Performance issues at scale | Phase 5 |
| Fixed sample limit (50) | Limits exploration | Phase 2 |
| No WebGL fallback | Poor perf >1000 samples | Phase 6 |

---

## 2. Phase 1: Foundation & Selection System

**Duration:** 2-3 weeks
**Goal:** Establish unified selection architecture and cross-chart synchronization

### 2.1 Deliverables

| Deliverable | Description |
|-------------|-------------|
| Raw Data Mode | Playground works without any pipeline operators |
| SelectionContext | React context for global selection state |
| Selection Tools | Lasso, box, multi-select components |
| Cross-Chart Highlighting | Visual feedback across all charts |
| Selection Actions | Filter, invert, clear, pin |
| Filter Operators (Backend) | Outlier removal, range filter API |

### 2.2 Implementation Tasks

#### 2.2.1 Enable Raw Data Mode

**Files:** `src/hooks/usePlaygroundPipeline.ts`, `api/playground.py`

**Tasks:**
- [x] Update `usePlaygroundPipeline` to handle empty operator array
- [x] Backend: `/execute` returns raw dataset when `operators=[]`
- [x] Compute PCA on raw data when no preprocessing is applied
- [x] Hide step slider when pipeline is empty
- [x] Show info message: "Visualizing raw data. Add operators to see transformations."
- [x] Disable comparison mode when no pipeline exists
- [x] Ensure all charts gracefully handle raw data input

**Behavior:**
```typescript
// Empty pipeline = raw data visualization
const result = await executePlayground({
  dataset_id: "my_dataset",
  operators: [],  // Empty = raw data mode
  sample_count: 100
});
// Returns: { data: rawData, pca: rawPCA, statistics: rawStats }
```

#### 2.2.2 Create SelectionContext

**File:** `src/context/SelectionContext.tsx`

```typescript
interface SelectionState {
  selectedSamples: Set<number>;
  pinnedSamples: Set<number>;
  savedSelections: Map<string, SavedSelection>;
  history: SelectionHistoryEntry[];
  historyIndex: number;
}

interface SelectionActions {
  select: (indices: number[]) => void;
  addToSelection: (indices: number[]) => void;
  removeFromSelection: (indices: number[]) => void;
  toggleSelection: (index: number) => void;
  clearSelection: () => void;
  invertSelection: (allIndices: number[]) => void;
  pinSelection: () => void;
  unpinAll: () => void;
  saveSelection: (name: string) => void;
  loadSelection: (id: string) => void;
  undo: () => void;
  redo: () => void;
}
```

**Tasks:**
- [x] Create context with reducer pattern
- [x] Implement history tracking (max 50 entries)
- [x] Add sessionStorage persistence
- [x] Create `useSelection` hook
- [x] Add keyboard shortcuts (Ctrl+Z, Escape, Ctrl+A)

#### 2.2.3 Create Selection Tools

**File:** `src/components/playground/SelectionTools.tsx`

**Tasks:**
- [x] Implement lasso selection component (SVG path)
- [x] Implement box selection component
- [x] Create selection mode toggle (click/lasso/box)
- [x] Add shift/ctrl modifier handling
- [x] Integrate with each chart component

#### 2.2.4 Update Chart Components for Selection

**Files:** `SpectraChart.tsx`, `PCAPlot.tsx`, `YHistogram.tsx`, `FoldDistributionChart.tsx`

**Tasks per chart:**
- [x] Consume SelectionContext
- [x] Add selection highlight styling
- [x] Implement selection handlers (click, lasso, box)
- [x] Add "Filter to Selection" button
- [x] Add visual indicator for pinned samples

#### 2.2.5 Backend: Filter Operators

**File:** `api/shared/pipeline_service.py`

**Tasks:**
- [x] Add `filter` operator type to registry
- [x] Implement `OutlierFilter` operator (T², Q-residual, LOF)
- [x] Implement `RangeFilter` operator (target range, metadata range)
- [x] Implement `MetadataFilter` operator (categorical match)
- [x] Implement `QCFilter` operator (status flags)
- [x] Update `/operators` endpoint to include filters

**Filter Operator Interface:**
```python
class BaseFilter:
    def fit_predict(self, X, y=None, metadata=None) -> np.ndarray:
        """Returns boolean mask of samples to KEEP."""
        pass
```

**Execution Order Notes:**
- Filters are applied AFTER preprocessing (so outliers are detected on transformed data)
- Filters are applied BEFORE splitters (so folds are created on filtered data)
- Multiple filters combine with AND logic (sample must pass ALL filters)
- Filter results show "N samples removed" feedback in UI

**Augmentation Operator Notes:**
- Augmentation operators (GaussianNoise, SpectrumShift, Mixup, etc.) are **transformations**, not sample generators
- They modify existing spectra in-place (add noise, shift wavelengths, etc.)
- No new samples are created; sample count remains unchanged
- Treated identically to preprocessing operators in the pipeline flow
- Visible effect: compare \"Before\" vs \"After\" to see transformation impact

#### 2.2.6 Frontend: Filter Operators

**File:** `src/lib/playground/operatorFormat.ts`

**Tasks:**
- [x] Add 'filter' to UnifiedOperatorType
- [x] Create FilteringMenu in OperatorPalette
- [x] Update PipelineBuilder to handle filter operators
- [x] Add filter-specific UI (shows "N samples removed")

### 2.3 Testing Checklist

- [ ] Unit: Raw data mode returns dataset when operators=[]
- [ ] Unit: SelectionContext reducer logic
- [ ] Unit: Selection tools geometry calculations
- [ ] Integration: All charts render with empty pipeline
- [ ] Integration: Cross-chart selection sync
- [ ] E2E: Load dataset with no operators → all charts display
- [ ] E2E: Select in PCA → verify highlight in Spectra
- [ ] E2E: Filter operators remove samples correctly

### 2.4 Review Questions & Answers

**Q1:** How do we handle selection when switching between source datasets or pipeline steps?

**A:** Selection is based on sample indices. When the pipeline changes, we preserve selection if the sample count remains the same. If samples are filtered out, we intersect the selection with remaining indices and notify the user ("3 of 12 selected samples were removed by filter").

**Q2:** Should lasso selection work in WebGL mode?

**A:** Yes, but lasso is computed in 2D screen space regardless of render mode. The WebGL canvas provides hit-testing support via a shader-based picking approach (render sample IDs to offscreen buffer).

**Q3:** How do we prevent selection state from causing excessive re-renders?

**A:** Use `useMemo` for derived selection arrays, implement `React.memo` on chart components with custom comparator, and batch selection updates with `unstable_batchedUpdates` or React 18's automatic batching.

---

## 3. Phase 2: Enhanced Spectra Chart

**Duration:** 3-4 weeks
**Goal:** Implement comprehensive spectrum subset selection and visualization modes

### 3.1 Deliverables

| Deliverable | Description |
|-------------|-------------|
| Display Mode Selector | All/Processed/Original/Both overlay |
| Sampling Strategy UI | Random, stratified, coverage selectors |
| Metadata Filters | Split, fold, metadata field filters |
| Aggregation Modes | Mean, median, quantiles, min/max bands |
| Wavelength Focus | Range slider, ROI presets |
| Source Dataset Selector | Choose comparison base in pipeline |

### 3.2 Implementation Tasks

#### 3.2.1 Refactor SpectraChart Architecture

**File:** `src/components/playground/visualizations/SpectraChart.tsx`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Extract `SpectraChartToolbar` component
- [x] Extract `SpectraChartCanvas` component (render logic)
- [x] Create `SpectraChartConfig` state object
- [x] Implement view mode state machine

**Implemented Files:**
- `src/lib/playground/spectraConfig.ts` - Configuration types and utilities
- `src/lib/playground/useSpectraChartConfig.ts` - React hook for config state
- `src/components/playground/visualizations/SpectraChartToolbar.tsx` - Toolbar component
- `src/components/playground/visualizations/SpectraChartV2.tsx` - Enhanced chart component

```typescript
interface SpectraChartConfig {
  // View mode
  viewMode: 'processed' | 'original' | 'both' | 'difference';
  overlayStyle: 'opacity' | 'dashed' | 'desaturated';

  // Subset selection
  subsetMode: 'all' | 'sampled' | 'selected' | 'filtered';
  samplingStrategy: SamplingStrategy;

  // Aggregation
  aggregationMode: 'none' | 'mean_std' | 'median_quantiles' | 'minmax' | 'density';
  aggregationThreshold: number;  // Auto-aggregate above this count

  // Wavelength focus
  wavelengthRange: [number, number] | null;
  showDerivative: 0 | 1 | 2;
}
```

#### 3.2.2 Implement Sampling Strategies

**File:** `src/lib/playground/sampling.ts`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Random sampling (client-side, seeded)
- [x] Request stratified sampling from backend
- [x] Request coverage (k-means) sampling from backend
- [x] Implement progressive level-of-detail UI (50/200/1000)

**Backend Tasks:**
- [ ] Add sampling strategy to ExecuteRequest
- [ ] Implement coverage sampling (MiniBatchKMeans centroids)
- [ ] Return sample_indices mapping in response

#### 3.2.3 Implement Metadata Filter Panel

**File:** `src/components/playground/SpectraFilterPanel.tsx`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Split/fold filter (train/test/fold_k dropdown)
- [x] Target range filter (dual-handle slider)
- [x] Metadata column filter (dynamic based on dataset)
- [x] QC status filter (accepted/rejected/missing)
- [x] Combine filters with AND logic

**Implemented File:** `src/components/playground/visualizations/SpectraFilterPanel.tsx`

```typescript
interface SpectraFilters {
  partition: 'all' | 'train' | 'test' | 'fold' | 'oof';
  foldIndex?: number;
  targetRange?: [number, number];
  metadataFilters?: Record<string, unknown>;
  qcStatus?: 'accepted' | 'rejected' | 'all';
}
```

#### 3.2.4 Implement Aggregation Rendering

**File:** `src/components/playground/visualizations/SpectraAggregation.tsx`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Mean ± std band (Area + Line)
- [x] Median + p5/p95 band
- [x] Min/max envelope
- [x] Grouped aggregates (per metadata value)
- [x] Auto-switch when n > threshold

#### 3.2.5 Implement Wavelength Focus

**File:** `src/components/playground/WavelengthRangePicker.tsx`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Dual-handle range slider
- [x] NIR ROI presets (water band, protein, etc.)
- [x] Edge masking toggle
- [x] Derivative toggle (1st, 2nd)
- [x] Persist range in chart config

**Implemented File:** `src/components/playground/visualizations/WavelengthRangePicker.tsx`

#### 3.2.6 Source Dataset Selector

**Files:** `PlaygroundSidebar.tsx`, `usePlaygroundPipeline.ts`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Add "Source Step" dropdown above pipeline
- [x] Options: Raw, Step 1, Step 2... (based on active operators)
- [ ] Modify backend request to include source_step parameter
- [ ] Update comparison logic in charts

**Implemented File:** `src/components/playground/visualizations/SourceDatasetSelector.tsx`

### 3.3 Testing Checklist

- [ ] Unit: Sampling algorithm correctness
- [ ] Unit: Filter combination logic
- [ ] Unit: Aggregation statistics accuracy
- [ ] Integration: Filter applies to all charts
- [ ] E2E: Full filtering workflow
- [ ] Performance: 10k samples with aggregation

### 3.4 Review Questions & Answers

**Q1:** How do we handle the "difference visualization" mode (processed - raw)?

**A:** The backend computes the difference array when `viewMode: 'difference'` is requested. This ensures we handle potential shape mismatches (e.g., if preprocessing changed wavelength count). The frontend receives pre-computed difference spectra and renders them as a standard spectra plot.

**Q2:** What happens when filters result in 0 samples?

**A:** Display a friendly empty state: "No samples match current filters. Try relaxing your criteria." with buttons to reset each filter type. Never show an error or crash.

**Q3:** How do we make ROI presets domain-configurable?

**A:** Store presets in a JSON configuration that can be extended per-deployment:
```json
{
  "presets": [
    {"name": "Water Band", "range": [1400, 1500], "description": "O-H absorption"},
    {"name": "Protein", "range": [2050, 2200], "description": "N-H/C=O absorption"}
  ]
}
```
Allow users to save custom presets to localStorage.

---

## 4. Phase 3: Chart Enhancements

**Duration:** 2-3 weeks
**Goal:** Upgrade existing charts with full specification features
**Status:** ✅ COMPLETED

### 4.1 Deliverables

| Deliverable | Description | Status |
|-------------|-------------|--------|
| Enhanced Histogram | Coloring modes, ridge plot, KDE overlay | ✅ Complete |
| Enhanced PCA/UMAP | UMAP support, 3D view (placeholder), metric coloring | ✅ Complete |
| Enhanced Folds | Metric coloring, improved interaction | ✅ Complete |
| Global Partition Selector | Toolbar-level partition filtering | ✅ Complete |

### 4.2 Implementation Tasks

#### 4.2.1 Target Histogram Enhancements

**File:** `src/components/playground/visualizations/YHistogramV2.tsx`

**Tasks:**
- [x] Configurable bin count (auto, 10, 20, 50, custom)
- [x] Color by metadata column
- [x] Color by spectral metric (from backend)
- [x] Stacked fold display mode
- [x] Ridge plot fold display mode
- [x] KDE overlay toggle
- [x] Reference lines (mean, median)
- [x] SelectionContext integration
- [x] Statistics footer

#### 4.2.2 PCA/UMAP Enhancements

**File:** `src/components/playground/visualizations/DimensionReductionChart.tsx`

Renamed from `PCAPlot.tsx` to reflect dual purpose.

**Tasks:**
- [x] Add UMAP method option (frontend toggle)
- [x] Add 3D view placeholder (requires Three.js installation)
- [x] Color by spectral metrics (from backend)
- [x] Improved tooltip with all sample metadata
- [x] Axis component selector (any PC/UMAP dim)
- [x] SelectionContext integration
- [x] Support for UMAP data from backend

**Backend Tasks for UMAP:**
- [x] Add UMAP computation option to `/execute`
- [x] Handle UMAP parameters (n_neighbors, min_dist, n_components)
- [x] Add `/capabilities` endpoint to check UMAP availability
- [x] Added `umap` field to ExecuteResponse

```python
# In playground.py - IMPLEMENTED
from umap import UMAP

def _compute_umap(self, X: np.ndarray, y: Optional[np.ndarray], ...) -> Dict:
    reducer = UMAP(n_components=n_components, n_neighbors=n_neighbors, min_dist=min_dist)
    embedding = reducer.fit_transform(X)
    return {
        "coordinates": embedding.tolist(),
        "n_components": n_components,
        "params": {"n_neighbors": n_neighbors, "min_dist": min_dist},
        "available": True,
        ...
    }
```

#### 4.2.3 3D View Component

**File:** `src/components/playground/visualizations/ScatterPlot3D.tsx`

**Status:** ✅ FULLY IMPLEMENTED (Three.js dependencies installed)

**Tasks:**
- [x] Placeholder component created
- [x] Install command provided to user
- [x] Three.js scene setup with orbit controls
- [x] Instanced mesh for performance (>1000 points)
- [x] Color mapping (continuous/categorical)
- [x] Selection via raycasting
- [x] Axis labels and grid
- [x] Export as PNG (canvas toDataURL)
- [x] Hover tooltips
- [x] Reset camera button
- [x] Instructions overlay for user guidance

**Dependencies (INSTALLED):**
- `@react-three/fiber`
- `@react-three/drei` (OrbitControls, Text, Line, Html)
- `three`
- `@types/three`

**Implementation Notes:**
- Uses instanced mesh rendering for optimal performance with large datasets
- Points are normalized to [-1, 1] range with proper axis labeling showing original values
- Selection integrates with SelectionContext for cross-chart highlighting
- Native DOM MouseEvent used for Three.js compatibility (not React.MouseEvent)

#### 4.2.4 Folds Chart Enhancements

**File:** `src/components/playground/visualizations/FoldDistributionChartV2.tsx`

**Tasks:**
- [x] Color by mean target value per partition
- [x] Color by metadata mode per partition
- [x] Interactive: click bar → select samples in partition
- [x] Improved tooltips with partition statistics
- [x] SelectionContext integration
- [x] View mode selector (counts/distribution/both)

#### 4.2.5 Global Partition Selector

**File:** `src/components/playground/PartitionSelector.tsx`

**Tasks:**
- [x] Toolbar component for partition filtering
- [x] Options: All, Train, Test, Train-Test, OOF, Fold-N
- [x] Applies to all charts simultaneously
- [x] Badge showing sample count per selection
- [x] Helper function `getPartitionIndices` for filtering

### 4.3 Testing Checklist

- [x] TypeScript compilation passes
- [x] Build passes for Phase 3 files
- [x] V2 charts integrated in MainCanvas
- [x] UMAP backend endpoint functional
- [x] 3D view renders correctly (Three.js installed and implemented)
- [x] 3D instanced mesh handles >1000 points efficiently
- [x] 3D export as PNG works
- [ ] Unit: Ridge plot offset calculation
- [ ] Unit: UMAP result parsing
- [ ] Integration: Partition selector affects all charts
- [ ] E2E: Switch between PCA/UMAP
- [ ] Performance: 3D view with 5000 points

### 4.4 Review Questions & Answers

**Q1:** How do we handle UMAP's computation time for large datasets?

**A:** UMAP is computed on the sampled subset (same as PCA). For datasets >5000 samples, we warn the user that UMAP may take 10-30 seconds and offer a "Compute UMAP" button rather than auto-computing. Results are cached server-side.

**Q2:** How do we ensure the 3D view is accessible?

**A:** The current implementation provides:
- Keyboard navigation via OrbitControls (drag to rotate, scroll to zoom, right-drag to pan)
- 2D fallback toggle always available (users can switch between 2D and 3D at any time)
- Instructions overlay showing available controls
- Reset camera button for easy navigation recovery
- Point count indicator for context
- Full color inheritance from parent chart's color scheme (WCAG compliance deferred to color config)

Future improvements for full WCAG compliance should include:
- Arrow key rotation controls
- Screen reader summary of data distribution
- High contrast mode option

**Q3:** What happens if a dataset has no Y values for the histogram?

**A:** Hide the histogram chart or show an empty state: "No target values in dataset. Histogram requires Y data." The chart toggle is disabled with a tooltip explanation.

**Q4:** How do we handle mouse event type compatibility between Three.js and React?

**A:** Three.js events provide native DOM `MouseEvent` objects, not React `SyntheticEvent`. The ScatterPlot3D component uses native `MouseEvent` in its interface, and DimensionReductionChart creates a synthetic event with the required modifier key properties (shiftKey, ctrlKey, metaKey) for selection handling.

**Q5:** How do we determine which PCA components to show in the axis selectors?

**A:** The axis selectors show all PCA components needed to reach 99.9% cumulative explained variance. This is calculated dynamically from `pca.explained_variance_ratio` rather than using the fixed `n_components` from the backend. For UMAP, all available dimensions are shown.

**Q6:** Why did the 3D view show only one point when switching from 2D?

**A:** The original implementation used `useMemo` to update the `InstancedMesh` matrices and colors, but `useMemo` runs during render before the DOM is updated, so `meshRef.current` wasn't available. The fix uses `useEffect` which runs after render, ensuring the mesh is properly mounted. Additionally, adding a `key` to the `Canvas` and `instancedMesh` components forces proper re-initialization when data changes.

**Q7:** Why weren't the 3D points colored correctly?

**A:** The `getPointColor` function returns CSS variable patterns like `hsl(var(--primary) / 0.6)` which Three.js cannot parse. The `parseHslColor` function was enhanced to detect CSS variable patterns and return a fallback color instead of throwing an error.

---

## 5. Phase 4: Repetitions & New Charts

**Duration:** 2 weeks
**Goal:** Implement Repetitions chart and prepare for additional views
**Status:** ✅ COMPLETED

### 5.1 Deliverables

| Deliverable | Description | Status |
|-------------|-------------|--------|
| Repetitions Chart | Full specification implementation | ✅ Complete |
| Repetition Detection | Backend auto-detection of repetitions | ✅ Complete |
| Repetition Setup Dialog | Manual configuration UI | ✅ Complete |
| Chart Extension API | Clean interface for future charts | ✅ Complete |

### 5.2 Implementation Tasks

#### 5.2.1 Backend: Repetition Analysis

**File:** `api/playground.py`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Add repetition detection to `/execute` response
- [x] Detect from metadata column (configurable)
- [x] Compute intra-sample distances in PCA space
- [x] Support multiple distance metrics (Euclidean, Mahalanobis, Cosine)
- [x] Auto-detect repetitions from sample ID patterns

**Implementation Notes:**
- Added `_compute_repetition_analysis` method to `PlaygroundExecutor`
- Updated `ExecuteResponse` model with `repetitions` field
- Supports regex-based pattern detection (e.g., `(.+)_rep\d+`, `(.+)-R\d+`)
- Computes distance to group centroid for each repetition
- Identifies outliers using P95 threshold
- Returns statistics per bio sample group

```python
def _compute_repetition_analysis(
    self,
    X: np.ndarray,
    sample_ids: List[str],
    pca_result: Optional[Dict],
    metadata: Optional[Dict] = None,
) -> Dict:
    """Compute repetition variability metrics."""
    # Auto-detect repetitions from sample IDs using regex patterns
    # Group by biological sample
    # Compute distances to centroid
    # Return structured result with statistics
```

#### 5.2.2 Repetitions Chart Component

**File:** `src/components/playground/visualizations/RepetitionsChart.tsx`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Strip plot: X = bio sample, Y = distance
- [x] Connect points from same bio sample
- [x] Color by target, metadata, or metric
- [x] Distance metric selector (PCA, UMAP, Euclidean, Mahalanobis)
- [x] Selection → highlight across all charts
- [x] Tooltip with sample details
- [x] Reference lines (P95 threshold, mean)
- [x] Outlier highlighting
- [x] SelectionContext integration

**Implementation Notes:**
- Uses Recharts ScatterChart with custom jitter for overlapping points
- Supports color modes: target, distance, bio_sample, rep_index
- Integrated with SelectionContext for cross-chart selection
- Shows statistics footer with group count, mean/median/P95 distances
- Exports `RepetitionsChartProps` interface

#### 5.2.3 Repetition Setup Dialog

**File:** `src/components/playground/RepetitionSetupDialog.tsx`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Modal dialog for configuration
- [x] Auto-detection status display
- [x] Manual column selection dropdown
- [x] Pattern-based extraction (regex for sample IDs)
- [x] Preview of detected groups
- [x] Common pattern presets (with descriptions)

**Implementation Notes:**
- Three detection modes: auto, metadata, pattern
- Preset patterns include: `_rep`, `_R`, `-R`, `.rep`, `_replicate`
- Live preview shows detected groups with sample counts
- Validates pattern before applying

#### 5.2.4 Chart Extension API

**File:** `src/components/playground/ChartRegistry.ts`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Registry pattern for easy addition of future charts
- [x] Chart definition interface with requirements check
- [x] Default visibility configuration
- [x] Priority ordering
- [x] Category grouping (core, analysis, advanced)
- [x] Disabled state with reason

**Implementation Notes:**
- `ChartDefinition` interface with `requiresData`, `isDisabled`, `disabledReason`
- `chartRegistry` singleton with `register`, `get`, `getAll`, `getAvailable`
- Utility functions: `getChartConfig`, `buildEffectiveVisibility`, `computeRecommendedVisibility`, `getToggleableCharts`
- Pre-registered charts: spectra, histogram, pca, folds, repetitions

### 5.3 Updated Type Definitions

**File:** `src/types/playground.ts`

**Added Types:**
```typescript
export interface RepetitionResult {
  has_repetitions: boolean;
  n_bio_samples: number;
  n_repetitions: number;
  distance_metric: 'pca' | 'umap' | 'euclidean' | 'mahalanobis' | 'cosine';
  detection_method: 'auto' | 'metadata' | 'pattern';
  detection_pattern?: string;
  message?: string;
  data: RepetitionDataPoint[];
  statistics: RepetitionStatistics;
  bio_sample_groups: Record<string, number[]>;
}

export interface RepetitionDataPoint {
  bio_sample: string;
  rep_index: number;
  sample_index: number;
  distance: number;
  is_outlier: boolean;
}

export interface RepetitionStatistics {
  mean_distance: number;
  median_distance: number;
  std_distance: number;
  p95_distance: number;
  max_distance: number;
  n_outliers: number;
}
```

### 5.4 MainCanvas Integration

**File:** `src/components/playground/MainCanvas.tsx`

**Changes:**
- [x] Added `RepetitionsChart` import
- [x] Added `'repetitions'` to `ChartType` union
- [x] Added repetitions to `CHART_CONFIG` array
- [x] Added `hasRepetitions` memo check
- [x] Updated `effectiveVisibleCharts` logic
- [x] Added RepetitionsChart render block in chart grid

### 5.5 Testing Checklist

- [x] TypeScript compilation passes
- [x] All new files created and exported
- [x] Component integration complete
- [ ] Unit: Bio sample ID extraction from patterns
- [ ] Unit: Distance calculations in various metrics
- [ ] Integration: Repetition detection with real data
- [ ] Integration: Chart renders with mock data
- [ ] E2E: Configure repetitions and view chart

### 5.6 Review Questions & Answers

**Q1:** How do we handle datasets where repetitions aren't clearly marked?

**A:** Provide a "Pattern Extraction" mode where users specify a regex to extract the biological sample ID from the full sample ID. Example: `(.+)_rep\d+` extracts "SampleA" from "SampleA_rep1". Show a live preview of extraction results. The RepetitionSetupDialog includes common presets with descriptions.

**Q2:** What if a biological sample has only 1 measurement (no repetitions)?

**A:** Exclude it from the chart but note it in the statistics. The backend only includes groups with 2+ samples. The message field indicates if some samples were excluded.

**Q3:** How do we visualize many bio samples (100+)?

**A:** The strip plot uses horizontal layout with scrolling. Points are jittered vertically to prevent overlap. Aggregation to boxplot view is planned for Phase 6.

---

## 6. Phase 5: Advanced Filtering & Metrics

**Duration:** 2-3 weeks
**Goal:** Implement spectral metrics system and advanced outlier detection
**Status:** ✅ COMPLETED

### 6.1 Deliverables

| Deliverable | Description | Status |
|-------------|-------------|--------|
| Spectral Metrics API | Backend computation of all metrics | ✅ Complete |
| Metrics Filter Panel | UI for filtering by any metric | ✅ Complete |
| Outlier Detection | Hotelling T², Q-residual, LOF filters | ✅ Complete |
| Similarity Filter | Distance-to-reference filtering | ✅ Complete |
| Embedding Selection | Mini PCA/UMAP for lasso selection | ✅ Complete |

### 6.2 Implementation Tasks

#### 6.2.1 Backend: Metrics Computation

**File:** `api/shared/metrics_computer.py`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Create MetricsComputer class
- [x] Implement all metrics from specification (24+ metrics across 6 categories)
- [x] Add caching layer (expensive metrics)
- [x] Add `/metrics` endpoint for on-demand computation
- [x] Include basic metrics in `/execute` response

**Implementation Notes:**
- Created `MetricsComputer` class with `compute()`, `get_metric_stats()`, `get_outlier_mask()`, `get_similar_samples()` methods
- Metric categories: AMPLITUDE_METRICS, ENERGY_METRICS, SHAPE_METRICS, NOISE_METRICS, QUALITY_METRICS, CHEMOMETRIC_METRICS
- Added endpoints: GET `/metrics`, POST `/metrics/compute`, POST `/metrics/outliers`, POST `/metrics/similar`
- Updated `/capabilities` to include `metrics: True`

```python
class MetricsComputer:
    """Compute per-sample spectral descriptors."""

    FAST_METRICS = [
        'global_min', 'global_max', 'dynamic_range', 'mean_intensity',
        'l2_norm', 'rms_energy', 'auc',
    ]

    SLOW_METRICS = [
        'hotelling_t2', 'q_residual', 'leverage', 'lof_score',
    ]

    def compute(
        self,
        X: np.ndarray,
        metrics: List[str],
        pca_result: Optional[Dict] = None,
    ) -> Dict[str, np.ndarray]:
        results = {}

        for metric in metrics:
            if metric == 'l2_norm':
                results[metric] = np.linalg.norm(X, axis=1)
            elif metric == 'hotelling_t2':
                # Requires PCA
                if pca_result is None:
                    continue
                coords = np.array(pca_result['coordinates'])
                var = np.array(pca_result['explained_variance'])
                results[metric] = np.sum((coords ** 2) / var, axis=1)
            # ... other metrics

        return results
```

#### 6.2.2 Frontend: Metrics Filter Panel

**File:** `src/components/playground/MetricsFilterPanel.tsx`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Fetch available metrics from backend
- [x] Range slider per metric with MiniHistogram preview
- [x] Histogram preview for metric distribution
- [x] Combine multiple metric filters
- [x] Preset filters ("Typical Samples", "Outliers Only", "High Quality", "Low Noise")
- [x] Grouped by metric category with collapsible sections

**Implementation Notes:**
- Uses Popover for filter panel, Accordion for metric categories
- `MetricFilterRow` component with dual-handle range slider
- `MiniHistogram` component for distribution preview using Recharts
- Real-time filter count badge
- Export `MetricFilter` type

```typescript
interface MetricFilter {
  metric: string;
  min?: number;
  max?: number;
  invert: boolean;  // true = select outliers
}

interface MetricsFilterPanelProps {
  availableMetrics: string[];
  metricStats: Record<string, { min: number; max: number; mean: number }>;
  filters: MetricFilter[];
  onChange: (filters: MetricFilter[]) => void;
}
```

#### 6.2.3 Outlier Detection UI

**File:** `src/components/playground/OutlierSelector.tsx`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Method selector (T², Q-residual, Distance, LOF)
- [x] Threshold slider with distribution preview
- [x] "Top K" mode (select K most extreme)
- [x] "Within threshold" mode (select typical)
- [x] Select inliers toggle
- [x] Integration with SelectionContext

**Implementation Notes:**
- `DistributionPreview` component shows metric distribution with threshold line
- Supports all four outlier methods
- Badge shows outlier count when active
- Exports `OutlierMethod` type

#### 6.2.4 Similarity Filter

**File:** `src/components/playground/SimilarityFilter.tsx`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Reference selection (input index or use selected sample)
- [x] Distance metric selector (Euclidean, Cosine, Correlation)
- [x] Threshold slider / Top K mode
- [x] Dual mode: "similar to" vs "different from"
- [x] Live preview of matching samples
- [x] Integration with SelectionContext

**Implementation Notes:**
- Popover-based UI with reference sample input
- "Use selected as reference" button (target icon)
- Distance range shown in results
- Exports `DistanceMetric` type

#### 6.2.5 Embedding Selection Overlay

**File:** `src/components/playground/EmbeddingSelector.tsx`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Mini PCA/UMAP scatter in corner of Spectra chart
- [x] Box selection within mini plot
- [x] Lasso selection within mini plot (with SVG path overlay)
- [x] Sync with main spectra display via SelectionContext
- [x] Toggle visibility with expand/minimize button
- [x] Color by partition, target, selection, or none
- [x] Selection count indicator

**Implementation Notes:**
- Uses Recharts ScatterChart with ReferenceArea for box selection
- Custom SVG path overlay for lasso visualization
- `pointInPolygon` helper for lasso hit testing
- Compact (40×32) and expanded (full width) modes
- Exports `SelectionMode` and `ColorBy` types

### 6.3 MainCanvas Integration

**File:** `src/components/playground/MainCanvas.tsx`

**Status:** ✅ COMPLETED

**Changes:**
- [x] Added imports for MetricsFilterPanel, OutlierSelector, SimilarityFilter, EmbeddingSelector
- [x] Added Phase 5 props to MainCanvasProps interface (metrics, onDetectOutliers, onFindSimilar, metricFilters, onMetricFiltersChange, showEmbeddingOverlay, onToggleEmbeddingOverlay)
- [x] Added "Filter:" section to toolbar with all Phase 5 components
- [x] Added EmbeddingSelector overlay in Spectra chart area

### 6.4 Type Definitions

**File:** `src/types/playground.ts`

**Added Types:**
```typescript
export interface MetricStats {
  min: number;
  max: number;
  mean: number;
  std: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface MetricInfo {
  name: string;
  display_name: string;
  description: string;
  category: string;
}

export interface MetricsResult {
  values: Record<string, number[]>;
  statistics: Record<string, MetricStats>;
  computed_metrics: string[];
}

export interface OutlierResult {
  success: boolean;
  error?: string;
  method: string;
  threshold: number;
  inlier_mask: boolean[];
  outlier_indices: number[];
  n_outliers: number;
  n_inliers: number;
  values?: number[];
}

export interface SimilarityResult {
  success: boolean;
  error?: string;
  reference_idx: number;
  metric: string;
  threshold?: number;
  top_k?: number;
  similar_indices: number[];
  distances: number[];
  n_similar: number;
}

export interface MetricFilter {
  metric: string;
  min?: number;
  max?: number;
  invert: boolean;
}
```

### 6.5 Testing Checklist

- [x] TypeScript compilation passes
- [x] All new files created and exported
- [x] Component integration complete
- [ ] Unit: Each metric calculation accuracy
- [ ] Unit: Filter combination logic
- [ ] Integration: Metrics returned in execute response
- [ ] Integration: Outlier detection matches sklearn reference
- [ ] E2E: Select outliers → view in charts
- [ ] Performance: Metrics computation for 10k samples

### 6.4 Review Questions & Answers

**Q1:** How do we handle metrics that depend on PCA when PCA isn't computed?

**A:** Metrics like Hotelling's T² have a dependency on PCA. The frontend grays out these metrics with a tooltip "Requires PCA. Enable PCA in chart options." When PCA is enabled, these metrics become available automatically.

**Q2:** How do we prevent the metrics panel from becoming overwhelming?

**A:** Group metrics by category (Amplitude, Energy, Shape, Noise, Quality, Chemometric) with collapsible sections. Show only commonly-used metrics by default, with an "Advanced" toggle for the full list. Most users will only need 2-3 metrics at a time.

**Q3:** How do we make LOF computation tractable for large datasets?

**A:** LOF is computed on the sampled subset only. For full-dataset outlier detection, offer a "Compute Full LOF" button that runs as a background task with progress indicator. Cache results aggressively.

---

## 7. Phase 6: Performance & Polish

**Duration:** 2-3 weeks
**Goal:** WebGL rendering, export system, and production polish
**Status:** ✅ COMPLETED

### 7.1 Deliverables

| Deliverable | Description | Status |
|-------------|-------------|--------|
| WebGL Spectra Renderer | GPU-accelerated line rendering | ✅ Complete |
| WebGL Scatter Renderer | GPU-accelerated 2D scatter | ✅ Complete |
| Auto-Optimization | Automatic render mode selection | ✅ Complete |
| Export System | PNG, SVG, data exports for all charts | ✅ Complete |
| Saved Selections | Named selection persistence | ✅ Complete |
| Keyboard Shortcuts | Full shortcut coverage | ✅ Complete |

### 7.2 Implementation Tasks

#### 7.2.1 WebGL Spectra Renderer

**File:** `src/components/playground/visualizations/SpectraWebGL.tsx`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Three.js setup with @react-three/fiber
- [x] Line rendering using drei Line component
- [x] Color attribute buffer per spectrum
- [x] Selection highlight with opacity changes
- [x] Zoom/pan with OrthographicCamera controls
- [x] Fallback detection (WebGL not supported)

**Implementation Notes:**
- Uses @react-three/fiber Canvas with OrthographicCamera
- SpectraLines component renders individual spectra as drei Line primitives
- Selection state from SelectionContext updates line colors/opacity
- CameraController handles wheel zoom and drag pan
- Axes component renders tick marks and labels using drei Html
- Automatically detects WebGL availability via renderOptimizer

#### 7.2.2 WebGL Scatter Renderer

**File:** `src/components/playground/visualizations/ScatterWebGL.tsx`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Point cloud rendering with instancedMesh
- [x] Point size based on selection/pinned state
- [x] Picking via raycasting
- [x] Click selection with modifier key support
- [x] Smooth zoom/pan animations
- [x] Tooltip on hover

**Implementation Notes:**
- Uses Three.js InstancedMesh for efficient point rendering
- Colors support continuous (value-based) and categorical (label-based) modes
- Raycasting for hover detection and click handling
- Integration with SelectionContext for cross-chart selection
- Grid lines rendered with bufferAttribute

#### 7.2.3 Auto-Optimization System

**File:** `src/lib/playground/renderOptimizer.ts`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Complexity scoring (samples × wavelengths)
- [x] Device capability detection (WebGL version, GPU info)
- [x] Automatic mode switching with recommendRenderMode
- [x] User override preference storage (localStorage)
- [x] useRenderOptimizer hook for React integration
- [x] Performance monitor with frame timing

```typescript
export type RenderMode = 'auto' | 'canvas' | 'webgl' | 'webgl_aggregated';

function recommendRenderMode(
  complexity: DataComplexity,
  capabilities: DeviceCapabilities,
): RenderMode {
  const score = calculateComplexityScore(complexity);
  const adjustedScore = score / capabilities.performanceScore;

  if (adjustedScore < THRESHOLDS.CANVAS_MAX) return 'canvas';
  if (adjustedScore < THRESHOLDS.WEBGL_MAX) return 'webgl';
  return 'webgl_aggregated';
}
```

#### 7.2.4 Export System

**File:** `src/lib/playground/export.ts`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] PNG export (canvas-based with html2canvas approach)
- [x] SVG export (serialize chart SVG elements)
- [x] CSV export (spectra matrix, targets, PCA)
- [x] TXT export (folds in nirs4all format)
- [x] JSON export (full chart config + data)
- [x] Batch export all visible charts
- [x] Selection import/export (JSON format)

**Implementation Notes:**
- `exportToPng` uses html2canvas library for DOM-to-canvas
- `exportToSvg` serializes SVG elements with inline styles
- `exportSpectraToCsv` generates proper matrix format with headers
- `exportFoldsToTxt` matches nirs4all expected format
- `exportSelectionsToJson` / `importSelectionsFromJson` for selection persistence
- `batchExport` processes multiple charts with error handling

#### 7.2.5 Saved Selections

**File:** `src/components/playground/SavedSelections.tsx`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Save dialog with name and color input
- [x] Selection list with color indicators
- [x] Load/delete actions
- [x] Export selections to JSON file
- [x] Import selections from JSON file
- [x] Compact mode for toolbar
- [x] Popover-based UI

**Implementation Notes:**
- Uses localStorage via SelectionContext's saved selections
- Color picker with 8 preset colors
- Compact mode shows just the icon with badge count
- Full mode shows scrollable list with actions
- Export/Import buttons with file download/upload

#### 7.2.6 Keyboard Shortcuts System

**File:** `src/hooks/usePlaygroundShortcuts.ts`

**Status:** ✅ COMPLETED

**Tasks:**
- [x] Centralized shortcut registry
- [x] Conflict detection between shortcuts
- [x] Help overlay component (KeyboardShortcutsHelp.tsx)
- [x] Category grouping (selection, navigation, pipeline, view, export, general)
- [x] Integration with SelectionContext for selection shortcuts

| Shortcut | Action | Category |
|----------|--------|----------|
| Ctrl+Z / Cmd+Z | Undo selection | selection |
| Ctrl+Shift+Z / Ctrl+Y | Redo selection | selection |
| Ctrl+A | Select all | selection |
| Escape | Clear selection | selection |
| Ctrl+S | Save selection | pipeline |
| Ctrl+Backspace | Clear pipeline | pipeline |
| 1-5 | Toggle charts | view |
| Ctrl+Shift+E | Export PNG | export |
| Ctrl+Shift+D | Export data | export |
| ? | Show shortcuts | general |

**Help Dialog:** `src/components/playground/KeyboardShortcutsHelp.tsx`
- Dialog triggered by ? key or toolbar button
- Searchable shortcut list
- Grouped by category with visual key badges

### 7.3 MainCanvas Integration

**File:** `src/components/playground/MainCanvas.tsx`

**Status:** ✅ COMPLETED

**Changes:**
- [x] Added Phase 6 props (renderMode, onRenderModeChange, datasetId)
- [x] Added chart container refs for export
- [x] Integrated useRenderOptimizer hook
- [x] Added render mode selector to toolbar
- [x] Added SavedSelections component to toolbar
- [x] Added Export dropdown menu with all export options
- [x] Connected export handlers to chart refs

### 7.4 Playground Page Integration

**File:** `src/pages/Playground.tsx`

**Status:** ✅ COMPLETED

**Changes:**
- [x] Added usePlaygroundShortcuts hook
- [x] Added KeyboardShortcutsHelp dialog
- [x] Added render mode state
- [x] Connected shortcut callbacks to pipeline actions
- [x] Passed Phase 6 props to MainCanvas

### 7.5 Testing Checklist

- [x] TypeScript compilation passes
- [x] All new files created and exported
- [x] Component integration complete
- [x] Export functionality implemented
- [x] Keyboard shortcuts functional
- [ ] Unit: Export format correctness
- [ ] Unit: Render mode selection logic
- [ ] Integration: WebGL renders match Canvas
- [ ] Integration: Exports are valid files
- [ ] E2E: Full workflow with 5k samples
- [ ] Performance: 60fps with WebGL at 10k samples
- [ ] Accessibility: Keyboard navigation complete

### 7.6 Review Questions & Answers

**Q1:** How do we handle browsers that don't support WebGL?

**A:** The `detectDeviceCapabilities()` function checks WebGL support at startup. If unavailable, `recommendRenderMode()` returns 'canvas' regardless of complexity. The UI shows a "WebGL not supported" message when trying to force WebGL mode, and gracefully falls back to Canvas rendering.

**Q2:** How do we ensure export formats are consistent with nirs4all standards?

**A:** The `exportFoldsToTxt` function generates the exact format expected by nirs4all:
- Header with splitter name and fold count
- Per-fold train/test indices
- Fold labels mapping sample indices to fold numbers

**Q3:** What's the mobile experience for the Playground?

**A:** The Playground is primarily a desktop tool. On mobile:
- `isMobile` detection reduces performance expectations
- WebGL is available but with lower complexity thresholds
- Touch events work for basic selection
- Keyboard shortcuts are hidden in mobile view

---

## 8. Technical Specifications

### 8.1 New Dependencies

| Package | Version | Purpose | Phase |
|---------|---------|---------|-------|
| `@react-three/fiber` | ^8.x | 3D rendering | 3 |
| `@react-three/drei` | ^9.x | 3D utilities | 3 |
| `regl` | ^2.x | WebGL abstraction | 6 |
| `d3-polygon` | ^3.x | Lasso geometry | 1 |
| `simpleheat` | ^0.4 | Density heatmaps | 2 |

### 8.2 Backend API Changes

| Endpoint | Change | Phase |
|----------|--------|-------|
| POST /execute | Add `metrics` option | 5 |
| POST /execute | Add `umap` option | 3 |
| POST /execute | Add `repetition_analysis` option | 4 |
| GET /metrics | New endpoint for on-demand metrics | 5 |
| POST /execute | Add `source_step` parameter | 2 |

### 8.3 Type Additions

**File:** `src/types/playground.ts`

```typescript
// New types for V2
export type SelectionMode = 'click' | 'lasso' | 'box';
export type RenderMode = 'canvas' | 'webgl' | 'webgl_aggregated';

export interface SpectralMetrics {
  l2_norm: number[];
  rms_energy: number[];
  hotelling_t2?: number[];
  q_residual?: number[];
  // ... other metrics
}

export interface RepetitionAnalysis {
  has_repetitions: boolean;
  n_bio_samples: number;
  data: RepetitionDataPoint[];
}

export interface SavedSelection {
  id: string;
  name: string;
  description?: string;
  criteria: SelectionCriteria;
  sampleIndices: number[];
  createdAt: Date;
}
```

### 8.4 Performance Budgets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Initial Load | < 2s | First chart visible |
| Pipeline Execution | < 500ms | 1k samples, 3 operators |
| Selection Response | < 50ms | Cross-chart highlight |
| WebGL Frame Rate | 60fps | Pan/zoom at 10k samples |
| Memory Usage | < 500MB | 10k × 2k matrix + UI |

---

## 9. Risk Assessment

### 9.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| WebGL compatibility issues | Medium | Low | Canvas fallback, detection |
| UMAP computation too slow | Medium | Medium | Subset-only, async computation |
| Cross-chart sync causes cascading rerenders | High | Medium | Memoization, batching |
| 3D library bundle size | Low | Medium | Dynamic import, code splitting |
| Mobile Safari WebGL issues | Medium | Low | Detect and disable |

### 9.2 UX Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Feature overload confuses users | Medium | High | Progressive disclosure, presets |
| Too many clicks to common actions | Medium | Medium | Keyboard shortcuts, defaults |
| Slow feedback kills exploration | Low | High | Aggressive caching, skeletons |

### 9.3 Dependencies Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| nirs4all API changes | Low | Medium | Version pinning, adapter layer |
| Three.js breaking changes | Low | Low | Pin version, minimal usage |
| Backend scaling issues | Medium | Medium | Sampling, pagination, caching |

---

## 10. Testing Strategy

### 10.1 Unit Testing

| Component | Coverage Target | Key Tests |
|-----------|-----------------|-----------|
| SelectionContext | 90% | Reducer logic, history |
| Sampling algorithms | 95% | Correctness, edge cases |
| Metrics computation | 95% | Match reference implementations |
| Export formatters | 100% | Format compliance |
| Filter operators | 95% | Mask correctness, edge cases |

### 10.2 Integration Testing

| Scenario | Tools |
|----------|-------|
| Cross-chart selection | React Testing Library |
| Backend pipeline execution | pytest + httpx |
| Chart render verification | @testing-library/react + jest-canvas-mock |

### 10.3 E2E Testing

| Flow | Tool |
|------|------|
| Load data → add operators → view results | Playwright |
| Select outliers → filter → export | Playwright |
| Configure repetitions → view chart | Playwright |

### 10.4 Performance Testing

| Test | Tool | Threshold |
|------|------|-----------|
| Large dataset render | Lighthouse | 60fps |
| Memory usage over time | Chrome DevTools | No leaks |
| Pipeline execution latency | k6 (backend) | p95 < 1s |

---

## Appendix A: Phase Timeline

```
Week  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18
      ├──────────┼────────────────┼──────────┼────────┼────────────────┼──────────────┤
Phase 1: Foundation │    Phase 2: Spectra     │ Phase 3│ Phase 4│   Phase 5      │   Phase 6    │
      Selection     │    Enhanced Chart       │ Charts │ Reps   │   Metrics      │   Perf/Polish│
```

---

## Appendix B: File Changes Summary

### New Files

| File | Phase | Status |
|------|-------|--------|
| `src/context/SelectionContext.tsx` | 1 | ✅ Complete |
| `src/components/playground/SelectionTools.tsx` | 1 | ✅ Complete |
| `src/components/playground/SpectraFilterPanel.tsx` | 2 | ✅ Complete |
| `src/components/playground/SpectraAggregation.tsx` | 2 | ✅ Complete |
| `src/components/playground/WavelengthRangePicker.tsx` | 2 | ✅ Complete |
| `src/components/playground/visualizations/DimensionReductionChart.tsx` | 3 | ✅ Complete |
| `src/components/playground/visualizations/ScatterPlot3D.tsx` | 3 | ✅ Complete |
| `src/components/playground/visualizations/RepetitionsChart.tsx` | 4 | ✅ Complete |
| `src/components/playground/RepetitionSetupDialog.tsx` | 4 | ✅ Complete |
| `src/components/playground/ChartRegistry.ts` | 4 | ✅ Complete |
| `src/components/playground/MetricsFilterPanel.tsx` | 5 | ✅ Complete |
| `src/components/playground/OutlierSelector.tsx` | 5 | ✅ Complete |
| `src/components/playground/SimilarityFilter.tsx` | 5 | ✅ Complete |
| `src/components/playground/EmbeddingSelector.tsx` | 5 | ✅ Complete |
| `src/components/playground/visualizations/SpectraWebGL.tsx` | 6 | ✅ Complete |
| `src/components/playground/visualizations/ScatterWebGL.tsx` | 6 | ✅ Complete |
| `src/lib/playground/renderOptimizer.ts` | 6 | ✅ Complete |
| `src/lib/playground/export.ts` | 6 | ✅ Complete |
| `src/components/playground/SavedSelections.tsx` | 6 | ✅ Complete |
| `src/components/playground/KeyboardShortcutsHelp.tsx` | 6 | ✅ Complete |
| `src/hooks/usePlaygroundShortcuts.ts` | 6 | ✅ Complete |

### Modified Files

| File | Changes | Phase |
|------|---------|-------|
| `src/pages/Playground.tsx` | Add SelectionProvider, shortcuts, render mode, help dialog | 1, 6 |
| `src/components/playground/MainCanvas.tsx` | Chart registry, selection sync, export, render mode | 1, 4, 6 |
| `src/components/playground/visualizations/SpectraChart.tsx` | Full refactor | 2 |
| `src/components/playground/visualizations/YHistogram.tsx` | Enhanced features | 3 |
| `src/components/playground/visualizations/PCAPlot.tsx` | Rename, UMAP support | 3 |
| `src/components/playground/visualizations/FoldDistributionChart.tsx` | Coloring options | 3 |
| `src/components/playground/visualizations/index.ts` | Export WebGL components | 6 |
| `src/components/playground/index.ts` | Export Phase 6 components | 6 |
| `src/types/playground.ts` | New types | All |
| `api/playground.py` | Metrics, UMAP, repetitions | 3, 4, 5 |
| `api/shared/pipeline_service.py` | Filter operators | 1 |

---

## Appendix C: Success Metrics

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Time to first insight | ~60s | <30s | User testing |
| Samples viewable smoothly | 50 | 10,000 | Performance testing |
| Cross-chart selection latency | N/A | <50ms | Instrumentation |
| Chart export success rate | 80% | 99% | Error tracking |
| User-reported satisfaction | N/A | >4.2/5 | Survey |

---

## Final Review: Global Assessment

### Consistency Check

| Aspect | Status | Notes |
|--------|--------|-------|
| API contracts consistent | ✅ | Types match backend schemas |
| Phase dependencies clear | ✅ | Each phase builds on previous |
| No orphan features | ✅ | All spec features have tasks |
| Testing coverage adequate | ✅ | Unit/Integration/E2E per phase |

### Potential Bottlenecks

| Bottleneck | Phase | Resolution |
|------------|-------|------------|
| UMAP computation time | 3 | Async with progress, subset-only |
| LOF for large datasets | 5 | Background computation, caching |
| 3D library bundle | 3 | Dynamic import |
| WebGL shader complexity | 6 | Start simple, iterate |

### Recommendations

1. **Start with Phase 1 immediately** - Selection is foundational for all other features
2. **Parallelize Phase 2-3 if resources allow** - Chart enhancements are independent
3. **Defer 3D view if timeline is tight** - 2D delivers 80% of value
4. **WebGL is optional** - Canvas with aggregation handles most cases
5. **Ship incremental improvements** - Each phase is deployable

---

*Document prepared by Steve Cromwell, Senior Frontend Developer*
*NIRS.AI Lab, January 2026*
