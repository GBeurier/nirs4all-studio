"""Chain summary API endpoints backed by SQLite store.

Provides FastAPI endpoints for:
- Querying chain summaries (one row per chain with CV/final scores)
- Drill-down from chain summary to individual predictions
- Individual prediction arrays retrieval
- Metric-aware top-N ranking

All data is read from the workspace's SQLite store via
:class:`~nirs4all.pipeline.storage.workspace_store.WorkspaceStore`.
"""

from __future__ import annotations

import copy
import math
import re
import shutil
import tempfile
import zipfile
from datetime import UTC, datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .store_adapter import (
    _apply_synthetic_refit_fallback_inplace,
    _extract_model_params_from_expanded_config,
    _get_workspace_store_cls,
    _merge_variant_params,
    _parse_json_maybe,
)
from .workspace_manager import workspace_manager

STORE_AVAILABLE = True

try:
    import polars as pl

    POLARS_AVAILABLE = True
except ImportError:
    pl = None  # type: ignore[assignment]
    POLARS_AVAILABLE = False


router = APIRouter(prefix="/aggregated-predictions", tags=["aggregated-predictions"])

CHAIN_CANONICAL_STEP_KEYS = {
    "class",
    "function",
    "model",
    "y_processing",
    "branch",
    "merge",
    "sample_augmentation",
    "feature_augmentation",
    "sample_filter",
    "concat_transform",
    "chart_2d",
    "chart_y",
    "preprocessing",
    "exclude",
    "tag",
    "_or_",
    "_range_",
    "_log_range_",
    "_grid_",
    "_cartesian_",
    "_zip_",
    "_chain_",
    "_sample_",
}
CHAIN_LEGACY_REFERENCE_ALIASES = {
    "xgboost.sklearn.xgbregressor": "xgboost.XGBRegressor",
    "xgboost.sklearn.xgbclassifier": "xgboost.XGBClassifier",
    "lightgbm.sklearn.lgbmregressor": "lightgbm.LGBMRegressor",
    "lightgbm.sklearn.lgbmclassifier": "lightgbm.LGBMClassifier",
}


# ============================================================================
# Pydantic response models
# ============================================================================


class ChainSummary(BaseModel):
    """One row of the v_chain_summary view, enriched with artifact info."""

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
    variant_params: Any | None = None
    # CV scores
    cv_val_score: float | None = None
    cv_test_score: float | None = None
    cv_train_score: float | None = None
    cv_fold_count: int = 0
    cv_scores: Any | None = None
    cv_source_chain_id: str | None = None
    # Final/refit scores
    final_test_score: float | None = None
    final_train_score: float | None = None
    final_scores: Any | None = None
    # Repetition-aggregated refit scores (when dataset has an aggregate column)
    final_agg_test_score: float | None = None
    final_agg_train_score: float | None = None
    final_agg_scores: Any | None = None
    # Webapp-only fallback when the store has no explicit final chain
    synthetic_refit: bool = False
    # Standalone refit chain with no native CV/fold data
    is_refit_only: bool = False
    # Pipeline status from JOIN
    pipeline_status: str | None = None
    # Artifact info (enriched from chains table)
    fold_artifacts: dict[str, str] | None = None


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
    y_proba: list[float] | list[list[float]] | None = None
    sample_indices: list[int] | None = None
    weights: list[float | None] | None = None
    sample_metadata: dict[str, list[Any]] | None = None
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


def _get_store() -> Any:
    """Get a WorkspaceStore for the current workspace (read-only queries).

    Raises HTTPException if no workspace is selected or store is unavailable.
    """
    if not STORE_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library is required for store access",
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    workspace_path = Path(workspace.path)
    if not (workspace_path / "store.sqlite").exists() and not (workspace_path / "store.duckdb").exists():
        raise HTTPException(
            status_code=404,
            detail="No store found in workspace. Run a pipeline first.",
        )

    return _get_workspace_store_cls()(workspace_path)


def _get_workspace_path() -> Path:
    """Get current workspace path or raise HTTPException."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")
    return Path(workspace.path)


def _sanitize_cell(value: Any) -> Any:
    """Sanitize scalar values for JSON serialization."""
    import numpy as np
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


def _fetch_fold_artifacts(store: Any, chain_ids: list[str]) -> dict[str, dict[str, str]]:
    """Fetch fold_artifacts for a batch of chains in a single query.

    Returns a mapping from chain_id -> fold_artifacts dict.
    """
    import json as _json

    if not chain_ids:
        return {}
    try:
        placeholders = ", ".join("?" for _ in chain_ids)
        fa_df = store._fetch_pl(
            f"SELECT chain_id, fold_artifacts FROM chains WHERE chain_id IN ({placeholders})",
            chain_ids,
        )
        result: dict[str, dict[str, str]] = {}
        for row in fa_df.iter_rows(named=True):
            cid = row["chain_id"]
            raw = row.get("fold_artifacts")
            if raw:
                fa = _json.loads(raw) if isinstance(raw, str) else raw
                if isinstance(fa, dict) and fa:
                    result[cid] = fa
        return result
    except Exception:
        return {}


def _enrich_with_fold_artifacts(records: list[dict], store: Any) -> list[dict]:
    """Add fold_artifacts to chain summary records."""
    chain_ids = [r["chain_id"] for r in records if r.get("chain_id")]
    artifacts_map = _fetch_fold_artifacts(store, chain_ids)
    for record in records:
        record["fold_artifacts"] = artifacts_map.get(record.get("chain_id", ""))
    return records


def _mark_refit_only_records(records: list[dict]) -> list[dict]:
    """Mark standalone refit rows before any synthetic CV enrichment happens."""
    for record in records:
        has_final = (
            record.get("final_test_score") is not None
            or record.get("final_train_score") is not None
            or bool(_parse_json_maybe(record.get("final_scores")))
        )
        has_native_cv = _has_cv_summary_payload(record)
        record["is_refit_only"] = bool(record.get("is_refit_only")) or (has_final and not has_native_cv)
    return records


def _has_cv_summary_payload(record: dict[str, Any]) -> bool:
    """Return ``True`` when a summary row already has usable CV data."""
    return (
        record.get("cv_val_score") is not None
        or record.get("cv_test_score") is not None
        or record.get("cv_train_score") is not None
        or bool(record.get("cv_fold_count"))
        or bool(_parse_json_maybe(record.get("cv_scores")))
    )


def _stable_serialize(value: Any) -> str:
    """Stable serialization for params signature comparison."""
    import json as _json

    if value is None:
        return ""
    if isinstance(value, str):
        try:
            value = _json.loads(value)
        except Exception:
            return value
    try:
        return _json.dumps(value, sort_keys=True, default=str)
    except Exception:
        return str(value)


def _build_pipeline_metadata_map(store: Any, pipeline_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Load pipeline metadata needed to reconstruct fixed variant params."""
    if not pipeline_ids:
        return {}

    placeholders = ", ".join("?" for _ in pipeline_ids)
    try:
        pipelines_df = store._fetch_pl(
            f"SELECT pipeline_id, expanded_config FROM pipelines "
            f"WHERE pipeline_id IN ({placeholders})",
            pipeline_ids,
        )
        return {
            prow.get("pipeline_id", ""): dict(prow)
            for prow in pipelines_df.iter_rows(named=True)
        }
    except Exception:
        return {}


def _attach_variant_params_inplace(
    records: list[dict[str, Any]],
    pipeline_map: dict[str, dict[str, Any]],
) -> None:
    """Attach merged fixed + tuned params to raw chain-summary records."""
    for record in records:
        pipeline_row = pipeline_map.get(record.get("pipeline_id", ""), {})
        best_params = _parse_json_maybe(record.get("best_params"))
        if not isinstance(best_params, dict):
            best_params = None
        record["best_params"] = best_params
        record["variant_params"] = _merge_variant_params(
            _extract_model_params_from_expanded_config(
                pipeline_row.get("expanded_config"),
                record.get("model_step_idx"),
            ),
            best_params,
        )


def _signature_params(record: dict[str, Any]) -> Any:
    """Return the richest available parameter payload for chain matching."""
    variant_params = _parse_json_maybe(record.get("variant_params"))
    if variant_params not in (None, "", {}):
        return variant_params
    return _parse_json_maybe(record.get("best_params"))


def _chain_signature(record: dict) -> tuple[str, str, str, str]:
    """Build a signature for matching CV ↔ refit chain pairs.

    The signature is ``(model_class, model_name, preprocessings, params)``.
    ``variant_params`` takes precedence because fixed operator parameters
    are not always present in ``best_params``.
    """
    return (
        record.get("model_class") or "",
        record.get("model_name") or "",
        record.get("preprocessings") or "",
        _stable_serialize(_signature_params(record)),
    )


def _resolve_chain_id(store: Any, chain_id: str) -> str | None:
    """Resolve a possibly-truncated chain_id to a full chain_id.

    Tries an exact match first; falls back to a unique prefix match
    against the chains table for legacy short IDs (e.g. 12-16 char
    truncated UUIDs from older runs). Returns ``None`` if no chain
    matches or the prefix is ambiguous.
    """
    if not chain_id:
        return None
    chain = store.get_chain(chain_id)
    if chain is not None:
        return chain_id
    try:
        df = store._fetch_pl(
            "SELECT chain_id FROM chains WHERE chain_id LIKE ? LIMIT 2",
            [f"{chain_id}%"],
        )
    except Exception:
        return None
    if len(df) == 1:
        return str(df.row(0, named=True)["chain_id"])
    return None


def _normalize_chain_reference(reference: Any) -> Any:
    if not isinstance(reference, str):
        return reference
    normalized = reference.strip()
    if not normalized:
        return normalized
    return CHAIN_LEGACY_REFERENCE_ALIASES.get(normalized.lower(), normalized)


def _normalize_chain_payload(payload: Any) -> Any:
    if isinstance(payload, list):
        return [_normalize_chain_payload(item) for item in payload]

    if not isinstance(payload, dict):
        return payload

    normalized: dict[str, Any] = {}
    for key, value in payload.items():
        if key in {"class", "function"} or key in {"model", "y_processing"} and isinstance(value, str):
            normalized[key] = _normalize_chain_reference(value)
        else:
            normalized[key] = _normalize_chain_payload(value)
    return normalized


def _looks_like_canonical_chain_payload(value: Any) -> bool:
    return isinstance(value, dict) and any(key in value for key in CHAIN_CANONICAL_STEP_KEYS)


_DROP_PIPELINE_STEP = object()


def _is_runtime_only_step_repr(value: Any) -> bool:
    return (
        isinstance(value, str)
        and " object at 0x" in value
        and value.strip().startswith("<")
        and value.strip().endswith(">")
    )


def _clean_expanded_pipeline_step(step: Any) -> Any:
    if step is None:
        return None

    if isinstance(step, list):
        cleaned_items: list[Any] = []
        for item in step:
            cleaned = _clean_expanded_pipeline_step(item)
            if cleaned is _DROP_PIPELINE_STEP:
                continue
            cleaned_items.append(cleaned)
        return cleaned_items

    if isinstance(step, dict):
        if _is_runtime_only_step_repr(step.get("class")):
            return _DROP_PIPELINE_STEP
        if _is_runtime_only_step_repr(step.get("function")):
            return _DROP_PIPELINE_STEP

        model_ref = step.get("model")
        if isinstance(model_ref, str) and _is_runtime_only_step_repr(model_ref):
            return _DROP_PIPELINE_STEP

        cleaned_dict: dict[str, Any] = {}
        for key, value in step.items():
            cleaned = _clean_expanded_pipeline_step(value)
            if cleaned is _DROP_PIPELINE_STEP:
                continue
            cleaned_dict[key] = cleaned
        return _normalize_chain_payload(cleaned_dict)

    if _is_runtime_only_step_repr(step):
        return _DROP_PIPELINE_STEP

    if isinstance(step, str):
        return _normalize_chain_reference(step)

    return step


def _extract_expanded_pipeline_steps(pipeline: dict[str, Any]) -> list[Any]:
    expanded_config = _parse_json_maybe(pipeline.get("expanded_config"))

    if isinstance(expanded_config, dict) and isinstance(expanded_config.get("pipeline"), list):
        expanded_steps = expanded_config["pipeline"]
    elif isinstance(expanded_config, list):
        expanded_steps = expanded_config
    elif expanded_config is None:
        expanded_steps = []
    else:
        expanded_steps = [expanded_config]

    cleaned_steps: list[Any] = []
    for step in expanded_steps:
        cleaned = _clean_expanded_pipeline_step(step)
        if cleaned is _DROP_PIPELINE_STEP:
            continue
        cleaned_steps.append(cleaned)

    return _sanitize_dict({"pipeline": cleaned_steps})["pipeline"]


def _chain_step_to_canonical(step: dict[str, Any], *, is_model: bool) -> Any | None:
    """Rebuild a canonical step payload from a stored chain step.

    Chain rows often persist the original canonical operator config inside the
    ``params`` field. Prefer that payload when present instead of re-wrapping
    the short ``operator_class`` label, which loses both type fidelity and the
    original parameter shape.
    """
    operator_class = _normalize_chain_reference(step.get("operator_class", ""))
    params = copy.deepcopy(step.get("params"))

    if _looks_like_canonical_chain_payload(params):
        payload = params
    elif is_model:
        if isinstance(params, dict) and ("class" in params or "function" in params):
            payload = {"model": params}
        elif params:
            payload = {"model": {"class": operator_class, "params": params}}
        elif operator_class:
            payload = {"model": operator_class}
        else:
            payload = None
    else:
        if isinstance(params, dict) and ("class" in params or "function" in params):
            payload = params
        elif params:
            payload = {"class": operator_class, "params": params}
        elif operator_class:
            payload = operator_class
        else:
            payload = None

    return _normalize_chain_payload(payload)


def _enrich_refit_with_cv(records: list[dict], store: Any) -> list[dict]:
    """For refit chains missing CV scores, copy them from a matching CV sibling.

    A "refit chain" is one with a non-null ``final_test_score`` but null
    ``cv_val_score``. Looks up sibling chains in the same run+dataset whose
    ``(model_class, model_name, preprocessings, variant_params)`` signature
    matches and copies their CV fields onto the refit record.
    """
    refit_records = [
        r for r in records
        if (
            r.get("final_test_score") is not None
            and r.get("cv_val_score") is None
        )
    ]
    if not refit_records:
        return records

    # Group refit records by dataset to limit lookup scope.
    datasets = {r.get("dataset_name") for r in refit_records if r.get("dataset_name")}
    if not datasets:
        return records

    # Fetch all chains for each affected dataset.
    cv_pool: list[dict] = []
    seen_chain_ids: set[str] = set()
    for dataset_name in datasets:
        try:
            df = store.query_chain_summaries(dataset_name=dataset_name)
        except Exception:
            continue
        for row in df.iter_rows(named=True):
            row_dict = dict(row)
            cid = row_dict.get("chain_id")
            if cid and cid not in seen_chain_ids and row_dict.get("cv_val_score") is not None:
                cv_pool.append(row_dict)
                seen_chain_ids.add(cid)

    if not cv_pool:
        return records

    pipeline_ids = [
        pid
        for pid in {r.get("pipeline_id") for r in [*records, *cv_pool]}
        if pid
    ]
    pipeline_map = _build_pipeline_metadata_map(store, pipeline_ids)
    _attach_variant_params_inplace(records, pipeline_map)
    _attach_variant_params_inplace(cv_pool, pipeline_map)

    # Build signature → CV chain map.
    cv_by_signature: dict[tuple[str, str, str, str, str, str], dict] = {}
    for cv in cv_pool:
        sig = (
            cv.get("run_id") or "",
            cv.get("dataset_name") or "",
            *_chain_signature(cv),
        )
        if sig not in cv_by_signature:
            cv_by_signature[sig] = cv

    cv_fields = ("cv_val_score", "cv_test_score", "cv_train_score", "cv_fold_count", "cv_scores")
    for refit in refit_records:
        match = cv_by_signature.get((
            refit.get("run_id") or "",
            refit.get("dataset_name") or "",
            *_chain_signature(refit),
        ))
        if match is None:
            continue
        for field in cv_fields:
            current = refit.get(field)
            if field == "cv_fold_count":
                missing = not current
            elif field == "cv_scores":
                missing = not _parse_json_maybe(current)
            else:
                missing = current is None
            if missing:
                refit[field] = match.get(field)
        if match.get("chain_id"):
            refit["cv_source_chain_id"] = match.get("chain_id")
        if _has_cv_summary_payload(refit):
            refit["is_refit_only"] = False

    return records


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
        _mark_refit_only_records(records)
        _enrich_with_fold_artifacts(records, store)
        _enrich_refit_with_cv(records, store)
        for record in records:
            _apply_synthetic_refit_fallback_inplace(record)
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
        _mark_refit_only_records(records)
        _enrich_with_fold_artifacts(records, store)
        _enrich_refit_with_cv(records, store)
        for record in records:
            _apply_synthetic_refit_fallback_inplace(record)
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
            _mark_refit_only_records([summary])
            _enrich_with_fold_artifacts([summary], store)
            _enrich_refit_with_cv([summary], store)
            _apply_synthetic_refit_fallback_inplace(summary)
            pipeline_ids = [summary.get("pipeline_id")] if summary.get("pipeline_id") else []
            pipeline_map = _build_pipeline_metadata_map(store, pipeline_ids) if pipeline_ids else {}
            pipeline_row = pipeline_map.get(summary.get("pipeline_id") or "", {}) if pipeline_map else {}
            best_params_parsed = _parse_json_maybe(summary.get("best_params"))
            summary["best_params"] = best_params_parsed if isinstance(best_params_parsed, dict) else None
            step_params = _extract_model_params_from_expanded_config(
                pipeline_row.get("expanded_config"),
                summary.get("model_step_idx"),
            )
            summary["variant_params"] = step_params if isinstance(step_params, dict) else None

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


@router.get("/chain/{chain_id}/pipeline-steps")
async def get_chain_pipeline_steps(chain_id: str):
    """Return the nirs4all-canonical pipeline steps for a specific chain.

    Converts the chain's stored steps (operator_class + params) into the
    nirs4all canonical format (``{"class": ...}`` / ``{"model": ...}``)
    understood by the frontend ``importFromNirs4all`` converter.

    Other model steps from the same pipeline are excluded so the editor
    shows only the preprocessing chain + this chain's model.
    """
    store = _get_store()
    try:
        resolved_id = _resolve_chain_id(store, chain_id)
        if resolved_id is None:
            raise HTTPException(status_code=404, detail=f"Chain {chain_id} not found")
        chain = store.get_chain(resolved_id)
        if chain is None:
            raise HTTPException(status_code=404, detail=f"Chain {chain_id} not found")
        chain_id = resolved_id

        chain_steps = chain.get("steps") or []
        model_step_idx = chain.get("model_step_idx")

        # Find model step indices of OTHER chains in the same pipeline
        # so we can exclude them from the output.
        other_model_indices: set[int] = set()
        sibling_chains_df = store.get_chains_for_pipeline(chain["pipeline_id"])
        if len(sibling_chains_df) > 0:
            for row in sibling_chains_df.iter_rows(named=True):
                idx = row.get("model_step_idx")
                if idx is not None and idx != model_step_idx:
                    other_model_indices.add(idx)

        # Convert chain steps to nirs4all canonical format
        canonical_steps: list[Any] = []
        for step in chain_steps:
            step_idx = step.get("step_idx")
            operator_class = step.get("operator_class", "")

            # Skip steps that are model steps of other chains
            if step_idx in other_model_indices:
                continue

            # Skip internal refit splitters (not user-visible)
            if "_FullTrainFoldSplitter" in operator_class:
                continue

            # Skip repr-style operator classes (e.g. "<ClassName object at 0x...>")
            if " object at 0x" in operator_class:
                continue

            canonical_step = _chain_step_to_canonical(
                step,
                is_model=step_idx == model_step_idx,
            )
            if canonical_step is None:
                continue
            canonical_steps.append(canonical_step)

        # Derive a human-readable name
        preprocessings = chain.get("preprocessings") or ""
        model_name = chain.get("model_name") or chain.get("model_class", "").rsplit(".", 1)[-1]
        if preprocessings:
            name = f"{preprocessings} → {model_name}"
        else:
            name = model_name

        return {
            "chain_id": chain_id,
            "name": name,
            "pipeline": canonical_steps,
        }
    finally:
        store.close()


@router.get("/pipeline/{pipeline_id}/pipeline-steps")
async def get_run_pipeline_steps(pipeline_id: str):
    """Return the cleaned stored expanded pipeline steps for a run pipeline."""
    store = _get_store()
    try:
        pipeline = store.get_pipeline(pipeline_id)
        if pipeline is None:
            raise HTTPException(status_code=404, detail=f"Pipeline {pipeline_id} not found")

        return {
            "pipeline_id": pipeline["pipeline_id"],
            "name": pipeline.get("name") or pipeline["pipeline_id"],
            "pipeline": _extract_expanded_pipeline_steps(pipeline),
        }
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
        records = []
        for row in df.iter_rows(named=True):
            d = dict(row)
            if isinstance(d.get("scores"), str):
                import json
                try:
                    d["scores"] = json.loads(d["scores"])
                except Exception:
                    pass
            if isinstance(d.get("best_params"), str):
                import json
                try:
                    d["best_params"] = json.loads(d["best_params"])
                except Exception:
                    pass
            records.append(_sanitize_dict(d))
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
    import numpy as np

    store = _get_store()
    try:
        arrays = None

        get_arrays = getattr(store, "get_prediction_arrays", None)
        if callable(get_arrays):
            arrays = get_arrays(prediction_id)
        else:
            prediction = store.get_prediction(prediction_id, load_arrays=True)
            if prediction is not None:
                arrays = prediction

        if arrays is None:
            raise HTTPException(
                status_code=404,
                detail=f"No arrays found for prediction {prediction_id}",
            )

        def _to_list(value: Any) -> Any:
            if value is None:
                return None
            if isinstance(value, dict):
                return {str(key): _to_list(item) for key, item in value.items()}
            if isinstance(value, np.ndarray):
                value = value.tolist()
            if isinstance(value, np.generic):
                value = value.item()
            if isinstance(value, (list, tuple)):
                sanitized = []
                for item in value:
                    converted = _to_list(item)
                    if isinstance(converted, float):
                        converted = _sanitize_float(converted)
                    sanitized.append(converted)
                return sanitized
            if isinstance(value, float):
                return _sanitize_float(value)
            return value

        y_true = _to_list(arrays.get("y_true"))
        y_pred = _to_list(arrays.get("y_pred"))
        y_proba = _to_list(arrays.get("y_proba"))
        weights = _to_list(arrays.get("weights"))
        sample_indices = _to_list(arrays.get("sample_indices"))
        sample_metadata = _to_list(arrays.get("sample_metadata"))

        if sample_metadata is None:
            fallback_meta = arrays.get("metadata")
            if isinstance(fallback_meta, dict):
                sample_metadata = _to_list(fallback_meta)

        if sample_metadata is None:
            dataset_name = arrays.get("dataset_name")
            array_store = getattr(store, "array_store", None)
            load_single = getattr(array_store, "load_single", None)
            if callable(load_single):
                loaded = load_single(prediction_id, dataset_name=dataset_name)
                if isinstance(loaded, dict):
                    loaded_meta = loaded.get("sample_metadata")
                    if isinstance(loaded_meta, dict):
                        sample_metadata = _to_list(loaded_meta)

        if isinstance(weights, list) and all(item is None for item in weights):
            weights = None

        n_samples = 0
        for value in (y_true, y_pred, sample_indices, weights, y_proba, sample_metadata):
            if value is not None:
                n_samples = len(value) if not isinstance(value, dict) else len(next(iter(value.values()), []))
                break

        result: dict[str, Any] = {
            "prediction_id": arrays.get("prediction_id", prediction_id),
            "y_true": y_true,
            "y_pred": y_pred,
            "y_proba": y_proba,
            "sample_indices": sample_indices,
            "weights": weights,
            "sample_metadata": sample_metadata,
            "n_samples": n_samples,
        }

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
