"""
Playground API routes for nirs4all webapp.

This module provides FastAPI routes for real-time spectral data exploration,
enabling users to:
- Execute preprocessing and splitting pipelines in real-time
- Get before/after comparison with statistics
- Visualize fold distributions for splitters
- Export validated pipelines to Pipeline Editor

Phase 1 Feature: Backend API for Playground V1
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

import importlib.util
UMAP_AVAILABLE = importlib.util.find_spec("umap") is not None

from .lazy_imports import get_cached, is_ml_ready, require_ml_ready
NIRS4ALL_AVAILABLE = True

try:
    import msgpack
    MSGPACK_AVAILABLE = True
except ImportError:
    MSGPACK_AVAILABLE = False

from .shared.decimation import decimate_wavelengths
from .shared.filter_operators import (
    get_filter_methods,
    instantiate_filter,
)
from .shared.metrics_computer import (
    ALL_METRICS,
    CHEMOMETRIC_METRICS,
    FAST_METRICS,
    MetricsComputer,
    get_available_metrics,
)
from .shared.pipeline_service import (
    convert_frontend_step,
    get_augmentation_methods,
    get_preprocessing_methods,
    get_splitter_methods,
    instantiate_operator,
    validate_step_params,
)

router = APIRouter(prefix="/playground", tags=["playground"])


# ============= Pydantic Models =============


class PlaygroundStep(BaseModel):
    """A single pipeline step in the playground."""

    id: str = Field(..., description="Unique step identifier")
    type: str = Field(..., description="Step type: 'preprocessing', 'augmentation', 'splitting', or 'filter'")
    name: str = Field(..., description="Operator class name (e.g., 'StandardNormalVariate')")
    params: dict[str, Any] = Field(default_factory=dict, description="Operator parameters")
    enabled: bool = Field(default=True, description="Whether the step is enabled")


class PlaygroundData(BaseModel):
    """Input data for playground execution."""

    x: list[list[float]] = Field(..., description="2D spectral data (samples x features)")
    y: list[float] | None = Field(None, description="Target values (optional)")
    wavelengths: list[float] | None = Field(None, description="Wavelength headers")
    sample_ids: list[str] | None = Field(None, description="Sample identifiers")
    metadata: dict[str, list[Any]] | None = Field(None, description="Additional metadata columns")


class SamplingOptions(BaseModel):
    """Options for data sampling."""

    method: str = Field("random", description="Sampling method: 'random', 'stratified', 'kmeans', 'all'")
    n_samples: int = Field(100, ge=1, le=1000, description="Number of samples to select")
    seed: int = Field(42, ge=0, description="Random seed for reproducibility")


class ExecuteRequest(BaseModel):
    """Request model for executing playground pipeline."""

    data: PlaygroundData = Field(..., description="Spectral data to process")
    steps: list[PlaygroundStep] = Field(default_factory=list, description="Pipeline steps to execute")
    sampling: SamplingOptions | None = Field(None, description="Sampling options for large datasets")
    options: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional options: compute_pca, compute_statistics, max_wavelengths_returned, split_index"
    )


class ExecuteDatasetRequest(BaseModel):
    """Request model for executing playground pipeline on a workspace dataset.

    Instead of sending the full spectral data matrix, the client sends only
    a dataset_id. The backend loads the dataset server-side, eliminating the
    data round-trip (Backend → Frontend → Backend).
    """

    dataset_id: str = Field(..., description="Workspace dataset identifier")
    steps: list[PlaygroundStep] = Field(default_factory=list, description="Pipeline steps to execute")
    sampling: SamplingOptions | None = Field(None, description="Sampling options for large datasets")
    options: dict[str, Any] = Field(
        default_factory=dict,
        description="Additional options: compute_pca, compute_statistics, max_wavelengths_returned, split_index"
    )


class ChartComputeRequest(BaseModel):
    """Request for computing a specific chart from cached pipeline data.

    Used by parallel chart endpoints (/playground/pca, /playground/repetitions)
    to compute individual chart data independently of the main execute response.
    """

    dataset_id: str | None = Field(None, description="Workspace dataset identifier (for server-side data loading)")
    steps: list[PlaygroundStep] = Field(default_factory=list, description="Pipeline steps (used for step cache lookup)")
    sampling: SamplingOptions | None = Field(None, description="Sampling options")
    options: dict[str, Any] = Field(default_factory=dict, description="Execution options")


class StepTrace(BaseModel):
    """Execution trace for a single step."""

    step_id: str
    name: str
    duration_ms: float
    success: bool
    error: str | None = None
    output_shape: list[int] | None = None


class SpectrumStats(BaseModel):
    """Statistics for a spectrum or set of spectra."""

    mean: list[float]
    std: list[float]
    min: list[float]
    max: list[float]
    p5: list[float]
    p95: list[float]
    global_stats: dict[str, float]


class FoldInfo(BaseModel):
    """Information about a single fold."""

    train_count: int
    test_count: int
    train_indices: list[int]
    test_indices: list[int]
    y_train_stats: dict[str, float] | None = None
    y_test_stats: dict[str, float] | None = None


class ExecuteResponse(BaseModel):
    """Response model for playground execution."""

    success: bool
    execution_time_ms: float
    original: dict[str, Any] = Field(
        default_factory=dict,
        description="Original data: spectra subset, statistics, sample_indices"
    )
    processed: dict[str, Any] = Field(
        default_factory=dict,
        description="Processed data: spectra subset, statistics"
    )
    pca: dict[str, Any] | None = Field(None, description="PCA projection if computed")
    umap: dict[str, Any] | None = Field(None, description="UMAP projection if computed")
    folds: dict[str, Any] | None = Field(None, description="Fold information if splitter present")
    filter_info: dict[str, Any] | None = Field(None, description="Filter results if filters applied")
    repetitions: dict[str, Any] | None = Field(None, description="Repetition analysis if detected or configured")
    metrics: dict[str, Any] | None = Field(None, description="Spectral metrics if computed (Phase 5)")
    subset_info: dict[str, Any] | None = Field(None, description="Subset mode info: subset_mode, total_samples, displayed_samples")
    execution_trace: list[StepTrace] = Field(default_factory=list, description="Per-step execution info")
    step_errors: list[dict[str, Any]] = Field(default_factory=list, description="Any step-level errors")
    is_raw_data: bool = Field(default=False, description="True if no operators were applied")


# ============= PlaygroundExecutor =============


class PlaygroundExecutor:
    """Lightweight executor for playground pipeline preview.

    Uses nirs4all operators directly (fit_transform) without full StepRunner
    infrastructure to minimize overhead for real-time preview.

    Features:
    - Transforms spectral data using nirs4all preprocessing operators
    - Applies splitters to generate fold assignments
    - Computes statistics and PCA for visualization
    - Tracks execution time per step

    Important Notes:
    - Splitters are executed on the SAMPLED data subset, not the full dataset.
      This means fold indices in the response refer to positions within the
      sampled subset. The `sample_indices` field in the response can be used
      to map back to original data positions if needed.
    - For accurate fold visualization on full datasets, consider using
      sampling.method='all' or increasing n_samples to cover the full dataset.
    """

    def __init__(self, verbose: int = 0):
        self.verbose = verbose

    def execute(
        self,
        data: PlaygroundData,
        steps: list[PlaygroundStep],
        sampling: SamplingOptions | None = None,
        options: dict[str, Any] | None = None,
        *,
        X_np=None,
        y_np=None,
        wavelengths_np: list[float] | None = None,
    ) -> ExecuteResponse:
        """Execute pipeline on data.

        Args:
            data: Input spectral data (used when X_np is not provided)
            steps: Pipeline steps to execute
            sampling: Sampling options for large datasets
            options: Additional execution options
            X_np: Pre-converted numpy X array (avoids list→numpy conversion)
            y_np: Pre-converted numpy y array (avoids list→numpy conversion)
            wavelengths_np: Pre-extracted wavelength list (avoids re-extraction)

        Returns:
            ExecuteResponse with results and traces
        """
        import numpy as np
        start_time = time.perf_counter()
        options = options or {}

        # Use pre-converted numpy arrays if provided (fast path from execute-dataset)
        if X_np is not None:
            X_original = X_np if X_np.dtype == np.float64 else X_np.astype(np.float64)
            y = y_np.astype(np.float64) if y_np is not None else None
            wavelengths = wavelengths_np or list(range(X_original.shape[1]))
        else:
            # Convert input from Python lists to numpy arrays (slow path)
            X_original = np.array(data.x, dtype=np.float64)
            y = np.array(data.y, dtype=np.float64) if data.y else None
            wavelengths = data.wavelengths or list(range(X_original.shape[1]))

        # Convert metadata to numpy arrays if provided
        metadata = None
        if data.metadata:
            metadata = {k: np.array(v) for k, v in data.metadata.items()}

        # Subset mode: when 'visible', select a representative subset BEFORE processing
        subset_mode = options.get("subset_mode", "all")
        subset_info = None
        total_samples = X_original.shape[0]

        if subset_mode == "visible":
            from nirs4all.data.selection.sampling import random_sample, stratified_sample

            max_displayed = options.get("max_samples_displayed", 200)
            n_select = min(max_displayed, total_samples)

            if n_select < total_samples:
                # Use stratified sampling if Y is available for representative subset
                if y is not None:
                    try:
                        subset_indices = stratified_sample(X_original, y, n_select, seed=42)
                    except Exception:
                        subset_indices = random_sample(total_samples, n_select, seed=42)
                else:
                    subset_indices = random_sample(total_samples, n_select, seed=42)

                # Apply subset to the original data before any processing
                X_original = X_original[subset_indices]
                if y is not None:
                    y = y[subset_indices]
                if metadata:
                    metadata = {k: v[subset_indices] for k, v in metadata.items()}
                if data.sample_ids:
                    data = PlaygroundData(
                        x=[data.x[i] for i in subset_indices],
                        y=[data.y[i] for i in subset_indices] if data.y else None,
                        wavelengths=data.wavelengths,
                        sample_ids=[data.sample_ids[i] for i in subset_indices],
                        metadata={k: [v[i] for i in subset_indices] for k, v in data.metadata.items()} if data.metadata else None,
                    )

                subset_info = {
                    "subset_mode": "visible",
                    "total_samples": total_samples,
                    "displayed_samples": n_select,
                }
            else:
                subset_info = {
                    "subset_mode": "visible",
                    "total_samples": total_samples,
                    "displayed_samples": total_samples,
                }

        # Apply sampling if needed (post-subset sampling, usually 'all' when subset_mode is active)
        sample_indices = self._apply_sampling(X_original, y, sampling)
        X_sampled = X_original[sample_indices]
        y_sampled = y[sample_indices] if y is not None else None
        metadata_sampled = None
        if metadata:
            metadata_sampled = {k: v[sample_indices] for k, v in metadata.items()}

        # Check if we have any enabled operators (raw data mode check)
        enabled_steps = [s for s in steps if s.enabled]
        is_raw_data = len(enabled_steps) == 0

        # Execute pipeline steps with step-level prefix caching
        X_processed = X_sampled.copy()
        execution_trace: list[StepTrace] = []
        step_errors: list[dict[str, Any]] = []
        fold_info = None
        filter_info = None
        splitter_applied = False
        total_filtered = 0
        filter_mask = np.ones(X_sampled.shape[0], dtype=bool)

        # Step-level prefix cache: find longest cached prefix to skip steps
        data_fp = _compute_data_fingerprint(X_sampled)
        skip_count = 0
        if enabled_steps:
            for i in range(len(enabled_steps), 0, -1):
                prefix_key = _compute_prefix_key(data_fp, enabled_steps[:i])
                cached_state = _step_cache.get(prefix_key)
                if cached_state is not None:
                    X_processed = cached_state["X"].copy()
                    fold_info = cached_state.get("fold_info")
                    filter_info = cached_state.get("filter_info")
                    filter_mask = cached_state.get("filter_mask", np.ones(X_sampled.shape[0], dtype=bool)).copy()
                    execution_trace = list(cached_state.get("trace", []))
                    step_errors = list(cached_state.get("errors", []))
                    splitter_applied = cached_state.get("splitter_applied", False)
                    total_filtered = cached_state.get("total_filtered", 0)
                    skip_count = i
                    break

        executed_step_idx = 0
        for step in steps:
            if not step.enabled:
                continue

            executed_step_idx += 1
            # Skip steps already restored from cache
            if executed_step_idx <= skip_count:
                continue

            step_start = time.perf_counter()
            try:
                if step.type == "splitting":
                    # Handle splitter
                    fold_info = self._execute_splitter(
                        step, X_processed, y_sampled, options
                    )
                    splitter_applied = True
                    trace = StepTrace(
                        step_id=step.id,
                        name=step.name,
                        duration_ms=(time.perf_counter() - step_start) * 1000,
                        success=True,
                        output_shape=None  # Splitters don't change data shape
                    )
                elif step.type == "filter":
                    # Handle filter operators
                    step_mask, filter_result = self._execute_filter(
                        step, X_processed, y_sampled, metadata_sampled
                    )
                    filter_mask &= step_mask
                    removed_count = int(np.sum(~step_mask))
                    total_filtered += removed_count

                    trace = StepTrace(
                        step_id=step.id,
                        name=step.name,
                        duration_ms=(time.perf_counter() - step_start) * 1000,
                        success=True,
                        output_shape=[int(np.sum(step_mask)), X_processed.shape[1]]
                    )

                    # Store filter info
                    if filter_info is None:
                        filter_info = {
                            "filters_applied": [],
                            "total_removed": 0,
                            "final_mask": filter_mask.tolist(),
                        }
                    filter_info["filters_applied"].append({
                        "name": step.name,
                        "removed_count": removed_count,
                        "reason": filter_result.get("reason", "Filtered"),
                    })
                else:
                    # Handle preprocessing / augmentation
                    X_processed = self._execute_preprocessing(step, X_processed)
                    trace = StepTrace(
                        step_id=step.id,
                        name=step.name,
                        duration_ms=(time.perf_counter() - step_start) * 1000,
                        success=True,
                        output_shape=list(X_processed.shape)
                    )

                execution_trace.append(trace)

                # Cache the intermediate state after each step
                prefix_key = _compute_prefix_key(data_fp, enabled_steps[:executed_step_idx])
                _step_cache.put(prefix_key, {
                    "X": X_processed.copy(),
                    "fold_info": fold_info,
                    "filter_info": filter_info,
                    "filter_mask": filter_mask.copy(),
                    "trace": list(execution_trace),
                    "errors": list(step_errors),
                    "splitter_applied": splitter_applied,
                    "total_filtered": total_filtered,
                })

            except Exception as e:
                trace = StepTrace(
                    step_id=step.id,
                    name=step.name,
                    duration_ms=(time.perf_counter() - step_start) * 1000,
                    success=False,
                    error=str(e)
                )
                execution_trace.append(trace)
                step_errors.append({
                    "step": step.id,
                    "name": step.name,
                    "error": str(e)
                })
                # Continue with next step (don't break pipeline)

        # Compute statistics
        compute_stats = options.get("compute_statistics", True)
        original_stats = self._compute_statistics(X_sampled) if compute_stats else None
        processed_stats = self._compute_statistics(X_processed) if compute_stats else None

        # Compute PCA
        compute_pca = options.get("compute_pca", True)
        pca_result = None
        if compute_pca:
            try:
                pca_result = self._compute_pca(X_processed, y_sampled, fold_info)
            except Exception as e:
                pca_result = {"error": str(e)}

        # Compute UMAP (optional, can be expensive)
        compute_umap = options.get("compute_umap", False)
        umap_result = None
        if compute_umap:
            try:
                umap_params = options.get("umap_params", {})
                umap_result = self._compute_umap(
                    X_processed,
                    y_sampled,
                    fold_info,
                    n_neighbors=umap_params.get("n_neighbors", 15),
                    min_dist=umap_params.get("min_dist", 0.1),
                    n_components=umap_params.get("n_components", 2)
                )
            except Exception as e:
                umap_result = {"error": str(e), "available": UMAP_AVAILABLE}

        # Compute repetition analysis (Phase 4)
        compute_repetitions = options.get("compute_repetitions", True)
        repetition_result = None
        if compute_repetitions:
            try:
                # Get sample IDs for the sampled subset
                sampled_sample_ids = None
                if data.sample_ids:
                    sampled_sample_ids = [data.sample_ids[i] for i in sample_indices]

                repetition_result = self._compute_repetition_analysis(
                    X=X_processed,
                    sample_ids=sampled_sample_ids,
                    metadata=metadata_sampled,
                    pca_result=pca_result,
                    umap_result=umap_result,
                    y=y_sampled,
                    options=options
                )
            except Exception as e:
                repetition_result = {"error": str(e), "has_repetitions": False}

        # Compute spectral metrics (Phase 5) - disabled by default for performance
        compute_metrics = options.get("compute_metrics", False)
        metrics_result = None
        if compute_metrics:
            try:
                metrics_result = self._compute_metrics(
                    X=X_processed,
                    pca_result=pca_result,
                    wavelengths=np.array(wavelengths),
                    requested_metrics=options.get("metrics", None),  # None = fast metrics
                )
            except Exception as e:
                metrics_result = {"error": str(e)}

        # Downsample wavelengths for visualization using LTTB.
        # Only decimate when explicitly requested via max_wavelengths_returned > 0.
        max_wavelengths = options.get("max_wavelengths_returned")
        wavelengths_out = wavelengths
        X_sampled_out = X_sampled
        X_processed_out = X_processed

        if max_wavelengths and max_wavelengths > 0 and len(wavelengths) > max_wavelengths:
            # Use LTTB on the processed mean spectrum for feature-preserving decimation
            wl_array = np.asarray(wavelengths, dtype=np.float64)
            indices = decimate_wavelengths(wl_array, X_processed, max_wavelengths)
            wavelengths_out = [wavelengths[i] for i in indices]
            X_sampled_out = X_sampled[:, indices]
            X_processed_out = X_processed[:, indices]

        # Build response
        total_time = (time.perf_counter() - start_time) * 1000

        response = ExecuteResponse(
            success=len(step_errors) == 0,
            execution_time_ms=total_time,
            original={
                "spectra": X_sampled_out.tolist(),
                "wavelengths": wavelengths_out,
                "sample_indices": sample_indices.tolist(),
                "shape": list(X_sampled.shape),
                "statistics": original_stats,
            },
            processed={
                "spectra": X_processed_out.tolist(),
                "wavelengths": wavelengths_out,
                "shape": list(X_processed.shape),
                "statistics": processed_stats,
            },
            pca=pca_result,
            umap=umap_result,
            folds=fold_info,
            filter_info=filter_info,
            repetitions=repetition_result,
            metrics=metrics_result,
            subset_info=subset_info,
            execution_trace=execution_trace,
            step_errors=step_errors,
            is_raw_data=is_raw_data
        )

        return response

    def _apply_sampling(
        self,
        X,
        y,
        sampling: SamplingOptions | None
    ):
        """Apply sampling to select subset of samples.

        Delegates to nirs4all.data.selection.sampling for the actual
        sampling strategies (random, stratified, kmeans).

        Args:
            X: Full data array
            y: Target values (for stratified sampling)
            sampling: Sampling configuration

        Returns:
            Array of selected sample indices
        """
        import numpy as np
        n_samples = X.shape[0]

        if sampling is None or sampling.method == "all":
            return np.arange(n_samples)

        from nirs4all.data.selection.sampling import kmeans_sample, random_sample, stratified_sample

        n_select = min(sampling.n_samples, n_samples)

        if sampling.method == "random":
            return random_sample(n_samples, n_select, seed=sampling.seed)

        elif sampling.method == "stratified" and y is not None:
            return stratified_sample(X, y, n_select, seed=sampling.seed)

        elif sampling.method == "kmeans":
            return kmeans_sample(X, n_select, seed=sampling.seed)

        else:
            return random_sample(n_samples, n_select, seed=sampling.seed)

    def _execute_preprocessing(
        self,
        step: PlaygroundStep,
        X,
    ):
        """Execute a preprocessing step.

        Args:
            step: Step configuration
            X: Input data

        Returns:
            Transformed data
        """
        operator = instantiate_operator(step.name, step.params, "preprocessing")
        if operator is None:
            raise ValueError(f"Unknown preprocessing operator: {step.name}")

        return operator.fit_transform(X)

    def _execute_filter(
        self,
        step: PlaygroundStep,
        X,
        y,
        metadata,
    ) -> tuple:
        """Execute a filter step.

        Args:
            step: Step configuration
            X: Input data
            y: Target values
            metadata: Sample metadata

        Returns:
            Tuple of (boolean mask, filter result info)
        """
        import numpy as np
        filter_op = instantiate_filter(step.name, step.params)
        if filter_op is None:
            raise ValueError(f"Unknown filter operator: {step.name}")

        mask = filter_op.fit_predict(X, y, metadata)
        reason = filter_op.get_removal_reason()

        return mask, {"reason": reason, "kept": int(np.sum(mask)), "removed": int(np.sum(~mask))}

    def _execute_splitter(
        self,
        step: PlaygroundStep,
        X,
        y,
        options: dict[str, Any]
    ) -> dict[str, Any]:
        """Execute a splitter step.

        Args:
            step: Step configuration
            X: Input data
            y: Target values (may be required by some splitters)
            options: Execution options (split_index for ShuffleSplit-like)

        Returns:
            Fold information dict
        """
        import numpy as np
        operator = instantiate_operator(step.name, step.params, "splitting")
        if operator is None:
            raise ValueError(f"Unknown splitter: {step.name}")

        # Prepare arguments for split()
        kwargs = {}
        if y is not None:
            # Check if splitter needs y
            import inspect
            sig = inspect.signature(operator.split)
            if "y" in sig.parameters:
                # For stratified splitters with continuous y, bin into classes
                if "Stratified" in step.name and y is not None:
                    # Bin continuous y into quantile-based classes
                    n_bins = min(5, len(np.unique(y)))
                    if n_bins > 1:
                        y_binned = np.digitize(
                            y, np.percentile(y, np.linspace(0, 100, n_bins + 1)[1:-1])
                        )
                        kwargs["y"] = y_binned
                    else:
                        kwargs["y"] = y
                else:
                    kwargs["y"] = y

        # Generate folds
        folds_list = list(operator.split(X, **kwargs))

        # Handle split_index for ShuffleSplit-like splitters
        split_index = options.get("split_index")

        # Build fold info
        folds_data = []
        fold_labels = np.full(X.shape[0], -1, dtype=int)  # -1 = not assigned

        for fold_idx, (train_indices, test_indices) in enumerate(folds_list):
            train_indices = np.array(train_indices)
            test_indices = np.array(test_indices)

            fold_data = {
                "fold_index": fold_idx,
                "train_count": len(train_indices),
                "test_count": len(test_indices),
                "train_indices": train_indices.tolist(),
                "test_indices": test_indices.tolist(),
            }

            # Compute per-fold Y statistics
            if y is not None:
                y_train = y[train_indices]
                y_test = y[test_indices] if len(test_indices) > 0 else np.array([])

                fold_data["y_train_stats"] = {
                    "mean": float(np.mean(y_train)),
                    "std": float(np.std(y_train)),
                    "min": float(np.min(y_train)),
                    "max": float(np.max(y_train)),
                }

                if len(y_test) > 0:
                    fold_data["y_test_stats"] = {
                        "mean": float(np.mean(y_test)),
                        "std": float(np.std(y_test)),
                        "min": float(np.min(y_test)),
                        "max": float(np.max(y_test)),
                    }

            folds_data.append(fold_data)

            # For fold labels, use split_index if specified (for ShuffleSplit-like)
            # Otherwise, use the last fold (for K-Fold, this gives test fold assignment)
            if split_index is not None:
                if fold_idx == split_index:
                    fold_labels[test_indices] = fold_idx
            else:
                fold_labels[test_indices] = fold_idx

        return {
            "splitter_name": step.name,
            "n_folds": len(folds_list),
            "folds": folds_data,
            "fold_labels": fold_labels.tolist(),
            "split_index": split_index,
        }

    def _compute_statistics(self, X) -> dict[str, Any]:
        """Compute per-wavelength statistics.

        Args:
            X: Data array (samples x features)

        Returns:
            Statistics dict
        """
        import numpy as np
        return {
            "mean": np.mean(X, axis=0).tolist(),
            "std": np.std(X, axis=0).tolist(),
            "min": np.min(X, axis=0).tolist(),
            "max": np.max(X, axis=0).tolist(),
            "p5": np.percentile(X, 5, axis=0).tolist(),
            "p95": np.percentile(X, 95, axis=0).tolist(),
            "global": {
                "mean": float(np.mean(X)),
                "std": float(np.std(X)),
                "min": float(np.min(X)),
                "max": float(np.max(X)),
                "n_samples": X.shape[0],
                "n_features": X.shape[1],
            }
        }

    def _compute_pca(
        self,
        X,
        y,
        fold_info: dict[str, Any] | None
    ) -> dict[str, Any]:
        """Compute PCA projection for visualization.

        Delegates to nirs4all.analysis.compute_pca_projection for the actual
        computation, then adds UI-specific coloring data (y values, fold labels).

        Args:
            X: Processed data
            y: Target values for coloring
            fold_info: Fold assignments for coloring

        Returns:
            PCA result dict
        """
        try:
            from nirs4all.analysis import compute_pca_projection
            pca_data = compute_pca_projection(X, max_components=10, variance_threshold=0.999)
        except Exception as e:
            return {"error": str(e)}

        result = {
            "coordinates": pca_data["coordinates"],
            "explained_variance_ratio": pca_data["explained_variance_ratio"],
            "explained_variance": pca_data["explained_variance"],
            "n_components": pca_data["n_components"],
            "n_components_999": pca_data["n_components_threshold"],
        }

        # Add target values for coloring
        if y is not None:
            result["y"] = y.tolist()

        # Add fold labels for coloring
        if fold_info is not None:
            result["fold_labels"] = fold_info.get("fold_labels")

        return result

    def _compute_umap(
        self,
        X,
        y,
        fold_info: dict[str, Any] | None,
        n_neighbors: int = 15,
        min_dist: float = 0.1,
        n_components: int = 2
    ) -> dict[str, Any]:
        """Compute UMAP projection for visualization.

        UMAP (Uniform Manifold Approximation and Projection) is a dimension
        reduction technique that preserves local and global data structure
        better than PCA for non-linear relationships.

        Args:
            X: Processed data
            y: Target values for coloring
            fold_info: Fold assignments for coloring
            n_neighbors: Number of neighbors for UMAP (default 15)
            min_dist: Minimum distance parameter for UMAP (default 0.1)
            n_components: Number of output dimensions (2 or 3)

        Returns:
            UMAP result dict with coordinates and parameters
        """
        if not UMAP_AVAILABLE:
            return {
                "error": "UMAP not available. Install umap-learn in Settings > Dependencies.",
                "available": False
            }

        # Validate inputs
        n_samples = X.shape[0]
        if n_samples < 10:
            return {
                "error": f"UMAP requires at least 10 samples, got {n_samples}",
                "available": True
            }

        # Clamp n_neighbors to valid range
        n_neighbors = min(max(2, n_neighbors), n_samples - 1)
        n_components = min(max(2, n_components), 3)

        try:
            import umap as _umap
            reducer = _umap.UMAP(
                n_components=n_components,
                n_neighbors=n_neighbors,
                min_dist=min_dist,
                random_state=42,
                n_jobs=-1,
            )
            X_umap = reducer.fit_transform(X)
        except Exception as e:
            return {
                "error": str(e),
                "available": True
            }

        result = {
            "coordinates": X_umap.tolist(),
            "n_components": n_components,
            "params": {
                "n_neighbors": n_neighbors,
                "min_dist": min_dist
            },
            "available": True
        }

        # Add target values for coloring
        if y is not None:
            result["y"] = y.tolist()

        # Add fold labels for coloring
        if fold_info is not None:
            result["fold_labels"] = fold_info.get("fold_labels")

        return result

    def _compute_repetition_analysis(
        self,
        X,
        sample_ids: list[str] | None,
        metadata,
        pca_result: dict[str, Any] | None,
        umap_result: dict[str, Any] | None,
        y,
        options: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Compute repetition variability metrics for biological sample repeats.

        Identifies biological samples with multiple measurements (repetitions) and
        computes the variability (distance) between repetitions in various metric
        spaces (PCA, UMAP, Euclidean, Mahalanobis).

        Args:
            X: Processed spectral data (samples x features)
            sample_ids: Optional sample identifiers
            metadata: Optional metadata dict with arrays
            pca_result: PCA projection result (for PCA distance)
            umap_result: UMAP projection result (for UMAP distance)
            y: Target values for coloring
            options: Repetition configuration options:
                - bio_sample_column: Metadata column containing bio sample ID
                - bio_sample_pattern: Regex pattern to extract bio ID from sample_id
                - distance_metric: 'pca', 'umap', 'euclidean', 'mahalanobis'
                - auto_detect: If True, try to auto-detect repetitions

        Returns:
            Repetition analysis dict or None if no repetitions detected
        """
        import re
        from collections import defaultdict
        import numpy as np

        # Get configuration
        bio_sample_column = options.get("bio_sample_column")
        bio_sample_pattern = options.get("bio_sample_pattern")
        auto_detect = options.get("auto_detect_repetitions", True)
        distance_metric = options.get("distance_metric", "pca")

        n_samples = X.shape[0]

        # Generate sample IDs if not provided
        if sample_ids is None:
            sample_ids = [f"Sample_{i}" for i in range(n_samples)]

        # Try to identify biological sample grouping
        bio_sample_map: dict[str, list[int]] = defaultdict(list)

        if bio_sample_column and metadata and bio_sample_column in metadata:
            # Use specified metadata column
            bio_col = metadata[bio_sample_column]
            for idx, bio_id in enumerate(bio_col):
                bio_sample_map[str(bio_id)].append(idx)
        elif bio_sample_pattern:
            # Use regex pattern on sample IDs
            try:
                pattern = re.compile(bio_sample_pattern)
                for idx, sample_id in enumerate(sample_ids):
                    match = pattern.match(str(sample_id))
                    if match:
                        bio_id = match.group(1) if match.groups() else match.group(0)
                        bio_sample_map[bio_id].append(idx)
                    else:
                        # Non-matching samples get their own group
                        bio_sample_map[sample_id].append(idx)
            except re.error:
                return {"error": f"Invalid regex pattern: {bio_sample_pattern}"}
        elif auto_detect:
            # Try common patterns for repetition detection
            # Pattern 1: SampleName_rep1, SampleName_rep2, etc.
            # Pattern 2: SampleName_1, SampleName_2, etc.
            # Pattern 3: SampleName-A, SampleName-B, etc.

            patterns = [
                r"^(.+?)[-_][Rr]ep\d+$",      # sample_rep1, sample-Rep2
                r"^(.+?)[-_]\d+$",            # sample_1, sample-2
                r"^(.+?)[-_][A-Za-z]$",       # sample_A, sample-b
                r"^(.+?)\s*\(\d+\)$",         # sample (1), sample (2)
            ]

            best_pattern = None
            best_groups = {}
            best_rep_count = 0

            for pattern in patterns:
                try:
                    compiled = re.compile(pattern)
                    groups: dict[str, list[int]] = defaultdict(list)

                    for idx, sample_id in enumerate(sample_ids):
                        match = compiled.match(str(sample_id))
                        if match:
                            bio_id = match.group(1)
                            groups[bio_id].append(idx)
                        else:
                            groups[sample_id].append(idx)

                    # Count samples with repetitions
                    rep_count = sum(1 for indices in groups.values() if len(indices) >= 2)
                    if rep_count > best_rep_count:
                        best_rep_count = rep_count
                        best_pattern = pattern
                        best_groups = dict(groups)

                except re.error:
                    continue

            if best_rep_count > 0:
                bio_sample_map = best_groups
            else:
                # No repetitions detected
                return {
                    "has_repetitions": False,
                    "n_bio_samples": n_samples,
                    "n_with_reps": 0,
                    "detected_pattern": None,
                    "message": "No repetitions detected. Samples appear to be unique."
                }

        # Filter to only bio samples with repetitions
        bio_samples_with_reps = {
            bio_id: indices
            for bio_id, indices in bio_sample_map.items()
            if len(indices) >= 2
        }

        if not bio_samples_with_reps:
            return {
                "has_repetitions": False,
                "n_bio_samples": len(bio_sample_map),
                "n_with_reps": 0,
                "detected_pattern": bio_sample_pattern,
                "message": "No biological samples with repetitions found."
            }

        # Compute distances between repetitions
        data_points = []

        for bio_id, indices in bio_samples_with_reps.items():
            # Get coordinates based on distance metric
            if distance_metric == "pca" and pca_result and "coordinates" in pca_result:
                coords = np.array([pca_result["coordinates"][i] for i in indices])
            elif distance_metric == "umap" and umap_result and "coordinates" in umap_result:
                coords = np.array([umap_result["coordinates"][i] for i in indices])
            elif distance_metric == "mahalanobis":
                # Use full spectral data with covariance
                coords = X[indices]
            else:
                # Default: Euclidean in spectral space
                coords = X[indices]

            # Compute reference point and distances
            if len(indices) == 2:
                # Pairwise: first rep is reference (distance 0)
                reference = coords[0]
            else:
                # Multiple reps: use mean as reference
                reference = np.mean(coords, axis=0)

            # Compute distances from reference
            if distance_metric == "mahalanobis" and len(indices) > 2:
                # Mahalanobis distance (requires covariance matrix)
                try:
                    from scipy.spatial.distance import mahalanobis
                    cov = np.cov(coords, rowvar=False)
                    # Add small regularization for numerical stability
                    cov += np.eye(cov.shape[0]) * 1e-6
                    cov_inv = np.linalg.inv(cov)
                    distances = [mahalanobis(c, reference, cov_inv) for c in coords]
                except Exception:
                    # Fall back to Euclidean
                    distances = [float(np.linalg.norm(c - reference)) for c in coords]
            else:
                distances = [float(np.linalg.norm(c - reference)) for c in coords]

            # Get y values for this bio sample
            y_values = [float(y[i]) for i in indices] if y is not None else None
            y_mean = float(np.mean(y_values)) if y_values else None

            for rep_idx, (sample_idx, dist) in enumerate(zip(indices, distances)):
                data_points.append({
                    "bio_sample": bio_id,
                    "rep_index": rep_idx,
                    "sample_index": sample_idx,
                    "sample_id": sample_ids[sample_idx],
                    "distance": dist,
                    "y": float(y[sample_idx]) if y is not None else None,
                    "y_mean": y_mean,
                })

        # Compute summary statistics
        all_distances = [p["distance"] for p in data_points]
        max_distance = max(all_distances) if all_distances else 0
        mean_distance = float(np.mean(all_distances)) if all_distances else 0

        # Identify high-variability samples (outliers)
        if all_distances:
            distance_threshold = np.percentile(all_distances, 95)
            high_variability = [
                p for p in data_points if p["distance"] > distance_threshold
            ]
        else:
            high_variability = []

        return {
            "has_repetitions": True,
            "n_bio_samples": len(bio_sample_map),
            "n_with_reps": len(bio_samples_with_reps),
            "n_singletons": len(bio_sample_map) - len(bio_samples_with_reps),
            "total_repetitions": sum(len(indices) for indices in bio_samples_with_reps.values()),
            "distance_metric": distance_metric,
            "detected_pattern": bio_sample_pattern,
            "data": data_points,
            "statistics": {
                "mean_distance": mean_distance,
                "max_distance": max_distance,
                "std_distance": float(np.std(all_distances)) if all_distances else 0,
                "p95_distance": float(np.percentile(all_distances, 95)) if all_distances else 0,
            },
            "high_variability_samples": high_variability[:10],  # Top 10 high variability
            "bio_sample_groups": dict(list(bio_samples_with_reps.items())[:50]),  # Limit to 50 for response size
        }

    def _compute_metrics(
        self,
        X,
        pca_result: dict[str, Any] | None = None,
        wavelengths=None,
        requested_metrics: list[str] | None = None,
    ) -> dict[str, Any]:
        """Compute spectral metrics for each sample.

        Phase 5 Implementation: Spectral Metrics System

        Computes per-sample descriptors for filtering, coloring, and analysis.
        Metrics are organized by category:
        - Amplitude: global_min, global_max, dynamic_range, mean_intensity
        - Energy: l2_norm, rms_energy, auc, abs_auc
        - Shape: baseline_slope, baseline_offset, peak_count, peak_prominence_max
        - Noise: hf_variance, snr_estimate, smoothness
        - Quality: nan_count, inf_count, saturation_count, zero_count
        - Chemometric: hotelling_t2, q_residual, leverage, distance_to_centroid, lof_score

        Args:
            X: Processed spectral data (samples x features)
            pca_result: Pre-computed PCA result (for chemometric metrics)
            wavelengths: Wavelength array (for proper AUC computation)
            requested_metrics: List of specific metrics to compute. If None, computes fast metrics.

        Returns:
            Dict with computed metrics, statistics, and metadata
        """
        n_samples = X.shape[0]

        # Create metrics computer
        computer = MetricsComputer(
            n_pca_components=min(5, n_samples - 1, X.shape[1]),
            lof_n_neighbors=min(20, n_samples - 1),
        )

        # Compute metrics
        metrics_to_compute = requested_metrics if requested_metrics else FAST_METRICS

        # Compute the metrics
        computed = computer.compute(
            X=X,
            metrics=metrics_to_compute,
            pca_result=pca_result,
            wavelengths=wavelengths,
        )

        # Convert numpy arrays to lists for JSON serialization
        metrics_values = {k: v.tolist() for k, v in computed.items()}

        # Compute statistics for each metric
        metrics_stats = {}
        for metric_name, values in computed.items():
            metrics_stats[metric_name] = computer.get_metric_stats(values)

        return {
            "values": metrics_values,
            "statistics": metrics_stats,
            "computed_metrics": list(computed.keys()),
            "available_metrics": list(get_available_metrics().keys()),
            "n_samples": n_samples,
        }


# ============= Cache =============


# Simple TTL cache for pipeline results with LRU eviction
_cache: dict[str, tuple[float, ExecuteResponse]] = {}
_cache_ttl_seconds = 300  # 5 minutes
_cache_max_entries = 100


def _negotiate_response(data: dict, http_request: Request) -> Response | dict:
    """Return MessagePack or JSON response based on Accept header.

    When the client sends ``Accept: application/x-msgpack``, the response is
    serialized with MessagePack (binary, ~40-50 % smaller than JSON for numeric
    arrays, and significantly faster to parse on the frontend).  Falls back to
    the normal FastAPI response_model + ORJSONResponse flow otherwise.
    """
    accept = http_request.headers.get("accept", "")
    if MSGPACK_AVAILABLE and "application/x-msgpack" in accept:
        # Convert Pydantic models to plain dicts for msgpack
        if isinstance(data, BaseModel):
            data = data.model_dump(mode="python")
        packed = msgpack.packb(data, default=_msgpack_default, use_bin_type=True)
        return Response(content=packed, media_type="application/x-msgpack")
    # Return the dict unchanged — FastAPI handles response_model + ORJSONResponse.
    return data


def _msgpack_default(obj: Any) -> Any:
    """Fallback serializer for msgpack — handles numpy types."""
    import numpy as np
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    raise TypeError(f"Unknown type for msgpack: {type(obj)}")


def _compute_cache_key(data: PlaygroundData, steps: list[PlaygroundStep], options: dict[str, Any]) -> str:
    """Compute cache key for a request.

    Uses a fingerprint of the data (shape + sampled values) to detect
    identical datasets while avoiding hash collisions.
    """
    n_samples = len(data.x)
    n_features = len(data.x[0]) if data.x else 0

    # Use more samples for fingerprinting to reduce collisions
    # Sample first, middle, and last samples, plus some random positions
    sample_indices = [0]
    if n_samples > 1:
        sample_indices.append(n_samples - 1)
    if n_samples > 2:
        sample_indices.append(n_samples // 2)
    if n_samples > 10:
        # Add a few more distributed samples
        sample_indices.extend([n_samples // 4, 3 * n_samples // 4])

    # Use every 20th feature for efficiency with high-dimensional data
    fingerprint_samples = []
    for idx in sample_indices[:5]:  # Limit to 5 samples max
        if idx < n_samples:
            sample = data.x[idx]
            # Subsample features and round for stability
            subsampled = [round(sample[i], 6) for i in range(0, len(sample), max(1, n_features // 100))]
            fingerprint_samples.append(subsampled)

    # Include Y fingerprint if available
    y_fingerprint = None
    if data.y:
        y_fingerprint = {
            "len": len(data.y),
            "sum": round(sum(data.y), 4),
            "first": round(data.y[0], 4) if data.y else None,
            "last": round(data.y[-1], 4) if data.y else None,
        }

    key_data = {
        "data_shape": [n_samples, n_features],
        "data_fingerprint": fingerprint_samples,
        "y_fingerprint": y_fingerprint,
        "steps": [(s.id, s.name, s.enabled, json.dumps(s.params, sort_keys=True)) for s in steps],
        "options": json.dumps(options, sort_keys=True),
    }
    return hashlib.md5(json.dumps(key_data, sort_keys=True).encode()).hexdigest()


def _compute_dataset_cache_key(dataset_id: str, steps: list[PlaygroundStep], options: dict[str, Any]) -> str:
    """Compute cache key for a dataset-ref request.

    Uses dataset_id directly instead of fingerprinting data arrays,
    avoiding the need to iterate over numpy arrays.
    """
    key_data = {
        "dataset_id": dataset_id,
        "steps": [(s.id, s.name, s.enabled, json.dumps(s.params, sort_keys=True)) for s in steps],
        "options": json.dumps(options, sort_keys=True),
    }
    return hashlib.md5(json.dumps(key_data, sort_keys=True).encode()).hexdigest()


def _get_cached(cache_key: str) -> ExecuteResponse | None:
    """Get cached result if valid."""
    if cache_key in _cache:
        timestamp, result = _cache[cache_key]
        if time.time() - timestamp < _cache_ttl_seconds:
            return result
        else:
            del _cache[cache_key]
    return None


def _set_cached(cache_key: str, result: ExecuteResponse):
    """Cache a result with proper LRU eviction."""
    current_time = time.time()

    # Always clean expired entries first
    expired = [k for k, (t, _) in _cache.items() if current_time - t > _cache_ttl_seconds]
    for k in expired:
        del _cache[k]

    # If still at capacity, evict oldest entries (LRU)
    while len(_cache) >= _cache_max_entries:
        # Find oldest entry
        oldest_key = min(_cache.keys(), key=lambda k: _cache[k][0])
        del _cache[oldest_key]

    _cache[cache_key] = (current_time, result)


# ============= Step-Level Prefix Cache =============


class _StepCache:
    """LRU step-level cache for intermediate pipeline results.

    Stores the output of each pipeline prefix so subsequent requests
    that share the same prefix can skip already-computed steps.
    Memory-bounded with approximate byte-size tracking and TTL expiry.
    """

    def __init__(self, max_bytes: int = 200 * 1024 * 1024, ttl_seconds: int = 300):
        self._entries: dict[str, tuple[float, dict]] = {}
        self._sizes: dict[str, int] = {}
        self._total_bytes: int = 0
        self._max_bytes = max_bytes
        self._ttl_seconds = ttl_seconds

    def _estimate_size(self, state: dict) -> int:
        """Estimate byte size of cached state."""
        import numpy as np
        size = 0
        for v in state.values():
            if isinstance(v, np.ndarray):
                size += v.nbytes
            elif isinstance(v, (list, dict)):
                size += sys.getsizeof(v)
        return max(size, 64)  # minimum 64 bytes per entry

    def get(self, key: str) -> dict | None:
        """Get cached state if valid (not expired)."""
        if key in self._entries:
            ts, state = self._entries[key]
            if time.time() - ts < self._ttl_seconds:
                # Touch timestamp for LRU
                self._entries[key] = (time.time(), state)
                return state
            else:
                self._evict(key)
        return None

    def put(self, key: str, state: dict) -> None:
        """Store a state, evicting LRU entries if over memory budget."""
        if key in self._entries:
            self._evict(key)

        size = self._estimate_size(state)

        # Evict oldest until under budget
        while self._total_bytes + size > self._max_bytes and self._entries:
            oldest_key = min(self._entries, key=lambda k: self._entries[k][0])
            self._evict(oldest_key)

        self._entries[key] = (time.time(), state)
        self._sizes[key] = size
        self._total_bytes += size

    def _evict(self, key: str) -> None:
        if key in self._entries:
            del self._entries[key]
            self._total_bytes -= self._sizes.pop(key, 0)

    def clear(self) -> None:
        self._entries.clear()
        self._sizes.clear()
        self._total_bytes = 0


# Module-level singleton
_step_cache = _StepCache()


def _compute_prefix_key(data_fingerprint: str, steps: list) -> str:
    """Compute cache key for a pipeline prefix.

    Args:
        data_fingerprint: Hash identifying the input data.
        steps: Pipeline steps up to and including the target step.

    Returns:
        MD5 hex digest as cache key.
    """
    step_data = [(s.id, s.name, json.dumps(s.params, sort_keys=True)) for s in steps]
    raw = f"{data_fingerprint}:{json.dumps(step_data, sort_keys=True)}"
    return hashlib.md5(raw.encode()).hexdigest()


def _compute_data_fingerprint(X) -> str:
    """Compute a lightweight fingerprint of a numpy data array.

    Uses shape + first/last row bytes for fast identification without
    hashing the entire array.
    """
    parts = [f"{X.shape[0]}x{X.shape[1]}"]
    if X.shape[0] > 0:
        parts.append(X[0, :min(10, X.shape[1])].tobytes().hex()[:32])
    if X.shape[0] > 1:
        parts.append(X[-1, :min(10, X.shape[1])].tobytes().hex()[:32])
    return hashlib.md5(":".join(parts).encode()).hexdigest()


# ============= API Endpoints =============


# Input size limits for security
MAX_SAMPLES = 10000
MAX_FEATURES = 10000
MAX_STEPS = 50


@router.post("/execute", response_model=ExecuteResponse)
async def execute_pipeline(request: ExecuteRequest, http_request: Request):
    """Execute a playground pipeline on spectral data.

    This endpoint processes spectral data through a series of preprocessing
    and/or splitting operators, returning:
    - Original and processed spectra (with optional sampling)
    - Per-wavelength statistics (mean, std, min, max, percentiles)
    - PCA projection for visualization
    - Fold assignments if a splitter is included
    - Execution trace with timing per step

    The endpoint is optimized for real-time preview with:
    - Automatic sampling for large datasets
    - Caching of repeated queries
    - Parallel-friendly execution

    Limits:
    - Max samples: 10,000
    - Max features/wavelengths: 4,000
    - Max pipeline steps: 50

    Args:
        request: ExecuteRequest with data, steps, and options

    Returns:
        ExecuteResponse with processed data and visualization info
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available. Install it in Settings > Dependencies."
        )

    # Validate input - empty data
    if not request.data.x or len(request.data.x) == 0:
        raise HTTPException(status_code=400, detail="Empty data provided")

    if len(request.data.x[0]) == 0:
        raise HTTPException(status_code=400, detail="Spectra have no features")

    # Validate input - size limits for security
    n_samples = len(request.data.x)
    n_features = len(request.data.x[0])

    if n_samples > MAX_SAMPLES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many samples: {n_samples}. Maximum allowed: {MAX_SAMPLES}. "
                   f"Use sampling options to reduce dataset size."
        )

    if n_features > MAX_FEATURES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many features: {n_features}. Maximum allowed: {MAX_FEATURES}. "
                   f"Consider resampling or cropping wavelengths."
        )

    if len(request.steps) > MAX_STEPS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many pipeline steps: {len(request.steps)}. Maximum allowed: {MAX_STEPS}."
        )

    # Check cache
    use_cache = request.options.get("use_cache", True)
    cache_key = None

    if use_cache:
        cache_key = _compute_cache_key(request.data, request.steps, request.options)
        cached = _get_cached(cache_key)
        if cached:
            return _negotiate_response(cached, http_request)

    # Execute pipeline
    executor = PlaygroundExecutor(verbose=0)

    try:
        result = executor.execute(
            data=request.data,
            steps=request.steps,
            sampling=request.sampling,
            options=request.options
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Pipeline execution failed: {str(e)}"
        )

    # Cache result
    if use_cache and cache_key:
        _set_cached(cache_key, result)

    return _negotiate_response(result, http_request)


@router.post("/execute-dataset", response_model=ExecuteResponse)
async def execute_dataset_pipeline(request: ExecuteDatasetRequest, http_request: Request):
    """Execute a playground pipeline on a workspace dataset by reference.

    Instead of receiving the full spectral data matrix from the client,
    this endpoint loads the dataset server-side using its workspace ID.
    This eliminates the data round-trip (Backend → Frontend → Backend)
    that occurs with the regular /execute endpoint.

    The response format is identical to POST /playground/execute.

    Args:
        request: ExecuteDatasetRequest with dataset_id, steps, and options

    Returns:
        ExecuteResponse with processed data and visualization info
    """
    import numpy as np
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available. Install it in Settings > Dependencies."
        )

    if len(request.steps) > MAX_STEPS:
        raise HTTPException(
            status_code=400,
            detail=f"Too many pipeline steps: {len(request.steps)}. Maximum allowed: {MAX_STEPS}."
        )

    # Load dataset server-side
    from .spectra import _load_dataset

    dataset = _load_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset '{request.dataset_id}' not found or could not be loaded"
        )

    # Extract X, y, wavelengths from SpectroDataset as numpy arrays (no .tolist() conversion)
    try:
        X = dataset.x({"partition": "train"}, layout="2d")
        if isinstance(X, list):
            X = X[0]

        y_array = None
        try:
            y_raw = dataset.y({"partition": "train"})
            if y_raw is not None and len(y_raw) > 0:
                y_array = y_raw if y_raw.ndim == 1 else y_raw[:, 0]
        except Exception:
            pass

        try:
            headers = dataset.headers(0)
            if headers is not None and len(headers) > 0:
                if len(headers) == 1 and isinstance(headers[0], (list, tuple, np.ndarray)):
                    headers = list(headers[0])
                wavelengths = [float(h) for h in headers]
            else:
                wavelengths = list(range(X.shape[1]))
        except Exception:
            wavelengths = list(range(X.shape[1]))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to extract data from dataset '{request.dataset_id}': {str(e)}"
        )

    # Validate size limits
    n_samples, n_features = X.shape

    # When sampling is active, the executor will reduce to at most n_samples
    # samples, so validate against the effective (post-sampling) count.
    effective_samples = n_samples
    if request.sampling and request.sampling.method != "all":
        effective_samples = min(request.sampling.n_samples, n_samples)

    if effective_samples > MAX_SAMPLES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many samples: {n_samples}. Maximum allowed: {MAX_SAMPLES}. "
                   f"Use sampling options to reduce dataset size."
        )

    if n_features > MAX_FEATURES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many features: {n_features}. Maximum allowed: {MAX_FEATURES}. "
                   f"Consider resampling or cropping wavelengths."
        )

    # Build a minimal PlaygroundData for cache key and sample_ids access
    # IMPORTANT: We do NOT call X.tolist() — numpy arrays are passed directly
    # to the executor via the X_np fast path.
    data = PlaygroundData(
        x=[],  # Empty — not used, numpy passed directly
        y=None,
        wavelengths=wavelengths,
    )

    # Check cache using a fast fingerprint (not requiring .tolist())
    use_cache = request.options.get("use_cache", True)
    cache_key = None

    if use_cache:
        cache_key = _compute_dataset_cache_key(request.dataset_id, request.steps, request.options)
        cached = _get_cached(cache_key)
        if cached:
            return _negotiate_response(cached, http_request)

    # Execute pipeline — pass numpy arrays directly (no list conversion)
    executor = PlaygroundExecutor(verbose=0)

    try:
        result = executor.execute(
            data=data,
            steps=request.steps,
            sampling=request.sampling,
            options=request.options,
            X_np=X,
            y_np=y_array,
            wavelengths_np=wavelengths,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Pipeline execution failed: {str(e)}"
        )

    # Cache result
    if use_cache and cache_key:
        _set_cached(cache_key, result)

    return _negotiate_response(result, http_request)


# ============= Parallel Chart Endpoints =============


def _get_processed_data_from_cache(request: ChartComputeRequest) -> dict | None:
    """Look up the step cache for already-processed data.

    Attempts to find the full pipeline result in the step cache.
    Returns the cached state dict or None if not found.
    """
    if not request.steps:
        return None

    enabled_steps = [s for s in request.steps if s.enabled]
    if not enabled_steps:
        return None

    # We need the data fingerprint to look up the step cache.
    # For dataset-ref requests, load the dataset to compute the fingerprint.
    if request.dataset_id and NIRS4ALL_AVAILABLE:
        import numpy as np
        from .spectra import _load_dataset

        dataset = _load_dataset(request.dataset_id)
        if not dataset:
            return None

        try:
            X = dataset.x({"partition": "train"}, layout="2d")
            if isinstance(X, list):
                X = X[0]
            if X.dtype != np.float64:
                X = X.astype(np.float64)
        except Exception:
            return None

        # Apply the same sampling that the main execute used so the
        # data fingerprint matches the one stored in the step cache.
        if request.sampling and request.sampling.method != "all":
            try:
                executor = PlaygroundExecutor(verbose=0)
                y_np = None
                try:
                    y_raw = dataset.y({"partition": "train"})
                    if y_raw is not None and len(y_raw) > 0:
                        y_np = y_raw if y_raw.ndim == 1 else y_raw[:, 0]
                except Exception:
                    pass
                sample_indices = executor._apply_sampling(X, y_np, request.sampling)
                X = X[sample_indices]
            except Exception:
                pass

        data_fp = _compute_data_fingerprint(X)
    else:
        return None

    # Look up the full pipeline prefix
    prefix_key = _compute_prefix_key(data_fp, enabled_steps)
    return _step_cache.get(prefix_key)


@router.post("/pca")
async def compute_pca_chart(request: ChartComputeRequest, http_request: Request):
    """Compute PCA projection independently from the main execute response.

    Looks up the step cache for already-processed data. If the pipeline has been
    executed recently (via /execute or /execute-dataset), the processed data is
    retrieved from cache and only PCA is computed, avoiding redundant pipeline
    re-execution.

    Returns only the PCA result dict (not the full ExecuteResponse).
    """
    cached_state = _get_processed_data_from_cache(request)

    if cached_state is not None:
        X_processed = cached_state["X"]
        executor = PlaygroundExecutor()

        # Extract y for coloring (need to load from dataset)
        y_sampled = None
        fold_info = cached_state.get("fold_info")

        if request.dataset_id and NIRS4ALL_AVAILABLE:
            try:
                from .spectra import _load_dataset
                dataset = _load_dataset(request.dataset_id)
                if dataset:
                    y_raw = dataset.y({"partition": "train"})
                    if y_raw is not None and len(y_raw) > 0:
                        y_sampled = y_raw if y_raw.ndim == 1 else y_raw[:, 0]
                        # Apply the same sampling to y so it matches X_processed
                        if len(y_sampled) != X_processed.shape[0] and request.sampling and request.sampling.method != "all":
                            try:
                                X_full = dataset.x({"partition": "train"}, layout="2d")
                                if isinstance(X_full, list):
                                    X_full = X_full[0]
                                sample_indices = executor._apply_sampling(X_full, y_sampled, request.sampling)
                                y_sampled = y_sampled[sample_indices]
                            except Exception:
                                y_sampled = None
                        elif len(y_sampled) != X_processed.shape[0]:
                            y_sampled = None
            except Exception:
                pass

        try:
            pca_result = executor._compute_pca(X_processed, y_sampled, fold_info)
            return _negotiate_response({"success": True, "pca": pca_result}, http_request)
        except Exception as e:
            return {"success": False, "error": str(e)}

    # Fallback: no cached data available
    return {"success": False, "error": "No cached pipeline data available. Execute the pipeline first."}


@router.post("/repetitions")
async def compute_repetitions_chart(request: ChartComputeRequest, http_request: Request):
    """Compute repetition analysis independently from the main execute response.

    Similar to /pca — looks up the step cache for processed data and computes
    only the repetition analysis.

    Returns only the repetitions result dict.
    """
    cached_state = _get_processed_data_from_cache(request)

    if cached_state is not None:
        X_processed = cached_state["X"]
        executor = PlaygroundExecutor()

        # Load additional data needed for repetition analysis
        sample_ids = None
        metadata_sampled = None
        y_sampled = None

        if request.dataset_id and NIRS4ALL_AVAILABLE:
            try:
                from .spectra import _load_dataset
                dataset = _load_dataset(request.dataset_id)
                if dataset:
                    y_raw = dataset.y({"partition": "train"})
                    if y_raw is not None and len(y_raw) > 0:
                        y_sampled = y_raw if y_raw.ndim == 1 else y_raw[:, 0]
                        # Apply the same sampling to y so it matches X_processed
                        if len(y_sampled) != X_processed.shape[0] and request.sampling and request.sampling.method != "all":
                            try:
                                X_full = dataset.x({"partition": "train"}, layout="2d")
                                if isinstance(X_full, list):
                                    X_full = X_full[0]
                                sample_indices = executor._apply_sampling(X_full, y_sampled, request.sampling)
                                y_sampled = y_sampled[sample_indices]
                            except Exception:
                                y_sampled = None
                        elif len(y_sampled) != X_processed.shape[0]:
                            y_sampled = None
            except Exception:
                pass

        try:
            repetitions_result = executor._compute_repetition_analysis(
                X=X_processed,
                sample_ids=sample_ids,
                metadata=metadata_sampled,
                pca_result=None,
                umap_result=None,
                y=y_sampled,
                options=request.options,
            )
            return _negotiate_response({"success": True, "repetitions": repetitions_result}, http_request)
        except Exception as e:
            return {"success": False, "error": str(e)}

    return {"success": False, "error": "No cached pipeline data available. Execute the pipeline first."}


@router.get("/operators")
async def list_operators():
    """List all available operators for the playground.

    Returns preprocessing, augmentation, splitting, and filter operators with their
    metadata, parameters, and categories.
    """
    if not NIRS4ALL_AVAILABLE:
        return {
            "preprocessing": [],
            "augmentation": [],
            "splitting": [],
            "filter": [],
            "total": 0
        }

    preprocessing = get_preprocessing_methods()
    augmentation = get_augmentation_methods()
    splitting = get_splitter_methods()
    filters = get_filter_methods()

    # Group by category
    preprocessing_by_category = {}
    for method in preprocessing:
        cat = method.get("category", "other")
        if cat not in preprocessing_by_category:
            preprocessing_by_category[cat] = []
        preprocessing_by_category[cat].append(method)

    augmentation_by_category = {}
    for method in augmentation:
        cat = method.get("category", "other")
        if cat not in augmentation_by_category:
            augmentation_by_category[cat] = []
        augmentation_by_category[cat].append(method)

    splitting_by_category = {}
    for method in splitting:
        cat = method.get("category", "other")
        if cat not in splitting_by_category:
            splitting_by_category[cat] = []
        splitting_by_category[cat].append(method)

    filter_by_category = {}
    for method in filters:
        cat = method.get("category", "other")
        if cat not in filter_by_category:
            filter_by_category[cat] = []
        filter_by_category[cat].append(method)

    return {
        "preprocessing": preprocessing,
        "preprocessing_by_category": preprocessing_by_category,
        "augmentation": augmentation,
        "augmentation_by_category": augmentation_by_category,
        "splitting": splitting,
        "splitting_by_category": splitting_by_category,
        "filter": filters,
        "filter_by_category": filter_by_category,
        "total": len(preprocessing) + len(augmentation) + len(splitting) + len(filters)
    }


@router.post("/validate")
async def validate_pipeline(steps: list[PlaygroundStep]):
    """Validate a playground pipeline configuration.

    Checks that all operators exist and parameters are valid.
    Returns validation results with errors and warnings per step.
    """
    results = {
        "valid": True,
        "steps": [],
        "errors": [],
        "warnings": [],
    }

    for step in steps:
        operator_type = "splitting" if step.type == "splitting" else "preprocessing"
        is_valid, errors, warnings = validate_step_params(
            step.name, step.params, operator_type
        )

        step_result = {
            "step_id": step.id,
            "name": step.name,
            "valid": is_valid,
            "errors": errors,
            "warnings": warnings,
        }

        results["steps"].append(step_result)

        if not is_valid:
            results["valid"] = False
            results["errors"].extend([f"Step {step.id}: {e}" for e in errors])

        results["warnings"].extend([f"Step {step.id}: {w}" for w in warnings])

    return results


@router.get("/presets")
async def get_presets():
    """Get common preprocessing and splitting presets.

    Returns predefined pipeline configurations for common use cases.
    """
    presets = [
        {
            "id": "snv_basic",
            "name": "SNV Basic",
            "description": "Standard Normal Variate for scatter correction",
            "category": "preprocessing",
            "steps": [
                {"type": "preprocessing", "name": "StandardNormalVariate", "params": {}}
            ]
        },
        {
            "id": "snv_savgol",
            "name": "SNV + Savitzky-Golay",
            "description": "Scatter correction with smoothing",
            "category": "preprocessing",
            "steps": [
                {"type": "preprocessing", "name": "StandardNormalVariate", "params": {}},
                {"type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 11, "polyorder": 2}}
            ]
        },
        {
            "id": "derivative_first",
            "name": "First Derivative",
            "description": "First derivative using Savitzky-Golay",
            "category": "preprocessing",
            "steps": [
                {"type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 11, "polyorder": 2, "deriv": 1}}
            ]
        },
        {
            "id": "kfold_5",
            "name": "5-Fold CV",
            "description": "Standard 5-fold cross-validation",
            "category": "splitting",
            "steps": [
                {"type": "splitting", "name": "KFold", "params": {"n_splits": 5, "shuffle": True, "random_state": 42}}
            ]
        },
        {
            "id": "stratified_kfold_5",
            "name": "Stratified 5-Fold CV",
            "description": "5-fold CV with stratification by target",
            "category": "splitting",
            "steps": [
                {"type": "splitting", "name": "StratifiedKFold", "params": {"n_splits": 5, "shuffle": True, "random_state": 42}}
            ]
        },
        {
            "id": "train_test_80_20",
            "name": "80/20 Train-Test Split",
            "description": "Simple train-test split",
            "category": "splitting",
            "steps": [
                {"type": "splitting", "name": "ShuffleSplit", "params": {"n_splits": 1, "test_size": 0.2, "random_state": 42}}
            ]
        },
        {
            "id": "full_pipeline",
            "name": "Full NIRS Pipeline",
            "description": "Complete preprocessing with MSC, derivative, scaling, and 5-fold CV",
            "category": "combined",
            "steps": [
                {"type": "preprocessing", "name": "MultiplicativeScatterCorrection", "params": {}},
                {"type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 11, "polyorder": 2, "deriv": 1}},
                {"type": "preprocessing", "name": "StandardScaler", "params": {}},
                {"type": "splitting", "name": "KFold", "params": {"n_splits": 5, "shuffle": True, "random_state": 42}}
            ]
        },
    ]

    return {"presets": presets, "total": len(presets)}


@router.get("/capabilities")
async def get_capabilities():
    """Get available playground capabilities.

    Returns information about optional features like UMAP availability,
    which depend on optional dependencies being installed in the managed venv.
    """
    umap_available = UMAP_AVAILABLE
    nirs4all_available = NIRS4ALL_AVAILABLE

    return {
        "umap_available": umap_available,
        "nirs4all_available": nirs4all_available,
        "features": {
            "pca": True,
            "umap": umap_available,
            "filters": True,
            "preprocessing": nirs4all_available,
            "splitting": nirs4all_available,
            "augmentation": nirs4all_available,
            "metrics": True,  # Phase 5: Spectral metrics
        }
    }


@router.get("/metrics")
async def get_metrics_info():
    """Get information about available spectral metrics.

    Phase 5 Implementation: Returns all available metrics organized by category,
    with descriptions and requirements (e.g., which metrics require PCA).
    """
    categories = get_available_metrics()

    # Flatten for quick lookup
    all_metrics = []
    for category, metrics in categories.items():
        for metric in metrics:
            metric["category"] = category
            all_metrics.append(metric)

    return {
        "categories": categories,
        "all_metrics": all_metrics,
        "fast_metrics": FAST_METRICS,
        "chemometric_metrics": CHEMOMETRIC_METRICS,
        "total": len(all_metrics),
    }


class MetricsRequest(BaseModel):
    """Request model for computing specific metrics."""

    data: PlaygroundData = Field(..., description="Spectral data")
    metrics: list[str] = Field(..., description="List of metric names to compute")
    pca_result: dict[str, Any] | None = Field(None, description="Pre-computed PCA result")


class OutlierRequest(BaseModel):
    """Request model for outlier detection."""

    data: PlaygroundData = Field(..., description="Spectral data")
    method: str = Field("hotelling_t2", description="Detection method: 'hotelling_t2', 'q_residual', 'lof', 'distance'")
    threshold: float = Field(0.95, ge=0, le=1, description="Threshold for outlier detection (0-1)")
    pca_result: dict[str, Any] | None = Field(None, description="Pre-computed PCA result")


class SimilarityRequest(BaseModel):
    """Request model for finding similar samples."""

    data: PlaygroundData = Field(..., description="Spectral data")
    reference_idx: int = Field(..., description="Index of reference sample")
    metric: str = Field("euclidean", description="Distance metric: 'euclidean', 'cosine', 'correlation'")
    threshold: float | None = Field(None, description="Distance threshold")
    top_k: int | None = Field(None, description="Return top K similar samples")


@router.post("/metrics/compute")
async def compute_metrics(request: MetricsRequest):
    """Compute specific spectral metrics on-demand.

    Phase 5 Implementation: Allows computing any subset of metrics
    without re-running the full pipeline.
    """
    import numpy as np
    # Convert data to numpy
    X = np.array(request.data.x, dtype=np.float64)
    wavelengths = np.array(request.data.wavelengths) if request.data.wavelengths else None

    n_samples = X.shape[0]

    # Create metrics computer
    computer = MetricsComputer(
        n_pca_components=min(5, n_samples - 1, X.shape[1]),
        lof_n_neighbors=min(20, n_samples - 1),
    )

    # Compute requested metrics
    try:
        computed = computer.compute(
            X=X,
            metrics=request.metrics,
            pca_result=request.pca_result,
            wavelengths=wavelengths,
        )

        # Convert to JSON-serializable format
        metrics_values = {k: v.tolist() for k, v in computed.items()}
        metrics_stats = {k: computer.get_metric_stats(v) for k, v in computed.items()}

        return {
            "success": True,
            "values": metrics_values,
            "statistics": metrics_stats,
            "n_samples": n_samples,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/metrics/outliers")
async def detect_outliers(request: OutlierRequest):
    """Detect outliers in spectral data.

    Phase 5 Implementation: Returns a mask indicating which samples
    are outliers based on the selected detection method.
    """
    import numpy as np
    # Convert data to numpy
    X = np.array(request.data.x, dtype=np.float64)
    n_samples = X.shape[0]

    # Create metrics computer
    computer = MetricsComputer(
        n_pca_components=min(5, n_samples - 1, X.shape[1]),
        lof_n_neighbors=min(20, n_samples - 1),
    )

    try:
        mask, info = computer.get_outlier_mask(
            X=X,
            method=request.method,
            threshold=request.threshold,
            pca_result=request.pca_result,
        )

        return {
            "success": True,
            "inlier_mask": mask.tolist(),
            "outlier_indices": np.where(~mask)[0].tolist(),
            "n_outliers": int(np.sum(~mask)),
            "n_inliers": int(np.sum(mask)),
            **info,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/metrics/similar")
async def find_similar_samples(request: SimilarityRequest):
    """Find samples similar to a reference sample.

    Phase 5 Implementation: Returns indices and distances of samples
    similar to the reference based on the specified metric.
    """
    import numpy as np
    # Convert data to numpy
    X = np.array(request.data.x, dtype=np.float64)
    n_samples = X.shape[0]

    if request.reference_idx < 0 or request.reference_idx >= n_samples:
        raise HTTPException(status_code=400, detail=f"Invalid reference_idx: {request.reference_idx}")

    # Create metrics computer
    computer = MetricsComputer()

    try:
        indices, distances = computer.get_similar_samples(
            X=X,
            reference_idx=request.reference_idx,
            metric=request.metric,
            threshold=request.threshold,
            top_k=request.top_k,
        )

        return {
            "success": True,
            "reference_idx": request.reference_idx,
            "metric": request.metric,
            "similar_indices": indices.tolist(),
            "distances": distances.tolist(),
            "n_similar": len(indices),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============= Difference Computation Endpoints =============


class DiffComputeRequest(BaseModel):
    """Request model for computing differences between reference and final datasets."""

    X_ref: list[list[float]] = Field(..., description="Reference spectra (n_samples x n_features)")
    X_final: list[list[float]] = Field(..., description="Final spectra (n_samples x n_features)")
    metric: str = Field(
        "euclidean",
        description="Distance metric: 'euclidean', 'manhattan', 'cosine', 'spectral_angle', 'correlation', 'mahalanobis', 'pca_distance'",
    )
    scale: str = Field("linear", description="Scale type: 'linear' or 'log'")


class RepetitionVarianceRequest(BaseModel):
    """Request model for computing variance within repetition groups."""

    X: list[list[float]] = Field(..., description="Spectral data (n_samples x n_features)")
    group_ids: list[str] = Field(..., description="Group identifiers for each sample")
    reference: str = Field(
        "group_mean",
        description="Reference type: 'group_mean', 'leave_one_out', 'first'",
    )
    metric: str = Field("euclidean", description="Distance metric to use")


@router.post("/diff/compute")
async def compute_diff(request: DiffComputeRequest):
    """Compute per-sample differences between reference and final spectra.

    Phase 7 Implementation: Computes distance metrics between paired samples
    from reference and final datasets for difference visualization.
    """
    import numpy as np
    try:
        X_ref = np.array(request.X_ref, dtype=np.float64)
        X_final = np.array(request.X_final, dtype=np.float64)

        if X_ref.shape != X_final.shape:
            raise HTTPException(
                status_code=400,
                detail=f"Shape mismatch: X_ref {X_ref.shape} != X_final {X_final.shape}",
            )

        computer = MetricsComputer()
        distances = computer.compute_pairwise_distances(X_ref, X_final, request.metric)

        if request.scale == "log":
            distances = np.log1p(distances)

        quantiles = np.percentile(distances, [50, 75, 90, 95])

        return {
            "success": True,
            "metric": request.metric,
            "scale": request.scale,
            "distances": distances.tolist(),
            "statistics": {
                "mean": float(np.mean(distances)),
                "std": float(np.std(distances)),
                "min": float(np.min(distances)),
                "max": float(np.max(distances)),
                "quantiles": {
                    "50": float(quantiles[0]),
                    "75": float(quantiles[1]),
                    "90": float(quantiles[2]),
                    "95": float(quantiles[3]),
                },
            },
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/diff/repetition-variance")
async def compute_repetition_variance(request: RepetitionVarianceRequest):
    """Compute variance within repetition groups.

    Phase 7 Implementation: Analyzes the variance of spectra within groups
    (e.g., repetitions of the same biological sample) to identify inconsistent
    measurements or problematic samples.
    """
    import numpy as np
    try:
        X = np.array(request.X, dtype=np.float64)
        group_ids = np.array(request.group_ids)

        if len(group_ids) != X.shape[0]:
            raise HTTPException(
                status_code=400,
                detail=f"group_ids length ({len(group_ids)}) != number of samples ({X.shape[0]})",
            )

        computer = MetricsComputer()
        result = computer.compute_repetition_variance(
            X=X,
            group_ids=group_ids,
            reference=request.reference,
            metric=request.metric,
        )

        return {
            "success": True,
            "reference": request.reference,
            "metric": request.metric,
            "distances": result["distances"].tolist(),
            "sample_indices": result["sample_indices"],
            "group_ids": result["group_ids"],
            "quantiles": result["quantiles"],
            "per_group": result["per_group"],
            "n_groups": len(result["per_group"]),
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
