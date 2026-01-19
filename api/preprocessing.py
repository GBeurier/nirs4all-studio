"""
Preprocessing API routes for nirs4all webapp.

This module provides FastAPI routes for listing available preprocessing methods,
getting their parameters, and applying preprocessing to spectral data.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    from nirs4all.operators import transforms

    NIRS4ALL_AVAILABLE = True
except ImportError as e:
    print(f"Note: nirs4all not available for preprocessing API: {e}")
    NIRS4ALL_AVAILABLE = False


router = APIRouter()


class PreprocessingStep(BaseModel):
    """A single preprocessing step configuration."""

    name: str
    params: Dict[str, Any] = {}


class PreprocessingChain(BaseModel):
    """A chain of preprocessing steps."""

    steps: List[PreprocessingStep] = []


class ApplyPreprocessingRequest(BaseModel):
    """Request model for applying preprocessing to data."""

    data: List[List[float]] = Field(..., description="2D array of spectral data (samples x features)")
    chain: List[PreprocessingStep] = Field(..., description="Preprocessing chain to apply")


class PreviewPreprocessingRequest(BaseModel):
    """Request model for previewing preprocessing on a dataset."""

    dataset_id: str
    chain: List[PreprocessingStep]
    n_samples: int = Field(10, ge=1, le=100, description="Number of samples to preview")
    partition: str = "train"


class ValidateChainRequest(BaseModel):
    """Request model for validating a preprocessing chain."""

    chain: List[PreprocessingStep]


# Define available preprocessing methods with their metadata
PREPROCESSING_METHODS = {
    # NIRS-specific transforms
    "StandardNormalVariate": {
        "name": "StandardNormalVariate",
        "display_name": "SNV (Standard Normal Variate)",
        "description": "Removes scatter effects by centering and scaling each spectrum",
        "category": "scatter_correction",
        "params": {},
        "available": True,
    },
    "MultiplicativeScatterCorrection": {
        "name": "MultiplicativeScatterCorrection",
        "display_name": "MSC (Multiplicative Scatter Correction)",
        "description": "Corrects for scatter effects using a reference spectrum",
        "category": "scatter_correction",
        "params": {},
        "available": True,
    },
    "SavitzkyGolay": {
        "name": "SavitzkyGolay",
        "display_name": "Savitzky-Golay Filter",
        "description": "Smoothing and derivative filter using polynomial fitting",
        "category": "smoothing",
        "params": {
            "window_length": {
                "type": "int",
                "default": 11,
                "min": 3,
                "max": 51,
                "step": 2,
                "description": "Window size (must be odd)",
            },
            "polyorder": {
                "type": "int",
                "default": 2,
                "min": 0,
                "max": 5,
                "description": "Polynomial order",
            },
            "deriv": {
                "type": "int",
                "default": 0,
                "min": 0,
                "max": 2,
                "description": "Derivative order (0=smoothing only)",
            },
        },
        "available": True,
    },
    "FirstDerivative": {
        "name": "FirstDerivative",
        "display_name": "First Derivative",
        "description": "Compute first derivative to remove baseline offset",
        "category": "derivative",
        "params": {},
        "available": True,
    },
    "SecondDerivative": {
        "name": "SecondDerivative",
        "display_name": "Second Derivative",
        "description": "Compute second derivative to remove linear baseline",
        "category": "derivative",
        "params": {},
        "available": True,
    },
    "Detrend": {
        "name": "Detrend",
        "display_name": "Detrend",
        "description": "Remove linear trend from spectra",
        "category": "baseline",
        "params": {},
        "available": True,
    },
    "Baseline": {
        "name": "Baseline",
        "display_name": "Baseline Correction",
        "description": "Subtract baseline from spectra",
        "category": "baseline",
        "params": {},
        "available": True,
    },
    "Gaussian": {
        "name": "Gaussian",
        "display_name": "Gaussian Smoothing",
        "description": "Apply Gaussian smoothing filter",
        "category": "smoothing",
        "params": {
            "sigma": {
                "type": "float",
                "default": 1.0,
                "min": 0.1,
                "max": 10.0,
                "description": "Standard deviation for Gaussian kernel",
            },
        },
        "available": True,
    },
    "LogTransform": {
        "name": "LogTransform",
        "display_name": "Log Transform",
        "description": "Apply log transformation (log10 or natural log)",
        "category": "transform",
        "params": {},
        "available": True,
    },
    "Normalize": {
        "name": "Normalize",
        "display_name": "Normalize",
        "description": "Normalize spectra to unit norm",
        "category": "scaling",
        "params": {},
        "available": True,
    },
    "ReflectanceToAbsorbance": {
        "name": "ReflectanceToAbsorbance",
        "display_name": "Reflectance to Absorbance",
        "description": "Convert reflectance to absorbance using log(1/R)",
        "category": "conversion",
        "params": {},
        "available": True,
    },
    # Sklearn scalers
    "StandardScaler": {
        "name": "StandardScaler",
        "display_name": "Standard Scaler",
        "description": "Standardize features by removing mean and scaling to unit variance",
        "category": "scaling",
        "params": {
            "with_mean": {
                "type": "bool",
                "default": True,
                "description": "Center data by removing mean",
            },
            "with_std": {
                "type": "bool",
                "default": True,
                "description": "Scale data to unit variance",
            },
        },
        "available": True,
    },
    "MinMaxScaler": {
        "name": "MinMaxScaler",
        "display_name": "Min-Max Scaler",
        "description": "Scale features to a given range (default 0-1)",
        "category": "scaling",
        "params": {
            "feature_range": {
                "type": "tuple",
                "default": [0, 1],
                "description": "Desired range of transformed data",
            },
        },
        "available": True,
    },
    "RobustScaler": {
        "name": "RobustScaler",
        "display_name": "Robust Scaler",
        "description": "Scale using statistics robust to outliers (median, IQR)",
        "category": "scaling",
        "params": {
            "with_centering": {
                "type": "bool",
                "default": True,
                "description": "Center data by removing median",
            },
            "with_scaling": {
                "type": "bool",
                "default": True,
                "description": "Scale data to interquartile range",
            },
        },
        "available": True,
    },
    # Advanced baseline correction methods (from pybaselines)
    "ASLSBaseline": {
        "name": "ASLSBaseline",
        "display_name": "ASLS Baseline",
        "description": "Asymmetric Least Squares baseline correction",
        "category": "baseline",
        "params": {
            "lam": {
                "type": "float",
                "default": 1e6,
                "min": 1e3,
                "max": 1e10,
                "description": "Smoothing parameter",
            },
            "p": {
                "type": "float",
                "default": 0.01,
                "min": 0.001,
                "max": 0.1,
                "description": "Asymmetry parameter",
            },
        },
        "available": True,
    },
    "AirPLS": {
        "name": "AirPLS",
        "display_name": "AirPLS",
        "description": "Adaptive Iteratively Reweighted Penalized Least Squares",
        "category": "baseline",
        "params": {
            "lam": {
                "type": "float",
                "default": 1e6,
                "min": 1e3,
                "max": 1e10,
                "description": "Smoothing parameter",
            },
        },
        "available": True,
    },
    "ArPLS": {
        "name": "ArPLS",
        "display_name": "ArPLS",
        "description": "Asymmetrically Reweighted Penalized Least Squares",
        "category": "baseline",
        "params": {
            "lam": {
                "type": "float",
                "default": 1e6,
                "min": 1e3,
                "max": 1e10,
                "description": "Smoothing parameter",
            },
        },
        "available": True,
    },
    "SNIP": {
        "name": "SNIP",
        "display_name": "SNIP",
        "description": "Statistics-sensitive Non-linear Iterative Peak-clipping",
        "category": "baseline",
        "params": {
            "max_half_window": {
                "type": "int",
                "default": 40,
                "min": 1,
                "max": 200,
                "description": "Maximum half-window size",
            },
        },
        "available": True,
    },
    # Feature operations
    "CropTransformer": {
        "name": "CropTransformer",
        "display_name": "Crop Wavelengths",
        "description": "Crop spectra to a wavelength range",
        "category": "features",
        "params": {
            "start": {
                "type": "int",
                "default": 0,
                "min": 0,
                "description": "Start index or wavelength",
            },
            "end": {
                "type": "int",
                "default": -1,
                "description": "End index or wavelength (-1 for all)",
            },
        },
        "available": True,
    },
    "Resampler": {
        "name": "Resampler",
        "display_name": "Resample Wavelengths",
        "description": "Resample spectra to different wavelength resolution",
        "category": "features",
        "params": {
            "n_features": {
                "type": "int",
                "default": 100,
                "min": 10,
                "max": 2000,
                "description": "Target number of features",
            },
        },
        "available": True,
    },
}


def _get_transformer_class(name: str):
    """Get transformer class by name."""
    if not NIRS4ALL_AVAILABLE:
        return None

    # Check nirs4all transforms
    transformer_cls = getattr(transforms, name, None)
    if transformer_cls:
        return transformer_cls

    # Check sklearn
    sklearn_map = {
        "StandardScaler": ("sklearn.preprocessing", "StandardScaler"),
        "MinMaxScaler": ("sklearn.preprocessing", "MinMaxScaler"),
        "RobustScaler": ("sklearn.preprocessing", "RobustScaler"),
    }

    if name in sklearn_map:
        import importlib

        module_name, class_name = sklearn_map[name]
        module = importlib.import_module(module_name)
        return getattr(module, class_name, None)

    return None


@router.get("/preprocessing/methods")
async def list_preprocessing_methods():
    """
    List all available preprocessing methods.

    Returns a list of preprocessing methods with their metadata,
    grouped by category.
    """
    methods = []
    categories = {}

    for name, info in PREPROCESSING_METHODS.items():
        method_info = {
            "name": info["name"],
            "display_name": info["display_name"],
            "description": info["description"],
            "category": info["category"],
            "available": info["available"],
        }
        methods.append(method_info)

        # Group by category
        cat = info["category"]
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(method_info)

    return {
        "methods": methods,
        "categories": categories,
        "total": len(methods),
    }


@router.get("/preprocessing/methods/{name}")
async def get_preprocessing_method(name: str):
    """
    Get detailed information about a preprocessing method.

    Returns parameter schema and documentation for the method.
    """
    # Try exact match first
    method = PREPROCESSING_METHODS.get(name)

    # Try case-insensitive match
    if not method:
        name_lower = name.lower()
        for key, val in PREPROCESSING_METHODS.items():
            if key.lower() == name_lower:
                method = val
                break

    if not method:
        raise HTTPException(
            status_code=404,
            detail=f"Preprocessing method '{name}' not found. "
            f"Available: {', '.join(PREPROCESSING_METHODS.keys())}",
        )

    return {"method": method}


@router.post("/preprocessing/apply")
async def apply_preprocessing(request: ApplyPreprocessingRequest):
    """
    Apply preprocessing chain to provided data.

    Takes raw spectral data and applies a sequence of preprocessing steps.
    Returns the transformed data.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available for preprocessing",
        )

    try:
        X = np.array(request.data, dtype=np.float32)

        if X.ndim != 2:
            raise HTTPException(
                status_code=400,
                detail=f"Data must be 2D array, got shape {X.shape}",
            )

        # Apply each step in the chain
        applied_steps = []
        for step in request.chain:
            transformer_cls = _get_transformer_class(step.name)
            if transformer_cls is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown preprocessing method: {step.name}",
                )

            try:
                transformer = transformer_cls(**step.params)
                X = transformer.fit_transform(X)
                applied_steps.append(step.name)
            except Exception as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"Error applying {step.name}: {str(e)}",
                )

        return {
            "success": True,
            "data": X.tolist(),
            "shape": list(X.shape),
            "applied_steps": applied_steps,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to apply preprocessing: {str(e)}"
        )


@router.post("/preprocessing/preview")
async def preview_preprocessing(request: PreviewPreprocessingRequest):
    """
    Preview preprocessing on a dataset.

    Applies preprocessing to a subset of samples for quick visualization.
    Returns both original and processed data for comparison.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available for preprocessing preview",
        )

    # Import here to avoid circular dependency
    from .spectra import _load_dataset

    dataset = _load_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        selector = {"partition": request.partition}
        X = dataset.x(selector, layout="2d")

        if isinstance(X, list):
            X = X[0]

        # Get subset for preview
        n_samples = min(request.n_samples, X.shape[0])
        indices = np.linspace(0, X.shape[0] - 1, n_samples, dtype=int)
        X_subset = X[indices]
        X_original = X_subset.copy()

        # Apply preprocessing chain
        applied_steps = []
        for step in request.chain:
            transformer_cls = _get_transformer_class(step.name)
            if transformer_cls is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown preprocessing method: {step.name}",
                )

            transformer = transformer_cls(**step.params)
            X_subset = transformer.fit_transform(X_subset)
            applied_steps.append(step.name)

        # Get wavelengths
        try:
            wavelengths = dataset.headers(0)
        except Exception:
            wavelengths = list(range(X.shape[1]))

        return {
            "success": True,
            "dataset_id": request.dataset_id,
            "partition": request.partition,
            "sample_indices": indices.tolist(),
            "n_samples": n_samples,
            "wavelengths": wavelengths,
            "original": X_original.tolist(),
            "processed": X_subset.tolist(),
            "applied_steps": applied_steps,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to preview preprocessing: {str(e)}"
        )


@router.post("/preprocessing/validate")
async def validate_preprocessing_chain(request: ValidateChainRequest):
    """
    Validate a preprocessing chain configuration.

    Checks that all methods exist and parameters are valid.
    Returns validation results with any errors or warnings.
    """
    results = {
        "valid": True,
        "steps": [],
        "errors": [],
        "warnings": [],
    }

    for i, step in enumerate(request.chain):
        step_result = {
            "index": i,
            "name": step.name,
            "valid": True,
            "errors": [],
            "warnings": [],
        }

        # Check if method exists
        method = PREPROCESSING_METHODS.get(step.name)
        if not method:
            # Try case-insensitive match
            for key, val in PREPROCESSING_METHODS.items():
                if key.lower() == step.name.lower():
                    method = val
                    step_result["warnings"].append(
                        f"Method name should be '{key}' (case-sensitive)"
                    )
                    break

        if not method:
            step_result["valid"] = False
            step_result["errors"].append(f"Unknown method: {step.name}")
            results["valid"] = False
        else:
            # Validate parameters
            schema_params = method.get("params", {})
            for param_name, param_value in step.params.items():
                if param_name not in schema_params:
                    step_result["warnings"].append(f"Unknown parameter: {param_name}")
                else:
                    param_schema = schema_params[param_name]

                    # Type checking
                    expected_type = param_schema.get("type")
                    if expected_type == "int" and not isinstance(param_value, int):
                        step_result["errors"].append(
                            f"Parameter '{param_name}' should be int, got {type(param_value).__name__}"
                        )
                        step_result["valid"] = False
                    elif expected_type == "float" and not isinstance(param_value, (int, float)):
                        step_result["errors"].append(
                            f"Parameter '{param_name}' should be float, got {type(param_value).__name__}"
                        )
                        step_result["valid"] = False
                    elif expected_type == "bool" and not isinstance(param_value, bool):
                        step_result["errors"].append(
                            f"Parameter '{param_name}' should be bool, got {type(param_value).__name__}"
                        )
                        step_result["valid"] = False

                    # Range checking
                    if "min" in param_schema and param_value < param_schema["min"]:
                        step_result["errors"].append(
                            f"Parameter '{param_name}' value {param_value} is below minimum {param_schema['min']}"
                        )
                        step_result["valid"] = False
                    if "max" in param_schema and param_value > param_schema["max"]:
                        step_result["errors"].append(
                            f"Parameter '{param_name}' value {param_value} is above maximum {param_schema['max']}"
                        )
                        step_result["valid"] = False

            # Check for missing required parameters (currently all are optional)

        if not step_result["valid"]:
            results["valid"] = False
        results["steps"].append(step_result)
        results["errors"].extend([f"Step {i}: {e}" for e in step_result["errors"]])
        results["warnings"].extend([f"Step {i}: {w}" for w in step_result["warnings"]])

    return results


@router.get("/preprocessing/presets")
async def get_preprocessing_presets():
    """
    Get common preprocessing presets/templates.

    Returns predefined preprocessing chains for common use cases.
    """
    presets = [
        {
            "id": "snv_only",
            "name": "SNV Only",
            "description": "Standard Normal Variate for scatter correction",
            "category": "basic",
            "chain": [{"name": "StandardNormalVariate", "params": {}}],
        },
        {
            "id": "msc_only",
            "name": "MSC Only",
            "description": "Multiplicative Scatter Correction",
            "category": "basic",
            "chain": [{"name": "MultiplicativeScatterCorrection", "params": {}}],
        },
        {
            "id": "savgol_smooth",
            "name": "Savitzky-Golay Smoothing",
            "description": "Smooth spectra using Savitzky-Golay filter",
            "category": "basic",
            "chain": [
                {"name": "SavitzkyGolay", "params": {"window_length": 11, "polyorder": 2, "deriv": 0}}
            ],
        },
        {
            "id": "snv_savgol",
            "name": "SNV + Savitzky-Golay",
            "description": "Scatter correction followed by smoothing",
            "category": "combined",
            "chain": [
                {"name": "StandardNormalVariate", "params": {}},
                {"name": "SavitzkyGolay", "params": {"window_length": 11, "polyorder": 2, "deriv": 0}},
            ],
        },
        {
            "id": "snv_first_deriv",
            "name": "SNV + First Derivative",
            "description": "Scatter correction with first derivative for baseline removal",
            "category": "combined",
            "chain": [
                {"name": "StandardNormalVariate", "params": {}},
                {"name": "SavitzkyGolay", "params": {"window_length": 11, "polyorder": 2, "deriv": 1}},
            ],
        },
        {
            "id": "msc_second_deriv",
            "name": "MSC + Second Derivative",
            "description": "MSC with second derivative for baseline and scatter correction",
            "category": "combined",
            "chain": [
                {"name": "MultiplicativeScatterCorrection", "params": {}},
                {"name": "SavitzkyGolay", "params": {"window_length": 17, "polyorder": 2, "deriv": 2}},
            ],
        },
        {
            "id": "detrend_snv",
            "name": "Detrend + SNV",
            "description": "Remove baseline trend then apply SNV",
            "category": "combined",
            "chain": [
                {"name": "Detrend", "params": {}},
                {"name": "StandardNormalVariate", "params": {}},
            ],
        },
        {
            "id": "reflectance_to_absorbance",
            "name": "Reflectance to Absorbance",
            "description": "Convert reflectance spectra to absorbance",
            "category": "conversion",
            "chain": [{"name": "ReflectanceToAbsorbance", "params": {}}],
        },
        {
            "id": "full_pipeline",
            "name": "Full NIRS Pipeline",
            "description": "Complete preprocessing: MSC, smoothing, derivative, scaling",
            "category": "comprehensive",
            "chain": [
                {"name": "MultiplicativeScatterCorrection", "params": {}},
                {"name": "SavitzkyGolay", "params": {"window_length": 11, "polyorder": 2, "deriv": 1}},
                {"name": "StandardScaler", "params": {"with_mean": True, "with_std": True}},
            ],
        },
    ]

    # Group by category
    categories = {}
    for preset in presets:
        cat = preset["category"]
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(preset)

    return {
        "presets": presets,
        "categories": categories,
        "total": len(presets),
    }

# ============= Phase 2: Dynamic Preprocessing Discovery =============


@router.get("/preprocessing/discover")
async def discover_preprocessing_methods():
    """
    Dynamically discover preprocessing methods from nirs4all.

    Introspects the nirs4all.operators.transforms module to find
    all available preprocessing transformers.
    """
    if not NIRS4ALL_AVAILABLE:
        return {
            "methods": list(PREPROCESSING_METHODS.values()),
            "total": len(PREPROCESSING_METHODS),
            "dynamic": False,
        }

    discovered = []

    try:
        from nirs4all.operators import transforms as tf_module
        import inspect

        # Get all classes from transforms module
        for name, obj in inspect.getmembers(tf_module, inspect.isclass):
            # Skip private classes and base classes
            if name.startswith("_"):
                continue

            # Check if it has fit_transform (sklearn-compatible)
            if not hasattr(obj, "fit_transform"):
                continue

            # Skip abstract base classes
            if inspect.isabstract(obj):
                continue

            # Extract parameters from __init__
            params = {}
            try:
                sig = inspect.signature(obj.__init__)
                for param_name, param in sig.parameters.items():
                    if param_name in ("self", "args", "kwargs"):
                        continue
                    param_info = {}
                    if param.default is not inspect.Parameter.empty:
                        param_info["default"] = param.default
                        param_info["required"] = False
                    else:
                        param_info["required"] = True

                    # Infer type from annotation
                    if param.annotation is not inspect.Parameter.empty:
                        type_name = getattr(param.annotation, "__name__", str(param.annotation))
                        param_info["type"] = type_name.lower()

                    params[param_name] = param_info
            except Exception:
                pass

            # Get description from docstring
            description = ""
            if obj.__doc__:
                description = obj.__doc__.strip().split("\n")[0]

            # Categorize
            category = _categorize_method(name)

            discovered.append({
                "name": name,
                "display_name": _to_display_name(name),
                "description": description or f"{name} preprocessing method",
                "category": category,
                "params": params,
                "available": True,
                "source": "nirs4all",
            })

    except Exception as e:
        print(f"Error discovering preprocessing methods: {e}")

    # Merge with static definitions for complete info
    merged = {}
    for method in PREPROCESSING_METHODS.values():
        merged[method["name"]] = method

    for method in discovered:
        if method["name"] not in merged:
            merged[method["name"]] = method
        else:
            # Update with discovered params if richer
            if len(method.get("params", {})) > len(merged[method["name"]].get("params", {})):
                merged[method["name"]]["params"] = method["params"]

    methods_list = list(merged.values())

    # Group by category
    categories = {}
    for method in methods_list:
        cat = method.get("category", "other")
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(method)

    return {
        "methods": methods_list,
        "categories": categories,
        "total": len(methods_list),
        "dynamic": True,
    }


def _categorize_method(name: str) -> str:
    """Categorize a preprocessing method by name."""
    name_lower = name.lower()

    if any(x in name_lower for x in ["snv", "msc", "scatter"]):
        return "scatter_correction"
    if any(x in name_lower for x in ["derivative", "deriv", "first", "second"]):
        return "derivative"
    if any(x in name_lower for x in ["baseline", "asls", "airpls", "arpls", "snip", "detrend"]):
        return "baseline"
    if any(x in name_lower for x in ["gaussian", "smooth", "savgol", "savitzky"]):
        return "smoothing"
    if any(x in name_lower for x in ["normalize", "scaler", "scale", "standard"]):
        return "scaling"
    if any(x in name_lower for x in ["wavelet", "haar"]):
        return "wavelet"
    if any(x in name_lower for x in ["absorbance", "reflectance", "convert", "transform"]):
        return "conversion"
    if any(x in name_lower for x in ["crop", "resample"]):
        return "features"
    if any(x in name_lower for x in ["noise", "augment", "shift", "drift"]):
        return "augmentation"

    return "other"


def _to_display_name(name: str) -> str:
    """Convert class name to human-readable display name."""
    import re

    # Handle common abbreviations
    abbreviations = {
        "SNV": "SNV",
        "MSC": "MSC",
        "ASLS": "ASLS",
        "ArPLS": "ArPLS",
        "AirPLS": "AirPLS",
        "SNIP": "SNIP",
        "PCA": "PCA",
        "SVD": "SVD",
    }

    for abbr in abbreviations:
        if name.upper() == abbr.upper():
            return abbreviations[abbr]

    # Insert spaces before capital letters
    result = re.sub(r"([A-Z])", r" \1", name).strip()
    return result


@router.get("/preprocessing/methods/{name}/schema")
async def get_method_schema(name: str):
    """
    Get full parameter schema for a preprocessing method.

    Returns detailed parameter information including types, defaults,
    min/max values, and descriptions.
    """
    # Check static registry first
    method = PREPROCESSING_METHODS.get(name)

    # Try case-insensitive match
    if not method:
        name_lower = name.lower()
        for key, val in PREPROCESSING_METHODS.items():
            if key.lower() == name_lower:
                method = val
                break

    if method:
        return {"method": method, "source": "registry"}

    # Try to introspect from nirs4all
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=404,
            detail=f"Preprocessing method '{name}' not found",
        )

    try:
        from nirs4all.operators import transforms as tf_module
        import inspect

        cls = getattr(tf_module, name, None)
        if not cls:
            raise HTTPException(
                status_code=404,
                detail=f"Preprocessing method '{name}' not found in nirs4all",
            )

        # Extract detailed parameter info
        params = {}
        try:
            sig = inspect.signature(cls.__init__)
            hints = {}
            try:
                from typing import get_type_hints
                hints = get_type_hints(cls.__init__)
            except Exception:
                pass

            for param_name, param in sig.parameters.items():
                if param_name in ("self", "args", "kwargs"):
                    continue

                param_info = {}
                if param.default is not inspect.Parameter.empty:
                    param_info["default"] = param.default
                    param_info["required"] = False
                else:
                    param_info["required"] = True

                # Get type from hints
                if param_name in hints:
                    hint = hints[param_name]
                    param_info["type"] = getattr(hint, "__name__", str(hint)).lower()
                elif param.annotation is not inspect.Parameter.empty:
                    param_info["type"] = getattr(param.annotation, "__name__", str(param.annotation)).lower()

                params[param_name] = param_info

        except Exception as e:
            print(f"Error extracting params for {name}: {e}")

        # Get docstring
        docstring = cls.__doc__ or ""

        return {
            "method": {
                "name": name,
                "display_name": _to_display_name(name),
                "description": docstring.strip().split("\n")[0] if docstring else "",
                "full_docstring": docstring,
                "category": _categorize_method(name),
                "params": params,
                "available": True,
            },
            "source": "introspection",
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error introspecting method '{name}': {str(e)}",
        )


@router.post("/preprocessing/chain/optimize")
async def suggest_preprocessing_chain(
    dataset_id: str,
    task_type: str = "regression",
    signal_type: str = "nir",
):
    """
    Suggest an optimal preprocessing chain for a dataset.

    Analyzes dataset characteristics and suggests appropriate preprocessing.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available",
        )

    from .spectra import _load_dataset

    dataset = _load_dataset(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        X = dataset.x({"partition": "train"}, layout="2d")
        if isinstance(X, list):
            X = X[0]

        # Analyze data characteristics
        n_samples, n_features = X.shape
        global_std = float(np.std(X))
        sample_std_mean = float(np.mean(np.std(X, axis=1)))
        feature_std_mean = float(np.mean(np.std(X, axis=0)))

        # Build suggestions based on data characteristics
        suggestions = []
        reasoning = []

        # Check for scatter effects (high sample variance)
        if sample_std_mean > global_std * 0.5:
            suggestions.append({"name": "StandardNormalVariate", "params": {}})
            reasoning.append("High sample-to-sample variance suggests scatter correction (SNV)")

        # Check for baseline issues (monotonic trends)
        sample_trends = np.mean(np.diff(X, axis=1), axis=1)
        if np.abs(np.mean(sample_trends)) > 0.01:
            suggestions.append({"name": "Detrend", "params": {}})
            reasoning.append("Monotonic trends detected, suggesting baseline correction")

        # Add smoothing for noisy data
        noise_estimate = np.mean(np.abs(np.diff(X, n=2, axis=1)))
        if noise_estimate > global_std * 0.1:
            suggestions.append({
                "name": "SavitzkyGolay",
                "params": {"window_length": 11, "polyorder": 2, "deriv": 0}
            })
            reasoning.append("High-frequency noise detected, suggesting smoothing")

        # Add scaling for sklearn models
        if task_type in ("regression", "classification"):
            suggestions.append({
                "name": "StandardScaler",
                "params": {"with_mean": True, "with_std": True}
            })
            reasoning.append("Standard scaling recommended for ML models")

        # Default suggestion if none triggered
        if not suggestions:
            suggestions = [
                {"name": "StandardNormalVariate", "params": {}},
                {"name": "StandardScaler", "params": {}},
            ]
            reasoning = ["Default preprocessing chain for NIRS data"]

        return {
            "success": True,
            "dataset_id": dataset_id,
            "suggested_chain": suggestions,
            "reasoning": reasoning,
            "data_characteristics": {
                "n_samples": n_samples,
                "n_features": n_features,
                "global_std": global_std,
                "sample_std_mean": sample_std_mean,
                "feature_std_mean": feature_std_mean,
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error analyzing dataset: {str(e)}",
        ) from e
