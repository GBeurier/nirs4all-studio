"""FastAPI routes for the playground API.

Real-time spectral data exploration: execute preprocessing/splitting
pipelines, compare before/after, visualize folds, and export pipelines.

The CPU-bound executor work for the two hot interactive endpoints
(`/execute`, `/execute-dataset`) is offloaded to a worker thread via
``asyncio.to_thread`` so it never blocks the asyncio event loop (which also
serves WebSocket progress streams and the Electron readiness probe).
"""

from __future__ import annotations

import asyncio
import importlib.util
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from ..shared.filter_operators import get_filter_methods
from ..shared.metrics_computer import MetricsComputer
from ..shared.pipeline_service import (
    get_augmentation_methods,
    get_preprocessing_methods,
    get_splitter_methods,
    validate_step_params,
)
from .cache import (
    _step_cache,
    compute_cache_key,
    compute_data_fingerprint,
    compute_dataset_cache_key,
    compute_prefix_key,
    get_cached_response,
    set_cached_response,
)
from .executor import PlaygroundExecutor
from .models import (
    ChartComputeRequest,
    DiffComputeRequest,
    ExecuteDatasetRequest,
    ExecuteRequest,
    ExecuteResponse,
    PlaygroundData,
    PlaygroundStep,
    RepetitionVarianceRequest,
)
from .serialization import negotiate_response

UMAP_AVAILABLE = importlib.util.find_spec("umap") is not None

NIRS4ALL_AVAILABLE = True

router = APIRouter(prefix="/playground", tags=["playground"])


# ============= API Endpoints =============


# Input size limits for security
MAX_SAMPLES = 10000
MAX_FEATURES = 10000
MAX_STEPS = 50


def _resolve_source_index(source_index: int | None, source: int | None) -> int:
    return source_index if source_index is not None else (source if source is not None else 0)


def _resolve_target_index(target_index: int | None) -> int:
    return target_index if target_index is not None else 0


def _has_explicit_source(source_index: int | None, source: int | None) -> bool:
    return source_index is not None or source is not None


def _select_source_array(X_raw: Any, source_index: int) -> Any:
    if isinstance(X_raw, list):
        if source_index >= len(X_raw):
            return None
        return X_raw[source_index]
    return X_raw


def _select_target_array(y_raw: Any, target_index: int) -> Any:
    if y_raw is None or len(y_raw) == 0:
        return None
    if getattr(y_raw, "ndim", 1) == 1:
        return y_raw
    if target_index >= y_raw.shape[1]:
        return None
    return y_raw[:, target_index]


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
        cache_key = compute_cache_key(request.data, request.steps, request.options)
        cached = get_cached_response(cache_key)
        if cached:
            return negotiate_response(cached, http_request)

    # Execute pipeline
    executor = PlaygroundExecutor(verbose=0)

    try:
        # The executor is CPU-bound (sklearn fit_transform, PCA, optional
        # TSNE/UMAP on up to 10k x 4k matrices). Run it off the event loop so
        # concurrent requests, WebSocket progress streams and the health probe
        # are not blocked for the full execution duration.
        result = await asyncio.to_thread(
            executor.execute,
            request.data,
            request.steps,
            request.sampling,
            request.options,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Pipeline execution failed: {str(e)}"
        )

    # Cache result
    if use_cache and cache_key:
        set_cached_response(cache_key, result)

    return negotiate_response(result, http_request)


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
    from ..spectra import _load_dataset

    dataset = _load_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset '{request.dataset_id}' not found or could not be loaded"
        )

    source_index = _resolve_source_index(request.source_index, request.source)
    target_index = _resolve_target_index(request.target_index)
    use_explicit_source = _has_explicit_source(request.source_index, request.source)

    # Extract X, y, wavelengths from SpectroDataset as numpy arrays (no .tolist() conversion).
    # When the dataset has a pre-existing test partition, we load both train and test
    # and concatenate them so the playground can color samples by their source partition
    # without requiring the user to add a splitter step.
    try:
        def _load_partition(part: str):
            """Return (X, y, metadata_dict) for a single partition, or (None, None, None) if empty."""
            try:
                if use_explicit_source:
                    X_p = dataset.x({"partition": part}, layout="2d", concat_source=False)
                else:
                    X_p = dataset.x({"partition": part}, layout="2d")
                X_p = _select_source_array(X_p, source_index)
                if X_p is None or len(X_p) == 0:
                    return None, None, None
            except Exception:
                return None, None, None

            y_p = None
            try:
                y_raw = dataset.y({"partition": part})
                y_p = _select_target_array(y_raw, target_index)
            except Exception:
                pass

            meta_p = None
            try:
                meta_df = dataset.metadata({"partition": part})
                if meta_df is not None and len(meta_df) > 0:
                    raw_dict = meta_df.to_dict(as_series=False)
                    meta_p = {k: np.array(v) for k, v in raw_dict.items()}
            except Exception:
                pass

            return X_p, y_p, meta_p

        requested_partition = request.partition if request.partition in {"train", "test", "all"} else "all"

        X_train, y_train, meta_train = _load_partition("train")
        X_test, y_test, meta_test = _load_partition("test")

        if requested_partition == "test":
            if X_test is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Dataset '{request.dataset_id}' has no test partition data",
                )
            X = X_test
            y_array = y_test
            metadata_np = meta_test
            has_test = False
            n_train = int(len(X_test))
            n_test = 0
        elif requested_partition == "train":
            if X_train is None:
                raise HTTPException(
                    status_code=500,
                    detail=f"Dataset '{request.dataset_id}' has no train partition data",
                )
            X = X_train
            y_array = y_train
            metadata_np = meta_train
            has_test = False
            n_train = int(len(X_train))
            n_test = 0
        else:
            if X_train is None:
                raise HTTPException(
                    status_code=500,
                    detail=f"Dataset '{request.dataset_id}' has no train partition data",
                )

            has_test = X_test is not None
            n_train = int(len(X_train))
            n_test = int(len(X_test)) if has_test else 0

            if has_test:
                X = np.concatenate([X_train, X_test], axis=0)

                if y_train is not None and y_test is not None:
                    y_array = np.concatenate([y_train, y_test], axis=0)
                elif y_train is not None:
                    y_array = np.concatenate([y_train, np.full(n_test, np.nan)], axis=0)
                elif y_test is not None:
                    y_array = np.concatenate([np.full(n_train, np.nan), y_test], axis=0)
                else:
                    y_array = None

                # Merge metadata: union of column names; missing values padded with None.
                metadata_np: dict[str, Any] | None = None
                if meta_train or meta_test:
                    metadata_np = {}
                    cols = set()
                    if meta_train:
                        cols.update(meta_train.keys())
                    if meta_test:
                        cols.update(meta_test.keys())
                    for col in cols:
                        train_vals = meta_train[col] if meta_train and col in meta_train else np.array([None] * n_train, dtype=object)
                        test_vals = meta_test[col] if meta_test and col in meta_test else np.array([None] * n_test, dtype=object)
                        metadata_np[col] = np.concatenate([train_vals, test_vals])
                else:
                    metadata_np = {}

            else:
                X = X_train
                y_array = y_train
                metadata_np = meta_train

        try:
            headers = dataset.headers(source_index)
            if headers is not None and len(headers) > 0:
                if len(headers) == 1 and isinstance(headers[0], (list, tuple, np.ndarray)):
                    headers = list(headers[0])
                wavelengths = [float(h) for h in headers]
            else:
                wavelengths = list(range(X.shape[1]))
        except Exception:
            wavelengths = list(range(X.shape[1]))

        # Resolve the wavelength axis unit (e.g. "nm", "cm-1") so the response
        # can label charts with the correct quantity. nirs4all detects this
        # from the dataset headers; we forward it as-is to the executor.
        try:
            dataset_header_unit = dataset.header_unit(source_index)
        except Exception:
            dataset_header_unit = None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to extract data from dataset '{request.dataset_id}': {str(e)}"
        )

    source_partitions = {
        "has_test": has_test,
        "n_train": n_train,
        "n_test": n_test,
    }

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

    dataset_sample_ids = None
    if metadata_np:
        for candidate in ("sample_id", "sample", "id"):
            values = metadata_np.get(candidate)
            if values is None or len(values) != n_samples:
                continue

            normalized_ids = []
            for idx, value in enumerate(values):
                if value is None:
                    normalized_ids.append(f"Sample_{idx}")
                else:
                    normalized_ids.append(str(value))

            dataset_sample_ids = normalized_ids
            break

    # Build a minimal PlaygroundData for cache key and sample_ids access
    # IMPORTANT: We do NOT call X.tolist() — numpy arrays are passed directly
    # to the executor via the X_np fast path.
    data = PlaygroundData(
        x=[],  # Empty — not used, numpy passed directly
        y=None,
        wavelengths=wavelengths,
        sample_ids=dataset_sample_ids,
    )

    # Forward source partition and dataset repetition info to the executor so
    # split preview uses the same grouping contract as the library.
    exec_options = dict(request.options or {})
    exec_options["source_partitions"] = source_partitions
    exec_options["dataset_repetition"] = getattr(dataset, "repetition", None)
    exec_options["source_index"] = source_index
    exec_options["target_index"] = target_index

    # Check cache using a fast fingerprint (not requiring .tolist())
    use_cache = exec_options.get("use_cache", True)
    cache_key = None

    if use_cache:
        cache_key = compute_dataset_cache_key(request.dataset_id, request.steps, exec_options)
        cached = get_cached_response(cache_key)
        if cached:
            return negotiate_response(cached, http_request)

    # Execute pipeline — pass numpy arrays directly (no list conversion)
    executor = PlaygroundExecutor(verbose=0)

    try:
        # CPU-bound — offload to a worker thread (see /execute).
        result = await asyncio.to_thread(
            lambda: executor.execute(
                data=data,
                steps=request.steps,
                sampling=request.sampling,
                options=exec_options,
                X_np=X,
                y_np=y_array,
                wavelengths_np=wavelengths,
                metadata_np=metadata_np,
                header_unit=dataset_header_unit,
            )
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Pipeline execution failed: {str(e)}"
        )

    # Cache result
    if use_cache and cache_key:
        set_cached_response(cache_key, result)

    return negotiate_response(result, http_request)


# ============= Metadata Columns Endpoint =============


@router.get("/metadata-columns/{dataset_id}")
async def get_metadata_columns(dataset_id: str):
    """Get available metadata columns and their unique values for a dataset.

    Used by MetadataFilter to populate dynamic column/value selectors.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available."
        )

    from ..spectra import _load_dataset

    dataset = _load_dataset(dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset '{dataset_id}' not found"
        )

    try:
        meta_df = dataset.metadata({"partition": "train"})
        if meta_df is None or len(meta_df) == 0:
            return {
                "columns": [],
                "repetition_column": getattr(dataset, "repetition", None),
            }

        columns = []
        for col in meta_df.columns:
            series = meta_df[col]
            unique_raw = series.drop_nulls().unique().to_list()
            # Cap unique values at 200
            columns.append({
                "name": col,
                "dtype": str(series.dtype),
                "unique_values": unique_raw[:200],
                "n_unique": len(unique_raw),
            })
        return {
            "columns": columns,
            "repetition_column": getattr(dataset, "repetition", None),
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get metadata columns: {str(e)}"
        )


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

        from ..spectra import _load_dataset

        dataset = _load_dataset(request.dataset_id)
        if not dataset:
            return None

        source_index = _resolve_source_index(request.source_index, request.source)
        target_index = _resolve_target_index(request.target_index)
        use_explicit_source = _has_explicit_source(request.source_index, request.source)

        try:
            if use_explicit_source:
                X = dataset.x({"partition": "train"}, layout="2d", concat_source=False)
            else:
                X = dataset.x({"partition": "train"}, layout="2d")
            X = _select_source_array(X, source_index)
            if X is None:
                return None
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
                    y_np = _select_target_array(y_raw, target_index)
                except Exception:
                    pass
                sample_indices = executor._apply_sampling(X, y_np, request.sampling)
                X = X[sample_indices]
            except Exception:
                pass

        data_fp = compute_data_fingerprint(X)
    else:
        return None

    # Look up the full pipeline prefix
    prefix_key = compute_prefix_key(data_fp, enabled_steps)
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
                from ..spectra import _load_dataset
                dataset = _load_dataset(request.dataset_id)
                if dataset:
                    source_index = _resolve_source_index(request.source_index, request.source)
                    target_index = _resolve_target_index(request.target_index)
                    use_explicit_source = _has_explicit_source(request.source_index, request.source)

                    y_raw = dataset.y({"partition": "train"})
                    y_sampled = _select_target_array(y_raw, target_index)
                    if y_sampled is not None:
                        # Apply the same sampling to y so it matches X_processed
                        if len(y_sampled) != X_processed.shape[0] and request.sampling and request.sampling.method != "all":
                            try:
                                if use_explicit_source:
                                    X_full = dataset.x({"partition": "train"}, layout="2d", concat_source=False)
                                else:
                                    X_full = dataset.x({"partition": "train"}, layout="2d")
                                X_full = _select_source_array(X_full, source_index)
                                if X_full is None:
                                    raise ValueError("source data unavailable")
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
            return negotiate_response({"success": True, "pca": pca_result}, http_request)
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
        chart_options = dict(request.options or {})

        # Load additional data needed for repetition analysis
        sample_ids = list(cached_state.get("sample_ids") or []) or None
        cached_metadata = cached_state.get("metadata")
        metadata_sampled = (
            {col: values.tolist() if hasattr(values, "tolist") else list(values) for col, values in cached_metadata.items()}
            if cached_metadata
            else None
        )
        cached_y = cached_state.get("y")
        y_sampled = cached_y.tolist() if hasattr(cached_y, "tolist") else cached_y
        sample_indices = None

        if request.dataset_id and NIRS4ALL_AVAILABLE:
            try:
                from ..spectra import _load_dataset
                dataset = _load_dataset(request.dataset_id)
                if dataset:
                    source_index = _resolve_source_index(request.source_index, request.source)
                    target_index = _resolve_target_index(request.target_index)
                    use_explicit_source = _has_explicit_source(request.source_index, request.source)
                    chart_options.setdefault("dataset_repetition", getattr(dataset, "repetition", None))

                    if use_explicit_source:
                        X_full = dataset.x({"partition": "train"}, layout="2d", concat_source=False)
                    else:
                        X_full = dataset.x({"partition": "train"}, layout="2d")
                    X_full = _select_source_array(X_full, source_index)
                    if (
                        request.sampling
                        and request.sampling.method != "all"
                        and X_full is not None
                        and len(X_full) > 0
                    ):
                        sample_indices = executor._apply_sampling(X_full, None, request.sampling)

                    y_raw = dataset.y({"partition": "train"})
                    if y_sampled is None:
                        y_sampled = _select_target_array(y_raw, target_index)
                    if y_sampled is not None:
                        if sample_indices is not None:
                            y_sampled = y_sampled[sample_indices]
                        elif len(y_sampled) != X_processed.shape[0]:
                            y_sampled = None

                    meta_df = dataset.metadata({"partition": "train"})
                    if metadata_sampled is None and meta_df is not None and len(meta_df) > 0:
                        raw_metadata = meta_df.to_dict(as_series=False)
                        if sample_indices is not None:
                            metadata_sampled = {
                                col: [values[i] for i in sample_indices]
                                for col, values in raw_metadata.items()
                            }
                        elif len(next(iter(raw_metadata.values()), [])) == X_processed.shape[0]:
                            metadata_sampled = raw_metadata

                        if sample_ids is None and metadata_sampled:
                            for candidate in ("sample_id", "sample", "id"):
                                values = metadata_sampled.get(candidate)
                                if values is not None and len(values) == X_processed.shape[0]:
                                    sample_ids = [f"Sample_{i}" if value is None else str(value) for i, value in enumerate(values)]
                                    break
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
                options=chart_options,
            )
            return negotiate_response({"success": True, "repetitions": repetitions_result}, http_request)
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


# ============= Difference Computation Endpoints =============


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
