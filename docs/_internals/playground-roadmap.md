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
- [ ] Update `usePlaygroundPipeline` to handle empty operator array
- [ ] Backend: `/execute` returns raw dataset when `operators=[]`
- [ ] Compute PCA on raw data when no preprocessing is applied
- [ ] Hide step slider when pipeline is empty
- [ ] Show info message: "Visualizing raw data. Add operators to see transformations."
- [ ] Disable comparison mode when no pipeline exists
- [ ] Ensure all charts gracefully handle raw data input

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
- [ ] Create context with reducer pattern
- [ ] Implement history tracking (max 50 entries)
- [ ] Add sessionStorage persistence
- [ ] Create `useSelection` hook
- [ ] Add keyboard shortcuts (Ctrl+Z, Escape, Ctrl+A)

#### 2.2.3 Create Selection Tools

**File:** `src/components/playground/SelectionTools.tsx`

**Tasks:**
- [ ] Implement lasso selection component (SVG path)
- [ ] Implement box selection component
- [ ] Create selection mode toggle (click/lasso/box)
- [ ] Add shift/ctrl modifier handling
- [ ] Integrate with each chart component

#### 2.2.4 Update Chart Components for Selection

**Files:** `SpectraChart.tsx`, `PCAPlot.tsx`, `YHistogram.tsx`, `FoldDistributionChart.tsx`

**Tasks per chart:**
- [ ] Consume SelectionContext
- [ ] Add selection highlight styling
- [ ] Implement selection handlers (click, lasso, box)
- [ ] Add "Filter to Selection" button
- [ ] Add visual indicator for pinned samples

#### 2.2.5 Backend: Filter Operators

**File:** `api/shared/pipeline_service.py`

**Tasks:**
- [ ] Add `filter` operator type to registry
- [ ] Implement `OutlierFilter` operator (T², Q-residual, LOF)
- [ ] Implement `RangeFilter` operator (target range, metadata range)
- [ ] Implement `MetadataFilter` operator (categorical match)
- [ ] Implement `QCFilter` operator (status flags)
- [ ] Update `/operators` endpoint to include filters

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
- [ ] Add 'filter' to UnifiedOperatorType
- [ ] Create FilteringMenu in OperatorPalette
- [ ] Update PipelineBuilder to handle filter operators
- [ ] Add filter-specific UI (shows "N samples removed")

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

**Tasks:**
- [ ] Extract `SpectraChartToolbar` component
- [ ] Extract `SpectraChartCanvas` component (render logic)
- [ ] Create `SpectraChartConfig` state object
- [ ] Implement view mode state machine

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

**Tasks:**
- [ ] Random sampling (client-side, seeded)
- [ ] Request stratified sampling from backend
- [ ] Request coverage (k-means) sampling from backend
- [ ] Implement progressive level-of-detail UI (50/200/1000)

**Backend Tasks:**
- [ ] Add sampling strategy to ExecuteRequest
- [ ] Implement coverage sampling (MiniBatchKMeans centroids)
- [ ] Return sample_indices mapping in response

#### 3.2.3 Implement Metadata Filter Panel

**File:** `src/components/playground/SpectraFilterPanel.tsx`

**Tasks:**
- [ ] Split/fold filter (train/test/fold_k dropdown)
- [ ] Target range filter (dual-handle slider)
- [ ] Metadata column filter (dynamic based on dataset)
- [ ] QC status filter (accepted/rejected/missing)
- [ ] Combine filters with AND logic

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

**Tasks:**
- [ ] Mean ± std band (Area + Line)
- [ ] Median + p5/p95 band
- [ ] Min/max envelope
- [ ] Grouped aggregates (per metadata value)
- [ ] Auto-switch when n > threshold

#### 3.2.5 Implement Wavelength Focus

**File:** `src/components/playground/WavelengthRangePicker.tsx`

**Tasks:**
- [ ] Dual-handle range slider
- [ ] NIR ROI presets (water band, protein, etc.)
- [ ] Edge masking toggle
- [ ] Derivative toggle (1st, 2nd)
- [ ] Persist range in chart config

#### 3.2.6 Source Dataset Selector

**Files:** `PlaygroundSidebar.tsx`, `usePlaygroundPipeline.ts`

**Tasks:**
- [ ] Add "Source Step" dropdown above pipeline
- [ ] Options: Raw, Step 1, Step 2... (based on active operators)
- [ ] Modify backend request to include source_step parameter
- [ ] Update comparison logic in charts

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

### 4.1 Deliverables

| Deliverable | Description |
|-------------|-------------|
| Enhanced Histogram | Coloring modes, ridge plot, KDE overlay |
| Enhanced PCA/UMAP | UMAP support, 3D view, metric coloring |
| Enhanced Folds | Metric coloring, improved interaction |
| Global Partition Selector | Toolbar-level partition filtering |

### 4.2 Implementation Tasks

#### 4.2.1 Target Histogram Enhancements

**File:** `src/components/playground/visualizations/YHistogram.tsx`

**Tasks:**
- [ ] Configurable bin count (auto, 10, 20, 50, custom)
- [ ] Color by metadata column
- [ ] Color by spectral metric (from backend)
- [ ] Stacked fold display mode
- [ ] Ridge plot fold display mode
- [ ] KDE overlay toggle
- [ ] Reference lines (mean, median)

**Ridge Plot Implementation:**
```typescript
// Offset each fold's histogram vertically
const ridgeOffset = (foldIndex: number) => foldIndex * histogramHeight * 0.6;

// Render each fold as separate area with offset
folds.map((fold, i) => (
  <Area
    data={fold.bins}
    y={d => d.count + ridgeOffset(i)}
    fill={getFoldColor(i)}
  />
));
```

#### 4.2.2 PCA/UMAP Enhancements

**File:** `src/components/playground/visualizations/DimensionReductionChart.tsx`

Rename `PCAPlot.tsx` → `DimensionReductionChart.tsx` to reflect dual purpose.

**Tasks:**
- [ ] Add UMAP method option
- [ ] Add 3D view with Three.js (new component)
- [ ] Color by spectral metrics (from backend)
- [ ] Improved tooltip with all sample metadata
- [ ] Axis component selector (any PC/UMAP dim)
- [ ] Aspect ratio enforcement (always square)

**Backend Tasks for UMAP:**
- [ ] Add UMAP computation option to `/execute`
- [ ] Handle UMAP parameters (n_neighbors, min_dist)
- [ ] Cache UMAP results (expensive to compute)

```python
# In playground.py
from umap import UMAP

def _compute_umap(self, X: np.ndarray, y: Optional[np.ndarray], ...) -> Dict:
    reducer = UMAP(n_components=3, n_neighbors=15, min_dist=0.1)
    embedding = reducer.fit_transform(X)
    return {
        "coordinates": embedding.tolist(),
        "method": "umap",
        "n_components": 3,
        ...
    }
```

#### 4.2.3 3D View Component

**File:** `src/components/playground/visualizations/ScatterPlot3D.tsx`

**Tasks:**
- [ ] Three.js scene setup with orbit controls
- [ ] Instanced mesh for performance (>1000 points)
- [ ] Color mapping (continuous/categorical)
- [ ] Selection via raycasting
- [ ] Axis labels and grid
- [ ] Export as PNG (canvas toDataURL)

**Dependencies:**
- `@react-three/fiber`
- `@react-three/drei` (OrbitControls, Text)

#### 4.2.4 Folds Chart Enhancements

**File:** `src/components/playground/visualizations/FoldDistributionChart.tsx`

**Tasks:**
- [ ] Color by mean target value per partition
- [ ] Color by metadata mode per partition
- [ ] Color by mean spectral metric per partition
- [ ] Interactive: click bar → select samples in partition
- [ ] Improved tooltips with partition statistics

#### 4.2.5 Global Partition Selector

**File:** `src/components/playground/PartitionSelector.tsx`

**Tasks:**
- [ ] Toolbar component for partition filtering
- [ ] Options: All, Train, Test, Train/Test, Folds Only
- [ ] Applies to all charts simultaneously
- [ ] Badge showing sample count per selection

### 4.3 Testing Checklist

- [ ] Unit: Ridge plot offset calculation
- [ ] Unit: UMAP result parsing
- [ ] Integration: 3D view renders correctly
- [ ] Integration: Partition selector affects all charts
- [ ] E2E: Switch between PCA/UMAP
- [ ] Performance: 3D view with 5000 points

### 4.4 Review Questions & Answers

**Q1:** How do we handle UMAP's computation time for large datasets?

**A:** UMAP is computed on the sampled subset (same as PCA). For datasets >5000 samples, we warn the user that UMAP may take 10-30 seconds and offer a "Compute UMAP" button rather than auto-computing. Results are cached server-side.

**Q2:** How do we ensure the 3D view is accessible?

**A:** Provide keyboard navigation (arrow keys to rotate, +/- to zoom), maintain a 2D fallback toggle, and ensure color schemes pass WCAG contrast requirements. Screen readers get a textual summary of the distribution.

**Q3:** What happens if a dataset has no Y values for the histogram?

**A:** Hide the histogram chart or show an empty state: "No target values in dataset. Histogram requires Y data." The chart toggle is disabled with a tooltip explanation.

---

## 5. Phase 4: Repetitions & New Charts

**Duration:** 2 weeks
**Goal:** Implement Repetitions chart and prepare for additional views

### 5.1 Deliverables

| Deliverable | Description |
|-------------|-------------|
| Repetitions Chart | Full specification implementation |
| Repetition Detection | Backend auto-detection of repetitions |
| Repetition Setup Dialog | Manual configuration UI |
| Chart Extension API | Clean interface for future charts |

### 5.2 Implementation Tasks

#### 5.2.1 Backend: Repetition Analysis

**File:** `api/playground.py`

**Tasks:**
- [ ] Add repetition detection to `/execute` response
- [ ] Detect from metadata column (configurable)
- [ ] Compute intra-sample distances in PCA space
- [ ] Support multiple distance metrics

```python
def _compute_repetition_analysis(
    self,
    X: np.ndarray,
    sample_ids: List[str],
    bio_sample_column: Optional[str],
    pca_result: Dict,
) -> Dict:
    """Compute repetition variability metrics."""
    # Group by biological sample
    groups = defaultdict(list)
    for idx, sample_id in enumerate(sample_ids):
        bio_id = extract_bio_id(sample_id, bio_sample_column)
        groups[bio_id].append(idx)

    # Compute distances
    results = []
    for bio_id, indices in groups.items():
        if len(indices) < 2:
            continue

        coords = [pca_result["coordinates"][i] for i in indices]
        reference = np.mean(coords, axis=0) if len(indices) > 2 else coords[0]

        for i, idx in enumerate(indices):
            distance = np.linalg.norm(coords[i] - reference)
            results.append({
                "bio_sample": bio_id,
                "rep_index": i,
                "sample_index": idx,
                "distance": distance,
            })

    return {
        "has_repetitions": len(results) > 0,
        "n_bio_samples": len(groups),
        "data": results,
    }
```

#### 5.2.2 Repetitions Chart Component

**File:** `src/components/playground/visualizations/RepetitionsChart.tsx`

**Tasks:**
- [ ] Strip plot: X = bio sample, Y = distance
- [ ] Connect points from same bio sample
- [ ] Color by target, metadata, or metric
- [ ] Distance metric selector (PCA, UMAP, Euclidean, Mahalanobis)
- [ ] Selection → highlight across all charts
- [ ] Tooltip with sample details

```typescript
interface RepetitionsChartProps {
  repetitionData: RepetitionAnalysis;
  distanceMetric: 'pca' | 'umap' | 'euclidean' | 'mahalanobis';
  colorConfig: ColorConfig;
  selectedSamples: Set<number>;
  onSelectSample: (index: number) => void;
}
```

#### 5.2.3 Repetition Setup Dialog

**File:** `src/components/playground/RepetitionSetupDialog.tsx`

**Tasks:**
- [ ] Modal dialog for configuration
- [ ] Auto-detection status display
- [ ] Manual column selection dropdown
- [ ] Pattern-based extraction (regex for sample IDs)
- [ ] Preview of detected groups
- [ ] Save to dataset metadata

#### 5.2.4 Chart Extension API

**File:** `src/components/playground/ChartRegistry.ts`

Create a registry pattern for easy addition of future charts:

```typescript
interface ChartDefinition {
  id: string;
  name: string;
  icon: ComponentType;
  component: ComponentType<BaseChartProps>;
  requiresData: (result: PlaygroundResult) => boolean;
  defaultVisible: boolean;
}

const chartRegistry: ChartDefinition[] = [
  {
    id: 'spectra',
    name: 'Spectra',
    icon: Layers,
    component: SpectraChart,
    requiresData: (r) => r.processed.spectra.length > 0,
    defaultVisible: true,
  },
  // ... other charts
];
```

### 5.3 Testing Checklist

- [ ] Unit: Bio sample ID extraction from patterns
- [ ] Unit: Distance calculations in various metrics
- [ ] Integration: Repetition detection with real data
- [ ] Integration: Chart renders with mock data
- [ ] E2E: Configure repetitions and view chart

### 5.4 Review Questions & Answers

**Q1:** How do we handle datasets where repetitions aren't clearly marked?

**A:** Provide a "Pattern Extraction" mode where users specify a regex to extract the biological sample ID from the full sample ID. Example: `(.+)_rep\d+` extracts "SampleA" from "SampleA_rep1". Show a live preview of extraction results.

**Q2:** What if a biological sample has only 1 measurement (no repetitions)?

**A:** Exclude it from the chart but note it in the legend: "15 samples with repetitions shown (8 samples have no repetitions)". Offer an option to show singleton samples as reference points at distance=0.

**Q3:** How do we visualize many bio samples (100+)?

**A:** Implement horizontal scrolling with a fixed visible window. Alternatively, allow aggregation to show distribution of intra-sample distances as a histogram or boxplot by metadata grouping.

---

## 6. Phase 5: Advanced Filtering & Metrics

**Duration:** 2-3 weeks
**Goal:** Implement spectral metrics system and advanced outlier detection

### 6.1 Deliverables

| Deliverable | Description |
|-------------|-------------|
| Spectral Metrics API | Backend computation of all metrics |
| Metrics Filter Panel | UI for filtering by any metric |
| Outlier Detection | Hotelling T², Q-residual, LOF filters |
| Similarity Filter | Distance-to-reference filtering |
| Embedding Selection | Mini PCA/UMAP for lasso selection |

### 6.2 Implementation Tasks

#### 6.2.1 Backend: Metrics Computation

**File:** `api/playground.py` (new section)

**Tasks:**
- [ ] Create MetricsComputer class
- [ ] Implement all metrics from specification
- [ ] Add caching layer (expensive metrics)
- [ ] Add `/metrics` endpoint for on-demand computation
- [ ] Include basic metrics in `/execute` response

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

**Tasks:**
- [ ] Fetch available metrics from backend
- [ ] Range slider per metric
- [ ] Histogram preview for metric distribution
- [ ] Combine multiple metric filters
- [ ] Preset filters (e.g., "Typical Samples", "Outliers Only")

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

**Tasks:**
- [ ] Method selector (T², Q-residual, Distance, LOF)
- [ ] Threshold slider with distribution preview
- [ ] "Top K" mode (select K most extreme)
- [ ] "Within threshold" mode (select typical)
- [ ] Per-group outliers option
- [ ] Integration with main selection

#### 6.2.4 Similarity Filter

**File:** `src/components/playground/SimilarityFilter.tsx`

**Tasks:**
- [ ] Reference selection (click spectrum or use median)
- [ ] Distance metric selector (Euclidean, Cosine, Correlation)
- [ ] Threshold slider
- [ ] Dual mode: "similar to" vs "different from"
- [ ] Live preview of matching samples

#### 6.2.5 Embedding Selection Overlay

**File:** `src/components/playground/EmbeddingSelector.tsx`

**Tasks:**
- [ ] Mini PCA/UMAP scatter in corner of Spectra chart
- [ ] Lasso/box selection within mini plot
- [ ] Sync with main spectra display
- [ ] Toggle visibility
- [ ] Color by same scheme as main charts

### 6.3 Testing Checklist

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

### 7.1 Deliverables

| Deliverable | Description |
|-------------|-------------|
| WebGL Spectra Renderer | GPU-accelerated line rendering |
| WebGL Scatter Renderer | GPU-accelerated 2D scatter |
| Auto-Optimization | Automatic render mode selection |
| Export System | PNG, SVG, data exports for all charts |
| Saved Selections | Named selection persistence |
| Keyboard Shortcuts | Full shortcut coverage |

### 7.2 Implementation Tasks

#### 7.2.1 WebGL Spectra Renderer

**File:** `src/components/playground/visualizations/SpectraWebGL.tsx`

**Tasks:**
- [ ] regl setup for WebGL context
- [ ] Line rendering shader (instanced)
- [ ] Color attribute buffer
- [ ] Selection highlight shader
- [ ] Zoom/pan with matrix transforms
- [ ] Fallback detection (WebGL not supported)

```typescript
// Shader approach for 10k+ lines
const vertexShader = `
  attribute vec2 position;
  attribute float lineIndex;
  uniform mat3 viewMatrix;
  uniform sampler2D colorTexture;
  varying vec4 vColor;

  void main() {
    gl_Position = vec4((viewMatrix * vec3(position, 1.0)).xy, 0.0, 1.0);
    vColor = texture2D(colorTexture, vec2(lineIndex / numLines, 0.5));
  }
`;
```

#### 7.2.2 WebGL Scatter Renderer

**File:** `src/components/playground/visualizations/ScatterWebGL.tsx`

**Tasks:**
- [ ] Point cloud rendering
- [ ] Point size based on selection
- [ ] Picking via offscreen render
- [ ] Lasso selection in screen space
- [ ] Smooth animations for transitions

#### 7.2.3 Auto-Optimization System

**File:** `src/lib/playground/renderOptimizer.ts`

**Tasks:**
- [ ] Complexity scoring (samples × wavelengths)
- [ ] Device capability detection
- [ ] Automatic mode switching
- [ ] User override preference storage
- [ ] Performance telemetry (optional)

```typescript
function recommendRenderMode(
  nSamples: number,
  nWavelengths: number,
  deviceScore: number,
): RenderMode {
  const complexity = nSamples * nWavelengths;
  const adjustedComplexity = complexity / deviceScore;

  if (adjustedComplexity < 50_000) return 'canvas';
  if (adjustedComplexity < 500_000) return 'webgl';
  return 'webgl_aggregated';
}
```

#### 7.2.4 Export System

**File:** `src/lib/playground/export.ts`

**Tasks:**
- [ ] PNG export (html2canvas or native)
- [ ] SVG export (serialize chart SVG)
- [ ] CSV export (spectra matrix)
- [ ] TXT export (folds in nirs4all format)
- [ ] JSON export (full chart config + data)
- [ ] Batch export all visible charts

#### 7.2.5 Saved Selections

**File:** `src/components/playground/SavedSelections.tsx`

**Tasks:**
- [ ] Save dialog (name, description)
- [ ] Selection list panel
- [ ] Load/delete/rename actions
- [ ] Export selections to JSON
- [ ] Import selections from JSON

#### 7.2.6 Keyboard Shortcuts System

**File:** `src/hooks/usePlaygroundShortcuts.ts`

**Tasks:**
- [ ] Centralized shortcut registry
- [ ] Conflict detection
- [ ] Help overlay (? key)
- [ ] Customizable shortcuts (future)

| Shortcut | Action |
|----------|--------|
| Ctrl+Z / Cmd+Z | Undo |
| Ctrl+Shift+Z | Redo |
| Ctrl+A | Select all |
| Escape | Clear selection |
| Ctrl+S | Save selection |
| Delete | Remove operator |
| 1-5 | Toggle charts |
| ? | Show shortcuts |

### 7.3 Testing Checklist

- [ ] Unit: Export format correctness
- [ ] Unit: Render mode selection logic
- [ ] Integration: WebGL renders match Canvas
- [ ] Integration: Exports are valid files
- [ ] E2E: Full workflow with 5k samples
- [ ] Performance: 60fps with WebGL at 10k samples
- [ ] Accessibility: Keyboard navigation complete

### 7.4 Review Questions & Answers

**Q1:** How do we handle browsers that don't support WebGL?

**A:** Check WebGL support at startup. If unavailable, hide the WebGL toggle and use Canvas mode exclusively. Show an informational tooltip explaining why WebGL is unavailable. Never break functionality—degrade gracefully.

**Q2:** How do we ensure export formats are consistent with nirs4all standards?

**A:** Define format schemas that match nirs4all's expected inputs:
- Spectra CSV: First row = wavelengths, subsequent rows = sample_id + values
- Folds TXT: One line per fold, comma-separated indices
- Test against nirs4all's data loaders in CI

**Q3:** What's the mobile experience for the Playground?

**A:** The Playground is primarily a desktop tool. On mobile:
- Single-chart view with swipe navigation
- Touch-friendly lasso (simplified to tap-select)
- Reduced default sample count
- WebGL disabled by default (battery/heat concerns)

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

| File | Phase |
|------|-------|
| `src/context/SelectionContext.tsx` | 1 |
| `src/components/playground/SelectionTools.tsx` | 1 |
| `src/components/playground/SpectraFilterPanel.tsx` | 2 |
| `src/components/playground/SpectraAggregation.tsx` | 2 |
| `src/components/playground/WavelengthRangePicker.tsx` | 2 |
| `src/components/playground/visualizations/DimensionReductionChart.tsx` | 3 |
| `src/components/playground/visualizations/ScatterPlot3D.tsx` | 3 |
| `src/components/playground/visualizations/RepetitionsChart.tsx` | 4 |
| `src/components/playground/RepetitionSetupDialog.tsx` | 4 |
| `src/components/playground/ChartRegistry.ts` | 4 |
| `src/components/playground/MetricsFilterPanel.tsx` | 5 |
| `src/components/playground/OutlierSelector.tsx` | 5 |
| `src/components/playground/SimilarityFilter.tsx` | 5 |
| `src/components/playground/EmbeddingSelector.tsx` | 5 |
| `src/components/playground/visualizations/SpectraWebGL.tsx` | 6 |
| `src/components/playground/visualizations/ScatterWebGL.tsx` | 6 |
| `src/lib/playground/renderOptimizer.ts` | 6 |
| `src/lib/playground/export.ts` | 6 |
| `src/components/playground/SavedSelections.tsx` | 6 |
| `src/hooks/usePlaygroundShortcuts.ts` | 6 |

### Modified Files

| File | Changes | Phase |
|------|---------|-------|
| `src/pages/Playground.tsx` | Add SelectionProvider, new state | 1 |
| `src/components/playground/MainCanvas.tsx` | Chart registry, selection sync | 1, 4 |
| `src/components/playground/visualizations/SpectraChart.tsx` | Full refactor | 2 |
| `src/components/playground/visualizations/YHistogram.tsx` | Enhanced features | 3 |
| `src/components/playground/visualizations/PCAPlot.tsx` | Rename, UMAP support | 3 |
| `src/components/playground/visualizations/FoldDistributionChart.tsx` | Coloring options | 3 |
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
