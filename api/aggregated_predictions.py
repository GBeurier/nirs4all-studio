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

import asyncio
import copy
import math
import re
import shutil
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from .results_repository import (
    ResultsRepository,
    ResultsRepositoryNotFound,
    native_results_root,
    resolve_results_repository,
)
from .robustness_contract import (
    ROBUSTNESS_SPECTRAL_SCENARIO_KINDS,
    RobustnessLaunchPayload,
    normalize_robustness_launch_payload,
)
from .shared.json_safe import sanitize_dict, sanitize_float
from .store_adapter import (
    _apply_synthetic_refit_fallback_inplace,
    _dataframe_rows,
    _extract_model_params_from_expanded_config,
    _get_workspace_store_cls,
    _mark_refit_only_entries_inplace,
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
    score_maps: Any | None = None
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
    artifact_refs: list[dict[str, Any]] | None = None
    robustness_summary: dict[str, Any] | None = None



class ChainSummariesResponse(BaseModel):
    """Response for chain summaries query."""

    predictions: list[ChainSummary]
    total: int
    generated_at: str



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
    scores: Any | None = None
    best_params: Any | None = None
    branch_path: Any | None = None
    source_index: int | None = None
    source_name: str | None = None
    target_index: int | None = None
    target_name: str | None = None
    result_metadata: Any | None = None


class ChainDetailResponse(BaseModel):
    """Response for chain detail with predictions."""

    chain_id: str
    summary: ChainSummary | None = None
    predictions: list[PartitionPrediction]
    pipeline: dict[str, Any] | None = None


class ChainPipelineReloadMetadata(BaseModel):
    """Metadata describing how a chain snapshot was reconstructed for reload."""

    source: Literal["chain_snapshot"]
    selection_scope: Literal["preprocessing_chain_plus_selected_model"]
    is_editable_template: bool


class ChainPipelineStepsResponse(BaseModel):
    """Response for reloading a stored chain snapshot into the editor."""

    chain_id: str
    name: str
    pipeline: list[Any]
    reload: ChainPipelineReloadMetadata


class RunPipelineReloadMetadata(BaseModel):
    """Metadata describing how a run pipeline was reconstructed for reload."""

    source: Literal["authoring_template", "expanded_snapshot"]
    is_editable_template: bool
    is_legacy_fallback: bool


class RunPipelineStepsResponse(BaseModel):
    """Response for reloading a stored run pipeline into the editor."""

    pipeline_id: str
    name: str
    pipeline: list[Any]
    reload: RunPipelineReloadMetadata


class PredictionArraysResponse(BaseModel):
    """Response for prediction arrays."""

    prediction_id: str
    y_true: Any | None = None
    y_pred: Any | None = None
    y_proba: list[float] | list[list[float]] | None = None
    sample_indices: list[int] | None = None
    weights: list[float | None] | None = None
    sample_metadata: dict[str, list[Any]] | None = None
    n_samples: int = 0
    branch_path: Any | None = None
    source_index: int | None = None
    source_name: str | None = None
    target_index: int | None = None
    target_name: str | None = None
    result_metadata: Any | None = None


class PredictionRobustnessReportRequest(BaseModel):
    """Request to compute a native robustness report from stored prediction arrays."""

    robustness: RobustnessLaunchPayload = Field(
        default_factory=lambda: RobustnessLaunchPayload(
            mode="clean_frozen",
            scenarios=[{"kind": "observed"}],
        ),
        description="Native audit-only robustness plan. Spectral scenarios require stored X and a saved predictor_bundle/model_path.",
    )
    seed: int | None = Field(default=None, ge=0)
    name: str = Field(default="Studio robustness report")
    robustness_id: str | None = None


class PredictionRobustnessReportResponse(BaseModel):
    """Computed and persisted native robustness report summary."""

    robustness_id: str
    prediction_id: str
    run_id: str | None = None
    pipeline_id: str | None = None
    chain_id: str | None = None
    summary_artifact: dict[str, Any]
    report_fingerprint: str


class PredictionRobustnessEvidenceRequirement(BaseModel):
    """One piece of evidence needed before Studio can run a robustness path."""

    id: str
    label: str
    present: bool
    source: str | None = None
    detail: str | None = None


class PredictionRobustnessEvidenceResponse(BaseModel):
    """Read-only diagnostic for robustness paths available from a stored prediction."""

    prediction_id: str
    run_id: str | None = None
    pipeline_id: str | None = None
    chain_id: str | None = None
    stored_prediction_scenarios: list[str]
    spectral_scenarios: list[str]
    can_compute_stored_prediction_report: bool
    can_compute_spectral_report: bool
    status: str
    requirements: list[PredictionRobustnessEvidenceRequirement]
    blockers: list[str]


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


def _native_results_root(workspace_path: Path) -> Path | None:
    """Return the workspace's native results root iff it holds at least one native run dir."""
    return native_results_root(workspace_path)


def _get_store() -> ResultsRepository:
    """Get the active workspace results repository for read-only queries.

    Raises HTTPException if no workspace is selected or neither a store nor native results exist.
    """
    if not STORE_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library is required for store access",
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    try:
        return resolve_results_repository(
            Path(workspace.path),
            workspace_store_factory=_get_workspace_store_cls(),
        )
    except ResultsRepositoryNotFound as exc:
        raise HTTPException(
            status_code=404,
            detail="No store found in workspace. Run a pipeline first.",
        ) from exc


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


def _merge_missing_prediction_context(target: dict[str, Any], source: dict[str, Any] | None) -> None:
    """Copy prediction/pipeline context into an arrays payload without overriding arrays."""
    if not isinstance(source, dict):
        return
    for key in (
        "run_id",
        "pipeline_id",
        "chain_id",
        "dataset_name",
        "model_name",
        "model_class",
        "partition",
        "fold_id",
        "n_samples",
        "n_features",
        "branch_path",
        "source_index",
        "source_name",
        "target_index",
        "target_name",
        "result_metadata",
        "metadata",
        "runtime_manifest",
        "native_result_refs",
        "artifact_refs",
        "model_path",
        "predictor_bundle",
        "predictor_path",
        "model_bundle",
    ):
        if key not in target and key in source:
            target[key] = source.get(key)


def _load_prediction_arrays_for_robustness(store: Any, prediction_id: str) -> dict[str, Any]:
    arrays = None
    get_arrays = getattr(store, "get_prediction_arrays", None)
    if callable(get_arrays):
        arrays = get_arrays(prediction_id)
    prediction_row = None
    get_prediction = getattr(store, "get_prediction", None)
    if callable(get_prediction):
        try:
            prediction_row = get_prediction(prediction_id, load_arrays=False)
        except Exception:
            prediction_row = None
    if arrays is None:
        if callable(get_prediction):
            arrays = get_prediction(prediction_id, load_arrays=True)
    if not isinstance(arrays, dict):
        raise HTTPException(status_code=404, detail=f"No arrays found for prediction {prediction_id}")

    enriched = dict(arrays)
    _merge_missing_prediction_context(enriched, prediction_row if isinstance(prediction_row, dict) else None)

    chain_id = enriched.get("chain_id")
    if isinstance(chain_id, str) and chain_id:
        get_chain = getattr(store, "get_chain", None)
        if callable(get_chain):
            try:
                chain = get_chain(chain_id)
            except Exception:
                chain = None
            if isinstance(chain, dict):
                _merge_missing_prediction_context(enriched, chain)
                if "fold_artifacts" not in enriched and "fold_artifacts" in chain:
                    enriched["fold_artifacts"] = chain.get("fold_artifacts")

    pipeline_id = enriched.get("pipeline_id")
    if isinstance(pipeline_id, str) and pipeline_id:
        get_pipeline = getattr(store, "get_pipeline", None)
        if callable(get_pipeline):
            try:
                pipeline = get_pipeline(pipeline_id)
            except Exception:
                pipeline = None
            if isinstance(pipeline, dict):
                _merge_missing_prediction_context(enriched, pipeline)

    return sanitize_dict(enriched)


def _coerce_sample_metadata_for_robustness(arrays: dict[str, Any]) -> Any | None:
    sample_metadata = arrays.get("sample_metadata")
    if sample_metadata is not None:
        return sample_metadata
    metadata = arrays.get("metadata")
    return metadata if isinstance(metadata, (dict, list)) else None


def _has_non_empty_evidence(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, dict):
        return bool(value)
    if isinstance(value, (list, tuple, set)):
        return len(value) > 0
    size = getattr(value, "size", None)
    if isinstance(size, int):
        return size > 0
    return True


def _first_present_evidence_key(arrays: dict[str, Any], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        if _has_non_empty_evidence(arrays.get(key)):
            return key
    return None


def _iter_nested_evidence_records(value: Any, prefix: str, *, depth: int = 0) -> list[tuple[str, dict[str, Any]]]:
    """Return nested metadata records that may carry published replay evidence."""
    if depth > 5:
        return []
    records: list[tuple[str, dict[str, Any]]] = []
    if isinstance(value, dict):
        records.append((prefix, value))
        for key, child in value.items():
            child_prefix = f"{prefix}.{key}" if prefix else str(key)
            records.extend(_iter_nested_evidence_records(child, child_prefix, depth=depth + 1))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            child_prefix = f"{prefix}[{index}]"
            records.extend(_iter_nested_evidence_records(child, child_prefix, depth=depth + 1))
    return records


def _find_prediction_evidence_value(
    arrays: dict[str, Any],
    keys: tuple[str, ...],
) -> tuple[str | None, Any | None, str | None]:
    """Find an evidence value from arrays or metadata, preserving a user-facing source path."""
    for key in keys:
        value = arrays.get(key)
        if _has_non_empty_evidence(value):
            return key, value, f"prediction_arrays.{key}"

    for root_key in (
        "result_metadata",
        "metadata",
        "runtime_manifest",
        "manifest",
        "execution_metadata",
        "native_result_refs",
        "artifact_refs",
        "fold_artifacts",
    ):
        root_value = arrays.get(root_key)
        if not _has_non_empty_evidence(root_value):
            continue
        for prefix, record in _iter_nested_evidence_records(root_value, f"prediction_arrays.{root_key}"):
            for key in keys:
                value = record.get(key)
                if _has_non_empty_evidence(value):
                    return key, value, f"{prefix}.{key}"

    return None, None, None


_SPECTRAL_ARRAY_EVIDENCE_KEYS = (
    "X",
    "x",
    "spectra",
    "spectrum",
    "features",
    "X_test",
    "x_test",
    "spectra_test",
)
_PREDICTOR_BUNDLE_EVIDENCE_KEYS = (
    "predictor_bundle",
    "model_bundle",
    "predictor_path",
    "model_path",
    "model_uri",
    "artifact_path",
)
_FROZEN_PREDICTOR_EVIDENCE_KEYS = (
    *_PREDICTOR_BUNDLE_EVIDENCE_KEYS,
    "frozen_predictor",
    "predictor",
    "predictor_artifact",
    "predictor_ref",
    "model_artifact",
    "model_ref",
    "fold_artifacts",
)
_STORED_PREDICTION_ROBUSTNESS_SCENARIOS = [
    "observed",
    "prediction_bias",
    "prediction_noise",
]


def _build_prediction_robustness_evidence(
    arrays: dict[str, Any],
    *,
    prediction_id: str,
) -> PredictionRobustnessEvidenceResponse:
    """Build a fail-closed robustness capability diagnostic for one prediction."""

    has_y_true = _has_non_empty_evidence(arrays.get("y_true"))
    has_y_pred = _has_non_empty_evidence(arrays.get("y_pred"))
    x_key, _x_value, x_source = _find_prediction_evidence_value(arrays, _SPECTRAL_ARRAY_EVIDENCE_KEYS)
    predictor_key, _predictor_value, predictor_source = _find_prediction_evidence_value(arrays, _FROZEN_PREDICTOR_EVIDENCE_KEYS)
    predictor_bundle_key, _predictor_bundle_value, _predictor_bundle_source = _find_prediction_evidence_value(
        arrays,
        _PREDICTOR_BUNDLE_EVIDENCE_KEYS,
    )
    has_x = x_key is not None
    has_frozen_predictor = predictor_key is not None
    has_predictor_bundle = predictor_bundle_key is not None

    requirements = [
        PredictionRobustnessEvidenceRequirement(
            id="y_true",
            label="Stored truth labels",
            present=has_y_true,
            source="prediction_arrays.y_true" if has_y_true else None,
            detail="Required for observed and prediction-space robustness metrics.",
        ),
        PredictionRobustnessEvidenceRequirement(
            id="y_pred",
            label="Stored predictions",
            present=has_y_pred,
            source="prediction_arrays.y_pred" if has_y_pred else None,
            detail="Required for observed, prediction_bias and prediction_noise reports.",
        ),
        PredictionRobustnessEvidenceRequirement(
            id="spectra",
            label="Row-aligned spectra / X matrix",
            present=has_x,
            source=x_source if x_key else None,
            detail="Required before Studio can replay spectral/OOD perturbations.",
        ),
        PredictionRobustnessEvidenceRequirement(
            id="frozen_predictor",
            label="Frozen predictor replay surface",
            present=has_frozen_predictor,
            source=predictor_source if predictor_key else None,
            detail="Required before Studio can score perturbed spectra with the exact stored predictor.",
        ),
    ]

    blockers: list[str] = []
    if not has_y_true:
        blockers.append("Stored y_true is missing; observed and prediction-space robustness reports cannot be computed.")
    if not has_y_pred:
        blockers.append("Stored y_pred is missing; observed and prediction-space robustness reports cannot be computed.")
    if not has_x:
        blockers.append("Spectral/OOD scenarios require a row-aligned X/spectra matrix for the selected prediction.")
    if not has_frozen_predictor:
        blockers.append("Spectral/OOD scenarios require an explicit frozen predictor replay surface.")
    elif not has_predictor_bundle:
        blockers.append("Studio spectral/OOD execution currently supports only saved predictor_bundle/model_path evidence.")

    can_compute_stored_prediction_report = has_y_true and has_y_pred
    can_compute_spectral_report = can_compute_stored_prediction_report and has_x and has_predictor_bundle

    if not can_compute_stored_prediction_report:
        status = "missing_prediction_evidence"
    elif can_compute_spectral_report:
        status = "ready_for_spectral_replay"
    elif blockers:
        status = "ready_for_prediction_space_only"
    else:
        status = "ready_for_stored_prediction_report"

    return PredictionRobustnessEvidenceResponse(
        prediction_id=str(arrays.get("prediction_id") or prediction_id),
        run_id=arrays.get("run_id"),
        pipeline_id=arrays.get("pipeline_id"),
        chain_id=arrays.get("chain_id"),
        stored_prediction_scenarios=list(_STORED_PREDICTION_ROBUSTNESS_SCENARIOS) if can_compute_stored_prediction_report else [],
        spectral_scenarios=sorted(ROBUSTNESS_SPECTRAL_SCENARIO_KINDS),
        can_compute_stored_prediction_report=can_compute_stored_prediction_report,
        can_compute_spectral_report=can_compute_spectral_report,
        status=status,
        requirements=requirements,
        blockers=blockers,
    )


def _compute_prediction_robustness_report(
    *,
    arrays: dict[str, Any],
    robustness_plan: dict[str, Any],
    seed: int | None,
) -> Any:
    import numpy as np

    from .lazy_imports import get_nirs4all_module

    result_api = get_nirs4all_module("nirs4all.api.result")
    robustness_api = get_nirs4all_module("nirs4all.api.robustness")

    if arrays.get("y_true") is None or arrays.get("y_pred") is None:
        raise HTTPException(
            status_code=400,
            detail="Robustness report requires stored y_true and y_pred arrays for this prediction.",
        )

    scenario_kinds = [
        str(scenario.get("kind"))
        for scenario in robustness_plan.get("scenarios", [])
        if isinstance(scenario, dict)
    ]
    spectral = sorted(kind for kind in scenario_kinds if kind in ROBUSTNESS_SPECTRAL_SCENARIO_KINDS)
    x_key, x_matrix, _x_source = _find_prediction_evidence_value(arrays, _SPECTRAL_ARRAY_EVIDENCE_KEYS)
    predictor_bundle_key, predictor_bundle, _predictor_bundle_source = _find_prediction_evidence_value(
        arrays,
        _PREDICTOR_BUNDLE_EVIDENCE_KEYS,
    )
    if spectral:
        if x_matrix is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Spectral scenarios require explicit X/spectra arrays on the stored prediction "
                    f"({', '.join(spectral)})."
                ),
            )
        if predictor_bundle is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Spectral scenarios require a saved predictor_bundle/model_path on the stored prediction "
                    f"({', '.join(spectral)})."
                ),
            )
        if not isinstance(predictor_bundle, (str, Path)):
            raise HTTPException(
                status_code=400,
                detail="Stored prediction spectral robustness currently supports only path-like predictor_bundle/model_path evidence.",
            )

    sample_indices = arrays.get("sample_indices")
    result = result_api.PredictResult(
        y_pred=np.asarray(arrays["y_pred"], dtype=float),
        metadata={"sample_metadata": _coerce_sample_metadata_for_robustness(arrays)},
        sample_indices=np.asarray(sample_indices) if sample_indices is not None else None,
        model_name=str(arrays.get("model_name") or ""),
    )
    try:
        return robustness_api.robustness(
            result,
            y_true=arrays["y_true"],
            mode=robustness_plan.get("mode", "clean_frozen"),
            scenarios=robustness_plan.get("scenarios"),
            slice_by=robustness_plan.get("slice_by"),
            seed=seed,
            X=x_matrix if spectral else None,
            predictor_bundle=predictor_bundle if spectral else None,
        )
    except (TypeError, ValueError, NotImplementedError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _save_workspace_robustness_report(
    *,
    workspace_path: Path,
    report: Any,
    request: PredictionRobustnessReportRequest,
    robustness_plan: dict[str, Any],
    arrays: dict[str, Any],
    prediction_id: str,
) -> str:
    from .lazy_imports import get_nirs4all_module

    robustness_api = get_nirs4all_module("nirs4all.api.robustness")

    metadata = sanitize_dict({
        "source": "nirs4all-studio",
        "source_endpoint": "aggregated-predictions.robustness-report",
        "prediction_id": prediction_id,
        "requested_robustness": robustness_plan,
        "requested_seed": request.seed,
        "requested_scenario_kinds": [
            scenario.get("kind")
            for scenario in robustness_plan.get("scenarios", [])
            if isinstance(scenario, dict)
        ],
        "stored_prediction_context": {
            "run_id": arrays.get("run_id"),
            "pipeline_id": arrays.get("pipeline_id"),
            "chain_id": arrays.get("chain_id"),
            "dataset_name": arrays.get("dataset_name"),
            "model_name": arrays.get("model_name"),
            "model_class": arrays.get("model_class"),
            "partition": arrays.get("partition"),
            "fold_id": arrays.get("fold_id"),
            "n_samples": arrays.get("n_samples"),
            "sample_indices_present": arrays.get("sample_indices") is not None,
            "sample_metadata_present": _coerce_sample_metadata_for_robustness(arrays) is not None,
        },
    })

    return robustness_api.save_workspace_robustness_report(
        workspace_path,
        report,
        name=request.name,
        robustness_id=request.robustness_id,
        metadata=metadata,
        run_id=arrays.get("run_id"),
        pipeline_id=arrays.get("pipeline_id"),
        chain_id=arrays.get("chain_id"),
        prediction_id=prediction_id,
    )


def _normalize_prediction_robustness_request(request: PredictionRobustnessReportRequest) -> dict[str, Any]:
    try:
        robustness_plan = normalize_robustness_launch_payload(request.robustness)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if robustness_plan is None:
        raise HTTPException(status_code=400, detail="robustness plan is required")

    return robustness_plan


def _load_workspace_robustness_report(workspace_path: Path, robustness_id: str) -> Any:
    from .lazy_imports import get_nirs4all_module

    robustness_api = get_nirs4all_module("nirs4all.api.robustness")

    try:
        return robustness_api.load_workspace_robustness_report(workspace_path, robustness_id)
    except (FileNotFoundError, KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=404, detail=f"Robustness report not found: {robustness_id}") from exc


def _safe_export_stem(value: str, *, fallback: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "-", value.strip()).strip(".-")
    return stem or fallback


def _robustness_report_export_response(
    *,
    robustness_id: str,
    report: Any,
    export_format: Literal["json", "markdown", "html"],
) -> Response:
    if export_format == "json":
        body = report.to_json(indent=2)
        media_type = "application/json"
        extension = "json"
    elif export_format == "markdown":
        body = report.to_markdown()
        media_type = "text/markdown; charset=utf-8"
        extension = "md"
    elif export_format == "html":
        body = report.to_html()
        media_type = "text/html; charset=utf-8"
        extension = "html"
    else:
        raise HTTPException(status_code=400, detail="format must be one of: json, markdown, html")

    filename = f"{_safe_export_stem(robustness_id, fallback='robustness-report')}.{extension}"
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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


def _robustness_summary_artifact_ref(payload: dict[str, Any], summary: dict[str, Any]) -> dict[str, Any]:
    robustness_id = str(payload.get("robustness_id") or payload.get("result_fingerprint") or "robustness")
    summary_artifact = payload.get("summary_artifact") if isinstance(payload.get("summary_artifact"), dict) else {}
    fingerprint = payload.get("result_fingerprint") or summary_artifact.get("fingerprint")
    chain_id = summary.get("chain_id")
    label_name = payload.get("name")
    label = str(label_name) if isinstance(label_name, str) and label_name else "Robustness summary"
    metadata = {
        "source": "workspace_robustness_results",
        "robustness_id": robustness_id,
        "conformal_id": payload.get("conformal_id"),
        "prediction_id": payload.get("prediction_id"),
        "mode": payload.get("mode"),
        "scenario_count": payload.get("scenario_count"),
        "slice_by": payload.get("slice_by"),
        "created_at": payload.get("created_at"),
        "robustness_summary_artifact": summary_artifact,
    }
    audit_metadata = payload.get("metadata")
    if isinstance(audit_metadata, dict):
        metadata["audit_metadata"] = audit_metadata

    return {
        "id": f"robustness-summary:{chain_id}:{robustness_id}",
        "kind": "repository_entry",
        "role": "robustness-summary",
        "label": label,
        "source": "result-repository",
        "scope": "chain",
        "status": "available",
        "artifactId": robustness_id,
        "runId": payload.get("run_id") or summary.get("run_id"),
        "pipelineId": payload.get("pipeline_id") or summary.get("pipeline_id"),
        "chainId": payload.get("chain_id") or chain_id,
        "format": "json",
        "contentAddress": fingerprint,
        "metadata": metadata,
    }


def _tuning_summary_artifact_ref(payload: dict[str, Any], summary: dict[str, Any]) -> dict[str, Any]:
    tuning_id = str(payload.get("tuning_id") or payload.get("result_fingerprint") or "tuning")
    summary_artifact = payload.get("summary_artifact") if isinstance(payload.get("summary_artifact"), dict) else {}
    fingerprint = payload.get("result_fingerprint") or summary_artifact.get("fingerprint")
    chain_id = summary.get("chain_id")
    label_name = payload.get("name")
    label = str(label_name) if isinstance(label_name, str) and label_name else "Tuning summary"
    metadata = {
        "source": "workspace_tuning_results",
        "tuning_id": tuning_id,
        "tuning_fingerprint": payload.get("tuning_fingerprint"),
        "engine": payload.get("engine"),
        "metric": payload.get("metric"),
        "direction": payload.get("direction"),
        "best_value": payload.get("best_value"),
        "n_trials": payload.get("n_trials"),
        "created_at": payload.get("created_at"),
        "tuning_summary_artifact": summary_artifact,
    }
    tuning_metadata = payload.get("metadata")
    if isinstance(tuning_metadata, dict):
        metadata["tuning_metadata"] = tuning_metadata

    return {
        "id": f"tuning-summary:{chain_id}:{tuning_id}",
        "kind": "repository_entry",
        "role": "tuning-summary",
        "label": label,
        "source": "result-repository",
        "scope": "chain",
        "status": "available",
        "artifactId": tuning_id,
        "runId": payload.get("run_id") or summary.get("run_id"),
        "pipelineId": payload.get("pipeline_id") or summary.get("pipeline_id"),
        "chainId": payload.get("chain_id") or chain_id,
        "format": "nirs4all.tuning.summary",
        "contentAddress": fingerprint,
        "metadata": metadata,
    }


def _list_robustness_rows(store: Any) -> list[dict[str, Any]]:
    list_results = getattr(store, "list_robustness_results", None)
    if not callable(list_results):
        return []

    try:
        return [sanitize_dict(row) for row in _dataframe_rows(list_results(limit=200, offset=0))]
    except Exception:
        return []


def _list_tuning_rows(store: Any) -> list[dict[str, Any]]:
    list_results = getattr(store, "list_tuning_results", None)
    if not callable(list_results):
        return []

    try:
        return [sanitize_dict(row) for row in _dataframe_rows(list_results(limit=200, offset=0))]
    except Exception:
        return []


def _matching_robustness_rows_from_rows(
    store: Any,
    summary: dict[str, Any],
    rows: list[dict[str, Any]],
    summary_cache: dict[str, dict[str, Any] | None] | None = None,
) -> list[dict[str, Any]]:
    load_result = getattr(store, "load_robustness_result", None)
    if not callable(load_result):
        return []

    run_id = summary.get("run_id")
    pipeline_id = summary.get("pipeline_id")
    chain_id = summary.get("chain_id")
    summary_cache = summary_cache if summary_cache is not None else {}
    matches: list[dict[str, Any]] = []
    for row in rows:
        row_chain_id = row.get("chain_id")
        row_pipeline_id = row.get("pipeline_id")
        row_run_id = row.get("run_id")
        if row_chain_id not in (None, chain_id):
            continue
        if row_pipeline_id not in (None, pipeline_id):
            continue
        if row_run_id not in (None, run_id):
            continue

        robustness_id = row.get("robustness_id") or row.get("result_fingerprint")
        if not isinstance(robustness_id, str) or not robustness_id:
            continue
        if robustness_id not in summary_cache:
            try:
                report = load_result(robustness_id)
                summary_artifact = report.summary_artifact()
            except Exception:
                summary_cache[robustness_id] = None
            else:
                summary_cache[robustness_id] = (
                    sanitize_dict(summary_artifact)
                    if isinstance(summary_artifact, dict)
                    else None
                )
        summary_artifact = summary_cache.get(robustness_id)
        if not isinstance(summary_artifact, dict) or summary_artifact.get("format") != "nirs4all.robustness.summary":
            continue

        matches.append({
            "robustness_id": robustness_id,
            "name": row.get("name") or "",
            "run_id": row_run_id,
            "pipeline_id": row_pipeline_id,
            "chain_id": row_chain_id,
            "conformal_id": row.get("conformal_id"),
            "prediction_id": row.get("prediction_id"),
            "result_fingerprint": row.get("result_fingerprint") or summary_artifact.get("fingerprint"),
            "mode": row.get("mode") or summary_artifact.get("mode"),
            "scenario_count": row.get("scenario_count"),
            "slice_by": _parse_json_maybe(row.get("slice_by")),
            "created_at": row.get("created_at"),
            "metadata": _parse_json_maybe(row.get("metadata")),
            "summary_artifact": summary_artifact,
        })
    return matches


def _matching_tuning_rows_from_rows(
    store: Any,
    summary: dict[str, Any],
    rows: list[dict[str, Any]],
    summary_cache: dict[str, dict[str, Any] | None] | None = None,
) -> list[dict[str, Any]]:
    load_result = getattr(store, "load_tuning_result", None)
    if not callable(load_result):
        return []

    run_id = summary.get("run_id")
    pipeline_id = summary.get("pipeline_id")
    chain_id = summary.get("chain_id")
    summary_cache = summary_cache if summary_cache is not None else {}
    matches: list[dict[str, Any]] = []
    for row in rows:
        row_chain_id = row.get("chain_id")
        row_pipeline_id = row.get("pipeline_id")
        row_run_id = row.get("run_id")
        if row_chain_id not in (None, chain_id):
            continue
        if row_pipeline_id not in (None, pipeline_id):
            continue
        if row_run_id not in (None, run_id):
            continue

        tuning_id = row.get("tuning_id") or row.get("result_fingerprint")
        if not isinstance(tuning_id, str) or not tuning_id:
            continue
        if tuning_id not in summary_cache:
            try:
                result = load_result(tuning_id)
                summary_artifact = result.summary_artifact()
            except Exception:
                summary_cache[tuning_id] = None
            else:
                summary_cache[tuning_id] = (
                    sanitize_dict(summary_artifact)
                    if isinstance(summary_artifact, dict)
                    else None
                )
        summary_artifact = summary_cache.get(tuning_id)
        if not isinstance(summary_artifact, dict) or summary_artifact.get("format") != "nirs4all.tuning.summary":
            continue

        matches.append({
            "tuning_id": tuning_id,
            "name": row.get("name") or "",
            "run_id": row_run_id,
            "pipeline_id": row_pipeline_id,
            "chain_id": row_chain_id,
            "result_fingerprint": row.get("result_fingerprint") or summary_artifact.get("fingerprint"),
            "tuning_fingerprint": row.get("tuning_fingerprint"),
            "engine": row.get("engine") or summary_artifact.get("engine"),
            "metric": row.get("metric") or summary_artifact.get("metric"),
            "direction": row.get("direction") or summary_artifact.get("direction"),
            "best_value": row.get("best_value") if row.get("best_value") is not None else summary_artifact.get("best_value"),
            "n_trials": row.get("n_trials") if row.get("n_trials") is not None else summary_artifact.get("n_trials"),
            "created_at": row.get("created_at"),
            "metadata": _parse_json_maybe(row.get("metadata")),
            "summary_artifact": summary_artifact,
        })
    return matches


def _attach_robustness_matches_to_summary(summary: dict[str, Any], matches: list[dict[str, Any]]) -> None:
    if not matches:
        return

    refs = list(summary.get("artifact_refs") or [])
    seen = {ref.get("id") for ref in refs if isinstance(ref, dict)}
    for match in matches:
        ref = _robustness_summary_artifact_ref(match, summary)
        if ref["id"] not in seen:
            refs.append(ref)
            seen.add(ref["id"])
        if summary.get("robustness_summary") is None and isinstance(match.get("summary_artifact"), dict):
            summary["robustness_summary"] = match["summary_artifact"]
    summary["artifact_refs"] = refs


def _attach_tuning_matches_to_summary(summary: dict[str, Any], matches: list[dict[str, Any]]) -> None:
    if not matches:
        return

    refs = list(summary.get("artifact_refs") or [])
    seen = {ref.get("id") for ref in refs if isinstance(ref, dict)}
    for match in matches:
        ref = _tuning_summary_artifact_ref(match, summary)
        if ref["id"] not in seen:
            refs.append(ref)
            seen.add(ref["id"])
    summary["artifact_refs"] = refs


def _matching_robustness_rows(store: Any, summary: dict[str, Any]) -> list[dict[str, Any]]:
    return _matching_robustness_rows_from_rows(store, summary, _list_robustness_rows(store))


def _matching_tuning_rows(store: Any, summary: dict[str, Any]) -> list[dict[str, Any]]:
    return _matching_tuning_rows_from_rows(store, summary, _list_tuning_rows(store))


def _enrich_with_robustness_summary_artifacts(summary: dict[str, Any], store: Any) -> None:
    _attach_robustness_matches_to_summary(summary, _matching_robustness_rows(store, summary))


def _enrich_with_tuning_summary_artifacts(summary: dict[str, Any], store: Any) -> None:
    _attach_tuning_matches_to_summary(summary, _matching_tuning_rows(store, summary))


def _enrich_many_with_robustness_summary_artifacts(summaries: list[dict[str, Any]], store: Any) -> None:
    rows = _list_robustness_rows(store)
    if not rows:
        return
    summary_cache: dict[str, dict[str, Any] | None] = {}
    for summary in summaries:
        matches = _matching_robustness_rows_from_rows(store, summary, rows, summary_cache)
        _attach_robustness_matches_to_summary(summary, matches)


def _enrich_many_with_tuning_summary_artifacts(summaries: list[dict[str, Any]], store: Any) -> None:
    rows = _list_tuning_rows(store)
    if not rows:
        return
    summary_cache: dict[str, dict[str, Any] | None] = {}
    for summary in summaries:
        matches = _matching_tuning_rows_from_rows(store, summary, rows, summary_cache)
        _attach_tuning_matches_to_summary(summary, matches)


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


def _load_chain_prediction_records(
    store: Any,
    chain_id: str,
    *,
    cv_source_chain_id: str | None = None,
    partition: str | None = None,
    fold_id: str | None = None,
) -> list[dict[str, Any]]:
    """Load prediction rows for a chain, including its CV source when present."""
    chain_ids = [chain_id]
    if cv_source_chain_id and cv_source_chain_id != chain_id:
        chain_ids.append(cv_source_chain_id)

    records: list[dict[str, Any]] = []
    seen_prediction_ids: set[str] = set()
    for current_chain_id in chain_ids:
        pred_df = store.get_chain_predictions(
            current_chain_id,
            partition=partition,
            fold_id=fold_id,
        )
        for row in pred_df.iter_rows(named=True):
            prediction = dict(row)
            prediction_id = str(prediction.get("prediction_id") or "")
            if prediction_id and prediction_id in seen_prediction_ids:
                continue
            if prediction_id:
                seen_prediction_ids.add(prediction_id)
            scores = _parse_json_maybe(prediction.get("scores"))
            if isinstance(scores, dict):
                prediction["scores"] = scores
            best_params = _parse_json_maybe(prediction.get("best_params"))
            if isinstance(best_params, dict):
                prediction["best_params"] = best_params
            records.append(sanitize_dict(prediction))
    return records


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
        if (key in {"class", "function"} or key in {"model", "y_processing"}) and isinstance(value, str):
            normalized[key] = _normalize_chain_reference(value)
        else:
            normalized[key] = _normalize_chain_payload(value)
    return normalized


def _merge_summary_variant_params(existing: Any, step_params: Any) -> dict[str, Any] | None:
    """Merge repository-provided variant params with pipeline step params without losing result metadata."""
    existing_params = _parse_json_maybe(existing)
    merged: dict[str, Any] = {}
    existing_result_metadata = None
    if isinstance(existing_params, dict):
        merged.update(existing_params)
        existing_result_metadata = existing_params.get("result_metadata")
    if isinstance(step_params, dict):
        merged.update(step_params)
    if existing_result_metadata is not None:
        merged["result_metadata"] = existing_result_metadata
    return merged or None


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


def _extract_stored_pipeline_steps(stored_pipeline: Any) -> list[Any]:
    expanded_config = _parse_json_maybe(stored_pipeline)

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

    return sanitize_dict({"pipeline": cleaned_steps})["pipeline"]


def _extract_expanded_pipeline_steps(pipeline: dict[str, Any]) -> list[Any]:
    return _extract_stored_pipeline_steps(pipeline.get("expanded_config"))


def _build_run_pipeline_steps_response(pipeline: dict[str, Any]) -> RunPipelineStepsResponse:
    original_template = pipeline.get("original_template")
    if original_template is not None:
        steps = _extract_stored_pipeline_steps(original_template)
        reload_metadata = RunPipelineReloadMetadata(
            source="authoring_template",
            is_editable_template=True,
            is_legacy_fallback=False,
        )
    else:
        steps = _extract_expanded_pipeline_steps(pipeline)
        reload_metadata = RunPipelineReloadMetadata(
            source="expanded_snapshot",
            is_editable_template=False,
            is_legacy_fallback=True,
        )

    return RunPipelineStepsResponse(
        pipeline_id=pipeline["pipeline_id"],
        name=pipeline.get("name") or pipeline["pipeline_id"],
        pipeline=steps,
        reload=reload_metadata,
    )


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

    def _load() -> ChainSummariesResponse:
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
            records = [sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]
            _mark_refit_only_entries_inplace(records)
            _enrich_with_fold_artifacts(records, store)
            _enrich_many_with_robustness_summary_artifacts(records, store)
            _enrich_many_with_tuning_summary_artifacts(records, store)
            for record in records:
                _apply_synthetic_refit_fallback_inplace(record)
            return ChainSummariesResponse(
                predictions=records,
                total=len(records),
                generated_at=datetime.now(UTC).isoformat(),
            )
        finally:
            store.close()

    # SQLite + polars work happens off the event loop (PERF-06)
    return await asyncio.to_thread(_load)


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
    def _load() -> dict[str, Any]:
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
            records = [sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]
            _mark_refit_only_entries_inplace(records)
            _enrich_with_fold_artifacts(records, store)
            _enrich_many_with_robustness_summary_artifacts(records, store)
            _enrich_many_with_tuning_summary_artifacts(records, store)
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

    # SQLite + polars work happens off the event loop (PERF-06)
    return await asyncio.to_thread(_load)


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
    def _load() -> ChainDetailResponse:
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
                summary = sanitize_dict(dict(agg_df.row(0, named=True)))
                _mark_refit_only_entries_inplace([summary])
                _enrich_with_fold_artifacts([summary], store)
                _enrich_with_robustness_summary_artifacts(summary, store)
                _enrich_with_tuning_summary_artifacts(summary, store)
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
                summary["variant_params"] = _merge_summary_variant_params(
                    summary.get("variant_params"),
                    step_params,
                )

            # Get individual prediction rows, including the source CV folds
            # for refit chains that store only the final prediction rows.
            predictions = _load_chain_prediction_records(
                store,
                chain_id,
                cv_source_chain_id=summary.get("cv_source_chain_id") if summary else None,
            )

            if not predictions and summary is None:
                raise HTTPException(status_code=404, detail=f"Chain {chain_id} not found or has no predictions")

            # Get pipeline metadata (generator_choices)
            pipeline_info = None
            if summary and summary.get("pipeline_id"):
                pipeline = store.get_pipeline(summary["pipeline_id"])
                if pipeline:
                    pipeline_info = sanitize_dict({
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

    # SQLite + polars work happens off the event loop (PERF-06)
    return await asyncio.to_thread(_load)


@router.get("/chain/{chain_id}/pipeline-steps", response_model=ChainPipelineStepsResponse)
async def get_chain_pipeline_steps(chain_id: str):
    """Return the nirs4all-canonical chain snapshot for a specific chain.

    Converts the chain's stored steps (operator_class + params) into the
    nirs4all canonical format (``{"class": ...}`` / ``{"model": ...}``)
    understood by the frontend ``importFromNirs4all`` converter.

    The response is intentionally a chain snapshot, not the original
    authoring template. Other model steps from the same pipeline are
    excluded so the editor shows only the preprocessing chain plus the
    selected model for this chain.
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

        reload_metadata = ChainPipelineReloadMetadata(
            source="chain_snapshot",
            selection_scope="preprocessing_chain_plus_selected_model",
            is_editable_template=False,
        )

        return ChainPipelineStepsResponse(
            chain_id=chain_id,
            name=name,
            pipeline=canonical_steps,
            reload=reload_metadata,
        )
    finally:
        store.close()


@router.get("/pipeline/{pipeline_id}/pipeline-steps", response_model=RunPipelineStepsResponse)
async def get_run_pipeline_steps(pipeline_id: str):
    """Return the stored run reload payload for a pipeline.

    New rows prefer the persisted ``original_template`` so the editor reopens
    the original authoring template. Legacy rows fall back to the cleaned
    executed snapshot and mark that downgrade in the response metadata.
    """
    store = _get_store()
    try:
        pipeline = store.get_pipeline(pipeline_id)
        if pipeline is None:
            raise HTTPException(status_code=404, detail=f"Pipeline {pipeline_id} not found")

        return _build_run_pipeline_steps_response(pipeline)
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
        summary_df = store.query_chain_summaries(chain_id=chain_id)
        summary = dict(summary_df.row(0, named=True)) if len(summary_df) > 0 else None
        records = _load_chain_prediction_records(
            store,
            chain_id,
            cv_source_chain_id=summary.get("cv_source_chain_id") if summary else None,
            partition=partition,
            fold_id=fold_id,
        )
        return {
            "chain_id": chain_id,
            "predictions": records,
            "total": len(records),
            "partition": partition,
            "fold_id": fold_id,
        }
    finally:
        store.close()


@router.post("/{prediction_id}/robustness-report", response_model=PredictionRobustnessReportResponse)
async def compute_prediction_robustness_report(
    prediction_id: str,
    request: PredictionRobustnessReportRequest,
):
    """Compute and persist a native audit-only robustness report for one stored prediction.

    The endpoint only consumes already materialized ``y_true``/``y_pred`` arrays.
    It does not replay spectra, refit, recalibrate, or synthesize missing truth.
    """

    robustness_plan = _normalize_prediction_robustness_request(request)

    def _load() -> PredictionRobustnessReportResponse:
        workspace_path = _get_workspace_path()
        store = _get_store()
        try:
            arrays = _load_prediction_arrays_for_robustness(store, prediction_id)
            report = _compute_prediction_robustness_report(
                arrays=arrays,
                robustness_plan=robustness_plan,
                seed=request.seed,
            )
            robustness_id = _save_workspace_robustness_report(
                workspace_path=workspace_path,
                report=report,
                request=request,
                robustness_plan=robustness_plan,
                arrays=arrays,
                prediction_id=prediction_id,
            )
            summary_artifact = report.summary_artifact()
            return PredictionRobustnessReportResponse(
                robustness_id=robustness_id,
                prediction_id=prediction_id,
                run_id=arrays.get("run_id"),
                pipeline_id=arrays.get("pipeline_id"),
                chain_id=arrays.get("chain_id"),
                summary_artifact=summary_artifact,
                report_fingerprint=str(summary_artifact.get("fingerprint") or report.fingerprint),
            )
        finally:
            store.close()

    return await asyncio.to_thread(_load)


@router.get("/{prediction_id}/robustness-evidence", response_model=PredictionRobustnessEvidenceResponse)
async def get_prediction_robustness_evidence(prediction_id: str):
    """Return fail-closed evidence for robustness paths available from one stored prediction."""

    def _load() -> PredictionRobustnessEvidenceResponse:
        store = _get_store()
        try:
            arrays = _load_prediction_arrays_for_robustness(store, prediction_id)
            return _build_prediction_robustness_evidence(arrays, prediction_id=prediction_id)
        finally:
            store.close()

    return await asyncio.to_thread(_load)


@router.get("/robustness-reports/{robustness_id}/export")
async def export_workspace_robustness_report(
    robustness_id: str,
    format: Literal["json", "markdown", "html"] = Query(
        default="json",
        description="Export format for the verified nirs4all RobustnessReport.",
    ),
):
    """Republish a persisted native robustness report without recomputing it."""

    def _load() -> Response:
        workspace_path = _get_workspace_path()
        report = _load_workspace_robustness_report(workspace_path, robustness_id)
        return _robustness_report_export_response(
            robustness_id=robustness_id,
            report=report,
            export_format=format,
        )

    return await asyncio.to_thread(_load)


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
                        converted = sanitize_float(converted)
                    sanitized.append(converted)
                return sanitized
            if isinstance(value, float):
                return sanitize_float(value)
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
        for key in (
            "branch_path",
            "source_index",
            "source_name",
            "target_index",
            "target_name",
            "result_metadata",
        ):
            if key in arrays:
                result[key] = _to_list(arrays.get(key))

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
