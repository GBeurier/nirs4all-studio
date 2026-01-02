"""
Datasets API routes for nirs4all webapp.

This module provides FastAPI routes for dataset operations including:
- Listing, loading, and managing datasets
- Dataset info and statistics
- Dataset export, split, filter, and merge operations
"""

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import numpy as np
from fastapi import APIRouter, HTTPException, Query, UploadFile, File
from pydantic import BaseModel, Field

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
    print(f"Note: nirs4all not available for datasets API: {e}")
    NIRS4ALL_AVAILABLE = False


router = APIRouter()


class DatasetConfig(BaseModel):
    """Configuration for loading a dataset."""

    delimiter: str = ","
    decimal_separator: str = "."
    has_header: bool = True
    header_unit: str = "cm-1"
    signal_type: Optional[str] = None
    y_columns: Optional[List[int]] = None
    metadata_columns: Optional[List[int]] = None


class DatasetUploadConfig(BaseModel):
    """Configuration for uploading a dataset."""

    name: str
    config: DatasetConfig = DatasetConfig()


class SplitConfig(BaseModel):
    """Configuration for splitting a dataset."""

    method: str = Field("random", description="Split method: random, stratified, kennard_stone, spxy")
    test_size: float = Field(0.2, ge=0.05, le=0.5, description="Proportion of data for test set")
    random_state: Optional[int] = Field(42, description="Random seed for reproducibility")
    n_bins: int = Field(10, ge=2, le=100, description="Number of bins for stratified split")


class FilterConfig(BaseModel):
    """Configuration for filtering samples."""

    column: Optional[str] = Field(None, description="Metadata column to filter on")
    values: Optional[List[Any]] = Field(None, description="Values to keep")
    indices: Optional[List[int]] = Field(None, description="Specific indices to keep")
    exclude_outliers: bool = Field(False, description="Exclude detected outliers")
    outlier_method: str = Field("isolation_forest", description="Outlier detection method")


class MergeConfig(BaseModel):
    """Configuration for merging datasets."""

    dataset_ids: List[str] = Field(..., description="IDs of datasets to merge")
    name: str = Field(..., description="Name for merged dataset")
    merge_axis: str = Field("samples", description="Merge along 'samples' or 'features'")


class ExportConfig(BaseModel):
    """Configuration for exporting a dataset."""

    format: str = Field("csv", description="Export format: csv, excel, parquet, npz")
    include_metadata: bool = True
    include_targets: bool = True
    partition: Optional[str] = None


# ============= Dataset CRUD Operations =============


@router.get("/datasets")
async def list_datasets():
    """List all datasets in the current workspace."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            return {"datasets": [], "total": 0}

        datasets = []
        for ds in workspace.datasets:
            # Add computed fields if not present
            dataset_info = dict(ds)
            if "status" not in dataset_info:
                # Check if dataset is still accessible
                path = Path(ds.get("path", ""))
                dataset_info["status"] = "available" if path.exists() else "missing"

            datasets.append(dataset_info)

        return {"datasets": datasets, "total": len(datasets)}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to list datasets: {str(e)}"
        )


@router.get("/datasets/{dataset_id}")
async def get_dataset(dataset_id: str):
    """Get detailed information about a specific dataset."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        dataset = next(
            (d for d in workspace.datasets if d.get("id") == dataset_id), None
        )
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Try to load additional info from the actual dataset
        extended_info = dict(dataset)

        if NIRS4ALL_AVAILABLE:
            try:
                from .spectra import _load_dataset

                ds = _load_dataset(dataset_id)
                if ds:
                    extended_info.update({
                        "num_samples": ds.num_samples,
                        "num_features": ds.num_features,
                        "n_sources": ds.n_sources,
                        "is_multi_source": ds.is_multi_source(),
                        "task_type": str(ds.task_type) if ds.task_type else None,
                        "num_classes": ds.num_classes if ds.is_classification else None,
                        "has_targets": ds._targets is not None,
                        "has_metadata": ds._metadata.num_rows > 0 if ds._metadata else False,
                        "metadata_columns": ds.metadata_columns if ds._metadata else [],
                        "signal_types": [st.value for st in ds.signal_types] if ds.signal_types else [],
                        "num_folds": ds.num_folds,
                    })
            except Exception as e:
                extended_info["load_warning"] = str(e)

        return {"dataset": extended_info}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get dataset: {str(e)}"
        )


@router.post("/datasets/{dataset_id}/load")
async def load_dataset(dataset_id: str, config: Optional[DatasetConfig] = None):
    """
    Load a dataset into memory with specified configuration.

    Returns dataset summary after loading.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="nirs4all library not available"
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    dataset_info = next(
        (d for d in workspace.datasets if d.get("id") == dataset_id), None
    )
    if not dataset_info:
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        from .spectra import _load_dataset, _clear_dataset_cache

        # Clear cache to force reload with new config
        _clear_dataset_cache(dataset_id)

        # Update config in workspace if provided
        if config:
            dataset_info["config"] = config.model_dump()
            workspace_manager._save_workspace_config()

        # Load the dataset
        ds = _load_dataset(dataset_id)
        if not ds:
            raise HTTPException(
                status_code=500, detail="Failed to load dataset"
            )

        return {
            "success": True,
            "dataset_id": dataset_id,
            "summary": {
                "name": ds.name,
                "num_samples": ds.num_samples,
                "num_features": ds.num_features,
                "n_sources": ds.n_sources,
                "task_type": str(ds.task_type) if ds.task_type else None,
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to load dataset: {str(e)}"
        )


@router.delete("/datasets/{dataset_id}")
async def delete_dataset(dataset_id: str, delete_files: bool = False):
    """
    Remove a dataset from the workspace.

    By default, only removes the reference. Set delete_files=True to also delete files.
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        dataset = next(
            (d for d in workspace.datasets if d.get("id") == dataset_id), None
        )
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Clear from cache
        try:
            from .spectra import _clear_dataset_cache

            _clear_dataset_cache(dataset_id)
        except Exception:
            pass

        # Optionally delete files
        if delete_files:
            path = Path(dataset.get("path", ""))
            if path.exists():
                if path.is_dir():
                    import shutil

                    shutil.rmtree(path)
                else:
                    path.unlink()

        # Remove from workspace
        success = workspace_manager.unlink_dataset(dataset_id)
        if not success:
            raise HTTPException(status_code=404, detail="Dataset not found in workspace")

        return {
            "success": True,
            "message": f"Dataset {dataset_id} removed" + (" (files deleted)" if delete_files else ""),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete dataset: {str(e)}"
        )


# ============= Dataset Statistics =============


@router.get("/datasets/{dataset_id}/stats")
async def get_dataset_stats(dataset_id: str, partition: str = "train"):
    """Get comprehensive statistics for a dataset."""
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="nirs4all library not available"
        )

    try:
        from .spectra import _load_dataset

        dataset = _load_dataset(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found or could not be loaded")

        selector = {"partition": partition}
        X = dataset.x(selector, layout="2d")

        if isinstance(X, list):
            X = X[0]

        # Feature statistics
        feature_stats = {
            "mean": np.mean(X, axis=0).tolist(),
            "std": np.std(X, axis=0).tolist(),
            "min": np.min(X, axis=0).tolist(),
            "max": np.max(X, axis=0).tolist(),
            "median": np.median(X, axis=0).tolist(),
        }

        # Global statistics
        global_stats = {
            "num_samples": X.shape[0],
            "num_features": X.shape[1],
            "global_mean": float(np.mean(X)),
            "global_std": float(np.std(X)),
            "global_min": float(np.min(X)),
            "global_max": float(np.max(X)),
        }

        # Target statistics
        target_stats = None
        try:
            y = dataset.y(selector)
            if y is not None and len(y) > 0:
                if dataset.is_regression:
                    target_stats = {
                        "type": "regression",
                        "mean": float(np.mean(y)),
                        "std": float(np.std(y)),
                        "min": float(np.min(y)),
                        "max": float(np.max(y)),
                        "median": float(np.median(y)),
                    }
                elif dataset.is_classification:
                    unique, counts = np.unique(y, return_counts=True)
                    target_stats = {
                        "type": "classification",
                        "num_classes": len(unique),
                        "classes": unique.tolist(),
                        "class_counts": dict(zip(unique.tolist(), counts.tolist())),
                    }
        except Exception:
            pass

        return {
            "dataset_id": dataset_id,
            "partition": partition,
            "global": global_stats,
            "features": feature_stats,
            "targets": target_stats,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to compute statistics: {str(e)}"
        )


# ============= Dataset Operations =============


@router.post("/datasets/{dataset_id}/split")
async def split_dataset(dataset_id: str, config: SplitConfig):
    """
    Split a dataset into train/test partitions.

    Supports multiple split methods:
    - random: Random split
    - stratified: Stratified split based on target distribution
    - kennard_stone: Kennard-Stone algorithm for uniform feature space coverage
    - spxy: Sample set Partitioning based on X and Y
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="nirs4all library not available"
        )

    try:
        from .spectra import _load_dataset

        dataset = _load_dataset(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        X = dataset.x({"partition": "train"}, layout="2d")
        if isinstance(X, list):
            X = X[0]

        y = None
        try:
            y = dataset.y({"partition": "train"})
        except Exception:
            pass

        n_samples = X.shape[0]

        if config.method == "random":
            from sklearn.model_selection import train_test_split

            indices = np.arange(n_samples)
            train_idx, test_idx = train_test_split(
                indices,
                test_size=config.test_size,
                random_state=config.random_state,
            )

        elif config.method == "stratified":
            if y is None:
                raise HTTPException(
                    status_code=400,
                    detail="Stratified split requires target values",
                )
            from nirs4all.operators.splitters import KBinsStratifiedSplitter

            splitter = KBinsStratifiedSplitter(
                test_size=config.test_size,
                random_state=config.random_state,
                n_bins=config.n_bins,
            )
            train_idx, test_idx = next(splitter.split(X, y.reshape(-1, 1) if y.ndim == 1 else y))

        elif config.method == "kennard_stone":
            from nirs4all.operators.splitters import KennardStoneSplitter

            splitter = KennardStoneSplitter(
                test_size=config.test_size,
                random_state=config.random_state,
            )
            train_idx, test_idx = next(splitter.split(X))

        elif config.method == "spxy":
            if y is None:
                raise HTTPException(
                    status_code=400,
                    detail="SPXY split requires target values",
                )
            from nirs4all.operators.splitters import SPXYSplitter

            splitter = SPXYSplitter(
                test_size=config.test_size,
                random_state=config.random_state,
            )
            train_idx, test_idx = next(splitter.split(X, y.reshape(-1, 1) if y.ndim == 1 else y))

        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown split method: {config.method}. "
                "Supported: random, stratified, kennard_stone, spxy",
            )

        return {
            "success": True,
            "dataset_id": dataset_id,
            "method": config.method,
            "train_indices": train_idx.tolist(),
            "test_indices": test_idx.tolist(),
            "train_size": len(train_idx),
            "test_size": len(test_idx),
            "train_ratio": len(train_idx) / n_samples,
            "test_ratio": len(test_idx) / n_samples,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to split dataset: {str(e)}"
        )


@router.post("/datasets/{dataset_id}/filter")
async def filter_dataset(dataset_id: str, config: FilterConfig):
    """
    Filter samples from a dataset based on criteria.

    Can filter by:
    - Metadata column values
    - Specific indices
    - Outlier exclusion
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="nirs4all library not available"
        )

    try:
        from .spectra import _load_dataset

        dataset = _load_dataset(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        X = dataset.x({"partition": "train"}, layout="2d")
        if isinstance(X, list):
            X = X[0]

        n_samples = X.shape[0]
        keep_mask = np.ones(n_samples, dtype=bool)

        # Filter by indices
        if config.indices:
            keep_mask[:] = False
            valid_indices = [i for i in config.indices if 0 <= i < n_samples]
            keep_mask[valid_indices] = True

        # Filter by metadata column
        if config.column and config.values:
            try:
                meta = dataset.metadata_column(config.column, {"partition": "train"})
                value_mask = np.isin(meta, config.values)
                keep_mask &= value_mask
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Error filtering by column '{config.column}': {str(e)}",
                )

        # Exclude outliers
        if config.exclude_outliers:
            from .spectra import OutlierRequest, detect_outliers

            outlier_result = await detect_outliers(
                dataset_id,
                OutlierRequest(method=config.outlier_method, partition="train"),
            )
            outlier_mask = np.array(outlier_result["outlier_mask"])
            keep_mask &= ~outlier_mask

        keep_indices = np.where(keep_mask)[0]

        return {
            "success": True,
            "dataset_id": dataset_id,
            "original_samples": n_samples,
            "filtered_samples": int(keep_mask.sum()),
            "removed_samples": int((~keep_mask).sum()),
            "keep_indices": keep_indices.tolist(),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to filter dataset: {str(e)}"
        )


@router.post("/datasets/merge")
async def merge_datasets(config: MergeConfig):
    """
    Merge multiple datasets into one.

    Can merge along samples (vertical stack) or features (horizontal stack).
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="nirs4all library not available"
        )

    if len(config.dataset_ids) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least 2 datasets required for merging",
        )

    try:
        from .spectra import _load_dataset

        datasets = []
        for ds_id in config.dataset_ids:
            ds = _load_dataset(ds_id)
            if not ds:
                raise HTTPException(
                    status_code=404,
                    detail=f"Dataset {ds_id} not found",
                )
            datasets.append(ds)

        # Get data from all datasets
        X_list = []
        y_list = []
        for ds in datasets:
            X = ds.x({"partition": "train"}, layout="2d")
            if isinstance(X, list):
                X = X[0]
            X_list.append(X)

            try:
                y = ds.y({"partition": "train"})
                y_list.append(y)
            except Exception:
                y_list.append(None)

        # Merge based on axis
        if config.merge_axis == "samples":
            # Check feature compatibility
            n_features = [x.shape[1] for x in X_list]
            if len(set(n_features)) > 1:
                raise HTTPException(
                    status_code=400,
                    detail=f"Datasets have different number of features: {n_features}. "
                    "Cannot merge along samples axis.",
                )
            X_merged = np.vstack(X_list)
            y_merged = np.concatenate([y for y in y_list if y is not None]) if all(y is not None for y in y_list) else None

        elif config.merge_axis == "features":
            # Check sample compatibility
            n_samples = [x.shape[0] for x in X_list]
            if len(set(n_samples)) > 1:
                raise HTTPException(
                    status_code=400,
                    detail=f"Datasets have different number of samples: {n_samples}. "
                    "Cannot merge along features axis.",
                )
            X_merged = np.hstack(X_list)
            y_merged = y_list[0]  # Use first dataset's targets

        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown merge_axis: {config.merge_axis}. Use 'samples' or 'features'.",
            )

        return {
            "success": True,
            "merged_name": config.name,
            "source_datasets": config.dataset_ids,
            "merge_axis": config.merge_axis,
            "merged_shape": list(X_merged.shape),
            "has_targets": y_merged is not None,
            "message": "Merge computed but not saved. Use dataset upload to persist.",
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to merge datasets: {str(e)}"
        )


@router.post("/datasets/{dataset_id}/export")
async def export_dataset(dataset_id: str, config: ExportConfig):
    """
    Export a dataset to a file format.

    Supports: csv, excel, parquet, npz
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="nirs4all library not available"
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    try:
        from .spectra import _load_dataset

        dataset = _load_dataset(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Get export directory
        export_dir = Path(workspace.path) / "exports"
        export_dir.mkdir(exist_ok=True)

        partition = config.partition or "train"
        selector = {"partition": partition}

        X = dataset.x(selector, layout="2d")
        if isinstance(X, list):
            X = X[0]

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        base_name = f"{dataset.name}_{partition}_{timestamp}"

        if config.format == "csv":
            import pandas as pd

            df = pd.DataFrame(X)
            df.columns = [f"feature_{i}" for i in range(X.shape[1])]

            if config.include_targets:
                try:
                    y = dataset.y(selector)
                    if y is not None:
                        df["target"] = y
                except Exception:
                    pass

            export_path = export_dir / f"{base_name}.csv"
            df.to_csv(export_path, index=False)

        elif config.format == "excel":
            import pandas as pd

            df = pd.DataFrame(X)
            df.columns = [f"feature_{i}" for i in range(X.shape[1])]

            if config.include_targets:
                try:
                    y = dataset.y(selector)
                    if y is not None:
                        df["target"] = y
                except Exception:
                    pass

            export_path = export_dir / f"{base_name}.xlsx"
            df.to_excel(export_path, index=False)

        elif config.format == "parquet":
            import pandas as pd

            df = pd.DataFrame(X)
            df.columns = [f"feature_{i}" for i in range(X.shape[1])]

            if config.include_targets:
                try:
                    y = dataset.y(selector)
                    if y is not None:
                        df["target"] = y
                except Exception:
                    pass

            export_path = export_dir / f"{base_name}.parquet"
            df.to_parquet(export_path, index=False)

        elif config.format == "npz":
            save_dict = {"X": X}

            if config.include_targets:
                try:
                    y = dataset.y(selector)
                    if y is not None:
                        save_dict["y"] = y
                except Exception:
                    pass

            export_path = export_dir / f"{base_name}.npz"
            np.savez(export_path, **save_dict)

        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown export format: {config.format}. "
                "Supported: csv, excel, parquet, npz",
            )

        return {
            "success": True,
            "dataset_id": dataset_id,
            "format": config.format,
            "export_path": str(export_path),
            "file_size": export_path.stat().st_size,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to export dataset: {str(e)}"
        )
