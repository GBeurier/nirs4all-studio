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

import inspect
import json
import sys
from pathlib import Path
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Dict, List, Any, Optional, Type, get_type_hints
from enum import Enum

from .workspace_manager import workspace_manager

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    from nirs4all.controllers import CONTROLLER_REGISTRY
    from nirs4all.operators import transforms, splitters

    NIRS4ALL_AVAILABLE = True
except ImportError as e:
    print(f"Note: nirs4all not available for pipelines API: {e}")
    CONTROLLER_REGISTRY = []
    NIRS4ALL_AVAILABLE = False


class OperatorCategory(str, Enum):
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
    description: Optional[str] = None
    steps: List[Dict[str, Any]] = []
    category: Optional[str] = "user"
    task_type: Optional[str] = None  # regression, classification


class PipelineUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    steps: Optional[List[Dict[str, Any]]] = None
    is_favorite: Optional[bool] = None
    task_type: Optional[str] = None


class PipelineValidateRequest(BaseModel):
    """Request model for validating a pipeline configuration."""

    steps: List[Dict[str, Any]]


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


def _load_pipeline(pipeline_id: str) -> Dict[str, Any]:
    """Load a pipeline from file."""
    pipelines_dir = _get_pipelines_dir()
    pipeline_file = pipelines_dir / f"{pipeline_id}.json"

    if not pipeline_file.exists():
        raise HTTPException(status_code=404, detail="Pipeline not found")

    try:
        with open(pipeline_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to load pipeline: {str(e)}"
        )


def _save_pipeline(pipeline: Dict[str, Any]) -> None:
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
                with open(pipeline_file, "r", encoding="utf-8") as f:
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


# ============================================================================
# Pipeline Samples API (MUST BE BEFORE /pipelines/{pipeline_id})
# ============================================================================


def _get_samples_dir_inline() -> Path:
    """Get the pipeline samples directory from nirs4all."""
    # Try relative to nirs4all_webapp (sibling directory)
    samples_path = Path(__file__).parent.parent.parent / "nirs4all" / "examples" / "pipeline_samples"
    if samples_path.exists():
        return samples_path
    # Try absolute path for development
    samples_path = Path("/home/delete/nirs4all/examples/pipeline_samples")
    if samples_path.exists():
        return samples_path
    raise HTTPException(status_code=404, detail="Pipeline samples directory not found")


@router.get("/pipelines/samples")
async def list_pipeline_samples():
    """
    List all available pipeline sample files.

    Returns the list of sample files from nirs4all/examples/pipeline_samples.
    """
    samples_dir = _get_samples_dir_inline()

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
    samples_dir = _get_samples_dir_inline()

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
async def clone_pipeline(pipeline_id: str, new_name: Optional[str] = None):
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


@router.get("/pipelines/operators")
async def list_operators():
    """
    List all available operators for pipeline building.

    Returns operators grouped by category, loaded from nirs4all CONTROLLER_REGISTRY
    and operators modules.
    """
    operators = {
        "preprocessing": [],
        "splitting": [],
        "models": [],
        "metrics": [],
        "augmentation": [],
        "feature_selection": [],
        "charts": [],
    }

    if NIRS4ALL_AVAILABLE:
        # Load preprocessing transforms from nirs4all
        preprocessing_transforms = [
            {
                "name": "StandardNormalVariate",
                "display_name": "SNV",
                "description": "Standard Normal Variate for scatter correction",
                "params": {},
            },
            {
                "name": "MultiplicativeScatterCorrection",
                "display_name": "MSC",
                "description": "Multiplicative Scatter Correction",
                "params": {},
            },
            {
                "name": "SavitzkyGolay",
                "display_name": "Savitzky-Golay",
                "description": "Smoothing and derivative filter",
                "params": {
                    "window_length": {"type": "int", "default": 11, "min": 3, "max": 51},
                    "polyorder": {"type": "int", "default": 2, "min": 0, "max": 5},
                    "deriv": {"type": "int", "default": 0, "min": 0, "max": 2},
                },
            },
            {
                "name": "FirstDerivative",
                "display_name": "First Derivative",
                "description": "Compute first derivative",
                "params": {},
            },
            {
                "name": "SecondDerivative",
                "display_name": "Second Derivative",
                "description": "Compute second derivative",
                "params": {},
            },
            {
                "name": "Detrend",
                "display_name": "Detrend",
                "description": "Remove linear trend",
                "params": {},
            },
            {
                "name": "Baseline",
                "display_name": "Baseline Correction",
                "description": "Subtract baseline",
                "params": {},
            },
            {
                "name": "Gaussian",
                "display_name": "Gaussian Smoothing",
                "description": "Gaussian filter smoothing",
                "params": {"sigma": {"type": "float", "default": 1.0, "min": 0.1, "max": 10.0}},
            },
            {
                "name": "StandardScaler",
                "display_name": "Standard Scaler",
                "description": "Standardize features (zero mean, unit variance)",
                "params": {"with_mean": {"type": "bool", "default": True}, "with_std": {"type": "bool", "default": True}},
            },
            {
                "name": "MinMaxScaler",
                "display_name": "Min-Max Scaler",
                "description": "Scale features to range [0, 1]",
                "params": {},
            },
            {
                "name": "RobustScaler",
                "display_name": "Robust Scaler",
                "description": "Scale using median and IQR (robust to outliers)",
                "params": {},
            },
            {
                "name": "LogTransform",
                "display_name": "Log Transform",
                "description": "Apply log transformation",
                "params": {},
            },
            {
                "name": "ReflectanceToAbsorbance",
                "display_name": "Reflectance to Absorbance",
                "description": "Convert R to A using log(1/R)",
                "params": {},
            },
        ]
        operators["preprocessing"] = preprocessing_transforms

        # Load splitters from nirs4all
        splitting_operators = [
            {
                "name": "TrainTestSplit",
                "display_name": "Train/Test Split",
                "description": "Simple random train/test split",
                "params": {"test_size": {"type": "float", "default": 0.2, "min": 0.05, "max": 0.5}},
            },
            {
                "name": "KFold",
                "display_name": "K-Fold CV",
                "description": "K-Fold cross-validation",
                "params": {"n_splits": {"type": "int", "default": 5, "min": 2, "max": 20}},
            },
            {
                "name": "StratifiedKFold",
                "display_name": "Stratified K-Fold",
                "description": "Stratified K-Fold for classification",
                "params": {"n_splits": {"type": "int", "default": 5, "min": 2, "max": 20}},
            },
            {
                "name": "KBinsStratifiedSplitter",
                "display_name": "KBins Stratified",
                "description": "Stratified split using binned continuous targets",
                "params": {
                    "test_size": {"type": "float", "default": 0.2},
                    "n_bins": {"type": "int", "default": 10, "min": 2, "max": 100},
                },
            },
            {
                "name": "KennardStoneSplitter",
                "display_name": "Kennard-Stone",
                "description": "Uniform feature space coverage",
                "params": {"test_size": {"type": "float", "default": 0.2}},
            },
            {
                "name": "SPXYSplitter",
                "display_name": "SPXY",
                "description": "Sample set partitioning based on X and Y",
                "params": {"test_size": {"type": "float", "default": 0.2}},
            },
            {
                "name": "SPXYGFold",
                "display_name": "SPXY K-Fold",
                "description": "SPXY-based K-Fold with group support",
                "params": {
                    "n_splits": {"type": "int", "default": 5},
                    "y_metric": {"type": "str", "default": "euclidean", "options": ["euclidean", "hamming", None]},
                },
            },
        ]
        operators["splitting"] = splitting_operators

        # Load models - both sklearn and custom nirs4all models
        model_operators = [
            # Standard sklearn models
            {
                "name": "PLSRegression",
                "display_name": "PLS Regression",
                "description": "Partial Least Squares Regression",
                "params": {"n_components": {"type": "int", "default": 10, "min": 1, "max": 100}},
                "source": "sklearn",
            },
            {
                "name": "RandomForestRegressor",
                "display_name": "Random Forest",
                "description": "Random Forest Regressor",
                "params": {
                    "n_estimators": {"type": "int", "default": 100, "min": 10, "max": 1000},
                    "max_depth": {"type": "int", "default": None},
                },
                "source": "sklearn",
            },
            {
                "name": "SVR",
                "display_name": "Support Vector Regression",
                "description": "Support Vector Machine for regression",
                "params": {"kernel": {"type": "str", "default": "rbf", "options": ["rbf", "linear", "poly"]}},
                "source": "sklearn",
            },
            {
                "name": "Ridge",
                "display_name": "Ridge Regression",
                "description": "Ridge regression with L2 regularization",
                "params": {"alpha": {"type": "float", "default": 1.0, "min": 0.0}},
                "source": "sklearn",
            },
            {
                "name": "Lasso",
                "display_name": "Lasso Regression",
                "description": "Lasso regression with L1 regularization",
                "params": {"alpha": {"type": "float", "default": 1.0, "min": 0.0}},
                "source": "sklearn",
            },
            {
                "name": "ElasticNet",
                "display_name": "Elastic Net",
                "description": "Elastic Net with L1+L2 regularization",
                "params": {
                    "alpha": {"type": "float", "default": 1.0},
                    "l1_ratio": {"type": "float", "default": 0.5, "min": 0.0, "max": 1.0},
                },
                "source": "sklearn",
            },
            {
                "name": "GradientBoostingRegressor",
                "display_name": "Gradient Boosting",
                "description": "Gradient Boosting Regressor",
                "params": {
                    "n_estimators": {"type": "int", "default": 100},
                    "learning_rate": {"type": "float", "default": 0.1},
                    "max_depth": {"type": "int", "default": 3},
                },
                "source": "sklearn",
            },
            # nirs4all custom PLS variants
            {
                "name": "LWPLS",
                "display_name": "Locally Weighted PLS",
                "description": "Locally Weighted Partial Least Squares",
                "params": {"n_components": {"type": "int", "default": 10}},
                "source": "nirs4all",
            },
            {
                "name": "IKPLS",
                "display_name": "Improved Kernel PLS",
                "description": "Fast PLS using IKPLS algorithm",
                "params": {"n_components": {"type": "int", "default": 10}},
                "source": "nirs4all",
            },
            {
                "name": "OPLS",
                "display_name": "Orthogonal PLS",
                "description": "Orthogonal Partial Least Squares",
                "params": {"n_components": {"type": "int", "default": 10}},
                "source": "nirs4all",
            },
            {
                "name": "KernelPLS",
                "display_name": "Kernel PLS",
                "description": "Non-linear PLS using kernel trick",
                "params": {"n_components": {"type": "int", "default": 10}, "kernel": {"type": "str", "default": "rbf"}},
                "source": "nirs4all",
            },
        ]
        operators["models"] = model_operators

        # Metrics
        metric_operators = [
            {"name": "r2_score", "display_name": "R² Score", "description": "Coefficient of determination", "params": {}},
            {"name": "rmse", "display_name": "RMSE", "description": "Root Mean Square Error", "params": {}},
            {"name": "mae", "display_name": "MAE", "description": "Mean Absolute Error", "params": {}},
            {"name": "rpd", "display_name": "RPD", "description": "Ratio of Performance to Deviation", "params": {}},
            {"name": "rpiq", "display_name": "RPIQ", "description": "Ratio of Performance to IQR", "params": {}},
            {"name": "bias", "display_name": "Bias", "description": "Mean prediction bias", "params": {}},
        ]
        operators["metrics"] = metric_operators

        # Data augmentation
        augmentation_operators = [
            {
                "name": "GaussianAdditiveNoise",
                "display_name": "Gaussian Noise",
                "description": "Add Gaussian noise to spectra",
                "params": {"std": {"type": "float", "default": 0.01}},
            },
            {
                "name": "MultiplicativeNoise",
                "display_name": "Multiplicative Noise",
                "description": "Apply multiplicative noise",
                "params": {"std": {"type": "float", "default": 0.01}},
            },
            {
                "name": "WavelengthShift",
                "display_name": "Wavelength Shift",
                "description": "Shift spectra along wavelength axis",
                "params": {"max_shift": {"type": "int", "default": 2}},
            },
            {
                "name": "LinearBaselineDrift",
                "display_name": "Baseline Drift",
                "description": "Add random linear baseline drift",
                "params": {},
            },
            {
                "name": "MixupAugmenter",
                "display_name": "Mixup",
                "description": "Mixup augmentation between samples",
                "params": {"alpha": {"type": "float", "default": 0.2}},
            },
        ]
        operators["augmentation"] = augmentation_operators

        # Feature selection
        feature_selection_operators = [
            {
                "name": "CARS",
                "display_name": "CARS",
                "description": "Competitive Adaptive Reweighted Sampling",
                "params": {"n_components": {"type": "int", "default": 10}},
            },
            {
                "name": "MCUVE",
                "display_name": "MC-UVE",
                "description": "Monte Carlo Uninformative Variable Elimination",
                "params": {},
            },
            {
                "name": "VIP",
                "display_name": "VIP Selection",
                "description": "Variable Importance in Projection",
                "params": {"threshold": {"type": "float", "default": 1.0}},
            },
        ]
        operators["feature_selection"] = feature_selection_operators

        # Charts/Visualization
        chart_operators = [
            {"name": "SpectraChart", "display_name": "Spectra Plot", "description": "Plot spectral data", "params": {}},
            {"name": "PredictionChart", "display_name": "Prediction Plot", "description": "Predicted vs actual plot", "params": {}},
            {"name": "ResidualChart", "display_name": "Residual Plot", "description": "Plot prediction residuals", "params": {}},
            {"name": "FoldChart", "display_name": "Fold Results", "description": "Cross-validation fold results", "params": {}},
        ]
        operators["charts"] = chart_operators

    else:
        # Fallback static operators when nirs4all not available
        operators["preprocessing"] = [
            {"name": "StandardScaler", "description": "Standardize features", "params": {}},
            {"name": "SNV", "description": "Standard Normal Variate", "params": {}},
            {"name": "MSC", "description": "Multiplicative Scatter Correction", "params": {}},
            {"name": "SavitzkyGolay", "description": "Savitzky-Golay filter", "params": {"window_length": 11, "polyorder": 2, "deriv": 0}},
        ]
        operators["splitting"] = [
            {"name": "TrainTestSplit", "description": "Simple train/test split", "params": {"test_size": 0.2}},
            {"name": "KFold", "description": "K-Fold cross-validation", "params": {"n_splits": 5}},
        ]
        operators["models"] = [
            {"name": "PLSRegression", "description": "Partial Least Squares Regression", "params": {"n_components": 10}},
            {"name": "RandomForest", "description": "Random Forest Regressor", "params": {"n_estimators": 100}},
        ]
        operators["metrics"] = [
            {"name": "R2Score", "description": "R² coefficient of determination", "params": {}},
            {"name": "RMSE", "description": "Root Mean Square Error", "params": {}},
        ]

    # Count totals
    total = sum(len(ops) for ops in operators.values())

    return {"operators": operators, "total": total, "nirs4all_available": NIRS4ALL_AVAILABLE}


@router.post("/pipelines/validate")
async def validate_pipeline(request: PipelineValidateRequest):
    """
    Validate a pipeline configuration.

    Checks that all operators exist and parameters are valid.
    Returns validation results with any errors or warnings.
    """
    results = {
        "valid": True,
        "steps": [],
        "errors": [],
        "warnings": [],
    }

    # Get available operators
    operators_response = await list_operators()
    all_operators = operators_response["operators"]

    # Flatten operators into a lookup dict
    operator_lookup = {}
    for category, ops in all_operators.items():
        for op in ops:
            name = op.get("name", "")
            operator_lookup[name.lower()] = op

    for i, step in enumerate(request.steps):
        step_result = {
            "index": i,
            "name": step.get("name", "unknown"),
            "type": step.get("type", "unknown"),
            "valid": True,
            "errors": [],
            "warnings": [],
        }

        step_name = step.get("name", "")
        step_type = step.get("type", "")
        step_params = step.get("params", {})

        # Check if operator exists
        if step_name.lower() not in operator_lookup:
            step_result["warnings"].append(
                f"Operator '{step_name}' not found in registry. May still work if available in environment."
            )
        else:
            # Validate parameters against schema
            op_info = operator_lookup[step_name.lower()]
            schema_params = op_info.get("params", {})

            for param_name, param_value in step_params.items():
                if param_name not in schema_params and schema_params:
                    step_result["warnings"].append(f"Unknown parameter: {param_name}")
                elif param_name in schema_params:
                    param_schema = schema_params[param_name]
                    if isinstance(param_schema, dict):
                        # Type checking
                        expected_type = param_schema.get("type")
                        if expected_type == "int" and not isinstance(param_value, int):
                            step_result["errors"].append(
                                f"Parameter '{param_name}' should be int"
                            )
                            step_result["valid"] = False
                        elif expected_type == "float" and not isinstance(param_value, (int, float)):
                            step_result["errors"].append(
                                f"Parameter '{param_name}' should be float"
                            )
                            step_result["valid"] = False

                        # Range checking
                        if "min" in param_schema and param_value < param_schema["min"]:
                            step_result["errors"].append(
                                f"Parameter '{param_name}' below minimum {param_schema['min']}"
                            )
                            step_result["valid"] = False
                        if "max" in param_schema and param_value > param_schema["max"]:
                            step_result["errors"].append(
                                f"Parameter '{param_name}' above maximum {param_schema['max']}"
                            )
                            step_result["valid"] = False

        if not step_result["valid"]:
            results["valid"] = False
        results["steps"].append(step_result)
        results["errors"].extend([f"Step {i}: {e}" for e in step_result["errors"]])
        results["warnings"].extend([f"Step {i}: {w}" for w in step_result["warnings"]])

    return results

# ============= Phase 2: Dynamic Operator Discovery =============


def _extract_params_from_class(cls: Type) -> Dict[str, Any]:
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

    except Exception as e:
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


def _discover_transform_operators() -> List[Dict[str, Any]]:
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
        print(f"Error discovering transforms: {e}")

    return operators


def _discover_splitter_operators() -> List[Dict[str, Any]]:
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
        print(f"Error discovering splitters: {e}")

    return operators


def _discover_model_operators() -> List[Dict[str, Any]]:
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
        print(f"Error discovering models: {e}")

    return operators


def _discover_augmentation_operators() -> List[Dict[str, Any]]:
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
        print(f"Error discovering augmenters: {e}")

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


@router.get("/pipelines/operators/discover")
async def discover_operators():
    """
    Dynamically discover all operators from nirs4all modules.

    This provides more detailed operator information by introspecting
    the actual classes.
    """
    discovered = {
        "preprocessing": _discover_transform_operators(),
        "splitting": _discover_splitter_operators(),
        "models": _discover_model_operators(),
        "augmentation": _discover_augmentation_operators(),
    }

    # Add sklearn standard models
    sklearn_models = [
        {
            "name": "PLSRegression",
            "display_name": "PLS Regression",
            "description": "Partial Least Squares Regression from sklearn",
            "params": {"n_components": {"type": "int", "default": 10, "required": False}},
            "source": "sklearn",
        },
        {
            "name": "RandomForestRegressor",
            "display_name": "Random Forest Regressor",
            "description": "Random Forest ensemble for regression",
            "params": {
                "n_estimators": {"type": "int", "default": 100, "required": False},
                "max_depth": {"type": "int", "default": None, "required": False},
            },
            "source": "sklearn",
        },
        {
            "name": "GradientBoostingRegressor",
            "display_name": "Gradient Boosting",
            "description": "Gradient Boosting ensemble for regression",
            "params": {
                "n_estimators": {"type": "int", "default": 100, "required": False},
                "learning_rate": {"type": "float", "default": 0.1, "required": False},
                "max_depth": {"type": "int", "default": 3, "required": False},
            },
            "source": "sklearn",
        },
        {
            "name": "SVR",
            "display_name": "Support Vector Regression",
            "description": "Support Vector Machine for regression",
            "params": {
                "kernel": {"type": "str", "default": "rbf", "options": ["rbf", "linear", "poly"], "required": False},
                "C": {"type": "float", "default": 1.0, "required": False},
            },
            "source": "sklearn",
        },
        {
            "name": "Ridge",
            "display_name": "Ridge Regression",
            "description": "Ridge regression with L2 regularization",
            "params": {"alpha": {"type": "float", "default": 1.0, "required": False}},
            "source": "sklearn",
        },
        {
            "name": "Lasso",
            "display_name": "Lasso Regression",
            "description": "Lasso regression with L1 regularization",
            "params": {"alpha": {"type": "float", "default": 1.0, "required": False}},
            "source": "sklearn",
        },
        {
            "name": "ElasticNet",
            "display_name": "Elastic Net",
            "description": "Elastic Net with combined L1/L2 regularization",
            "params": {
                "alpha": {"type": "float", "default": 1.0, "required": False},
                "l1_ratio": {"type": "float", "default": 0.5, "required": False},
            },
            "source": "sklearn",
        },
    ]
    discovered["models"].extend(sklearn_models)

    # Add sklearn scalers to preprocessing
    sklearn_scalers = [
        {
            "name": "StandardScaler",
            "display_name": "Standard Scaler",
            "description": "Standardize features by removing mean and scaling to unit variance",
            "params": {
                "with_mean": {"type": "bool", "default": True, "required": False},
                "with_std": {"type": "bool", "default": True, "required": False},
            },
            "source": "sklearn",
            "category": "scaling",
        },
        {
            "name": "MinMaxScaler",
            "display_name": "Min-Max Scaler",
            "description": "Scale features to a given range (default 0-1)",
            "params": {
                "feature_range": {"type": "array", "default": [0, 1], "required": False},
            },
            "source": "sklearn",
            "category": "scaling",
        },
        {
            "name": "RobustScaler",
            "display_name": "Robust Scaler",
            "description": "Scale using statistics robust to outliers (median, IQR)",
            "params": {
                "with_centering": {"type": "bool", "default": True, "required": False},
                "with_scaling": {"type": "bool", "default": True, "required": False},
            },
            "source": "sklearn",
            "category": "scaling",
        },
    ]
    discovered["preprocessing"].extend(sklearn_scalers)

    # Add standard CV splitters
    sklearn_splitters = [
        {
            "name": "KFold",
            "display_name": "K-Fold CV",
            "description": "K-Fold cross-validation",
            "params": {
                "n_splits": {"type": "int", "default": 5, "min": 2, "max": 20, "required": False},
                "shuffle": {"type": "bool", "default": True, "required": False},
            },
            "source": "sklearn",
        },
        {
            "name": "StratifiedKFold",
            "display_name": "Stratified K-Fold",
            "description": "Stratified K-Fold for classification",
            "params": {
                "n_splits": {"type": "int", "default": 5, "min": 2, "max": 20, "required": False},
                "shuffle": {"type": "bool", "default": True, "required": False},
            },
            "source": "sklearn",
        },
        {
            "name": "ShuffleSplit",
            "display_name": "Shuffle Split",
            "description": "Random permutation cross-validator",
            "params": {
                "n_splits": {"type": "int", "default": 10, "required": False},
                "test_size": {"type": "float", "default": 0.1, "required": False},
            },
            "source": "sklearn",
        },
    ]
    discovered["splitting"].extend(sklearn_splitters)

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
    validation_result = await validate_pipeline(
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


@router.post("/pipelines/from-preset/{preset_id}")
async def create_pipeline_from_preset(preset_id: str, name: Optional[str] = None):
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


class PipelineCountRequest(BaseModel):
    """Request model for counting pipeline variants."""
    steps: List[Dict[str, Any]]


def _convert_frontend_steps_to_nirs4all(steps: List[Dict[str, Any]]) -> List[Any]:
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
        generator = step.get("generator")
        children = step.get("children", [])

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

        # Handle generator step type (choice/or node)
        if step_type == "generator" and children:
            # This is a ChooseOne/ChooseN node
            alternatives = []
            for child in children:
                child_steps = _convert_frontend_steps_to_nirs4all([child])
                alternatives.extend(child_steps)
            if alternatives:
                gen_step = {"_or_": alternatives}
                # Include pick/count from generator options
                if generator:
                    if generator.get("pick"):
                        gen_step["pick"] = generator["pick"]
                    if generator.get("count"):
                        gen_step["count"] = generator["count"]
                result.append(gen_step)
            continue

        # Handle branch step type
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
            # Generator contains _or_, _range_, _log_range_, pick, etc.
            if "_or_" in generator and generator["_or_"]:
                # The _or_ contains alternatives
                gen_step = {"_or_": generator["_or_"]}
                if generator.get("pick"):
                    gen_step["pick"] = generator["pick"]
                if generator.get("count"):
                    gen_step["count"] = generator["count"]
                result.append(gen_step)
            elif "_range_" in generator and generator["_range_"]:
                # Range generator on a param
                gen_step = {"_range_": generator["_range_"]}
                result.append(gen_step)
            elif "_log_range_" in generator and generator["_log_range_"]:
                # Log range generator
                gen_step = {"_log_range_": generator["_log_range_"]}
                result.append(gen_step)
            else:
                result.append(base_step)
        else:
            result.append(base_step)

        # Handle children for other container steps (sample_augmentation, etc.)
        if children and step_type not in ("branch", "generator"):
            child_steps = _convert_frontend_steps_to_nirs4all(children)
            # These are typically wrapped in the container keyword
            if step_type == "sample_augmentation":
                result.append({"sample_augmentation": {"transformers": child_steps}})
            elif step_type == "feature_augmentation":
                result.append({"feature_augmentation": child_steps})

    return result


@router.post("/pipelines/count-variants")
async def count_pipeline_variants(request: PipelineCountRequest):
    """
    Count the number of pipeline variants without generating them.

    Uses nirs4all's count_combinations function to efficiently calculate
    the total number of variants a pipeline specification would generate.

    This is useful for:
    - Showing users how many pipelines will be tested
    - Warning about combinatorial explosion
    - Validating pipeline complexity before execution
    """
    if not NIRS4ALL_AVAILABLE:
        # Fallback: simple count (1 variant if no generators)
        return {
            "count": 1,
            "warning": "nirs4all not available, using simple count",
            "breakdown": {}
        }

    try:
        from nirs4all.pipeline.config.generator import count_combinations

        # Convert frontend steps to nirs4all format
        nirs4all_steps = _convert_frontend_steps_to_nirs4all(request.steps)

        # Count combinations
        total_count = count_combinations(nirs4all_steps)

        # Calculate per-step breakdown
        breakdown = {}
        for i, step in enumerate(request.steps):
            step_name = step.get("name", f"step_{i}")
            step_id = step.get("id", str(i))

            # Count just this step
            single_step = _convert_frontend_steps_to_nirs4all([step])
            step_count = count_combinations(single_step) if single_step else 1

            breakdown[step_id] = {
                "name": step_name,
                "count": step_count
            }

        # Add warning for large counts
        warning = None
        if total_count > 10000:
            warning = f"Large search space: {total_count:,} variants. Consider reducing with 'count' limiter."
        elif total_count > 1000:
            warning = f"Moderate search space: {total_count:,} variants."

        return {
            "count": total_count,
            "breakdown": breakdown,
            "warning": warning,
            "nirs4all_format": nirs4all_steps  # Debug: show converted format
        }

    except Exception as e:
        return {
            "count": 1,
            "error": str(e),
            "breakdown": {}
        }


# ============= Phase 6: Pipeline Execution =============


class PipelineRunRequest(BaseModel):
    """Request model for running a pipeline."""
    dataset_id: str
    verbose: int = 1
    export_model: bool = True
    model_name: Optional[str] = None


class PipelineExportRequest(BaseModel):
    """Request model for exporting pipeline."""
    format: str = "python"  # python, yaml, json
    dataset_path: Optional[str] = None


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

    from .workspace_manager import workspace_manager
    from .jobs import job_manager, JobType

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
    import time
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

        result = nirs4all.run(
            pipeline=pipeline_steps,
            dataset=dataset_path,
            verbose=config.get("verbose", 1),
        )

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
                print(f"Error exporting model: {e}")

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
async def import_pipeline(content: str, format: str = "yaml", name: Optional[str] = None):
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
    # Try absolute path for development
    samples_path = Path("/home/delete/nirs4all/examples/pipeline_samples")
    if samples_path.exists():
        return samples_path
    raise HTTPException(status_code=404, detail="Pipeline samples directory not found")


def _load_sample_file(filepath: Path) -> Dict[str, Any]:
    """Load a pipeline sample file (JSON or YAML)."""
    import yaml

    suffix = filepath.suffix.lower()
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            if suffix == '.json':
                return json.load(f)
            elif suffix in ('.yaml', '.yml'):
                return yaml.safe_load(f)
            else:
                raise HTTPException(status_code=400, detail=f"Unsupported format: {suffix}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load sample: {e}")


def _filter_comments(steps: List[Any]) -> List[Any]:
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


def _get_canonical_pipeline(filepath: Path) -> Dict[str, Any]:
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
async def validate_sample_roundtrip(sample_id: str, editor_steps: List[Dict[str, Any]]):
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
    steps: List[Dict[str, Any]]
    input_shape: Dict[str, int]  # {samples: N, features: M}


class ShapeAtStep(BaseModel):
    """Shape at a specific pipeline step."""
    step_id: str
    step_name: str
    input_shape: Dict[str, int]
    output_shape: Dict[str, int]
    warnings: List[Dict[str, Any]] = []


class ShapePropagationResponse(BaseModel):
    """Response model for shape propagation calculation."""
    shapes: List[ShapeAtStep]
    warnings: List[Dict[str, Any]]
    output_shape: Dict[str, int]
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


def _propagate_shape(step: Dict[str, Any], input_shape: Dict[str, int]) -> tuple:
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

