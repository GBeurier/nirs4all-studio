# Playground V1 Specifications

**Date**: January 2026
**Author**: Greg (Senior Full-Stack Developer)
**Status**: Final

**Related Documents**:
- [Playground State Review](./PLAYGROUND_STATE_REVIEW.md)
- [nirs4all Backend Capabilities](./NIRS4ALL_BACKEND_CAPABILITIES.md)
- [Implementation Roadmap](./PLAYGROUND_IMPLEMENTATION_ROADMAP.md)

---

## 1. Overview

### 1.1 Purpose

The Playground is a **real-time spectral data exploration tool** enabling users to:

1. **Load** spectral datasets (upload, workspace, or demo)
2. **Build** preprocessing pipelines (drag-and-drop operators)
3. **Visualize** before/after effects instantly
4. **Iterate** rapidly with parameter adjustments
5. **Export** validated pipelines to Pipeline Editor

### 1.2 Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Performance** | <200ms response for typical datasets; sampling for large data |
| **Accuracy** | Use nirs4all operators (backend), not JS approximations |
| **Extensibility** | Leverage nirs4all's pipeline infrastructure (StepRunner, controllers) |
| **Consistency** | Unified operator format with Pipeline Editor |
| **Maintainability** | Single operator registry; shared components where possible |

### 1.3 Scope (V1)

**In Scope**:
- Preprocessing operators (transforms)
- Splitters (cross-validation, train/test split) with fold visualization
- Before/after comparison at each step

**Out of Scope (V1)**:
- Model training or evaluation
- Multi-branch pipelines
- Y-processing (target transforms)
- Generator sweeps
- Saving/loading playground sessions (V2)

---

## 2. User Stories

### 2.1 Primary Use Cases

**US-1**: As a data scientist, I want to load my NIR dataset and immediately see the spectra, so I can verify data quality.

**US-2**: As a data scientist, I want to add preprocessing operators and see the effect in real-time, so I can iterate quickly.

**US-3**: As a data scientist, I want to compare before/after for each operator, so I can understand transform effects.

**US-4**: As a data scientist, I want to adjust operator parameters with sliders, so I can fine-tune without typing.

**US-5**: As a data scientist, I want to export my preprocessing chain to the Pipeline Editor, so I can use it in training.

**US-6**: As a data scientist, I want to add splitters to my pipeline and see the resulting fold distribution, so I can validate my cross-validation strategy.

### 2.2 Secondary Use Cases

**US-7**: I want to color spectra by target value, so I can see concentration patterns.

**US-8**: I want to focus on specific wavelength ranges, so I can explore regions of interest.

**US-9**: I want to see PCA projection, so I can identify clusters or outliers.

**US-10**: I want to undo/redo changes, so I can experiment freely.

**US-11**: I want to see how different splitters (KFold, SPXY, ShuffleSplit) partition my data, so I can choose the best strategy for my use case.

---

## 3. Functional Specifications

### 3.1 Data Loading

#### 3.1.1 Data Sources

| Source | Description | Priority |
|--------|-------------|----------|
| CSV Upload | Drag-drop or click to upload | P0 |
| Demo Data | Synthetic NIR spectra | P0 |
| Workspace Dataset | Select from workspace | P1 |

#### 3.1.2 Supported Formats

**CSV Format** (primary):
```csv
sample_id,1100,1105,1110,...,2500,target
S001,0.42,0.43,0.45,...,0.38,15.2
S002,0.45,0.46,0.47,...,0.41,22.1
```

- First row: wavelengths (numeric headers) or column names
- Columns named `y`, `target`, or `reference` → Y values
- Non-numeric first column → sample IDs

**Size Limits**:
- Max file size: 50MB
- Max samples: 10,000 (sampling applied above)
- Max wavelengths: 4,000

#### 3.1.3 Data Validation

On load, display:
- Sample count
- Wavelength range and count
- Y value range (if present)
- Warnings for missing values, duplicates

### 3.2 Pipeline Builder

#### 3.2.1 Operator Palette

Categories (aligned with Pipeline Editor):
- **Scatter Correction**: SNV, MSC
- **Derivatives**: Savitzky-Golay, First/Second Derivative
- **Baseline**: Detrend, Baseline, ALS variants
- **Scaling**: Normalize, StandardScaler, MinMaxScaler
- **Features**: Crop, Resample
- **Splitters**: KFold, ShuffleSplit, StratifiedKFold, GroupKFold, KennardStone, SPXY

Display: Grid of operator cards with icons and tooltips.

**Splitter Behavior**: When a splitter is added, the backend generates fold assignments which are visualized in the Fold Distribution chart. Multiple splitters in the same pipeline are not allowed (last one wins).

#### 3.2.2 Pipeline Steps

- Add: Click operator in palette → appends to pipeline
- Remove: Click × on step
- Reorder: Drag-and-drop
- Enable/Disable: Toggle switch per step
- Configure: Expand step to show parameters

#### 3.2.3 Parameter Configuration

| Param Type | Control | Example |
|------------|---------|---------|
| Integer | Slider + input | window_length: 5-51 |
| Float | Slider + input | sigma: 0.1-10.0 |
| Enum | Dropdown | method: "mean" / "median" |
| Boolean | Toggle | with_mean: true/false |
| Range | Dual slider | crop: [1100, 2000] |

**Constraints**: Validate in real-time, show inline errors.

#### 3.2.4 History

- Undo: Ctrl+Z (last 50 actions)
- Redo: Ctrl+Shift+Z
- Clear pipeline: Button with confirmation

### 3.3 Visualizations

#### 3.3.1 Chart Types

| Chart | Description | Default |
|-------|-------------|---------|
| **Spectra** | Overlaid line chart (before/after) | ✓ Visible |
| **Y Distribution** | Histogram of target values | ✓ Visible |
| **PCA Plot** | 2D scatter of PC1 vs PC2 | ✓ Visible |
| **Fold Distribution** | Split visualization (train/test per fold) | ✓ Visible (when splitter present) |
| **Statistics** | Mean ± std spectrum band | Hidden |
| **Difference** | Per-sample before/after difference | Hidden |

#### 3.3.2 Fold Distribution Chart

When a splitter is in the pipeline, this chart shows:
- **Bar chart**: Sample counts per fold (train vs test)
- **Scatter overlay on PCA**: Points colored by fold assignment
- **Y-distribution per fold**: Boxplot showing target distribution across folds
- **Toggle**: Show all folds / Single fold selector

This visualization helps users:
- Validate stratification is working
- Identify unbalanced splits
- Compare splitter strategies (e.g., KFold vs SPXY)

#### 3.3.3 Chart Controls

**Global**:
- Show/hide each chart type (toggle buttons)
- Color mode: By target / By metadata / By fold / Single color
- Sample subset: All / Random N / Stratified N / K-means

**Per-chart**:
- Spectra: Show original / Show processed / Both
- Spectra: Brush for wavelength zoom
- PCA: PC axis selection (PC1-PC2, PC1-PC3, etc.)
- PCA: Color by fold when splitter is active
- Histogram: Bin count slider
- Fold Distribution: Fold selector (all / specific fold)

#### 3.3.4 Interactivity

- Hover: Tooltip with sample info (includes fold assignment if splitter present)
- Click: Select sample (highlights across charts)
- Brush: Zoom to wavelength range
- Pan: Shift+drag
- Fold click: Filter to show only samples from that fold

#### 3.3.5 Performance Targets

| Metric | Target |
|--------|--------|
| Initial render | <500ms |
| Parameter change → chart update | <200ms |
| Chart interaction (hover, click) | <50ms |

### 3.4 Export

#### 3.4.1 Export to Pipeline Editor

Button: "Open in Pipeline Editor"
- Creates new pipeline in editor with current operators
- Converts playground format → editor format
- Opens editor in new tab/navigation

#### 3.4.2 Import from Pipeline Editor

Button: "Load from Pipeline Editor" (or URL parameter `?source=pipeline&id=xxx`)
- Loads existing pipeline from editor into playground
- Filters to supported operators (preprocessing + splitters only)
- Shows warning if pipeline contains unsupported steps (models, branches, generators)
- Converts editor format → playground format

**Unsupported features handling**:
- Models: Ignored with warning "Models cannot be visualized in Playground"
- Branches: First branch only, with warning
- Generators/sweeps: First variant only, with warning
- Y-processing: Ignored (V1)

#### 3.4.3 Export as Configuration

Button: "Download Pipeline JSON"
- nirs4all-compatible format
- Can be loaded in Pipeline Editor or used in Python

```json
{
  "name": "Playground Export",
  "pipeline": [
    {"name": "StandardNormalVariate", "params": {}},
    {"name": "SavitzkyGolay", "params": {"window_length": 11, "polyorder": 2}}
  ]
}
```

#### 3.4.3 Export Data

- Download processed CSV
- Download spectra chart as PNG/SVG

---

## 4. Technical Specifications

### 4.1 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
├──────────────────┬──────────────────┬───────────────────────┤
│  PlaygroundPage  │  usePipeline     │  Visualizations       │
│  (orchestrator)  │  (state/logic)   │  (SpectraChart, etc.) │
└────────┬─────────┴────────┬─────────┴───────────┬───────────┘
         │                  │                      │
         │ data load        │ execute pipeline     │ render
         ▼                  ▼                      ▼
┌─────────────────────────────────────────────────────────────┐
│                  usePlaygroundQuery                          │
│  (React Query hook - debounced API calls)                   │
└─────────────────────────────┬───────────────────────────────┘
                              │ POST /api/playground/execute
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Backend API                             │
├─────────────────────────────────────────────────────────────┤
│  api/playground.py                                          │
│  - PlaygroundExecutor (lightweight pipeline runner)         │
│  - Uses nirs4all StepParser + StepRunner                    │
│  - Captures intermediate states for visualization           │
│  - Statistics computation                                    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                nirs4all Pipeline Infrastructure              │
├─────────────────────────────────────────────────────────────┤
│  - StepParser: Parses pipeline step definitions             │
│  - StepRunner: Executes steps via controller routing        │
│  - Controllers: TransformController, SplitterController     │
│  - SpectroDataset: Data container with fold support         │
└─────────────────────────────────────────────────────────────┘
```

**Why use nirs4all pipeline infrastructure instead of direct sklearn calls?**

| Approach | Pros | Cons |
|----------|------|------|
| Direct sklearn | Minimal overhead | Misses nirs4all-specific operators, no splitter support, maintenance divergence |
| `nirs4all.run()` | Full compatibility | Too much overhead (workspace, artifacts, predictions) |
| **StepRunner + StepParser** | Full operator compatibility, extensible, splitter support | Slightly more setup |

The **StepRunner** approach provides:
1. **Controller routing**: Automatic selection of TransformController, SplitterController, etc.
2. **Operator resolution**: Works with all nirs4all operators including custom ones
3. **Fold management**: Splitters update dataset.folds automatically
4. **No artifact overhead**: Skip persistence layer for preview mode

### 4.2 State Management

```typescript
interface PlaygroundState {
  // Data
  data: SpectralData | null;
  dataSource: "upload" | "demo" | "dataset";
  datasetId?: string;

  // Pipeline
  operators: PipelineOperator[];

  // Processing (from backend)
  processedData: ProcessedData | null;
  statistics: DataStatistics | null;
  isProcessing: boolean;
  processingError: string | null;

  // UI
  visibleCharts: Set<ChartType>;
  colorConfig: ColorConfig;
  selectedSampleIndex: number | null;
  subsetConfig: SubsetConfig;

  // History
  history: HistoryEntry[];
  historyIndex: number;
}
```

### 4.3 API Contract

#### 4.3.1 Execute Pipeline

**Request**:
```typescript
POST /api/playground/execute

interface ExecuteRequest {
  data: {
    source: "inline" | "dataset";
    dataset_id?: string;
    X?: number[][];           // If inline
    wavelengths?: number[];
    y?: number[];
  };
  pipeline: {
    type: "preprocessing" | "splitting";  // Operator category
    name: string;             // Operator class name
    params: Record<string, unknown>;
    enabled: boolean;
  }[];
  options: {
    // Sampling
    max_samples: number;      // Default: 500
    sampling_method: "stratified" | "random" | "first" | "kmeans";

    // Statistics
    return_statistics: boolean;   // Stats computed on FULL dataset

    // PCA
    compute_pca: boolean;
    pca_components: number;       // Default: 3
    pca_mode: "full" | "subset"; // Default: "full" - compute on full, return for subset

    // Payload controls (V1.1 - optional, for performance tuning)
    max_wavelengths_returned?: number;  // Downsample for visualization only
    max_folds_returned?: number;        // Limit fold details for large n_splits
    split_index?: number;               // For ShuffleSplit: which split to return labels for
  };
}
```

**Response**:
```typescript
interface ExecuteResponse {
  success: boolean;
  execution_time_ms: number;

  // Counts
  total_samples: number;
  samples_returned: number;
  sample_indices: number[];   // Which samples were selected

  // Wavelengths
  wavelengths: number[];
  wavelengths_original?: number[];  // If crop was applied

  // Spectra (subset)
  original: number[][];
  processed: number[][];

  // Targets
  y: number[];

  // Fold information (if splitter present)
  folds?: {
    n_splits: number;
    splitter_name: string;
    splitter_params: Record<string, unknown>;

    // Summary stats per fold (scalable, always returned)
    summary: {
      fold: number;
      train_count: number;
      test_count: number;
      train_y_stats?: { mean: number; std: number; min: number; max: number };
      test_y_stats?: { mean: number; std: number; min: number; max: number };
    }[];

    // Per-sample fold labels for PCA coloring (aligned with sample_indices)
    // Value = test fold index for that sample, or -1 if sample is not in returned subset
    // For ShuffleSplit-like splitters, use options.split_index to select which split
    fold_labels?: number[];

    // Full index arrays (optional, only if explicitly requested or n_splits <= 10)
    assignments?: {
      fold: number;
      train_indices: number[];
      test_indices: number[];
    }[];
  };

  // Statistics (full dataset)
  statistics?: {
    original: SpectrumStats;
    processed: SpectrumStats;
  };

  // PCA (full dataset)
  pca?: {
    projection: number[][];          // N × n_components
    explained_variance: number[];
  };

  // Execution trace (for debugging and UX feedback)
  trace: {
    step: number;
    name: string;
    type: "preprocessing" | "splitting";
    time_ms: number;
    input_shape: [number, number];   // [n_samples, n_features]
    output_shape: [number, number];
    warnings: string[];
  }[];

  // Errors
  applied_steps: string[];
  step_errors: { step: number; name: string; error: string }[];
}

/**
 * Data Semantics (IMPORTANT):
 * - `original`, `processed`: SUBSET only (aligned with sample_indices)
 * - `y`: SUBSET only (aligned with sample_indices)
 * - `statistics`: Computed on FULL dataset for accuracy
 * - `pca.projection`: SUBSET only (aligned with sample_indices)
 * - `folds.summary`: Computed on FULL dataset
 * - `folds.fold_labels`: SUBSET only (aligned with sample_indices)
 */

interface SpectrumStats {
  mean: number[];      // Per-wavelength mean
  std: number[];       // Per-wavelength std
  min: number[];       // Per-wavelength min
  max: number[];       // Per-wavelength max
  global_range: [number, number];  // [global_min, global_max] across all samples
  percentiles?: {      // Optional quantile data for robust visualization
    p5: number[];
    p95: number[];
  };
}
```

### 4.4 Operator Format Alignment

**Unified format** (shared with Pipeline Editor):

```typescript
interface UnifiedOperator {
  id: string;
  type: "preprocessing" | "splitting";  // Operator category
  name: string;                          // PascalCase: "StandardNormalVariate", "KFold"
  params: Record<string, unknown>;
  enabled: boolean;
}
```

**Conversion** from legacy playground format:

```typescript
const OPERATOR_ALIASES = {
  // Preprocessing
  snv: "StandardNormalVariate",
  msc: "MultiplicativeScatterCorrection",
  savgol: "SavitzkyGolay",
  // Splitters
  kfold: "KFold",
  shuffle: "ShuffleSplit",
  spxy: "SPXY",
  ks: "KennardStone",
  // ...
};
```

### 4.5 Performance Optimizations

#### 4.5.1 Debouncing Strategy

**General debounce**: 150ms for pipeline structure changes (add/remove/reorder operators).

**Slider-specific handling**: Sliders should NOT trigger API calls on every tick:
- Update local UI immediately (show preview value)
- Trigger API call only on `onValueCommit` (mouse release / keyboard blur)
- Or use longer debounce (300-400ms) specifically for sliders
- This prevents request storms during rapid slider movement

```typescript
// Recommended pattern
const handleSliderChange = (value: number) => {
  // Immediate: update local display
  setLocalValue(value);
};

const handleSliderCommit = (value: number) => {
  // Commit: update pipeline state (triggers debounced query)
  updateOperatorParam(operatorId, paramName, value);
};
```

#### 4.5.2 Request Cancellation

Use AbortController to cancel in-flight requests when new change occurs.

#### 4.5.3 Caching

**Frontend caching** (React Query):
- **Cache key**: Stable hash of `(data.fingerprint, pipelineHash, optionsHash)`
- **Important**: Do NOT use object identity in query key (causes cache misses)
- **Stale time**: 5 minutes
- **Keep previous data**: Show old charts while new request loads

```typescript
// ✅ Correct: use stable hashes
queryKey: ["playground", data.fingerprint, hashPipeline(operators), hashOptions(options)]

// ❌ Wrong: object identity causes cache misses
queryKey: ["playground", data, operators, options]
```

**Backend caching** (LRU with TTL):
- **Cache key**: `hash(dataset_id || X_fingerprint, pipeline_config, options)`
- **TTL**: 5-10 minutes (aligns with frontend staleTime)
- **Size limit**: ~100 entries (typical workspace usage)
- **Benefits**: Repeated queries (across users, undo/redo) return instantly
- **Invalidation**: On dataset change (if watching for changes)

#### 4.5.4 Response Optimization

**V1 uses single HTTP response** (not streaming). To optimize perceived latency:

1. **Server-side compute order**: Compute cheap parts first (stats, subset extraction) before expensive parts (PCA)
2. **Frontend skeleton**: Show loading skeleton immediately on request start
3. **keepPreviousData**: React Query keeps previous charts visible while new data loads

**Compute priority order** (server-side):
1. Statistics (cheap, ~10ms) - enables mean±std envelope
2. Subset extraction (~5ms) - enables spectra chart
3. Fold summary (~5ms) - enables fold distribution chart
4. PCA projection (~50-100ms) - enables PCA chart

**Future (V2)**: Consider SSE/WebSocket for true progressive delivery if latency targets not met.

### 4.6 Per-Step Comparison Strategy

**User story US-3** requires comparing before/after for each operator.

**Implementation**: The API returns only original and final processed arrays (not all intermediates) to avoid large payloads. Per-step comparison is achieved by:

1. **Pipeline slicing**: Frontend can request "preview at step k" by sending only steps 0..k
2. **Re-execution**: Backend re-executes the truncated pipeline (cached if same prefix)
3. **UI pattern**: "Step-through" mode where user clicks through steps sequentially

**Why not return all intermediates?**
- Memory: N steps × M samples × W wavelengths = potentially GBs
- Latency: Serializing all intermediates adds significant overhead
- Typical use: Users inspect 1-2 steps, not all simultaneously

**Alternative (V1.1)**: Add `options.return_intermediate_at?: number` to return one specific intermediate state alongside final.

### 4.7 Error Handling

| Scenario | User Feedback |
|----------|--------------|
| Invalid parameter | Inline error on input, prevent submit |
| Operator failure | Toast notification, skip step, mark in pipeline |
| Network error | Retry button, use cached data if available |
| Large dataset | Warning, auto-apply sampling |
| Timeout | Show partial results, suggest reducing data |

---

## 5. UI/UX Specifications

### 5.1 Layout

```
┌────────────────────────────────────────────────────────────────┐
│ [Logo] Playground                              [Help] [Export] │
├───────────────────┬────────────────────────────────────────────┤
│                   │                                            │
│   Data Loading    │                                            │
│   ─────────────   │          Visualization Grid               │
│   [Upload] [Demo] │                                            │
│                   │    ┌──────────────┐  ┌──────────────┐      │
│   Operator Palette│    │   Spectra    │  │  Histogram   │      │
│   ─────────────── │    │              │  │              │      │
│   [SNV] [MSC] ... │    └──────────────┘  └──────────────┘      │
│                   │    ┌──────────────┐  ┌──────────────┐      │
│   Active Pipeline │    │     PCA      │  │  Statistics  │      │
│   ─────────────── │    │              │  │              │      │
│   1. SNV     [×]  │    └──────────────┘  └──────────────┘      │
│   2. SavGol  [×]  │                                            │
│      └─ window:11 │                                            │
│   [+ Add Step]    │    [Chart Controls: Show/Hide, Colors]     │
│                   │                                            │
│   [Undo] [Redo]   │                                            │
│   [Clear]         │                                            │
└───────────────────┴────────────────────────────────────────────┘
```

### 5.2 Responsive Behavior

| Breakpoint | Sidebar | Charts |
|------------|---------|--------|
| Desktop (>1200px) | 280px fixed | 2×2 grid |
| Tablet (768-1200px) | 240px fixed | 2×1 stack |
| Mobile (<768px) | Collapsible drawer | 1×1 stack |

### 5.3 Theme

Follow existing app theme (dark mode default):
- Background: `hsl(var(--background))`
- Cards: `hsl(var(--card))`
- Primary: `hsl(var(--primary))`
- Chart colors: Existing spectral palette

### 5.4 Accessibility

- Keyboard navigation for pipeline builder
- ARIA labels on chart interactions
- High contrast mode for charts
- Screen reader support for statistics

---

## 6. Testing Requirements

### 6.1 Unit Tests

- Operator format conversion
- Debounce logic
- Statistics computation
- PCA projection

### 6.2 Integration Tests

- Full pipeline execution (frontend → backend)
- Error handling scenarios
- Large dataset handling

### 6.3 E2E Tests

- Load demo data → add operators → verify chart update
- Export to Pipeline Editor
- Undo/redo functionality

### 6.4 Performance Tests

- 500 samples × 2000 wavelengths: <200ms total response
- 5000 samples: <500ms with sampling
- Memory usage under 100MB frontend

---

## 7. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| API response time (p95) | <300ms | Backend logs |
| Chart render time | <100ms | Performance.mark |
| Error rate | <1% | Error tracking |
| User satisfaction | >4/5 | Feedback survey |

---

## 8. Dependencies

### 8.1 Frontend

- React Query (TanStack Query) - API state management
- Recharts or ECharts - Visualization (evaluate performance)
- dnd-kit - Drag and drop (already used)

### 8.2 Backend

- FastAPI - Already in use
- nirs4all - Operator execution
- numpy - Statistics, PCA
- scikit-learn - PCA implementation

---

## 9. Open Questions (To Be Resolved in Planning)

| Question | Options | Recommendation |
|----------|---------|----------------|
| Chart library | Recharts / ECharts / visx | Evaluate ECharts for WebGL |
| Real-time transport | HTTP + debounce / WebSocket | HTTP for V1, WebSocket V2 |
| State persistence | None / localStorage / URL params | localStorage for V1 |
| Shared components | New / Reuse Pipeline Editor | Reuse operator registry only |

---

## 10. Future Considerations (V2+)

- **Session persistence**: Save/load playground configurations
- **Multi-dataset comparison**: Load two datasets side-by-side
- **Y-processing preview**: Show effect on targets
- **Outlier flagging**: Mark samples exceeding thresholds
- **Custom operator upload**: User-defined Python transforms
- **Collaboration**: Share playground state via link

---

## 11. Appendix: Operator Reference

### 11.1 Preprocessing Operators

| Operator | Params | Notes |
|----------|--------|-------|
| StandardNormalVariate | - | Row-wise standardization |
| MultiplicativeScatterCorrection | reference: mean/median | Scatter correction |
| SavitzkyGolay | window_length, polyorder, deriv | Smoothing/derivative |
| FirstDerivative | - | Alias for SG deriv=1 |
| SecondDerivative | - | Alias for SG deriv=2 |
| Detrend | order | Polynomial detrending |
| Baseline | method, lam, p | Baseline subtraction |
| Gaussian | sigma, order | Gaussian smoothing |
| Normalize | method: l2/max/minmax | Normalization |
| StandardScaler | with_mean, with_std | Column-wise standardization |
| MinMaxScaler | feature_range | Min-max scaling |
| CropTransformer | start, end | Wavelength selection |
| ResampleTransformer | n_features | Resampling |

### 11.2 Splitter Operators

| Operator | Params | Notes |
|----------|--------|-------|
| KFold | n_splits, shuffle, random_state | Standard k-fold CV |
| StratifiedKFold | n_splits, shuffle, random_state | Stratified by target |
| ShuffleSplit | n_splits, test_size, random_state | Random train/test splits |
| GroupKFold | n_splits | Group-aware k-fold |
| GroupShuffleSplit | n_splits, test_size, random_state | Group-aware shuffle |
| KennardStone | n_train, metric | Kennard-Stone selection |
| SPXY | n_train, metric | Sample set partitioning |
| LeaveOneOut | - | Leave-one-out CV |

### 11.3 Backend Implementation with nirs4all Pipeline

```python
# api/playground.py - Using nirs4all pipeline infrastructure

from nirs4all.pipeline.steps import StepParser, StepRunner
from nirs4all.pipeline.config.context import ExecutionContext, DataSelector, PipelineState
from nirs4all.data.dataset import SpectroDataset

class PlaygroundExecutor:
    """Lightweight pipeline executor for playground preview mode.

    Uses nirs4all's StepRunner for operator execution, but skips
    artifact persistence and prediction collection.
    """

    def __init__(self):
        self.parser = StepParser()
        self.step_runner = StepRunner(
            parser=self.parser,
            verbose=0,
            mode="preview"  # No artifact saving
        )

    def execute(self, dataset: SpectroDataset, steps: list) -> dict:
        """Execute pipeline steps and capture intermediate states."""
        results = {"original": dataset.x({}, layout="2d").copy()}

        # Initialize context
        context = ExecutionContext(
            selector=DataSelector(partition="all", layout="2d"),
            state=PipelineState(mode="preview"),
            metadata={}
        )

        # Execute each step
        for i, step_config in enumerate(steps):
            if not step_config.get("enabled", True):
                continue

            # Use StepRunner for controller routing
            step_result = self.step_runner.execute(
                step=step_config,
                dataset=dataset,
                context=context,
                runtime_context=None  # No artifact persistence
            )
            context = step_result.updated_context

        results["processed"] = dataset.x({}, layout="2d")
        results["folds"] = dataset.folds if hasattr(dataset, 'folds') else None

        return results
```
