"""
Models API routes for nirs4all webapp.

This module provides FastAPI routes for model management,
including listing available model types and trained model bundles.

Uses nirs4all BundleLoader for .n4a bundle operations.
"""

from __future__ import annotations

import inspect
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, get_type_hints

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager
from .shared.logger import get_logger

logger = get_logger(__name__)

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    from nirs4all.operators import models as nirs4all_models
    from nirs4all.pipeline.bundle import BundleLoader
    import nirs4all

    NIRS4ALL_AVAILABLE = True
except ImportError as e:
    logger.info("nirs4all not available for models API: %s", e)
    NIRS4ALL_AVAILABLE = False
    BundleLoader = None
    nirs4all = None


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
    """Information about a trained model bundle (.n4a)."""

    id: str
    name: str
    path: str
    model_type: str = "n4a_bundle"
    created_at: str
    file_size: int
    dataset_name: Optional[str] = None
    pipeline_uid: Optional[str] = None
    nirs4all_version: Optional[str] = None
    preprocessing_chain: Optional[str] = None


class BundleSummary(BaseModel):
    """Summary of a loaded .n4a bundle from BundleLoader.metadata."""

    pipeline_uid: str = ""
    nirs4all_version: str = ""
    created_at: str = ""
    preprocessing_chain: str = ""
    fold_strategy: str = "weighted_average"
    model_step_index: Optional[int] = None
    step_count: int = 0


class CompareModelsRequest(BaseModel):
    """Request for comparing multiple models (.n4a bundles)."""

    model_paths: List[str] = Field(..., min_length=2, description="Paths to .n4a bundles to compare")
    dataset_path: str = Field(..., description="Path to dataset for comparison")


class ModelComparisonResult(BaseModel):
    """Result of model comparison."""

    models: List[Dict[str, Any]]
    best_model_path: str
    comparison_metric: str
    dataset_path: str


# ============= Model Registry (KEEP - UI metadata) =============


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


# ============= Model Type Routes =============


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


# ============= Trained Model Bundle Routes =============


@router.get("/models/trained")
async def list_trained_models():
    """
    List all trained model bundles (.n4a) in the current workspace.

    Scans workspace/exports for .n4a bundles and returns their metadata.
    """
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Scan exports directory for .n4a bundles
    exports_dir = Path(workspace.path) / "workspace" / "exports"
    if not exports_dir.exists():
        return {"models": [], "total": 0}

    models = []
    for n4a_file in exports_dir.rglob("*.n4a"):
        try:
            stat = n4a_file.stat()

            # Extract dataset name from parent directory
            dataset_name = n4a_file.parent.name if n4a_file.parent != exports_dir else None

            # Try to load bundle metadata using BundleLoader
            pipeline_uid = None
            nirs4all_version = None
            preprocessing_chain = None

            if BundleLoader is not None:
                try:
                    loader = BundleLoader(str(n4a_file))
                    if loader.metadata:
                        pipeline_uid = loader.metadata.pipeline_uid
                        nirs4all_version = loader.metadata.nirs4all_version
                        preprocessing_chain = loader.metadata.preprocessing_chain
                except Exception:
                    pass

            models.append(
                TrainedModelInfo(
                    id=n4a_file.stem,
                    name=n4a_file.name,
                    path=str(n4a_file),
                    model_type="n4a_bundle",
                    created_at=datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    file_size=stat.st_size,
                    dataset_name=dataset_name,
                    pipeline_uid=pipeline_uid,
                    nirs4all_version=nirs4all_version,
                    preprocessing_chain=preprocessing_chain,
                )
            )

        except Exception as e:
            logger.error("Error reading bundle %s: %s", n4a_file, e)
            continue

    # Sort by creation date
    models.sort(key=lambda m: m.created_at, reverse=True)

    return {"models": models, "total": len(models)}


@router.get("/models/trained/{model_id:path}/summary", response_model=BundleSummary)
async def get_bundle_summary(model_id: str):
    """
    Get summary of a trained model bundle (.n4a) using BundleLoader.

    The model_id can be:
    - A bundle filename (will search in exports)
    - An absolute path to a .n4a file
    """
    if not NIRS4ALL_AVAILABLE or BundleLoader is None:
        raise HTTPException(status_code=503, detail="nirs4all not available")

    bundle_path = _resolve_bundle_path(model_id)

    try:
        loader = BundleLoader(str(bundle_path))
        metadata = loader.metadata

        return BundleSummary(
            pipeline_uid=metadata.pipeline_uid if metadata else "",
            nirs4all_version=metadata.nirs4all_version if metadata else "",
            created_at=metadata.created_at if metadata else "",
            preprocessing_chain=metadata.preprocessing_chain if metadata else "",
            fold_strategy=metadata.fold_strategy if metadata else "weighted_average",
            model_step_index=metadata.model_step_index if metadata else None,
            step_count=len(loader.get_step_info()),
        )

    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Bundle not found: {model_id}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading bundle: {str(e)}")


@router.delete("/models/trained/{model_id:path}")
async def delete_trained_model(model_id: str):
    """
    Delete a trained model bundle (.n4a) from disk.
    """
    bundle_path = _resolve_bundle_path(model_id)

    try:
        bundle_path.unlink()
        return {
            "success": True,
            "model_id": model_id,
            "message": "Bundle deleted successfully",
        }

    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Bundle not found: {model_id}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting bundle: {str(e)}")


@router.post("/models/compare", response_model=ModelComparisonResult)
async def compare_models(request: CompareModelsRequest):
    """
    Compare multiple trained model bundles (.n4a) on a dataset.

    Uses nirs4all.predict() to evaluate each bundle on the dataset.
    """
    if not NIRS4ALL_AVAILABLE or nirs4all is None:
        raise HTTPException(status_code=503, detail="nirs4all not available")

    # Load dataset
    from .spectra import _load_dataset

    dataset = _load_dataset(request.dataset_path)
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset not found: {request.dataset_path}")

    X = dataset.x(layout="2d")
    if isinstance(X, list):
        X = X[0]

    y = None
    try:
        y = dataset.y()
    except Exception:
        pass

    if y is None:
        raise HTTPException(status_code=400, detail="Dataset has no target values for comparison")

    # Evaluate each model using nirs4all.predict()
    results = []
    best_score = float("-inf")
    best_model_path = None

    for model_path in request.model_paths:
        bundle_path = Path(model_path)
        if not bundle_path.exists():
            results.append({
                "model_path": model_path,
                "error": "Bundle not found",
            })
            continue

        try:
            # Use nirs4all.predict() to get predictions
            pred_result = nirs4all.predict(model=str(bundle_path), data=X)
            y_pred = pred_result.y_pred

            # Compute metrics
            from nirs4all.core.metrics import eval_multi
            metrics = eval_multi(y, y_pred, "regression")

            results.append({
                "model_path": model_path,
                "model_name": bundle_path.stem,
                "metrics": metrics,
            })

            # Track best model
            r2 = metrics.get("r2", float("-inf"))
            if r2 > best_score:
                best_score = r2
                best_model_path = model_path

        except Exception as e:
            results.append({
                "model_path": model_path,
                "error": str(e),
            })

    if best_model_path is None:
        raise HTTPException(status_code=500, detail="No models could be evaluated")

    return ModelComparisonResult(
        models=results,
        best_model_path=best_model_path,
        comparison_metric="r2",
        dataset_path=request.dataset_path,
    )


@router.post("/models/{model_name}/instantiate")
async def instantiate_model(model_name: str, params: Dict[str, Any] = {}):
    """
    Create a new model instance with specified parameters.

    Returns a confirmation that the model was created successfully.
    This is useful for validating parameters before training.
    """
    try:
        from .nirs4all_adapter import _resolve_operator_class, _normalize_params

        model_class = _resolve_operator_class(model_name, "model")
        normalized_params = _normalize_params(model_name, params)
        model = model_class(**normalized_params)

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


# ============= Helper Functions (KEEP - UI introspection) =============


def _resolve_bundle_path(model_id: str) -> Path:
    """Resolve a model ID to a bundle path.

    Args:
        model_id: Bundle filename or absolute path

    Returns:
        Path to the bundle file

    Raises:
        HTTPException if workspace not selected or bundle not found
    """
    # Check if it's an absolute path
    if Path(model_id).is_absolute():
        bundle_path = Path(model_id)
        if bundle_path.exists():
            return bundle_path
        raise HTTPException(status_code=404, detail=f"Bundle not found: {model_id}")

    # Search in workspace exports
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    exports_dir = Path(workspace.path) / "workspace" / "exports"

    # Try direct match
    if not model_id.endswith(".n4a"):
        model_id = f"{model_id}.n4a"

    # Search recursively
    for n4a_file in exports_dir.rglob(model_id):
        return n4a_file

    # Also search by stem
    stem = model_id.replace(".n4a", "")
    for n4a_file in exports_dir.rglob("*.n4a"):
        if n4a_file.stem == stem:
            return n4a_file

    raise HTTPException(status_code=404, detail=f"Bundle not found: {model_id}")


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
