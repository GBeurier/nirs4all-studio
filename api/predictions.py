"""
Predictions API routes for nirs4all Studio.

This module provides FastAPI routes for:
- Managing prediction records (CRUD) [DEPRECATED - use /api/aggregated-predictions]
- Running predictions on single samples or batches

Uses nirs4all library for all prediction operations.

DEPRECATION NOTICE:
    The CRUD endpoints (list, get, create, delete, stats, export) that store
    prediction records as JSON files are deprecated. Use the SQLite-backed
    /api/aggregated-predictions endpoints instead, which provide chain-level
    aggregation with drill-down to individual folds and partitions.

    The inference endpoints (single, batch, dataset) remain current and are
    NOT deprecated.
"""

import asyncio
import json
import warnings
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager
from .shared.paths import resolve_within

# Optional imports
try:
    import nirs4all
    NIRS4ALL_AVAILABLE = True
except ImportError:
    nirs4all = None
    NIRS4ALL_AVAILABLE = False


# ============= Request/Response Models =============


class PredictionCreate(BaseModel):
    """Request model for creating a prediction record."""

    pipeline_id: str
    dataset_id: str
    samples: List[Dict[str, Any]]
    results: Dict[str, Any]
    metadata: Optional[Dict[str, Any]] = None


class PredictionFilter(BaseModel):
    """Filter model for listing predictions."""

    pipeline_id: Optional[str] = None
    dataset_id: Optional[str] = None
    from_date: Optional[str] = None
    to_date: Optional[str] = None


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
    save_results: bool = Field(False, description="Whether to save prediction record")


class PredictDatasetRequest(BaseModel):
    """Request for predicting on a dataset."""

    model_id: str = Field(..., description="ID of the trained model to use")
    dataset_id: str = Field(..., description="ID of the dataset to predict on")
    partition: str = Field("test", description="Dataset partition to use")
    preprocessing_chain: List[Dict[str, Any]] = Field(
        default=[],
        description="Preprocessing steps to apply before prediction",
    )
    save_results: bool = Field(True, description="Whether to save prediction record")


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

# ---------------------------------------------------------------------------
# Deprecation helpers
# ---------------------------------------------------------------------------

_DEPRECATION_MSG = (
    "This endpoint is deprecated. Use /api/aggregated-predictions endpoints "
    "backed by the workspace store instead."
)


def _deprecated_response(data: dict) -> JSONResponse:
    """Wrap a response with deprecation headers."""
    warnings.warn(_DEPRECATION_MSG, DeprecationWarning, stacklevel=2)
    return JSONResponse(
        content=data,
        headers={
            "Deprecation": "true",
            "Sunset": "2026-06-01",
            "Link": '</api/aggregated-predictions>; rel="successor-version"',
            "X-Deprecation-Notice": _DEPRECATION_MSG,
        },
    )


# ---------------------------------------------------------------------------

def _get_predictions_dir() -> Path:
    """Get the predictions directory for the current workspace."""
    predictions_path = workspace_manager.get_predictions_path()
    if not predictions_path:
        raise HTTPException(status_code=409, detail="No workspace selected")
    path = Path(predictions_path)
    path.mkdir(parents=True, exist_ok=True)
    return path


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


def _load_prediction(prediction_id: str) -> Dict[str, Any]:
    """Load a prediction from file."""
    predictions_dir = _get_predictions_dir()
    try:
        prediction_file = resolve_within(predictions_dir, f"{prediction_id}.json")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not prediction_file.exists():
        raise HTTPException(status_code=404, detail="Prediction not found")

    try:
        with open(prediction_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to load prediction: {str(e)}"
        )


def _save_prediction(prediction: Dict[str, Any]) -> None:
    """Save a prediction to file."""
    predictions_dir = _get_predictions_dir()
    prediction_file = predictions_dir / f"{prediction['id']}.json"

    try:
        with open(prediction_file, "w", encoding="utf-8") as f:
            json.dump(prediction, f, indent=2)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to save prediction: {str(e)}"
        )


@router.get("/predictions", deprecated=True)
async def list_predictions(
    pipeline_id: Optional[str] = None,
    dataset_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    """List predictions with optional filtering.

    .. deprecated::
        Use ``GET /api/aggregated-predictions`` instead.
    """
    try:
        predictions_dir = _get_predictions_dir()
        predictions = []

        for prediction_file in predictions_dir.glob("*.json"):
            try:
                with open(prediction_file, "r", encoding="utf-8") as f:
                    prediction = json.load(f)

                    # Apply filters
                    if pipeline_id and prediction.get("pipeline_id") != pipeline_id:
                        continue
                    if dataset_id and prediction.get("dataset_id") != dataset_id:
                        continue

                    predictions.append(prediction)
            except Exception:
                continue

        # Sort by created_at descending
        predictions.sort(key=lambda p: p.get("created_at", ""), reverse=True)

        # Apply pagination
        total = len(predictions)
        predictions = predictions[offset:offset + limit]

        return _deprecated_response({
            "predictions": predictions,
            "total": total,
            "limit": limit,
            "offset": offset,
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to list predictions: {str(e)}"
        )


@router.get("/predictions/{prediction_id}", deprecated=True)
async def get_prediction(prediction_id: str):
    """Get a specific prediction by ID.

    .. deprecated::
        Use ``GET /api/aggregated-predictions/chain/{chain_id}`` instead.
    """
    prediction = _load_prediction(prediction_id)
    return _deprecated_response({"prediction": prediction})


@router.post("/predictions", deprecated=True)
async def create_prediction(prediction_data: PredictionCreate):
    """Create a new prediction record.

    .. deprecated::
        Predictions are now created automatically during pipeline execution
        and stored in the workspace store. Use ``GET /api/aggregated-predictions``
        to query them.
    """
    try:
        now = datetime.now().isoformat()
        prediction_id = f"pred_{int(datetime.now().timestamp())}"

        prediction = {
            "id": prediction_id,
            "pipeline_id": prediction_data.pipeline_id,
            "dataset_id": prediction_data.dataset_id,
            "samples_count": len(prediction_data.samples),
            "samples": prediction_data.samples,
            "results": prediction_data.results,
            "metadata": prediction_data.metadata or {},
            "created_at": now,
        }

        _save_prediction(prediction)

        return _deprecated_response({"success": True, "prediction": prediction})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to create prediction: {str(e)}"
        )


@router.delete("/predictions/{prediction_id}", deprecated=True)
async def delete_prediction(prediction_id: str):
    """Delete a prediction record.

    .. deprecated::
        Use ``DELETE /api/runs/{run_id}`` to delete runs and their
        associated predictions from the workspace store.
    """
    try:
        predictions_dir = _get_predictions_dir()
        try:
            prediction_file = resolve_within(predictions_dir, f"{prediction_id}.json")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        if not prediction_file.exists():
            raise HTTPException(status_code=404, detail="Prediction not found")

        prediction_file.unlink()

        return _deprecated_response({"success": True, "message": "Prediction deleted"})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete prediction: {str(e)}"
        )


@router.get("/predictions/stats", deprecated=True)
async def get_predictions_stats():
    """Get aggregate statistics for predictions.

    .. deprecated::
        Use ``GET /api/aggregated-predictions/top`` for ranked results
        or ``GET /api/aggregated-predictions`` for filtered queries.
    """
    try:
        predictions_dir = _get_predictions_dir()
        stats = {
            "total": 0,
            "by_pipeline": {},
            "by_dataset": {},
            "recent": [],
        }

        predictions = []
        for prediction_file in predictions_dir.glob("*.json"):
            try:
                with open(prediction_file, "r", encoding="utf-8") as f:
                    prediction = json.load(f)
                    predictions.append(prediction)

                    stats["total"] += 1

                    # Count by pipeline
                    pid = prediction.get("pipeline_id", "unknown")
                    stats["by_pipeline"][pid] = stats["by_pipeline"].get(pid, 0) + 1

                    # Count by dataset
                    did = prediction.get("dataset_id", "unknown")
                    stats["by_dataset"][did] = stats["by_dataset"].get(did, 0) + 1
            except Exception:
                continue

        # Get recent predictions
        predictions.sort(key=lambda p: p.get("created_at", ""), reverse=True)
        stats["recent"] = [
            {
                "id": p["id"],
                "pipeline_id": p.get("pipeline_id"),
                "dataset_id": p.get("dataset_id"),
                "created_at": p.get("created_at"),
                "samples_count": p.get("samples_count", 0),
            }
            for p in predictions[:10]
        ]

        return _deprecated_response({"stats": stats})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get prediction stats: {str(e)}"
        )


@router.post("/predictions/export", deprecated=True)
async def export_predictions(prediction_ids: List[str], format: str = "csv"):
    """Export predictions to a file format.

    .. deprecated::
        Use ``GET /api/aggregated-predictions`` to query results from
        the workspace store.
    """
    try:
        predictions = []
        for pred_id in prediction_ids:
            try:
                prediction = _load_prediction(pred_id)
                predictions.append(prediction)
            except HTTPException:
                continue

        if not predictions:
            raise HTTPException(status_code=404, detail="No predictions found")

        # TODO: Implement actual export to CSV/JSON/Excel
        return _deprecated_response({
            "success": True,
            "message": f"Export to {format} not implemented yet",
            "count": len(predictions),
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to export predictions: {str(e)}"
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
async def predict_batch(request: PredictBatchRequest):
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

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

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

        # Optionally save results
        if request.save_results:
            now = datetime.now().isoformat()
            prediction_id = f"pred_{int(datetime.now().timestamp())}"

            record = {
                "id": prediction_id,
                "model_id": request.model_id,
                "samples_count": len(request.spectra),
                "predictions": results,
                "preprocessing_applied": preprocessing_applied,
                "created_at": now,
            }

            _save_prediction(record)

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

        # Optionally save results
        if request.save_results:
            now = datetime.now().isoformat()
            prediction_id = f"pred_{int(datetime.now().timestamp())}"

            record = {
                "id": prediction_id,
                "model_id": request.model_id,
                "dataset_id": request.dataset_id,
                "partition": request.partition,
                "samples_count": len(results),
                "predictions": results,
                "actual_values": result_data.get("actual_values"),
                "metrics": metrics,
                "preprocessing_applied": preprocessing_applied,
                "created_at": now,
            }

            _save_prediction(record)
            result_data["prediction_id"] = prediction_id

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
