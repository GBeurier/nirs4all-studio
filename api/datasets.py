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


# ============= Wizard Models =============


class DetectedFile(BaseModel):
    """Detected file info from folder scanning."""

    path: str
    filename: str
    type: str = Field("unknown", description="File role: X, Y, metadata, unknown")
    split: str = Field("unknown", description="Data split: train, test, unknown")
    source: Optional[int] = None
    format: str = Field("csv", description="File format")
    size_bytes: int = 0
    confidence: float = 0.0
    detected: bool = True


class DetectFilesRequest(BaseModel):
    """Request to detect files in a folder."""

    path: str = Field(..., description="Folder path to scan")
    recursive: bool = Field(False, description="Scan subdirectories")


class DetectFilesResponse(BaseModel):
    """Response from file detection."""

    files: List[DetectedFile]
    folder_name: str
    total_size_bytes: int
    has_standard_structure: bool


class DetectFormatRequest(BaseModel):
    """Request to detect file format."""

    path: str = Field(..., description="File path to analyze")
    sample_rows: int = Field(10, description="Number of rows to sample")


class DetectFormatResponse(BaseModel):
    """Response from format detection."""

    format: str
    detected_delimiter: Optional[str] = None
    detected_decimal: Optional[str] = None
    has_header: Optional[bool] = None
    num_rows: Optional[int] = None
    num_columns: Optional[int] = None
    sample_data: Optional[List[List[str]]] = None
    column_names: Optional[List[str]] = None
    sheet_names: Optional[List[str]] = None


class DatasetFileConfig(BaseModel):
    """File configuration for wizard."""

    path: str
    type: str
    split: str
    source: Optional[int] = None
    overrides: Optional[Dict[str, Any]] = None


class ParsingOptions(BaseModel):
    """Parsing options."""

    delimiter: str = ";"
    decimal_separator: str = "."
    has_header: bool = True
    header_unit: str = "cm-1"
    signal_type: str = "auto"
    na_policy: str = "drop"
    skip_rows: int = 0
    sheet_name: Optional[str] = None


class PreviewDataRequest(BaseModel):
    """Request to preview dataset."""

    path: str = Field(..., description="Base path")
    files: List[DatasetFileConfig] = Field(..., description="File configurations")
    parsing: ParsingOptions = Field(default_factory=ParsingOptions)
    max_samples: int = Field(100, description="Max samples to preview")


class PreviewDataResponse(BaseModel):
    """Response from dataset preview."""

    success: bool
    error: Optional[str] = None
    summary: Optional[Dict[str, Any]] = None
    spectra_preview: Optional[Dict[str, Any]] = None
    target_distribution: Optional[Dict[str, Any]] = None


# ============= Wizard Endpoints =============


@router.post("/datasets/detect-files", response_model=DetectFilesResponse)
async def detect_files(request: DetectFilesRequest):
    """Scan a folder and detect dataset files."""
    try:
        folder_path = Path(request.path)

        if not folder_path.exists():
            raise HTTPException(status_code=404, detail="Folder not found")

        if not folder_path.is_dir():
            raise HTTPException(status_code=400, detail="Path is not a directory")

        # Patterns for detecting file types
        # Note: check filename prefix patterns (xcal, xval, ycal, yval) as well as embedded patterns
        x_patterns = ["x_", "_x", "spectra", "nir", "absorbance", "reflectance"]
        y_patterns = ["y_", "_y", "target", "analyte", "reference"]
        meta_patterns = ["m_", "_m", "meta", "group", "info"]
        train_patterns = ["train", "calibration", "cal"]
        test_patterns = ["test", "val", "validation", "prediction", "pred"]

        files: List[DetectedFile] = []
        total_size = 0

        # Supported extensions (including compressed versions)
        extensions = {".csv", ".xlsx", ".xls", ".parquet", ".npy", ".npz", ".mat"}
        compressed_extensions = {".gz", ".bz2", ".xz", ".zip"}

        # Scan folder
        glob_pattern = "**/*" if request.recursive else "*"
        for file_path in folder_path.glob(glob_pattern):
            if not file_path.is_file():
                continue

            # Handle compressed files (e.g., .csv.gz)
            suffix = file_path.suffix.lower()
            if suffix in compressed_extensions:
                # Get the real extension (e.g., .csv from file.csv.gz)
                stem = file_path.stem
                actual_suffix = Path(stem).suffix.lower()
                if actual_suffix and actual_suffix in extensions:
                    suffix = actual_suffix
                else:
                    continue
            elif suffix not in extensions:
                continue

            filename = file_path.name.lower()
            size = file_path.stat().st_size
            total_size += size

            # Get filename stem without all extensions (e.g., "xcal" from "Xcal.csv.gz")
            # We need to use the original suffix since it may have been changed above
            original_suffix = file_path.suffix.lower()
            stem = file_path.stem
            if original_suffix in compressed_extensions:
                stem = Path(stem).stem  # Remove inner extension too
            stem_lower = stem.lower()

            # Detect type
            file_type = "unknown"
            confidence = 0.3

            # Check for X prefix (xcal, xval, x_train, etc.)
            if stem_lower.startswith("x") and len(stem_lower) > 1 and not stem_lower[1].isalpha():
                file_type = "X"
                confidence = 0.95
            elif stem_lower.startswith("x") and len(stem_lower) > 1:
                # Check if second part is a known suffix (xcal, xval, xtrain, etc.)
                rest = stem_lower[1:]
                if any(p in rest for p in ["cal", "val", "train", "test"]):
                    file_type = "X"
                    confidence = 0.95

            # Check for Y prefix (ycal, yval, y_train, etc.)
            if file_type == "unknown":
                if stem_lower.startswith("y") and len(stem_lower) > 1 and not stem_lower[1].isalpha():
                    file_type = "Y"
                    confidence = 0.95
                elif stem_lower.startswith("y") and len(stem_lower) > 1:
                    rest = stem_lower[1:]
                    if any(p in rest for p in ["cal", "val", "train", "test"]):
                        file_type = "Y"
                        confidence = 0.95

            # Check embedded patterns
            if file_type == "unknown":
                for pattern in x_patterns:
                    if pattern in filename:
                        file_type = "X"
                        confidence = 0.9
                        break

            if file_type == "unknown":
                for pattern in y_patterns:
                    if pattern in filename:
                        file_type = "Y"
                        confidence = 0.9
                        break

            if file_type == "unknown":
                for pattern in meta_patterns:
                    if pattern in filename:
                        file_type = "metadata"
                        confidence = 0.8
                        break

            # Detect split
            split = "unknown"
            for pattern in train_patterns:
                if pattern in filename:
                    split = "train"
                    break

            if split == "unknown":
                for pattern in test_patterns:
                    if pattern in filename:
                        split = "test"
                        break

            # Default to train if unknown
            if split == "unknown":
                split = "train"

            # Detect source number for X files
            source = None
            if file_type == "X":
                import re
                source_match = re.search(r"(?:source|src|s)[\s_-]*(\d+)", filename)
                source = int(source_match.group(1)) if source_match else 1

            # Detect format
            format_map = {
                ".csv": "csv",
                ".xlsx": "xlsx",
                ".xls": "xls",
                ".parquet": "parquet",
                ".npy": "npy",
                ".npz": "npz",
                ".mat": "mat",
            }

            files.append(DetectedFile(
                path=str(file_path),
                filename=file_path.name,
                type=file_type,
                split=split,
                source=source,
                format=format_map.get(suffix, "csv"),
                size_bytes=size,
                confidence=confidence,
                detected=True,
            ))

        # Check if folder has standard structure
        has_x = any(f.type == "X" for f in files)
        has_train = any(f.split == "train" for f in files)
        has_standard_structure = has_x and has_train

        return DetectFilesResponse(
            files=files,
            folder_name=folder_path.name,
            total_size_bytes=total_size,
            has_standard_structure=has_standard_structure,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to detect files: {str(e)}"
        )


@router.post("/datasets/detect-format", response_model=DetectFormatResponse)
async def detect_format(request: DetectFormatRequest):
    """Detect file format (delimiter, decimal, header, etc.)."""
    try:
        file_path = Path(request.path)

        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File not found")

        suffix = file_path.suffix.lower()

        # Excel files
        if suffix in (".xlsx", ".xls"):
            try:
                import pandas as pd
                xl = pd.ExcelFile(file_path)
                df = pd.read_excel(xl, sheet_name=0, nrows=request.sample_rows)

                return DetectFormatResponse(
                    format="xlsx" if suffix == ".xlsx" else "xls",
                    has_header=True,
                    num_rows=len(df),
                    num_columns=len(df.columns),
                    sample_data=[df.columns.tolist()] + df.astype(str).values.tolist()[:5],
                    column_names=df.columns.tolist(),
                    sheet_names=xl.sheet_names,
                )
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to read Excel file: {e}")

        # Parquet files
        if suffix == ".parquet":
            try:
                import pandas as pd
                df = pd.read_parquet(file_path)[:request.sample_rows]

                return DetectFormatResponse(
                    format="parquet",
                    has_header=True,
                    num_rows=len(df),
                    num_columns=len(df.columns),
                    sample_data=[df.columns.tolist()] + df.astype(str).values.tolist()[:5],
                    column_names=df.columns.tolist(),
                )
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to read Parquet file: {e}")

        # NumPy files
        if suffix in (".npy", ".npz"):
            try:
                data = np.load(file_path, allow_pickle=True)
                if suffix == ".npz":
                    keys = list(data.keys())
                    arr = data[keys[0]]
                else:
                    arr = data

                return DetectFormatResponse(
                    format="npz" if suffix == ".npz" else "npy",
                    has_header=False,
                    num_rows=arr.shape[0] if arr.ndim > 0 else 1,
                    num_columns=arr.shape[1] if arr.ndim > 1 else 1,
                )
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to read NumPy file: {e}")

        # CSV files - detect delimiter and decimal
        try:
            # Read raw content
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                lines = [f.readline() for _ in range(min(20, request.sample_rows + 5))]

            content = "".join(lines)

            # Detect delimiter
            delimiters = [";", ",", "\t", "|", " "]
            delimiter_counts = {d: content.count(d) for d in delimiters}
            detected_delimiter = max(delimiter_counts, key=delimiter_counts.get)

            # Detect decimal separator
            # If comma is delimiter, decimal is likely dot
            # If semicolon is delimiter, check for comma as decimal
            detected_decimal = "."
            if detected_delimiter == ";":
                # Check if numbers have comma as decimal
                import re
                comma_decimal_pattern = r"\d+,\d+"
                if re.search(comma_decimal_pattern, content):
                    detected_decimal = ","

            # Try to detect header
            first_line = lines[0].strip().split(detected_delimiter)
            has_header = True
            try:
                # If first line has mostly non-numeric values, it's likely a header
                numeric_count = sum(1 for v in first_line if v.replace(".", "").replace(",", "").replace("-", "").isdigit())
                has_header = numeric_count < len(first_line) / 2
            except Exception:
                pass

            # Parse with detected settings
            import pandas as pd
            df = pd.read_csv(
                file_path,
                sep=detected_delimiter,
                decimal=detected_decimal,
                nrows=request.sample_rows,
                header=0 if has_header else None,
            )

            return DetectFormatResponse(
                format="csv",
                detected_delimiter=detected_delimiter,
                detected_decimal=detected_decimal,
                has_header=has_header,
                num_rows=len(df),
                num_columns=len(df.columns),
                sample_data=[
                    [str(c) for c in df.columns.tolist()]
                ] + df.astype(str).values.tolist()[:5],
                column_names=[str(c) for c in df.columns.tolist()],
            )

        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read CSV file: {e}")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to detect format: {str(e)}"
        )


@router.post("/datasets/preview", response_model=PreviewDataResponse)
async def preview_dataset(request: PreviewDataRequest):
    """Preview a dataset with current configuration."""
    if not NIRS4ALL_AVAILABLE:
        return PreviewDataResponse(
            success=False,
            error="nirs4all library not available",
        )

    try:
        # Build config for nirs4all
        # Note: signal_type and header_unit are X-specific params
        # They should not be included in global_params to avoid passing them to Y loading
        global_params = {
            "delimiter": request.parsing.delimiter,
            "decimal_separator": request.parsing.decimal_separator,
            "has_header": request.parsing.has_header,
        }

        # X-specific params (signal_type, header_unit)
        x_specific_params = {}
        if request.parsing.header_unit:
            x_specific_params["header_unit"] = request.parsing.header_unit
        if request.parsing.signal_type and request.parsing.signal_type != "auto":
            x_specific_params["signal_type"] = request.parsing.signal_type

        config: Dict[str, Any] = {
            "global_params": global_params
        }

        # Map files to config
        for file_config in request.files:
            file_key = None
            if file_config.type == "X":
                file_key = f"{file_config.split}_x"
            elif file_config.type == "Y":
                file_key = f"{file_config.split}_y"
            elif file_config.type == "metadata":
                file_key = f"{file_config.split}_group"

            if file_key:
                # Handle multi-source (list of X files for same split)
                if file_key in config and file_config.type == "X":
                    existing = config[file_key]
                    if isinstance(existing, list):
                        config[file_key].append(file_config.path)
                    else:
                        config[file_key] = [existing, file_config.path]
                else:
                    config[file_key] = file_config.path

                # Per-file params (merge with x_specific_params for X files)
                params_key = f"{file_key}_params"
                if file_config.type == "X" and x_specific_params:
                    # Add x-specific params to X file params
                    if file_config.overrides:
                        config[params_key] = {**x_specific_params, **file_config.overrides}
                    else:
                        config[params_key] = x_specific_params.copy()
                elif file_config.overrides:
                    config[params_key] = file_config.overrides

        # Try to load with nirs4all
        try:
            from nirs4all.data import DatasetConfigs

            dataset_configs = DatasetConfigs(config)
            datasets = dataset_configs.get_datasets()

            if not datasets:
                return PreviewDataResponse(
                    success=False,
                    error="No data could be loaded from the provided files",
                )

            dataset = datasets[0]

            # Get X data for spectra preview
            X = dataset.x({"partition": "train"}, layout="2d")
            if isinstance(X, list):
                X = X[0]

            # Limit samples for preview
            if len(X) > request.max_samples:
                indices = np.linspace(0, len(X) - 1, request.max_samples, dtype=int)
                X = X[indices]

            # Get wavelengths/headers
            try:
                wavelengths = dataset.headers(0)
                if wavelengths is None or len(wavelengths) == 0:
                    wavelengths = np.arange(X.shape[1])
                wavelengths = np.array(wavelengths, dtype=float)
            except Exception:
                wavelengths = np.arange(X.shape[1])

            # Spectra statistics
            mean_spectrum = np.mean(X, axis=0).tolist()
            std_spectrum = np.std(X, axis=0).tolist()
            min_spectrum = np.min(X, axis=0).tolist()
            max_spectrum = np.max(X, axis=0).tolist()

            # Sample spectra (first 5)
            sample_spectra = X[:5].tolist() if len(X) >= 5 else X.tolist()

            spectra_preview = {
                "wavelengths": wavelengths.tolist(),
                "mean_spectrum": mean_spectrum,
                "std_spectrum": std_spectrum,
                "min_spectrum": min_spectrum,
                "max_spectrum": max_spectrum,
                "sample_spectra": sample_spectra,
            }

            # Target distribution
            target_distribution = None
            try:
                y = dataset.y({"partition": "train"})
                if y is not None and len(y) > 0:
                    if dataset.is_regression:
                        # Histogram for regression
                        hist, bin_edges = np.histogram(y, bins=20)
                        histogram = [
                            {"bin": float(bin_edges[i]), "count": int(hist[i])}
                            for i in range(len(hist))
                        ]
                        target_distribution = {
                            "type": "regression",
                            "min": float(np.min(y)),
                            "max": float(np.max(y)),
                            "mean": float(np.mean(y)),
                            "std": float(np.std(y)),
                            "histogram": histogram,
                        }
                    else:
                        # Class counts for classification
                        unique, counts = np.unique(y, return_counts=True)
                        target_distribution = {
                            "type": "classification",
                            "classes": [str(c) for c in unique.tolist()],
                            "class_counts": {str(k): int(v) for k, v in zip(unique.tolist(), counts.tolist())},
                        }
            except Exception:
                pass

            # Get metadata columns
            metadata_columns = []
            try:
                metadata_columns = dataset.metadata_columns or []
            except Exception:
                pass

            # Signal type
            signal_type = None
            try:
                if dataset.signal_types:
                    signal_type = dataset.signal_types[0].value
            except Exception:
                pass

            # Header unit
            header_unit = None
            try:
                header_unit = dataset.header_unit(0)
            except Exception:
                pass

            # Train/test sample counts
            train_samples = 0
            test_samples = 0
            try:
                train_x = dataset.x({"partition": "train"}, layout="2d")
                if isinstance(train_x, list):
                    train_x = train_x[0]
                train_samples = len(train_x) if train_x is not None else 0
            except Exception:
                pass

            try:
                test_x = dataset.x({"partition": "test"}, layout="2d")
                if isinstance(test_x, list):
                    test_x = test_x[0]
                test_samples = len(test_x) if test_x is not None else 0
            except Exception:
                pass

            summary = {
                "num_samples": dataset.num_samples,
                "num_features": dataset.num_features,
                "n_sources": dataset.n_sources,
                "train_samples": train_samples,
                "test_samples": test_samples,
                "has_targets": dataset._targets is not None,
                "has_metadata": dataset._metadata.num_rows > 0 if dataset._metadata else False,
                "target_columns": metadata_columns if dataset._targets else None,
                "metadata_columns": metadata_columns,
                "signal_type": signal_type,
                "header_unit": header_unit,
            }

            return PreviewDataResponse(
                success=True,
                summary=summary,
                spectra_preview=spectra_preview,
                target_distribution=target_distribution,
            )

        except Exception as e:
            return PreviewDataResponse(
                success=False,
                error=f"Failed to load dataset: {str(e)}",
            )

    except Exception as e:
        return PreviewDataResponse(
            success=False,
            error=f"Preview failed: {str(e)}",
        )


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
