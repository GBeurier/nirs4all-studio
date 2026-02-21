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
import re
import shutil
import tempfile
import zipfile
from datetime import UTC, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager

# WorkspaceStore is optional (nirs4all may not be installed)
try:
    from nirs4all.pipeline.storage import WorkspaceStore

    STORE_AVAILABLE = True
except ImportError:
    WorkspaceStore = None  # type: ignore[assignment, misc]
    STORE_AVAILABLE = False

try:
    import polars as pl

    POLARS_AVAILABLE = True
except ImportError:
    pl = None  # type: ignore[assignment]
    POLARS_AVAILABLE = False


router = APIRouter(prefix="/aggregated-predictions", tags=["aggregated-predictions"])


# ============================================================================
# Pydantic response models
# ============================================================================


class ChainSummary(BaseModel):
    """One row of the v_chain_summary view."""

    run_id: str
    pipeline_id: str
    chain_id: str
    model_name: str | None = None
    model_class: str
    preprocessings: str | None = None
    branch_path: Any | None = None
    source_index: int | None = None
    model_step_idx: int
    metric: str | None = None
    task_type: str | None = None
    dataset_name: str | None = None
    best_params: Any | None = None
    # CV scores
    cv_val_score: float | None = None
    cv_test_score: float | None = None
    cv_train_score: float | None = None
    cv_fold_count: int = 0
    cv_scores: Any | None = None
    # Final/refit scores
    final_test_score: float | None = None
    final_train_score: float | None = None
    final_scores: Any | None = None
    # Pipeline status from JOIN
    pipeline_status: str | None = None


# Deprecated alias
AggregatedPrediction = ChainSummary


class ChainSummariesResponse(BaseModel):
    """Response for chain summaries query."""

    predictions: list[ChainSummary]
    total: int
    generated_at: str


# Deprecated alias
AggregatedPredictionsResponse = ChainSummariesResponse


class PartitionPrediction(BaseModel):
    """Individual prediction row for drill-down."""

    prediction_id: str
    pipeline_id: str
    chain_id: str | None = None
    dataset_name: str
    model_name: str
    model_class: str
    fold_id: str
    partition: str
    val_score: float | None = None
    test_score: float | None = None
    train_score: float | None = None
    metric: str
    task_type: str
    n_samples: int | None = None
    n_features: int | None = None
    preprocessings: str | None = None


class ChainDetailResponse(BaseModel):
    """Response for chain detail with predictions."""

    chain_id: str
    summary: ChainSummary | None = None
    predictions: list[PartitionPrediction]
    pipeline: dict[str, Any] | None = None


class PredictionArraysResponse(BaseModel):
    """Response for prediction arrays."""

    prediction_id: str
    y_true: list[float] | None = None
    y_pred: list[float] | None = None
    y_proba: list[float] | None = None
    sample_indices: list[int] | None = None
    weights: list[float] | None = None
    n_samples: int = 0


class ExportRequest(BaseModel):
    """Bulk export request."""

    dataset_names: list[str] | None = Field(
        default=None,
        description="Dataset names to export. Null exports all available datasets.",
    )
    format: str = Field(default="zip", description="Export format: parquet | zip")


class SQLQueryRequest(BaseModel):
    """Request model for read-only SQL query endpoint."""

    sql: str = Field(..., description="Read-only SQL query")


class SQLQueryResponse(BaseModel):
    """Response model for SQL query results."""

    columns: list[str]
    rows: list[list[Any]]
    row_count: int


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


def _get_store() -> WorkspaceStore:
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


def _get_workspace_path() -> Path:
    """Get current workspace path or raise HTTPException."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")
    return Path(workspace.path)


def _sanitize_cell(value: Any) -> Any:
    """Sanitize scalar values for JSON serialization."""
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, np.generic):
        return value.item()
    return value


def _is_read_only_sql(sql: str) -> bool:
    """Basic guardrail to allow only read-only SQL."""
    normalized = re.sub(r"--.*?$|/\*.*?\*/", " ", sql, flags=re.MULTILINE | re.DOTALL).strip().lower()
    if not normalized:
        return False

    if not (normalized.startswith("select") or normalized.startswith("with")):
        return False

    forbidden = re.compile(
        r"\b(insert|update|delete|drop|alter|create|replace|truncate|attach|detach|copy|vacuum|call)\b",
        re.IGNORECASE,
    )
    return forbidden.search(normalized) is None


def _list_array_datasets(workspace_path: Path) -> dict[str, Path]:
    """Map dataset name -> parquet file path under arrays/."""
    arrays_dir = workspace_path / "arrays"
    if not arrays_dir.exists() or not arrays_dir.is_dir():
        return {}
    mapping: dict[str, Path] = {}
    for parquet_file in arrays_dir.glob("*.parquet"):
        mapping[parquet_file.stem] = parquet_file
    return mapping


# ============================================================================
# Endpoints
# ============================================================================


@router.get("", response_model=ChainSummariesResponse)
async def get_aggregated_predictions(
    run_id: str | None = Query(None, description="Filter by run ID"),
    pipeline_id: str | None = Query(None, description="Filter by pipeline ID"),
    chain_id: str | None = Query(None, description="Filter by chain ID"),
    dataset_name: str | None = Query(None, description="Filter by dataset name"),
    model_class: str | None = Query(None, description="Filter by model class"),
    metric: str | None = Query(None, description="Filter by metric"),
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
            generated_at=datetime.now(UTC).isoformat(),
        )
    finally:
        store.close()


@router.get("/top")
async def get_top_aggregated_predictions(
    metric: str = Query(..., description="Metric to rank by"),
    n: int = Query(10, ge=1, le=100, description="Number of results"),
    score_column: str = Query("cv_val_score", description="Score column to sort by"),
    run_id: str | None = Query(None),
    pipeline_id: str | None = Query(None),
    dataset_name: str | None = Query(None),
    model_class: str | None = Query(None),
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
            "generated_at": datetime.now(UTC).isoformat(),
        }
    finally:
        store.close()


@router.get("/chain/{chain_id}", response_model=ChainDetailResponse)
async def get_chain_detail(
    chain_id: str,
    metric: str | None = Query(None),
    dataset_name: str | None = Query(None),
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
    partition: str | None = Query(None, description="Partition filter: train, val, test"),
    fold_id: str | None = Query(None, description="Fold ID filter"),
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


@router.get("/export/{dataset_name}.parquet")
async def export_dataset_parquet(
    dataset_name: str,
    background_tasks: BackgroundTasks,
    partition: str | None = Query(None, description="Optional partition filter"),
    model_name: str | None = Query(None, description="Optional model name filter"),
):
    """Export one dataset's prediction arrays as a portable parquet file."""
    workspace_path = _get_workspace_path()
    datasets = _list_array_datasets(workspace_path)
    source_file = datasets.get(dataset_name)
    if source_file is None:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found in arrays/")

    # Fast path: return existing parquet file directly.
    if partition is None and model_name is None:
        return FileResponse(
            path=str(source_file),
            media_type="application/octet-stream",
            filename=f"{dataset_name}.parquet",
        )

    if not POLARS_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="Polars is required for filtered parquet export",
        )

    try:
        df = pl.read_parquet(source_file)  # type: ignore[union-attr]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read parquet: {exc}") from exc

    if partition is not None:
        if "partition" not in df.columns:
            raise HTTPException(status_code=400, detail="Parquet file does not contain 'partition' column")
        df = df.filter(pl.col("partition") == partition)  # type: ignore[union-attr]

    if model_name is not None:
        if "model_name" not in df.columns:
            raise HTTPException(status_code=400, detail="Parquet file does not contain 'model_name' column")
        df = df.filter(pl.col("model_name") == model_name)  # type: ignore[union-attr]

    tmp_dir = Path(tempfile.mkdtemp(prefix="n4a_export_"))
    output_file = tmp_dir / f"{dataset_name}.parquet"
    try:
        df.write_parquet(output_file)  # type: ignore[union-attr]
    except Exception as exc:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Failed to write filtered parquet: {exc}") from exc

    background_tasks.add_task(shutil.rmtree, str(tmp_dir), True)
    return FileResponse(
        path=str(output_file),
        media_type="application/octet-stream",
        filename=f"{dataset_name}.parquet",
    )


@router.post("/export")
async def export_datasets(request: ExportRequest, background_tasks: BackgroundTasks):
    """Bulk export one or more datasets as parquet or zip."""
    export_format = (request.format or "zip").lower()
    if export_format not in {"parquet", "zip"}:
        raise HTTPException(status_code=400, detail="format must be 'parquet' or 'zip'")

    workspace_path = _get_workspace_path()
    datasets = _list_array_datasets(workspace_path)
    if not datasets:
        raise HTTPException(status_code=404, detail="No dataset parquet files found in arrays/")

    selected = request.dataset_names if request.dataset_names is not None else sorted(datasets.keys())
    selected = [name for name in selected if name]
    if not selected:
        raise HTTPException(status_code=400, detail="No datasets selected for export")

    missing = [name for name in selected if name not in datasets]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Datasets not found in arrays/: {', '.join(sorted(missing))}",
        )

    if export_format == "parquet":
        if len(selected) != 1:
            raise HTTPException(
                status_code=400,
                detail="format='parquet' requires exactly one dataset",
            )
        ds_name = selected[0]
        return FileResponse(
            path=str(datasets[ds_name]),
            media_type="application/octet-stream",
            filename=f"{ds_name}.parquet",
        )

    tmp_dir = Path(tempfile.mkdtemp(prefix="n4a_export_zip_"))
    zip_path = tmp_dir / "predictions_export.zip"
    try:
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for ds_name in selected:
                src = datasets[ds_name]
                zf.write(src, arcname=f"{ds_name}.parquet")
    except Exception as exc:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Failed to build export archive: {exc}") from exc

    background_tasks.add_task(shutil.rmtree, str(tmp_dir), True)
    return FileResponse(
        path=str(zip_path),
        media_type="application/zip",
        filename="predictions_export.zip",
    )


@router.post("/query", response_model=SQLQueryResponse)
async def query_predictions_metadata(request: SQLQueryRequest):
    """Run a read-only SQL query against prediction metadata tables."""
    sql = request.sql.strip()
    if not _is_read_only_sql(sql):
        raise HTTPException(
            status_code=400,
            detail="Only read-only SELECT/WITH queries are allowed",
        )

    store = _get_store()
    try:
        df = store._fetch_pl(sql)
        columns = list(df.columns)
        rows: list[list[Any]] = []
        for row in df.iter_rows(named=False):
            rows.append([_sanitize_cell(value) for value in row])
        return SQLQueryResponse(
            columns=columns,
            rows=rows,
            row_count=len(rows),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to execute query: {exc}") from exc
    finally:
        store.close()
