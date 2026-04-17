"""Unified prediction endpoint for nirs4all webapp.

Provides a single POST /predict endpoint that handles all prediction modes:
- Dataset-based prediction (from workspace datasets)
- Array-based prediction (pasted spectra)
- File-based prediction (uploaded CSV/Excel)

Delegates all prediction logic to nirs4all.predict().
"""

from __future__ import annotations

import io
import math
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .lazy_imports import get_cached
from .models import _resolve_bundle_path
from .shared.logger import get_logger
from .workspace_manager import workspace_manager

logger = get_logger(__name__)

router = APIRouter()


# ============= Request/Response Models =============


class PredictRequest(BaseModel):
    """JSON request for prediction."""

    model_id: str = Field(..., description="Chain ID or bundle stem/path")
    model_source: str = Field(..., description="'chain' or 'bundle'")
    data_source: str = Field(..., description="'dataset' or 'array'")
    dataset_id: str | None = Field(None, description="Dataset ID (when data_source='dataset')")
    partition: str = Field("all", description="Dataset partition (train/test/all)")
    spectra: list[list[float]] | None = Field(None, description="2D spectra array (when data_source='array')")


class PredictResponse(BaseModel):
    """Prediction result."""

    predictions: list[float]
    num_samples: int
    model_name: str
    preprocessing_steps: list[str] = []
    actual_values: list[float] | None = None
    metrics: dict[str, float] | None = None
    sample_ids: list[str | int] | None = None
    # Per-sample partition labels ("train"/"val"/"test"/...) when the request
    # ran across multiple partitions (partition="all"); None otherwise.
    partitions: list[str] | None = None


# ============= Helpers =============


def _sanitize_float(v: Any) -> float | None:
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def _run_prediction(
    model_id: str,
    model_source: str,
    X,
    y_true=None,
    partitions: list[str] | None = None,
) -> PredictResponse:
    """Execute prediction using nirs4all.predict()."""
    import numpy as np

    nirs4all = get_cached("nirs4all")
    if nirs4all is None:
        raise HTTPException(status_code=503, detail="nirs4all library not available")

    workspace = workspace_manager.get_current_workspace()
    workspace_path = Path(workspace.path) if workspace else None

    try:
        if model_source == "chain":
            pred_result = nirs4all.predict(
                chain_id=model_id,
                data=X,
                workspace_path=str(workspace_path) if workspace_path else None,
                verbose=0,
            )
        else:
            bundle_path = str(_resolve_bundle_path(model_id))
            pred_result = nirs4all.predict(model=bundle_path, data=X, verbose=0)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")

    # Extract predictions
    y_pred = pred_result.y_pred
    if hasattr(y_pred, "tolist"):
        predictions = y_pred.flatten().tolist()
    else:
        predictions = list(y_pred)

    # Get model info
    model_name = pred_result.model_name or model_id
    preprocessing_steps = pred_result.preprocessing_steps or []

    # Compute metrics if y_true is available
    metrics = None
    actual_values = None
    if y_true is not None:
        try:
            y_true_arr = np.asarray(y_true).flatten()
            y_pred_arr = np.asarray(predictions)
            if len(y_true_arr) == len(y_pred_arr) and len(y_true_arr) > 0:
                from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

                actual_values = y_true_arr.tolist()
                rmse = float(np.sqrt(mean_squared_error(y_true_arr, y_pred_arr)))
                r2 = float(r2_score(y_true_arr, y_pred_arr))
                mae = float(mean_absolute_error(y_true_arr, y_pred_arr))
                # RPD (Ratio of Performance to Deviation)
                std_y = float(np.std(y_true_arr))
                rpd = std_y / rmse if rmse > 0 else None
                metrics = {
                    "rmse": _sanitize_float(rmse),
                    "r2": _sanitize_float(r2),
                    "mae": _sanitize_float(mae),
                }
                if rpd is not None:
                    metrics["rpd"] = _sanitize_float(rpd)
        except Exception as e:
            logger.warning("Could not compute metrics: %s", e)

    # Align partition labels to the predictions length (nirs4all may drop rows
    # with non-finite inputs). Fall back to None if lengths don't match.
    aligned_partitions: list[str] | None = None
    if partitions is not None:
        if len(partitions) == len(predictions):
            aligned_partitions = list(partitions)
        elif len(partitions) > len(predictions):
            aligned_partitions = list(partitions[: len(predictions)])

    return PredictResponse(
        predictions=predictions,
        num_samples=len(predictions),
        model_name=model_name,
        preprocessing_steps=preprocessing_steps,
        actual_values=actual_values,
        metrics=metrics,
        partitions=aligned_partitions,
    )


# ============= Endpoints =============


@router.post("/predict", response_model=PredictResponse)
async def predict(request: PredictRequest):
    """Run prediction on data using a trained model.

    Supports two data sources:
    - dataset: Load spectra from a workspace dataset
    - array: Use provided 2D spectra array
    """
    import numpy as np

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    X = None
    y_true = None

    per_sample_partitions: list[str] | None = None

    if request.data_source == "dataset":
        if not request.dataset_id:
            raise HTTPException(status_code=400, detail="dataset_id is required for dataset source")

        from .spectra import _load_dataset

        dataset = _load_dataset(request.dataset_id)
        if not dataset:
            raise HTTPException(status_code=404, detail=f"Dataset '{request.dataset_id}' not found")

        # When "all" is requested, loop over known partitions so the frontend
        # can split charts by partition (train / val / test). Otherwise fetch
        # the single requested partition.
        if (request.partition or "").lower() == "all":
            partitions_to_try = ["train", "val", "test"]
            X_blocks: list = []
            y_blocks: list = []
            per_sample_partitions = []
            any_y_missing = False
            for part in partitions_to_try:
                try:
                    X_part = dataset.x({"partition": part}, layout="2d")
                except Exception:
                    continue
                if isinstance(X_part, list):
                    if not X_part:
                        continue
                    X_part = X_part[0]
                if X_part is None or getattr(X_part, "shape", (0,))[0] == 0:
                    continue

                try:
                    y_part = dataset.y({"partition": part})
                except Exception:
                    y_part = None

                X_blocks.append(np.asarray(X_part))
                if y_part is None:
                    any_y_missing = True
                    y_blocks.append(None)
                else:
                    y_blocks.append(np.asarray(y_part).flatten())
                per_sample_partitions.extend([part] * X_part.shape[0])

            if not X_blocks:
                raise HTTPException(
                    status_code=400,
                    detail="No samples found across train/val/test for this dataset.",
                )

            X = np.concatenate(X_blocks, axis=0)
            y_true = None if any_y_missing else np.concatenate(y_blocks, axis=0)
        else:
            selector = {"partition": request.partition}
            X = dataset.x(selector, layout="2d")
            if isinstance(X, list):
                X = X[0]

            try:
                y_true = dataset.y(selector)
            except Exception:
                pass

            per_sample_partitions = [request.partition] * (
                int(getattr(X, "shape", (0,))[0]) if X is not None else 0
            )

    elif request.data_source == "array":
        if not request.spectra or len(request.spectra) == 0:
            raise HTTPException(status_code=400, detail="spectra array is required for array source")
        X = np.array(request.spectra)

    else:
        raise HTTPException(status_code=400, detail=f"Unknown data_source: {request.data_source}")

    return _run_prediction(
        request.model_id,
        request.model_source,
        X,
        y_true,
        partitions=per_sample_partitions,
    )


@router.post("/predict/file", response_model=PredictResponse)
async def predict_from_file(
    model_id: str = Form(...),
    model_source: str = Form(...),
    file: UploadFile = File(...),
):
    """Run prediction on an uploaded CSV/Excel file.

    The file is parsed ephemerally — not stored in the workspace.
    All numeric columns are used as spectra features.
    """
    import numpy as np
    import pandas as pd

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Read file content
    content = await file.read()
    filename = file.filename or "upload"

    try:
        if filename.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(content))
        else:
            # Try CSV with various delimiters
            text = content.decode("utf-8-sig")
            for sep in [",", ";", "\t"]:
                try:
                    df = pd.read_csv(io.StringIO(text), sep=sep)
                    if len(df.columns) > 1:
                        break
                except Exception:
                    continue
            else:
                df = pd.read_csv(io.StringIO(text))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {str(e)}")

    if df.empty:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    # Extract numeric columns as spectra
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    if not numeric_cols:
        raise HTTPException(status_code=400, detail="No numeric columns found in file")

    X = df[numeric_cols].values

    # Build sample IDs from non-numeric columns or index
    non_numeric = [c for c in df.columns if c not in numeric_cols]
    if non_numeric:
        sample_ids = df[non_numeric[0]].astype(str).tolist()
    else:
        sample_ids = list(range(len(df)))

    result = _run_prediction(model_id, model_source, X)
    result.sample_ids = sample_ids
    return result
