"""
Datasets API routes for nirs4all webapp.

This module provides FastAPI routes for dataset operations including:
- Listing, loading, and managing datasets
- Dataset info and statistics
- Dataset export, split, filter, and merge operations
- Phase 2: Dataset versioning and integrity (hash, verify, relink)
"""

import hashlib
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


# ============= Phase 2: Versioning & Integrity Models =============


class VerifyDatasetResponse(BaseModel):
    """Response from dataset verification."""

    success: bool
    dataset_id: str
    version_status: str = Field(description="current, modified, missing, or unchecked")
    current_hash: Optional[str] = None
    stored_hash: Optional[str] = None
    is_modified: bool = False
    change_summary: Optional[Dict[str, Any]] = None
    verified_at: str


class RefreshDatasetRequest(BaseModel):
    """Request to accept dataset changes."""

    accept_changes: bool = True


class RefreshDatasetResponse(BaseModel):
    """Response from dataset refresh."""

    success: bool
    dataset_id: str
    old_hash: Optional[str] = None
    new_hash: str
    version: int
    change_summary: Dict[str, Any]
    refreshed_at: str


class RelinkDatasetRequest(BaseModel):
    """Request to relink a dataset to a new path."""

    new_path: str = Field(..., description="New path to the dataset")
    force: bool = Field(False, description="Force relink even if structure doesn't match")


class RelinkDatasetResponse(BaseModel):
    """Response from dataset relink."""

    success: bool
    dataset_id: str
    old_path: str
    new_path: str
    validation: Dict[str, Any]
    new_hash: str
    relinked_at: str


# ============= Phase 3: Multi-Target Support Models =============


class TargetConfig(BaseModel):
    """Configuration for a single target column."""

    column: str = Field(..., description="Name of the target column")
    type: str = Field("regression", description="Task type: regression, binary_classification, multiclass_classification")
    unit: Optional[str] = Field(None, description="Unit of measurement (e.g., %, mg/L)")
    classes: Optional[List[str]] = Field(None, description="Class names for classification tasks")
    is_default: bool = Field(False, description="Whether this is the default target")
    label: Optional[str] = Field(None, description="Display label for the target")
    description: Optional[str] = Field(None, description="Description of the target")


class UpdateDatasetTargetsRequest(BaseModel):
    """Request to update dataset targets configuration."""

    targets: List[TargetConfig] = Field(..., description="List of target configurations")
    default_target: Optional[str] = Field(None, description="Column name of default target")


class UpdateDatasetTargetsResponse(BaseModel):
    """Response from updating dataset targets."""

    success: bool
    dataset_id: str
    targets: List[Dict[str, Any]]
    default_target: Optional[str]
    updated_at: str


# ============= Hash Computation Utilities =============


def compute_dataset_hash(dataset_path: Path) -> str:
    """
    Compute a SHA-256 hash of dataset files for integrity checking.

    Args:
        dataset_path: Path to dataset folder or file

    Returns:
        Short hash string (first 16 characters of SHA-256)
    """
    hasher = hashlib.sha256()

    if dataset_path.is_file():
        # Single file dataset
        hasher.update(dataset_path.read_bytes())
    elif dataset_path.is_dir():
        # Folder dataset - hash all relevant data files
        extensions = {".csv", ".xlsx", ".xls", ".parquet", ".npy", ".npz", ".mat"}
        compressed = {".gz", ".bz2", ".xz", ".zip"}

        for file in sorted(dataset_path.rglob("*")):
            if not file.is_file():
                continue

            suffix = file.suffix.lower()
            # Check for compressed extensions
            if suffix in compressed:
                inner_suffix = Path(file.stem).suffix.lower()
                if inner_suffix and inner_suffix in extensions:
                    hasher.update(file.read_bytes())
            elif suffix in extensions:
                hasher.update(file.read_bytes())

    return hasher.hexdigest()[:16]


def compute_dataset_stats(dataset_path: Path) -> Dict[str, Any]:
    """
    Compute basic statistics about a dataset for change detection.

    Returns file count, total size, and list of files.
    """
    stats = {
        "file_count": 0,
        "total_size_bytes": 0,
        "files": [],
    }

    extensions = {".csv", ".xlsx", ".xls", ".parquet", ".npy", ".npz", ".mat"}
    compressed = {".gz", ".bz2", ".xz", ".zip"}

    if dataset_path.is_file():
        stats["file_count"] = 1
        stats["total_size_bytes"] = dataset_path.stat().st_size
        stats["files"] = [dataset_path.name]
    elif dataset_path.is_dir():
        for file in sorted(dataset_path.rglob("*")):
            if not file.is_file():
                continue

            suffix = file.suffix.lower()
            is_data_file = suffix in extensions
            if suffix in compressed:
                inner_suffix = Path(file.stem).suffix.lower()
                is_data_file = inner_suffix in extensions

            if is_data_file:
                stats["file_count"] += 1
                stats["total_size_bytes"] += file.stat().st_size
                stats["files"].append(str(file.relative_to(dataset_path)))

    return stats


def compute_change_summary(
    old_stats: Optional[Dict[str, Any]],
    new_stats: Dict[str, Any],
    old_hash: Optional[str],
    new_hash: str,
) -> Dict[str, Any]:
    """
    Compute a summary of changes between two dataset states.
    """
    if old_stats is None:
        old_stats = {"file_count": 0, "total_size_bytes": 0, "files": []}

    old_files = set(old_stats.get("files", []))
    new_files = set(new_stats.get("files", []))

    added = new_files - old_files
    removed = old_files - new_files
    # Files that exist in both but may have changed
    common = old_files & new_files

    return {
        "samples_added": 0,  # Would need to load data to know this
        "samples_removed": 0,
        "files_added": list(added),
        "files_removed": list(removed),
        "files_changed": list(common) if old_hash != new_hash else [],
        "size_change_bytes": new_stats["total_size_bytes"] - old_stats.get("total_size_bytes", 0),
        "old_hash": old_hash,
        "new_hash": new_hash,
    }


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
async def list_datasets(verify_integrity: bool = False):
    """
    List all datasets in the current workspace.

    Args:
        verify_integrity: If True, verify hash integrity for all datasets (slower).
                         If False, use cached version_status.
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            return {"datasets": [], "total": 0}

        datasets = []
        needs_save = False

        for ds in workspace.datasets:
            # Add computed fields if not present
            dataset_info = dict(ds)
            path = Path(ds.get("path", ""))

            # Ensure targets is available at top level (may be stored in config.targets)
            config = ds.get("config", {})
            if "targets" not in dataset_info and "targets" in config:
                dataset_info["targets"] = config["targets"]
            if "default_target" not in dataset_info and "default_target" in config:
                dataset_info["default_target"] = config["default_target"]

            # Check accessibility
            if not path.exists():
                dataset_info["status"] = "missing"
                dataset_info["version_status"] = "missing"
            else:
                dataset_info["status"] = "available"

                # Load dataset to get actual num_samples, num_features, targets if not populated
                if dataset_info.get("num_samples", 0) == 0 and NIRS4ALL_AVAILABLE:
                    try:
                        from .spectra import _load_dataset

                        loaded_ds = _load_dataset(ds.get("id"))
                        if loaded_ds:
                            dataset_info["num_samples"] = loaded_ds.num_samples
                            dataset_info["num_features"] = loaded_ds.num_features

                            # Determine task type
                            task_type_str = None
                            if loaded_ds.task_type:
                                task_type_str = str(loaded_ds.task_type)
                                if "." in task_type_str:
                                    task_type_str = task_type_str.split(".")[-1].lower()
                            dataset_info["task_type"] = task_type_str

                            # Detect targets if not configured
                            if not dataset_info.get("targets") and loaded_ds._targets is not None:
                                try:
                                    target_columns = loaded_ds.target_columns if hasattr(loaded_ds, 'target_columns') else None
                                    if target_columns:
                                        detected_targets = [{"column": col, "type": task_type_str or "regression"} for col in target_columns]
                                    else:
                                        detected_targets = [{"column": "target", "type": task_type_str or "regression"}]
                                    dataset_info["targets"] = detected_targets
                                except Exception:
                                    pass

                            # Update stored values
                            ds["num_samples"] = dataset_info["num_samples"]
                            ds["num_features"] = dataset_info["num_features"]
                            if "task_type" in dataset_info:
                                ds["task_type"] = dataset_info["task_type"]
                            if "targets" in dataset_info:
                                ds["targets"] = dataset_info["targets"]
                                if "config" not in ds:
                                    ds["config"] = {}
                                ds["config"]["targets"] = dataset_info["targets"]
                            needs_save = True
                    except Exception as e:
                        dataset_info["load_warning"] = str(e)

                # Verify integrity if requested
                if verify_integrity:
                    try:
                        current_hash = compute_dataset_hash(path)
                        stored_hash = ds.get("hash")

                        if stored_hash is None:
                            dataset_info["version_status"] = "unchecked"
                        elif current_hash == stored_hash:
                            dataset_info["version_status"] = "current"
                        else:
                            dataset_info["version_status"] = "modified"

                        # Update in workspace if changed
                        if dataset_info["version_status"] != ds.get("version_status"):
                            ds["version_status"] = dataset_info["version_status"]
                            ds["last_verified"] = datetime.now().isoformat()
                            needs_save = True
                    except Exception:
                        dataset_info["version_status"] = ds.get("version_status", "unchecked")
                else:
                    # Use cached status
                    dataset_info["version_status"] = ds.get("version_status", "unchecked")

            datasets.append(dataset_info)

        # Save if any statuses were updated
        if needs_save:
            workspace_manager._save_workspace_config()

        return {"datasets": datasets, "total": len(datasets)}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to list datasets: {str(e)}"
        )


# ============= Synthetic Presets (must be before {dataset_id} routes) =============


class SyntheticPresetInfo(BaseModel):
    """Information about a synthetic dataset preset."""

    id: str
    name: str
    description: str
    task_type: str
    n_samples: int
    complexity: str
    icon: str


@router.get("/datasets/synthetic-presets")
async def get_synthetic_presets() -> Dict[str, List[SyntheticPresetInfo]]:
    """
    Get available presets for synthetic data generation.

    Returns a list of pre-configured generation options for quick setup.
    """
    presets = [
        SyntheticPresetInfo(
            id="regression_small",
            name="Regression (Small)",
            description="250 samples for quick testing",
            task_type="regression",
            n_samples=250,
            complexity="simple",
            icon="activity",
        ),
        SyntheticPresetInfo(
            id="regression_medium",
            name="Regression (Medium)",
            description="1000 samples for model development",
            task_type="regression",
            n_samples=1000,
            complexity="realistic",
            icon="trending-up",
        ),
        SyntheticPresetInfo(
            id="regression_large",
            name="Regression (Large)",
            description="2500 samples for full experiments",
            task_type="regression",
            n_samples=2500,
            complexity="realistic",
            icon="bar-chart-3",
        ),
        SyntheticPresetInfo(
            id="classification_binary",
            name="Binary Classification",
            description="500 samples, 2 classes",
            task_type="binary_classification",
            n_samples=500,
            complexity="simple",
            icon="git-branch",
        ),
        SyntheticPresetInfo(
            id="classification_multi",
            name="Multiclass Classification",
            description="750 samples, 3 classes",
            task_type="multiclass_classification",
            n_samples=750,
            complexity="simple",
            icon="layers",
        ),
        SyntheticPresetInfo(
            id="complex_realistic",
            name="Complex Realistic",
            description="1500 samples with noise and batch effects",
            task_type="regression",
            n_samples=1500,
            complexity="complex",
            icon="cpu",
        ),
    ]

    return {"presets": presets}


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

        # Ensure targets is available at top level (may be stored in config.targets)
        config = dataset.get("config", {})
        if "targets" not in extended_info and "targets" in config:
            extended_info["targets"] = config["targets"]
        if "default_target" not in extended_info and "default_target" in config:
            extended_info["default_target"] = config["default_target"]

        if NIRS4ALL_AVAILABLE:
            try:
                from .spectra import _load_dataset

                ds = _load_dataset(dataset_id)
                if ds:
                    task_type_str = None
                    if ds.task_type:
                        task_type_str = str(ds.task_type)
                        # Handle TaskType enum format like "TaskType.REGRESSION"
                        if "." in task_type_str:
                            task_type_str = task_type_str.split(".")[-1].lower()

                    extended_info.update({
                        "num_samples": ds.num_samples,
                        "num_features": ds.num_features,
                        "n_sources": ds.n_sources,
                        "is_multi_source": ds.is_multi_source(),
                        "task_type": task_type_str,
                        "num_classes": ds.num_classes if ds.is_classification else None,
                        "has_targets": ds._targets is not None,
                        "has_metadata": ds._metadata.num_rows > 0 if ds._metadata else False,
                        "metadata_columns": ds.metadata_columns if ds._metadata else [],
                        "signal_types": [st.value for st in ds.signal_types] if ds.signal_types else [],
                        "num_folds": ds.num_folds,
                    })

                    # If no targets configured, try to detect from loaded dataset
                    if not extended_info.get("targets") and ds._targets is not None:
                        try:
                            # Get target column names from the dataset
                            target_columns = ds.target_columns if hasattr(ds, 'target_columns') else None
                            if target_columns:
                                detected_targets = []
                                for col in target_columns:
                                    detected_targets.append({
                                        "column": col,
                                        "type": task_type_str or "regression",
                                    })
                                extended_info["targets"] = detected_targets
                            elif ds._targets is not None:
                                # Fallback: create a single "target" entry
                                extended_info["targets"] = [{
                                    "column": "target",
                                    "type": task_type_str or "regression",
                                }]
                        except Exception:
                            pass
            except Exception as e:
                extended_info["load_warning"] = str(e)

        return {"dataset": extended_info}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get dataset: {str(e)}"
        )


@router.get("/datasets/{dataset_id}/preview", response_model=PreviewDataResponse)
async def preview_dataset_by_id(dataset_id: str, max_samples: int = 100):
    """
    Preview a linked dataset using its stored configuration.

    This uses the same loading logic as POST /datasets/preview but retrieves
    the configuration from the stored dataset in the workspace.
    """
    if not NIRS4ALL_AVAILABLE:
        return PreviewDataResponse(
            success=False,
            error="nirs4all library not available",
        )

    try:
        # Get dataset info from workspace
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            return PreviewDataResponse(
                success=False,
                error="No workspace selected",
            )

        dataset_info = next(
            (d for d in workspace.datasets if d.get("id") == dataset_id), None
        )
        if not dataset_info:
            return PreviewDataResponse(
                success=False,
                error="Dataset not found",
            )

        dataset_path = dataset_info.get("path", "")
        stored_config = dataset_info.get("config", {})

        if not Path(dataset_path).exists():
            return PreviewDataResponse(
                success=False,
                error=f"Dataset path not found: {dataset_path}",
            )

        # Build nirs4all config from stored configuration
        # This mirrors the logic in POST /datasets/preview

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
            # Fallback: try to auto-detect files from folder
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
                        with open(config_file, "r", encoding="utf-8") as f:
                            folder_config = json.load(f)
                            config.update(folder_config)
                    else:
                        # Try to find CSV files
                        csv_files = list(folder_path.glob("*.csv"))
                        if csv_files:
                            # Simple heuristic: first CSV is X
                            config["train_x"] = str(csv_files[0])
                            if x_specific_params:
                                config["train_x_params"] = x_specific_params

        # Load dataset using nirs4all
        try:
            from nirs4all.data import DatasetConfigs

            dataset_configs = DatasetConfigs(config)
            datasets = dataset_configs.get_datasets()

            if not datasets:
                return PreviewDataResponse(
                    success=False,
                    error="No data could be loaded from the dataset configuration",
                )

            dataset = datasets[0]

            # Get X data for spectra preview
            X = dataset.x({"partition": "train"}, layout="2d")
            if isinstance(X, list):
                X = X[0]

            # Limit samples for preview
            if len(X) > max_samples:
                indices = np.linspace(0, len(X) - 1, max_samples, dtype=int)
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
            detected_signal_type = None
            try:
                if dataset.signal_types:
                    detected_signal_type = dataset.signal_types[0].value
            except Exception:
                pass

            # Header unit
            detected_header_unit = None
            try:
                detected_header_unit = dataset.header_unit(0)
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
                "signal_type": detected_signal_type,
                "header_unit": detected_header_unit,
            }

            return PreviewDataResponse(
                success=True,
                summary=summary,
                spectra_preview=spectra_preview,
                target_distribution=target_distribution,
            )

        except Exception as e:
            import traceback
            traceback.print_exc()
            return PreviewDataResponse(
                success=False,
                error=f"Failed to load dataset: {str(e)}",
            )

    except Exception as e:
        import traceback
        traceback.print_exc()
        return PreviewDataResponse(
            success=False,
            error=f"Preview failed: {str(e)}",
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


# ============= Phase 2: Versioning & Integrity Endpoints =============


@router.post("/datasets/{dataset_id}/verify", response_model=VerifyDatasetResponse)
async def verify_dataset(dataset_id: str):
    """
    Verify dataset integrity by comparing current hash with stored hash.

    Returns the version status:
    - current: Hash matches stored hash
    - modified: Hash differs from stored hash
    - missing: Path not accessible
    - unchecked: Never verified (no stored hash)
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        # Find dataset
        dataset_info = next(
            (d for d in workspace.datasets if d.get("id") == dataset_id), None
        )
        if not dataset_info:
            raise HTTPException(status_code=404, detail="Dataset not found")

        dataset_path = Path(dataset_info.get("path", ""))
        now = datetime.now().isoformat()

        # Check if path exists
        if not dataset_path.exists():
            # Update status in workspace
            dataset_info["version_status"] = "missing"
            dataset_info["last_verified"] = now
            workspace_manager._save_workspace_config()

            return VerifyDatasetResponse(
                success=True,
                dataset_id=dataset_id,
                version_status="missing",
                current_hash=None,
                stored_hash=dataset_info.get("hash"),
                is_modified=False,
                verified_at=now,
            )

        # Compute current hash
        current_hash = compute_dataset_hash(dataset_path)
        stored_hash = dataset_info.get("hash")

        # Determine version status
        if stored_hash is None:
            version_status = "unchecked"
            is_modified = False
        elif current_hash == stored_hash:
            version_status = "current"
            is_modified = False
        else:
            version_status = "modified"
            is_modified = True

        # Compute change summary if modified
        change_summary = None
        if is_modified and stored_hash:
            old_stats = dataset_info.get("_stats")
            new_stats = compute_dataset_stats(dataset_path)
            change_summary = compute_change_summary(old_stats, new_stats, stored_hash, current_hash)

        # Update dataset info
        dataset_info["version_status"] = version_status
        dataset_info["last_verified"] = now
        workspace_manager._save_workspace_config()

        return VerifyDatasetResponse(
            success=True,
            dataset_id=dataset_id,
            version_status=version_status,
            current_hash=current_hash,
            stored_hash=stored_hash,
            is_modified=is_modified,
            change_summary=change_summary,
            verified_at=now,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to verify dataset: {str(e)}"
        )


@router.post("/datasets/{dataset_id}/refresh", response_model=RefreshDatasetResponse)
async def refresh_dataset_version(dataset_id: str, request: RefreshDatasetRequest = RefreshDatasetRequest()):
    """
    Refresh dataset by accepting changes and updating the stored hash.

    This should be called after verifying a dataset shows as "modified"
    and the user wants to accept the new version.
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        # Find dataset
        dataset_info = next(
            (d for d in workspace.datasets if d.get("id") == dataset_id), None
        )
        if not dataset_info:
            raise HTTPException(status_code=404, detail="Dataset not found")

        dataset_path = Path(dataset_info.get("path", ""))

        if not dataset_path.exists():
            raise HTTPException(status_code=404, detail="Dataset path not found")

        now = datetime.now().isoformat()
        old_hash = dataset_info.get("hash")
        old_stats = dataset_info.get("_stats")

        # Compute new hash and stats
        new_hash = compute_dataset_hash(dataset_path)
        new_stats = compute_dataset_stats(dataset_path)

        # Compute change summary
        change_summary = compute_change_summary(old_stats, new_stats, old_hash, new_hash)

        # Increment version
        old_version = dataset_info.get("version", 0)
        new_version = old_version + 1

        # Update version history (Phase 7)
        version_history = dataset_info.get("version_history", [])
        if old_hash:
            # Add previous version to history
            version_history.append({
                "version": old_version,
                "hash": old_hash,
                "timestamp": dataset_info.get("last_verified", now),
            })
        dataset_info["version_history"] = version_history

        # Update dataset info
        dataset_info["hash"] = new_hash
        dataset_info["version"] = new_version
        dataset_info["version_status"] = "current"
        dataset_info["last_verified"] = now
        dataset_info["last_refreshed"] = now
        dataset_info["_stats"] = new_stats  # Store stats for future comparison

        # Clear dataset cache to force reload
        try:
            from .spectra import _clear_dataset_cache
            _clear_dataset_cache(dataset_id)
        except Exception:
            pass

        workspace_manager._save_workspace_config()

        return RefreshDatasetResponse(
            success=True,
            dataset_id=dataset_id,
            old_hash=old_hash,
            new_hash=new_hash,
            version=new_version,
            change_summary=change_summary,
            refreshed_at=now,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to refresh dataset: {str(e)}"
        )


@router.post("/datasets/{dataset_id}/relink", response_model=RelinkDatasetResponse)
async def relink_dataset(dataset_id: str, request: RelinkDatasetRequest):
    """
    Relink a dataset to a new path.

    This is useful when:
    - Moving datasets between machines
    - Renaming dataset folders
    - Fixing broken paths

    The operation validates that the new path has a compatible structure
    unless force=True is specified.
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        # Find dataset
        dataset_info = next(
            (d for d in workspace.datasets if d.get("id") == dataset_id), None
        )
        if not dataset_info:
            raise HTTPException(status_code=404, detail="Dataset not found")

        old_path = dataset_info.get("path", "")
        new_path = Path(request.new_path).resolve()

        if not new_path.exists():
            raise HTTPException(status_code=404, detail=f"New path not found: {request.new_path}")

        now = datetime.now().isoformat()

        # Validate structure matches (if not forcing)
        validation = {
            "structure_matches": True,
            "file_count_matches": True,
            "warnings": [],
        }

        old_stats = dataset_info.get("_stats", {})
        new_stats = compute_dataset_stats(new_path)

        old_file_count = old_stats.get("file_count", 0)
        new_file_count = new_stats.get("file_count", 0)

        if old_file_count != new_file_count:
            validation["file_count_matches"] = False
            validation["warnings"].append(
                f"File count differs: {old_file_count} -> {new_file_count}"
            )

        # Check for expected file patterns
        old_files = set(old_stats.get("files", []))
        new_files = set(new_stats.get("files", []))
        if old_files and new_files:
            # Check if filenames match (ignoring path differences)
            old_names = {Path(f).name for f in old_files}
            new_names = {Path(f).name for f in new_files}
            if old_names != new_names:
                validation["structure_matches"] = False
                missing = old_names - new_names
                extra = new_names - old_names
                if missing:
                    validation["warnings"].append(f"Missing files: {missing}")
                if extra:
                    validation["warnings"].append(f"Extra files: {extra}")

        # Block if validation fails and not forcing
        if not request.force and (not validation["structure_matches"] or not validation["file_count_matches"]):
            raise HTTPException(
                status_code=400,
                detail=f"Structure validation failed. Use force=True to override. Warnings: {validation['warnings']}"
            )

        # Compute new hash
        new_hash = compute_dataset_hash(new_path)

        # Update dataset info
        dataset_info["path"] = str(new_path)
        dataset_info["hash"] = new_hash
        dataset_info["version_status"] = "current"
        dataset_info["last_verified"] = now
        dataset_info["_stats"] = new_stats

        # Clear dataset cache
        try:
            from .spectra import _clear_dataset_cache
            _clear_dataset_cache(dataset_id)
        except Exception:
            pass

        workspace_manager._save_workspace_config()

        return RelinkDatasetResponse(
            success=True,
            dataset_id=dataset_id,
            old_path=old_path,
            new_path=str(new_path),
            validation=validation,
            new_hash=new_hash,
            relinked_at=now,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to relink dataset: {str(e)}"
        )


@router.get("/datasets/{dataset_id}/version-status")
async def get_dataset_version_status(dataset_id: str):
    """
    Get the current version status of a dataset without full verification.

    This is a quick check that returns cached version status.
    Use /verify for a full integrity check.
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        dataset_info = next(
            (d for d in workspace.datasets if d.get("id") == dataset_id), None
        )
        if not dataset_info:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Quick path check
        dataset_path = Path(dataset_info.get("path", ""))
        if not dataset_path.exists():
            status = "missing"
        else:
            status = dataset_info.get("version_status", "unchecked")

        return {
            "dataset_id": dataset_id,
            "version_status": status,
            "hash": dataset_info.get("hash"),
            "version": dataset_info.get("version", 1),
            "last_verified": dataset_info.get("last_verified"),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get version status: {str(e)}"
        )


@router.get("/datasets/{dataset_id}/run-compatibility")
async def get_dataset_run_compatibility(dataset_id: str):
    """
    Check run compatibility for a dataset (Phase 7).

    This endpoint checks which runs in linked workspaces were made with
    which version of the dataset, and warns if the dataset has changed
    since those runs were made.

    Returns:
        - current_version: Current dataset version
        - current_hash: Current dataset hash
        - runs: List of runs with their dataset version info
        - warnings: List of warnings for runs made with old versions
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        dataset_info = next(
            (d for d in workspace.datasets if d.get("id") == dataset_id), None
        )
        if not dataset_info:
            raise HTTPException(status_code=404, detail="Dataset not found")

        dataset_name = dataset_info.get("name", "")
        current_hash = dataset_info.get("hash")
        current_version = dataset_info.get("version", 1)
        version_history = dataset_info.get("version_history", [])

        # Get linked workspaces and scan for runs using this dataset
        compatible_runs = []
        incompatible_runs = []
        warnings = []

        # Check active linked workspace for runs
        from .workspace_manager import workspace_manager as wm, WorkspaceScanner
        active_ws = wm.get_active_workspace()

        if active_ws:
            scanner = WorkspaceScanner(Path(active_ws.path))
            runs = scanner.discover_runs()

            for run in runs:
                if run.get("dataset") != dataset_name:
                    continue

                run_dataset_info = run.get("dataset_info", {})
                run_hash = run_dataset_info.get("hash")
                run_version = run_dataset_info.get("version_at_run")

                run_info = {
                    "run_id": run.get("id"),
                    "pipeline_id": run.get("pipeline_id"),
                    "name": run.get("name"),
                    "created_at": run.get("created_at"),
                    "hash_at_run": run_hash,
                    "version_at_run": run_version,
                    "is_compatible": run_hash == current_hash if run_hash else True,
                }

                if run_hash and run_hash != current_hash:
                    incompatible_runs.append(run_info)
                    warnings.append({
                        "run_id": run.get("id"),
                        "message": f"Run '{run.get('name')}' was made with dataset version {run_version or '?'} (hash: {run_hash[:8]}...), current version is {current_version}",
                    })
                else:
                    compatible_runs.append(run_info)

        return {
            "dataset_id": dataset_id,
            "dataset_name": dataset_name,
            "current_version": current_version,
            "current_hash": current_hash,
            "version_history": version_history,
            "compatible_runs": compatible_runs,
            "incompatible_runs": incompatible_runs,
            "warnings": warnings,
            "total_runs": len(compatible_runs) + len(incompatible_runs),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to check run compatibility: {str(e)}"
        )


# ============= Phase 3: Multi-Target Support Endpoints =============


@router.get("/datasets/{dataset_id}/targets")
async def get_dataset_targets(dataset_id: str):
    """
    Get the configured targets for a dataset.

    Returns the list of target configurations and the default target.
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        dataset_info = next(
            (d for d in workspace.datasets if d.get("id") == dataset_id), None
        )
        if not dataset_info:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Get targets from dataset config
        config = dataset_info.get("config", {})
        targets = config.get("targets", [])
        default_target = config.get("default_target")

        # If no targets configured, try to detect from the loaded dataset
        if not targets and NIRS4ALL_AVAILABLE:
            try:
                from .spectra import _load_dataset
                ds = _load_dataset(dataset_id)
                if ds and ds._targets is not None:
                    # Single target detected
                    task_type = "regression" if ds.is_regression else "multiclass_classification"
                    targets = [{
                        "column": "target",
                        "type": task_type,
                        "is_default": True,
                    }]
                    default_target = "target"
            except Exception:
                pass

        return {
            "dataset_id": dataset_id,
            "targets": targets,
            "default_target": default_target,
            "num_targets": len(targets),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get dataset targets: {str(e)}"
        )


@router.put("/datasets/{dataset_id}/targets", response_model=UpdateDatasetTargetsResponse)
async def update_dataset_targets(dataset_id: str, request: UpdateDatasetTargetsRequest):
    """
    Update the target configuration for a dataset.

    This allows setting multiple targets with their types, units, and classes.
    One target should be marked as default or specified in default_target.
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        dataset_info = next(
            (d for d in workspace.datasets if d.get("id") == dataset_id), None
        )
        if not dataset_info:
            raise HTTPException(status_code=404, detail="Dataset not found")

        now = datetime.now().isoformat()

        # Convert targets to dict format
        targets_list = [t.model_dump() for t in request.targets]

        # Determine default target
        default_target = request.default_target
        if not default_target and targets_list:
            # Use first target marked as default, or first target if none marked
            default_marked = next((t for t in targets_list if t.get("is_default")), None)
            if default_marked:
                default_target = default_marked["column"]
            else:
                default_target = targets_list[0]["column"]

        # Ensure default target is marked in the list
        for target in targets_list:
            target["is_default"] = target["column"] == default_target

        # Update config
        if "config" not in dataset_info:
            dataset_info["config"] = {}
        dataset_info["config"]["targets"] = targets_list
        dataset_info["config"]["default_target"] = default_target

        # Also store at top level for easy access
        dataset_info["targets"] = targets_list
        dataset_info["default_target"] = default_target

        workspace_manager._save_workspace_config()

        return UpdateDatasetTargetsResponse(
            success=True,
            dataset_id=dataset_id,
            targets=targets_list,
            default_target=default_target,
            updated_at=now,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update dataset targets: {str(e)}"
        )


@router.post("/datasets/{dataset_id}/detect-targets")
async def detect_dataset_targets(dataset_id: str, y_file_path: Optional[str] = None):
    """
    Detect available target columns from a dataset's Y file.

    Analyzes the Y file to identify columns that can be used as targets,
    along with their detected types (regression vs classification).
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        dataset_info = next(
            (d for d in workspace.datasets if d.get("id") == dataset_id), None
        )
        if not dataset_info:
            raise HTTPException(status_code=404, detail="Dataset not found")

        import pandas as pd

        # Get Y file path
        if y_file_path:
            y_path = Path(y_file_path)
        else:
            # Try to find Y file from config
            config = dataset_info.get("config", {})
            train_y = config.get("train_y")
            if train_y:
                base_path = Path(dataset_info.get("path", ""))
                if base_path.is_dir():
                    y_path = base_path / train_y
                else:
                    y_path = Path(train_y)
            else:
                raise HTTPException(
                    status_code=400,
                    detail="No Y file path provided and none found in config"
                )

        if not y_path.exists():
            raise HTTPException(status_code=404, detail=f"Y file not found: {y_path}")

        # Get parsing options
        global_params = config.get("global_params", {})
        delimiter = global_params.get("delimiter", ",")
        decimal = global_params.get("decimal_separator", ".")

        # Read Y file
        try:
            df = pd.read_csv(y_path, sep=delimiter, decimal=decimal, nrows=1000)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read Y file: {e}")

        detected_targets = []
        for col in df.columns:
            series = df[col]
            col_info = {
                "column": str(col),
                "type": "regression",
                "unique_values": int(series.nunique()),
                "sample_values": series.dropna().head(5).tolist(),
                "is_target_candidate": True,
                "is_metadata_candidate": False,
            }

            # Detect if classification or regression
            if series.dtype == 'object' or series.nunique() <= 10:
                # Likely classification
                col_info["type"] = "multiclass_classification" if series.nunique() > 2 else "binary_classification"
                col_info["classes"] = [str(c) for c in series.unique().tolist() if pd.notna(c)]
            else:
                # Numeric - likely regression
                col_info["type"] = "regression"
                col_info["min"] = float(series.min()) if not pd.isna(series.min()) else None
                col_info["max"] = float(series.max()) if not pd.isna(series.max()) else None
                col_info["mean"] = float(series.mean()) if not pd.isna(series.mean()) else None

            detected_targets.append(col_info)

        return {
            "dataset_id": dataset_id,
            "y_file": str(y_path),
            "detected_columns": detected_targets,
            "num_columns": len(detected_targets),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to detect targets: {str(e)}"
        )


@router.post("/datasets/{dataset_id}/set-default-target")
async def set_default_target(dataset_id: str, target_column: str):
    """
    Set the default target column for a dataset.

    This is a convenience endpoint to quickly change the default target
    without updating all target configurations.
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        dataset_info = next(
            (d for d in workspace.datasets if d.get("id") == dataset_id), None
        )
        if not dataset_info:
            raise HTTPException(status_code=404, detail="Dataset not found")

        config = dataset_info.get("config", {})
        targets = config.get("targets", [])

        # Verify the target exists
        target_columns = [t.get("column") for t in targets]
        if targets and target_column not in target_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Target column '{target_column}' not found. Available: {target_columns}"
            )

        # Update is_default flags
        for target in targets:
            target["is_default"] = target["column"] == target_column

        # Update default_target
        if "config" not in dataset_info:
            dataset_info["config"] = {}
        dataset_info["config"]["default_target"] = target_column
        dataset_info["config"]["targets"] = targets
        dataset_info["default_target"] = target_column
        dataset_info["targets"] = targets

        workspace_manager._save_workspace_config()

        return {
            "success": True,
            "dataset_id": dataset_id,
            "default_target": target_column,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to set default target: {str(e)}"
        )


# ============= Phase 6: Synthetic Data Generation =============


class GenerateSyntheticRequest(BaseModel):
    """Request model for synthetic dataset generation."""

    task_type: str = Field("regression", description="Task type: regression, binary_classification, multiclass_classification")
    n_samples: int = Field(500, ge=50, le=10000, description="Number of samples to generate")
    complexity: str = Field("simple", description="Complexity level: simple, realistic, complex")
    n_classes: int = Field(3, ge=2, le=20, description="Number of classes for classification tasks")
    target_range: Optional[List[float]] = Field(None, description="Target value range [min, max] for regression")
    train_ratio: float = Field(0.8, ge=0.5, le=0.95, description="Proportion of samples for training")

    # Advanced options (Phase 6.5)
    include_metadata: bool = Field(True, description="Include metadata columns (sample_id, batch, etc.)")
    include_repetitions: bool = Field(False, description="Add sample repetitions for variability analysis")
    repetitions_per_sample: int = Field(3, ge=2, le=10, description="Number of repetitions per sample")
    noise_level: float = Field(0.05, ge=0.0, le=0.5, description="Noise level (0 = no noise, 0.5 = high noise)")
    add_batch_effects: bool = Field(False, description="Add batch-to-batch variation")
    n_batches: int = Field(3, ge=2, le=10, description="Number of batches if batch effects enabled")
    wavelength_range: Optional[List[float]] = Field(None, description="Wavelength range [start, end] in nm")

    # Naming
    name: Optional[str] = Field(None, description="Dataset name (auto-generated if not provided)")
    auto_link: bool = Field(True, description="Automatically link to workspace after generation")


class GenerateSyntheticResponse(BaseModel):
    """Response model for synthetic dataset generation."""

    success: bool
    dataset_id: Optional[str] = None
    name: str
    path: str
    summary: Dict[str, Any]
    linked: bool = False
    message: str


@router.post("/datasets/generate-synthetic", response_model=GenerateSyntheticResponse)
async def generate_synthetic_dataset(request: GenerateSyntheticRequest):
    """
    Generate a synthetic NIRS dataset using nirs4all.generate.

    This endpoint creates a synthetic dataset for testing and development purposes.
    The dataset is saved to the workspace and optionally linked for immediate use.

    Features:
    - Regression or classification tasks
    - Configurable complexity (simple, realistic, complex)
    - Optional metadata, repetitions, and batch effects
    - Automatic linking to workspace

    Developer mode feature: This endpoint is intended for development and testing.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available. Cannot generate synthetic data."
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    try:
        import nirs4all
        from nirs4all.data.synthetic import SyntheticDatasetBuilder

        # Generate dataset name
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if request.name:
            dataset_name = request.name
        else:
            task_prefix = "reg" if request.task_type == "regression" else f"cls{request.n_classes}"
            dataset_name = f"synthetic_{task_prefix}_{request.n_samples}_{timestamp}"

        # Prepare output directory
        workspace_path = Path(workspace.path)
        datasets_dir = workspace_path / "datasets" / "synthetic"
        datasets_dir.mkdir(parents=True, exist_ok=True)
        output_path = datasets_dir / dataset_name

        # Build generation parameters using the builder pattern
        random_state = int(datetime.now().timestamp()) % 2**31

        builder = SyntheticDatasetBuilder(
            n_samples=request.n_samples,
            random_state=random_state,
            name=dataset_name,
        )

        # Configure features
        feature_kwargs: Dict[str, Any] = {"complexity": request.complexity}
        if request.wavelength_range and len(request.wavelength_range) == 2:
            feature_kwargs["wavelength_range"] = tuple(request.wavelength_range)
        builder.with_features(**feature_kwargs)

        # Configure targets based on task type
        if request.task_type == "regression":
            if request.target_range and len(request.target_range) == 2:
                builder.with_targets(range=tuple(request.target_range))
        else:
            # Classification
            builder.with_classification(
                n_classes=request.n_classes,
                separation=1.0,  # Standard separation
            )

        # Configure partitions
        builder.with_partitions(train_ratio=request.train_ratio)

        # Export to folder
        output_path = builder.export(str(output_path), format="standard")

        # Create summary
        summary = {
            "task_type": request.task_type,
            "n_samples": request.n_samples,
            "complexity": request.complexity,
            "train_ratio": request.train_ratio,
            "n_classes": request.n_classes if request.task_type != "regression" else None,
            "target_range": request.target_range,
            "wavelength_range": request.wavelength_range,
            "include_metadata": request.include_metadata,
            "include_repetitions": request.include_repetitions,
            "noise_level": request.noise_level,
            "add_batch_effects": request.add_batch_effects,
            "generated_at": datetime.now().isoformat(),
        }

        # Try to get actual dimensions from generated files
        try:
            import pandas as pd
            x_train_file = output_path / "Xcal.csv"
            if x_train_file.exists():
                df = pd.read_csv(x_train_file, nrows=5)
                summary["num_features"] = len(df.columns)
                # Count all rows
                summary["train_samples"] = sum(1 for _ in open(x_train_file)) - 1

            x_test_file = output_path / "Xval.csv"
            if x_test_file.exists():
                summary["test_samples"] = sum(1 for _ in open(x_test_file)) - 1
        except Exception:
            pass

        # Auto-link to workspace if requested
        linked = False
        dataset_id = None

        if request.auto_link:
            try:
                # Build config for the dataset
                link_config = {
                    "synthetic": True,
                    "generated_at": datetime.now().isoformat(),
                    "generation_params": {
                        "task_type": request.task_type,
                        "n_samples": request.n_samples,
                        "complexity": request.complexity,
                    },
                    "targets": [{
                        "column": "target",
                        "type": request.task_type,
                        "is_default": True,
                    }],
                    "default_target": "target",
                }

                dataset_info = workspace_manager.link_dataset(
                    str(output_path),
                    config=link_config
                )
                linked = True
                dataset_id = dataset_info.get("id")
            except Exception as e:
                # Linking failed, but dataset was still created
                summary["link_error"] = str(e)

        return GenerateSyntheticResponse(
            success=True,
            dataset_id=dataset_id,
            name=dataset_name,
            path=str(output_path),
            summary=summary,
            linked=linked,
            message=f"Synthetic dataset '{dataset_name}' generated successfully"
            + (" and linked to workspace" if linked else ""),
        )

    except ImportError as e:
        raise HTTPException(
            status_code=501,
            detail=f"nirs4all.generate not available: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate synthetic dataset: {str(e)}"
        )
