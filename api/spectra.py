"""
Spectra API routes for nirs4all webapp.

This module provides FastAPI routes for accessing spectral data from datasets,
including raw spectra, processed spectra, statistics, and outlier detection.
"""

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from .workspace_manager import workspace_manager

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    from nirs4all.data.dataset import SpectroDataset
    from nirs4all.data.loaders.loader import handle_data
    from nirs4all.data.config_parser import parse_config

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


class OutlierRequest(BaseModel):
    """Request model for outlier detection."""

    method: str = "isolation_forest"
    params: Dict[str, Any] = {}
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
        # Check if path is a directory (dataset folder) or file
        path = Path(dataset_path)

        if path.is_dir():
            # Look for config file in directory
            config_file = path / "dataset_config.json"
            if config_file.exists():
                import json

                with open(config_file, "r", encoding="utf-8") as f:
                    config = json.load(f)
            else:
                # Try to find CSV files
                csv_files = list(path.glob("*.csv"))
                if csv_files:
                    config = {"train_x": str(csv_files[0])}
                else:
                    return None
        else:
            # Single file - create minimal config
            config = {"train_x": str(path)}

        # Load data using nirs4all loader
        x, y, m, x_headers, m_headers, x_unit, x_signal_type = handle_data(
            config, "train"
        )

        # Create SpectroDataset
        dataset = SpectroDataset(name=dataset_config.get("name", "Unknown"))

        # Add samples
        if isinstance(x, list):
            # Multi-source
            for i, x_source in enumerate(x):
                headers = x_headers[i] if isinstance(x_headers, list) else x_headers
                unit = x_unit[i] if isinstance(x_unit, list) else x_unit
                if i == 0:
                    dataset.add_samples(
                        x_source, {"partition": "train"}, headers=headers, header_unit=unit
                    )
                else:
                    dataset.add_samples(
                        x_source, {"partition": "train"}, headers=headers, header_unit=unit
                    )
        else:
            dataset.add_samples(
                x, {"partition": "train"}, headers=x_headers, header_unit=x_unit
            )

        # Add targets if available
        if y is not None and len(y) > 0 and y.shape[1] > 0:
            dataset.add_targets(y)

        # Add metadata if available
        if m is not None and len(m) > 0:
            dataset.add_metadata(m, headers=m_headers)

        # Cache the dataset
        _dataset_cache[dataset_id] = dataset

        return dataset

    except Exception as e:
        print(f"Error loading dataset {dataset_id}: {e}")
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
):
    """
    Get raw spectra data from a dataset.

    Returns spectral data as a 2D array with wavelength headers.
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

        # Get headers (wavelengths)
        try:
            headers = dataset.headers(source)
        except Exception:
            headers = [str(i) for i in range(X.shape[1])]

        # Get header unit
        try:
            header_unit = dataset.header_unit(source)
        except Exception:
            header_unit = "unknown"

        return {
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


@router.post("/spectra/{dataset_id}/outliers")
async def detect_outliers(dataset_id: str, request: OutlierRequest):
    """
    Detect outliers in spectral data.

    Supports multiple outlier detection methods:
    - isolation_forest: Isolation Forest algorithm
    - local_outlier_factor: Local Outlier Factor
    - elliptic_envelope: Elliptic Envelope (Mahalanobis distance)
    - hotelling_t2: Hotelling's T² statistic
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="nirs4all library not available for outlier detection"
        )

    dataset = _load_dataset(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found or could not be loaded")

    try:
        selector = {"partition": request.partition}
        X = dataset.x(selector, layout="2d")

        if isinstance(X, list):
            X = X[0]

        outlier_mask = np.zeros(X.shape[0], dtype=bool)
        scores = np.zeros(X.shape[0])

        if request.method == "isolation_forest":
            from sklearn.ensemble import IsolationForest

            contamination = request.params.get("contamination", 0.1)
            clf = IsolationForest(contamination=contamination, random_state=42)
            predictions = clf.fit_predict(X)
            outlier_mask = predictions == -1
            scores = -clf.decision_function(X)  # Higher score = more outlier-like

        elif request.method == "local_outlier_factor":
            from sklearn.neighbors import LocalOutlierFactor

            n_neighbors = request.params.get("n_neighbors", 20)
            contamination = request.params.get("contamination", 0.1)
            clf = LocalOutlierFactor(n_neighbors=n_neighbors, contamination=contamination)
            predictions = clf.fit_predict(X)
            outlier_mask = predictions == -1
            scores = -clf.negative_outlier_factor_

        elif request.method == "elliptic_envelope":
            from sklearn.covariance import EllipticEnvelope

            contamination = request.params.get("contamination", 0.1)
            clf = EllipticEnvelope(contamination=contamination, random_state=42)
            predictions = clf.fit_predict(X)
            outlier_mask = predictions == -1
            scores = -clf.decision_function(X)

        elif request.method == "hotelling_t2":
            # Hotelling's T² using PCA
            from sklearn.decomposition import PCA

            n_components = request.params.get("n_components", min(10, X.shape[1], X.shape[0]))
            threshold = request.params.get("threshold", 0.95)

            pca = PCA(n_components=n_components)
            X_pca = pca.fit_transform(X)

            # Compute T² statistic
            mean = np.mean(X_pca, axis=0)
            cov_inv = np.linalg.pinv(np.cov(X_pca.T))
            t2_scores = np.array(
                [
                    (x - mean).T @ cov_inv @ (x - mean)
                    for x in X_pca
                ]
            )
            scores = t2_scores

            # Determine threshold using chi-squared distribution
            from scipy import stats

            chi2_threshold = stats.chi2.ppf(threshold, df=n_components)
            outlier_mask = t2_scores > chi2_threshold

        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown outlier detection method: {request.method}. "
                "Supported: isolation_forest, local_outlier_factor, elliptic_envelope, hotelling_t2",
            )

        outlier_indices = np.where(outlier_mask)[0].tolist()

        return {
            "dataset_id": dataset_id,
            "partition": request.partition,
            "method": request.method,
            "params": request.params,
            "total_samples": X.shape[0],
            "num_outliers": int(outlier_mask.sum()),
            "outlier_indices": outlier_indices,
            "scores": scores.tolist(),
            "outlier_mask": outlier_mask.tolist(),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to detect outliers: {str(e)}")


def _apply_preprocessing_chain(X: np.ndarray, chain: List[Dict[str, Any]]) -> np.ndarray:
    """Apply a chain of preprocessing steps to spectral data."""
    if not NIRS4ALL_AVAILABLE:
        return X

    try:
        from nirs4all.operators import transforms

        for step in chain:
            name = step.get("name", "")
            params = step.get("params", {})

            # Map common names to nirs4all transformers
            transformer_map = {
                "snv": transforms.StandardNormalVariate,
                "standardnormalvariate": transforms.StandardNormalVariate,
                "msc": transforms.MultiplicativeScatterCorrection,
                "savitzkygolay": transforms.SavitzkyGolay,
                "savgol": transforms.SavitzkyGolay,
                "firstderivative": transforms.FirstDerivative,
                "secondderivative": transforms.SecondDerivative,
                "detrend": transforms.Detrend,
                "gaussian": transforms.Gaussian,
                "baseline": transforms.Baseline,
                "normalize": transforms.Normalize,
                "logtransform": transforms.LogTransform,
            }

            # Also try sklearn transformers
            sklearn_map = {
                "standardscaler": "sklearn.preprocessing.StandardScaler",
                "minmaxscaler": "sklearn.preprocessing.MinMaxScaler",
                "robustscaler": "sklearn.preprocessing.RobustScaler",
            }

            name_lower = name.lower().replace("_", "").replace("-", "")

            if name_lower in transformer_map:
                transformer_cls = transformer_map[name_lower]
                transformer = transformer_cls(**params)
                X = transformer.fit_transform(X)
            elif name_lower in sklearn_map:
                import importlib

                module_path, class_name = sklearn_map[name_lower].rsplit(".", 1)
                module = importlib.import_module(module_path)
                transformer_cls = getattr(module, class_name)
                transformer = transformer_cls(**params)
                X = transformer.fit_transform(X)
            else:
                # Try to find transformer by name in nirs4all.operators.transforms
                transformer_cls = getattr(transforms, name, None)
                if transformer_cls:
                    transformer = transformer_cls(**params)
                    X = transformer.fit_transform(X)
                else:
                    print(f"Warning: Unknown preprocessing step '{name}', skipping")

    except Exception as e:
        print(f"Error applying preprocessing chain: {e}")

    return X
