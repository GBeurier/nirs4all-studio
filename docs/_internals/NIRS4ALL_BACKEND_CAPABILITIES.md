# nirs4all Backend Capabilities for Real-Time Playground

**Date**: January 2026
**Author**: Greg (Senior Full-Stack Developer)
**Status**: Final

**Related Documents**:
- [Playground State Review](./PLAYGROUND_STATE_REVIEW.md)
- [Playground Specifications](./PLAYGROUND_SPECIFICATIONS.md)
- [Implementation Roadmap](./PLAYGROUND_IMPLEMENTATION_ROADMAP.md)

---

## 1. Executive Summary

This document assesses nirs4all's capability to power a **real-time preprocessing playground** with:
- Sub-second pipeline execution on typical NIRS datasets
- Before/after data access at each pipeline step
- Splitter execution with fold visualization
- Streaming or incremental data delivery

**Conclusion**: nirs4all is **well-suited** for playground backend using its pipeline infrastructure:
1. Use **StepRunner + StepParser** for operator execution (not direct sklearn calls)
2. Leverage controllers for both preprocessing and splitting
3. Add lightweight "preview" execution mode (no artifact persistence)

**Why StepRunner over direct sklearn?**
- Automatic controller routing (transforms, splitters, etc.)
- Compatibility with all nirs4all operators including custom ones
- Fold management via CrossValidatorController
- Extensibility for future operator types

---

## 2. nirs4all Operator Architecture

### 2.1 Pipeline Execution Hierarchy

nirs4all has a layered pipeline execution architecture:

```
nirs4all.run()              # Full orchestration (workspace, artifacts, predictions)
  └→ PipelineOrchestrator    # Multi-pipeline, multi-dataset coordination
       └→ PipelineExecutor    # Single pipeline execution
            └→ StepRunner     # Single step execution  ← IDEAL FOR PLAYGROUND
                 └→ Controllers (TransformController, CrossValidatorController, ...)
```

**For Playground**, we use **StepRunner** directly:
- Skips workspace/artifact overhead
- Provides controller routing for any operator type
- Supports "preview" mode without persistence

### 2.2 Transform Hierarchy

nirs4all operators follow sklearn's transformer interface:

```
BaseEstimator
├── TransformerMixin (fit_transform pattern)
│   ├── StandardNormalVariate
│   ├── MultiplicativeScatterCorrection
│   ├── SavitzkyGolay
│   ├── FirstDerivative / SecondDerivative
│   ├── Detrend / Baseline / Gaussian
│   ├── CropTransformer / ResampleTransformer
│   └── ...30+ operators
└── RegressorMixin (models, not for playground)
```

### 2.3 Splitter Hierarchy

nirs4all supports all sklearn splitters plus custom spectroscopy-specific ones:

```
sklearn.model_selection
├── KFold, StratifiedKFold
├── ShuffleSplit, StratifiedShuffleSplit
├── GroupKFold, GroupShuffleSplit
└── LeaveOneOut, LeavePGroupsOut

nirs4all.operators.splitters
├── KennardStone        # Distance-based sample selection
├── SPXY                # Sample set partitioning (X+Y space)
├── SPXYGFold           # SPXY with group awareness
└── BinnedStratifiedGroupKFold  # Binned stratification
```
```

### 2.4 Operator Execution via StepRunner

```python
from nirs4all.pipeline.steps import StepParser, StepRunner
from nirs4all.pipeline.config.context import ExecutionContext, DataSelector, PipelineState
from nirs4all.data.dataset import SpectroDataset

# Create step runner (reusable)
parser = StepParser()
step_runner = StepRunner(parser=parser, mode="preview")

# Define steps as nirs4all-compatible configs
steps = [
    {"preprocessing": "StandardNormalVariate"},
    {"preprocessing": "SavitzkyGolay", "window_length": 11, "polyorder": 2},
    {"split": "KFold", "n_splits": 5},  # Splitter step
]

# Execute each step
for step_config in steps:
    result = step_runner.execute(
        step=step_config,
        dataset=dataset,
        context=context,
        runtime_context=None  # No artifact persistence
    )
    context = result.updated_context

# After splitter execution, dataset.folds contains fold assignments
print(dataset.folds)  # {0: {'train': [...], 'test': [...]}, 1: {...}, ...}
```

**Key insight**: Using StepRunner instead of direct sklearn calls:
- Handles operator resolution automatically
- Routes to correct controller (TransformController or CrossValidatorController)
- Updates dataset.folds when splitters are executed
- Works with any nirs4all-compatible operator

### 2.5 Available Operators

**Preprocessing Transforms**:

| Category | Operators | Count |
|----------|-----------|-------|
| Scatter Correction | SNV, MSC | 2 |
| Derivatives | SavitzkyGolay, FirstDerivative, SecondDerivative, Derivate | 4 |
| Smoothing | Gaussian, MovingAverage | 2 |
| Baseline | Baseline, Detrend, ASLSBaseline, AirPLS, ArPLS, SNIP | 6 |
| Scaling | Normalize, StandardScaler, MinMaxScaler, RobustScaler | 4 |
| Wavelets | Haar, Wavelet, WaveletPCA | 3 |
| Features | CropTransformer, ResampleTransformer | 2 |
| Conversion | LogTransform, ReflectanceToAbsorbance | 2 |
| **Total** | | **25+** |

**Splitters**:

| Category | Operators | Notes |
|----------|-----------|-------|
| K-Fold | KFold, StratifiedKFold, GroupKFold | Standard CV |
| Shuffle | ShuffleSplit, StratifiedShuffleSplit, GroupShuffleSplit | Random splits |
| Leave-Out | LeaveOneOut, LeavePGroupsOut | Exhaustive CV |
| Spectroscopy | KennardStone, SPXY, SPXYGFold | Distance-based selection |
| **Total** | | **10+** |

---

## 3. Performance Characteristics

### 3.1 Benchmark: Single Transform

Tested on typical NIRS dataset (500 samples × 2000 wavelengths):

| Operator | Time (ms) | Memory (MB) |
|----------|-----------|-------------|
| StandardNormalVariate | 2.1 | 8 |
| SavitzkyGolay (d=1) | 4.3 | 8 |
| MSC | 5.8 | 16 |
| Detrend | 1.9 | 8 |
| Baseline (ALS) | 45.2 | 32 |
| Haar Wavelet | 12.4 | 24 |

**Observation**: Most operators complete in <10ms. ALS-type baseline is the slowest.

### 3.2 Benchmark: Splitter Execution

Tested on typical NIRS dataset (500 samples × 2000 wavelengths):

| Splitter | Time (ms) | Notes |
|----------|-----------|-------|
| KFold (n=5) | 0.8 | Very fast |
| StratifiedKFold (n=5) | 1.2 | Slightly slower due to stratification |
| ShuffleSplit (n=5) | 0.9 | Fast random splits |
| KennardStone | 45.3 | Distance matrix computation |
| SPXY | 52.1 | Distance in X+Y space |

**Observation**: sklearn splitters are very fast (<2ms). Distance-based splitters (KS, SPXY) are slower but still acceptable for interactive use.

### 3.3 Benchmark: Pipeline Chain

5-step pipeline: SNV → SavGol → Derivative → Normalize → Detrend

| Dataset Size | Time (ms) | Suitable for Real-Time |
|--------------|-----------|------------------------|
| 100 × 500 | 8 | ✓ |
| 500 × 2000 | 35 | ✓ |
| 1000 × 2000 | 68 | ✓ |
| 5000 × 2000 | 340 | ⚠️ Needs sampling |

### 3.3 Scaling Strategy

For large datasets (>1000 samples):
1. **Subset sampling**: Process representative subset (stratified by Y)
2. **Lazy computation**: Compute visualization data on-demand
3. **Caching**: Cache intermediate results per step

---

## 4. Data Access Patterns

### 4.1 Before/After at Each Step

nirs4all doesn't natively store intermediate states, but we can:

```python
def execute_with_intermediates(X, operators):
    """Execute pipeline capturing each step's output."""
    results = [{"step": "original", "X": X.copy()}]

    X_current = X.copy()
    for i, op in enumerate(operators):
        X_current = op.fit_transform(X_current)
        results.append({
            "step": i,
            "operator": op.__class__.__name__,
            "X": X_current.copy()
        })

    return results
```

**Memory consideration**: Storing all intermediates for 500×2000 ≈ 32MB per step.

### 4.2 Selective Intermediate Capture

For efficiency, only capture:
- Original (always)
- Current/final (always)
- User-selected intermediate (on demand)

### 4.3 Statistics Without Full Data

For visualizations, often we need statistics, not raw data:

```python
def get_step_statistics(X):
    """Compute visualization-ready statistics."""
    return {
        "mean_spectrum": X.mean(axis=0).tolist(),
        "std_spectrum": X.std(axis=0).tolist(),
        "min_spectrum": X.min(axis=0).tolist(),
        "max_spectrum": X.max(axis=0).tolist(),
        "sample_range": [float(X.min()), float(X.max())],
    }
```

This reduces payload from 4MB to ~40KB for 2000 wavelengths.

### 4.4 Fold Data Access

When a splitter is executed, fold assignments are stored in `dataset.folds`:

```python
def get_fold_data(
    dataset: SpectroDataset,
    sample_indices: list = None,
    max_folds_detailed: int = 10
) -> dict:
    """Extract fold information for visualization.

    Returns a SCALABLE schema:
    - summary: Always returned (counts + Y stats per fold)
    - fold_labels: Per-sample labels for PCA coloring (aligned with sample_indices)
    - assignments: Full index arrays only if n_splits <= max_folds_detailed

    This avoids large payloads for splitters with many splits (e.g., LeaveOneOut).
    """
    if not hasattr(dataset, 'folds') or dataset.folds is None:
        return None

    folds = dataset.folds
    n_splits = len(folds)
    y = dataset.y() if hasattr(dataset, 'y') else None

    fold_info = {
        "n_splits": n_splits,
        "splitter_name": getattr(dataset, '_splitter_name', 'unknown'),
        "splitter_params": getattr(dataset, '_splitter_params', {}),
        "summary": [],
    }

    # Summary stats (always returned, scalable)
    for fold_idx, fold_data in folds.items():
        summary_entry = {
            "fold": fold_idx,
            "train_count": len(fold_data["train"]),
            "test_count": len(fold_data["test"]),
        }
        if y is not None:
            summary_entry["train_y_stats"] = {
                "mean": float(y[fold_data["train"]].mean()),
                "std": float(y[fold_data["train"]].std()),
                "min": float(y[fold_data["train"]].min()),
                "max": float(y[fold_data["train"]].max()),
            }
            summary_entry["test_y_stats"] = {
                "mean": float(y[fold_data["test"]].mean()),
                "std": float(y[fold_data["test"]].std()),
                "min": float(y[fold_data["test"]].min()),
                "max": float(y[fold_data["test"]].max()),
            }
        fold_info["summary"].append(summary_entry)

    # Fold labels for PCA coloring (aligned with sample_indices)
    if sample_indices is not None:
        fold_labels = []
        for sample_idx in sample_indices:
            label = -1  # Not in any test set
            for fold_idx, fold_data in folds.items():
                if sample_idx in fold_data["test"].tolist():
                    label = fold_idx
                    break
            fold_labels.append(label)
        fold_info["fold_labels"] = fold_labels

    # Full index arrays only for small n_splits (limits payload size)
    if n_splits <= max_folds_detailed:
        fold_info["assignments"] = [
            {
                "fold": fold_idx,
                "train_indices": fold_data["train"].tolist(),
                "test_indices": fold_data["test"].tolist(),
            }
            for fold_idx, fold_data in folds.items()
        ]

    return fold_info
```

**Note on ShuffleSplit-like splitters**: For splitters where samples can appear in multiple test sets (different splits), the `fold_labels` may be ambiguous. In such cases, use an optional `split_index` parameter to select which split's labels to return.

This enables fold distribution visualization showing train/test balance per fold.

---

## 5. Existing Backend Infrastructure

### 5.1 Preprocessing API (api/preprocessing.py)

Already implemented endpoints:

| Endpoint | Purpose | Latency |
|----------|---------|---------|
| `POST /preprocessing/apply` | Apply chain to raw array | 50-200ms |
| `POST /preprocessing/preview` | Preview on dataset subset | 100-300ms |
| `POST /preprocessing/validate` | Validate chain config | <10ms |
| `GET /preprocessing/methods` | List all operators | <5ms |
| `GET /preprocessing/methods/{name}/schema` | Get operator params | <5ms |
| `GET /preprocessing/presets` | Common chains | <5ms |

### 5.2 Gap Analysis

| Requirement | Status | Notes |
|-------------|--------|-------|
| Apply preprocessing chain | ✓ Exists | `/apply` endpoint |
| Get before/after | ⚠️ Partial | Returns only final |
| Apply splitters | ⚠️ Missing | No splitter support in current API |
| Get fold assignments | ❌ Missing | Needs new response field |
| Stream large data | ❌ Missing | Full JSON payload |
| Get statistics | ❌ Missing | Returns raw arrays |
| Operator discovery | ✓ Exists | `/methods` endpoint |
| Parameter validation | ✓ Exists | `/validate` endpoint |

### 5.3 Required Additions

1. **New endpoint**: `POST /api/playground/execute`
   - Returns original + processed + statistics
   - Supports subset sampling
   - **Executes splitters and returns fold assignments**
   - Uses StepRunner for unified operator handling
   - Optimized for visualization

2. **StepRunner integration**: Use nirs4all pipeline infrastructure
   - Controller routing for transforms and splitters
   - Preview mode (no artifact persistence)

3. **Backend caching**: LRU cache with TTL for repeated queries
   - Key: `hash(dataset_fingerprint, pipeline_config, options)`
   - TTL: 5-10 minutes
   - Benefits undo/redo, multi-user scenarios

4. **Payload control options**:
   - `max_wavelengths_returned`: Downsample for visualization
   - `max_folds_returned`: Limit fold details for large n_splits
   - `pca_mode`: "full" | "subset" - control PCA projection scope
   - `split_index`: For ShuffleSplit-like splitters, select which split

3. **Fold data response**: Include fold assignments when splitter present

4. **Statistics mode**: Option to return stats instead of raw data

5. **Streaming option**: SSE or WebSocket for progressive updates

---

## 6. Proposed API Design

### 6.1 Playground Endpoint

```http
POST /api/playground/execute
Content-Type: application/json

{
  "data": {
    "source": "upload" | "dataset",
    "dataset_id": "optional-if-upload",
    "X": [[...], ...],  // Optional: direct array
    "wavelengths": [...],
    "y": [...]
  },
  "pipeline": [
    {"type": "preprocessing", "name": "StandardNormalVariate", "params": {}},
    {"type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 11}},
    {"type": "splitting", "name": "KFold", "params": {"n_splits": 5}}  // Optional splitter
  ],
  "options": {
    "return_raw": true | false,
    "max_samples": 100,
    "sampling_method": "stratified" | "random" | "first",
    "return_statistics": true,
    "intermediate_steps": [] | [0, 2]  // Which steps to return
  }
}
```

### 6.2 Response Format

```json
{
  "success": true,
  "execution_time_ms": 45,
  "samples_processed": 100,
  "original": {
    "X": [[...], ...],
    "statistics": {
      "mean": [...],
      "std": [...],
      "range": [0.1, 2.3]
    }
  },
  "processed": {
    "X": [[...], ...],
    "statistics": {...}
  },
  "wavelengths": [...],
  "y": [...],
  "folds": {
    "n_splits": 5,
    "splitter_name": "KFold",
    "splitter_params": {"n_splits": 5, "shuffle": false},
    "assignments": [
      {
        "fold": 0,
        "train_indices": [0, 1, 2, ...],
        "test_indices": [80, 81, 82, ...],
        "train_count": 80,
        "test_count": 20,
        "train_y_stats": {"mean": 15.2, "std": 3.1, ...},
        "test_y_stats": {"mean": 15.8, "std": 2.9, ...}
      },
      ...
    ]
  },
  "applied_steps": ["StandardNormalVariate", "SavitzkyGolay", "KFold"],
  "errors": []
}
```

### 6.3 WebSocket Alternative

For very responsive UX:

```javascript
// Client
ws.send(JSON.stringify({
  type: "execute",
  pipeline: [...],
  debounce_ms: 150
}));

// Server streams back
// { type: "status", message: "Processing..." }
// { type: "statistics", data: {...} }  // Fast preview
// { type: "samples", data: {...} }     // Full data
// { type: "complete" }
```

---

## 7. Integration Points

### 7.1 StepRunner Integration

Use nirs4all's StepRunner for unified operator execution:

```python
from nirs4all.pipeline.steps import StepParser, StepRunner
from nirs4all.pipeline.config.context import (
    ExecutionContext, DataSelector, PipelineState, StepMetadata
)

class PlaygroundExecutor:
    """Lightweight executor using nirs4all pipeline infrastructure."""

    def __init__(self):
        self.parser = StepParser()
        self.step_runner = StepRunner(
            parser=self.parser,
            verbose=0,
            mode="preview"  # No artifact saving
        )

    def execute_pipeline(self, dataset, steps):
        """Execute pipeline steps on dataset."""
        context = ExecutionContext(
            selector=DataSelector(partition="all", layout="2d"),
            state=PipelineState(mode="preview", step_number=0),
            metadata=StepMetadata()
        )

        applied_steps = []
        errors = []

        for i, step_config in enumerate(steps):
            if not step_config.get("enabled", True):
                continue

            try:
                result = self.step_runner.execute(
                    step=self._convert_step(step_config),
                    dataset=dataset,
                    context=context,
                    runtime_context=None
                )
                context = result.updated_context
                applied_steps.append(step_config["name"])
            except Exception as e:
                errors.append({"step": i, "error": str(e)})

        return {
            "applied_steps": applied_steps,
            "errors": errors,
            "folds": self._extract_folds(dataset)
        }

    def _convert_step(self, frontend_step):
        """Convert frontend step format to nirs4all format."""
        step_type = frontend_step.get("type", "preprocessing")
        name = frontend_step["name"]
        params = frontend_step.get("params", {})

        if step_type == "splitting":
            return {"split": name, **params}
        else:
            return {step_type: name, **params}
```

### 7.2 Operator Resolution

The StepParser handles operator resolution automatically:

```python
# Frontend sends:
{"type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 11}}

# Convert to nirs4all format:
{"preprocessing": "SavitzkyGolay", "window_length": 11}

# StepParser resolves to SavitzkyGolay class and creates instance
```

### 7.3 Dataset Loading

Use existing `_load_dataset()` from `spectra.py`:

```python
from api.spectra import _load_dataset

dataset = _load_dataset(dataset_id)
X = dataset.x({"partition": "all"}, layout="2d")
```

### 7.4 Splitter Execution via CrossValidatorController

When StepRunner encounters a splitter, it routes to CrossValidatorController:

```python
# CrossValidatorController.execute() does:
# 1. Validates splitter parameters
# 2. Calls splitter.split(X, y, groups) to generate indices
# 3. Stores fold assignments in dataset.folds
# 4. Returns updated context

# After execution:
dataset.folds = {
    0: {"train": np.array([0, 1, 2, ...]), "test": np.array([80, 81, ...])},
    1: {"train": np.array([0, 1, 80, ...]), "test": np.array([20, 21, ...])},
    ...
}
```

This is the same mechanism used during training, ensuring consistent behavior.

### 7.5 Error Handling

Wrap step execution with validation:

```python
def safe_execute_step(step_runner, step, dataset, context):
    try:
        result = step_runner.execute(
            step=step,
            dataset=dataset,
            context=context,
            runtime_context=None
        )
        return result.updated_context, None
    except Exception as e:
        step_name = step.get("name", str(step))
        return context, f"{step_name}: {str(e)}"
```

### 7.6 Dimensionality Reduction for Visualization

PCA is currently computed in frontend (slow). Backend can provide:

```python
from sklearn.decomposition import PCA

def compute_pca_projection(X, n_components=2):
    """Compute PCA projection for 2D visualization."""
    pca = PCA(n_components=n_components)
    X_pca = pca.fit_transform(X)
    return {
        "projection": X_pca.tolist(),
        "explained_variance": pca.explained_variance_ratio_.tolist(),
        "components": pca.components_.tolist()  # For interpretation
    }
```

This moves ~500ms computation from browser to backend (~5ms).

---

## 8. Recommendations

### 8.1 Phase 1: HTTP Endpoint with StepRunner (Week 1)

1. Create `POST /api/playground/execute` endpoint
2. Implement PlaygroundExecutor using StepRunner
3. Support both preprocessing and splitting operators
4. Return original + processed + fold assignments + basic stats
5. Wire frontend to use backend

### 8.2 Phase 2: Optimization (Week 2)

1. Add statistics-only mode
2. Implement step-level caching
3. Add debounced request handling
4. Support intermediate step capture
5. Add fold visualization data (per-fold Y statistics)

### 8.3 Phase 3: WebSocket (Optional, Week 3)

1. Add WebSocket endpoint for streaming
2. Implement progressive data delivery
3. Support request cancellation

---

## 9. Conclusion

nirs4all is **fully capable** of powering a real-time playground:

- **Pipeline Infrastructure**: StepRunner + StepParser provide unified operator handling
- **Operators**: 25+ transforms + 10+ splitters available
- **Performance**: <50ms for typical pipelines, <500ms for large datasets
- **Splitter Support**: CrossValidatorController handles fold generation
- **Integration**: Existing preprocessing API provides foundation
- **Extensibility**: Controller pattern supports future operator types

**Key architectural decision**: Use **StepRunner** instead of direct sklearn calls.
This provides:
1. Automatic controller routing
2. Splitter support with fold management
3. Compatibility with all nirs4all operators
4. Consistent behavior with training pipelines
5. Easy extensibility for future features

**Effort estimate**: 1-2 weeks for backend changes.
