"""Chain summary API endpoints backed by DuckDB.

Provides FastAPI endpoints for:
- Querying chain summaries (one row per chain with CV/final scores)
- Drill-down from chain summary to individual predictions
- Individual prediction arrays retrieval
- Metric-aware top-N ranking

All data is read from the workspace's DuckDB store via
:class:`~nirs4all.pipeline.storage.workspace_store.WorkspaceStore`.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager

# WorkspaceStore is optional (nirs4all may not be installed)
try:
    from nirs4all.pipeline.storage import WorkspaceStore

    STORE_AVAILABLE = True
except ImportError:
    WorkspaceStore = None  # type: ignore[assignment, misc]
    STORE_AVAILABLE = False


router = APIRouter(prefix="/aggregated-predictions", tags=["aggregated-predictions"])


# ============================================================================
# Pydantic response models
# ============================================================================


class ChainSummary(BaseModel):
    """One row of the v_chain_summary view."""

    run_id: str
    pipeline_id: str
    chain_id: str
    model_name: Optional[str] = None
    model_class: str
    preprocessings: Optional[str] = None
    branch_path: Optional[Any] = None
    source_index: Optional[int] = None
    model_step_idx: int
    metric: Optional[str] = None
    task_type: Optional[str] = None
    dataset_name: Optional[str] = None
    best_params: Optional[Any] = None
    # CV scores
    cv_val_score: Optional[float] = None
    cv_test_score: Optional[float] = None
    cv_train_score: Optional[float] = None
    cv_fold_count: int = 0
    cv_scores: Optional[Any] = None
    # Final/refit scores
    final_test_score: Optional[float] = None
    final_train_score: Optional[float] = None
    final_scores: Optional[Any] = None
    # Pipeline status from JOIN
    pipeline_status: Optional[str] = None


# Deprecated alias
AggregatedPrediction = ChainSummary


class ChainSummariesResponse(BaseModel):
    """Response for chain summaries query."""

    predictions: List[ChainSummary]
    total: int
    generated_at: str


# Deprecated alias
AggregatedPredictionsResponse = ChainSummariesResponse


class PartitionPrediction(BaseModel):
    """Individual prediction row for drill-down."""

    prediction_id: str
    pipeline_id: str
    chain_id: Optional[str] = None
    dataset_name: str
    model_name: str
    model_class: str
    fold_id: str
    partition: str
    val_score: Optional[float] = None
    test_score: Optional[float] = None
    train_score: Optional[float] = None
    metric: str
    task_type: str
    n_samples: Optional[int] = None
    n_features: Optional[int] = None
    preprocessings: Optional[str] = None


class ChainDetailResponse(BaseModel):
    """Response for chain detail with predictions."""

    chain_id: str
    summary: Optional[ChainSummary] = None
    predictions: List[PartitionPrediction]
    pipeline: Optional[Dict[str, Any]] = None


class PredictionArraysResponse(BaseModel):
    """Response for prediction arrays."""

    prediction_id: str
    y_true: Optional[List[float]] = None
    y_pred: Optional[List[float]] = None
    y_proba: Optional[List[float]] = None
    sample_indices: Optional[List[int]] = None
    weights: Optional[List[float]] = None
    n_samples: int = 0


# ============================================================================
# Helpers
# ============================================================================


def _sanitize_float(value: Any) -> Any:
    """Convert NaN / Inf to None for JSON serialization."""
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def _sanitize_dict(d: dict) -> dict:
    """Recursively sanitize float values."""
    out = {}
    for k, v in d.items():
        if isinstance(v, dict):
            out[k] = _sanitize_dict(v)
        elif isinstance(v, (float, int)):
            out[k] = _sanitize_float(v)
        elif isinstance(v, list):
            out[k] = [
                _sanitize_dict(item) if isinstance(item, dict) else _sanitize_float(item) if isinstance(item, (float, int)) else item
                for item in v
            ]
        else:
            out[k] = v
    return out


def _get_store() -> "WorkspaceStore":
    """Get a WorkspaceStore for the current workspace (read-only queries).

    Raises HTTPException if no workspace is selected or store is unavailable.
    """
    if not STORE_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library is required for DuckDB store access",
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    workspace_path = Path(workspace.path)
    db_path = workspace_path / "store.duckdb"
    if not db_path.exists():
        raise HTTPException(
            status_code=404,
            detail="No DuckDB store found in workspace. Run a pipeline first.",
        )

    return WorkspaceStore(workspace_path)


# ============================================================================
# Endpoints
# ============================================================================


@router.get("", response_model=ChainSummariesResponse)
async def get_aggregated_predictions(
    run_id: Optional[str] = Query(None, description="Filter by run ID"),
    pipeline_id: Optional[str] = Query(None, description="Filter by pipeline ID"),
    chain_id: Optional[str] = Query(None, description="Filter by chain ID"),
    dataset_name: Optional[str] = Query(None, description="Filter by dataset name"),
    model_class: Optional[str] = Query(None, description="Filter by model class"),
    metric: Optional[str] = Query(None, description="Filter by metric"),
):
    """Query chain summaries.

    Returns one row per chain with CV averages, final/refit scores, and
    chain metadata.  All filter parameters are optional and AND-combined.
    """
    store = _get_store()
    try:
        df = store.query_chain_summaries(
            run_id=run_id,
            pipeline_id=pipeline_id,
            chain_id=chain_id,
            dataset_name=dataset_name,
            model_class=model_class,
            metric=metric,
        )
        records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]
        return ChainSummariesResponse(
            predictions=records,
            total=len(records),
            generated_at=datetime.now(timezone.utc).isoformat(),
        )
    finally:
        store.close()


@router.get("/top")
async def get_top_aggregated_predictions(
    metric: str = Query(..., description="Metric to rank by"),
    n: int = Query(10, ge=1, le=100, description="Number of results"),
    score_column: str = Query("cv_val_score", description="Score column to sort by"),
    run_id: Optional[str] = Query(None),
    pipeline_id: Optional[str] = Query(None),
    dataset_name: Optional[str] = Query(None),
    model_class: Optional[str] = Query(None),
):
    """Get top-N chain summaries ranked by metric score.

    Sort direction is auto-detected from the metric name (ascending for
    error metrics like RMSE, descending for score metrics like R²).
    """
    store = _get_store()
    try:
        df = store.query_top_chains(
            metric=metric,
            n=n,
            score_column=score_column,
            run_id=run_id,
            pipeline_id=pipeline_id,
            dataset_name=dataset_name,
            model_class=model_class,
        )
        records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]
        return {
            "predictions": records,
            "total": len(records),
            "metric": metric,
            "score_column": score_column,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    finally:
        store.close()


@router.get("/chain/{chain_id}", response_model=ChainDetailResponse)
async def get_chain_detail(
    chain_id: str,
    metric: Optional[str] = Query(None),
    dataset_name: Optional[str] = Query(None),
):
    """Get chain summary and predictions for a specific chain.

    Returns the chain summary plus individual prediction rows for
    drill-down. Pipeline metadata (generator_choices) is included
    when available.
    """
    store = _get_store()
    try:
        # Get chain summary
        agg_df = store.query_chain_summaries(
            chain_id=chain_id,
            metric=metric,
            dataset_name=dataset_name,
        )
        summary = None
        if len(agg_df) > 0:
            summary = _sanitize_dict(dict(agg_df.row(0, named=True)))

        # Get individual prediction rows
        pred_df = store.get_chain_predictions(chain_id)
        predictions = [_sanitize_dict(dict(row)) for row in pred_df.iter_rows(named=True)]

        if not predictions and summary is None:
            raise HTTPException(status_code=404, detail=f"Chain {chain_id} not found or has no predictions")

        # Get pipeline metadata (generator_choices)
        pipeline_info = None
        if summary and summary.get("pipeline_id"):
            pipeline = store.get_pipeline(summary["pipeline_id"])
            if pipeline:
                pipeline_info = _sanitize_dict({
                    "pipeline_id": pipeline["pipeline_id"],
                    "name": pipeline.get("name"),
                    "dataset_name": pipeline.get("dataset_name"),
                    "generator_choices": pipeline.get("generator_choices"),
                    "status": pipeline.get("status"),
                    "metric": pipeline.get("metric"),
                    "best_val": pipeline.get("best_val"),
                    "best_test": pipeline.get("best_test"),
                })

        return ChainDetailResponse(
            chain_id=chain_id,
            summary=summary,
            predictions=predictions,
            pipeline=pipeline_info,
        )
    finally:
        store.close()


@router.get("/chain/{chain_id}/detail")
async def get_chain_partition_detail(
    chain_id: str,
    partition: Optional[str] = Query(None, description="Partition filter: train, val, test"),
    fold_id: Optional[str] = Query(None, description="Fold ID filter"),
):
    """Get individual prediction rows for a chain with partition/fold filtering.

    This is the drill-down endpoint for viewing fold-level predictions.
    """
    store = _get_store()
    try:
        df = store.get_chain_predictions(
            chain_id=chain_id,
            partition=partition,
            fold_id=fold_id,
        )
        records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]
        return {
            "chain_id": chain_id,
            "predictions": records,
            "total": len(records),
            "partition": partition,
            "fold_id": fold_id,
        }
    finally:
        store.close()


@router.get("/{prediction_id}/arrays", response_model=PredictionArraysResponse)
async def get_prediction_arrays(prediction_id: str):
    """Get prediction arrays (y_true, y_pred, etc.) for a single prediction.

    Arrays are loaded on demand and returned as JSON lists.
    """
    store = _get_store()
    try:
        arrays = store.get_prediction_arrays(prediction_id)
        if arrays is None:
            raise HTTPException(
                status_code=404,
                detail=f"No arrays found for prediction {prediction_id}",
            )

        result: dict[str, Any] = {"prediction_id": prediction_id, "n_samples": 0}

        for key in ("y_true", "y_pred", "y_proba", "weights"):
            val = arrays.get(key)
            if val is not None and isinstance(val, np.ndarray):
                result[key] = val.tolist()
                if key == "y_true":
                    result["n_samples"] = len(val)
            else:
                result[key] = None

        sample_indices = arrays.get("sample_indices")
        if sample_indices is not None and isinstance(sample_indices, np.ndarray):
            result["sample_indices"] = sample_indices.tolist()
        else:
            result["sample_indices"] = None

        return result
    finally:
        store.close()
