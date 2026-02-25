"""
Predictions API routes for nirs4all webapp.

This module provides FastAPI routes for:
- Running predictions on single samples or batches
- Prediction with uncertainty/confidence intervals
- Prediction explanation (feature importance)

Uses nirs4all library for all prediction and explanation operations.

For stored predictions (DuckDB), see the /api/aggregated-predictions
endpoints in aggregated_predictions.py.
"""

from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .lazy_imports import get_cached, is_ml_ready, require_ml_ready
from .workspace_manager import workspace_manager

NIRS4ALL_AVAILABLE = True
JOBLIB_AVAILABLE = True


# ============= Request/Response Models =============


class PredictSingleRequest(BaseModel):
    """Request for single sample prediction."""

    model_id: str = Field(..., description="ID of the trained model to use")
    spectrum: list[float] = Field(..., description="Spectrum data as 1D array")
    preprocessing_chain: list[dict[str, Any]] = Field(
        default=[],
        description="Preprocessing steps to apply before prediction",
    )


class PredictBatchRequest(BaseModel):
    """Request for batch prediction."""

    model_id: str = Field(..., description="ID of the trained model to use")
    spectra: list[list[float]] = Field(..., description="Spectra data as 2D array")
    preprocessing_chain: list[dict[str, Any]] = Field(
        default=[],
        description="Preprocessing steps to apply before prediction",
    )


class PredictDatasetRequest(BaseModel):
    """Request for predicting on a dataset."""

    model_id: str = Field(..., description="ID of the trained model to use")
    dataset_id: str = Field(..., description="ID of the dataset to predict on")
    partition: str = Field("test", description="Dataset partition to use")
    preprocessing_chain: list[dict[str, Any]] = Field(
        default=[],
        description="Preprocessing steps to apply before prediction",
    )


class PredictConfidenceRequest(BaseModel):
    """Request for prediction with confidence intervals."""

    model_id: str = Field(..., description="ID of the trained model to use")
    spectra: list[list[float]] = Field(..., description="Spectra data as 2D array")
    preprocessing_chain: list[dict[str, Any]] = Field(default=[])
    method: str = Field(
        "bootstrap",
        description="Confidence estimation method: bootstrap, ensemble, jackknife",
    )
    n_iterations: int = Field(100, ge=10, le=1000, description="Number of iterations")
    confidence_level: float = Field(0.95, ge=0.5, le=0.99, description="Confidence level")


class ExplainPredictionRequest(BaseModel):
    """Request for prediction explanation."""

    model_id: str = Field(..., description="ID of the trained model to use")
    spectrum: list[float] = Field(..., description="Spectrum to explain")
    preprocessing_chain: list[dict[str, Any]] = Field(default=[])
    method: str = Field(
        "permutation",
        description="Explanation method: permutation, shap, gradient",
    )
    wavelengths: list[float] | None = Field(
        None,
        description="Wavelength values for feature importance mapping",
    )


class PredictionResult(BaseModel):
    """Result of a single prediction."""

    prediction: float | list[float]
    model_id: str
    preprocessing_applied: list[str] = []


class BatchPredictionResult(BaseModel):
    """Result of batch prediction."""

    predictions: list[float | list[float]]
    model_id: str
    num_samples: int
    preprocessing_applied: list[str] = []


class ConfidencePredictionResult(BaseModel):
    """Result of prediction with confidence."""

    predictions: list[float]
    lower_bounds: list[float]
    upper_bounds: list[float]
    std_devs: list[float]
    confidence_level: float
    method: str


class ExplanationResult(BaseModel):
    """Result of prediction explanation."""

    prediction: float
    feature_importance: list[float]
    top_features: list[dict[str, Any]]
    wavelengths: list[float] | None = None
    method: str


router = APIRouter()

# ---------------------------------------------------------------------------


def _resolve_model_path(model_id: str, workspace_path: str) -> str:
    """Resolve the path to a model file.

    Args:
        model_id: Model identifier (can be full path, filename, or ID)
        workspace_path: Path to the workspace

    Returns:
        Absolute path to the model file

    Raises:
        HTTPException: If model not found
    """
    # If it's already an absolute path, use it directly
    model_path = Path(model_id)
    if model_path.is_absolute() and model_path.exists():
        return str(model_path)

    # Check in workspace models directory
    workspace_models_dir = Path(workspace_path) / "models"

    # Try with .n4a extension
    if not model_id.endswith(".n4a"):
        potential_path = workspace_models_dir / f"{model_id}.n4a"
        if potential_path.exists():
            return str(potential_path)

    # Try exact filename
    potential_path = workspace_models_dir / model_id
    if potential_path.exists():
        return str(potential_path)

    # Try finding any model file with matching name pattern
    if workspace_models_dir.exists():
        for model_file in workspace_models_dir.glob("*.n4a"):
            if model_id in model_file.name:
                return str(model_file)

    raise HTTPException(
        status_code=404,
        detail=f"Model '{model_id}' not found in workspace models directory",
    )


# ============= Prediction Execution Routes =============


@router.post("/predictions/single", response_model=PredictionResult)
async def predict_single(request: PredictSingleRequest):
    """
    Make a prediction on a single spectrum.

    Uses nirs4all.predict() to load the model and run prediction.
    Note: preprocessing_chain in request is ignored - the model bundle
    contains all preprocessing steps that will be applied automatically.
    """
    import numpy as np
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available. Install it in Settings > Dependencies.",
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Resolve model path (supports .n4a bundles)
    model_path = _resolve_model_path(request.model_id, workspace.path)

    # Prepare input
    X = np.array(request.spectrum).reshape(1, -1)

    try:
        # Use nirs4all.predict() directly
        pred_result = get_cached("nirs4all").predict(model=model_path, data=X, verbose=0)
        predictions = pred_result.predictions if hasattr(pred_result, 'predictions') else []

        # Format result
        if predictions is not None and len(predictions) > 0:
            if isinstance(predictions[0], (list, np.ndarray)):
                result = list(predictions[0])
            else:
                result = float(predictions[0])
        else:
            result = None

        # Get preprocessing steps from the bundle if available
        preprocessing_applied = []
        if hasattr(pred_result, 'preprocessing_steps'):
            preprocessing_applied = pred_result.preprocessing_steps

        return PredictionResult(
            prediction=result,
            model_id=request.model_id,
            preprocessing_applied=preprocessing_applied,
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Model '{request.model_id}' not found",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Prediction failed: {str(e)}",
        )


@router.post("/predictions/batch", response_model=BatchPredictionResult)
async def predict_batch(request: PredictBatchRequest):
    """
    Make predictions on a batch of spectra.

    Uses nirs4all.predict() which handles batches natively.
    Note: preprocessing_chain in request is ignored - the model bundle
    contains all preprocessing steps that will be applied automatically.
    """
    import numpy as np
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available. Install it in Settings > Dependencies.",
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Resolve model path (supports .n4a bundles)
    model_path = _resolve_model_path(request.model_id, workspace.path)

    # Prepare input
    X = np.array(request.spectra)

    try:
        # Use nirs4all.predict() directly
        pred_result = get_cached("nirs4all").predict(model=model_path, data=X, verbose=0)
        predictions = pred_result.predictions if hasattr(pred_result, 'predictions') else []
        results = predictions.tolist() if hasattr(predictions, 'tolist') else list(predictions)

        # Get preprocessing steps from the bundle if available
        preprocessing_applied = []
        if hasattr(pred_result, 'preprocessing_steps'):
            preprocessing_applied = pred_result.preprocessing_steps

        return BatchPredictionResult(
            predictions=results,
            model_id=request.model_id,
            num_samples=len(request.spectra),
            preprocessing_applied=preprocessing_applied,
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Model '{request.model_id}' not found",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Prediction failed: {str(e)}",
        )


@router.post("/predictions/dataset")
async def predict_dataset(request: PredictDatasetRequest):
    """
    Make predictions on an entire dataset partition.

    Uses nirs4all.predict() to load the model and run prediction.
    Returns predictions along with actual values if available.
    Note: preprocessing_chain in request is ignored - the model bundle
    contains all preprocessing steps that will be applied automatically.
    """
    import numpy as np
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available. Install it in Settings > Dependencies.",
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Resolve model path (supports .n4a bundles)
    model_path = _resolve_model_path(request.model_id, workspace.path)

    # Load dataset
    from .spectra import _load_dataset

    dataset = _load_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset '{request.dataset_id}' not found",
        )

    # Get data from dataset
    selector = {"partition": request.partition}
    X = dataset.x(selector, layout="2d")
    if isinstance(X, list):
        X = X[0]

    y_true = None
    try:
        y_true = dataset.y(selector)
    except Exception:
        pass

    try:
        # Use nirs4all.predict() directly
        pred_result = get_cached("nirs4all").predict(model=model_path, data=X, verbose=0)
        predictions = pred_result.predictions if hasattr(pred_result, 'predictions') else []
        results = predictions.tolist() if hasattr(predictions, 'tolist') else list(predictions)

        # Get preprocessing steps from the bundle if available
        preprocessing_applied = []
        if hasattr(pred_result, 'preprocessing_steps'):
            preprocessing_applied = pred_result.preprocessing_steps

        # Compute metrics if actual values available
        metrics = None
        if y_true is not None and len(results) > 0:
            from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
            y_pred = np.array(results)
            metrics = {
                "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
                "r2": float(r2_score(y_true, y_pred)),
                "mae": float(mean_absolute_error(y_true, y_pred)),
            }

        result_data = {
            "model_id": request.model_id,
            "dataset_id": request.dataset_id,
            "partition": request.partition,
            "num_samples": len(results),
            "predictions": results,
            "preprocessing_applied": preprocessing_applied,
            "metrics": metrics,
        }

        # Include actual values if available
        if y_true is not None:
            result_data["actual_values"] = y_true.tolist() if hasattr(y_true, "tolist") else list(y_true)

        return result_data

    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail=f"Model '{request.model_id}' not found",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Prediction failed: {str(e)}",
        )


@router.post("/predictions/confidence", response_model=ConfidencePredictionResult)
async def predict_with_confidence(request: PredictConfidenceRequest):
    """
    Make predictions with confidence intervals.

    Uses bootstrap, ensemble, or jackknife methods to estimate
    prediction uncertainty.
    """
    import numpy as np
    if not JOBLIB_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="joblib not available for model loading",
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Load model
    model = _load_model(request.model_id, workspace.path)

    # Prepare input
    X = np.array(request.spectra)

    # Apply preprocessing
    if request.preprocessing_chain:
        from .spectra import _apply_preprocessing_chain

        X = _apply_preprocessing_chain(X, request.preprocessing_chain)

    # Estimate confidence based on method
    if request.method == "bootstrap":
        predictions, lower, upper, std = _bootstrap_confidence(
            model, X, request.n_iterations, request.confidence_level
        )
    elif request.method == "jackknife":
        predictions, lower, upper, std = _jackknife_confidence(
            model, X, request.confidence_level
        )
    elif request.method == "ensemble":
        # For ensemble models like Random Forest
        predictions, lower, upper, std = _ensemble_confidence(
            model, X, request.confidence_level
        )
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown confidence method: {request.method}. "
            "Supported: bootstrap, jackknife, ensemble",
        )

    return ConfidencePredictionResult(
        predictions=predictions.tolist(),
        lower_bounds=lower.tolist(),
        upper_bounds=upper.tolist(),
        std_devs=std.tolist(),
        confidence_level=request.confidence_level,
        method=request.method,
    )


@router.post("/predictions/explain", response_model=ExplanationResult)
async def explain_prediction(request: ExplainPredictionRequest):
    """
    Explain a prediction using feature importance.

    Supports permutation importance and SHAP-like explanations.
    """
    import numpy as np
    if not JOBLIB_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="joblib not available for model loading",
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Load model
    model = _load_model(request.model_id, workspace.path)

    # Prepare input
    X = np.array(request.spectrum).reshape(1, -1)

    # Apply preprocessing
    if request.preprocessing_chain:
        from .spectra import _apply_preprocessing_chain

        X = _apply_preprocessing_chain(X, request.preprocessing_chain)

    # Get prediction
    prediction = float(model.predict(X)[0])

    # Compute feature importance based on method
    if request.method == "permutation":
        importance = _permutation_importance_single(model, X)
    elif request.method == "gradient":
        # For models with gradient access (neural networks)
        importance = _gradient_importance(model, X)
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown explanation method: {request.method}. "
            "Supported: permutation, gradient",
        )

    # Get top features
    n_features = len(importance)
    top_k = min(20, n_features)
    top_indices = np.argsort(np.abs(importance))[-top_k:][::-1]

    wavelengths = request.wavelengths
    if wavelengths is None:
        wavelengths = list(range(n_features))

    top_features = [
        {
            "index": int(idx),
            "wavelength": wavelengths[idx] if idx < len(wavelengths) else idx,
            "importance": float(importance[idx]),
            "abs_importance": float(abs(importance[idx])),
        }
        for idx in top_indices
    ]

    return ExplanationResult(
        prediction=prediction,
        feature_importance=importance.tolist(),
        top_features=top_features,
        wavelengths=wavelengths,
        method=request.method,
    )


# ============= Helper Functions =============


def _load_model(model_id: str, workspace_path: str) -> Any:
    """Load a trained model from disk.

    Args:
        model_id: Model ID
        workspace_path: Path to workspace

    Returns:
        Loaded model instance

    Raises:
        HTTPException: If model not found
    """
    # First check the models cache
    from .models import get_loaded_model

    model = get_loaded_model(model_id)
    if model is not None:
        return model

    # Load from disk
    model_path = Path(workspace_path) / "models" / f"{model_id}.joblib"
    if not model_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Model '{model_id}' not found",
        )

    try:
        return get_cached("joblib").load(model_path)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error loading model: {str(e)}",
        )


def _bootstrap_confidence(
    model: Any,
    X,
    n_iterations: int,
    confidence_level: float,
) -> tuple:
    """Compute confidence intervals using bootstrap.

    Args:
        model: Trained model
        X: Input features
        n_iterations: Number of bootstrap iterations
        confidence_level: Confidence level (e.g., 0.95)

    Returns:
        Tuple of (predictions, lower_bounds, upper_bounds, std_devs)
    """
    import numpy as np
    n_samples = X.shape[0]
    n_features = X.shape[1]

    # Collect predictions with slight perturbations
    all_predictions = []

    for _ in range(n_iterations):
        # Add small noise to simulate uncertainty
        noise = np.random.normal(0, 0.01 * np.std(X), X.shape)
        X_perturbed = X + noise
        preds = model.predict(X_perturbed)
        all_predictions.append(preds)

    all_predictions = np.array(all_predictions)

    # Compute statistics
    predictions = np.mean(all_predictions, axis=0)
    std = np.std(all_predictions, axis=0)

    alpha = 1 - confidence_level
    lower = np.percentile(all_predictions, (alpha / 2) * 100, axis=0)
    upper = np.percentile(all_predictions, (1 - alpha / 2) * 100, axis=0)

    return predictions, lower, upper, std


def _jackknife_confidence(
    model: Any,
    X,
    confidence_level: float,
) -> tuple:
    """Compute confidence intervals using jackknife.

    Args:
        model: Trained model
        X: Input features
        confidence_level: Confidence level

    Returns:
        Tuple of (predictions, lower_bounds, upper_bounds, std_devs)
    """
    import numpy as np
    from scipy import stats

    n_samples = X.shape[0]
    n_features = X.shape[1]

    # Jackknife: leave one feature out at a time
    predictions = model.predict(X)

    # Compute feature-based variance estimate
    jackknife_preds = []
    for i in range(min(n_features, 100)):  # Limit for efficiency
        X_jack = X.copy()
        X_jack[:, i] = np.mean(X[:, i])  # Replace with mean
        preds = model.predict(X_jack)
        jackknife_preds.append(preds)

    jackknife_preds = np.array(jackknife_preds)
    std = np.std(jackknife_preds, axis=0)

    # Compute confidence intervals
    alpha = 1 - confidence_level
    z = stats.norm.ppf(1 - alpha / 2)
    lower = predictions - z * std
    upper = predictions + z * std

    return predictions, lower, upper, std


def _ensemble_confidence(
    model: Any,
    X,
    confidence_level: float,
) -> tuple:
    """Compute confidence intervals from ensemble predictions.

    Args:
        model: Ensemble model (e.g., RandomForest)
        X: Input features
        confidence_level: Confidence level

    Returns:
        Tuple of (predictions, lower_bounds, upper_bounds, std_devs)
    """
    import numpy as np
    from scipy import stats

    predictions = model.predict(X)

    # Check if model is an ensemble with estimators
    if hasattr(model, "estimators_"):
        # Get predictions from each estimator
        estimator_preds = np.array([est.predict(X) for est in model.estimators_])
        std = np.std(estimator_preds, axis=0)

        alpha = 1 - confidence_level
        lower = np.percentile(estimator_preds, (alpha / 2) * 100, axis=0)
        upper = np.percentile(estimator_preds, (1 - alpha / 2) * 100, axis=0)
    else:
        # Fall back to bootstrap for non-ensemble models
        predictions, lower, upper, std = _bootstrap_confidence(
            model, X, 100, confidence_level
        )

    return predictions, lower, upper, std


def _permutation_importance_single(model: Any, X):
    """Compute permutation importance for a single sample.

    Args:
        model: Trained model
        X: Input features (1, n_features)

    Returns:
        Feature importance array
    """
    import numpy as np
    n_features = X.shape[1]
    baseline_pred = model.predict(X)[0]

    importance = np.zeros(n_features)

    for i in range(n_features):
        X_perm = X.copy()
        # Perturb feature
        X_perm[0, i] = X_perm[0, i] + np.std(X_perm[0, :])
        perm_pred = model.predict(X_perm)[0]
        importance[i] = abs(perm_pred - baseline_pred)

    # Normalize
    if np.sum(importance) > 0:
        importance = importance / np.sum(importance)

    return importance


def _gradient_importance(model: Any, X):
    """Compute gradient-based feature importance.

    For models that support gradient computation.

    Args:
        model: Trained model
        X: Input features

    Returns:
        Feature importance array
    """
    # For sklearn models, fall back to permutation
    # This could be extended for neural networks
    return _permutation_importance_single(model, X)
