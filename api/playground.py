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

import hashlib
import json
import sys
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sklearn.decomposition import PCA

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    from nirs4all.data.dataset import SpectroDataset

    NIRS4ALL_AVAILABLE = True
except ImportError as e:
    print(f"Note: nirs4all not available for playground API: {e}")
    NIRS4ALL_AVAILABLE = False

from .shared.pipeline_service import (
    convert_frontend_step,
    get_preprocessing_methods,
    get_splitter_methods,
    get_augmentation_methods,
    instantiate_operator,
    validate_step_params,
)

router = APIRouter(prefix="/playground", tags=["playground"])


# ============= Pydantic Models =============


class PlaygroundStep(BaseModel):
    """A single pipeline step in the playground."""

    id: str = Field(..., description="Unique step identifier")
    type: str = Field(..., description="Step type: 'preprocessing' or 'splitting'")
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
    folds: Optional[Dict[str, Any]] = Field(None, description="Fold information if splitter present")
    execution_trace: List[StepTrace] = Field(default_factory=list, description="Per-step execution info")
    step_errors: List[Dict[str, Any]] = Field(default_factory=list, description="Any step-level errors")


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

        # Apply sampling if needed
        sample_indices = self._apply_sampling(X_original, y, sampling)
        X_sampled = X_original[sample_indices]
        y_sampled = y[sample_indices] if y is not None else None

        # Execute pipeline steps
        X_processed = X_sampled.copy()
        execution_trace: List[StepTrace] = []
        step_errors: List[Dict[str, Any]] = []
        fold_info = None
        splitter_applied = False

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
                else:
                    # Handle preprocessing
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
            folds=fold_info,
            execution_trace=execution_trace,
            step_errors=step_errors
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

        Args:
            X: Processed data
            y: Target values for coloring
            fold_info: Fold assignments for coloring

        Returns:
            PCA result dict
        """
        n_components = min(3, X.shape[0], X.shape[1])
        pca = PCA(n_components=n_components)

        try:
            X_pca = pca.fit_transform(X)
        except Exception as e:
            return {"error": str(e)}

        result = {
            "coordinates": X_pca.tolist(),
            "explained_variance_ratio": pca.explained_variance_ratio_.tolist(),
            "explained_variance": pca.explained_variance_.tolist(),
            "n_components": n_components,
        }

        # Add target values for coloring
        if y is not None:
            result["y"] = y.tolist()

        # Add fold labels for coloring
        if fold_info is not None:
            result["fold_labels"] = fold_info.get("fold_labels")

        return result


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


@router.post("/execute", response_model=ExecuteResponse)
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
            detail="nirs4all library not available for playground execution"
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

    Returns preprocessing, augmentation, and splitting operators with their
    metadata, parameters, and categories.
    """
    if not NIRS4ALL_AVAILABLE:
        return {
            "preprocessing": [],
            "augmentation": [],
            "splitting": [],
            "total": 0
        }

    preprocessing = get_preprocessing_methods()
    augmentation = get_augmentation_methods()
    splitting = get_splitter_methods()

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

    return {
        "preprocessing": preprocessing,
        "preprocessing_by_category": preprocessing_by_category,
        "augmentation": augmentation,
        "augmentation_by_category": augmentation_by_category,
        "splitting": splitting,
        "splitting_by_category": splitting_by_category,
        "total": len(preprocessing) + len(augmentation) + len(splitting)
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
