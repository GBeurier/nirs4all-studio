"""
Spectra API routes for nirs4all webapp.

This module provides FastAPI routes for accessing spectral data from datasets,
including raw spectra, processed spectra, and statistics.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .workspace_manager import workspace_manager
from .shared.pipeline_service import instantiate_operator

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    from nirs4all.data.dataset import SpectroDataset

    NIRS4ALL_AVAILABLE = True
except ImportError as e:
    print(f"Note: nirs4all not available for spectra API: {e}")
    NIRS4ALL_AVAILABLE = False


router = APIRouter()


class SpectraRequest(BaseModel):
    """Request model for getting processed spectra."""

    preprocessing_chain: List[Dict[str, Any]] = []
    indices: Optional[List[int]] = None
    partition: str = "train"


# Cache for loaded datasets (use Any type to avoid import issues)
_dataset_cache: Dict[str, Any] = {}


def _get_dataset_config(dataset_id: str) -> Optional[Dict[str, Any]]:
    """Get dataset configuration from workspace."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        return None

    for ds in workspace.datasets:
        if ds.get("id") == dataset_id:
            return ds
    return None


def _build_nirs4all_config_from_stored(dataset_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build nirs4all DatasetConfigs-compatible config from stored dataset configuration.

    This mirrors the logic in POST /datasets/preview and GET /datasets/{id}/preview
    to ensure consistent dataset loading across all views.
    """
    dataset_path = dataset_config.get("path", "")
    stored_config = dataset_config.get("config", {})

    # Get parsing options from stored config or use defaults
    delimiter = stored_config.get("delimiter", ",")
    decimal_separator = stored_config.get("decimal_separator", ".")
    has_header = stored_config.get("has_header", True)
    header_unit = stored_config.get("header_unit", "cm-1")
    signal_type = stored_config.get("signal_type", "auto")

    global_params = {
        "delimiter": delimiter,
        "decimal_separator": decimal_separator,
        "has_header": has_header,
    }

    # X-specific params
    x_specific_params = {}
    if header_unit:
        x_specific_params["header_unit"] = header_unit
    if signal_type and signal_type != "auto":
        x_specific_params["signal_type"] = signal_type

    config: Dict[str, Any] = {
        "global_params": global_params
    }

    # Get files from stored config
    files = stored_config.get("files", [])

    if files:
        # Map files to config (same logic as POST endpoint)
        for file_config in files:
            file_type = file_config.get("type", "X")
            file_split = file_config.get("split", "train")
            file_path = file_config.get("path", "")
            file_overrides = file_config.get("overrides")

            file_key = None
            if file_type == "X":
                file_key = f"{file_split}_x"
            elif file_type == "Y":
                file_key = f"{file_split}_y"
            elif file_type == "metadata":
                file_key = f"{file_split}_group"

            if file_key:
                # Handle multi-source (list of X files for same split)
                if file_key in config and file_type == "X":
                    existing = config[file_key]
                    if isinstance(existing, list):
                        config[file_key].append(file_path)
                    else:
                        config[file_key] = [existing, file_path]
                else:
                    config[file_key] = file_path

                # Per-file params (merge with x_specific_params for X files)
                params_key = f"{file_key}_params"
                if file_type == "X" and x_specific_params:
                    if file_overrides:
                        config[params_key] = {**x_specific_params, **file_overrides}
                    else:
                        config[params_key] = x_specific_params.copy()
                elif file_overrides:
                    config[params_key] = file_overrides
    else:
        # Fallback: try to auto-detect files from folder or use old format
        # Check for train_x, train_y in stored config (old format)
        if stored_config.get("train_x"):
            config["train_x"] = stored_config["train_x"]
            if x_specific_params:
                config["train_x_params"] = x_specific_params
        if stored_config.get("train_y"):
            config["train_y"] = stored_config["train_y"]
        if stored_config.get("test_x"):
            config["test_x"] = stored_config["test_x"]
            if x_specific_params:
                config["test_x_params"] = x_specific_params
        if stored_config.get("test_y"):
            config["test_y"] = stored_config["test_y"]

        # If still no files configured, try to detect from folder
        if "train_x" not in config:
            folder_path = Path(dataset_path)
            if folder_path.is_dir():
                # Look for dataset_config.json
                config_file = folder_path / "dataset_config.json"
                if config_file.exists():
                    import json
                    with open(config_file, "r", encoding="utf-8") as f:
                        folder_config = json.load(f)
                        config.update(folder_config)
                else:
                    # Try to detect standard nirs4all folder structure (Xtrain.csv, Ytrain.csv, etc.)
                    csv_files = list(folder_path.glob("*.csv"))
                    csv_lower_map = {f.name.lower(): f for f in csv_files}

                    # Look for X files: Xtrain.csv, X_train.csv, xcal.csv, x_cal.csv
                    x_train_names = ["xtrain.csv", "x_train.csv", "xcal.csv", "x_cal.csv"]
                    x_test_names = ["xtest.csv", "x_test.csv", "xval.csv", "x_val.csv"]
                    y_train_names = ["ytrain.csv", "y_train.csv", "ycal.csv", "y_cal.csv"]
                    y_test_names = ["ytest.csv", "y_test.csv", "yval.csv", "y_val.csv"]

                    # Check for standard X/Y file structure
                    detected_x_file = None
                    for name in x_train_names:
                        if name in csv_lower_map:
                            detected_x_file = csv_lower_map[name]
                            config["train_x"] = str(detected_x_file)
                            if x_specific_params:
                                config["train_x_params"] = x_specific_params.copy()
                            break

                    for name in x_test_names:
                        if name in csv_lower_map:
                            config["test_x"] = str(csv_lower_map[name])
                            if x_specific_params:
                                config["test_x_params"] = x_specific_params.copy()
                            break

                    for name in y_train_names:
                        if name in csv_lower_map:
                            config["train_y"] = str(csv_lower_map[name])
                            break

                    for name in y_test_names:
                        if name in csv_lower_map:
                            config["test_y"] = str(csv_lower_map[name])
                            break

                    # If no standard structure found, fall back to first CSV as X
                    if "train_x" not in config and csv_files:
                        detected_x_file = csv_files[0]
                        config["train_x"] = str(detected_x_file)
                        if x_specific_params:
                            config["train_x_params"] = x_specific_params

                    # Auto-detect delimiter from detected X file
                    if detected_x_file and detected_x_file.exists():
                        try:
                            with open(detected_x_file, "r", encoding="utf-8") as f:
                                first_line = f.readline()
                                # Count delimiters to find the most likely one
                                semicolon_count = first_line.count(";")
                                comma_count = first_line.count(",")
                                tab_count = first_line.count("\t")

                                if semicolon_count > comma_count and semicolon_count > tab_count:
                                    detected_delimiter = ";"
                                elif tab_count > comma_count and tab_count > semicolon_count:
                                    detected_delimiter = "\t"
                                else:
                                    detected_delimiter = ","

                                # Update global_params with detected delimiter
                                config["global_params"]["delimiter"] = detected_delimiter
                        except Exception:
                            pass  # Keep default delimiter
            elif folder_path.is_file():
                # Single file - create minimal config
                config["train_x"] = str(folder_path)
                if x_specific_params:
                    config["train_x_params"] = x_specific_params

    return config


def _load_dataset(dataset_id: str) -> Optional[SpectroDataset]:
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
            print(f"No train_x found in config for dataset {dataset_id}")
            return None

        # Load using DatasetConfigs (same as working preview endpoints)
        from nirs4all.data import DatasetConfigs

        dataset_configs = DatasetConfigs(config)
        datasets = dataset_configs.get_datasets()

        if not datasets:
            print(f"No datasets loaded for {dataset_id}")
            return None

        dataset = datasets[0]

        # Cache the dataset
        _dataset_cache[dataset_id] = dataset

        return dataset

    except Exception as e:
        print(f"Error loading dataset {dataset_id}: {e}")
        import traceback
        traceback.print_exc()
        return None


def _clear_dataset_cache(dataset_id: Optional[str] = None):
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
    end: Optional[int] = Query(None, description="End index (exclusive)"),
    partition: str = Query("train", description="Partition to get spectra from"),
    source: int = Query(0, ge=0, description="Source index for multi-source datasets"),
    include_y: bool = Query(False, description="Whether to include target (y) values"),
):
    """
    Get raw spectra data from a dataset.

    Returns spectral data as a 2D array with wavelength headers.
    Optionally includes target (y) values when include_y=True.
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
                print(f"Warning: Could not get y values: {e}")
                response["y"] = None

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


def _apply_preprocessing_chain(X: np.ndarray, chain: List[Dict[str, Any]]) -> np.ndarray:
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
                print(f"Warning: Unknown preprocessing step '{name}', skipping")
        except Exception as e:
            print(f"Warning: Failed to apply preprocessing step '{name}': {e}")

    return X
