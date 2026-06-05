"""
Predictions API routes for nirs4all Studio.

This module provides FastAPI routes for running predictions on single
samples, batches, or whole dataset partitions.

Uses nirs4all library for all prediction operations.
"""

import asyncio
from pathlib import Path
from typing import Dict, List, Any

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .shared.dependencies import require_workspace
from .shared.paths import resolve_within

# Optional imports
try:
    import nirs4all
    NIRS4ALL_AVAILABLE = True
except ImportError:
    nirs4all = None
    NIRS4ALL_AVAILABLE = False


# ============= Request/Response Models =============


class PredictSingleRequest(BaseModel):
    """Request for single sample prediction."""

    model_id: str = Field(..., description="ID of the trained model to use")
    spectrum: List[float] = Field(..., description="Spectrum data as 1D array")
    preprocessing_chain: List[Dict[str, Any]] = Field(
        default=[],
        description="Preprocessing steps to apply before prediction",
    )


class PredictBatchRequest(BaseModel):
    """Request for batch prediction."""

    model_id: str = Field(..., description="ID of the trained model to use")
    spectra: List[List[float]] = Field(..., description="Spectra data as 2D array")
    preprocessing_chain: List[Dict[str, Any]] = Field(
        default=[],
        description="Preprocessing steps to apply before prediction",
    )


class PredictDatasetRequest(BaseModel):
    """Request for predicting on a dataset."""

    model_id: str = Field(..., description="ID of the trained model to use")
    dataset_id: str = Field(..., description="ID of the dataset to predict on")
    partition: str = Field("test", description="Dataset partition to use")
    preprocessing_chain: List[Dict[str, Any]] = Field(
        default=[],
        description="Preprocessing steps to apply before prediction",
    )


class PredictionResult(BaseModel):
    """Result of a single prediction."""

    prediction: float | List[float]
    model_id: str
    preprocessing_applied: List[str] = []


class BatchPredictionResult(BaseModel):
    """Result of batch prediction."""

    predictions: List[float | List[float]]
    model_id: str
    num_samples: int
    preprocessing_applied: List[str] = []


router = APIRouter()


def _resolve_model_path(model_id: str, workspace_path: str) -> str:
    """Resolve the path to a model file.

    Args:
        model_id: Model identifier (can be full path, filename, or ID)
        workspace_path: Path to the workspace

    Returns:
        Absolute path to the model file

    Raises:
        HTTPException: If the model id escapes the workspace or is not found
    """
    # Check in workspace models directory. The model id is untrusted, so it
    # must resolve strictly under the workspace 'models/' subdirectory: reject
    # absolute paths and '..' traversal before touching the filesystem.
    workspace_models_dir = Path(workspace_path) / "models"

    try:
        # Try with .n4a extension
        if not model_id.endswith(".n4a"):
            potential_path = resolve_within(workspace_models_dir, f"{model_id}.n4a")
            if potential_path.exists():
                return str(potential_path)

        # Try exact filename
        potential_path = resolve_within(workspace_models_dir, model_id)
        if potential_path.exists():
            return str(potential_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

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
async def predict_single(request: PredictSingleRequest, workspace=Depends(require_workspace)):
    """
    Make a prediction on a single spectrum.

    Uses nirs4all.predict() to load the model and run prediction.
    Note: preprocessing_chain in request is ignored - the model bundle
    contains all preprocessing steps that will be applied automatically.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available. Install it in Settings > Dependencies.",
        )

    # Resolve model path (supports .n4a bundles)
    model_path = _resolve_model_path(request.model_id, workspace.path)

    # Prepare input
    X = np.array(request.spectrum).reshape(1, -1)

    try:
        # Use nirs4all.predict() directly (offloaded off the event loop)
        pred_result = await asyncio.to_thread(
            nirs4all.predict, model=model_path, data=X, verbose=0
        )
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
async def predict_batch(request: PredictBatchRequest, workspace=Depends(require_workspace)):
    """
    Make predictions on a batch of spectra.

    Uses nirs4all.predict() which handles batches natively.
    Note: preprocessing_chain in request is ignored - the model bundle
    contains all preprocessing steps that will be applied automatically.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available. Install it in Settings > Dependencies.",
        )

    # Resolve model path (supports .n4a bundles)
    model_path = _resolve_model_path(request.model_id, workspace.path)

    # Prepare input
    X = np.array(request.spectra)

    try:
        # Use nirs4all.predict() directly (offloaded off the event loop)
        pred_result = await asyncio.to_thread(
            nirs4all.predict, model=model_path, data=X, verbose=0
        )
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
async def predict_dataset(request: PredictDatasetRequest, workspace=Depends(require_workspace)):
    """
    Make predictions on an entire dataset partition.

    Uses nirs4all.predict() to load the model and run prediction.
    Returns predictions along with actual values if available.
    Note: preprocessing_chain in request is ignored - the model bundle
    contains all preprocessing steps that will be applied automatically.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available. Install it in Settings > Dependencies.",
        )

    # Resolve model path (supports .n4a bundles)
    model_path = _resolve_model_path(request.model_id, workspace.path)

    # Load dataset (offloaded off the event loop)
    from .spectra import _load_dataset

    dataset = await asyncio.to_thread(_load_dataset, request.dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset '{request.dataset_id}' not found",
        )

    # Extract X/y off the event loop — slicing a whole partition can be large.
    selector = {"partition": request.partition}

    def _extract_xy():
        x_arr = dataset.x(selector, layout="2d")
        if isinstance(x_arr, list):
            x_arr = x_arr[0]
        try:
            y_arr = dataset.y(selector)
        except Exception:
            y_arr = None
        return x_arr, y_arr

    X, y_true = await asyncio.to_thread(_extract_xy)

    try:
        # Use nirs4all.predict() directly (offloaded off the event loop)
        pred_result = await asyncio.to_thread(
            nirs4all.predict, model=model_path, data=X, verbose=0
        )
        predictions = pred_result.predictions if hasattr(pred_result, 'predictions') else []
        results = predictions.tolist() if hasattr(predictions, 'tolist') else list(predictions)

        # Get preprocessing steps from the bundle if available
        preprocessing_applied = []
        if hasattr(pred_result, 'preprocessing_steps'):
            preprocessing_applied = pred_result.preprocessing_steps

        # Compute metrics if actual values available
        metrics = None
        if y_true is not None and len(results) > 0:
            from sklearn.metrics import mean_squared_error, r2_score, mean_absolute_error
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
