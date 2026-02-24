"""
Pipelines API routes for nirs4all webapp.

This module provides FastAPI routes for pipeline management,
including CRUD operations and operator listing from nirs4all.

Phase 2 Implementation:
- Dynamic operator discovery from CONTROLLER_REGISTRY
- Parameter schema extraction via introspection
- Pipeline validation against registered operators
- Pipeline execution preparation
"""

from __future__ import annotations

import inspect
import json
from datetime import datetime
from enum import Enum, StrEnum
from pathlib import Path
from typing import Any, Dict, List, Optional, Type, get_type_hints

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .shared.logger import get_logger
from .workspace_manager import workspace_manager

logger = get_logger(__name__)

# nirs4all imports are lazy-loaded via api/lazy_imports.py to speed up backend startup.
from .lazy_imports import get_cached, is_ml_ready, require_ml_ready

NIRS4ALL_AVAILABLE = True  # Assume available, endpoints guard via require_ml_ready()


class OperatorCategory(StrEnum):
    """Categories for pipeline operators."""
    PREPROCESSING = "preprocessing"
    SPLITTING = "splitting"
    MODELS = "models"
    METRICS = "metrics"
    AUGMENTATION = "augmentation"
    FEATURE_SELECTION = "feature_selection"
    CHARTS = "charts"
    FILTERS = "filters"
    SIGNAL_CONVERSION = "signal_conversion"


class PipelineCreate(BaseModel):
    name: str
    description: str | None = None
    steps: list[dict[str, Any]] = []
    category: str | None = "user"
    task_type: str | None = None  # regression, classification


class PipelineUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    steps: list[dict[str, Any]] | None = None
    is_favorite: bool | None = None
    task_type: str | None = None


class PipelineValidateRequest(BaseModel):
    """Request model for validating a pipeline configuration."""

    steps: list[dict[str, Any]]


class PipelineCountRequest(BaseModel):
    """Request model for counting pipeline variants."""
    steps: list[dict[str, Any]]


class PipelineExecuteRequest(BaseModel):
    """Request model for preparing pipeline execution."""

    dataset_id: str
    partition: str = "train"
    dry_run: bool = False


router = APIRouter()


def _get_pipelines_dir() -> Path:
    """Get the pipelines directory for the current workspace."""
    pipelines_path = workspace_manager.get_pipelines_path()
    if not pipelines_path:
        raise HTTPException(status_code=409, detail="No workspace selected")
    path = Path(pipelines_path)
    path.mkdir(exist_ok=True)
    return path


def _load_pipeline(pipeline_id: str) -> dict[str, Any]:
    """Load a pipeline from file."""
    pipelines_dir = _get_pipelines_dir()
    pipeline_file = pipelines_dir / f"{pipeline_id}.json"

    if not pipeline_file.exists():
        raise HTTPException(status_code=404, detail="Pipeline not found")

    try:
        with open(pipeline_file, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to load pipeline: {str(e)}"
        )


def _save_pipeline(pipeline: dict[str, Any]) -> None:
    """Save a pipeline to file."""
    pipelines_dir = _get_pipelines_dir()
    pipeline_file = pipelines_dir / f"{pipeline['id']}.json"

    try:
        with open(pipeline_file, "w", encoding="utf-8") as f:
            json.dump(pipeline, f, indent=2)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to save pipeline: {str(e)}"
        )


@router.get("/pipelines")
async def list_pipelines():
    """List all pipelines in the current workspace."""
    try:
        pipelines_dir = _get_pipelines_dir()
        pipelines = []

        for pipeline_file in pipelines_dir.glob("*.json"):
            try:
                with open(pipeline_file, encoding="utf-8") as f:
                    pipeline = json.load(f)
                    pipelines.append(pipeline)
            except Exception:
                continue

        # Sort by updated_at descending
        pipelines.sort(key=lambda p: p.get("updated_at", ""), reverse=True)

        return {"pipelines": pipelines}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to list pipelines: {str(e)}"
        )


@router.get("/pipelines/presets")
async def get_pipeline_presets():
    """
    Get predefined pipeline presets/templates.

    Returns common pipeline configurations for different use cases.
    """
    presets = [
        {
            "id": "pls_basic",
            "name": "Basic PLS Pipeline",
            "description": "Simple PLS regression with SNV preprocessing",
            "task_type": "regression",
            "steps": [
                {"name": "StandardNormalVariate", "type": "preprocessing", "params": {}},
                {"name": "KFold", "type": "splitting", "params": {"n_splits": 5}},
                {"name": "PLSRegression", "type": "model", "params": {"n_components": 10}},
            ],
        },
        {
            "id": "pls_derivative",
            "name": "PLS with Derivative",
            "description": "PLS regression with first derivative preprocessing",
            "task_type": "regression",
            "steps": [
                {"name": "SavitzkyGolay", "type": "preprocessing", "params": {"window_length": 11, "polyorder": 2, "deriv": 1}},
                {"name": "StandardNormalVariate", "type": "preprocessing", "params": {}},
                {"name": "KFold", "type": "splitting", "params": {"n_splits": 5}},
                {"name": "PLSRegression", "type": "model", "params": {"n_components": 15}},
            ],
        },
        {
            "id": "rf_standard",
            "name": "Random Forest Pipeline",
            "description": "Random Forest with standard preprocessing",
            "task_type": "regression",
            "steps": [
                {"name": "StandardScaler", "type": "preprocessing", "params": {}},
                {"name": "KFold", "type": "splitting", "params": {"n_splits": 5}},
                {"name": "RandomForestRegressor", "type": "model", "params": {"n_estimators": 100}},
            ],
        },
        {
            "id": "kennard_stone_pls",
            "name": "Kennard-Stone PLS",
            "description": "PLS with Kennard-Stone sample selection",
            "task_type": "regression",
            "steps": [
                {"name": "MultiplicativeScatterCorrection", "type": "preprocessing", "params": {}},
                {"name": "KennardStoneSplitter", "type": "splitting", "params": {"test_size": 0.2}},
                {"name": "PLSRegression", "type": "model", "params": {"n_components": 10}},
            ],
        },
        {
            "id": "advanced_nirs",
            "name": "Advanced NIRS Pipeline",
            "description": "Comprehensive NIRS preprocessing with OPLS",
            "task_type": "regression",
            "steps": [
                {"name": "ASLSBaseline", "type": "preprocessing", "params": {"lam": 1e6, "p": 0.01}},
                {"name": "StandardNormalVariate", "type": "preprocessing", "params": {}},
                {"name": "SavitzkyGolay", "type": "preprocessing", "params": {"window_length": 15, "polyorder": 2, "deriv": 1}},
                {"name": "SPXYGFold", "type": "splitting", "params": {"n_splits": 5}},
                {"name": "OPLS", "type": "model", "params": {"n_components": 10}},
            ],
        },
    ]

    return {
        "presets": presets,
        "total": len(presets),
    }


# ============================================================================
# NOTE: Routes with static paths MUST be defined BEFORE routes with path parameters!
# The routes below forward to their implementations defined later in the file.
# This is necessary because FastAPI matches routes in order of definition.
# ============================================================================


@router.get("/pipelines/operators")
async def list_operators_forward():
    """Forward to the list_operators implementation."""
    return await _list_operators_impl()


@router.post("/pipelines/validate")
async def validate_pipeline_forward(request: PipelineValidateRequest):
    """Forward to the validate_pipeline implementation."""
    return await _validate_pipeline_impl(request)


@router.post("/pipelines/count-variants")
async def count_variants_forward(request: PipelineCountRequest):
    """Forward to the count_pipeline_variants implementation."""
    return await _count_variants_impl(request)


# ============================================================================


@router.get("/pipelines/{pipeline_id}")
async def get_pipeline(pipeline_id: str):
    """Get a specific pipeline by ID."""
    pipeline = _load_pipeline(pipeline_id)
    return {"pipeline": pipeline}


@router.post("/pipelines")
async def create_pipeline(pipeline_data: PipelineCreate):
    """Create a new pipeline."""
    try:
        now = datetime.now().isoformat()
        pipeline_id = f"pipeline_{int(datetime.now().timestamp())}"

        pipeline = {
            "id": pipeline_id,
            "name": pipeline_data.name,
            "description": pipeline_data.description or "",
            "category": pipeline_data.category,
            "steps": pipeline_data.steps,
            "is_favorite": False,
            "created_at": now,
            "updated_at": now,
        }

        _save_pipeline(pipeline)

        return {"success": True, "pipeline": pipeline}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to create pipeline: {str(e)}"
        )


@router.put("/pipelines/{pipeline_id}")
async def update_pipeline(pipeline_id: str, update_data: PipelineUpdate):
    """Update an existing pipeline."""
    try:
        pipeline = _load_pipeline(pipeline_id)

        if update_data.name is not None:
            pipeline["name"] = update_data.name
        if update_data.description is not None:
            pipeline["description"] = update_data.description
        if update_data.steps is not None:
            pipeline["steps"] = update_data.steps
        if update_data.is_favorite is not None:
            pipeline["is_favorite"] = update_data.is_favorite

        pipeline["updated_at"] = datetime.now().isoformat()

        _save_pipeline(pipeline)

        return {"success": True, "pipeline": pipeline}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update pipeline: {str(e)}"
        )


@router.delete("/pipelines/{pipeline_id}")
async def delete_pipeline(pipeline_id: str):
    """Delete a pipeline."""
    try:
        pipelines_dir = _get_pipelines_dir()
        pipeline_file = pipelines_dir / f"{pipeline_id}.json"

        if not pipeline_file.exists():
            raise HTTPException(status_code=404, detail="Pipeline not found")

        pipeline_file.unlink()

        return {"success": True, "message": "Pipeline deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete pipeline: {str(e)}"
        )


@router.post("/pipelines/{pipeline_id}/clone")
async def clone_pipeline(pipeline_id: str, new_name: str | None = None):
    """Clone an existing pipeline."""
    try:
        original = _load_pipeline(pipeline_id)

        now = datetime.now().isoformat()
        new_id = f"pipeline_{int(datetime.now().timestamp())}"

        cloned = {
            **original,
            "id": new_id,
            "name": new_name or f"{original['name']} (Copy)",
            "is_favorite": False,
            "created_at": now,
            "updated_at": now,
        }

        _save_pipeline(cloned)

        return {"success": True, "pipeline": cloned}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to clone pipeline: {str(e)}"
        )


# Implementation function - called by forwarding route defined earlier
async def _list_operators_impl():
    """
    List all available operators for pipeline building.

    Uses dynamic discovery from nirs4all modules. Delegates to
    the _discover_*_operators() functions which use introspection.
    """
    if NIRS4ALL_AVAILABLE:
        # Use dynamic discovery functions (defined later in file)
        operators = {
            "preprocessing": _discover_transform_operators(),
            "splitting": _discover_splitter_operators(),
            "models": _discover_model_operators(),
            "augmentation": _discover_augmentation_operators(),
            "metrics": _discover_metric_operators(),
            "feature_selection": _discover_feature_selection_operators(),
            "filters": _discover_filter_operators(),
        }
    else:
        # Minimal fallback when nirs4all not available
        operators = {
            "preprocessing": [
                {"name": "StandardScaler", "display_name": "Standard Scaler", "description": "Standardize features", "params": {}, "source": "sklearn"},
                {"name": "MinMaxScaler", "display_name": "Min-Max Scaler", "description": "Scale features to [0, 1]", "params": {}, "source": "sklearn"},
            ],
            "splitting": [
                {"name": "KFold", "display_name": "K-Fold CV", "description": "K-Fold cross-validation", "params": {"n_splits": {"type": "int", "default": 5}}, "source": "sklearn"},
            ],
            "models": [
                {"name": "PLSRegression", "display_name": "PLS Regression", "description": "Partial Least Squares", "params": {"n_components": {"type": "int", "default": 10}}, "source": "sklearn"},
            ],
            "augmentation": [],
            "metrics": [],
            "feature_selection": [],
            "filters": [],
        }

    # Count totals
    total = sum(len(ops) for ops in operators.values())

    return {"operators": operators, "total": total, "nirs4all_available": NIRS4ALL_AVAILABLE}


# Implementation function - called by forwarding route defined earlier
async def _validate_pipeline_impl(request: PipelineValidateRequest):
    """
    Validate a pipeline configuration using nirs4all's validate_spec().

    Checks that all operators exist and parameters are valid.
    Returns validation results with any errors or warnings.
    """
    _validate_spec = get_cached("validate_spec")
    if not is_ml_ready() or _validate_spec is None:
        # Fallback: basic validation
        return {
            "valid": True,
            "steps": [{"index": i, "name": s.get("name", "unknown"), "valid": True, "errors": [], "warnings": []} for i, s in enumerate(request.steps)],
            "errors": [],
            "warnings": ["nirs4all not available for full validation"],
        }

    # Convert frontend steps to nirs4all format for validation
    nirs4all_steps = _convert_frontend_steps_to_nirs4all(request.steps)

    # Use nirs4all's validate_spec
    validation_result = _validate_spec(nirs4all_steps)

    # Convert ValidationResult to API response format
    errors = [str(e) for e in validation_result.errors]
    warnings = [str(w) for w in validation_result.warnings]

    # Build per-step results
    step_results = []
    for i, step in enumerate(request.steps):
        step_errors = [e for e in errors if f"[{i}]" in e or f"Step {i}" in e]
        step_warnings = [w for w in warnings if f"[{i}]" in w or f"Step {i}" in w]

        step_results.append({
            "index": i,
            "name": step.get("name", "unknown"),
            "type": step.get("type", "unknown"),
            "valid": len(step_errors) == 0,
            "errors": step_errors,
            "warnings": step_warnings,
        })

    return {
        "valid": validation_result.is_valid,
        "steps": step_results,
        "errors": errors,
        "warnings": warnings,
        "node_count": validation_result.node_count,
        "generator_count": validation_result.generator_count,
    }

# ============= Phase 2: Dynamic Operator Discovery =============


def _extract_params_from_class(cls: type) -> dict[str, Any]:
    """
    Extract parameter schema from a class's __init__ signature.

    Returns a dictionary mapping parameter names to their metadata.
    """
    params = {}

    try:
        sig = inspect.signature(cls.__init__)
        hints = {}
        try:
            hints = get_type_hints(cls.__init__)
        except Exception:
            pass

        for name, param in sig.parameters.items():
            if name in ("self", "args", "kwargs"):
                continue

            param_info = {"required": param.default is inspect.Parameter.empty}

            # Get default value
            if param.default is not inspect.Parameter.empty:
                param_info["default"] = param.default

            # Get type from annotation or hints
            annotation = hints.get(name) or param.annotation
            if annotation is not inspect.Parameter.empty:
                param_info["type"] = _annotation_to_type_string(annotation)

            params[name] = param_info

    except Exception:
        # Fallback: return empty params
        pass

    return params


def _annotation_to_type_string(annotation) -> str:
    """Convert type annotation to string representation."""
    if annotation is None:
        return "null"

    type_map = {
        int: "int",
        float: "float",
        str: "str",
        bool: "bool",
        list: "array",
        dict: "object",
        type(None): "null",
    }

    if annotation in type_map:
        return type_map[annotation]

    # Handle typing module types
    origin = getattr(annotation, "__origin__", None)
    if origin is not None:
        if origin is list:
            return "array"
        if origin is dict:
            return "object"
        if hasattr(origin, "__name__"):
            return origin.__name__.lower()

    if hasattr(annotation, "__name__"):
        return annotation.__name__.lower()

    return "any"


def _discover_transform_operators() -> list[dict[str, Any]]:
    """
    Dynamically discover preprocessing transforms from nirs4all.

    Returns a list of operator info dictionaries.
    """
    operators = []

    if not NIRS4ALL_AVAILABLE:
        return operators

    try:
        from nirs4all.operators import transforms as tf_module

        # List of known transform classes to expose
        transform_classes = [
            # NIRS preprocessing
            "StandardNormalVariate",
            "LocalStandardNormalVariate",
            "RobustStandardNormalVariate",
            "MultiplicativeScatterCorrection",
            "SavitzkyGolay",
            "Wavelet",
            "Haar",
            "FirstDerivative",
            "SecondDerivative",
            "LogTransform",
            "ReflectanceToAbsorbance",
            # Baseline correction
            "ASLSBaseline",
            "AirPLS",
            "ArPLS",
            "SNIP",
            "IModPoly",
            "ModPoly",
            # Signal processing
            "Baseline",
            "Detrend",
            "Gaussian",
            "Normalize",
            # Features
            "CropTransformer",
            "ResampleTransformer",
            "Resampler",
            # Signal conversion
            "ToAbsorbance",
            "FromAbsorbance",
            "PercentToFraction",
            "FractionToPercent",
            "KubelkaMunk",
        ]

        for name in transform_classes:
            cls = getattr(tf_module, name, None)
            if cls is None:
                continue

            params = _extract_params_from_class(cls)

            # Get docstring for description
            description = ""
            if cls.__doc__:
                description = cls.__doc__.strip().split("\n")[0]

            operators.append({
                "name": name,
                "display_name": _class_name_to_display(name),
                "description": description or f"{name} transform",
                "params": params,
                "category": _categorize_transform(name),
                "source": "nirs4all",
            })

    except Exception as e:
        logger.error("Error discovering transforms: %s", e)

    return operators


def _discover_splitter_operators() -> list[dict[str, Any]]:
    """Dynamically discover splitter operators from nirs4all."""
    operators = []

    if not NIRS4ALL_AVAILABLE:
        return operators

    try:
        from nirs4all.operators import splitters as sp_module

        splitter_classes = [
            "KennardStoneSplitter",
            "SPXYSplitter",
            "SPXYGFold",
            "KMeansSplitter",
            "KBinsStratifiedSplitter",
            "BinnedStratifiedGroupKFold",
        ]

        for name in splitter_classes:
            cls = getattr(sp_module, name, None)
            if cls is None:
                continue

            params = _extract_params_from_class(cls)
            description = ""
            if cls.__doc__:
                description = cls.__doc__.strip().split("\n")[0]

            operators.append({
                "name": name,
                "display_name": _class_name_to_display(name),
                "description": description or f"{name} splitter",
                "params": params,
                "source": "nirs4all",
            })

    except Exception as e:
        logger.error("Error discovering splitters: %s", e)

    return operators


def _discover_model_operators() -> list[dict[str, Any]]:
    """Dynamically discover model operators from nirs4all."""
    operators = []

    if not NIRS4ALL_AVAILABLE:
        return operators

    try:
        from nirs4all.operators import models as model_module

        model_classes = [
            "IKPLS",
            "OPLS",
            "OPLSDA",
            "PLSDA",
            "MBPLS",
            "DiPLS",
            "SparsePLS",
            "SIMPLS",
            "LWPLS",
            "IntervalPLS",
            "RobustPLS",
            "RecursivePLS",
            "KOPLS",
            "KernelPLS",
            "NLPLS",
            "KPLS",
            "OKLMPLS",
            "FCKPLS",
        ]

        for name in model_classes:
            cls = getattr(model_module, name, None)
            if cls is None:
                continue

            params = _extract_params_from_class(cls)
            description = ""
            if cls.__doc__:
                description = cls.__doc__.strip().split("\n")[0]

            operators.append({
                "name": name,
                "display_name": _class_name_to_display(name),
                "description": description or f"{name} model",
                "params": params,
                "source": "nirs4all",
            })

    except Exception as e:
        logger.error("Error discovering models: %s", e)

    return operators


def _discover_augmentation_operators() -> list[dict[str, Any]]:
    """Dynamically discover data augmentation operators from nirs4all."""
    operators = []

    if not NIRS4ALL_AVAILABLE:
        return operators

    try:
        from nirs4all.operators import transforms as tf_module

        augmenter_classes = [
            "GaussianAdditiveNoise",
            "MultiplicativeNoise",
            "LinearBaselineDrift",
            "PolynomialBaselineDrift",
            "WavelengthShift",
            "WavelengthStretch",
            "LocalWavelengthWarp",
            "SmoothMagnitudeWarp",
            "BandPerturbation",
            "GaussianSmoothingJitter",
            "UnsharpSpectralMask",
            "BandMasking",
            "ChannelDropout",
            "SpikeNoise",
            "LocalClipping",
            "MixupAugmenter",
            "LocalMixupAugmenter",
            "ScatterSimulationMSC",
            "Spline_Smoothing",
            "Spline_X_Perturbations",
            "Spline_Y_Perturbations",
        ]

        for name in augmenter_classes:
            cls = getattr(tf_module, name, None)
            if cls is None:
                continue

            params = _extract_params_from_class(cls)
            description = ""
            if cls.__doc__:
                description = cls.__doc__.strip().split("\n")[0]

            operators.append({
                "name": name,
                "display_name": _class_name_to_display(name),
                "description": description or f"{name} augmentation",
                "params": params,
                "source": "nirs4all",
            })

    except Exception as e:
        logger.error("Error discovering augmenters: %s", e)

    return operators


def _discover_metric_operators() -> list[dict[str, Any]]:
    """Dynamically discover metric operators from nirs4all."""
    operators = []

    if not NIRS4ALL_AVAILABLE:
        return operators

    try:
        from nirs4all.core import metrics as metrics_module

        # Get available metrics
        if hasattr(metrics_module, 'METRIC_FUNCTIONS'):
            for name, func in metrics_module.METRIC_FUNCTIONS.items():
                description = func.__doc__.strip().split("\n")[0] if func.__doc__ else f"{name} metric"
                operators.append({
                    "name": name,
                    "display_name": _class_name_to_display(name),
                    "description": description,
                    "params": {},
                    "source": "nirs4all",
                })
        else:
            # Fallback: common metrics
            metric_info = [
                ("r2", "R2 Score", "Coefficient of determination"),
                ("rmse", "RMSE", "Root Mean Square Error"),
                ("mae", "MAE", "Mean Absolute Error"),
                ("mse", "MSE", "Mean Square Error"),
                ("rpd", "RPD", "Ratio of Performance to Deviation"),
                ("rpiq", "RPIQ", "Ratio of Performance to IQR"),
                ("bias", "Bias", "Mean prediction bias"),
            ]
            for name, display, desc in metric_info:
                operators.append({
                    "name": name,
                    "display_name": display,
                    "description": desc,
                    "params": {},
                    "source": "nirs4all",
                })
    except Exception as e:
        logger.error("Error discovering metrics: %s", e)

    return operators


def _discover_feature_selection_operators() -> list[dict[str, Any]]:
    """Dynamically discover feature selection operators from nirs4all."""
    operators = []

    if not NIRS4ALL_AVAILABLE:
        return operators

    try:
        from nirs4all.operators import feature_selection as fs_module

        fs_classes = [
            "CARS",
            "MCUVE",
            "VIP",
            "SPA",
            "iPLS",
            "GA",
            "UVE",
        ]

        for name in fs_classes:
            cls = getattr(fs_module, name, None)
            if cls is None:
                continue

            params = _extract_params_from_class(cls)
            description = ""
            if cls.__doc__:
                description = cls.__doc__.strip().split("\n")[0]

            operators.append({
                "name": name,
                "display_name": _class_name_to_display(name),
                "description": description or f"{name} feature selection",
                "params": params,
                "source": "nirs4all",
            })
    except Exception as e:
        logger.error("Error discovering feature selection: %s", e)

    return operators


def _discover_filter_operators() -> list[dict[str, Any]]:
    """Dynamically discover filter operators from nirs4all."""
    operators = []

    if not NIRS4ALL_AVAILABLE:
        return operators

    try:
        from nirs4all.operators import filters as filter_module

        filter_classes = [
            "XOutlierFilter",
            "YOutlierFilter",
            "MetadataFilter",
            "SpectralQualityFilter",
            "HighLeverageFilter",
        ]

        for name in filter_classes:
            cls = getattr(filter_module, name, None)
            if cls is None:
                continue

            params = _extract_params_from_class(cls)
            description = ""
            if cls.__doc__:
                description = cls.__doc__.strip().split("\n")[0]

            operators.append({
                "name": name,
                "display_name": _class_name_to_display(name),
                "description": description or f"{name} filter",
                "params": params,
                "source": "nirs4all",
            })
    except Exception as e:
        logger.error("Error discovering filters: %s", e)

    return operators


def _class_name_to_display(name: str) -> str:
    """Convert class name to display-friendly name."""
    # Handle common abbreviations
    abbreviations = {
        "SNV": "SNV",
        "MSC": "MSC",
        "PLS": "PLS",
        "SVM": "SVM",
        "KNN": "KNN",
        "ASLS": "ASLS",
        "ArPLS": "ArPLS",
        "AirPLS": "AirPLS",
        "SNIP": "SNIP",
    }

    for abbr in abbreviations:
        if name.upper() == abbr.upper():
            return abbreviations[abbr]

    # Insert spaces before capital letters
    import re
    result = re.sub(r"([A-Z])", r" \1", name).strip()
    return result


def _categorize_transform(name: str) -> str:
    """Categorize a transform by name."""
    name_lower = name.lower()

    if any(x in name_lower for x in ["snv", "msc", "scatter"]):
        return "scatter_correction"
    if any(x in name_lower for x in ["derivative", "deriv"]):
        return "derivative"
    if any(x in name_lower for x in ["baseline", "asls", "airpls", "arpls", "snip"]):
        return "baseline"
    if any(x in name_lower for x in ["gaussian", "smooth", "savgol", "savitzky"]):
        return "smoothing"
    if any(x in name_lower for x in ["normalize", "scaler", "scale"]):
        return "scaling"
    if any(x in name_lower for x in ["wavelet", "haar"]):
        return "wavelet"
    if any(x in name_lower for x in ["absorbance", "reflectance", "convert"]):
        return "conversion"
    if any(x in name_lower for x in ["crop", "resample"]):
        return "features"

    return "other"


def _discover_sklearn_operators() -> dict[str, list[dict[str, Any]]]:
    """
    Dynamically discover sklearn operators via introspection.

    Returns operators grouped by category: models, preprocessing, splitting.
    """
    result = {"models": [], "preprocessing": [], "splitting": []}

    try:
        # Models - common sklearn regressors
        from sklearn.cross_decomposition import PLSRegression
        from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
        from sklearn.linear_model import ElasticNet, Lasso, Ridge
        from sklearn.svm import SVR

        model_classes = [
            (PLSRegression, "PLS Regression"),
            (RandomForestRegressor, "Random Forest Regressor"),
            (GradientBoostingRegressor, "Gradient Boosting"),
            (SVR, "Support Vector Regression"),
            (Ridge, "Ridge Regression"),
            (Lasso, "Lasso Regression"),
            (ElasticNet, "Elastic Net"),
        ]

        for cls, display_name in model_classes:
            params = _extract_params_from_class(cls)
            description = cls.__doc__.strip().split("\n")[0] if cls.__doc__ else display_name
            result["models"].append({
                "name": cls.__name__,
                "display_name": display_name,
                "description": description,
                "params": params,
                "source": "sklearn",
            })

        # Preprocessing - sklearn scalers
        from sklearn.preprocessing import MinMaxScaler, RobustScaler, StandardScaler

        scaler_classes = [
            (StandardScaler, "Standard Scaler"),
            (MinMaxScaler, "Min-Max Scaler"),
            (RobustScaler, "Robust Scaler"),
        ]

        for cls, display_name in scaler_classes:
            params = _extract_params_from_class(cls)
            description = cls.__doc__.strip().split("\n")[0] if cls.__doc__ else display_name
            result["preprocessing"].append({
                "name": cls.__name__,
                "display_name": display_name,
                "description": description,
                "params": params,
                "source": "sklearn",
                "category": "scaling",
            })

        # Splitting - sklearn CV splitters
        from sklearn.model_selection import KFold, ShuffleSplit, StratifiedKFold

        splitter_classes = [
            (KFold, "K-Fold CV"),
            (StratifiedKFold, "Stratified K-Fold"),
            (ShuffleSplit, "Shuffle Split"),
        ]

        for cls, display_name in splitter_classes:
            params = _extract_params_from_class(cls)
            description = cls.__doc__.strip().split("\n")[0] if cls.__doc__ else display_name
            result["splitting"].append({
                "name": cls.__name__,
                "display_name": display_name,
                "description": description,
                "params": params,
                "source": "sklearn",
            })

    except ImportError as e:
        logger.error("Error discovering sklearn operators: %s", e)

    return result


@router.get("/pipelines/operators/discover")
async def discover_operators():
    """
    Dynamically discover all operators from nirs4all and sklearn modules.

    Uses introspection to extract parameters and documentation.
    """
    discovered = {
        "preprocessing": _discover_transform_operators(),
        "splitting": _discover_splitter_operators(),
        "models": _discover_model_operators(),
        "augmentation": _discover_augmentation_operators(),
        "feature_selection": _discover_feature_selection_operators(),
        "filters": _discover_filter_operators(),
        "metrics": _discover_metric_operators(),
    }

    # Add sklearn operators via dynamic discovery
    sklearn_ops = _discover_sklearn_operators()
    discovered["models"].extend(sklearn_ops["models"])
    discovered["preprocessing"].extend(sklearn_ops["preprocessing"])
    discovered["splitting"].extend(sklearn_ops["splitting"])

    # Count totals
    total = sum(len(ops) for ops in discovered.values())

    return {
        "operators": discovered,
        "total": total,
        "nirs4all_available": NIRS4ALL_AVAILABLE,
        "categories": list(discovered.keys()),
    }


@router.get("/pipelines/operators/{operator_name}")
async def get_operator_details(operator_name: str):
    """
    Get detailed information about a specific operator.

    Returns parameter schema, docstring, and examples.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available for operator introspection",
        )

    operator_info = None
    operator_cls = None

    # Search in transforms
    try:
        from nirs4all.operators import transforms as tf_module
        operator_cls = getattr(tf_module, operator_name, None)
        if operator_cls:
            operator_info = {
                "name": operator_name,
                "module": "transforms",
                "type": "preprocessing",
            }
    except Exception:
        pass

    # Search in splitters
    if not operator_cls:
        try:
            from nirs4all.operators import splitters as sp_module
            operator_cls = getattr(sp_module, operator_name, None)
            if operator_cls:
                operator_info = {
                    "name": operator_name,
                    "module": "splitters",
                    "type": "splitting",
                }
        except Exception:
            pass

    # Search in models
    if not operator_cls:
        try:
            from nirs4all.operators import models as model_module
            operator_cls = getattr(model_module, operator_name, None)
            if operator_cls:
                operator_info = {
                    "name": operator_name,
                    "module": "models",
                    "type": "model",
                }
        except Exception:
            pass

    if not operator_cls:
        raise HTTPException(
            status_code=404,
            detail=f"Operator '{operator_name}' not found in nirs4all",
        )

    # Extract detailed information
    params = _extract_params_from_class(operator_cls)
    docstring = operator_cls.__doc__ or ""

    operator_info.update({
        "display_name": _class_name_to_display(operator_name),
        "description": docstring.strip().split("\n")[0] if docstring else "",
        "full_docstring": docstring,
        "params": params,
        "class_name": operator_cls.__name__,
        "module_path": operator_cls.__module__,
    })

    return {"operator": operator_info}


# ============= Phase 2: Pipeline Execution Preparation =============


@router.post("/pipelines/{pipeline_id}/prepare")
async def prepare_pipeline_execution(
    pipeline_id: str,
    request: PipelineExecuteRequest
):
    """
    Prepare a pipeline for execution.

    Validates the pipeline, resolves operators, and returns
    execution configuration. Does not actually run the pipeline.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available for pipeline execution",
        )

    pipeline = _load_pipeline(pipeline_id)

    # Validate pipeline
    validation_result = await _validate_pipeline_impl(
        PipelineValidateRequest(steps=pipeline.get("steps", []))
    )

    if not validation_result["valid"]:
        return {
            "success": False,
            "pipeline_id": pipeline_id,
            "validation": validation_result,
            "message": "Pipeline validation failed",
        }

    # Check dataset exists
    from .spectra import _load_dataset
    dataset = _load_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset '{request.dataset_id}' not found",
        )

    # Build execution summary
    steps_summary = []
    for i, step in enumerate(pipeline.get("steps", [])):
        steps_summary.append({
            "index": i,
            "name": step.get("name", "unknown"),
            "type": step.get("type", "unknown"),
            "params": step.get("params", {}),
        })

    execution_config = {
        "pipeline_id": pipeline_id,
        "pipeline_name": pipeline.get("name", "Unnamed"),
        "dataset_id": request.dataset_id,
        "dataset_name": dataset.name,
        "partition": request.partition,
        "num_samples": dataset.num_samples,
        "num_features": dataset.num_features,
        "steps": steps_summary,
        "total_steps": len(steps_summary),
        "dry_run": request.dry_run,
    }

    return {
        "success": True,
        "execution_config": execution_config,
        "validation": validation_result,
        "message": "Pipeline ready for execution",
    }


@router.post("/pipelines/from-preset/{preset_id}")
async def create_pipeline_from_preset(preset_id: str, name: str | None = None):
    """
    Create a new pipeline from a preset template.
    """
    presets_response = await get_pipeline_presets()
    preset = next(
        (p for p in presets_response["presets"] if p["id"] == preset_id),
        None
    )

    if not preset:
        raise HTTPException(
            status_code=404,
            detail=f"Preset '{preset_id}' not found",
        )

    # Create pipeline from preset
    pipeline_data = PipelineCreate(
        name=name or preset["name"],
        description=preset["description"],
        steps=preset["steps"],
        category="preset",
        task_type=preset.get("task_type"),
    )

    return await create_pipeline(pipeline_data)


# ============= Pipeline Variant Counting =============


def _convert_frontend_steps_to_nirs4all(steps: list[dict[str, Any]]) -> list[Any]:
    """
    Convert frontend pipeline step format to nirs4all generator format.

    Frontend steps use structure like:
    {
        "id": "1",
        "type": "preprocessing",
        "name": "SNV",
        "params": {},
        "generator": { "_or_": [...], "_range_": [1, 10, 1], "pick": 2 }  # Optional
    }

    This converts to nirs4all format which is just the step definition,
    potentially wrapped in generator keywords.
    """
    result = []

    for step in steps:
        step_name = step.get("name", "")
        step_params = step.get("params", {})
        step_type = step.get("type", "")
        sub_type = step.get("subType", "")
        generator = step.get("generator")
        children = step.get("children", [])
        branches = step.get("branches", [])
        generator_kind = step.get("generatorKind", "")
        generator_options = step.get("generatorOptions", {})

        # --- Consolidated "flow" type ---
        if step_type == "flow":
            if sub_type == "branch" and branches:
                branch_paths = []
                for branch_steps in branches:
                    branch_paths.append(_convert_frontend_steps_to_nirs4all(branch_steps))
                result.append({"branch": branch_paths})
                continue
            if sub_type == "merge":
                merge_config = step.get("mergeConfig")
                if merge_config and merge_config.get("mode"):
                    result.append({"merge": merge_config["mode"]})
                else:
                    result.append({"merge": step_params.get("merge_type", "predictions")})
                continue
            if sub_type in ("sample_augmentation", "feature_augmentation") and children:
                child_steps = _convert_frontend_steps_to_nirs4all(children)
                result.extend(child_steps)
                continue
            if sub_type == "sample_filter" and children:
                child_steps = _convert_frontend_steps_to_nirs4all(children)
                mode = step.get("sampleFilterConfig", {}).get("mode", "any")
                result.append({"exclude": child_steps, "mode": mode})
                continue
            if sub_type == "concat_transform" and branches:
                branch_paths = []
                for branch_steps in branches:
                    branch_paths.append(_convert_frontend_steps_to_nirs4all(branch_steps))
                result.append({"branch": branch_paths})
                continue
            if sub_type == "sequential" and children:
                child_steps = _convert_frontend_steps_to_nirs4all(children)
                result.extend(child_steps)
                continue
            # Unknown flow subType — skip
            continue

        # --- Consolidated "utility" type ---
        if step_type == "utility":
            if sub_type == "generator" and branches:
                alternatives = []
                for branch in branches:
                    branch_steps = _convert_frontend_steps_to_nirs4all(branch)
                    if len(branch_steps) == 1:
                        alternatives.append(branch_steps[0])
                    else:
                        alternatives.append(branch_steps)
                if generator_kind == "cartesian":
                    result.append({"_cartesian_": alternatives})
                else:
                    gen_step: dict[str, Any] = {"_or_": alternatives}
                    if generator_options.get("pick"):
                        gen_step["pick"] = generator_options["pick"]
                    if generator_options.get("arrange"):
                        gen_step["arrange"] = generator_options["arrange"]
                    if generator_options.get("count"):
                        gen_step["count"] = generator_options["count"]
                    result.append(gen_step)
                continue
            # Charts and comments are non-executing
            continue

        # --- Legacy and standard types below ---

        # Build the base step representation
        # For nirs4all, we represent operators as class names or dicts
        if step_params:
            base_step = {step_name: step_params}
        else:
            base_step = step_name

        # Wrap with model/y_processing keyword if needed
        if step_type == "model":
            base_step = {"model": base_step}
        elif step_type == "y_processing":
            base_step = {"y_processing": base_step}

        # Handle generator step type (choice/or node) - legacy
        if step_type == "generator" and children:
            alternatives = []
            for child in children:
                child_steps = _convert_frontend_steps_to_nirs4all([child])
                alternatives.extend(child_steps)
            if alternatives:
                gen_step = {"_or_": alternatives}
                if generator:
                    if generator.get("pick"):
                        gen_step["pick"] = generator["pick"]
                    if generator.get("count"):
                        gen_step["count"] = generator["count"]
                result.append(gen_step)
            continue

        # Handle branch step type - legacy
        if step_type == "branch" and children:
            branch_paths = []
            for child in children:
                child_steps = _convert_frontend_steps_to_nirs4all([child])
                branch_paths.extend(child_steps)
            if branch_paths:
                result.append({"branch": branch_paths})
            continue

        # Apply generator wrapper if present on regular steps
        if generator:
            if "_or_" in generator and generator["_or_"]:
                gen_step = {"_or_": generator["_or_"]}
                if generator.get("pick"):
                    gen_step["pick"] = generator["pick"]
                if generator.get("count"):
                    gen_step["count"] = generator["count"]
                result.append(gen_step)
            elif "_range_" in generator and generator["_range_"]:
                gen_step = {"_range_": generator["_range_"]}
                result.append(gen_step)
            elif "_log_range_" in generator and generator["_log_range_"]:
                gen_step = {"_log_range_": generator["_log_range_"]}
                result.append(gen_step)
            else:
                result.append(base_step)
        else:
            result.append(base_step)

        # Handle children for other container steps - legacy
        if children and step_type not in ("branch", "generator"):
            child_steps = _convert_frontend_steps_to_nirs4all(children)
            if step_type == "sample_augmentation":
                result.append({"sample_augmentation": {"transformers": child_steps}})
            elif step_type == "feature_augmentation":
                result.append({"feature_augmentation": child_steps})

    return result


# Implementation function - called by forwarding route defined earlier
async def _count_variants_impl(request: PipelineCountRequest):
    """
    Count the number of pipeline variants without generating them.

    Uses nirs4all's count_combinations function to efficiently calculate
    the total number of variants a pipeline specification would generate.
    """
    _count_combinations = get_cached("count_combinations")
    if not is_ml_ready() or _count_combinations is None:
        return {
            "count": 1,
            "warning": "nirs4all not available, using simple count",
            "breakdown": {}
        }

    try:
        # Convert frontend steps to nirs4all format
        nirs4all_steps = _convert_frontend_steps_to_nirs4all(request.steps)

        # Count combinations using nirs4all
        total_count = _count_combinations(nirs4all_steps)

        # Calculate per-step breakdown
        breakdown = {}
        for i, step in enumerate(request.steps):
            step_name = step.get("name", f"step_{i}")
            step_id = step.get("id", str(i))
            single_step = _convert_frontend_steps_to_nirs4all([step])
            step_count = _count_combinations(single_step) if single_step else 1
            breakdown[step_id] = {"name": step_name, "count": step_count}

        # Warning for large search spaces
        warning = None
        if total_count > 10000:
            warning = f"Large search space: {total_count:,} variants. Consider reducing with 'count' limiter."
        elif total_count > 1000:
            warning = f"Moderate search space: {total_count:,} variants."

        return {
            "count": total_count,
            "breakdown": breakdown,
            "warning": warning,
        }

    except Exception as e:
        return {"count": 1, "error": str(e), "breakdown": {}}


# ============= Phase 6: Pipeline Execution =============


class PipelineRunRequest(BaseModel):
    """Request model for running a pipeline."""
    dataset_id: str
    verbose: int = 1
    export_model: bool = True
    model_name: str | None = None
    refit: Any | None = True
    refit_params: dict[str, Any] | None = None


class PipelineExportRequest(BaseModel):
    """Request model for exporting pipeline."""
    format: str = "python"  # python, yaml, json
    dataset_path: str | None = None


@router.post("/pipelines/{pipeline_id}/execute")
async def execute_pipeline(pipeline_id: str, request: PipelineRunRequest):
    """
    Execute a pipeline using nirs4all.run().

    This endpoint triggers pipeline execution as a background job
    and returns a job ID for tracking progress via WebSocket.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available for pipeline execution",
        )

    from .jobs import JobType, job_manager
    from .workspace_manager import workspace_manager

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Load pipeline
    pipeline = _load_pipeline(pipeline_id)

    # Validate dataset exists
    from .nirs4all_adapter import resolve_dataset_path
    try:
        dataset_path = resolve_dataset_path(request.dataset_id)
    except HTTPException:
        raise

    # Build refit configuration
    refit_value = request.refit
    if refit_value is True and request.refit_params:
        refit_value = {"refit_params": request.refit_params}
    elif isinstance(refit_value, dict) and request.refit_params:
        refit_value.setdefault("refit_params", {}).update(request.refit_params)

    # Create job configuration
    job_config = {
        "pipeline_id": pipeline_id,
        "pipeline_name": pipeline.get("name", "Unknown"),
        "pipeline_steps": pipeline.get("steps", []),
        "dataset_id": request.dataset_id,
        "dataset_path": dataset_path,
        "verbose": request.verbose,
        "export_model": request.export_model,
        "model_name": request.model_name or f"model_{pipeline_id}",
        "workspace_path": workspace.path,
        "refit": refit_value,
    }

    # Create and submit job
    job = job_manager.create_job(JobType.TRAINING, job_config)
    job_manager.submit_job(job, _run_pipeline_task)

    return {
        "success": True,
        "job_id": job.id,
        "pipeline_id": pipeline_id,
        "status": job.status.value,
        "message": "Pipeline execution started",
        "websocket_url": f"/ws/job/{job.id}",
    }


def _run_pipeline_task(job, progress_callback):
    """
    Execute the pipeline using nirs4all.run().

    Args:
        job: The job instance with config
        progress_callback: Callback for progress updates

    Returns:
        Execution result dictionary
    """
    from .nirs4all_adapter import build_full_pipeline, ensure_models_dir

    config = job.config
    steps = config.get("pipeline_steps", [])
    dataset_path = config.get("dataset_path")
    workspace_path = config.get("workspace_path")

    # Report starting
    progress_callback(5, "Building pipeline...")

    try:
        # Build full pipeline with all features
        build_result = build_full_pipeline(steps)
        pipeline_steps = build_result.steps

        if not pipeline_steps:
            raise ValueError("Pipeline has no executable steps")

        progress_callback(10, f"Running pipeline ({build_result.estimated_variants} variants)...")

        # Execute using nirs4all.run()
        import nirs4all

        run_kwargs = {
            "pipeline": pipeline_steps,
            "dataset": dataset_path,
            "verbose": config.get("verbose", 1),
        }
        if "refit" in config:
            run_kwargs["refit"] = config["refit"]

        result = nirs4all.run(**run_kwargs)

        progress_callback(80, "Extracting results...")

        # Extract metrics from result
        metrics = {}
        if hasattr(result, 'best_rmse'):
            metrics['rmse'] = float(result.best_rmse)
        if hasattr(result, 'best_r2'):
            metrics['r2'] = float(result.best_r2)
        if hasattr(result, 'best_score'):
            metrics['score'] = float(result.best_score)

        # Get top results if available
        top_results = []
        if hasattr(result, 'top'):
            try:
                for i, r in enumerate(result.top(5)):
                    top_results.append({
                        "rank": i + 1,
                        "rmse": getattr(r, 'rmse', None),
                        "r2": getattr(r, 'r2', None),
                        "config": str(r) if hasattr(r, '__str__') else None,
                    })
            except Exception:
                pass

        # Export model if requested
        model_path = None
        if config.get("export_model"):
            progress_callback(90, "Exporting model...")
            try:
                models_dir = ensure_models_dir(workspace_path)
                model_name = config.get("model_name", f"model_{config['pipeline_id']}")
                model_path = str(models_dir / f"{model_name}.n4a")
                result.export(model_path)
            except Exception as e:
                logger.error("Error exporting model: %s", e)

        progress_callback(100, "Complete!")

        return {
            "success": True,
            "metrics": metrics,
            "top_results": top_results,
            "variants_tested": build_result.estimated_variants,
            "model_path": model_path,
        }

    except Exception as e:
        import traceback
        return {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
        }


@router.post("/pipelines/{pipeline_id}/export")
async def export_pipeline(pipeline_id: str, request: PipelineExportRequest):
    """
    Export pipeline to various formats.

    Supported formats:
    - python: Executable Python code
    - yaml: YAML configuration
    - json: JSON configuration
    """
    from .nirs4all_adapter import export_pipeline_to_python, export_pipeline_to_yaml

    pipeline = _load_pipeline(pipeline_id)
    steps = pipeline.get("steps", [])
    pipeline_name = pipeline.get("name", "pipeline").replace(" ", "_").lower()

    if request.format == "python":
        content = export_pipeline_to_python(
            steps=steps,
            pipeline_name=pipeline_name,
            dataset_path=request.dataset_path or "path/to/your/dataset",
        )
        content_type = "text/x-python"
        extension = "py"

    elif request.format == "yaml":
        content = export_pipeline_to_yaml(
            steps=steps,
            config={
                "name": pipeline.get("name"),
                "description": pipeline.get("description"),
            }
        )
        content_type = "text/yaml"
        extension = "yaml"

    elif request.format == "json":
        content = json.dumps(pipeline, indent=2)
        content_type = "application/json"
        extension = "json"

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported export format: {request.format}",
        )

    return {
        "success": True,
        "format": request.format,
        "filename": f"{pipeline_name}.{extension}",
        "content": content,
        "content_type": content_type,
    }


@router.post("/pipelines/import")
async def import_pipeline(content: str, format: str = "yaml", name: str | None = None):
    """
    Import pipeline from YAML or JSON format.
    """
    from .nirs4all_adapter import import_pipeline_from_yaml

    if format == "yaml":
        imported = import_pipeline_from_yaml(content)
    elif format == "json":
        try:
            imported = json.loads(content)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported import format: {format}",
        )

    # Create pipeline from imported data
    pipeline_data = PipelineCreate(
        name=name or imported.get("name", "Imported Pipeline"),
        description=imported.get("description", ""),
        steps=imported.get("steps", []),
        category="imported",
    )

    return await create_pipeline(pipeline_data)


# ============================================================================
# Pipeline Samples API (for testing/demo)
# ============================================================================


def _get_samples_dir() -> Path:
    """Get the pipeline samples directory from nirs4all."""
    # Try relative to nirs4all_webapp (sibling directory)
    samples_path = Path(__file__).parent.parent.parent / "nirs4all" / "examples" / "pipeline_samples"
    if samples_path.exists():
        return samples_path
    # Try via installed nirs4all package
    try:
        import nirs4all
        pkg_path = Path(nirs4all.__file__).parent.parent / "examples" / "pipeline_samples"
        if pkg_path.exists():
            return pkg_path
    except ImportError:
        pass
    raise HTTPException(status_code=404, detail="Pipeline samples directory not found")


def _load_sample_file(filepath: Path) -> dict[str, Any]:
    """Load a pipeline sample file (JSON or YAML)."""
    import yaml

    suffix = filepath.suffix.lower()
    try:
        with open(filepath, encoding='utf-8') as f:
            if suffix == '.json':
                return json.load(f)
            elif suffix in ('.yaml', '.yml'):
                return yaml.safe_load(f)
            else:
                raise HTTPException(status_code=400, detail=f"Unsupported format: {suffix}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load sample: {e}")


def _filter_comments(steps: list[Any]) -> list[Any]:
    """Remove _comment steps from pipeline."""
    filtered = []
    for step in steps:
        if isinstance(step, dict):
            if set(step.keys()) == {"_comment"}:
                continue
            # Remove _comment key from steps but keep the rest
            step = {k: v for k, v in step.items() if k != "_comment"}
        filtered.append(step)
    return filtered


def _get_canonical_pipeline(filepath: Path) -> dict[str, Any]:
    """
    Load a pipeline file and return its canonical serialized form.

    Uses nirs4all's PipelineConfigs to get the canonical representation.
    """
    if not NIRS4ALL_AVAILABLE:
        # Fallback: just load and clean comments
        data = _load_sample_file(filepath)
        steps = data.get("pipeline", data) if isinstance(data, dict) else data
        return {
            "name": data.get("name", filepath.stem) if isinstance(data, dict) else filepath.stem,
            "description": data.get("description", "") if isinstance(data, dict) else "",
            "pipeline": _filter_comments(steps) if isinstance(steps, list) else steps,
            "has_generators": False,
            "num_configurations": 1,
        }

    try:
        from nirs4all.pipeline.config.pipeline_config import PipelineConfigs

        data = _load_sample_file(filepath)

        if isinstance(data, dict):
            steps = data.get("pipeline", [])
            name = data.get("name", filepath.stem)
            description = data.get("description", "")
        elif isinstance(data, list):
            steps = data
            name = filepath.stem
            description = ""
        else:
            raise ValueError("Pipeline must be list or dict with 'pipeline' key")

        steps = _filter_comments(steps)

        # Create PipelineConfigs to get canonical form
        config = PipelineConfigs(steps, name=name, description=description)
        canonical_steps = config.steps[0] if config.steps else []

        return {
            "name": name,
            "description": description,
            "pipeline": canonical_steps,
            "has_generators": config.has_configurations,
            "num_configurations": len(config.steps),
        }
    except Exception as e:
        # Fallback to raw load
        data = _load_sample_file(filepath)
        steps = data.get("pipeline", data) if isinstance(data, dict) else data
        return {
            "name": data.get("name", filepath.stem) if isinstance(data, dict) else filepath.stem,
            "description": data.get("description", "") if isinstance(data, dict) else "",
            "pipeline": _filter_comments(steps) if isinstance(steps, list) else steps,
            "has_generators": False,
            "num_configurations": 1,
            "error": str(e),
        }


@router.get("/pipelines/samples")
async def list_pipeline_samples():
    """
    List all available pipeline sample files.

    Returns the list of sample files from nirs4all/examples/pipeline_samples.
    """
    samples_dir = _get_samples_dir()

    samples = []
    for filepath in sorted(samples_dir.glob("*.json")) + sorted(samples_dir.glob("*.yaml")):
        # Skip test and export scripts
        if filepath.stem in ("test_all_pipelines", "export_canonical"):
            continue

        try:
            data = _load_sample_file(filepath)
            name = data.get("name", filepath.stem) if isinstance(data, dict) else filepath.stem
            description = data.get("description", "") if isinstance(data, dict) else ""
        except Exception:
            name = filepath.stem
            description = ""

        samples.append({
            "id": filepath.stem,
            "filename": filepath.name,
            "format": filepath.suffix[1:],
            "name": name,
            "description": description,
        })

    return {
        "samples": samples,
        "total": len(samples),
        "samples_dir": str(samples_dir),
    }


@router.get("/pipelines/samples/{sample_id}")
async def get_pipeline_sample(sample_id: str, canonical: bool = True):
    """
    Get a specific pipeline sample.

    Args:
        sample_id: The sample file stem (e.g., "01_basic_regression")
        canonical: If True, return canonical serialized form via nirs4all

    Returns:
        Pipeline definition in nirs4all format.
    """
    samples_dir = _get_samples_dir()

    # Try both JSON and YAML
    filepath = None
    for ext in [".json", ".yaml", ".yml"]:
        candidate = samples_dir / f"{sample_id}{ext}"
        if candidate.exists():
            filepath = candidate
            break

    if not filepath:
        raise HTTPException(status_code=404, detail=f"Sample '{sample_id}' not found")

    if canonical:
        result = _get_canonical_pipeline(filepath)
    else:
        result = _load_sample_file(filepath)
        if isinstance(result, dict) and "pipeline" in result:
            result["pipeline"] = _filter_comments(result["pipeline"])
        elif isinstance(result, list):
            result = {"pipeline": _filter_comments(result), "name": filepath.stem}

    result["source_file"] = filepath.name
    return result


@router.post("/pipelines/samples/{sample_id}/validate-roundtrip")
async def validate_sample_roundtrip(sample_id: str, editor_steps: list[dict[str, Any]]):
    """
    Validate that editor steps produce identical output to the sample.

    This endpoint is used to test the pipeline editor's import/export fidelity.

    Args:
        sample_id: The sample file stem
        editor_steps: The pipeline steps as exported from the editor

    Returns:
        Validation result with differences if any.
    """
    samples_dir = _get_samples_dir()

    # Load canonical sample
    filepath = None
    for ext in [".json", ".yaml", ".yml"]:
        candidate = samples_dir / f"{sample_id}{ext}"
        if candidate.exists():
            filepath = candidate
            break

    if not filepath:
        raise HTTPException(status_code=404, detail=f"Sample '{sample_id}' not found")

    canonical = _get_canonical_pipeline(filepath)
    original_steps = canonical.get("pipeline", [])

    # Deep comparison
    differences = []

    def normalize_for_comparison(obj):
        """Normalize object for comparison (sort dicts, etc.)"""
        if isinstance(obj, dict):
            return {k: normalize_for_comparison(v) for k, v in sorted(obj.items())}
        elif isinstance(obj, list):
            return [normalize_for_comparison(item) for item in obj]
        return obj

    original_normalized = normalize_for_comparison(original_steps)
    editor_normalized = normalize_for_comparison(editor_steps)

    original_json = json.dumps(original_normalized, sort_keys=True)
    editor_json = json.dumps(editor_normalized, sort_keys=True)

    is_identical = original_json == editor_json

    if not is_identical:
        # Find specific differences
        if len(original_steps) != len(editor_steps):
            differences.append(f"Step count differs: {len(original_steps)} vs {len(editor_steps)}")

        for i, (orig, edit) in enumerate(zip(original_steps, editor_steps)):
            orig_json = json.dumps(normalize_for_comparison(orig), sort_keys=True)
            edit_json = json.dumps(normalize_for_comparison(edit), sort_keys=True)
            if orig_json != edit_json:
                differences.append(f"Step {i} differs")

    return {
        "valid": is_identical,
        "sample_id": sample_id,
        "differences": differences,
        "original_step_count": len(original_steps),
        "editor_step_count": len(editor_steps),
    }


# ============================================================================
# Phase 4: Shape Propagation API
# ============================================================================


class ShapePropagationRequest(BaseModel):
    """Request model for shape propagation calculation."""
    steps: list[dict[str, Any]]
    input_shape: dict[str, int]  # {samples: N, features: M}


class ShapeAtStep(BaseModel):
    """Shape at a specific pipeline step."""
    step_id: str
    step_name: str
    input_shape: dict[str, int]
    output_shape: dict[str, int]
    warnings: list[dict[str, Any]] = []


class ShapePropagationResponse(BaseModel):
    """Response model for shape propagation calculation."""
    shapes: list[ShapeAtStep]
    warnings: list[dict[str, Any]]
    output_shape: dict[str, int]
    is_valid: bool


# Operator shape effects mapping
SHAPE_TRANSFORMS = {
    # Preprocessing that preserves shape
    "StandardNormalVariate": lambda inp, params: inp,
    "SNV": lambda inp, params: inp,
    "MultiplicativeScatterCorrection": lambda inp, params: inp,
    "MSC": lambda inp, params: inp,
    "StandardScaler": lambda inp, params: inp,
    "MinMaxScaler": lambda inp, params: inp,
    "RobustScaler": lambda inp, params: inp,
    "Normalize": lambda inp, params: inp,
    "LogTransform": lambda inp, params: inp,
    "Detrend": lambda inp, params: inp,
    "Baseline": lambda inp, params: inp,
    "ASLSBaseline": lambda inp, params: inp,
    "AirPLS": lambda inp, params: inp,
    "ArPLS": lambda inp, params: inp,
    "SNIP": lambda inp, params: inp,
    "Gaussian": lambda inp, params: inp,
    "ReflectanceToAbsorbance": lambda inp, params: inp,
    "ToAbsorbance": lambda inp, params: inp,
    "FromAbsorbance": lambda inp, params: inp,
    "FirstDerivative": lambda inp, params: inp,
    "SecondDerivative": lambda inp, params: inp,
    "SavitzkyGolay": lambda inp, params: inp,

    # Feature reduction
    "PLSRegression": lambda inp, params: {
        "samples": inp["samples"],
        "features": min(params.get("n_components", 10), inp["features"], inp["samples"]),
    },
    "PCA": lambda inp, params: {
        "samples": inp["samples"],
        "features": min(params.get("n_components", inp["features"]), inp["features"], inp["samples"]),
    },
    "IKPLS": lambda inp, params: {
        "samples": inp["samples"],
        "features": min(params.get("n_components", 10), inp["features"], inp["samples"]),
    },
    "OPLS": lambda inp, params: {
        "samples": inp["samples"],
        "features": min(params.get("n_components", 10), inp["features"], inp["samples"]),
    },

    # Resampling
    "ResampleTransformer": lambda inp, params: {
        "samples": inp["samples"],
        "features": params.get("n_features", params.get("target_points", inp["features"])),
    },
    "Resampler": lambda inp, params: {
        "samples": inp["samples"],
        "features": params.get("n_features", params.get("target_points", inp["features"])),
    },
    "CropTransformer": lambda inp, params: {
        "samples": inp["samples"],
        "features": max(1, params.get("end", inp["features"]) - params.get("start", 0)),
    },

    # Wavelets
    "Wavelet": lambda inp, params: {
        "samples": inp["samples"],
        "features": inp["features"] // (2 ** params.get("level", 1)),
    },
    "Haar": lambda inp, params: {
        "samples": inp["samples"],
        "features": inp["features"] // (2 ** params.get("level", 1)),
    },
}

# Parameters that should be checked against dimensions
DIMENSION_PARAMS = {
    "n_components": "features",
    "n_splits": "samples",
    "window_length": "features",
    "start": "features",
    "end": "features",
    "n_features": "features",
    "target_points": "features",
}


def _propagate_shape(step: dict[str, Any], input_shape: dict[str, int]) -> tuple:
    """Calculate output shape for a single step."""
    step_name = step.get("name", "")
    params = step.get("params", {})
    warnings = []

    # Check dimension parameters
    for param_name, dim_source in DIMENSION_PARAMS.items():
        param_value = params.get(param_name)
        if param_value is not None and isinstance(param_value, (int, float)):
            max_value = input_shape.get(dim_source, float("inf"))
            if param_value > max_value:
                warnings.append({
                    "type": "param_exceeds_dimension",
                    "step_id": step.get("id", ""),
                    "step_name": step_name,
                    "message": f"Parameter '{param_name}' ({int(param_value)}) exceeds {dim_source} ({int(max_value)})",
                    "param_name": param_name,
                    "param_value": int(param_value),
                    "max_value": int(max_value),
                    "severity": "error" if param_name == "n_components" else "warning",
                })

    # Calculate output shape
    transform = SHAPE_TRANSFORMS.get(step_name)
    if transform:
        output_shape = transform(input_shape, params)
    else:
        # Unknown operator - preserve shape, add warning
        output_shape = input_shape.copy()
        step_type = step.get("type", "")
        if step_type in ("preprocessing", "model"):
            warnings.append({
                "type": "unknown_transform",
                "step_id": step.get("id", ""),
                "step_name": step_name,
                "message": f"Unknown operator '{step_name}' - shape change cannot be predicted",
                "severity": "warning",
            })

    return output_shape, warnings


@router.post("/pipelines/propagate-shape", response_model=ShapePropagationResponse)
async def propagate_shape(request: ShapePropagationRequest):
    """
    Calculate shape propagation through a pipeline.

    Given an input shape and a list of pipeline steps, calculates how
    the data shape changes at each step and reports any dimension warnings.

    This is used by the Pipeline Editor to:
    - T4.5: Show shape at each step
    - T4.6: Display shape changes in the tree
    - T4.7: Warn when parameters exceed data dimensions
    """
    shapes = []
    all_warnings = []
    current_shape = request.input_shape.copy()
    is_valid = True

    for step in request.steps:
        input_shape = current_shape.copy()
        output_shape, step_warnings = _propagate_shape(step, input_shape)

        shapes.append(ShapeAtStep(
            step_id=step.get("id", ""),
            step_name=step.get("name", ""),
            input_shape=input_shape,
            output_shape=output_shape,
            warnings=step_warnings,
        ))

        all_warnings.extend(step_warnings)
        if any(w.get("severity") == "error" for w in step_warnings):
            is_valid = False

        current_shape = output_shape

        # Handle branches recursively (simplified - just check first branch)
        branches = step.get("branches", [])
        children = step.get("children", [])
        for branch in branches + children:
            if isinstance(branch, list):
                for child_step in branch:
                    _, child_warnings = _propagate_shape(child_step, input_shape)
                    all_warnings.extend(child_warnings)
            elif isinstance(branch, dict):
                _, child_warnings = _propagate_shape(branch, input_shape)
                all_warnings.extend(child_warnings)

    return ShapePropagationResponse(
        shapes=shapes,
        warnings=all_warnings,
        output_shape=current_shape,
        is_valid=is_valid,
    )

