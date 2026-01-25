"""
Datasets API routes for nirs4all webapp.

This module provides FastAPI routes for dataset operations.
All data loading, validation, splitting, filtering, and merging is delegated to nirs4all.

The webapp is responsible only for:
- Linking/unlinking datasets to workspaces
- UI-specific preview generation
- Synthetic data presets for quick setup
"""

from __future__ import annotations

import hashlib
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    from nirs4all.data.dataset import SpectroDataset
    from nirs4all.data import DatasetConfigs
    from nirs4all.data.detection import detect_file_parameters
    from nirs4all.data.parsers.folder_parser import FolderParser
    from nirs4all.data.loaders import load_file

    NIRS4ALL_AVAILABLE = True
except ImportError as e:
    print(f"Note: nirs4all not available for datasets API: {e}")
    NIRS4ALL_AVAILABLE = False


router = APIRouter()


# ============= Request/Response Models =============


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
    num_rows: Optional[int] = None
    num_columns: Optional[int] = None


class DetectFilesRequest(BaseModel):
    """Request to detect files in a folder."""

    path: str = Field(..., description="Folder path to scan")
    recursive: bool = Field(False, description="Scan subdirectories")


class AutoDetectRequest(BaseModel):
    """Request to auto-detect file parameters."""

    path: str = Field(..., description="File path to analyze")
    attempt_load: bool = Field(True, description="Whether to attempt loading the file")


class DetectFormatRequest(BaseModel):
    """Request to detect file format and parameters."""

    path: str = Field(..., description="File path to analyze")
    sample_rows: int = Field(10, description="Number of sample rows to return")


class UnifiedDetectionResponse(BaseModel):
    """Response from unified detection using nirs4all."""

    files: List[DetectedFile]
    folder_name: str
    total_size_bytes: int
    has_standard_structure: bool
    parsing_options: Dict[str, Any] = Field(default_factory=dict)
    confidence: Dict[str, float] = Field(default_factory=dict)
    has_fold_file: bool = False
    fold_file_path: Optional[str] = None
    metadata_columns: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class DatasetFileConfig(BaseModel):
    """File configuration for preview."""

    path: str
    type: str
    split: str
    source: Optional[int] = None
    overrides: Optional[Dict[str, Any]] = None


class ParsingOptions(BaseModel):
    """Parsing options for preview."""

    delimiter: str = ";"
    decimal_separator: str = "."
    has_header: bool = True
    header_unit: str = "cm-1"
    signal_type: str = "auto"


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
    spectra_per_source: Optional[Dict[int, Dict[str, Any]]] = None
    target_distributions: Optional[Dict[str, Dict[str, Any]]] = None


class SyntheticPresetInfo(BaseModel):
    """Information about a synthetic dataset preset."""

    id: str
    name: str
    description: str
    task_type: str
    n_samples: int
    complexity: str
    icon: str


class GenerateSyntheticRequest(BaseModel):
    """Request model for synthetic dataset generation."""

    task_type: str = Field("regression", description="Task type: regression, binary_classification, multiclass_classification")
    n_samples: int = Field(500, ge=50, le=10000, description="Number of samples to generate")
    complexity: str = Field("simple", description="Complexity level: simple, realistic, complex")
    n_classes: int = Field(3, ge=2, le=20, description="Number of classes for classification tasks")
    target_range: Optional[List[float]] = Field(None, description="Target value range [min, max] for regression")
    train_ratio: float = Field(0.8, ge=0.5, le=0.95, description="Proportion of samples for training")
    wavelength_range: Optional[List[float]] = Field(None, description="Wavelength range [start, end] in nm")
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


# ============= Helper Functions =============


def _get_file_format(file_path: Path) -> str:
    """Get file format from path."""
    suffix = file_path.suffix.lower()
    name = file_path.name.lower()

    if name.endswith('.csv.gz') or name.endswith('.csv.zip'):
        return "csv"

    format_map = {
        ".csv": "csv",
        ".xlsx": "xlsx",
        ".xls": "xls",
        ".parquet": "parquet",
        ".npy": "npy",
        ".npz": "npz",
        ".mat": "mat",
    }
    return format_map.get(suffix, "csv")


def _build_nirs4all_config(
    files: List[DatasetFileConfig],
    parsing: ParsingOptions,
    base_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Build nirs4all config dict from file configs and parsing options."""
    global_params = {
        "delimiter": parsing.delimiter,
        "decimal_separator": parsing.decimal_separator,
        "has_header": parsing.has_header,
    }

    x_specific_params = {}
    if parsing.header_unit:
        x_specific_params["header_unit"] = parsing.header_unit
    if parsing.signal_type and parsing.signal_type != "auto":
        x_specific_params["signal_type"] = parsing.signal_type

    config: Dict[str, Any] = {"global_params": global_params}

    for file_config in files:
        file_path = Path(file_config.path)
        if not file_path.is_absolute() and base_path:
            file_path = base_path / file_config.path
        resolved_path = str(file_path)

        file_key = None
        if file_config.type == "X":
            file_key = f"{file_config.split}_x"
        elif file_config.type == "Y":
            file_key = f"{file_config.split}_y"
        elif file_config.type == "metadata":
            file_key = f"{file_config.split}_group"

        if file_key:
            if file_key in config and file_config.type == "X":
                existing = config[file_key]
                if isinstance(existing, list):
                    config[file_key].append(resolved_path)
                else:
                    config[file_key] = [existing, resolved_path]
            else:
                config[file_key] = resolved_path

            params_key = f"{file_key}_params"
            if file_config.type == "X" and x_specific_params:
                if file_config.overrides:
                    config[params_key] = {**x_specific_params, **file_config.overrides}
                else:
                    config[params_key] = x_specific_params.copy()
            elif file_config.overrides:
                config[params_key] = file_config.overrides

    return config


def _compute_spectra_preview(X: np.ndarray, wavelengths: np.ndarray) -> Dict[str, Any]:
    """Compute spectra statistics for preview."""
    return {
        "wavelengths": wavelengths.tolist(),
        "mean_spectrum": np.mean(X, axis=0).tolist(),
        "std_spectrum": np.std(X, axis=0).tolist(),
        "min_spectrum": np.min(X, axis=0).tolist(),
        "max_spectrum": np.max(X, axis=0).tolist(),
        "sample_spectra": X[:5].tolist() if len(X) >= 5 else X.tolist(),
    }


def _compute_target_distribution(y: np.ndarray, is_regression: bool) -> Dict[str, Any]:
    """Compute target distribution for preview."""
    if is_regression:
        hist, bin_edges = np.histogram(y, bins=20)
        return {
            "type": "regression",
            "min": float(np.min(y)),
            "max": float(np.max(y)),
            "mean": float(np.mean(y)),
            "std": float(np.std(y)),
            "histogram": [{"bin": float(bin_edges[i]), "count": int(hist[i])} for i in range(len(hist))],
        }
    else:
        unique, counts = np.unique(y, return_counts=True)
        return {
            "type": "classification",
            "classes": [str(c) for c in unique.tolist()],
            "class_counts": {str(k): int(v) for k, v in zip(unique.tolist(), counts.tolist())},
        }


# ============= Detection Endpoints =============


@router.post("/datasets/detect-unified", response_model=UnifiedDetectionResponse)
async def detect_unified(request: DetectFilesRequest):
    """Unified file detection using nirs4all's FolderParser."""
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(status_code=501, detail="nirs4all library not available")

    folder_path = Path(request.path)
    if not folder_path.exists():
        raise HTTPException(status_code=404, detail="Folder not found")
    if not folder_path.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")

    files: List[DetectedFile] = []
    total_size = 0
    warnings: List[str] = []
    parsing_options: Dict[str, Any] = {}
    confidence: Dict[str, float] = {}
    has_fold_file = False
    fold_file_path: Optional[str] = None
    metadata_columns: List[str] = []

    try:
        parser = FolderParser()
        result = parser.parse(str(folder_path))

        if result.success and result.config:
            config = result.config
            warnings.extend(result.warnings or [])

            key_to_type_split = {
                "train_x": ("X", "train"),
                "test_x": ("X", "test"),
                "train_y": ("Y", "train"),
                "test_y": ("Y", "test"),
                "train_group": ("metadata", "train"),
                "test_group": ("metadata", "test"),
                "folds": ("folds", "train"),
            }

            for key, (file_type, split) in key_to_type_split.items():
                paths = config.get(key)
                if paths is None:
                    continue

                if isinstance(paths, str):
                    paths = [paths]

                for i, path in enumerate(paths):
                    file_path = Path(path)
                    if file_path.exists():
                        size = file_path.stat().st_size
                        total_size += size

                        if file_type == "folds":
                            has_fold_file = True
                            fold_file_path = str(file_path)
                            continue

                        files.append(DetectedFile(
                            path=str(file_path),
                            filename=file_path.name,
                            type=file_type,
                            split=split,
                            source=i + 1 if len(paths) > 1 else None,
                            format=_get_file_format(file_path),
                            size_bytes=size,
                            confidence=0.95,
                        ))

            x_files = [f for f in files if f.type == "X"]
            if x_files:
                first_x_path = Path(x_files[0].path)
                if first_x_path.suffix.lower() == ".csv":
                    try:
                        detection_result = detect_file_parameters(str(first_x_path))
                        parsing_options = {
                            "delimiter": detection_result.delimiter,
                            "decimal_separator": detection_result.decimal_separator,
                            "has_header": detection_result.has_header,
                            "header_unit": detection_result.header_unit,
                            "encoding": detection_result.encoding,
                        }
                        confidence = detection_result.confidence
                        if detection_result.signal_type:
                            parsing_options["signal_type"] = detection_result.signal_type
                        warnings.extend(detection_result.warnings)
                    except Exception as e:
                        warnings.append(f"CSV auto-detection failed: {e}")

            metadata_files = [f for f in files if f.type == "metadata"]
            if metadata_files:
                try:
                    data, _, _, headers, _ = load_file(
                        str(metadata_files[0].path),
                        delimiter=parsing_options.get("delimiter", ";"),
                        decimal_separator=parsing_options.get("decimal_separator", "."),
                        has_header=parsing_options.get("has_header", True),
                        data_type="metadata",
                    )
                    metadata_columns = headers if headers else []
                except Exception as e:
                    warnings.append(f"Failed to read metadata columns: {e}")
        else:
            warnings.append("nirs4all FolderParser failed")
            warnings.extend(result.errors or [])

    except Exception as e:
        warnings.append(f"Detection error: {e}")

    for f in files:
        try:
            file_detection = detect_file_parameters(
                f.path,
                known_params={
                    "delimiter": parsing_options.get("delimiter"),
                    "decimal_separator": parsing_options.get("decimal_separator"),
                    "has_header": parsing_options.get("has_header"),
                }
            )
            f.num_rows = file_detection.n_rows
            f.num_columns = file_detection.n_columns
        except Exception:
            pass

    has_x = any(f.type == "X" for f in files)
    has_train = any(f.split == "train" for f in files)

    return UnifiedDetectionResponse(
        files=files,
        folder_name=folder_path.name,
        total_size_bytes=total_size,
        has_standard_structure=has_x and has_train,
        parsing_options=parsing_options,
        confidence=confidence,
        has_fold_file=has_fold_file,
        fold_file_path=fold_file_path,
        metadata_columns=metadata_columns,
        warnings=warnings,
    )


@router.post("/datasets/auto-detect")
async def auto_detect_file(request: AutoDetectRequest):
    """Auto-detect file parameters using nirs4all's AutoDetector."""
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(status_code=501, detail="nirs4all library not available")

    file_path = Path(request.path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    try:
        detection_result = detect_file_parameters(str(file_path))
        return {
            "success": True,
            "delimiter": detection_result.delimiter,
            "decimal_separator": detection_result.decimal_separator,
            "has_header": detection_result.has_header,
            "header_unit": detection_result.header_unit,
            "signal_type": detection_result.signal_type,
            "encoding": detection_result.encoding,
            "confidence": detection_result.confidence,
            "num_rows": detection_result.n_rows,
            "num_columns": detection_result.n_columns,
            "warnings": detection_result.warnings,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Auto-detection failed: {e}")


@router.post("/datasets/detect-format")
async def detect_format(request: DetectFormatRequest):
    """Detect file format and parameters using nirs4all's detector."""
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(status_code=501, detail="nirs4all library not available")

    file_path = Path(request.path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    try:
        file_format = _get_file_format(file_path)
        detection_result = detect_file_parameters(str(file_path))

        response = {
            "format": file_format,
            "detected_delimiter": detection_result.delimiter,
            "detected_decimal": detection_result.decimal_separator,
            "has_header": detection_result.has_header,
            "num_rows": detection_result.n_rows,
            "num_columns": detection_result.n_columns,
            "column_names": None,
            "sample_data": None,
            "sheet_names": None,
        }

        # Load sample data for CSV files
        if file_format == "csv" and request.sample_rows > 0:
            try:
                data, _, _, headers, _ = load_file(
                    str(file_path),
                    delimiter=detection_result.delimiter,
                    decimal_separator=detection_result.decimal_separator,
                    has_header=detection_result.has_header,
                    data_type="auto",
                )
                response["column_names"] = headers if headers else None
                # Convert sample rows to string format
                if data is not None and len(data) > 0:
                    sample_count = min(request.sample_rows, len(data))
                    sample_data = []
                    for row in data[:sample_count]:
                        sample_data.append([str(val) for val in row])
                    response["sample_data"] = sample_data
            except Exception:
                pass  # Sample data is optional

        # Get sheet names for Excel files
        if file_format in ("xlsx", "xls"):
            try:
                import openpyxl
                wb = openpyxl.load_workbook(str(file_path), read_only=True)
                response["sheet_names"] = wb.sheetnames
                wb.close()
            except Exception:
                pass

        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Format detection failed: {e}")


# ============= Preview Endpoints =============


@router.post("/datasets/preview", response_model=PreviewDataResponse)
async def preview_dataset(request: PreviewDataRequest):
    """Preview a dataset with current configuration using nirs4all."""
    if not NIRS4ALL_AVAILABLE:
        return PreviewDataResponse(success=False, error="nirs4all library not available")

    try:
        base_path = Path(request.path) if request.path else None

        missing_files = []
        for f in request.files:
            file_path = Path(f.path)
            if not file_path.is_absolute() and base_path:
                file_path = base_path / f.path
            if not file_path.exists():
                missing_files.append(str(f.path))

        if missing_files:
            return PreviewDataResponse(
                success=False,
                error=f"Files not found: {', '.join(missing_files[:3])}" +
                      (f" (and {len(missing_files) - 3} more)" if len(missing_files) > 3 else ""),
            )

        config = _build_nirs4all_config(request.files, request.parsing, base_path)

        try:
            dataset_configs = DatasetConfigs(config)
            datasets = dataset_configs.get_datasets()

            if not datasets:
                return PreviewDataResponse(
                    success=False,
                    error="No data could be loaded. Check file paths and parsing options.",
                )

            dataset = datasets[0]

            X = dataset.x({"partition": "train"}, layout="2d")
            if isinstance(X, list):
                X = X[0]

            if len(X) > request.max_samples:
                indices = np.linspace(0, len(X) - 1, request.max_samples, dtype=int)
                X = X[indices]

            try:
                wavelengths = dataset.headers(0)
                if wavelengths is None or len(wavelengths) == 0:
                    wavelengths = np.arange(X.shape[1])
                wavelengths = np.array(wavelengths, dtype=float)
            except Exception:
                wavelengths = np.arange(X.shape[1])

            spectra_preview = _compute_spectra_preview(X, wavelengths)

            target_distribution = None
            try:
                y = dataset.y({"partition": "train"})
                if y is not None and len(y) > 0:
                    target_distribution = _compute_target_distribution(y, dataset.is_regression)
            except Exception:
                pass

            train_samples = len(dataset.x({"partition": "train"}, layout="2d"))
            if isinstance(train_samples, list):
                train_samples = len(train_samples[0])

            test_samples = 0
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
                "metadata_columns": dataset.metadata_columns or [],
                "signal_type": dataset.signal_types[0].value if dataset.signal_types else None,
                "header_unit": dataset.header_unit(0) if hasattr(dataset, 'header_unit') else None,
            }

            return PreviewDataResponse(
                success=True,
                summary=summary,
                spectra_preview=spectra_preview,
                target_distribution=target_distribution,
            )

        except Exception as e:
            return PreviewDataResponse(success=False, error=f"Failed to load dataset: {e}")

    except Exception as e:
        return PreviewDataResponse(success=False, error=f"Preview failed: {e}")


@router.get("/datasets/{dataset_id}/preview", response_model=PreviewDataResponse)
async def preview_dataset_by_id(dataset_id: str, max_samples: int = 100):
    """Preview a linked dataset using its stored configuration."""
    if not NIRS4ALL_AVAILABLE:
        return PreviewDataResponse(success=False, error="nirs4all library not available")

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        return PreviewDataResponse(success=False, error="No workspace selected")

    dataset_info = next((d for d in workspace.datasets if d.get("id") == dataset_id), None)
    if not dataset_info:
        return PreviewDataResponse(success=False, error="Dataset not found")

    dataset_path = dataset_info.get("path", "")
    if not Path(dataset_path).exists():
        return PreviewDataResponse(success=False, error=f"Dataset path not found: {dataset_path}")

    stored_config = dataset_info.get("config", {})

    files = []
    for fc in stored_config.get("files", []):
        files.append(DatasetFileConfig(
            path=fc.get("path", ""),
            type=fc.get("type", "X"),
            split=fc.get("split", "train"),
            source=fc.get("source"),
            overrides=fc.get("overrides"),
        ))

    if not files and Path(dataset_path).is_dir():
        try:
            parser = FolderParser()
            result = parser.parse(dataset_path)
            if result.success and result.config:
                for key, (ftype, split) in [
                    ("train_x", ("X", "train")), ("test_x", ("X", "test")),
                    ("train_y", ("Y", "train")), ("test_y", ("Y", "test"))
                ]:
                    if result.config.get(key):
                        paths = result.config[key]
                        if isinstance(paths, str):
                            paths = [paths]
                        for p in paths:
                            files.append(DatasetFileConfig(path=p, type=ftype, split=split))
        except Exception:
            pass

    parsing = ParsingOptions(
        delimiter=stored_config.get("delimiter", ";"),
        decimal_separator=stored_config.get("decimal_separator", "."),
        has_header=stored_config.get("has_header", True),
        header_unit=stored_config.get("header_unit", "cm-1"),
        signal_type=stored_config.get("signal_type", "auto"),
    )

    return await preview_dataset(PreviewDataRequest(
        path=dataset_path,
        files=files,
        parsing=parsing,
        max_samples=max_samples,
    ))


# ============= Synthetic Presets =============


@router.get("/datasets/synthetic-presets")
async def get_synthetic_presets() -> Dict[str, List[SyntheticPresetInfo]]:
    """Get available presets for synthetic data generation."""
    presets = [
        SyntheticPresetInfo(id="regression_small", name="Regression (Small)", description="250 samples for quick testing", task_type="regression", n_samples=250, complexity="simple", icon="activity"),
        SyntheticPresetInfo(id="regression_medium", name="Regression (Medium)", description="1000 samples for model development", task_type="regression", n_samples=1000, complexity="realistic", icon="trending-up"),
        SyntheticPresetInfo(id="regression_large", name="Regression (Large)", description="2500 samples for full experiments", task_type="regression", n_samples=2500, complexity="realistic", icon="bar-chart-3"),
        SyntheticPresetInfo(id="classification_binary", name="Binary Classification", description="500 samples, 2 classes", task_type="binary_classification", n_samples=500, complexity="simple", icon="git-branch"),
        SyntheticPresetInfo(id="classification_multi", name="Multiclass Classification", description="750 samples, 3 classes", task_type="multiclass_classification", n_samples=750, complexity="simple", icon="layers"),
        SyntheticPresetInfo(id="complex_realistic", name="Complex Realistic", description="1500 samples with noise and batch effects", task_type="regression", n_samples=1500, complexity="complex", icon="cpu"),
    ]
    return {"presets": presets}


@router.post("/datasets/generate-synthetic", response_model=GenerateSyntheticResponse)
async def generate_synthetic_dataset(request: GenerateSyntheticRequest):
    """Generate a synthetic NIRS dataset using nirs4all.generate."""
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(status_code=501, detail="nirs4all library not available")

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    try:
        from nirs4all.data.synthetic import SyntheticDatasetBuilder

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if request.name:
            dataset_name = request.name
        else:
            task_prefix = "reg" if request.task_type == "regression" else f"cls{request.n_classes}"
            dataset_name = f"synthetic_{task_prefix}_{request.n_samples}_{timestamp}"

        workspace_path = Path(workspace.path)
        datasets_dir = workspace_path / "datasets" / "synthetic"
        datasets_dir.mkdir(parents=True, exist_ok=True)
        output_path = datasets_dir / dataset_name

        random_state = int(datetime.now().timestamp()) % 2**31

        builder = SyntheticDatasetBuilder(
            n_samples=request.n_samples,
            random_state=random_state,
            name=dataset_name,
        )

        feature_kwargs: Dict[str, Any] = {"complexity": request.complexity}
        if request.wavelength_range and len(request.wavelength_range) == 2:
            feature_kwargs["wavelength_range"] = tuple(request.wavelength_range)
        builder.with_features(**feature_kwargs)

        if request.task_type == "regression":
            if request.target_range and len(request.target_range) == 2:
                builder.with_targets(range=tuple(request.target_range))
        else:
            builder.with_classification(n_classes=request.n_classes, separation=1.0)

        builder.with_partitions(train_ratio=request.train_ratio)
        output_path = builder.export(str(output_path), format="standard")

        summary = {
            "task_type": request.task_type,
            "n_samples": request.n_samples,
            "complexity": request.complexity,
            "train_ratio": request.train_ratio,
            "n_classes": request.n_classes if request.task_type != "regression" else None,
            "generated_at": datetime.now().isoformat(),
        }

        try:
            x_train_file = output_path / "Xcal.csv"
            if x_train_file.exists():
                detection = detect_file_parameters(str(x_train_file))
                summary["num_features"] = detection.n_columns
                summary["train_samples"] = detection.n_rows
        except Exception:
            pass

        linked = False
        dataset_id = None

        if request.auto_link:
            try:
                link_config = {
                    "synthetic": True,
                    "generated_at": datetime.now().isoformat(),
                    "targets": [{"column": "target", "type": request.task_type, "is_default": True}],
                    "default_target": "target",
                }
                dataset_info = workspace_manager.link_dataset(str(output_path), config=link_config)
                linked = True
                dataset_id = dataset_info.get("id")
            except Exception as e:
                summary["link_error"] = str(e)

        return GenerateSyntheticResponse(
            success=True,
            dataset_id=dataset_id,
            name=dataset_name,
            path=str(output_path),
            summary=summary,
            linked=linked,
            message=f"Synthetic dataset '{dataset_name}' generated successfully" + (" and linked" if linked else ""),
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate synthetic dataset: {e}")


# ============= Dataset CRUD =============


@router.get("/datasets/{dataset_id}")
async def get_dataset(dataset_id: str):
    """Get detailed information about a specific dataset."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    dataset = next((d for d in workspace.datasets if d.get("id") == dataset_id), None)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    extended_info = dict(dataset)

    if NIRS4ALL_AVAILABLE:
        try:
            from .spectra import _load_dataset
            ds = _load_dataset(dataset_id)
            if ds:
                task_type_str = str(ds.task_type).split(".")[-1].lower() if ds.task_type else None
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
        except Exception as e:
            extended_info["load_warning"] = str(e)

    return {"dataset": extended_info}


@router.put("/datasets/{dataset_id}")
async def update_dataset(dataset_id: str, name: Optional[str] = None, description: Optional[str] = None, config: Optional[Dict[str, Any]] = None):
    """Update a dataset's configuration."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    updates = {}
    if name is not None:
        updates["name"] = name
    if description is not None:
        updates["description"] = description
    if config is not None:
        updates["config"] = config

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updated_dataset = workspace_manager.update_dataset(dataset_id, updates)
    if not updated_dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    return {"success": True, "dataset": updated_dataset}


@router.delete("/datasets/{dataset_id}")
async def delete_dataset(dataset_id: str, delete_files: bool = False):
    """Remove a dataset from the workspace."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    dataset = next((d for d in workspace.datasets if d.get("id") == dataset_id), None)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        from .spectra import _clear_dataset_cache
        _clear_dataset_cache(dataset_id)
    except Exception:
        pass

    if delete_files:
        path = Path(dataset.get("path", ""))
        if path.exists():
            import shutil
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()

    success = workspace_manager.unlink_dataset(dataset_id)
    if not success:
        raise HTTPException(status_code=404, detail="Dataset not found in workspace")

    return {"success": True, "message": f"Dataset {dataset_id} removed" + (" (files deleted)" if delete_files else "")}


@router.post("/datasets/{dataset_id}/load")
async def load_dataset(dataset_id: str):
    """Load a dataset into memory. Returns dataset summary."""
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(status_code=501, detail="nirs4all library not available")

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    dataset_info = next((d for d in workspace.datasets if d.get("id") == dataset_id), None)
    if not dataset_info:
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        from .spectra import _load_dataset, _clear_dataset_cache
        _clear_dataset_cache(dataset_id)
        ds = _load_dataset(dataset_id)
        if not ds:
            raise HTTPException(status_code=500, detail="Failed to load dataset")

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
        raise HTTPException(status_code=500, detail=f"Failed to load dataset: {e}")


@router.get("/datasets/{dataset_id}/stats")
async def get_dataset_stats(dataset_id: str, partition: str = "train"):
    """Get statistics for a dataset."""
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(status_code=501, detail="nirs4all library not available")

    try:
        from .spectra import _load_dataset
        dataset = _load_dataset(dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        X = dataset.x({"partition": partition}, layout="2d")
        if isinstance(X, list):
            X = X[0]

        global_stats = {
            "num_samples": X.shape[0],
            "num_features": X.shape[1],
            "global_mean": float(np.mean(X)),
            "global_std": float(np.std(X)),
            "global_min": float(np.min(X)),
            "global_max": float(np.max(X)),
        }

        target_stats = None
        try:
            y = dataset.y({"partition": partition})
            if y is not None and len(y) > 0:
                target_stats = _compute_target_distribution(y, dataset.is_regression)
        except Exception:
            pass

        return {
            "dataset_id": dataset_id,
            "partition": partition,
            "global": global_stats,
            "targets": target_stats,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute statistics: {e}")


# ============= Version/Hash Support =============


@router.post("/datasets/{dataset_id}/verify")
async def verify_dataset(dataset_id: str):
    """Verify dataset integrity."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    dataset_info = next((d for d in workspace.datasets if d.get("id") == dataset_id), None)
    if not dataset_info:
        raise HTTPException(status_code=404, detail="Dataset not found")

    dataset_path = Path(dataset_info.get("path", ""))
    now = datetime.now().isoformat()

    if not dataset_path.exists():
        workspace_manager.update_dataset(dataset_id, {
            "version_status": "missing",
            "last_verified": now,
        })
        return {
            "success": True,
            "dataset_id": dataset_id,
            "version_status": "missing",
            "verified_at": now,
        }

    hasher = hashlib.sha256()
    if dataset_path.is_dir():
        for f in sorted(dataset_path.rglob("*.csv")):
            hasher.update(f"{f.name}:{f.stat().st_mtime}".encode())
    else:
        hasher.update(f"{dataset_path.name}:{dataset_path.stat().st_mtime}".encode())
    current_hash = hasher.hexdigest()[:16]

    stored_hash = dataset_info.get("hash")

    if stored_hash is None:
        version_status = "unchecked"
    elif current_hash == stored_hash:
        version_status = "current"
    else:
        version_status = "modified"

    workspace_manager.update_dataset(dataset_id, {
        "version_status": version_status,
        "last_verified": now,
    })

    return {
        "success": True,
        "dataset_id": dataset_id,
        "version_status": version_status,
        "current_hash": current_hash,
        "stored_hash": stored_hash,
        "is_modified": version_status == "modified",
        "verified_at": now,
    }


@router.post("/datasets/{dataset_id}/refresh")
async def refresh_dataset_version(dataset_id: str):
    """Accept dataset changes and update stored hash."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    dataset_info = next((d for d in workspace.datasets if d.get("id") == dataset_id), None)
    if not dataset_info:
        raise HTTPException(status_code=404, detail="Dataset not found")

    dataset_path = Path(dataset_info.get("path", ""))
    if not dataset_path.exists():
        raise HTTPException(status_code=404, detail="Dataset path not found")

    now = datetime.now().isoformat()

    hasher = hashlib.sha256()
    if dataset_path.is_dir():
        for f in sorted(dataset_path.rglob("*.csv")):
            hasher.update(f"{f.name}:{f.stat().st_mtime}".encode())
    else:
        hasher.update(f"{dataset_path.name}:{dataset_path.stat().st_mtime}".encode())
    new_hash = hasher.hexdigest()[:16]

    old_hash = dataset_info.get("hash")
    old_version = dataset_info.get("version", 0)

    workspace_manager.update_dataset(dataset_id, {
        "hash": new_hash,
        "version": old_version + 1,
        "version_status": "current",
        "last_verified": now,
        "last_refreshed": now,
    })

    try:
        from .spectra import _clear_dataset_cache
        _clear_dataset_cache(dataset_id)
    except Exception:
        pass

    return {
        "success": True,
        "dataset_id": dataset_id,
        "old_hash": old_hash,
        "new_hash": new_hash,
        "version": old_version + 1,
        "refreshed_at": now,
    }
