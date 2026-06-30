"""
Spectra API routes for nirs4all webapp.

This module provides FastAPI routes for accessing spectral data from datasets,
including raw spectra, processed spectra, and statistics.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .shared.logger import get_logger
from .shared.pipeline_service import instantiate_operator
from .workspace_manager import workspace_manager

logger = get_logger(__name__)


NIRS4ALL_AVAILABLE = True


router = APIRouter()


class SpectraRequest(BaseModel):
    """Request model for getting processed spectra."""

    preprocessing_chain: list[dict[str, Any]] = []
    indices: list[int] | None = None
    partition: str = "train"


# Cache for loaded datasets, bounded by a small LRU so a user browsing many
# datasets cannot pin every materialized SpectroDataset in RAM for the process
# lifetime. Each entry holds a full spectral matrix, so the cap is deliberately
# low; the least-recently-used dataset is evicted on insert.
_DATASET_CACHE_MAX_ENTRIES = 4


class _DatasetLRUCache:
    """Minimal LRU cache supporting the dict operations spectra.py relies on."""

    def __init__(self, max_entries: int):
        self._entries: OrderedDict[str, Any] = OrderedDict()
        self._max_entries = max_entries

    def __contains__(self, key: str) -> bool:
        return key in self._entries

    def __getitem__(self, key: str) -> Any:
        self._entries.move_to_end(key)
        return self._entries[key]

    def __setitem__(self, key: str, value: Any) -> None:
        if key in self._entries:
            self._entries.move_to_end(key)
        self._entries[key] = value
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)

    def pop(self, key: str, default: Any = None) -> Any:
        return self._entries.pop(key, default)

    def clear(self) -> None:
        self._entries.clear()


_dataset_cache = _DatasetLRUCache(_DATASET_CACHE_MAX_ENTRIES)


def _get_dataset_config(dataset_id: str) -> dict[str, Any] | None:
    """Get dataset configuration from workspace.

    Looks up by ID first, then falls back to name matching so that
    URLs containing a dataset *name* also resolve correctly.
    """
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        return None

    for ds in workspace.datasets:
        if ds.get("id") == dataset_id:
            return ds
    # Fallback: match by name
    for ds in workspace.datasets:
        if ds.get("name") == dataset_id:
            return ds
    lower = dataset_id.lower()
    for ds in workspace.datasets:
        if (ds.get("name") or "").lower() == lower:
            return ds
    return None


def _build_nirs4all_config_from_stored(dataset_config: dict[str, Any]) -> dict[str, Any]:
    """Build nirs4all DatasetConfigs-compatible config from stored dataset configuration.

    Delegates to the canonical translator in shared.dataset_config.
    """
    from .shared.dataset_config import build_nirs4all_config_from_stored

    config = build_nirs4all_config_from_stored(dataset_config)

    # Handle single-file and folder auto-detection fallbacks not covered by canonical translator
    if "train_x" not in config:
        dataset_path = dataset_config.get("path", "")
        folder_path = Path(dataset_path)

        if folder_path.is_file():
            stored_config = dataset_config.get("config", {})
            header_unit = stored_config.get("header_unit", "cm-1")
            signal_type = stored_config.get("signal_type", "auto")

            config["train_x"] = str(folder_path)
            x_params: dict[str, Any] = {}
            if header_unit:
                x_params["header_unit"] = header_unit
            if signal_type and signal_type != "auto":
                x_params["signal_type"] = signal_type
            if x_params:
                config["train_x_params"] = x_params

        elif folder_path.is_dir() and "train_x" not in config:
            # Auto-detect delimiter from first CSV file if folder detection found files
            csv_files = list(folder_path.glob("*.csv"))
            if csv_files and "train_x" not in config:
                config["train_x"] = str(csv_files[0])
                # Try delimiter auto-detection
                try:
                    with open(csv_files[0], encoding="utf-8") as f:
                        first_line = f.readline()
                        semicolons = first_line.count(";")
                        commas = first_line.count(",")
                        tabs = first_line.count("\t")
                        if semicolons > commas and semicolons > tabs:
                            detected = ";"
                        elif tabs > commas and tabs > semicolons:
                            detected = "\t"
                        else:
                            detected = ","
                        config.setdefault("global_params", {})["delimiter"] = detected
                except Exception:
                    pass

    return config


def _load_dataset(dataset_id: str) -> Any:
    """Load a dataset by ID, with caching."""
    global _dataset_cache

    if dataset_id in _dataset_cache:
        return _dataset_cache[dataset_id]

    if not NIRS4ALL_AVAILABLE:
        return None

    dataset_config = _get_dataset_config(dataset_id)
    if not dataset_config:
        return None

    dataset_path = dataset_config.get("path")
    if not dataset_path or not Path(dataset_path).exists():
        return None

    try:
        # Build nirs4all config from stored configuration
        # This mirrors the logic in POST/GET /datasets/preview endpoints
        config = _build_nirs4all_config_from_stored(dataset_config)

        # Check if we have valid config
        if "train_x" not in config:
            logger.warning("No train_x found in config for dataset %s", dataset_id)
            return None

        # Load using DatasetConfigs (same as working preview endpoints)
        from nirs4all.data import DatasetConfigs

        dataset_configs = DatasetConfigs(config)
        datasets = dataset_configs.get_datasets()

        if not datasets:
            logger.warning("No datasets loaded for %s", dataset_id)
            return None

        dataset = datasets[0]

        # Cache the dataset
        _dataset_cache[dataset_id] = dataset

        return dataset

    except Exception as e:
        logger.error("Error loading dataset %s: %s", dataset_id, e, exc_info=True)
        return None


def _clear_dataset_cache(dataset_id: str | None = None):
    """Clear dataset cache, optionally for specific dataset."""
    global _dataset_cache
    if dataset_id:
        _dataset_cache.pop(dataset_id, None)
    else:
        _dataset_cache.clear()


def _get_partition_arrays(
    dataset,
    partition: str,
    *,
    source: int = 0,
    target_index: int = 0,
    want_y: bool = False,
    want_metadata: bool = False,
):
    """Load X (and optionally y / metadata) for a partition.

    Supports partition="all" by concatenating train and test. Returns
    (X, y, metadata_dict) where each can be None if not present/requested.
    metadata_dict is a column-name → list mapping (compatible with the
    current spectra endpoint response format).
    """
    import numpy as np

    parts = ("train", "test") if partition == "all" else (partition,)

    X_chunks: list = []
    y_chunks: list = []
    meta_columns: dict[str, list] = {}
    meta_seen = False
    for p in parts:
        sel = {"partition": p}
        try:
            X_p = dataset.x(sel, layout="2d", concat_source=False)
        except Exception:
            continue
        if isinstance(X_p, list):
            if source >= len(X_p):
                continue
            X_p = X_p[source]
        if X_p is None or len(X_p) == 0:
            continue
        X_chunks.append(X_p)

        if want_y:
            try:
                y_p = dataset.y(sel)
                if y_p is not None and len(y_p) > 0:
                    if y_p.ndim == 1:
                        y_chunks.append(y_p)
                    elif target_index < y_p.shape[1]:
                        y_chunks.append(y_p[:, target_index])
                    else:
                        raise HTTPException(
                            status_code=422,
                            detail=f"target_index {target_index} is out of range",
                        )
                else:
                    y_chunks.append(None)
            except HTTPException:
                raise
            except Exception:
                y_chunks.append(None)

        if want_metadata:
            try:
                meta_df = dataset.metadata(sel)
            except Exception:
                meta_df = None
            if meta_df is not None and len(meta_df) > 0:
                meta_seen = True
                raw_dict = meta_df.to_dict(as_series=False)
                for col_name, col_values in raw_dict.items():
                    cleaned = [
                        None if v is None or (isinstance(v, float) and v != v) else v
                        for v in col_values
                    ]
                    if col_name not in meta_columns:
                        # Pad with Nones if previous chunks missed this column
                        prev_total = sum(len(c) for c in X_chunks[:-1])
                        meta_columns[col_name] = [None] * prev_total
                    meta_columns[col_name].extend(cleaned)
        # Pad metadata columns that did not appear in this chunk
        if want_metadata and meta_seen:
            total_so_far = sum(len(c) for c in X_chunks)
            for col_values in meta_columns.values():
                if len(col_values) < total_so_far:
                    col_values.extend([None] * (total_so_far - len(col_values)))

    if not X_chunks:
        return None, None, None

    X = np.concatenate(X_chunks, axis=0) if len(X_chunks) > 1 else X_chunks[0]

    y_out = None
    if want_y and y_chunks and any(c is not None for c in y_chunks):
        # Replace any None chunks with NaN-filled arrays of the right length
        normalized = []
        for X_chunk, y_chunk in zip(X_chunks, y_chunks):
            if y_chunk is None:
                normalized.append(np.full(len(X_chunk), np.nan))
            else:
                normalized.append(y_chunk)
        y_out = np.concatenate(normalized, axis=0) if len(normalized) > 1 else normalized[0]

    meta_out = meta_columns if want_metadata and meta_seen else None
    return X, y_out, meta_out


def _build_spectra_response(
    dataset_id: str,
    start: int,
    end: int | None,
    partition: str,
    source: int,
    target_index: int,
    include_y: bool,
    include_metadata: bool,
    max_wavelengths_returned: int | None,
) -> dict[str, Any]:
    """Blocking build of the raw-spectra response payload.

    Runs the parquet load, matrix materialization, pagination, optional
    wavelength decimation, and the numpy -> list JSON conversion. Intended to
    be dispatched via ``asyncio.to_thread`` so none of this blocks the event
    loop. Raises HTTPException for not-found / empty cases.
    """
    import numpy as np

    dataset = _load_dataset(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found or could not be loaded")

    X, y_full, meta_full = _get_partition_arrays(
        dataset,
        partition,
        source=source,
        target_index=target_index,
        want_y=include_y,
        want_metadata=include_metadata,
    )
    if X is None:
        raise HTTPException(
            status_code=404,
            detail=f"No samples found for partition '{partition}' (source={source})",
        )

    # Apply pagination
    total_samples = X.shape[0]
    if end is None:
        end = total_samples
    end = min(end, total_samples)
    start = min(start, total_samples)

    X_slice = X[start:end]

    # Get headers (wavelengths) - robust handling like preview endpoint
    try:
        headers = dataset.headers(source)
        if headers is None or len(headers) == 0:
            headers = list(range(X.shape[1]))
        else:
            # Handle nested list case (e.g., [[h1, h2, ...]] instead of [h1, h2, ...])
            if len(headers) == 1 and isinstance(headers[0], (list, tuple, np.ndarray)):
                headers = list(headers[0])
            # Try to convert to float for numeric wavelengths
            try:
                headers = [float(h) for h in headers]
            except (ValueError, TypeError):
                # Keep as strings if conversion fails
                pass
    except Exception:
        headers = list(range(X.shape[1]))

    # Optionally decimate the wavelength axis (LTTB, feature-preserving) so wide
    # NIRS spectra don't ship every wavelength to the client. Default-off: only
    # applied when the caller passes max_wavelengths_returned, preserving the
    # current full-width behavior for existing callers.
    if (
        isinstance(max_wavelengths_returned, int)
        and max_wavelengths_returned > 0
        and len(headers) > max_wavelengths_returned
        and X_slice.shape[0] > 0
    ):
        from .shared.decimation import decimate_wavelengths

        wl_array = np.asarray(headers, dtype=np.float64)
        indices = decimate_wavelengths(wl_array, X_slice, max_wavelengths_returned)
        headers = [headers[i] for i in indices]
        X_slice = X_slice[:, indices]

    # Get header unit
    try:
        header_unit = dataset.header_unit(source)
    except Exception:
        header_unit = "unknown"

    # Build response
    response: dict[str, Any] = {
        "dataset_id": dataset_id,
        "partition": partition,
        "source": source,
        "start": start,
        "end": end,
        "total_samples": total_samples,
        "num_features": X.shape[1],
        "spectra": X_slice.tolist(),
        "wavelengths": headers,
        "wavelength_unit": header_unit,
        "repetition_column": getattr(dataset, "repetition", None),
    }

    # Include y values if requested
    if include_y:
        if y_full is not None:
            y_slice = y_full[start:end]
            response["y"] = y_slice.tolist()
        else:
            response["y"] = None

    # Include metadata if requested
    if include_metadata:
        if meta_full is not None:
            metadata_dict = {
                col: list(values[start:end]) for col, values in meta_full.items()
            }
            response["metadata"] = metadata_dict
            response["metadata_columns"] = list(meta_full.keys())
        else:
            response["metadata"] = None
            response["metadata_columns"] = []

    return response


@router.get("/spectra/{dataset_id}")
async def get_spectra(
    dataset_id: str,
    start: int = Query(0, ge=0, description="Start index for pagination"),
    end: int | None = Query(None, description="End index (exclusive)"),
    partition: str = Query("train", description="Partition: 'train', 'test', or 'all'"),
    source: int = Query(0, ge=0, description="Source index for multi-source datasets"),
    target_index: int = Query(0, ge=0, description="Target index for multi-target datasets"),
    include_y: bool = Query(False, description="Whether to include target (y) values"),
    include_metadata: bool = Query(False, description="Whether to include sample metadata"),
    max_wavelengths_returned: int | None = Query(
        None,
        gt=0,
        description=(
            "Optional cap on returned wavelengths; LTTB-decimates the spectra to at "
            "most this many points. Omit for the full wavelength axis (default)."
        ),
    ),
):
    """
    Get raw spectra data from a dataset.

    Returns spectral data as a 2D array with wavelength headers.
    Optionally includes target (y) values when include_y=True.
    Optionally includes sample metadata when include_metadata=True.

    The 'partition' query supports 'train', 'test', or 'all' (concatenated train+test).
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="nirs4all library not available for spectra access"
        )

    try:
        return await asyncio.to_thread(
            _build_spectra_response,
            dataset_id,
            start,
            end,
            partition,
            source,
            target_index,
            include_y,
            include_metadata,
            max_wavelengths_returned,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get spectra: {str(e)}")


@router.get("/spectra/{dataset_id}/{sample_index}")
async def get_spectrum(
    dataset_id: str,
    sample_index: int,
    partition: str = Query("train", description="Partition: 'train', 'test', or 'all'"),
    source: int = Query(0, ge=0, description="Source index for multi-source datasets"),
    target_index: int = Query(0, ge=0, description="Target index for multi-target datasets"),
):
    """
    Get a single spectrum by sample index.

    Returns one spectrum with its wavelength values.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="nirs4all library not available for spectra access"
        )

    def _build() -> dict[str, Any]:
        dataset = _load_dataset(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found or could not be loaded")

        X, y_full, meta_full = _get_partition_arrays(
            dataset,
            partition,
            source=source,
            target_index=target_index,
            want_y=True,
            want_metadata=True,
        )
        if X is None:
            raise HTTPException(
                status_code=404,
                detail=f"No samples found for partition '{partition}' (source={source})",
            )

        if sample_index < 0 or sample_index >= X.shape[0]:
            raise HTTPException(
                status_code=400,
                detail=f"Sample index {sample_index} out of range (max: {X.shape[0] - 1})",
            )

        spectrum = X[sample_index]

        # Get headers
        try:
            headers = dataset.headers(source)
            wavelengths = [float(h) for h in headers] if headers else list(range(len(spectrum)))
        except Exception:
            wavelengths = list(range(len(spectrum)))

        target = None
        if y_full is not None and len(y_full) > sample_index:
            val = y_full[sample_index]
            target = float(val) if hasattr(val, "__float__") else val

        metadata = None
        if meta_full is not None:
            metadata = {col: values[sample_index] for col, values in meta_full.items()}

        return {
            "dataset_id": dataset_id,
            "sample_index": sample_index,
            "partition": partition,
            "source": source,
            "spectrum": spectrum.tolist(),
            "wavelengths": wavelengths,
            "target": target,
            "metadata": metadata,
        }

    try:
        return await asyncio.to_thread(_build)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get spectrum: {str(e)}")


@router.post("/spectra/{dataset_id}/processed")
async def get_processed_spectra(dataset_id: str, request: SpectraRequest):
    """
    Get processed spectra with preprocessing chain applied.

    Applies a sequence of preprocessing steps to the spectral data.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="nirs4all library not available for spectra access"
        )

    def _build() -> dict[str, Any]:
        dataset = _load_dataset(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found or could not be loaded")

        X, _, _ = _get_partition_arrays(dataset, request.partition, source=0)
        if X is None:
            raise HTTPException(
                status_code=404,
                detail=f"No samples for partition '{request.partition}'",
            )

        # Apply indices filter if provided
        if request.indices:
            valid_indices = [i for i in request.indices if 0 <= i < X.shape[0]]
            X = X[valid_indices]

        # Apply preprocessing chain
        if request.preprocessing_chain:
            X = _apply_preprocessing_chain(X, request.preprocessing_chain)

        return {
            "dataset_id": dataset_id,
            "partition": request.partition,
            "num_samples": X.shape[0],
            "num_features": X.shape[1],
            "spectra": X.tolist(),
            "preprocessing_applied": [step.get("name", "unknown") for step in request.preprocessing_chain],
        }

    try:
        return await asyncio.to_thread(_build)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get processed spectra: {str(e)}"
        )


@router.get("/spectra/{dataset_id}/stats")
async def get_spectra_statistics(
    dataset_id: str,
    partition: str = Query("train", description="Partition: 'train', 'test', or 'all'"),
    source: int = Query(0, ge=0, description="Source index for multi-source datasets"),
):
    """
    Compute statistics for spectra in a dataset.

    Returns mean, std, min, max, and percentiles for the spectral data.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="nirs4all library not available for spectra access"
        )

    def _build() -> dict[str, Any]:
        import numpy as np

        dataset = _load_dataset(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found or could not be loaded")

        X, _, _ = _get_partition_arrays(dataset, partition, source=source)
        if X is None:
            raise HTTPException(
                status_code=404,
                detail=f"No samples for partition '{partition}' (source={source})",
            )

        # Compute statistics
        mean = np.mean(X, axis=0).tolist()
        std = np.std(X, axis=0).tolist()
        min_vals = np.min(X, axis=0).tolist()
        max_vals = np.max(X, axis=0).tolist()
        median = np.median(X, axis=0).tolist()
        q1 = np.percentile(X, 25, axis=0).tolist()
        q3 = np.percentile(X, 75, axis=0).tolist()

        # Get wavelengths
        try:
            wavelengths = dataset.headers(source)
        except Exception:
            wavelengths = [str(i) for i in range(X.shape[1])]

        # Global statistics
        global_stats = {
            "global_mean": float(np.mean(X)),
            "global_std": float(np.std(X)),
            "global_min": float(np.min(X)),
            "global_max": float(np.max(X)),
            "num_samples": X.shape[0],
            "num_features": X.shape[1],
        }

        return {
            "dataset_id": dataset_id,
            "partition": partition,
            "source": source,
            "wavelengths": wavelengths,
            "statistics": {
                "mean": mean,
                "std": std,
                "min": min_vals,
                "max": max_vals,
                "median": median,
                "q1": q1,
                "q3": q3,
            },
            "global": global_stats,
        }

    try:
        return await asyncio.to_thread(_build)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to compute statistics: {str(e)}"
        )


def _apply_preprocessing_chain(X, chain: list[dict[str, Any]]):
    """Apply a chain of preprocessing steps to spectral data.

    Uses shared pipeline_service for operator resolution to avoid duplicating
    the transformer mapping logic.
    """
    if not NIRS4ALL_AVAILABLE:
        return X

    for step in chain:
        name = step.get("name", "")
        params = step.get("params", {})

        if not name:
            continue

        try:
            # Use shared pipeline service for operator resolution
            transformer = instantiate_operator(name, params, operator_type="preprocessing")
            if transformer is not None:
                X = transformer.fit_transform(X)
            else:
                logger.warning("Unknown preprocessing step '%s', skipping", name)
        except Exception as e:
            logger.warning("Failed to apply preprocessing step '%s': %s", name, e)

    return X
