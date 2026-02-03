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

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel, Field
from sklearn.decomposition import PCA

# Check availability via direct imports
try:
    import umap
    UMAP_AVAILABLE = True
except ImportError:
    UMAP_AVAILABLE = False

try:
    import nirs4all
    NIRS4ALL_AVAILABLE = True
except ImportError:
    NIRS4ALL_AVAILABLE = False

from .shared.pipeline_service import (
    convert_frontend_step,
    get_preprocessing_methods,
    get_splitter_methods,
    get_augmentation_methods,
    instantiate_operator,
    validate_step_params,
)
from .shared.filter_operators import (
    get_filter_methods,
    instantiate_filter,
)
from .shared.metrics_computer import (
    MetricsComputer,
    get_available_metrics,
    FAST_METRICS,
    ALL_METRICS,
    CHEMOMETRIC_METRICS,
)

router = APIRouter(prefix="/playground", tags=["playground"])


# ============= Pydantic Models =============


class PlaygroundStep(BaseModel):
    """A single pipeline step in the playground."""

    id: str = Field(..., description="Unique step identifier")
    type: str = Field(..., description="Step type: 'preprocessing', 'augmentation', 'splitting', or 'filter'")
    name: str = Field(..., description="Operator class name (e.g., 'StandardNormalVariate')")
    params: Dict[str, Any] = Field(default_factory=dict, description="Operator parameters")
    enabled: bool = Field(default=True, description="Whether the step is enabled")


class PlaygroundData(BaseModel):
    """Input data for playground execution."""

    x: List[List[float]] = Field(..., description="2D spectral data (samples x features)")
    y: Optional[List[float]] = Field(None, description="Target values (optional)")
    wavelengths: Optional[List[float]] = Field(None, description="Wavelength headers")
    sample_ids: Optional[List[str]] = Field(None, description="Sample identifiers")
    metadata: Optional[Dict[str, List[Any]]] = Field(None, description="Additional metadata columns")


class SamplingOptions(BaseModel):
    """Options for data sampling."""

    method: str = Field("random", description="Sampling method: 'random', 'stratified', 'kmeans', 'all'")
    n_samples: int = Field(100, ge=1, le=1000, description="Number of samples to select")
    seed: int = Field(42, ge=0, description="Random seed for reproducibility")


class ExecuteRequest(BaseModel):
    """Request model for executing playground pipeline."""

    data: PlaygroundData = Field(..., description="Spectral data to process")
    steps: List[PlaygroundStep] = Field(default_factory=list, description="Pipeline steps to execute")
    sampling: Optional[SamplingOptions] = Field(None, description="Sampling options for large datasets")
    options: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional options: compute_pca, compute_statistics, max_wavelengths_returned, split_index"
    )


class StepTrace(BaseModel):
    """Execution trace for a single step."""

    step_id: str
    name: str
    duration_ms: float
    success: bool
    error: Optional[str] = None
    output_shape: Optional[List[int]] = None


class SpectrumStats(BaseModel):
    """Statistics for a spectrum or set of spectra."""

    mean: List[float]
    std: List[float]
    min: List[float]
    max: List[float]
    p5: List[float]
    p95: List[float]
    global_stats: Dict[str, float]


class FoldInfo(BaseModel):
    """Information about a single fold."""

    train_count: int
    test_count: int
    train_indices: List[int]
    test_indices: List[int]
    y_train_stats: Optional[Dict[str, float]] = None
    y_test_stats: Optional[Dict[str, float]] = None


class ExecuteResponse(BaseModel):
    """Response model for playground execution."""

    success: bool
    execution_time_ms: float
    original: Dict[str, Any] = Field(
        default_factory=dict,
        description="Original data: spectra subset, statistics, sample_indices"
    )
    processed: Dict[str, Any] = Field(
        default_factory=dict,
        description="Processed data: spectra subset, statistics"
    )
    pca: Optional[Dict[str, Any]] = Field(None, description="PCA projection if computed")
    umap: Optional[Dict[str, Any]] = Field(None, description="UMAP projection if computed")
    folds: Optional[Dict[str, Any]] = Field(None, description="Fold information if splitter present")
    filter_info: Optional[Dict[str, Any]] = Field(None, description="Filter results if filters applied")
    repetitions: Optional[Dict[str, Any]] = Field(None, description="Repetition analysis if detected or configured")
    metrics: Optional[Dict[str, Any]] = Field(None, description="Spectral metrics if computed (Phase 5)")
    execution_trace: List[StepTrace] = Field(default_factory=list, description="Per-step execution info")
    step_errors: List[Dict[str, Any]] = Field(default_factory=list, description="Any step-level errors")
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
        steps: List[PlaygroundStep],
        sampling: Optional[SamplingOptions] = None,
        options: Optional[Dict[str, Any]] = None
    ) -> ExecuteResponse:
        """Execute pipeline on data.

        Args:
            data: Input spectral data
            steps: Pipeline steps to execute
            sampling: Sampling options for large datasets
            options: Additional execution options

        Returns:
            ExecuteResponse with results and traces
        """
        start_time = time.perf_counter()
        options = options or {}

        # Convert input to numpy arrays
        X_original = np.array(data.x, dtype=np.float64)
        y = np.array(data.y, dtype=np.float64) if data.y else None
        wavelengths = data.wavelengths or list(range(X_original.shape[1]))

        # Convert metadata to numpy arrays if provided
        metadata = None
        if data.metadata:
            metadata = {k: np.array(v) for k, v in data.metadata.items()}

        # Apply sampling if needed
        sample_indices = self._apply_sampling(X_original, y, sampling)
        X_sampled = X_original[sample_indices]
        y_sampled = y[sample_indices] if y is not None else None
        metadata_sampled = None
        if metadata:
            metadata_sampled = {k: v[sample_indices] for k, v in metadata.items()}

        # Check if we have any enabled operators (raw data mode check)
        enabled_steps = [s for s in steps if s.enabled]
        is_raw_data = len(enabled_steps) == 0

        # Execute pipeline steps
        X_processed = X_sampled.copy()
        execution_trace: List[StepTrace] = []
        step_errors: List[Dict[str, Any]] = []
        fold_info = None
        filter_info = None
        splitter_applied = False
        total_filtered = 0
        filter_mask = np.ones(X_sampled.shape[0], dtype=bool)

        for step in steps:
            if not step.enabled:
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

        # Downsample wavelengths if requested
        max_wavelengths = options.get("max_wavelengths_returned")
        wavelengths_out = wavelengths
        X_sampled_out = X_sampled
        X_processed_out = X_processed

        if max_wavelengths and len(wavelengths) > max_wavelengths:
            indices = np.linspace(0, len(wavelengths) - 1, max_wavelengths, dtype=int)
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
            execution_trace=execution_trace,
            step_errors=step_errors,
            is_raw_data=is_raw_data
        )

        return response

    def _apply_sampling(
        self,
        X: np.ndarray,
        y: Optional[np.ndarray],
        sampling: Optional[SamplingOptions]
    ) -> np.ndarray:
        """Apply sampling to select subset of samples.

        Args:
            X: Full data array
            y: Target values (for stratified sampling)
            sampling: Sampling configuration

        Returns:
            Array of selected sample indices
        """
        n_samples = X.shape[0]

        if sampling is None or sampling.method == "all":
            return np.arange(n_samples)

        n_select = min(sampling.n_samples, n_samples)
        rng = np.random.RandomState(sampling.seed)

        if sampling.method == "random":
            return rng.choice(n_samples, size=n_select, replace=False)

        elif sampling.method == "stratified" and y is not None:
            # Stratified sampling based on y quantiles
            from sklearn.model_selection import StratifiedShuffleSplit

            # Bin y into groups for stratification
            # Ensure at least 2 samples per bin for StratifiedShuffleSplit
            n_unique = len(np.unique(y))
            max_bins = min(5, n_unique, n_select // 2)

            # Need at least 2 bins for stratification to make sense
            if max_bins < 2:
                # Fall back to random sampling
                return rng.choice(n_samples, size=n_select, replace=False)

            y_binned = np.digitize(y, np.percentile(y, np.linspace(0, 100, max_bins + 1)[1:-1]))

            # Check that each bin has at least 2 samples
            bin_counts = np.bincount(y_binned)
            if np.any(bin_counts < 2):
                # Fall back to random sampling if stratification isn't possible
                return rng.choice(n_samples, size=n_select, replace=False)

            try:
                sss = StratifiedShuffleSplit(
                    n_splits=1,
                    test_size=n_select / n_samples,
                    random_state=sampling.seed
                )
                _, indices = next(sss.split(X, y_binned))
                return indices
            except ValueError:
                # Fall back to random if stratification fails
                return rng.choice(n_samples, size=n_select, replace=False)

        elif sampling.method == "kmeans":
            # K-means based sampling for representative selection
            from sklearn.cluster import MiniBatchKMeans

            # Use exactly the number of clusters we want
            n_clusters = n_select
            kmeans = MiniBatchKMeans(
                n_clusters=n_clusters,
                random_state=sampling.seed,
                n_init=3
            )
            kmeans.fit(X)

            # Select sample closest to each cluster center (avoiding duplicates)
            selected = []
            used_indices = set()

            for center in kmeans.cluster_centers_:
                distances = np.linalg.norm(X - center, axis=1)
                # Sort by distance and find closest not yet selected
                sorted_indices = np.argsort(distances)
                for idx in sorted_indices:
                    if idx not in used_indices:
                        selected.append(idx)
                        used_indices.add(idx)
                        break

            return np.array(selected[:n_select])

        else:
            return rng.choice(n_samples, size=n_select, replace=False)

    def _execute_preprocessing(
        self,
        step: PlaygroundStep,
        X: np.ndarray
    ) -> np.ndarray:
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
        X: np.ndarray,
        y: Optional[np.ndarray],
        metadata: Optional[Dict[str, np.ndarray]]
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """Execute a filter step.

        Args:
            step: Step configuration
            X: Input data
            y: Target values
            metadata: Sample metadata

        Returns:
            Tuple of (boolean mask, filter result info)
        """
        filter_op = instantiate_filter(step.name, step.params)
        if filter_op is None:
            raise ValueError(f"Unknown filter operator: {step.name}")

        mask = filter_op.fit_predict(X, y, metadata)
        reason = filter_op.get_removal_reason()

        return mask, {"reason": reason, "kept": int(np.sum(mask)), "removed": int(np.sum(~mask))}

    def _execute_splitter(
        self,
        step: PlaygroundStep,
        X: np.ndarray,
        y: Optional[np.ndarray],
        options: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute a splitter step.

        Args:
            step: Step configuration
            X: Input data
            y: Target values (may be required by some splitters)
            options: Execution options (split_index for ShuffleSplit-like)

        Returns:
            Fold information dict
        """
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

    def _compute_statistics(self, X: np.ndarray) -> Dict[str, Any]:
        """Compute per-wavelength statistics.

        Args:
            X: Data array (samples x features)

        Returns:
            Statistics dict
        """
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
        X: np.ndarray,
        y: Optional[np.ndarray],
        fold_info: Optional[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Compute PCA projection for visualization.

        Computes enough components to explain 99.9% variance (up to 10 max).

        Args:
            X: Processed data
            y: Target values for coloring
            fold_info: Fold assignments for coloring

        Returns:
            PCA result dict
        """
        # First, compute with enough components to reach 99.9% variance
        # Use min(10, n_samples, n_features) as upper limit for efficiency
        max_components = min(10, X.shape[0], X.shape[1])
        pca = PCA(n_components=max_components)

        try:
            X_pca = pca.fit_transform(X)
        except Exception as e:
            return {"error": str(e)}

        # Determine how many components are needed for 99.9% variance
        cumulative_variance = np.cumsum(pca.explained_variance_ratio_)
        n_components_999 = np.searchsorted(cumulative_variance, 0.999) + 1
        n_components_used = min(max(n_components_999, 3), max_components)  # At least 3, at most max_components

        result = {
            "coordinates": X_pca.tolist(),  # Return all computed components
            "explained_variance_ratio": pca.explained_variance_ratio_.tolist(),
            "explained_variance": pca.explained_variance_.tolist(),
            "n_components": max_components,  # Actual number of components computed
            "n_components_999": int(n_components_used),  # Components needed for 99.9% variance
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
        X: np.ndarray,
        y: Optional[np.ndarray],
        fold_info: Optional[Dict[str, Any]],
        n_neighbors: int = 15,
        min_dist: float = 0.1,
        n_components: int = 2
    ) -> Dict[str, Any]:
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
            reducer = umap.UMAP(
                n_components=n_components,
                n_neighbors=n_neighbors,
                min_dist=min_dist,
                random_state=42,
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
        X: np.ndarray,
        sample_ids: Optional[List[str]],
        metadata: Optional[Dict[str, np.ndarray]],
        pca_result: Optional[Dict[str, Any]],
        umap_result: Optional[Dict[str, Any]],
        y: Optional[np.ndarray],
        options: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
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
        bio_sample_map: Dict[str, List[int]] = defaultdict(list)

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
                    groups: Dict[str, List[int]] = defaultdict(list)

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
            "bio_sample_groups": {
                bio_id: indices
                for bio_id, indices in list(bio_samples_with_reps.items())[:50]  # Limit to 50 for response size
            },
        }

    def _compute_metrics(
        self,
        X: np.ndarray,
        pca_result: Optional[Dict[str, Any]] = None,
        wavelengths: Optional[np.ndarray] = None,
        requested_metrics: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
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
_cache: Dict[str, Tuple[float, ExecuteResponse]] = {}
_cache_ttl_seconds = 300  # 5 minutes
_cache_max_entries = 100


def _compute_cache_key(data: PlaygroundData, steps: List[PlaygroundStep], options: Dict[str, Any]) -> str:
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


def _get_cached(cache_key: str) -> Optional[ExecuteResponse]:
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


# ============= API Endpoints =============


# Input size limits for security
MAX_SAMPLES = 10000
MAX_FEATURES = 4000
MAX_STEPS = 50


@router.post("/execute", response_model=ExecuteResponse, response_class=ORJSONResponse)
async def execute_pipeline(request: ExecuteRequest):
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
            return cached

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

    return result


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
async def validate_pipeline(steps: List[PlaygroundStep]):
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
    metrics: List[str] = Field(..., description="List of metric names to compute")
    pca_result: Optional[Dict[str, Any]] = Field(None, description="Pre-computed PCA result")


class OutlierRequest(BaseModel):
    """Request model for outlier detection."""

    data: PlaygroundData = Field(..., description="Spectral data")
    method: str = Field("hotelling_t2", description="Detection method: 'hotelling_t2', 'q_residual', 'lof', 'distance'")
    threshold: float = Field(0.95, ge=0, le=1, description="Threshold for outlier detection (0-1)")
    pca_result: Optional[Dict[str, Any]] = Field(None, description="Pre-computed PCA result")


class SimilarityRequest(BaseModel):
    """Request model for finding similar samples."""

    data: PlaygroundData = Field(..., description="Spectral data")
    reference_idx: int = Field(..., description="Index of reference sample")
    metric: str = Field("euclidean", description="Distance metric: 'euclidean', 'cosine', 'correlation'")
    threshold: Optional[float] = Field(None, description="Distance threshold")
    top_k: Optional[int] = Field(None, description="Return top K similar samples")


@router.post("/metrics/compute")
async def compute_metrics(request: MetricsRequest):
    """Compute specific spectral metrics on-demand.

    Phase 5 Implementation: Allows computing any subset of metrics
    without re-running the full pipeline.
    """
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

    X_ref: List[List[float]] = Field(..., description="Reference spectra (n_samples x n_features)")
    X_final: List[List[float]] = Field(..., description="Final spectra (n_samples x n_features)")
    metric: str = Field(
        "euclidean",
        description="Distance metric: 'euclidean', 'manhattan', 'cosine', 'spectral_angle', 'correlation', 'mahalanobis', 'pca_distance'",
    )
    scale: str = Field("linear", description="Scale type: 'linear' or 'log'")


class RepetitionVarianceRequest(BaseModel):
    """Request model for computing variance within repetition groups."""

    X: List[List[float]] = Field(..., description="Spectral data (n_samples x n_features)")
    group_ids: List[str] = Field(..., description="Group identifiers for each sample")
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