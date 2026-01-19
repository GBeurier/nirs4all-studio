"""
Models API routes for nirs4all webapp.

This module provides FastAPI routes for model management,
including listing available models, loading trained models,
getting model parameters, and model comparison.

Phase 3 Implementation:
- List available model types (sklearn, nirs4all)
- Load and inspect trained models
- Model parameter schemas
- Model comparison endpoints
"""

from __future__ import annotations

import inspect
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, get_type_hints

import joblib
import numpy as np
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    from nirs4all.operators import models as nirs4all_models

    NIRS4ALL_AVAILABLE = True
except ImportError as e:
    print(f"Note: nirs4all not available for models API: {e}")
    NIRS4ALL_AVAILABLE = False


router = APIRouter()


# ============= Request/Response Models =============


class ModelInfo(BaseModel):
    """Information about an available model type."""

    name: str
    display_name: str
    description: str
    category: str  # regression, classification, both
    source: str  # sklearn, nirs4all, tensorflow, torch
    params: Dict[str, Any] = {}
    supports_regression: bool = True
    supports_classification: bool = False


class TrainedModelInfo(BaseModel):
    """Information about a trained model file."""

    id: str
    name: str
    path: str
    model_type: str
    created_at: str
    file_size: int
    pipeline_id: Optional[str] = None
    job_id: Optional[str] = None
    metrics: Dict[str, Any] = {}


class ModelSummary(BaseModel):
    """Summary of a loaded model."""

    model_type: str
    n_features_in: Optional[int] = None
    n_targets: Optional[int] = None
    params: Dict[str, Any] = {}
    is_fitted: bool = False
    coefficients_shape: Optional[List[int]] = None


class CompareModelsRequest(BaseModel):
    """Request for comparing multiple models."""

    model_ids: List[str] = Field(..., min_length=2, description="IDs of models to compare")
    dataset_id: str = Field(..., description="Dataset to use for comparison")
    partition: str = Field("test", description="Dataset partition to use")


class ModelComparisonResult(BaseModel):
    """Result of model comparison."""

    models: List[Dict[str, Any]]
    best_model_id: str
    comparison_metric: str
    dataset_id: str


# ============= Model Registry =============


# Sklearn model definitions
SKLEARN_MODELS = {
    # Regression models
    "PLSRegression": {
        "module": "sklearn.cross_decomposition",
        "class": "PLSRegression",
        "display_name": "PLS Regression",
        "description": "Partial Least Squares Regression",
        "category": "regression",
        "params": {
            "n_components": {"type": "int", "default": 10, "min": 1, "max": 100},
            "scale": {"type": "bool", "default": True},
            "max_iter": {"type": "int", "default": 500, "min": 100, "max": 10000},
        },
    },
    "Ridge": {
        "module": "sklearn.linear_model",
        "class": "Ridge",
        "display_name": "Ridge Regression",
        "description": "Ridge regression with L2 regularization",
        "category": "regression",
        "params": {
            "alpha": {"type": "float", "default": 1.0, "min": 0.0},
            "fit_intercept": {"type": "bool", "default": True},
        },
    },
    "Lasso": {
        "module": "sklearn.linear_model",
        "class": "Lasso",
        "display_name": "Lasso Regression",
        "description": "Lasso regression with L1 regularization",
        "category": "regression",
        "params": {
            "alpha": {"type": "float", "default": 1.0, "min": 0.0},
            "fit_intercept": {"type": "bool", "default": True},
            "max_iter": {"type": "int", "default": 1000, "min": 100},
        },
    },
    "ElasticNet": {
        "module": "sklearn.linear_model",
        "class": "ElasticNet",
        "display_name": "Elastic Net",
        "description": "Elastic Net with L1+L2 regularization",
        "category": "regression",
        "params": {
            "alpha": {"type": "float", "default": 1.0, "min": 0.0},
            "l1_ratio": {"type": "float", "default": 0.5, "min": 0.0, "max": 1.0},
            "fit_intercept": {"type": "bool", "default": True},
        },
    },
    "SVR": {
        "module": "sklearn.svm",
        "class": "SVR",
        "display_name": "Support Vector Regression",
        "description": "Support Vector Machine for regression",
        "category": "regression",
        "params": {
            "kernel": {"type": "str", "default": "rbf", "options": ["rbf", "linear", "poly", "sigmoid"]},
            "C": {"type": "float", "default": 1.0, "min": 0.001},
            "epsilon": {"type": "float", "default": 0.1, "min": 0.0},
            "gamma": {"type": "str", "default": "scale", "options": ["scale", "auto"]},
        },
    },
    "RandomForestRegressor": {
        "module": "sklearn.ensemble",
        "class": "RandomForestRegressor",
        "display_name": "Random Forest Regressor",
        "description": "Random Forest ensemble for regression",
        "category": "regression",
        "params": {
            "n_estimators": {"type": "int", "default": 100, "min": 10, "max": 1000},
            "max_depth": {"type": "int", "default": None, "min": 1, "nullable": True},
            "min_samples_split": {"type": "int", "default": 2, "min": 2},
            "min_samples_leaf": {"type": "int", "default": 1, "min": 1},
            "max_features": {"type": "str", "default": "sqrt", "options": ["sqrt", "log2", None]},
        },
    },
    "GradientBoostingRegressor": {
        "module": "sklearn.ensemble",
        "class": "GradientBoostingRegressor",
        "display_name": "Gradient Boosting Regressor",
        "description": "Gradient Boosting ensemble for regression",
        "category": "regression",
        "params": {
            "n_estimators": {"type": "int", "default": 100, "min": 10, "max": 1000},
            "learning_rate": {"type": "float", "default": 0.1, "min": 0.001, "max": 1.0},
            "max_depth": {"type": "int", "default": 3, "min": 1, "max": 20},
            "subsample": {"type": "float", "default": 1.0, "min": 0.1, "max": 1.0},
        },
    },
    "KNeighborsRegressor": {
        "module": "sklearn.neighbors",
        "class": "KNeighborsRegressor",
        "display_name": "K-Nearest Neighbors Regressor",
        "description": "K-Nearest Neighbors for regression",
        "category": "regression",
        "params": {
            "n_neighbors": {"type": "int", "default": 5, "min": 1, "max": 100},
            "weights": {"type": "str", "default": "uniform", "options": ["uniform", "distance"]},
            "metric": {"type": "str", "default": "minkowski", "options": ["euclidean", "manhattan", "minkowski"]},
        },
    },
    # Classification models
    "RandomForestClassifier": {
        "module": "sklearn.ensemble",
        "class": "RandomForestClassifier",
        "display_name": "Random Forest Classifier",
        "description": "Random Forest ensemble for classification",
        "category": "classification",
        "params": {
            "n_estimators": {"type": "int", "default": 100, "min": 10, "max": 1000},
            "max_depth": {"type": "int", "default": None, "min": 1, "nullable": True},
            "min_samples_split": {"type": "int", "default": 2, "min": 2},
            "class_weight": {"type": "str", "default": None, "options": [None, "balanced", "balanced_subsample"]},
        },
    },
    "GradientBoostingClassifier": {
        "module": "sklearn.ensemble",
        "class": "GradientBoostingClassifier",
        "display_name": "Gradient Boosting Classifier",
        "description": "Gradient Boosting ensemble for classification",
        "category": "classification",
        "params": {
            "n_estimators": {"type": "int", "default": 100, "min": 10, "max": 1000},
            "learning_rate": {"type": "float", "default": 0.1, "min": 0.001, "max": 1.0},
            "max_depth": {"type": "int", "default": 3, "min": 1, "max": 20},
        },
    },
    "SVC": {
        "module": "sklearn.svm",
        "class": "SVC",
        "display_name": "Support Vector Classifier",
        "description": "Support Vector Machine for classification",
        "category": "classification",
        "params": {
            "kernel": {"type": "str", "default": "rbf", "options": ["rbf", "linear", "poly", "sigmoid"]},
            "C": {"type": "float", "default": 1.0, "min": 0.001},
            "gamma": {"type": "str", "default": "scale", "options": ["scale", "auto"]},
            "probability": {"type": "bool", "default": False},
        },
    },
    "LogisticRegression": {
        "module": "sklearn.linear_model",
        "class": "LogisticRegression",
        "display_name": "Logistic Regression",
        "description": "Logistic Regression for classification",
        "category": "classification",
        "params": {
            "C": {"type": "float", "default": 1.0, "min": 0.001},
            "penalty": {"type": "str", "default": "l2", "options": ["l1", "l2", "elasticnet", None]},
            "solver": {"type": "str", "default": "lbfgs", "options": ["lbfgs", "liblinear", "saga"]},
            "max_iter": {"type": "int", "default": 100, "min": 10},
        },
    },
}

# nirs4all model definitions (dynamically discovered)
NIRS4ALL_MODELS = {}

if NIRS4ALL_AVAILABLE:
    # PLS variants
    pls_models = [
        ("IKPLS", "Improved Kernel PLS", "Fast PLS using IKPLS algorithm"),
        ("OPLS", "Orthogonal PLS", "Orthogonal Partial Least Squares"),
        ("OPLSDA", "OPLS-DA", "Orthogonal PLS for Discriminant Analysis"),
        ("PLSDA", "PLS-DA", "Partial Least Squares Discriminant Analysis"),
        ("LWPLS", "Locally Weighted PLS", "Locally Weighted Partial Least Squares"),
        ("KernelPLS", "Kernel PLS", "Non-linear PLS using kernel trick"),
        ("SparsePLS", "Sparse PLS", "PLS with L1 sparsity constraint"),
        ("SIMPLS", "SIMPLS", "SIMPLS algorithm for PLS"),
        ("DiPLS", "Distance PLS", "Distance-based Partial Least Squares"),
        ("IntervalPLS", "Interval PLS", "Interval Partial Least Squares"),
        ("RobustPLS", "Robust PLS", "Robust PLS for noisy data"),
        ("RecursivePLS", "Recursive PLS", "Recursive Partial Least Squares"),
        ("MBPLS", "Multiblock PLS", "Multiblock Partial Least Squares"),
    ]

    for name, display, desc in pls_models:
        if hasattr(nirs4all_models, name):
            NIRS4ALL_MODELS[name] = {
                "class": name,
                "display_name": display,
                "description": desc,
                "category": "regression",
                "params": {
                    "n_components": {"type": "int", "default": 10, "min": 1, "max": 100},
                },
            }


# ============= Model Routes =============


@router.get("/models", response_model=List[ModelInfo])
async def list_models(
    category: Optional[str] = Query(None, description="Filter by category: regression, classification"),
    source: Optional[str] = Query(None, description="Filter by source: sklearn, nirs4all"),
):
    """
    List all available model types.

    Returns models from sklearn and nirs4all that can be used in pipelines.
    """
    models = []

    # Add sklearn models
    for name, info in SKLEARN_MODELS.items():
        model_info = ModelInfo(
            name=name,
            display_name=info["display_name"],
            description=info["description"],
            category=info["category"],
            source="sklearn",
            params=info["params"],
            supports_regression=info["category"] == "regression",
            supports_classification=info["category"] == "classification",
        )
        models.append(model_info)

    # Add nirs4all models
    for name, info in NIRS4ALL_MODELS.items():
        model_info = ModelInfo(
            name=name,
            display_name=info["display_name"],
            description=info["description"],
            category=info["category"],
            source="nirs4all",
            params=info["params"],
            supports_regression=info["category"] in ("regression", "both"),
            supports_classification=info["category"] in ("classification", "both"),
        )
        models.append(model_info)

    # Apply filters
    if category:
        models = [m for m in models if m.category == category]
    if source:
        models = [m for m in models if m.source == source]

    return models


@router.get("/models/{model_name}/params")
async def get_model_params(model_name: str):
    """
    Get parameter schema for a model type.

    Returns detailed parameter information including types, defaults, and constraints.
    """
    # Check sklearn models
    if model_name in SKLEARN_MODELS:
        info = SKLEARN_MODELS[model_name]
        return {
            "model_name": model_name,
            "display_name": info["display_name"],
            "source": "sklearn",
            "params": info["params"],
            "category": info["category"],
        }

    # Check nirs4all models
    if model_name in NIRS4ALL_MODELS:
        info = NIRS4ALL_MODELS[model_name]
        return {
            "model_name": model_name,
            "display_name": info["display_name"],
            "source": "nirs4all",
            "params": info["params"],
            "category": info["category"],
        }

    # Try to introspect from nirs4all
    if NIRS4ALL_AVAILABLE:
        model_class = getattr(nirs4all_models, model_name, None)
        if model_class:
            params = _extract_params_from_class(model_class)
            doc = model_class.__doc__ or ""
            return {
                "model_name": model_name,
                "display_name": _class_name_to_display(model_name),
                "source": "nirs4all",
                "params": params,
                "description": doc.strip().split("\n")[0] if doc else "",
            }

    raise HTTPException(
        status_code=404,
        detail=f"Model '{model_name}' not found. Available models: {list(SKLEARN_MODELS.keys()) + list(NIRS4ALL_MODELS.keys())}",
    )


@router.get("/models/trained")
async def list_trained_models():
    """
    List all trained models in the current workspace.

    Returns models that have been trained and saved to disk.
    """
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    models_dir = Path(workspace.path) / "models"
    if not models_dir.exists():
        return {"models": [], "total": 0}

    models = []
    for model_file in models_dir.glob("*.joblib"):
        try:
            stat = model_file.stat()

            # Parse filename for metadata
            parts = model_file.stem.split("_")
            pipeline_id = parts[0] if len(parts) > 0 else None
            job_id = parts[1] if len(parts) > 1 else None

            # Try to load model to get type
            model = joblib.load(model_file)
            model_type = type(model).__name__

            models.append(
                TrainedModelInfo(
                    id=model_file.stem,
                    name=model_file.name,
                    path=str(model_file),
                    model_type=model_type,
                    created_at=datetime.fromtimestamp(stat.st_ctime).isoformat(),
                    file_size=stat.st_size,
                    pipeline_id=pipeline_id,
                    job_id=job_id,
                )
            )

        except Exception as e:
            print(f"Error loading model {model_file}: {e}")
            continue

    # Sort by creation date
    models.sort(key=lambda m: m.created_at, reverse=True)

    return {"models": models, "total": len(models)}


@router.get("/models/trained/{model_id}")
async def get_trained_model(model_id: str):
    """
    Get information about a specific trained model.
    """
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    model_path = Path(workspace.path) / "models" / f"{model_id}.joblib"
    if not model_path.exists():
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    try:
        model = joblib.load(model_path)
        stat = model_path.stat()

        # Get model summary
        summary = _get_model_summary(model)

        # Parse filename for metadata
        parts = model_id.split("_")
        pipeline_id = parts[0] if len(parts) > 0 else None
        job_id = parts[1] if len(parts) > 1 else None

        return {
            "model": {
                "id": model_id,
                "name": model_path.name,
                "path": str(model_path),
                "model_type": type(model).__name__,
                "created_at": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                "file_size": stat.st_size,
                "pipeline_id": pipeline_id,
                "job_id": job_id,
            },
            "summary": summary,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error loading model '{model_id}': {str(e)}",
        )


@router.get("/models/trained/{model_id}/summary", response_model=ModelSummary)
async def get_model_summary(model_id: str):
    """
    Get a summary of a trained model including parameters and structure.
    """
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    model_path = Path(workspace.path) / "models" / f"{model_id}.joblib"
    if not model_path.exists():
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    try:
        model = joblib.load(model_path)
        summary = _get_model_summary(model)
        return ModelSummary(**summary)

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error loading model '{model_id}': {str(e)}",
        )


@router.post("/models/trained/{model_id}/load")
async def load_model(model_id: str):
    """
    Load a trained model into memory for predictions.

    Returns a confirmation that the model is loaded and ready.
    """
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    model_path = Path(workspace.path) / "models" / f"{model_id}.joblib"
    if not model_path.exists():
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    try:
        model = joblib.load(model_path)

        # Cache in global model store
        global _loaded_models
        _loaded_models[model_id] = {
            "model": model,
            "path": str(model_path),
            "loaded_at": datetime.now().isoformat(),
        }

        return {
            "success": True,
            "model_id": model_id,
            "model_type": type(model).__name__,
            "message": "Model loaded and ready for predictions",
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error loading model '{model_id}': {str(e)}",
        )


@router.delete("/models/trained/{model_id}")
async def delete_trained_model(model_id: str):
    """
    Delete a trained model from disk.
    """
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    model_path = Path(workspace.path) / "models" / f"{model_id}.joblib"
    if not model_path.exists():
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    try:
        model_path.unlink()

        # Remove from cache if loaded
        global _loaded_models
        if model_id in _loaded_models:
            del _loaded_models[model_id]

        return {
            "success": True,
            "model_id": model_id,
            "message": "Model deleted successfully",
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error deleting model '{model_id}': {str(e)}",
        )


@router.post("/models/compare", response_model=ModelComparisonResult)
async def compare_models(request: CompareModelsRequest):
    """
    Compare multiple trained models on a dataset.

    Evaluates each model on the specified dataset partition and returns
    comparative metrics.
    """
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Load dataset
    from .spectra import _load_dataset

    dataset = _load_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset '{request.dataset_id}' not found",
        )

    selector = {"partition": request.partition}
    X = dataset.x(selector, layout="2d")
    if isinstance(X, list):
        X = X[0]

    y = None
    try:
        y = dataset.y(selector)
    except Exception:
        pass

    if y is None:
        raise HTTPException(
            status_code=400,
            detail="Dataset has no target values for comparison",
        )

    # Evaluate each model
    results = []
    best_score = float("-inf")
    best_model_id = None

    for model_id in request.model_ids:
        model_path = Path(workspace.path) / "models" / f"{model_id}.joblib"
        if not model_path.exists():
            results.append({
                "model_id": model_id,
                "error": "Model not found",
            })
            continue

        try:
            model = joblib.load(model_path)
            y_pred = model.predict(X)

            from .training import _compute_metrics

            metrics = _compute_metrics(y, y_pred)

            results.append({
                "model_id": model_id,
                "model_type": type(model).__name__,
                "metrics": metrics,
            })

            # Track best model
            r2 = metrics.get("r2", float("-inf"))
            if r2 > best_score:
                best_score = r2
                best_model_id = model_id

        except Exception as e:
            results.append({
                "model_id": model_id,
                "error": str(e),
            })

    if best_model_id is None:
        raise HTTPException(
            status_code=500,
            detail="No models could be evaluated",
        )

    return ModelComparisonResult(
        models=results,
        best_model_id=best_model_id,
        comparison_metric="r2",
        dataset_id=request.dataset_id,
    )


@router.post("/models/{model_name}/instantiate")
async def instantiate_model(model_name: str, params: Dict[str, Any] = {}):
    """
    Create a new model instance with specified parameters.

    Returns a confirmation that the model was created successfully.
    This is useful for validating parameters before training.
    """
    try:
        from .training import _get_model_instance

        model = _get_model_instance(model_name, params)
        if model is None:
            raise HTTPException(
                status_code=404,
                detail=f"Model '{model_name}' not found",
            )

        return {
            "success": True,
            "model_name": model_name,
            "model_type": type(model).__name__,
            "params": params,
            "message": "Model instantiated successfully (not saved)",
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Error instantiating model: {str(e)}",
        )


# ============= Helper Functions =============

# Cache for loaded models
_loaded_models: Dict[str, Dict[str, Any]] = {}


def get_loaded_model(model_id: str) -> Optional[Any]:
    """Get a loaded model by ID.

    Args:
        model_id: Model ID

    Returns:
        Model instance or None if not loaded
    """
    if model_id in _loaded_models:
        return _loaded_models[model_id]["model"]
    return None


def _get_model_summary(model: Any) -> Dict[str, Any]:
    """Extract summary information from a model.

    Args:
        model: Trained model instance

    Returns:
        Summary dictionary
    """
    summary = {
        "model_type": type(model).__name__,
        "is_fitted": False,
        "params": {},
    }

    # Get parameters
    if hasattr(model, "get_params"):
        try:
            summary["params"] = model.get_params()
        except Exception:
            pass

    # Check if fitted
    try:
        if hasattr(model, "coef_"):
            summary["is_fitted"] = True
            if hasattr(model.coef_, "shape"):
                summary["coefficients_shape"] = list(model.coef_.shape)
        elif hasattr(model, "n_iter_"):
            summary["is_fitted"] = True
        elif hasattr(model, "feature_importances_"):
            summary["is_fitted"] = True
        elif hasattr(model, "components_"):
            summary["is_fitted"] = True
    except Exception:
        pass

    # Get input/output dimensions
    if hasattr(model, "n_features_in_"):
        summary["n_features_in"] = model.n_features_in_

    if hasattr(model, "n_targets_"):
        summary["n_targets"] = model.n_targets_

    return summary


def _extract_params_from_class(cls) -> Dict[str, Any]:
    """Extract parameter schema from a class's __init__ signature.

    Args:
        cls: Model class

    Returns:
        Dictionary of parameter schemas
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

            if param.default is not inspect.Parameter.empty:
                param_info["default"] = param.default

            annotation = hints.get(name) or param.annotation
            if annotation is not inspect.Parameter.empty:
                type_name = getattr(annotation, "__name__", str(annotation))
                param_info["type"] = type_name.lower()

            params[name] = param_info

    except Exception:
        pass

    return params


def _class_name_to_display(name: str) -> str:
    """Convert class name to display-friendly name.

    Args:
        name: Class name

    Returns:
        Display-friendly name
    """
    import re

    abbreviations = ["PLS", "SVM", "KNN", "SVR", "SVC", "PCA", "LDA", "QDA"]
    for abbr in abbreviations:
        if name.upper() == abbr:
            return abbr

    result = re.sub(r"([A-Z])", r" \1", name).strip()
    return result
