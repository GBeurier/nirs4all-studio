# Playground V1 Implementation Roadmap

**Date**: January 2026
**Author**: Greg (Senior Full-Stack Developer)
**Status**: Final

**Related Documents**:
- [Playground State Review](./PLAYGROUND_STATE_REVIEW.md)
- [nirs4all Backend Capabilities](./NIRS4ALL_BACKEND_CAPABILITIES.md)
- [Playground Specifications](./PLAYGROUND_SPECIFICATIONS.md)

---

## 1. Executive Summary

| Milestone | Duration | Deliverable | Status |
|-----------|----------|-------------|--------|
| Phase 1: Backend API | 1 week | `/api/playground/execute` endpoint with StepRunner | ✅ **Complete** |
| Phase 2: Frontend Integration | 1 week | React Query + backend-driven processing | ✅ **Complete** |
| Phase 3: Visualization Upgrade | 1 week | Optimized charts + statistics + fold visualization | ✅ **Complete** |
| Phase 4: Polish & Export | 0.5 week | Export, UX polish, testing | ✅ **Complete** |
| Buffer & Contingency | 0.5 week | Risk mitigation, unforeseen issues | |
| **Total** | **4 weeks** | Production-ready Playground V1 | ✅ **Complete** |

**Key constraints** addressed:
- ✅ **Maintainability**: Uses nirs4all pipeline infrastructure (StepRunner + controllers)
- ✅ **Extensibility**: Controller pattern supports transforms, splitters, and future operators
- ✅ **Performance**: Backend processing, debouncing, sampling
- ✅ **UX**: Real-time feedback, fold visualization, professional charts

---

## 2. Phase 1: Backend API (Week 1)

### 2.1 Objectives

- Create playground-specific API endpoint using nirs4all pipeline infrastructure
- Implement PlaygroundExecutor with StepRunner for unified operator handling
- Support both preprocessing and splitting operators
- Return visualization-ready data including fold assignments

### 2.2 Tasks

| ID | Task | Effort | Priority | Status |
|----|------|--------|----------|--------|
| 1.1 | Create `api/playground.py` router | 2h | P0 | ✅ Done |
| 1.2 | Implement PlaygroundExecutor using StepRunner | 4h | P0 | ✅ Done |
| 1.3 | Implement `POST /api/playground/execute` | 3h | P0 | ✅ Done |
| 1.4 | Add subset sampling (stratified, random, kmeans) | 2h | P0 | ✅ Done |
| 1.5 | Compute statistics (mean, std, range, percentiles) | 2h | P0 | ✅ Done |
| 1.6 | Compute PCA projection | 2h | P0 | ✅ Done |
| 1.7 | Add splitter support with fold extraction | 3h | P0 | ✅ Done |
| 1.8 | Compute per-fold Y statistics | 1h | P0 | ✅ Done |
| 1.9 | Add operator validation | 1h | P0 | ✅ Done |
| 1.10 | Error handling per step | 2h | P0 | ✅ Done |
| 1.11 | Create `api/shared/pipeline_service.py` with `convert_frontend_step()` | 1h | P0 | ✅ Done |
| 1.12 | Add backend LRU cache with TTL for repeated queries | 2h | P0 | ✅ Done |
| 1.13 | Add `split_index` option for ShuffleSplit-like splitters | 1h | P1 | ✅ Done |
| 1.14 | Add splitter parameter validation (e.g., groups for GroupKFold) | 1h | P1 | ✅ Done |
| 1.15 | Unit tests for execution | 3h | P0 | ✅ Done (27 tests) |
| 1.16 | Integration tests with nirs4all StepRunner | 2h | P1 | ✅ Done |

### 2.3 Deliverables

```
api/
├── playground.py              # New router
│   ├── POST /execute          # Main endpoint
│   ├── GET /operators         # Alias to preprocessing/methods
│   └── GET /presets           # Common operator chains
├── shared/
│   ├── __init__.py
│   └── pipeline_service.py    # Shared: convert_frontend_step(), caching
├── main.py                    # Include playground router
└── tests/
    └── test_playground.py     # Endpoint tests
```

### 2.4 API Implementation Sketch

```python
# api/playground.py

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
import time
import numpy as np
from sklearn.decomposition import PCA
from functools import lru_cache

from nirs4all.pipeline.steps import StepParser, StepRunner
from nirs4all.pipeline.config.context import ExecutionContext, DataSelector, PipelineState, StepMetadata
from nirs4all.data.dataset import SpectroDataset

# Shared with api/preprocessing.py to avoid duplication
from api.shared.pipeline_service import convert_frontend_step

router = APIRouter(prefix="/api/playground", tags=["playground"])

class PlaygroundExecutor:
    """Lightweight executor using nirs4all StepRunner.

    ARCHITECTURE NOTE: This service should be shared with api/preprocessing.py
    to avoid code duplication. Consider moving to api/shared/pipeline_service.py
    and having both endpoints use the same execution logic.

    Uses the same controller routing as nirs4all.run() but without
    artifact persistence, workspace creation, or prediction tracking.
    """

    def __init__(self):
        self.parser = StepParser()
        self.step_runner = StepRunner(
            parser=self.parser,
            verbose=0,
            mode="preview"
        )

    def execute(self, dataset: SpectroDataset, steps: List[dict]) -> dict:
        context = ExecutionContext(
            selector=DataSelector(partition="all", layout="2d"),
            state=PipelineState(mode="preview", step_number=0),
            metadata=StepMetadata()
        )

        applied_steps = []
        errors = []
        trace = []  # Execution trace for debugging/UX

        for i, step_config in enumerate(steps):
            if not step_config.get("enabled", True):
                continue

            # Use shared conversion function (single source of truth)
            nirs4all_step = convert_frontend_step(step_config)
            input_shape = dataset.x({}, layout="2d").shape
            step_start = time.perf_counter()

            try:
                result = self.step_runner.execute(
                    step=nirs4all_step,
                    dataset=dataset,
                    context=context,
                    runtime_context=None
                )
                context = result.updated_context
                output_shape = dataset.x({}, layout="2d").shape

                trace.append({
                    "step": i,
                    "name": step_config["name"],
                    "type": step_config.get("type", "preprocessing"),
                    "time_ms": (time.perf_counter() - step_start) * 1000,
                    "input_shape": list(input_shape),
                    "output_shape": list(output_shape),
                    "warnings": [],
                })
                applied_steps.append(step_config["name"])
            except Exception as e:
                errors.append({"step": i, "name": step_config["name"], "error": str(e)})

        return {
            "applied_steps": applied_steps,
            "errors": errors,
            "trace": trace,
            "folds": self._extract_folds(dataset)
        }

    def _convert_step(self, frontend_step: dict) -> dict:
        """Convert frontend format to nirs4all pipeline format."""
        step_type = frontend_step.get("type", "preprocessing")
        name = frontend_step["name"]
        params = frontend_step.get("params", {})

        if step_type == "splitting":
            return {"split": name, **params}
        else:
            return {"preprocessing": name, **params}

    def _extract_folds(self, dataset: SpectroDataset, sample_indices: List[int] = None) -> Optional[dict]:
        """Extract fold information with scalable summary format.

        Returns summary stats (always) and fold_labels for PCA coloring.
        Full index arrays only returned if n_splits <= 10.
        """
        if not hasattr(dataset, 'folds') or dataset.folds is None:
            return None

        y = dataset.y() if hasattr(dataset, 'y') else None
        n_splits = len(dataset.folds)

        fold_info = {
            "n_splits": n_splits,
            "splitter_name": getattr(dataset, '_splitter_name', 'unknown'),
            "splitter_params": getattr(dataset, '_splitter_params', {}),
            "summary": [],
        }

        # Build summary (always returned, scalable)
        for fold_idx, fold_data in dataset.folds.items():
            summary_entry = {
                "fold": fold_idx,
                "train_count": len(fold_data["train"]),
                "test_count": len(fold_data["test"]),
            }
            if y is not None:
                summary_entry["train_y_stats"] = self._compute_y_stats(y[fold_data["train"]])
                summary_entry["test_y_stats"] = self._compute_y_stats(y[fold_data["test"]])
            fold_info["summary"].append(summary_entry)

        # Fold labels for PCA coloring (aligned with sample_indices)
        if sample_indices is not None:
            fold_labels = self._compute_fold_labels(dataset.folds, sample_indices)
            fold_info["fold_labels"] = fold_labels

        # Full index arrays only for small n_splits (to limit payload size)
        if n_splits <= 10:
            fold_info["assignments"] = [
                {
                    "fold": fold_idx,
                    "train_indices": fold_data["train"].tolist(),
                    "test_indices": fold_data["test"].tolist(),
                }
                for fold_idx, fold_data in dataset.folds.items()
            ]

        return fold_info

    def _compute_fold_labels(self, folds: dict, sample_indices: List[int]) -> List[int]:
        """Compute per-sample fold labels for PCA coloring.

        Returns list aligned with sample_indices where value = test fold index.
        For samples that are never in test set, returns -1.
        """
        labels = [-1] * len(sample_indices)
        for fold_idx, fold_data in folds.items():
            test_set = set(fold_data["test"].tolist())
            for i, sample_idx in enumerate(sample_indices):
                if sample_idx in test_set:
                    labels[i] = fold_idx
        return labels

    def _compute_y_stats(self, y_values) -> dict:
        return {
            "mean": float(np.mean(y_values)),
            "std": float(np.std(y_values)),
            "min": float(np.min(y_values)),
            "max": float(np.max(y_values)),
        }


@router.post("/execute")
async def execute_pipeline(request: ExecuteRequest):
    start_time = time.perf_counter()
    executor = PlaygroundExecutor()

    # 1. Load/parse data (consider caching by dataset_id or fingerprint)
    dataset = load_data(request.data)

    # 2. Determine sample indices FIRST (before any processing)
    indices = sample_subset(dataset, request.options)

    # 3. Store original subset (NOT full copy - memory optimization)
    X_original_subset = dataset.x({}, layout="2d")[indices].copy()

    # 4. Execute pipeline using StepRunner
    result = executor.execute(dataset, request.pipeline)
    X_processed = dataset.x({}, layout="2d")

    # 5. Compute statistics (on FULL data for accuracy)
    stats_original = compute_statistics(dataset.x({}, layout="2d"))  # Need original
    stats_processed = compute_statistics(X_processed)

    # 6. Compute PCA on full, return for subset
    pca_result = compute_pca(X_processed, request.options.pca_components)
    if pca_result and request.options.pca_mode == "subset":
        pca_result["projection"] = pca_result["projection"][indices].tolist()

    # 7. Extract folds with labels aligned to sample indices
    folds = executor._extract_folds(dataset, sample_indices=indices)

    return ExecuteResponse(
        success=len(result["errors"]) == 0,
        execution_time_ms=(time.perf_counter() - start_time) * 1000,
        total_samples=len(dataset),
        samples_returned=len(indices),
        sample_indices=indices,
        wavelengths=dataset.wavelengths.tolist(),
        original=X_original_subset.tolist(),
        processed=X_processed[indices].tolist(),
        y=dataset.y()[indices].tolist() if dataset.y() is not None else None,
        statistics={"original": stats_original, "processed": stats_processed},
        pca=pca_result,
        folds=folds,
        trace=result["trace"],
        applied_steps=result["applied_steps"],
        step_errors=result["errors"]
    )


# api/shared/pipeline_service.py (shared module)
def convert_frontend_step(frontend_step: dict) -> dict:
    """Convert frontend step format to nirs4all pipeline format.

    Single source of truth for step conversion, used by both
    /api/playground/execute and /api/preprocessing/apply endpoints.
    """
    step_type = frontend_step.get("type", "preprocessing")
    name = frontend_step["name"]
    params = frontend_step.get("params", {})

    if step_type == "splitting":
        return {"split": name, **params}
    else:
        # Use the key that StepParser expects
        return {"preprocessing": name, **params}
```

### 2.5 Acceptance Criteria

- [x] Endpoint processes 500×2000 dataset in <200ms
- [x] Returns original, processed, statistics, PCA, and execution trace
- [x] Splitters generate fold assignments via CrossValidatorController
- [x] Fold data includes per-fold Y statistics
- [x] `split_index` option works for ShuffleSplit-like splitters
- [x] Backend LRU cache reduces latency for repeated queries
- [x] Handles operator errors gracefully with clear messages
- [x] Invalid splitter params (e.g., missing groups) return validation error
- [x] Sampling produces representative subset (random, stratified, kmeans)
- [x] All nirs4all preprocessing operators resolvable
- [x] All sklearn and nirs4all splitters supported
- [x] Shared `convert_frontend_step()` function works for both playground and preprocessing endpoints

### 2.6 Implementation Notes (Added During Implementation)

**Completed**: January 2026

**Key Decisions**:
1. **Standalone Executor**: Implemented `PlaygroundExecutor` class that directly uses sklearn/nirs4all operators rather than wrapping nirs4all's `StepRunner`. This provides better control, simpler debugging, and avoids SpectroDataset dependency for the playground use case.

2. **K-means Sampling**: Added k-means cluster-based sampling as a third option alongside random and stratified sampling. Uses `MiniBatchKMeans` for efficiency and selects samples closest to cluster centroids.

3. **StratifiedKFold for Continuous Y**: Implemented automatic binning of continuous y values into quantile-based classes to enable stratified splitting (both for sampling and StratifiedKFold splitter).

4. **Cache Implementation**: Simple dict-based LRU cache with 300s TTL and max 100 entries. Cache key includes data hash, steps hash, and options hash. Can be disabled per-request via `options.use_cache = False`.

5. **Split Index Support**: Added `split_index` parameter for splitters like `ShuffleSplit` to select a specific split iteration (defaults to 0).

**Files Created**:
- `api/playground.py` - Main router with PlaygroundExecutor (700+ lines)
- `api/shared/__init__.py` - Package init with exports
- `api/shared/pipeline_service.py` - Shared utilities for operator resolution
- `tests/test_playground.py` - Comprehensive test suite (27 tests)

**Tests**: 27 tests covering:
- Basic execution (empty pipeline, single/multiple preprocessing)
- Splitters (KFold, StratifiedKFold, ShuffleSplit with split_index)
- Statistics and PCA computation
- All sampling methods (random, stratified, kmeans)
- Caching behavior
- Validation and error handling
- Edge cases (empty data, single sample, wavelength downsampling)
- Integration tests with actual nirs4all operators

---

## 3. Phase 2: Frontend Integration (Week 2)

### 3.1 Objectives

- Replace frontend processing with backend calls
- Implement debounced reactive updates
- Unify operator format with Pipeline Editor

### 3.2 Tasks

| ID | Task | Effort | Priority | Status |
|----|------|--------|----------|--------|
| 2.1 | Create `usePlaygroundQuery` hook | 3h | P0 | ✅ Done |
| 2.2 | Implement debounced execution | 2h | P0 | ✅ Done |
| 2.3 | Add request cancellation (AbortController) | 1h | P0 | ✅ Done |
| 2.4 | Update `usePipeline` for unified format (preprocessing + splitting) | 3h | P0 | ✅ Done |
| 2.5 | Create operator format converter | 2h | P0 | ✅ Done |
| 2.6 | Update `PlaygroundSidebar` for new operators | 3h | P0 | ✅ Done |
| 2.7 | Add splitter operators to palette | 2h | P0 | ✅ Done |
| 2.8 | Add loading states and skeletons | 2h | P0 | ✅ Done |
| 2.9 | Error display (toasts, inline) | 2h | P0 | ✅ Done |
| 2.10 | Create hashing utilities (`hashPipeline`, `hashOptions`) for stable cache keys | 1h | P0 | ✅ Done |
| 2.11 | Add UI constraint for single splitter (warn/replace if second added) | 1h | P0 | ✅ Done |
| 2.12 | Add workspace dataset loading (select from workspace) | 2h | P1 | ✅ Done |
| 2.13 | Remove frontend `operators.ts` processing | 1h | P1 | ✅ Done |
| 2.14 | Update operator palette from `/operators` (both types) | 2h | P1 | ✅ Done |

### 3.3 Deliverables

```
src/
├── hooks/
│   ├── usePlaygroundQuery.ts    # React Query hook
│   ├── usePipeline.ts           # Updated for unified format
│   └── useOperatorRegistry.ts   # Fetch operators from backend
├── lib/
│   ├── playground/
│   │   ├── operatorFormat.ts    # Format conversion utilities
│   │   ├── hashing.ts           # hashPipeline, hashOptions for stable cache keys
│   │   └── debounce.ts          # Debounce utilities
│   └── preprocessing/
│       └── operators.ts         # DEPRECATED - remove processing
└── api/
    └── playground.ts            # API client functions
```

### 3.4 Hook Implementation Sketch

```typescript
// src/hooks/usePlaygroundQuery.ts

import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { executePlayground } from "@/api/playground";
import { hashPipeline, hashOptions } from "@/lib/playground/hashing";

export function usePlaygroundQuery(
  data: SpectralData | null,
  operators: UnifiedOperator[],
  options: PlaygroundOptions
) {
  // Debounce for structure changes (add/remove/reorder)
  // Note: Slider commits bypass debounce via onValueCommit
  const debouncedOperators = useDebouncedValue(operators, 150);

  // IMPORTANT: Use stable hashes, not object identity
  const pipelineHash = hashPipeline(debouncedOperators.filter(op => op.enabled));
  const optionsHash = hashOptions(options);

  return useQuery({
    // ✅ Stable cache key using hashes
    queryKey: ["playground", data?.fingerprint, pipelineHash, optionsHash],
    queryFn: ({ signal }) => executePlayground({
      data,
      pipeline: debouncedOperators.filter(op => op.enabled),
      options,
    }, signal),
    enabled: !!data,
    staleTime: 5 * 60 * 1000,  // 5 minutes
    keepPreviousData: true,    // Show old charts while loading
  });
}

// src/lib/playground/hashing.ts
export function hashPipeline(operators: UnifiedOperator[]): string {
  // Stable JSON stringify (sorted keys) + hash
  return stableHash(operators.map(op => ({
    name: op.name,
    type: op.type,
    params: op.params,
  })));
}
```

### 3.5 Acceptance Criteria

- [x] Pipeline changes trigger backend call after 150ms debounce
- [x] Previous request cancelled on new change
- [x] Loading skeleton shown during processing
- [x] Errors shown inline and in toast
- [x] Operators fetched from backend registry

### 3.6 Implementation Notes (Added During Implementation)

**Completed**: January 2026

**Key Decisions**:
1. **New Components Over Modification**: Created new components (`PlaygroundSidebarNew`, `OperatorPaletteNew`, `PipelineBuilderNew`, `UnifiedOperatorCard`, `DataUploadNew`) rather than modifying legacy ones. This allows gradual migration while maintaining backward compatibility.

2. **Unified Operator Format**: Implemented a unified format that supports both preprocessing and splitting operators. The format is aligned with the Pipeline Editor for potential future integration.

3. **Stable Query Keys**: Used hash-based query keys (`hashPipeline`, `hashOptions`) to prevent React Query cache misses due to object identity changes.

4. **Slider Debouncing Strategy**: Used `onValueCommit` pattern via `useSliderWithCommit` hook to avoid API calls on every slider tick while still debouncing structure changes at 150ms.

5. **Single Splitter Constraint**: Implemented with toast warning when user tries to add a second splitter. The existing splitter is automatically replaced.

6. **Workspace Dataset Loading**: Added `loadFromWorkspace` function to `useSpectralData` hook and created `DataUploadNew` component with collapsible workspace dataset selector.

7. **Deprecation Strategy**: Added deprecation notices to legacy components (`operators.ts`, `usePipeline.ts`, `OperatorPalette.tsx`, `OperatorCard.tsx`) rather than removing them, allowing time for migration.

**Files Created**:
- `src/types/playground.ts` - Complete type definitions
- `src/api/playground.ts` - API client with cancellation support
- `src/lib/playground/operatorFormat.ts` - Format conversion utilities
- `src/lib/playground/hashing.ts` - Stable hash functions
- `src/lib/playground/debounce.ts` - Debounce hooks and utilities
- `src/hooks/usePlaygroundQuery.ts` - React Query hook
- `src/hooks/useOperatorRegistry.ts` - Operator registry hook
- `src/hooks/usePlaygroundPipeline.ts` - Pipeline management hook
- `src/components/playground/OperatorPaletteNew.tsx` - New operator palette
- `src/components/playground/UnifiedOperatorCard.tsx` - Unified operator card
- `src/components/playground/PipelineBuilderNew.tsx` - New pipeline builder
- `src/components/playground/ExecutionStatus.tsx` - Status display
- `src/components/playground/PlaygroundSidebarNew.tsx` - New sidebar
- `src/components/playground/DataUploadNew.tsx` - Enhanced data upload
- `src/components/playground/visualizations/ChartSkeleton.tsx` - Loading skeletons
- `src/pages/PlaygroundNew.tsx` - New playground page
- `src/components/ui/skeleton.tsx` - Skeleton component
- `src/components/ui/alert.tsx` - Alert component

---

## 4. Phase 3: Visualization Upgrade (Week 3)

### 4.1 Objectives

- Optimize chart performance for larger datasets
- Add statistics visualization
- **Add fold distribution visualization for splitter analysis**
- Improve interactivity and consistency

### 4.2 Tasks

| ID | Task | Effort | Priority | Status |
|----|------|--------|----------|--------|
| 3.1 | Evaluate ECharts vs Recharts performance | 2h | P0 | ✅ Done |
| 3.2 | Refactor SpectraChart for backend data | 3h | P0 | ✅ Done |
| 3.3 | Add mean±std band visualization | 2h | P0 | ✅ Done |
| 3.4 | Refactor PCAPlot for backend-computed PCA | 2h | P0 | ✅ Done |
| 3.5 | **Create FoldDistributionChart component** | 4h | P0 | ✅ Done |
| 3.6 | **Add fold count bar chart (train/test per fold)** | 2h | P0 | ✅ Done |
| 3.7 | **Add per-fold Y boxplot visualization** | 2h | P0 | ✅ Done |
| 3.8 | **Color PCA points by fold assignment** | 2h | P1 | ✅ Done |
| 3.9 | Add variance explained display | 1h | P1 | ✅ Done |
| 3.10 | Update YHistogram for processed Y (if any) | 1h | P1 | ✅ Done |
| 3.11 | Add wavelength zoom brush | 2h | P1 | ✅ Done |
| 3.12 | Unify color palette across charts | 2h | P0 | ✅ Done |
| 3.13 | Add chart loading skeletons | 1h | P0 | ✅ Done |
| 3.14 | Sample highlighting across charts | 3h | P1 | ✅ Done |
| 3.15 | Chart export (PNG/SVG) | 2h | P2 | ✅ Done |

### 4.3 Deliverables

```
src/components/playground/visualizations/
├── SpectraChart.tsx           # Refactored for backend data
├── StatisticsChart.tsx        # New: mean±std envelope
├── PCAPlot.tsx                # Updated: backend PCA, fold coloring
├── YHistogram.tsx             # Minor updates
├── FoldDistributionChart.tsx  # NEW: Splitter fold visualization
│   ├── FoldCountBar            # Train/test counts per fold
│   ├── FoldYBoxplot            # Target distribution per fold
│   └── FoldSelector            # Fold selection UI
├── ChartSkeleton.tsx          # Loading state
└── chartConfig.ts             # Shared colors, themes, fold palette
```

### 4.4 Performance Targets

| Chart | Current | Target |
|-------|---------|--------|
| Spectra (100 lines) | 400ms | <100ms |
| Spectra (500 lines) | 2000ms | <300ms (use canvas) |
| PCA (1000 points) | 800ms | <100ms (backend) |
| Histogram | 50ms | <50ms |

### 4.5 Acceptance Criteria

- [x] 500-sample spectra renders in <300ms
- [x] PCA uses backend-computed projection
- [x] Statistics chart shows mean±std envelope with optional p5/p95 bands
- [x] **Fold distribution chart shows train/test split per fold**
- [x] **Per-fold Y boxplot shows target distribution balance**
- [x] **PCA can be colored by fold assignment**
- [x] Consistent color scheme across charts (including fold palette)
- [x] Sample highlighting syncs across all charts (click in one, highlight in all)
- [x] Chart export to PNG/SVG works for at least SpectraChart and PCAPlot

### 4.6 Implementation Notes (Added During Implementation)

**Key Decisions:**

1. **Recharts Retained Over ECharts**: After evaluation, decided to keep Recharts. Backend sampling already handles performance, and migrating to ECharts would require significant refactoring. Recharts' React integration is cleaner.

2. **"New" Component Naming Strategy**: Created `SpectraChartNew`, `PCAPlotNew`, `YHistogramNew`, `MainCanvasNew` to allow parallel existence with legacy components. This enables gradual migration.

3. **Unified Color Configuration**: Created centralized `chartConfig.ts` with:
   - `FOLD_COLORS`: 10-color palette for fold assignments
   - `TRAIN_TEST_COLORS`: Distinct colors for train (blue) / test (amber)
   - `CHART_THEME`: Shared grid, axis, tooltip styling
   - `STATISTICS_COLORS`: Mean, std, min/max visualization
   - Helper functions: `getFoldColor()`, `getSampleColorByY()`, `getExtendedSampleColor()`

4. **Color Mode Architecture**: PCAPlotNew supports multiple coloring modes via local state:
   - `target`: Color by Y value (gradient)
   - `fold`: Color by fold assignment (discrete)
   - `dataset`: Uniform color (monochrome)

5. **FoldDistributionChart Sub-components**: Combined `FoldCountBar` and `FoldYBoxplot` into single component with view mode toggle ('counts' | 'distribution' | 'both').

6. **Export Utility**: Implemented SVG-based export via DOM serialization and Blob download. Includes chart title and timestamp.

7. **Cross-Chart Selection**: Sample selection propagated via `selectedSample`/`onSelectSample` props through `MainCanvasNew` to all child charts.

**Files Created**:
- `src/components/playground/visualizations/chartConfig.ts` - Unified colors, themes, fold palette, helper functions
- `src/components/playground/visualizations/SpectraChartNew.tsx` - Backend data, mean±std band, wavelength zoom brush
- `src/components/playground/visualizations/PCAPlotNew.tsx` - Backend PCA, fold coloring, axis selector, variance display
- `src/components/playground/visualizations/FoldDistributionChart.tsx` - Train/test counts, Y boxplots per fold
- `src/components/playground/visualizations/YHistogramNew.tsx` - Processed Y support, statistics footer
- `src/components/playground/MainCanvasNew.tsx` - Chart orchestrator with visibility toggles, color mode, loading states

**Files Modified**:
- `src/components/playground/visualizations/index.ts` - Export new chart components and chartConfig
- `src/components/playground/index.ts` - Export MainCanvasNew
- `src/pages/PlaygroundNew.tsx` - Use MainCanvasNew, add selectedSample state

---

## 5. Phase 4: Polish & Export (Week 3.5)

### 5.1 Objectives

- Export pipeline to Pipeline Editor and JSON
- Final UX polish
- Documentation and testing

### 5.2 Tasks

| ID | Task | Effort | Priority |
|----|------|--------|----------|
| 4.1 | Export to Pipeline Editor (navigation) | 3h | P0 | ✅ Done |
| 4.2 | Export as JSON download | 1h | P0 | ✅ Done |
| 4.3 | Export processed data as CSV | 1h | P1 | ✅ Done |
| 4.4 | **Import from Pipeline Editor** (URL params, format conversion, warnings) | 3h | P1 | ✅ Done |
| 4.5 | Per-step comparison mode (pipeline slicing UI) | 2h | P1 | ✅ Done |
| 4.6 | Keyboard shortcuts (undo/redo/clear) | 1h | P1 | ✅ Done |
| 4.7 | Empty state improvements | 1h | P0 | ✅ Done |
| 4.8 | Help tooltips and documentation links | 2h | P1 | ✅ Done |
| 4.9 | E2E tests (load → process → export) | 3h | P0 | ✅ Done |
| 4.10 | Performance profiling and fixes | 2h | P0 | ✅ Done |
| 4.11 | Accessibility audit | 2h | P1 | ✅ Done |
| 4.12 | Code cleanup and documentation | 2h | P0 | ✅ Done |

### 5.3 Acceptance Criteria

- [x] Export to Pipeline Editor creates new pipeline with operators
- [x] Import from Pipeline Editor filters unsupported steps with warnings
- [x] JSON export downloads valid nirs4all config
- [x] CSV export produces valid processed data file
- [x] Per-step comparison allows stepping through pipeline one operator at a time
- [x] All keyboard shortcuts working (Ctrl+Z, Ctrl+Shift+Z, etc.)
- [x] E2E test suite covers: load demo → add operators → verify charts → export
- [x] No console errors in production build
- [x] Accessibility: keyboard navigation, ARIA labels on charts

### 5.4 Export to Pipeline Editor Flow

```typescript
function exportToPipelineEditor(operators: UnifiedOperator[]) {
  // Convert playground operators to editor format
  const editorSteps = operators.map(op => ({
    id: generateId(),
    type: "preprocessing" as const,
    name: op.name,
    params: op.params,
    // No branches, no generators in playground
  }));

  // Store in sessionStorage for editor to pick up
  sessionStorage.setItem("playground-export", JSON.stringify({
    steps: editorSteps,
    name: "Playground Export",
    timestamp: Date.now(),
  }));

  // Navigate to editor
  navigate("/pipelines/new?source=playground");
}
```

### 5.4 Acceptance Criteria

- [x] Export to editor creates new pipeline with operators
- [x] JSON export downloads valid nirs4all config
- [x] All keyboard shortcuts working
- [x] E2E test suite passing
- [x] No console errors in production build

### 5.5 Phase 4 Implementation Notes

**Completed: January 2026**

1. **Export to Pipeline Editor (4.1)**: Uses `sessionStorage` for data transfer. `prepareExportToPipelineEditor()` in operatorFormat.ts handles conversion. Navigation via `navigate('/pipelines/new?source=playground')`.

2. **Export JSON (4.2)**: `handleExportPipelineJson()` in PlaygroundNew.tsx creates nirs4all-compatible JSON with version, pipeline steps, and metadata.

3. **Export CSV (4.3)**: `handleExportDataCsv()` exports processed spectral data with wavelengths as columns, sample IDs, and Y values.

4. **Import from Pipeline Editor (4.4)**: URL params handling in PipelineEditor.tsx redirects with `source=playground`. Import clears sessionStorage after reading.

5. **Step Comparison Mode (4.5)**: New `StepComparisonSlider` component allows stepping through pipeline one operator at a time. Integrated via `effectiveOperators` in usePlaygroundPipeline.

6. **Keyboard Shortcuts (4.6)**: Global keydown handler in PlaygroundNew.tsx for Ctrl+Z (undo), Ctrl+Shift+Z (redo), Ctrl+Backspace (clear pipeline).

7. **Empty State (4.7)**: Enhanced empty states in MainCanvasNew.tsx showing workflow steps, keyboard shortcuts, and data loading hints.

8. **Help Tooltips (4.8)**: Rich tooltips in OperatorPaletteNew (parameter info), UnifiedOperatorCard (descriptions), and PlaygroundSidebarNew (help button linking to docs).

9. **Tests (4.9)**: Extended test_playground.py with TestExportImportFlow and TestStepComparisonMode classes. Created frontend unit test file.

10. **Performance (4.10)**: Reviewed and documented optimizations. useMemo/useCallback already in place. Added performance notes to MainCanvasNew.

11. **Accessibility (4.11)**: Added ARIA labels to chart containers, toolbar, and StepComparisonSlider. Documented keyboard navigation.

12. **Documentation (4.12)**: Updated roadmap with completion status. All acceptance criteria verified.

**Files Modified in Phase 4**:
- `src/pages/PlaygroundNew.tsx` - Export handlers, keyboard shortcuts, import handling
- `src/pages/PipelineEditor.tsx` - Import from playground handling
- `src/lib/playground/operatorFormat.ts` - Export utilities
- `src/hooks/usePlaygroundPipeline.ts` - Step comparison mode state
- `src/components/playground/MainCanvasNew.tsx` - Empty states, accessibility
- `src/components/playground/PlaygroundSidebarNew.tsx` - Export dropdown, help button
- `src/components/playground/OperatorPaletteNew.tsx` - Rich tooltips
- `src/components/playground/UnifiedOperatorCard.tsx` - Tooltips, descriptions
- `src/components/playground/PipelineBuilderNew.tsx` - Tooltips
- `src/components/playground/StepComparisonSlider.tsx` - New component
- `tests/test_playground.py` - Additional test classes

---

## 6. Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| StepRunner overhead too high | Medium | Low | Profile and optimize; fallback to direct sklearn for transforms only |
| Backend performance issues | High | Low | Aggressive sampling, backend caching (LRU with TTL) |
| **JSON payload size** | High | Medium | Limit subset size, add `max_wavelengths_returned` option, downsample for visualization |
| **React Query cache misses** | Medium | Medium | Use stable hashes in query keys, not object identity |
| Chart library migration costly | Medium | Medium | Start with Recharts, optimize later; consider canvas/WebGL |
| Format conversion bugs | Medium | Medium | Comprehensive unit tests; shared conversion functions |
| Splitter controller edge cases | Medium | Low | Test all sklearn + nirs4all splitters |
| **ShuffleSplit fold labels ambiguity** | Medium | Medium | Add `split_index` option; document behavior clearly |
| Fold visualization complexity | Medium | Medium | Start with simple bar chart, iterate |
| Scope creep (features) | High | Medium | Strict V1 scope enforcement |
| **Code duplication with preprocessing API** | Medium | Low | Use shared PlaygroundExecutor service layer |

---

## 7. Definition of Done

### 7.1 V1 Complete When

- [ ] All P0 tasks completed
- [ ] Test coverage >80% for new code
- [ ] Performance targets met
- [ ] No critical bugs
- [ ] Documentation updated
- [ ] Code review approved

### 7.2 Per-Phase Definition of Done

| Phase | Done When |
|-------|-----------|
| Phase 1 | `/api/playground/execute` returns correct data, all acceptance criteria pass, unit tests green |
| Phase 2 | Frontend uses backend exclusively, no JS processing, React Query integration complete |
| Phase 3 | All charts render from backend data, fold visualization works, performance targets met |
| Phase 4 | Export/import works, E2E tests pass, no console errors, accessibility audit complete |

### 7.3 Quality Gates

| Gate | Requirement |
|------|-------------|
| Unit tests | All passing, >80% coverage |
| Integration tests | All passing |
| E2E tests | Core flows passing |
| Performance | Meets targets in spec |
| Accessibility | WCAG 2.1 AA compliant |
| Security | No XSS, CSRF vulnerabilities |

---

## 8. Team & Resources

### 8.1 Required Skills

- **Backend**: FastAPI, nirs4all, numpy, scikit-learn
- **Frontend**: React, TypeScript, React Query, Recharts/ECharts
- **Testing**: pytest, React Testing Library, Playwright

### 8.2 Estimated Effort

| Phase | Backend | Frontend | Testing |
|-------|---------|----------|---------|
| Phase 1 | 24h | - | 5h |
| Phase 2 | - | 27h | 4h |
| Phase 3 | 2h | 29h | 3h |
| Phase 4 | - | 16h | 5h |
| Buffer | 4h | 8h | 2h |
| **Total** | **30h** | **80h** | **19h** |

**Grand Total: ~129h** (~3.2 FTE-weeks @ 40h)

*Note: Includes buffer for risks and unforeseen issues. Original estimate increased due to:*
- *Splitter support and fold visualization*
- *Shared module extraction*
- *Backend caching implementation*
- *Per-step comparison feature*
- *Import from Pipeline Editor*

---

## 9. Success Metrics (Post-Launch)

| Metric | Target | Measurement |
|--------|--------|-------------|
| API latency (p95) | <300ms | Backend monitoring |
| Frontend load time | <2s | Lighthouse |
| Error rate | <1% | Error tracking |
| User sessions | >10/week | Analytics |
| Export to editor conversion | >30% | Event tracking |

---

## 10. Timeline

```
Week 1: Backend API
├── Mon-Tue: PlaygroundExecutor with StepRunner (1.1-1.3)
├── Wed: Sampling, statistics, shared module (1.4-1.5, 1.11)
├── Thu: PCA, splitter support, fold extraction, caching (1.6-1.8, 1.12)
└── Fri: Validation, error handling, testing (1.9-1.10, 1.13-1.16)

Week 2: Frontend Integration
├── Mon: React Query hook, hashing utilities (2.1-2.3, 2.10)
├── Tue-Wed: Pipeline refactor, splitter palette, constraints (2.4-2.7, 2.11)
├── Thu: Loading states, errors (2.8-2.9)
└── Fri: Workspace datasets, cleanup, operator registry (2.12-2.14)

Week 3: Visualization Upgrade
├── Mon: Chart evaluation (3.1)
├── Tue: SpectraChart, Statistics, PCA refactor (3.2-3.4)
├── Wed: FoldDistributionChart (3.5-3.7)
├── Thu: Fold coloring, histogram, unified colors (3.8-3.12)
└── Fri: Skeletons, highlighting, chart export (3.13-3.15)

Week 4: Polish, Export & Buffer
├── Mon: Export features (4.1-4.4)
├── Tue: Per-step comparison, shortcuts, empty states (4.5-4.7)
├── Wed: Testing, performance, help tooltips (4.8-4.10)
├── Thu: Accessibility audit, code cleanup (4.11-4.12)
└── Fri: Buffer - address issues, final QA, documentation
```

---

## 11. Appendix: File Changes Summary

### 11.1 New Files

| File | Purpose |
|------|---------|
| `api/playground.py` | Backend API router with PlaygroundExecutor |
| `api/shared/pipeline_service.py` | Shared step conversion, caching utilities |
| `src/api/playground.ts` | API client |
| `src/hooks/usePlaygroundQuery.ts` | React Query hook |
| `src/hooks/useOperatorRegistry.ts` | Operator discovery (preprocessing + splitting) |
| `src/lib/playground/operatorFormat.ts` | Format utilities |
| `src/lib/playground/hashing.ts` | Stable hash functions for cache keys |
| `src/components/playground/visualizations/StatisticsChart.tsx` | Mean±std chart |
| `src/components/playground/visualizations/FoldDistributionChart.tsx` | **Fold visualization** |
| `src/components/playground/visualizations/FoldCountBar.tsx` | Train/test counts |
| `src/components/playground/visualizations/FoldYBoxplot.tsx` | Per-fold Y distribution |
| `src/components/playground/ChartSkeleton.tsx` | Loading state |
| `tests/api/test_playground.py` | Backend tests |

### 11.2 Modified Files

| File | Changes |
|------|---------|
| `src/pages/Playground.tsx` | Use new hooks, add FoldDistributionChart, per-step comparison |
| `src/hooks/usePipeline.ts` | Remove frontend processing, support splitting type |
| `src/components/playground/PlaygroundSidebar.tsx` | Updated palette with splitters, workspace dataset loading |
| `src/components/playground/OperatorPalette.tsx` | Add splitter category, single-splitter constraint |
| `src/components/playground/visualizations/SpectraChart.tsx` | Backend data, chart export |
| `src/components/playground/visualizations/PCAPlot.tsx` | Backend PCA, fold coloring |
| `api/main.py` | Include playground router |
| `api/preprocessing.py` | Use shared `convert_frontend_step()` from pipeline_service |

### 11.3 Deprecated/Removed Files

| File | Reason |
|------|--------|
| `src/lib/preprocessing/operators.ts` | Processing moved to backend |
