"""Unified prediction endpoint for nirs4all webapp.

Provides a single POST /predict endpoint that handles all prediction modes:
- Dataset-based prediction (from workspace datasets)
- Array-based prediction (pasted spectra)
- File-based prediction (uploaded CSV/Excel)

Delegates all prediction logic to nirs4all.predict().
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .lazy_imports import get_cached
from .models import _resolve_bundle_path
from .shared.json_safe import sanitize_float
from .shared.logger import get_logger
from .workspace_manager import workspace_manager

logger = get_logger(__name__)

router = APIRouter()


# ============= Request/Response Models =============


class PredictRequest(BaseModel):
    """JSON request for prediction."""

    model_id: str = Field(..., description="Chain ID or bundle stem/path")
    model_source: Literal["chain", "bundle", "native_archive"] = Field(
        ..., description="'chain', 'bundle', or 'native_archive'"
    )
    data_source: Literal["dataset", "array"] = Field(
        ..., description="'dataset' or 'array'"
    )
    dataset_id: str | None = Field(None, description="Dataset ID (when data_source='dataset')")
    partition: str = Field("all", description="Dataset partition (train/test/all)")
    spectra: list[list[float]] | None = Field(None, description="2D spectra array (when data_source='array')")
    sample_ids: list[str] | None = Field(
        None,
        description="Exact stable sample IDs, required for native_archive predictions",
    )


class PredictResponse(BaseModel):
    """Prediction result."""

    predictions: list[float]
    num_samples: int
    model_name: str
    preprocessing_steps: list[str] = []
    actual_values: list[float] | None = None
    metrics: dict[str, float] | None = None
    sample_ids: list[str | int] | None = None
    conformal_presentation: dict[str, object] | None = None
    # Per-sample partition labels ("train"/"val"/"test"/...) when the request
    # ran across multiple partitions (partition="all"); None otherwise.
    partitions: list[str] | None = None


# ============= Helpers =============


def _run_prediction(
    model_id: str,
    model_source: str,
    X,
    y_true=None,
    partitions: list[str] | None = None,
    sample_ids: list[str] | None = None,
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
        elif model_source == "bundle":
            bundle_path = str(_resolve_bundle_path(model_id))
            pred_result = nirs4all.predict(model=bundle_path, data=X, verbose=0)
        elif model_source == "native_archive":
            stable_ids = _require_native_sample_ids(sample_ids, len(X))
            archive_path = str(_resolve_bundle_path(model_id))
            pred_result = nirs4all.predict(
                model=archive_path,
                data={"X": X, "sample_ids": stable_ids},
                engine="native",
                verbose=0,
            )
        else:
            raise HTTPException(status_code=422, detail=f"Unknown model source: {model_source}")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=422,
            detail=f"Prediction data is incompatible with model '{model_id}': {e}",
        ) from e
    except Exception as e:
        if model_source == "native_archive":
            raise HTTPException(
                status_code=422,
                detail="Native archive prediction was refused before a result could be produced",
            ) from e
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

    # Compute metrics if y_true is available. Route through the library's single
    # metric implementation (nirs4all.core.metrics.eval_multi) instead of a
    # Studio-side sklearn re-roll, and resolve the task type with the library's
    # detector (nirs4all.core.task_detection.detect_task_type) rather than
    # assuming "regression" — so a classification model gets classification
    # metrics (accuracy/F1/...) instead of meaningless RMSE/R² on its class
    # labels, and Studio's prediction metrics stay identical to the engine's and
    # to api/evaluation.py (B-017 deep push-down; eval_multi + detect_task_type
    # already back evaluation.py).
    metrics = None
    actual_values = None
    if y_true is not None:
        try:
            y_true_arr = np.asarray(y_true).flatten()
            y_pred_arr = np.asarray(predictions)
            if len(y_true_arr) == len(y_pred_arr) and len(y_true_arr) > 0:
                actual_values = y_true_arr.tolist()
                task_type = get_cached("detect_task_type")(y_true_arr).value
                eval_multi = get_cached("eval_multi")
                raw_metrics = eval_multi(y_true_arr, y_pred_arr, task_type)
                metrics = {
                    key: sanitize_float(float(value))
                    for key, value in raw_metrics.items()
                    if isinstance(value, (int, float))
                }
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

    result_metadata = getattr(pred_result, "metadata", None)
    native_sample_ids = (
        result_metadata.get("sample_ids")
        if isinstance(result_metadata, dict)
        else None
    )
    response_sample_ids = (
        native_sample_ids
        if isinstance(native_sample_ids, list)
        and len(native_sample_ids) == len(predictions)
        and all(isinstance(value, str) and value for value in native_sample_ids)
        else None
    )
    conformal_presentation = (
        result_metadata.get("conformal_presentation")
        if isinstance(result_metadata, dict)
        and isinstance(result_metadata.get("conformal_presentation"), dict)
        else None
    )
    if conformal_presentation is not None:
        presentation_sample_ids = conformal_presentation.get("sample_ids")
        if (
            response_sample_ids is None
            or not isinstance(presentation_sample_ids, list)
            or presentation_sample_ids != response_sample_ids
        ):
            raise HTTPException(
                status_code=422,
                detail="Native conformal presentation identities do not exactly match prediction identities",
            )

    return PredictResponse(
        predictions=predictions,
        num_samples=len(predictions),
        model_name=model_name,
        preprocessing_steps=preprocessing_steps,
        actual_values=actual_values,
        metrics=metrics,
        sample_ids=response_sample_ids,
        conformal_presentation=conformal_presentation,
        partitions=aligned_partitions,
    )


def _require_native_sample_ids(
    sample_ids: list[str] | None,
    expected_count: int,
) -> list[str]:
    """Require explicit, unique IDs before crossing the native archive boundary."""

    if (
        not isinstance(sample_ids, list)
        or len(sample_ids) != expected_count
        or not sample_ids
        or not all(isinstance(sample_id, str) and sample_id for sample_id in sample_ids)
        or len(set(sample_ids)) != len(sample_ids)
    ):
        raise HTTPException(
            status_code=422,
            detail="native_archive prediction requires one unique non-empty string sample_id per spectrum",
        )
    return list(sample_ids)


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

    if request.model_source == "native_archive" and request.data_source != "array":
        raise HTTPException(
            status_code=422,
            detail="native_archive prediction currently requires an array cohort with explicit sample_ids",
        )

    return _run_prediction(
        request.model_id,
        request.model_source,
        X,
        y_true,
        partitions=per_sample_partitions,
        sample_ids=request.sample_ids,
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

    if model_source == "native_archive" and not non_numeric:
        raise HTTPException(
            status_code=422,
            detail="native_archive file prediction requires a non-numeric column containing stable sample IDs",
        )
    result = _run_prediction(
        model_id,
        model_source,
        X,
        sample_ids=sample_ids if model_source == "native_archive" else None,
    )
    result.sample_ids = sample_ids
    return result
