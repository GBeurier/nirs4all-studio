"""
Predictions API routes for nirs4all webapp.

This module provides FastAPI routes for running predictions on batches of
spectra or on a dataset partition.

Uses nirs4all library for all prediction operations.

For stored predictions (SQLite store), see the /api/aggregated-predictions
endpoints in aggregated_predictions.py.
"""

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .lazy_imports import get_cached
from .prediction_runtime import (
    predict_with_runtime_record,
    prediction_values_to_list,
    rt_error_http_status,
)
from .runtime_errors import RtUnsupportedError
from .workspace_manager import workspace_manager

NIRS4ALL_AVAILABLE = True


# ============= Request/Response Models =============


class PredictBatchRequest(BaseModel):
    """Request for batch prediction."""

    model_id: str = Field(..., description="ID of the trained model to use")
    spectra: list[list[float]] = Field(..., description="Spectra data as 2D array")
    preprocessing_chain: list[dict[str, Any]] = Field(
        default=[],
        description="Preprocessing steps to apply before prediction",
    )
    engine: str | None = Field(None, description="Prediction engine selector. Omit or use 'legacy' for the Python oracle; 'dag-ml' requires allow_fallback.")
    allow_fallback: bool = Field(False, description="Explicitly allow unsupported dag-ml prediction requests to run via the Python oracle.")


class PredictDatasetRequest(BaseModel):
    """Request for predicting on a dataset."""

    model_id: str = Field(..., description="ID of the trained model to use")
    dataset_id: str = Field(..., description="ID of the dataset to predict on")
    partition: str = Field("test", description="Dataset partition to use")
    preprocessing_chain: list[dict[str, Any]] = Field(
        default=[],
        description="Preprocessing steps to apply before prediction",
    )
    engine: str | None = Field(None, description="Prediction engine selector. Omit or use 'legacy' for the Python oracle; 'dag-ml' requires allow_fallback.")
    allow_fallback: bool = Field(False, description="Explicitly allow unsupported dag-ml prediction requests to run via the Python oracle.")


class BatchPredictionResult(BaseModel):
    """Result of batch prediction."""

    predictions: list[float | list[float]]
    model_id: str
    num_samples: int
    preprocessing_applied: list[str] = []
    runtime: dict[str, Any] | None = None


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
        outcome = predict_with_runtime_record(
            lambda **kwargs: get_cached("nirs4all").predict(**kwargs),
            predict_kwargs={"model": model_path, "data": X, "verbose": 0},
            engine=request.engine,
            allow_fallback=request.allow_fallback,
        )
        pred_result = outcome.result
        results = prediction_values_to_list(pred_result)

        # Get preprocessing steps from the bundle if available
        preprocessing_applied = []
        if hasattr(pred_result, 'preprocessing_steps'):
            preprocessing_applied = pred_result.preprocessing_steps

        return BatchPredictionResult(
            predictions=results,
            model_id=request.model_id,
            num_samples=len(request.spectra),
            preprocessing_applied=preprocessing_applied,
            runtime=outcome.runtime_record,
        )
    except RtUnsupportedError as e:
        raise HTTPException(
            status_code=rt_error_http_status(e.rt_error),
            detail=e.rt_error.to_envelope(),
        ) from e
    except HTTPException:
        raise
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
        outcome = predict_with_runtime_record(
            lambda **kwargs: get_cached("nirs4all").predict(**kwargs),
            predict_kwargs={"model": model_path, "data": X, "verbose": 0},
            engine=request.engine,
            allow_fallback=request.allow_fallback,
        )
        pred_result = outcome.result
        results = prediction_values_to_list(pred_result)

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
            "runtime": outcome.runtime_record,
        }

        # Include actual values if available
        if y_true is not None:
            result_data["actual_values"] = y_true.tolist() if hasattr(y_true, "tolist") else list(y_true)

        return result_data

    except RtUnsupportedError as e:
        raise HTTPException(
            status_code=rt_error_http_status(e.rt_error),
            detail=e.rt_error.to_envelope(),
        ) from e
    except HTTPException:
        raise
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
