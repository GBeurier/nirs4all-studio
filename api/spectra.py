"""
Spectra API routes for nirs4all webapp.

This module provides FastAPI routes for accessing spectral data from datasets,
including raw spectra, processed spectra, and statistics.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .shared.logger import get_logger
from .shared.pipeline_service import instantiate_operator
from .workspace_manager import workspace_manager

logger = get_logger(__name__)

from .lazy_imports import get_cached, require_ml_ready

NIRS4ALL_AVAILABLE = True


router = APIRouter()


class SpectraRequest(BaseModel):
    """Request model for getting processed spectra."""

    preprocessing_chain: list[dict[str, Any]] = []
    indices: list[int] | None = None
    partition: str = "train"


# Cache for loaded datasets (use Any type to avoid import issues)
_dataset_cache: dict[str, Any] = {}


def _get_dataset_config(dataset_id: str) -> dict[str, Any] | None:
    """Get dataset configuration from workspace."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        return None

    for ds in workspace.datasets:
        if ds.get("id") == dataset_id:
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


@router.get("/spectra/{dataset_id}")
async def get_spectra(
    dataset_id: str,
    start: int = Query(0, ge=0, description="Start index for pagination"),
    end: int | None = Query(None, description="End index (exclusive)"),
    partition: str = Query("train", description="Partition to get spectra from"),
    source: int = Query(0, ge=0, description="Source index for multi-source datasets"),
    include_y: bool = Query(False, description="Whether to include target (y) values"),
    include_metadata: bool = Query(False, description="Whether to include sample metadata"),
):
    """
    Get raw spectra data from a dataset.

    Returns spectral data as a 2D array with wavelength headers.
    Optionally includes target (y) values when include_y=True.
    Optionally includes sample metadata when include_metadata=True.
    """
    import numpy as np
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="nirs4all library not available for spectra access"
        )

    dataset = _load_dataset(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found or could not be loaded")

    try:
        selector = {"partition": partition}
        X = dataset.x(selector, layout="2d", concat_source=False)

        # Handle multi-source
        if isinstance(X, list):
            if source >= len(X):
                raise HTTPException(
                    status_code=400,
                    detail=f"Source index {source} out of range (max: {len(X) - 1})",
                )
            X = X[source]

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

        # Get header unit
        try:
            header_unit = dataset.header_unit(source)
        except Exception:
            header_unit = "unknown"

        # Build response
        response = {
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
        }

        # Include y values if requested
        if include_y:
            try:
                y = dataset.y(selector)
                if y is not None and len(y) > 0:
                    y_slice = y[start:end]
                    # Handle multi-target (2D) vs single-target (1D)
                    if y_slice.ndim == 1:
                        response["y"] = y_slice.tolist()
                    else:
                        # Use first target column for simplicity
                        response["y"] = y_slice[:, 0].tolist()
                else:
                    response["y"] = None
            except Exception as e:
                logger.warning("Could not get y values: %s", e)
                response["y"] = None

        # Include metadata if requested
        if include_metadata:
            try:
                meta_df = dataset.metadata(selector)
                if meta_df is not None and len(meta_df) > 0:
                    meta_df_slice = meta_df[start:end]
                    raw_dict = meta_df_slice.to_dict(as_series=False)
                    # Ensure all values are JSON-serializable (NaN → None)
                    metadata_dict = {}
                    for col_name, col_values in raw_dict.items():
                        metadata_dict[col_name] = [
                            None if v is None or (isinstance(v, float) and v != v) else v
                            for v in col_values
                        ]
                    response["metadata"] = metadata_dict
                    response["metadata_columns"] = list(raw_dict.keys())
                else:
                    response["metadata"] = None
                    response["metadata_columns"] = []
            except Exception as e:
                logger.warning("Could not get metadata: %s", e)
                response["metadata"] = None
                response["metadata_columns"] = []

        return response

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get spectra: {str(e)}")


@router.get("/spectra/{dataset_id}/{sample_index}")
async def get_spectrum(
    dataset_id: str,
    sample_index: int,
    partition: str = Query("train", description="Partition to get spectrum from"),
    source: int = Query(0, ge=0, description="Source index for multi-source datasets"),
):
    """
    Get a single spectrum by sample index.

    Returns one spectrum with its wavelength values.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="nirs4all library not available for spectra access"
        )

    dataset = _load_dataset(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found or could not be loaded")

    try:
        selector = {"partition": partition}
        X = dataset.x(selector, layout="2d", concat_source=False)

        # Handle multi-source
        if isinstance(X, list):
            if source >= len(X):
                raise HTTPException(
                    status_code=400,
                    detail=f"Source index {source} out of range (max: {len(X) - 1})",
                )
            X = X[source]

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

        # Get target if available
        target = None
        try:
            y = dataset.y(selector)
            if y is not None and len(y) > sample_index:
                target = float(y[sample_index]) if y.ndim == 1 else y[sample_index].tolist()
        except Exception:
            pass

        # Get metadata if available
        metadata = None
        try:
            meta_df = dataset.metadata(selector)
            if meta_df is not None and len(meta_df) > sample_index:
                metadata = meta_df.row(sample_index, named=True)
        except Exception:
            pass

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

    dataset = _load_dataset(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found or could not be loaded")

    try:
        selector = {"partition": request.partition}
        X = dataset.x(selector, layout="2d")

        # Handle multi-source (concatenate for simplicity)
        if isinstance(X, list):
            X = X[0]  # Use first source for now

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

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get processed spectra: {str(e)}"
        )


@router.get("/spectra/{dataset_id}/stats")
async def get_spectra_statistics(
    dataset_id: str,
    partition: str = Query("train", description="Partition to compute statistics for"),
    source: int = Query(0, ge=0, description="Source index for multi-source datasets"),
):
    """
    Compute statistics for spectra in a dataset.

    Returns mean, std, min, max, and percentiles for the spectral data.
    """
    import numpy as np
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="nirs4all library not available for spectra access"
        )

    dataset = _load_dataset(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found or could not be loaded")

    try:
        selector = {"partition": partition}
        X = dataset.x(selector, layout="2d", concat_source=False)

        # Handle multi-source
        if isinstance(X, list):
            if source >= len(X):
                raise HTTPException(
                    status_code=400,
                    detail=f"Source index {source} out of range (max: {len(X) - 1})",
                )
            X = X[source]

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
