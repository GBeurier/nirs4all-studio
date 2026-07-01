"""
Runs API endpoints for nirs4all webapp.
Phase 8: Runs Management (Run A Implementation)

This module provides endpoints for managing experiment runs:
- List all runs
- Get run details
- Create new run (experiment) with persistence
- Real-time progress via WebSocket (dispatched by JobManager)
- Stop running experiments
- Retry failed runs
- Delete runs
- Quick run endpoint for single pipeline execution

Execution runs on the shared JobManager thread pool (api/jobs/manager.py) — the
same engine used by pipelines.py, training.py, automl.py and shap.py. Each run is
one TRAINING job whose id IS the run id, so WebSocket subscribers keyed by run id
receive the JobManager lifecycle notifications directly.
"""

import json
import logging
import math
import shutil
import sys
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, cast

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .execution_driver import ExecutionBackend, ExecutionJobCommandResult, ExecutionRequest, get_execution_driver, list_execution_driver_capabilities
from .execution_job_records import ExecutionJobRecord, WorkspaceExecutionJobRecordRepository
from .jobs.manager import Job, job_manager
from .pipeline_canonical import (
    contains_generators,
    count_runtime_variants,
    editor_steps_to_runtime_canonical,
)
from .results_repository import NATIVE_RESULTS_DIRNAME
from .run_execution_plan import build_campaign_run_group_execution_plan, build_legacy_run_execution_plan, build_retry_run_execution_plan
from .run_store_repository import RunStoreRepository
from .runtime_engine import fallback_policy_record, resolve_engine, rt_error_envelope_from_exception
from .runtime_errors import RtError
from .shared.json_safe import sanitize_float
from .shared.logger import get_logger
from .shared.runtime_grouping import (
    normalize_split_group_by_mapping,
    prepare_pipeline_steps_with_runtime_grouping,
)
from .workspace_manager import workspace_manager

logger = get_logger(__name__)

def _sanitize_metrics(metrics: dict) -> dict:
    """Sanitize all float values in a metrics dict for JSON serialization."""
    return {k: sanitize_float(v) if isinstance(v, (int, float)) else v for k, v in metrics.items()}


def _invalidate_workspace_results_after_run(run: Any) -> None:
    """Drop workspace discovery/results caches after a run mutates the store."""
    workspace_path = getattr(run, "workspace_path", None)
    if not workspace_path:
        return
    try:
        from .workspace._shared import invalidate_workspace_cache

        invalidate_workspace_cache(str(workspace_path))
    except Exception as exc:
        logger.debug("Failed to invalidate workspace caches after run %s: %s", getattr(run, "id", None), exc)


def _count_tested_pipeline_variants(result: Any, fallback: int = 1) -> int:
    """Count actual CV pipeline variants rather than prediction rows."""
    safe_fallback = max(int(fallback or 1), 1)
    predictions = getattr(result, "predictions", None)
    if predictions is None:
        return safe_fallback

    try:
        entries = predictions.filter_predictions(load_arrays=False)
    except TypeError:
        try:
            entries = predictions.filter_predictions()
        except Exception:
            return safe_fallback
    except Exception:
        return safe_fallback

    if not entries:
        return safe_fallback

    variant_ids: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue

        fold_id = str(entry.get("fold_id") or "").lower()
        if fold_id.startswith("final"):
            continue
        if entry.get("refit_context") is not None:
            continue

        variant_id = (
            entry.get("pipeline_id")
            or entry.get("pipeline_uid")
            or entry.get("config_path")
            or entry.get("config_name")
        )
        if variant_id:
            variant_ids.add(str(variant_id))

    return len(variant_ids) if variant_ids else safe_fallback

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

router = APIRouter(prefix="/runs", tags=["runs"])


# ============================================================================
# Pydantic Models
# ============================================================================

class RunMetrics(BaseModel):
    """Metrics for a completed pipeline run."""
    r2: float | None = None
    rmse: float | None = None
    mae: float | None = None
    rpd: float | None = None
    nrmse: float | None = None
    score: float | None = None
    score_metric: str | None = None


class PipelineRun(BaseModel):
    """Status of a single pipeline within a run."""
    id: str
    pipeline_id: str
    pipeline_name: str
    model: str
    preprocessing: str
    split_strategy: str
    status: Literal["queued", "running", "completed", "failed"]
    progress: int = 0
    metrics: RunMetrics | None = None
    # ML engine that actually produced this pipeline's result (incl. transparent
    # dag-ml->legacy fallback), the requested engine, and RtError fallback
    # diagnostics (B-017 V1 / B-018). Orthogonal to the run's execution_backend.
    engine: str | None = None
    engine_requested: str | None = None
    engine_diagnostics: list[dict[str, Any]] | None = None
    runtime_source: str | None = None
    runtime_manifest: dict[str, Any] | None = None
    fallback_policy: dict[str, Any] | None = None
    native_result_refs: list[dict[str, Any]] | None = None
    config: dict | None = None
    logs: list[str] | None = None
    started_at: str | None = None
    completed_at: str | None = None
    error_message: str | None = None
    model_path: str | None = None  # Path to saved model
    # Variant tracking for sweeps/branches
    variant_index: int | None = None  # Index of this variant (0-based)
    variant_description: str | None = None  # Human-readable description (e.g., "n_components=10 | StandardScaler")
    variant_choices: dict | None = None  # Raw choices for this variant
    estimated_variants: int | None = 1  # Number of pipeline variants to test
    tested_variants: int | None = None  # Actual variants tested after completion
    has_generators: bool | None = False  # Whether pipeline has sweeps/branches
    is_expanded_variant: bool | None = False  # True if this is an expanded variant
    # Model count breakdown (folds × branches × variants)
    fold_count: int | None = None  # Number of CV folds
    branch_count: int | None = None  # Number of pipeline branches
    total_model_count: int | None = None  # Total models: folds × branches × variants
    model_count_breakdown: str | None = None  # Human-readable: "5 folds × 3 branches = 15 models"
    # Granular progress tracking
    current_fold: int | None = None  # Current fold being trained (1-based)
    current_branch: str | None = None  # Current branch name
    current_variant: int | None = None  # Current variant index (1-based)
    fold_metrics: dict[int, RunMetrics] | None = None  # Per-fold metrics


class DatasetRun(BaseModel):
    """Status of all pipelines for a single dataset."""
    dataset_id: str
    dataset_name: str
    split_group_by: str | None = None
    pipelines: list[PipelineRun]


class Run(BaseModel):
    """Complete run (experiment) information."""
    id: str
    name: str
    description: str | None = None
    execution_backend: ExecutionBackend = "local-python"
    # Requested ML engine for the experiment (None = library default "legacy").
    # The engine that actually ran is recorded per-pipeline on PipelineRun.engine.
    engine: str | None = None
    allow_fallback: bool = True
    datasets: list[DatasetRun]
    status: Literal["queued", "running", "completed", "failed"]
    created_at: str
    started_at: str | None = None
    completed_at: str | None = None
    duration: str | None = None
    created_by: str | None = None
    cv_folds: int | None = None
    total_pipelines: int | None = None
    completed_pipelines: int | None = None
    workspace_path: str | None = None  # For persistence
    store_run_id: str | None = None  # WorkspaceStore run UUID
    project_id: str | None = None  # Project grouping
    execution_metadata: dict[str, Any] | None = Field(default=None, exclude=True)


class InlinePipeline(BaseModel):
    """Inline pipeline definition for unsaved pipelines from editor."""
    name: str
    steps: list[dict[str, Any]]


class ExperimentConfig(BaseModel):
    """Configuration for creating a new experiment."""
    name: str = Field(..., min_length=1)
    description: str | None = None
    dataset_ids: list[str] = Field(..., min_length=1)
    pipeline_ids: list[str] = Field(default_factory=list)  # Can be empty if inline_pipeline is provided
    execution_backend: ExecutionBackend = "local-python"
    engine: str | None = Field(None, description="ML engine selector: 'legacy' (default) or 'dag-ml'")
    allow_fallback: bool = Field(True, description="Allow dag-ml to fall back to legacy when structured RtError says it cannot run.")
    cv_folds: int = Field(default=5, ge=2, le=50)
    cv_strategy: Literal["kfold", "stratified", "loo", "holdout"] = "kfold"
    test_size: float | None = Field(default=0.2, ge=0.1, le=0.5)
    shuffle: bool = True
    random_state: int | None = None
    inline_pipeline: InlinePipeline | None = None  # Unsaved pipeline from editor
    inline_pipelines: list[InlinePipeline] = Field(default_factory=list)
    project_id: str | None = None  # Project grouping
    split_group_by_by_dataset: dict[str, str | None] = Field(default_factory=dict)


class QuickRunRequest(BaseModel):
    """Request for quick single-pipeline run (Run A)."""
    pipeline_id: str = Field(..., description="ID of the pipeline to run")
    dataset_id: str = Field(..., description="ID of the dataset to train on")
    name: str | None = Field(None, description="Optional run name")
    export_model: bool = Field(True, description="Save trained model")
    cv_folds: int = Field(default=5, ge=2, le=50)
    random_state: int | None = Field(42, description="Random seed")
    engine: str | None = Field(None, description="ML engine selector: 'legacy' (default) or 'dag-ml'")
    allow_fallback: bool = Field(True, description="Allow dag-ml to fall back to legacy when structured RtError says it cannot run.")
    split_group_by_by_dataset: dict[str, str | None] = Field(default_factory=dict)
    inline_pipeline: InlinePipeline | None = None


class PreflightRequest(BaseModel):
    """Request body for pre-run import/environment check."""
    pipeline_ids: list[str] = Field(default_factory=list)
    inline_pipeline: InlinePipeline | None = None
    inline_pipelines: list[InlinePipeline] = Field(default_factory=list)


class CreateRunRequest(BaseModel):
    """Request body for creating a new run."""
    config: ExperimentConfig


class NativeExperimentLaunchPayloadManifest(BaseModel):
    """Frontend-native launch manifest for explicit run-group submissions."""
    version: Literal["studio.native-launch-payload.v1"]
    legacyExperimentName: str
    legacyDatasetCount: int
    legacyPipelineCount: int
    strictCampaignCount: int
    skippedRunCount: int
    sourceRunIds: list[str] = Field(default_factory=list)
    skippedRunIds: list[str] = Field(default_factory=list)


class CampaignSinglePairSplitSpecPayload(BaseModel):
    """One strict single-pair campaign spec materialized by the frontend."""
    id: str
    sourceRunId: str
    sourceDatasetId: str
    sourcePipelineId: str
    campaign: dict[str, Any]


class CampaignSinglePairSplitSpecResultPayload(BaseModel):
    """Collection of frontend strict campaign split specs."""
    splitSpecs: list[CampaignSinglePairSplitSpecPayload] = Field(default_factory=list)
    skippedRunIds: list[str] = Field(default_factory=list)


class NativeExperimentLaunchPayload(BaseModel):
    """Native launch payload submitted by future execution adapters."""
    legacyConfig: ExperimentConfig
    manifest: NativeExperimentLaunchPayloadManifest
    strictCampaignSpecs: CampaignSinglePairSplitSpecResultPayload


class RunActionResponse(BaseModel):
    """Response for run actions (stop, retry, delete)."""
    success: bool
    message: str
    run_id: str | None = None


class ExecutionJobCommandResponse(BaseModel):
    """Response for driver-level execution job commands."""
    action: Literal["cancel"]
    job_id: str
    success: bool
    message: str
    backend: str
    run_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExecutionDriverCapabilityResponse(BaseModel):
    """Serializable execution-driver capability advertised to Studio."""
    backend: ExecutionBackend
    label: str
    available: bool
    mode: str
    supports_progress: bool
    supports_cancellation: bool
    metadata: dict[str, Any] = Field(default_factory=dict)


class ExecutionDriverCapabilitiesResponse(BaseModel):
    """Available and future execution backends known by the API."""
    default_backend: ExecutionBackend = "local-python"
    backends: list[ExecutionDriverCapabilityResponse]


class RunListResponse(BaseModel):
    """Response for listing runs."""
    runs: list[Run]
    total: int


class RunStatsResponse(BaseModel):
    """Statistics about runs."""
    running: int
    queued: int
    completed: int
    failed: int
    total_pipelines: int


# ============================================================================
# In-memory storage + File Persistence for runs
# ============================================================================

_runs: dict[str, Run] = {}
_runs_loaded: bool = False  # Track if runs have been loaded from disk
_current_workspace_path: str | None = None  # Track which workspace runs were loaded for


def reset_runs_cache():
    """Reset the runs cache. Should be called when workspace changes."""
    global _runs, _runs_loaded, _current_workspace_path
    _runs = {}
    _runs_loaded = False
    _current_workspace_path = None


def _ensure_runs_loaded():
    """Ensure persisted runs are loaded into memory (lazy loading).

    Also detects workspace changes and reloads runs if necessary.
    """
    global _runs_loaded, _runs, _current_workspace_path

    # Check if workspace changed
    workspace = workspace_manager.get_current_workspace()
    current_path = workspace.path if workspace else None

    if _current_workspace_path != current_path:
        # Workspace changed, reset cache
        _runs = {}
        _runs_loaded = False
        _current_workspace_path = current_path

    if _runs_loaded:
        return

    persisted_runs = _load_persisted_runs()
    for run in persisted_runs:
        if run.id not in _runs:
            # Reset running/queued status to failed for runs that weren't completed
            if run.status in ("running", "queued"):
                run.status = "failed"
                for dataset in run.datasets:
                    for pipeline in dataset.pipelines:
                        if pipeline.status in ("running", "queued"):
                            pipeline.status = "failed"
                            pipeline.error_message = "Interrupted - server restarted"
            _runs[run.id] = run
    _runs_loaded = True


def _get_runs_dir() -> Path | None:
    """Get the runs directory for the current workspace."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        return None
    # Use workspace.path / "runs" (matching pipelines, results, etc.)
    runs_dir = Path(workspace.path) / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    return runs_dir


class _NaNSafeJSONEncoder(json.JSONEncoder):
    """JSON encoder that converts NaN/Inf to null."""
    def encode(self, obj):
        return super().encode(self._sanitize(obj))

    def iterencode(self, obj, _one_shot=False):
        return super().iterencode(self._sanitize(obj), _one_shot)

    def _sanitize(self, obj):
        if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
            return None
        elif isinstance(obj, dict):
            return {k: self._sanitize(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._sanitize(v) for v in obj]
        return obj


def _save_run_manifest(run: Run) -> bool:
    """Save run manifest to workspace for persistence.

    The manifest is pinned to the run's own workspace (run.workspace_path):
    execution happens on a worker thread, and the globally selected workspace
    may change mid-run — writes must never relocate to the new selection.
    """
    if run.workspace_path:
        runs_dir = Path(run.workspace_path) / "runs"
        runs_dir.mkdir(parents=True, exist_ok=True)
    else:
        runs_dir = _get_runs_dir()
    if not runs_dir:
        return False

    try:
        # Create run-specific directory
        run_dir = runs_dir / run.id
        run_dir.mkdir(exist_ok=True)

        # Save manifest with NaN-safe encoder
        manifest_path = run_dir / "manifest.json"
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(run.model_dump(), f, indent=2, cls=_NaNSafeJSONEncoder)
        return True
    except Exception as e:
        logger.error("Error saving run manifest: %s", e)
        return False


def _is_safe_run_path_segment(run_id: str) -> bool:
    return bool(run_id) and run_id not in {".", ".."} and "/" not in run_id and "\\" not in run_id


def _get_run_manifest_dir(run: Run) -> Path | None:
    if not _is_safe_run_path_segment(run.id):
        raise ValueError(f"Invalid run id for filesystem path: {run.id!r}")

    if run.workspace_path:
        return Path(run.workspace_path) / "runs" / run.id

    runs_dir = _get_runs_dir()
    if runs_dir is None:
        return None
    return runs_dir / run.id


def _delete_run_manifest_dir(run: Run) -> bool:
    """Delete the persisted run directory, including execution job snapshots."""
    run_dir = _get_run_manifest_dir(run)
    if run_dir is None or not run_dir.exists():
        return False
    if not run_dir.is_dir():
        raise ValueError(f"Run manifest path is not a directory: {run_dir}")

    shutil.rmtree(run_dir)
    return True


def _sanitize_run_metrics(data: dict) -> dict:
    """Sanitize metrics in a run data dict loaded from disk."""
    for dataset in data.get("datasets", []):
        for pipeline in dataset.get("pipelines", []):
            if pipeline.get("metrics"):
                pipeline["metrics"] = _sanitize_metrics(pipeline["metrics"])
    return data


def _load_persisted_runs() -> list[Run]:
    """Load persisted runs from the workspace runs directory."""
    runs = []

    runs_dir = _get_runs_dir()
    if runs_dir and runs_dir.exists():
        for run_dir in runs_dir.iterdir():
            if not run_dir.is_dir():
                continue
            manifest_path = run_dir / "manifest.json"
            if manifest_path.exists():
                try:
                    with open(manifest_path, encoding="utf-8") as f:
                        data = json.load(f)
                        data = _sanitize_run_metrics(data)
                        runs.append(Run(**data))
                except Exception as e:
                    logger.error("Error loading run %s: %s", run_dir.name, e)

    return runs


# ============================================================================
# Helper Functions
# ============================================================================

def _compute_run_stats() -> RunStatsResponse:
    """Compute statistics about all runs."""
    running = sum(1 for r in _runs.values() if r.status == "running")
    queued = sum(1 for r in _runs.values() if r.status == "queued")
    completed = sum(1 for r in _runs.values() if r.status == "completed")
    failed = sum(1 for r in _runs.values() if r.status == "failed")
    total_pipelines = sum(
        len(d.pipelines) for r in _runs.values() for d in r.datasets
    )
    return RunStatsResponse(
        running=running,
        queued=queued,
        completed=completed,
        failed=failed,
        total_pipelines=total_pipelines,
    )


def _load_execution_job_record_for_run(run: Run) -> ExecutionJobRecord | None:
    """Load the durable execution job snapshot for a run, if one exists."""
    workspace_path = run.workspace_path
    if workspace_path is None:
        workspace = workspace_manager.get_current_workspace()
        workspace_path = workspace.path if workspace else None
    if workspace_path is None:
        return None

    return WorkspaceExecutionJobRecordRepository(workspace_path).get(run.id)


def _parse_csv_filter(value: str | None) -> set[str] | None:
    if value is None:
        return None
    filters = {item.strip() for item in value.split(",") if item.strip()}
    return filters or None


def _execution_job_record_payload(record: ExecutionJobRecord, *, run: Run | None = None) -> dict[str, Any]:
    payload = record.to_dict()
    if run is not None:
        payload["run_id"] = run.id
        payload["run_name"] = run.name
        payload["run_status"] = run.status
        payload["is_orphaned"] = False
        return payload

    payload["run_id"] = record.job_id
    payload["run_name"] = str(record.request.get("run_name") or record.job_id)
    payload["run_status"] = "orphaned"
    payload["is_orphaned"] = True
    return payload


def _build_execution_job_record_list(
    runs: list[Run],
    *,
    run_status: str | None = None,
    execution_status: str | None = None,
    requested_backend: str | None = None,
    include_orphaned: bool = False,
) -> list[dict[str, Any]]:
    """Build list-ready execution job record snapshots for runs that have one."""
    allowed_run_statuses = _parse_csv_filter(run_status)
    allowed_execution_statuses = _parse_csv_filter(execution_status)
    allowed_requested_backends = _parse_csv_filter(requested_backend)
    records: list[dict[str, Any]] = []
    seen_job_ids: set[str] = {run.id for run in runs}

    for run in runs:
        if allowed_run_statuses is not None and run.status not in allowed_run_statuses:
            continue

        try:
            record = _load_execution_job_record_for_run(run)
        except ValueError as exc:
            logger.warning("Skipping invalid execution job record for run %s: %s", run.id, exc)
            continue

        if record is None:
            continue
        if allowed_execution_statuses is not None and record.status not in allowed_execution_statuses:
            continue
        if allowed_requested_backends is not None and record.requested_backend not in allowed_requested_backends:
            continue

        records.append(_execution_job_record_payload(record, run=run))

    if include_orphaned:
        records.extend(
            _build_orphaned_execution_job_record_list(
                seen_job_ids,
                run_status=run_status,
                execution_status=execution_status,
                requested_backend=requested_backend,
            )
        )

    records.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return records


def _build_orphaned_execution_job_record_list(
    known_job_ids: set[str],
    *,
    run_status: str | None = None,
    execution_status: str | None = None,
    requested_backend: str | None = None,
) -> list[dict[str, Any]]:
    workspace = workspace_manager.get_current_workspace()
    if workspace is None:
        return []

    allowed_run_statuses = _parse_csv_filter(run_status)
    allowed_execution_statuses = _parse_csv_filter(execution_status)
    allowed_requested_backends = _parse_csv_filter(requested_backend)
    orphaned_run_status = "orphaned"
    if allowed_run_statuses is not None and orphaned_run_status not in allowed_run_statuses:
        return []

    records: list[dict[str, Any]] = []
    repository = WorkspaceExecutionJobRecordRepository(workspace.path)
    for record in repository.list_records():
        if record.job_id in known_job_ids:
            continue
        if allowed_execution_statuses is not None and record.status not in allowed_execution_statuses:
            continue
        if allowed_requested_backends is not None and record.requested_backend not in allowed_requested_backends:
            continue

        records.append(_execution_job_record_payload(record))
    return records


def _load_workspace_execution_job_record(job_id: str) -> ExecutionJobRecord | None:
    workspace = workspace_manager.get_current_workspace()
    if workspace is None:
        return None
    return WorkspaceExecutionJobRecordRepository(workspace.path).get(job_id)


def _request_execution_job_cancel(job_id: str, backend: str) -> ExecutionJobCommandResult:
    try:
        driver = get_execution_driver(cast(ExecutionBackend, backend))
    except KeyError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported execution backend {backend}",
        ) from exc
    return driver.cancel_job(job_id, job_manager)


def _execution_job_command_response(
    result: ExecutionJobCommandResult,
    *,
    run_id: str | None = None,
) -> ExecutionJobCommandResponse:
    return ExecutionJobCommandResponse(
        action=result.action,
        job_id=result.job_id,
        success=result.success,
        message=result.message,
        backend=result.backend,
        run_id=run_id,
        metadata=dict(result.metadata),
    )


def _cancel_run(
    run: Run,
    *,
    job_id: str | None = None,
    force_local_state_on_command_failure: bool = True,
) -> tuple[RunActionResponse, ExecutionJobCommandResult]:
    if run.status not in ("running", "queued"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot stop run with status {run.status}"
        )

    command_job_id = job_id or run.id
    result = _request_execution_job_cancel(command_job_id, run.execution_backend)
    if not result.success and not force_local_state_on_command_failure:
        return (
            RunActionResponse(
                success=False,
                message=result.message,
                run_id=run.id,
            ),
            result,
        )

    run.status = "failed"
    for dataset in run.datasets:
        for pipeline in dataset.pipelines:
            if pipeline.status in ("running", "queued"):
                pipeline.status = "failed"
                pipeline.error_message = "Stopped by user"

    _save_run_manifest(run)

    return (
        RunActionResponse(
            success=True,
            message=f"Run {run.id} stopped",
            run_id=run.id,
        ),
        result,
    )


def _extract_pipeline_info(pipeline_config: dict) -> tuple[str, str, str]:
    """Extract model(s), preprocessing, and split info from pipeline config.

    Returns:
        Tuple of (models_str, preprocessing_str, split_strategy)
        - models_str: Model names (truncated if too many)
        - preprocessing_str: Preprocessing names (truncated if too many)
        - split_strategy: First splitter found or "KFold(5)"
    """
    steps = pipeline_config.get("steps", [])
    models = []
    preprocessing = []
    split_strategy = "KFold(5)"

    def extract_from_step(step: dict):
        """Recursively extract info from a step and its children/branches."""
        step_type = step.get("type", "")
        step_name = step.get("name", "")

        if step_type == "model":
            if step_name and step_name not in models:
                models.append(step_name)
        elif step_type == "preprocessing":
            if step_name and step_name not in preprocessing:
                preprocessing.append(step_name)
        elif step_type == "splitting":
            nonlocal split_strategy
            if step_name:
                split_strategy = step_name

        # Check children (for container steps)
        for child in step.get("children", []):
            extract_from_step(child)

        # Check branches (for branch/generator steps)
        for branch in step.get("branches", []):
            for branch_step in branch:
                extract_from_step(branch_step)

    for step in steps:
        extract_from_step(step)

    # Format models string - show up to 3, then count
    if not models:
        models_str = "Unknown"
    elif len(models) <= 3:
        models_str = " + ".join(models)
    else:
        models_str = f"{models[0]} + {models[1]} (+{len(models) - 2} more)"

    # Format preprocessing string - show up to 4, then count
    if not preprocessing:
        preprocessing_str = "None"
    elif len(preprocessing) <= 4:
        preprocessing_str = " → ".join(preprocessing)
    else:
        preprocessing_str = f"{' → '.join(preprocessing[:3])} (+{len(preprocessing) - 3} more)"

    return models_str, preprocessing_str, split_strategy


def _create_quick_run(request: QuickRunRequest, pipeline_config: dict, dataset_info: dict) -> Run:
    """Create a run from quick run request, expanding variants if applicable."""
    run_id = f"run_{int(datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
    now = datetime.now().isoformat()
    split_group_by = request.split_group_by_by_dataset.get(request.dataset_id)

    base_model, base_preprocessing, split_strategy = _extract_pipeline_info(pipeline_config)
    pl_steps = pipeline_config.get("steps", [])

    # Estimate variants and model counts for this pipeline
    estimate = _estimate_pipeline_variants(pipeline_config, cv_folds=request.cv_folds)

    workspace = workspace_manager.get_current_workspace()
    pipelines = []

    if estimate.has_generators and estimate.estimated_variants > 1:
        # Expand pipeline into separate variant entries
        from .nirs4all_adapter import expand_pipeline_variants
        variants = expand_pipeline_variants(pl_steps)

        for variant in variants:
            # Build variant-specific name
            variant_name = f"{pipeline_config.get('name', request.pipeline_id)}"
            if variant.description:
                variant_name = f"{variant_name} [{variant.description}]"

            # Use variant-specific model/preprocessing or fall back to extracted
            model_name = variant.model_name if variant.model_name != "Unknown" else base_model
            preprocessing_str = " → ".join(variant.preprocessing_names) if variant.preprocessing_names else base_preprocessing

            pipeline_run = PipelineRun(
                id=f"{run_id}-{request.pipeline_id}-v{variant.index}",
                pipeline_id=request.pipeline_id,
                pipeline_name=variant_name,
                model=model_name,
                preprocessing=preprocessing_str,
                split_strategy=f"KFold({request.cv_folds})" if split_strategy == "KFold(5)" else split_strategy,
                status="queued",
                progress=0,
                config=pipeline_config,
                variant_index=variant.index,
                variant_description=variant.description,
                variant_choices=variant.choices,
                is_expanded_variant=True,
                estimated_variants=1,
                has_generators=False,
                fold_count=estimate.fold_count,
                branch_count=1,  # Variants are already expanded
                total_model_count=estimate.fold_count,
                model_count_breakdown=f"{estimate.fold_count} folds" if estimate.fold_count > 1 else "1 model",
            )
            pipelines.append(pipeline_run)
    else:
        # Single pipeline (no generators)
        pipeline_run = PipelineRun(
            id=f"{run_id}-{request.pipeline_id}",
            pipeline_id=request.pipeline_id,
            pipeline_name=pipeline_config.get("name", request.pipeline_id),
            model=base_model,
            preprocessing=base_preprocessing,
            split_strategy=f"KFold({request.cv_folds})" if split_strategy == "KFold(5)" else split_strategy,
            status="queued",
            progress=0,
            config=pipeline_config,
            estimated_variants=estimate.estimated_variants,
            has_generators=estimate.has_generators,
            fold_count=estimate.fold_count,
            branch_count=estimate.branch_count,
            total_model_count=estimate.total_model_count,
            model_count_breakdown=estimate.model_count_breakdown,
        )
        pipelines.append(pipeline_run)

    dataset_run = DatasetRun(
        dataset_id=request.dataset_id,
        dataset_name=dataset_info.get("name", request.dataset_id),
        split_group_by=split_group_by,
        pipelines=pipelines,
    )

    # Build description
    description = f"Training on {dataset_info.get('name', request.dataset_id)}"
    if len(pipelines) > 1:
        description += f" ({len(pipelines)} pipeline variants)"

    run = Run(
        id=run_id,
        name=request.name or f"Quick Run: {pipeline_config.get('name', 'Pipeline')}",
        description=description,
        execution_backend="local-python",
        engine=request.engine,
        allow_fallback=request.allow_fallback,
        datasets=[dataset_run],
        status="queued",
        created_at=now,
        cv_folds=request.cv_folds,
        total_pipelines=len(pipelines),
        completed_pipelines=0,
        workspace_path=workspace.path if workspace else None,
    )

    return run


def _execution_backend_unavailable_detail(driver: Any, requested_backend: ExecutionBackend) -> dict[str, Any]:
    capability = getattr(driver, "capability", None)
    rt_error = capability.rt_error("run") if capability is not None else None
    if rt_error is None:
        rt_error = RtError(
            verb="run",
            cause="unavailable_backend",
            message=f"Execution backend '{requested_backend}' is not available",
            mitigation="Run on an available execution backend, or configure a driver for this backend.",
        )
    return rt_error.to_envelope()


def _ensure_execution_driver_available(driver: Any, requested_backend: ExecutionBackend) -> None:
    capability = getattr(driver, "capability", None)
    if capability is not None and getattr(capability, "available", True) is False:
        raise HTTPException(
            status_code=501,
            detail=_execution_backend_unavailable_detail(driver, requested_backend),
        )


def _get_available_execution_driver(
    requested_backend: ExecutionBackend,
    *,
    job_record_repository: WorkspaceExecutionJobRecordRepository | None = None,
) -> Any:
    driver = get_execution_driver(
        requested_backend,
        job_record_repository=job_record_repository,
    )
    _ensure_execution_driver_available(driver, requested_backend)
    return driver


def _start_run_job(run: Run) -> Job:
    """Create and submit the JobManager job that executes a run.

    The job id IS the run id, so WebSocket clients subscribed to the run id
    receive JobManager's job_started/job_progress/job_completed/job_failed
    lifecycle notifications directly.
    """
    execution_request = ExecutionRequest(
        run_id=run.id,
        run_name=run.name,
        requested_backend=run.execution_backend,
        requested_engine=run.engine,
        allow_fallback=run.allow_fallback,
        total_pipelines=run.total_pipelines or 0,
        dataset_count=len(run.datasets),
        workspace_path=run.workspace_path,
        created_at=run.created_at,
        metadata=_build_run_execution_metadata(run),
    )
    job_record_repository = (
        WorkspaceExecutionJobRecordRepository(run.workspace_path)
        if run.workspace_path
        else None
    )
    driver = _get_available_execution_driver(
        run.execution_backend,
        job_record_repository=job_record_repository,
    )
    return driver.submit(
        execution_request,
        job_manager,
        lambda j, cb: _execute_run_job(run.id, j, cb),
    )


def _build_run_execution_metadata(run: Run) -> dict[str, Any]:
    """Return campaign-shaped metadata for future remote execution drivers."""
    dataset_bindings: list[dict[str, Any]] = []
    for dataset in run.datasets:
        dataset_bindings.append({
            "dataset_id": dataset.dataset_id,
            "dataset_name": dataset.dataset_name,
            "split_group_by": dataset.split_group_by,
            "pipeline_count": len(dataset.pipelines),
            "pipeline_ids": [pipeline.pipeline_id for pipeline in dataset.pipelines],
        })

    metadata: dict[str, Any] = {
        "kind": "campaign",
        "campaign_shape": "legacy-cartesian",
        "dataset_bindings": dataset_bindings,
        "planned_pipeline_runs": run.total_pipelines or sum(binding["pipeline_count"] for binding in dataset_bindings),
    }
    if run.project_id:
        metadata["project_id"] = run.project_id
    if run.store_run_id:
        metadata["store_run_id"] = run.store_run_id
    if run.execution_metadata:
        metadata.update(run.execution_metadata)
    return metadata


def _open_run_store_repository(workspace_path: str | Path) -> RunStoreRepository:
    return RunStoreRepository(workspace_path)


def _build_store_run_config(run: Run, total_pipelines: int) -> dict[str, Any]:
    config: dict[str, Any] = {
        "n_pipelines": total_pipelines,
        "n_datasets": len(run.datasets),
        "execution_backend": run.execution_backend,
    }
    if run.engine is not None:
        config["requested_engine"] = run.engine
    config["fallback_policy"] = fallback_policy_record(run.engine, run.allow_fallback)
    if run.project_id:
        config["project_id"] = run.project_id
    return config


def _prefers_native_runtime(engine: str | None) -> bool:
    return resolve_engine(engine) == "dag-ml"


def _execute_run_job(run_id: str, job: Job, progress_callback: Any) -> dict[str, Any]:
    """Execute every pipeline of a run (JobManager task, runs on a worker thread).

    Cancellation is cooperative: stop_run() marks the run terminal and requests
    job cancellation; this task checks the flag between pipelines and never
    overwrites a terminal status set by stop_run — a stopped run must not be
    resurrected to 'completed' by the still-running worker (RUN-07). The
    cancellation flag is also threaded into nirs4all.run() as its should_stop
    hook, so an in-flight pipeline aborts at the next variant/refit boundary
    (RunCancelledError) instead of running to completion.
    """
    run = _runs.get(run_id)
    if run is None:
        return {"run_id": run_id, "status": "unknown"}

    run.status = "running"
    run.started_at = datetime.now().isoformat()
    _save_run_manifest(run)

    total_pipelines = run.total_pipelines or 1
    cancelled = False

    # Pre-create a single store run so all pipelines are grouped together and the
    # persisted store entry keeps the wizard-provided run name even for simple
    # one-pipeline runs.
    shared_store_run_id: str | None = None
    run_store_repository: RunStoreRepository | None = None
    precreate_legacy_store_run = run.workspace_path and not _prefers_native_runtime(run.engine)
    if precreate_legacy_store_run:
        try:
            run_store_repository = _open_run_store_repository(run.workspace_path)
            dataset_meta = [{"name": d.dataset_name} for d in run.datasets]
            shared_store_run_id = run_store_repository.begin_run(
                name=run.name or "run",
                config=_build_store_run_config(run, total_pipelines),
                datasets=dataset_meta,
            )
            if run.project_id:
                run_store_repository.set_project(shared_store_run_id, run.project_id)
            run.store_run_id = shared_store_run_id
        except Exception as e:
            logger.warning("Failed to pre-create store run: %s", e)
            shared_store_run_id = None
            run_store_repository = None

    try:
        pipeline_index = 0
        for dataset in run.datasets:
            for pipeline in dataset.pipelines:
                if job.cancellation_requested:
                    cancelled = True
                    pipeline.status = "failed"
                    pipeline.error_message = "Cancelled by user"
                    continue

                pipeline.status = "running"
                pipeline.started_at = datetime.now().isoformat()
                # Persist the requested engine up-front so a hard run failure
                # still records what the user asked for. The engine that actually
                # ran (incl. transparent fallback) and its diagnostics are
                # recorded on success below; the Studio route must never silently
                # drop the engine request even when training raises (B-011).
                pipeline.engine_requested = run.engine
                pipeline.fallback_policy = fallback_policy_record(run.engine, run.allow_fallback)
                pipeline.logs = [f"[INFO] Starting pipeline: {pipeline.pipeline_name}"]
                _save_run_manifest(run)

                base_progress = (pipeline_index / total_pipelines) * 100
                progress_callback(
                    base_progress,
                    f"Starting {pipeline.pipeline_name} on {dataset.dataset_name}...",
                )

                training_succeeded = False
                try:
                    result = _execute_pipeline_training(
                        pipeline,
                        dataset.dataset_id,
                        run.workspace_path,
                        run_id,
                        dataset.split_group_by,
                        store_run_id=shared_store_run_id,
                        engine=run.engine,
                        allow_fallback=run.allow_fallback,
                        should_stop=lambda: job.cancellation_requested,
                    )
                    training_succeeded = True

                    if job.cancellation_requested:
                        # The in-flight pipeline ran to completion (no library
                        # cancel hook), but a stopped run must not publish it
                        # as a success.
                        cancelled = True
                        pipeline.status = "failed"
                        pipeline.error_message = "Cancelled by user"
                    else:
                        pipeline.status = "completed"
                        pipeline.progress = 100
                        pipeline.completed_at = datetime.now().isoformat()
                        # Sanitize metrics to handle NaN/Inf values
                        sanitized_metrics = _sanitize_metrics(result.get("metrics", {}))
                        pipeline.metrics = RunMetrics(**sanitized_metrics)
                        pipeline.model_path = result.get("model_path")
                        pipeline.logs = result.get("logs", pipeline.logs or [])
                        pipeline.tested_variants = result.get("variants_tested", 1)
                        # Record which ML engine actually ran (incl. fallback) +
                        # any RtError diagnostics, so the run read model shows it.
                        pipeline.engine = result.get("engine")
                        pipeline.engine_requested = result.get("engine_requested")
                        pipeline.engine_diagnostics = result.get("engine_diagnostics")
                        pipeline.runtime_source = result.get("runtime_source")
                        pipeline.runtime_manifest = result.get("runtime_manifest")
                        pipeline.fallback_policy = result.get("fallback_policy") or pipeline.fallback_policy
                        pipeline.native_result_refs = result.get("native_result_refs")

                        # Capture store_run_id (from shared pre-created run or single pipeline)
                        result_store_run_id = result.get("store_run_id")
                        if result_store_run_id and not run.store_run_id:
                            run.store_run_id = result_store_run_id

                        variants_info = (
                            f" ({pipeline.tested_variants} variants tested)"
                            if pipeline.tested_variants > 1
                            else ""
                        )
                        result_metrics = result.get("metrics", {})
                        score_metric = result_metrics.get("score_metric")
                        score_val = result_metrics.get("score")
                        r2_val = result_metrics.get("r2")

                        if score_metric and score_val is not None and r2_val is None:
                            pipeline.logs.append(
                                f"[INFO] Training complete{variants_info}. Best {score_metric}: {float(score_val):.4f}"
                            )
                        else:
                            r2_str = f"{float(r2_val):.4f}" if r2_val is not None else "N/A"
                            pipeline.logs.append(
                                f"[INFO] Training complete{variants_info}. Best R²: {r2_str}"
                            )

                        if run.completed_pipelines is not None:
                            run.completed_pipelines += 1

                        if result_metrics:
                            job_manager.update_job_metrics(job.id, result_metrics, append_history=False)
                        progress_callback(
                            ((pipeline_index + 1) / total_pipelines) * 100,
                            f"Completed {pipeline.pipeline_name}",
                        )

                except Exception as e:
                    from nirs4all.pipeline.execution.orchestrator import RunCancelledError

                    if isinstance(e, RunCancelledError):
                        cancelled = True
                        pipeline.status = "failed"
                        pipeline.error_message = "Cancelled by user"
                        pipeline.logs = pipeline.logs or []
                        pipeline.logs.append("[WARN] Pipeline cancelled by user")
                    else:
                        pipeline.status = "failed"
                        pipeline.error_message = str(e)
                        pipeline.logs = pipeline.logs or []
                        pipeline.logs.append(f"[ERROR] {str(e)}")
                        rt_error = rt_error_envelope_from_exception(e)
                        if rt_error is not None:
                            pipeline.engine_diagnostics = [rt_error]
                            pipeline.runtime_source = "rt_error"
                            pipeline.fallback_policy = fallback_policy_record(run.engine, run.allow_fallback)
                        if training_succeeded:
                            # The pipeline trained; the failure is in studio
                            # post-processing (metrics shaping, job bookkeeping).
                            # That is a studio defect, not an expected run
                            # outcome — log it distinctly so it stays reportable.
                            logger.error("Run result post-processing failed: %s", e, exc_info=True)
                        else:
                            logger.error("Pipeline execution error: %s", e, exc_info=True)

                _save_run_manifest(run)
                pipeline_index += 1

        if job.cancellation_requested:
            cancelled = True

        if cancelled:
            # stop_run() already wrote the terminal status; keep it (RUN-07).
            if not run.completed_at:
                run.completed_at = datetime.now().isoformat()
            _save_run_manifest(run)
            if shared_store_run_id and run.workspace_path:
                try:
                    if run_store_repository is not None:
                        run_store_repository.fail_run(shared_store_run_id, "Stopped by user")
                except Exception:
                    pass
            _invalidate_workspace_results_after_run(run)
            return {"run_id": run_id, "status": run.status, "cancelled": True}

        # Determine overall run status
        all_completed = all(
            p.status == "completed" for d in run.datasets for p in d.pipelines
        )
        any_failed = any(
            p.status == "failed" for d in run.datasets for p in d.pipelines
        )
        run.status = "completed" if all_completed or not any_failed else "failed"
        run.completed_at = datetime.now().isoformat()

        if run.started_at:
            start = datetime.fromisoformat(run.started_at)
            end = datetime.fromisoformat(run.completed_at)
            duration = end - start
            run.duration = f"{int(duration.total_seconds() // 60)}m {int(duration.total_seconds() % 60)}s"

        _save_run_manifest(run)

        # Mirror the final run state in the shared store run.
        if shared_store_run_id and run.workspace_path:
            try:
                if run_store_repository is not None:
                    if run.status == "failed":
                        failure_message = next(
                            (
                                p.error_message
                                for d in run.datasets
                                for p in d.pipelines
                                if p.status == "failed" and p.error_message
                            ),
                            "Run failed",
                        )
                        run_store_repository.fail_run(shared_store_run_id, failure_message)
                    else:
                        run_store_repository.complete_run(shared_store_run_id, {"total_pipelines": total_pipelines})
            except Exception as e:
                logger.warning("Failed to finalize store run: %s", e)

        _invalidate_workspace_results_after_run(run)
        return {"run_id": run_id, "status": run.status, "duration": run.duration}

    except Exception as e:
        run.status = "failed"
        run.completed_at = datetime.now().isoformat()
        _save_run_manifest(run)

        # Fail the shared store run
        if shared_store_run_id and run.workspace_path:
            try:
                if run_store_repository is not None:
                    run_store_repository.fail_run(shared_store_run_id, str(e))
            except Exception:
                pass

        _invalidate_workspace_results_after_run(run)
        # Re-raise so JobManager marks the job FAILED and dispatches the
        # job_failed WebSocket notification.
        raise


def _execute_pipeline_training(
    pipeline: PipelineRun,
    dataset_id: str,
    workspace_path: str | None,
    run_id: str,
    split_group_by: str | None = None,
    store_run_id: str | None = None,
    engine: str | None = None,
    allow_fallback: bool = True,
    should_stop: Any | None = None,
) -> dict[str, Any]:
    """Execute one pipeline via nirs4all.run() on the current worker thread.

    Supports sweeps (_range_, _or_, ...), branching and finetuning through the
    full nirs4all API. Library log output is captured into the pipeline logs
    (served by /runs/{run_id}/logs/{pipeline_id} and persisted in the manifest).

    Returns:
        Dict with metrics, model_path, logs, variants_tested and store_run_id.
    """
    logs: list[str] = []

    def log(msg: str) -> None:
        logs.append(msg)
        if pipeline.logs is None:
            pipeline.logs = []
        pipeline.logs.append(msg)

    def _summarize_folds(predictions: Any) -> None:
        """Log fold-level scores plus avg and weighted avg when available."""
        try:
            fold_groups = predictions.top(n=1, group_by=["fold_id"])
        except Exception:
            return

        if not isinstance(fold_groups, dict):
            return

        fold_scores = []
        metric_name = "score"
        try:
            best_entry = predictions.top(n=1)
            if best_entry:
                metric_name = best_entry[0].get("metric", metric_name)
        except Exception:
            pass

        for key, entries in fold_groups.items():
            fold_id = key[0] if isinstance(key, tuple) else key
            if not fold_id or str(fold_id).lower() in ("avg", "wavg", "ensemble"):
                continue
            entry = entries[0] if entries else None
            if not entry:
                continue
            score = entry.get("test_score")
            if score is None:
                score = entry.get("val_score")
            if score is None:
                continue
            n_samples = entry.get("n_samples") or 0
            fold_scores.append((fold_id, float(score), int(n_samples)))
            log(f"[INFO] Fold {fold_id}: {metric_name}={float(score):.4f} (n={int(n_samples)})")

        if not fold_scores:
            return

        avg = sum(s for _, s, _ in fold_scores) / len(fold_scores)
        log(f"[INFO] Fold avg: {metric_name}={avg:.4f}")

        total_weight = sum(n for _, _, n in fold_scores)
        if total_weight > 0:
            wavg = sum(s * n for _, s, n in fold_scores) / total_weight
            log(f"[INFO] Fold wavg (by n_samples): {metric_name}={wavg:.4f}")

    log("[INFO] Preparing pipeline...")

    config = pipeline.config or {}
    steps = config.get("steps", [])
    model_name = pipeline.model or "Unknown"

    try:
        import nirs4all
    except ImportError as e:
        raise ValueError(f"nirs4all is required for training: {e}")

    # Capture library log output into the pipeline logs. Only records emitted
    # from this worker thread are captured so concurrent jobs don't cross-pollute.
    thread_id = threading.get_ident()

    class _PipelineLogHandler(logging.Handler):
        def emit(self, record):
            if record.thread != thread_id:
                return
            try:
                msg = self.format(record)
            except Exception:
                msg = record.getMessage()
            if msg:
                log(msg)

    log_handler = _PipelineLogHandler()
    log_handler.setLevel(logging.INFO)
    log_handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
    root_logger = logging.getLogger()
    root_logger.addHandler(log_handler)

    estimated_variants = 1
    has_generators = False

    try:
        # Build dataset config with proper loading parameters (delimiter, etc.)
        from .nirs4all_adapter import build_dataset_config, ensure_models_dir, expand_pipeline_variants
        from .spectra import _load_dataset
        try:
            dataset_config = build_dataset_config(dataset_id)
            log(f"[INFO] Dataset config keys: {list(dataset_config.keys())}")
        except Exception as e:
            raise ValueError(f"Dataset '{dataset_id}' config build failed: {e}")

        dataset_object = _load_dataset(dataset_id)
        if dataset_object is None:
            raise ValueError(f"Dataset '{dataset_id}' could not be loaded for runtime grouping.")

        try:
            prepared = prepare_pipeline_steps_with_runtime_grouping(
                steps,
                dataset_object,
                split_group_by,
            )
        except Exception as e:
            raise ValueError(f"Runtime split grouping validation failed: {e}") from e

        for warning_message in prepared.warnings:
            log(f"[WARN] {warning_message}")

        prepared_steps = prepared.steps
        nirs4all_steps = None

        # Check if this is an already-expanded variant
        is_expanded_variant = pipeline.is_expanded_variant or False
        variant_index = pipeline.variant_index

        if prepared_steps:
            try:
                if is_expanded_variant and variant_index is not None:
                    # This is a specific variant - get its pre-expanded steps
                    variants = expand_pipeline_variants(prepared_steps)
                    if 0 <= variant_index < len(variants):
                        selected_variant = variants[variant_index]
                        nirs4all_steps = selected_variant.steps
                        log(f"[INFO] Running variant {variant_index + 1}/{len(variants)}: {selected_variant.description}")
                    else:
                        log(f"[WARN] Variant index {variant_index} out of range, using first variant")
                        if variants:
                            nirs4all_steps = variants[0].steps
                        else:
                            nirs4all_steps = editor_steps_to_runtime_canonical(prepared_steps)
                else:
                    # Full pipeline with generators preserved in canonical form
                    nirs4all_steps = editor_steps_to_runtime_canonical(prepared_steps)
                    if not nirs4all_steps:
                        raise ValueError("Pipeline has no executable steps")
                    estimated_variants = count_runtime_variants(nirs4all_steps)
                    has_generators = contains_generators(nirs4all_steps)

                    log(f"[INFO] Pipeline built: {len(nirs4all_steps)} steps")

                    if has_generators:
                        log(f"[INFO] Generators detected: ~{estimated_variants} variants will be tested")

            except HTTPException as e:
                # HTTPException from _resolve_operator_class means a missing optional package
                detail = str(e.detail) if hasattr(e, "detail") else str(e)
                raise ValueError(
                    f"Missing package for pipeline '{pipeline.pipeline_name}': {detail}. "
                    f"Install it via Settings > Advanced > Dependencies."
                )
            except Exception as e:
                raise ValueError(f"Pipeline build failed: {e}")
        else:
            raise ValueError("No pipeline steps provided")

        # Execute using nirs4all.run()
        log("[INFO] Executing nirs4all.run() with dataset config...")
        log(f"[INFO] Training {model_name}...")

        base_run_kwargs = {
            "pipeline": nirs4all_steps,
            "dataset": dataset_config,
            "verbose": 1,
            "save_artifacts": True,
            "save_charts": False,
            "plots_visible": False,
        }
        # Thread the requested ML engine (legacy|dag-ml) into the run; absent =>
        # the library default. Orthogonal to the run's execution_backend.
        from .runtime_engine import engine_run_kwargs, observe_engine

        fallback_policy = fallback_policy_record(engine, allow_fallback)
        resolved_engine = resolve_engine(engine)

        def _legacy_run_kwargs(*, force_legacy: bool = False) -> dict[str, Any]:
            kwargs = {**base_run_kwargs, "workspace_path": workspace_path}
            if force_legacy:
                kwargs["engine"] = "legacy"
            else:
                kwargs.update(engine_run_kwargs(engine))
            if store_run_id:
                kwargs["store_run_id"] = store_run_id
            if should_stop is not None:
                # Cooperative cancellation: nirs4all polls this at dataset/variant/
                # refit boundaries and aborts with RunCancelledError.
                kwargs["should_stop"] = should_stop
            return kwargs

        def _attach_rt_diagnostic(result_obj: Any, exc: BaseException) -> None:
            if hasattr(exc, "to_dict"):
                try:
                    result_obj._rt_diagnostics = [exc]
                except Exception:
                    pass

        if resolved_engine == "dag-ml":
            # Dag-ml does not honor the legacy workspace/store kwargs. Run it
            # against the runtime envelope in strict mode first; if the caller's
            # policy permits fallback, rerun legacy explicitly using the
            # structured RtError as the diagnostic source of truth.
            run_kwargs = dict(base_run_kwargs)
            run_kwargs.update(engine_run_kwargs(engine))
            run_kwargs["allow_fallback"] = False
            if workspace_path:
                run_kwargs["results_path"] = str(Path(workspace_path) / NATIVE_RESULTS_DIRNAME)

            with observe_engine(engine) as engine_observation:
                try:
                    result = nirs4all.run(**run_kwargs)
                except Exception as exc:
                    rt_error = rt_error_envelope_from_exception(exc)
                    if rt_error is None or not allow_fallback:
                        raise
                    log(f"[WARN] {rt_error.get('message', str(exc))}")
                    with observe_engine("legacy") as fallback_observation:
                        result = nirs4all.run(**_legacy_run_kwargs(force_legacy=True))
                    _attach_rt_diagnostic(result, exc)
                    engine_record = fallback_observation.finalize(
                        result,
                        diagnostics=[rt_error],
                        fallback_policy=fallback_policy,
                    )
                    engine_record["engine_requested"] = engine
                else:
                    engine_record = engine_observation.finalize(
                        result,
                        fallback_policy=fallback_policy,
                    )
        else:
            # Legacy/default path remains store-backed. Warning capture is kept
            # only for older nirs4all builds that lack RtResult diagnostics.
            with observe_engine(engine) as engine_observation:
                result = nirs4all.run(**_legacy_run_kwargs())
            engine_record = engine_observation.finalize(
                result,
                fallback_policy=fallback_policy,
            )
    finally:
        root_logger.removeHandler(log_handler)

    log("[INFO] Training completed, extracting metrics...")

    # Single source of truth for metric extraction across all run wrappers
    # (RUN-02). Missing metrics stay absent — no sentinel fabrication (RUN-06).
    from .nirs4all_adapter import extract_best_metrics
    metrics = _sanitize_metrics(extract_best_metrics(result))

    # Count actual pipeline variants, not fold/partition/refit prediction rows.
    variants_tested = _count_tested_pipeline_variants(result, fallback=estimated_variants)
    log(f"[INFO] Tested {variants_tested} pipeline variant(s)")

    is_classification_run = "classification" in str(metrics.get("task_type") or "").lower()
    if is_classification_run and metrics.get("score") is not None:
        metric_label = metrics.get("score_metric") or "score"
        log(f"[INFO] Best {metric_label} = {metrics['score']:.4f}")
    else:
        r2_str = f"{metrics['r2']:.4f}" if metrics.get("r2") is not None else "N/A"
        rmse_str = f"{metrics['rmse']:.4f}" if metrics.get("rmse") is not None else "N/A"
        log(f"[INFO] Best R² = {r2_str}, RMSE = {rmse_str}")

    # Fold summary (if available)
    try:
        _summarize_folds(result.predictions)
    except Exception:
        pass

    # Get top results for logging
    if has_generators and hasattr(result, "top"):
        try:
            top_3 = list(result.top(3))
            log("[INFO] Top 3 configurations:")
            for i, pred in enumerate(top_3, 1):
                pred_rmse = getattr(pred, "rmse", getattr(pred, "test_rmse", None))
                pred_r2 = getattr(pred, "r2", getattr(pred, "test_r2", None))
                if pred_rmse is not None and pred_r2 is not None:
                    log(f"[INFO]   {i}. RMSE={pred_rmse:.4f}, R²={pred_r2:.4f}")
                elif pred_rmse is not None:
                    log(f"[INFO]   {i}. RMSE={pred_rmse:.4f}")
        except Exception:
            pass

    # Extract result_store_run_id from the orchestrator
    result_store_run_id = store_run_id  # Start with the caller-provided ID
    try:
        if hasattr(result, "_runner") and result._runner is not None:
            orchestrator = getattr(result._runner, "orchestrator", None)
            if orchestrator is not None:
                orch_run_id = getattr(orchestrator, "last_run_id", None)
                if orch_run_id:
                    result_store_run_id = orch_run_id
    except Exception:
        pass

    # Export model bundle (.n4a) using RunResult.export()
    model_path = None
    if workspace_path:
        log("[INFO] Exporting model...")
        try:
            models_dir = ensure_models_dir(workspace_path)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            model_filename = f"{pipeline.pipeline_id}_{run_id}_{timestamp}.n4a"
            model_path = str(models_dir / model_filename)

            result.export(model_path)
            log(f"[INFO] Model exported: {model_filename}")
        except Exception as e:
            log(f"[WARN] Model export failed: {e}")

    return {
        "metrics": metrics,
        "model_path": model_path,
        "logs": logs,
        "variants_tested": variants_tested,
        "store_run_id": result_store_run_id,
        "engine": engine_record.get("engine"),
        "engine_requested": engine_record.get("engine_requested"),
        "engine_diagnostics": engine_record.get("engine_diagnostics"),
        "runtime_source": engine_record.get("runtime_source"),
        "runtime_manifest": engine_record.get("runtime_manifest"),
        "fallback_policy": engine_record.get("fallback_policy"),
        "native_result_refs": engine_record.get("native_result_refs"),
    }


# ============================================================================
# API Endpoints
# ============================================================================

@router.get("", response_model=RunListResponse)
async def list_runs(status: str = None):
    """List all runs, optionally filtered by status.

    Args:
        status: Comma-separated list of statuses to filter by (e.g. "running,queued")
    """
    _ensure_runs_loaded()  # Load persisted runs on first access
    runs = list(_runs.values())

    # Filter by status if provided
    if status:
        allowed_statuses = {s.strip() for s in status.split(",")}
        runs = [r for r in runs if r.status in allowed_statuses]

    # Sort by created_at descending (newest first)
    runs.sort(key=lambda r: r.created_at, reverse=True)
    return RunListResponse(runs=runs, total=len(runs))


@router.get("/stats", response_model=RunStatsResponse)
async def get_run_stats():
    """Get run statistics."""
    _ensure_runs_loaded()
    return _compute_run_stats()


@router.get("/execution-backends", response_model=ExecutionDriverCapabilitiesResponse)
async def list_run_execution_backends():
    """List typed execution backends and whether they can currently run jobs."""
    return ExecutionDriverCapabilitiesResponse(
        backends=[
            ExecutionDriverCapabilityResponse(**capability.to_dict())
            for capability in list_execution_driver_capabilities()
        ],
    )


@router.get("/execution-job-records")
async def list_run_execution_job_records(
    run_status: str = None,
    execution_status: str = None,
    requested_backend: str = None,
    include_orphaned: bool = False,
) -> dict[str, Any]:
    """List latest durable execution job records for runs that have snapshots."""
    _ensure_runs_loaded()
    records = _build_execution_job_record_list(
        list(_runs.values()),
        run_status=run_status,
        execution_status=execution_status,
        requested_backend=requested_backend,
        include_orphaned=include_orphaned,
    )
    return {"records": records, "total": len(records)}


@router.get("/execution-job-records/{job_id}")
async def get_workspace_execution_job_record(job_id: str) -> dict[str, Any]:
    """Get a durable execution job record by job id, even without a Run anchor."""
    _ensure_runs_loaded()
    run = _runs.get(job_id)
    try:
        record = _load_execution_job_record_for_run(run) if run is not None else _load_workspace_execution_job_record(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if record is None:
        raise HTTPException(
            status_code=404,
            detail=f"Execution job record {job_id} not found",
        )

    return _execution_job_record_payload(record, run=run)


@router.post("/execution-job-records/{job_id}/cancel", response_model=ExecutionJobCommandResponse)
async def cancel_workspace_execution_job_record(job_id: str):
    """Cancel a durable execution job record by job id."""
    _ensure_runs_loaded()
    run = _runs.get(job_id)
    try:
        record = _load_execution_job_record_for_run(run) if run is not None else _load_workspace_execution_job_record(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if record is None:
        raise HTTPException(
            status_code=404,
            detail=f"Execution job record {job_id} not found",
        )

    if run is None:
        record_run_id = record.request.get("run_id")
        if isinstance(record_run_id, str):
            run = _runs.get(record_run_id)

    if run is None:
        result = _request_execution_job_cancel(record.job_id, record.requested_backend)
        record_run_id = record.request.get("run_id")
        return _execution_job_command_response(
            result,
            run_id=record_run_id if isinstance(record_run_id, str) else None,
        )

    _, result = _cancel_run(
        run,
        job_id=record.job_id,
        force_local_state_on_command_failure=False,
    )
    return _execution_job_command_response(result, run_id=run.id)


@router.get("/{run_id}", response_model=Run)
async def get_run(run_id: str):
    """Get details of a specific run."""
    _ensure_runs_loaded()
    if run_id not in _runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return _runs[run_id]


@router.get("/{run_id}/execution-job-record")
async def get_run_execution_job_record(run_id: str) -> dict[str, Any]:
    """Get the latest durable execution job record for a run."""
    _ensure_runs_loaded()
    run = _runs.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    try:
        record = _load_execution_job_record_for_run(run)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if record is None:
        raise HTTPException(
            status_code=404,
            detail=f"Execution job record for run {run_id} not found",
        )
    return _execution_job_record_payload(record, run=run)


@router.post("/preflight")
async def run_preflight(request: PreflightRequest) -> dict[str, Any]:
    """Check if all requirements are met before starting a run.

    Verifies that:
    - All pipeline operator classes can be imported (no missing packages)
    - The configured Python matches the running backend interpreter

    Returns:
        ``ready: true`` if all checks pass, otherwise ``ready: false`` with a
        list of issues describing what is missing.

    Issue types:
        - ``env_mismatch``: Electron is configured for a different Python than
          the running backend. User should restart the backend.
        - ``not_found``: A referenced ``pipeline_id`` does not exist in the
          workspace.
        - ``missing_module``: An operator class cannot be imported because a
          required package is not installed.  Issue ``details`` contains
          ``step_name``, ``step_type``, and ``error``.
    """
    from .nirs4all_adapter import check_pipeline_imports
    from .pipelines import _load_pipeline
    from .system import check_env_coherence

    issues: list[dict[str, Any]] = []

    # Check environment coherence
    try:
        coherence = await check_env_coherence()
        if not coherence["coherent"]:
            issues.append({
                "type": "env_mismatch",
                "message": "Package environment does not match the running backend. Restart the backend to resolve this.",
            })
    except Exception:
        pass  # Non-fatal — coherence check failure shouldn't block preflight

    # Collect all pipeline steps to check
    pipeline_steps: list[tuple[str, str | None, list[dict[str, Any]]]] = []

    for pipeline_id in request.pipeline_ids:
        try:
            pipeline_config = _load_pipeline(pipeline_id)
            steps = pipeline_config.get("steps", [])
            pipeline_steps.append((pipeline_config.get("name", pipeline_id), pipeline_id, steps))
        except HTTPException as exc:
            if exc.status_code == 404:
                issues.append({
                    "type": "not_found",
                    "message": f"Pipeline '{pipeline_id}' not found.",
                })
            elif exc.status_code == 409:
                issues.append({
                    "type": "no_workspace",
                    "message": "No workspace selected. Open a workspace before running.",
                })
            else:
                issues.append({
                    "type": "load_error",
                    "message": f"Failed to load pipeline '{pipeline_id}': {exc.detail}",
                })

    inline_pipelines = list(request.inline_pipelines)
    if request.inline_pipeline:
        inline_pipelines.insert(0, request.inline_pipeline)

    for inline_pipeline in inline_pipelines:
        pipeline_steps.append((inline_pipeline.name, None, inline_pipeline.steps))

    # Check imports for each pipeline
    for pipeline_name, pipeline_ref, steps in pipeline_steps:
        import_issues = check_pipeline_imports(steps)
        for issue in import_issues:
            issues.append({
                "type": "missing_module",
                "message": f"Pipeline '{pipeline_name}': {issue['error']}. Install it via Settings > Advanced > Dependencies.",
                "details": {
                    **issue,
                    "pipeline_name": pipeline_name,
                    "pipeline_id": pipeline_ref,
                },
            })

    return {
        "ready": len(issues) == 0,
        "issues": issues,
    }


@router.post("", response_model=Run)
async def create_run(request: CreateRunRequest):
    """Create and start a new run (experiment)."""
    _ensure_runs_loaded()
    config = request.config

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Validate that at least one pipeline is specified (either saved or inline)
    if not config.pipeline_ids and not config.inline_pipeline and not config.inline_pipelines:
        raise HTTPException(
            status_code=422,
            detail="At least one pipeline (saved or inline) must be specified"
        )

    _get_available_execution_driver(config.execution_backend)

    try:
        config.split_group_by_by_dataset = normalize_split_group_by_mapping(
            config.dataset_ids,
            config.split_group_by_by_dataset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Validate that datasets exist
    from .spectra import _load_dataset
    dataset_infos = {}
    datasets_by_id = {}
    for dataset_id in config.dataset_ids:
        try:
            dataset = _load_dataset(dataset_id)
            if not dataset:
                raise HTTPException(
                    status_code=404,
                    detail=f"Dataset '{dataset_id}' not found"
                )
            dataset_infos[dataset_id] = {
                "name": dataset.name if hasattr(dataset, 'name') else dataset_id,
                "id": dataset_id,
            }
            datasets_by_id[dataset_id] = dataset
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=404,
                detail=f"Dataset '{dataset_id}' not found: {str(e)}"
            )

    # Validate that pipelines exist
    from .pipelines import _load_pipeline
    pipeline_configs = {}
    pipeline_ids_to_use = list(config.pipeline_ids)

    for pipeline_id in config.pipeline_ids:
        try:
            pipeline_config = _load_pipeline(pipeline_id)
            pipeline_configs[pipeline_id] = pipeline_config
        except HTTPException:
            raise HTTPException(
                status_code=404,
                detail=f"Pipeline '{pipeline_id}' not found"
            )
        except Exception as e:
            raise HTTPException(
                status_code=404,
                detail=f"Pipeline '{pipeline_id}' not found: {str(e)}"
            )

    inline_pipelines = list(config.inline_pipelines)
    if config.inline_pipeline:
        inline_pipelines.insert(0, config.inline_pipeline)

    # Handle inline pipelines from editor/pruned launches
    for index, inline_pipeline in enumerate(inline_pipelines):
        inline_id = "__inline__" if index == 0 else f"__inline_{index}__"
        pipeline_ids_to_use.append(inline_id)
        pipeline_configs[inline_id] = {
            "name": inline_pipeline.name,
            "steps": inline_pipeline.steps,
        }

    for dataset_id in config.dataset_ids:
        runtime_group_by = config.split_group_by_by_dataset.get(dataset_id)
        dataset_object = datasets_by_id[dataset_id]
        for pipeline_id in pipeline_ids_to_use:
            pipeline_config = pipeline_configs.get(pipeline_id, {})
            steps = pipeline_config.get("steps", [])
            try:
                prepare_pipeline_steps_with_runtime_grouping(
                    steps,
                    dataset_object,
                    runtime_group_by,
                )
            except Exception as exc:
                pipeline_name = pipeline_config.get("name", pipeline_id)
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Dataset '{dataset_id}' cannot run pipeline "
                        f"'{pipeline_name}': {exc}"
                    ),
                ) from exc

    # Create run from validated config (use modified pipeline_ids)
    run = _create_run_from_config(config, dataset_infos, pipeline_configs, workspace.path, pipeline_ids_to_use)
    _runs[run.id] = run
    _save_run_manifest(run)

    # Execute on the shared JobManager thread pool (keeps the event loop free)
    _start_run_job(run)

    return run


def _single_pair_campaign_parts(split_spec: CampaignSinglePairSplitSpecPayload) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    campaign = split_spec.campaign
    if campaign.get("mode") != "paired_by_index":
        raise HTTPException(status_code=400, detail=f"Campaign split '{split_spec.id}' must use paired_by_index mode")

    datasets = campaign.get("datasets")
    pipelines = campaign.get("pipelines")
    run_matrix = campaign.get("runMatrix")
    if not isinstance(datasets, list) or len(datasets) != 1:
        raise HTTPException(status_code=400, detail=f"Campaign split '{split_spec.id}' must contain exactly one dataset")
    if not isinstance(pipelines, list) or len(pipelines) != 1:
        raise HTTPException(status_code=400, detail=f"Campaign split '{split_spec.id}' must contain exactly one pipeline")
    if not isinstance(run_matrix, list) or len(run_matrix) != 1:
        raise HTTPException(status_code=400, detail=f"Campaign split '{split_spec.id}' must contain exactly one run entry")
    if not isinstance(datasets[0], dict) or not isinstance(pipelines[0], dict) or not isinstance(run_matrix[0], dict):
        raise HTTPException(status_code=400, detail=f"Campaign split '{split_spec.id}' contains malformed refs")

    return campaign, datasets[0], pipelines[0], run_matrix[0]


def _validate_native_run_group_payload(payload: NativeExperimentLaunchPayload) -> list[CampaignSinglePairSplitSpecPayload]:
    config = payload.legacyConfig
    split_specs = payload.strictCampaignSpecs.splitSpecs
    skipped_run_ids = [*payload.strictCampaignSpecs.skippedRunIds, *payload.manifest.skippedRunIds]

    if skipped_run_ids or payload.manifest.skippedRunCount > 0:
        raise HTTPException(status_code=400, detail="Native run-group payload contains skipped run ids")
    if payload.manifest.strictCampaignCount != len(split_specs):
        raise HTTPException(status_code=400, detail="Native run-group manifest strictCampaignCount does not match splitSpecs")
    if not split_specs:
        raise HTTPException(status_code=422, detail="Native run-group payload must contain at least one strict campaign spec")

    for split_spec in split_specs:
        campaign, dataset_ref, pipeline_ref, run_entry = _single_pair_campaign_parts(split_spec)
        if campaign.get("executionBackend") != config.execution_backend:
            raise HTTPException(status_code=400, detail=f"Campaign split '{split_spec.id}' execution backend does not match legacyConfig")

        dataset_id = run_entry.get("datasetId") or dataset_ref.get("id")
        pipeline_id = run_entry.get("pipelineId") or pipeline_ref.get("id")
        if dataset_id != split_spec.sourceDatasetId:
            raise HTTPException(status_code=400, detail=f"Campaign split '{split_spec.id}' dataset id does not match sourceDatasetId")
        if pipeline_id != split_spec.sourcePipelineId:
            raise HTTPException(status_code=400, detail=f"Campaign split '{split_spec.id}' pipeline id does not match sourcePipelineId")

        source = pipeline_ref.get("source")
        if source in {"inline", "inline-pruned"} and not isinstance(pipeline_ref.get("steps"), list):
            raise HTTPException(status_code=422, detail=f"Campaign split '{split_spec.id}' inline pipeline is missing executable steps")

    return split_specs


def _build_dataset_runs_from_execution_plan(execution_plan) -> list[DatasetRun]:
    datasets = []
    for dataset_plan in execution_plan.datasets:
        pipelines = [
            PipelineRun(
                id=pipeline_plan.pipeline_run_id,
                pipeline_id=pipeline_plan.pipeline_id,
                pipeline_name=pipeline_plan.pipeline_name,
                model=pipeline_plan.model,
                preprocessing=pipeline_plan.preprocessing,
                split_strategy=pipeline_plan.split_strategy,
                status="queued",
                progress=0,
                config=pipeline_plan.pipeline_config,
                variant_index=pipeline_plan.variant_index,
                variant_description=pipeline_plan.variant_description,
                variant_choices=pipeline_plan.variant_choices,
                is_expanded_variant=pipeline_plan.is_expanded_variant,
                estimated_variants=pipeline_plan.estimated_variants,
                has_generators=pipeline_plan.has_generators,
                fold_count=pipeline_plan.fold_count,
                branch_count=pipeline_plan.branch_count,
                total_model_count=pipeline_plan.total_model_count,
                model_count_breakdown=pipeline_plan.model_count_breakdown,
            )
            for pipeline_plan in dataset_plan.pipelines
        ]
        datasets.append(
            DatasetRun(
                dataset_id=dataset_plan.dataset_id,
                dataset_name=dataset_plan.dataset_name,
                split_group_by=dataset_plan.split_group_by,
                pipelines=pipelines,
            )
        )
    return datasets


@router.post("/run-groups", response_model=Run)
async def create_run_group(payload: NativeExperimentLaunchPayload):
    """Create and start an explicit run group from a native campaign payload."""
    _ensure_runs_loaded()
    config = payload.legacyConfig
    split_specs = _validate_native_run_group_payload(payload)

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    _get_available_execution_driver(config.execution_backend)

    from .pipelines import _load_pipeline
    from .spectra import _load_dataset

    dataset_infos: dict[str, dict[str, str]] = {}
    datasets_by_id: dict[str, Any] = {}
    pipeline_configs: dict[str, dict[str, Any]] = {}

    for split_spec in split_specs:
        _, dataset_ref, pipeline_ref, run_entry = _single_pair_campaign_parts(split_spec)
        dataset_id = str(run_entry.get("datasetId") or dataset_ref.get("id"))
        pipeline_id = str(run_entry.get("pipelineId") or pipeline_ref.get("id"))

        if dataset_id not in dataset_infos:
            try:
                dataset = _load_dataset(dataset_id)
                if not dataset:
                    raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")
                dataset_infos[dataset_id] = {
                    "name": getattr(dataset, "name", None) or str(dataset_ref.get("name") or dataset_id),
                    "id": dataset_id,
                }
                datasets_by_id[dataset_id] = dataset
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found: {str(e)}") from e

        source = pipeline_ref.get("source")
        if source in {"inline", "inline-pruned"}:
            pipeline_config = {
                "name": str(pipeline_ref.get("name") or pipeline_id),
                "steps": pipeline_ref.get("steps") or [],
            }
        else:
            if pipeline_id not in pipeline_configs:
                try:
                    pipeline_configs[pipeline_id] = _load_pipeline(pipeline_id)
                except HTTPException:
                    raise HTTPException(status_code=404, detail=f"Pipeline '{pipeline_id}' not found") from None
                except Exception as e:
                    raise HTTPException(status_code=404, detail=f"Pipeline '{pipeline_id}' not found: {str(e)}") from e
            pipeline_config = pipeline_configs[pipeline_id]

        runtime_group_by = run_entry.get("splitGroupBy")
        if runtime_group_by is None:
            runtime_group_by = dataset_ref.get("splitGroupBy")
        try:
            prepare_pipeline_steps_with_runtime_grouping(
                pipeline_config.get("steps", []),
                datasets_by_id[dataset_id],
                runtime_group_by,
            )
        except Exception as exc:
            pipeline_name = pipeline_config.get("name", pipeline_id)
            raise HTTPException(
                status_code=400,
                detail=f"Dataset '{dataset_id}' cannot run pipeline '{pipeline_name}': {exc}",
            ) from exc

    run = _create_run_group_from_payload(payload, dataset_infos, pipeline_configs, workspace.path)
    _runs[run.id] = run
    _save_run_manifest(run)
    _start_run_job(run)
    return run


def _create_run_group_from_payload(
    payload: NativeExperimentLaunchPayload,
    dataset_infos: dict[str, dict[str, str]],
    pipeline_configs: dict[str, dict[str, Any]],
    workspace_path: str,
    expand_variants: bool = True,
) -> Run:
    config = payload.legacyConfig
    run_id = f"run_{int(datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
    now = datetime.now().isoformat()

    def expand_pipeline_variants_for_plan(steps: list[dict[str, Any]]) -> Any:
        from .nirs4all_adapter import expand_pipeline_variants

        return expand_pipeline_variants(steps)

    execution_plan = build_campaign_run_group_execution_plan(
        run_id=run_id,
        split_specs=[split_spec.model_dump() for split_spec in payload.strictCampaignSpecs.splitSpecs],
        dataset_infos=dataset_infos,
        pipeline_configs=pipeline_configs,
        cv_folds=config.cv_folds,
        expand_variants=expand_variants,
        extract_pipeline_info=_extract_pipeline_info,
        estimate_pipeline_variants=_estimate_pipeline_variants,
        expand_pipeline_variants=expand_pipeline_variants_for_plan,
    )

    return Run(
        id=run_id,
        name=config.name,
        description=config.description or "",
        execution_backend=config.execution_backend,
        engine=config.engine,
        allow_fallback=config.allow_fallback,
        datasets=_build_dataset_runs_from_execution_plan(execution_plan),
        status="queued",
        created_at=now,
        cv_folds=config.cv_folds,
        total_pipelines=execution_plan.total_pipeline_runs,
        completed_pipelines=0,
        workspace_path=workspace_path,
        project_id=config.project_id,
        execution_metadata={
            "campaign_shape": "explicit-run-group",
            "native_payload_version": payload.manifest.version,
            "source_run_ids": payload.manifest.sourceRunIds,
            "skipped_run_ids": payload.manifest.skippedRunIds,
            "strict_campaign_count": payload.manifest.strictCampaignCount,
        },
    )


def _create_run_from_config(
    config: ExperimentConfig,
    dataset_infos: dict[str, dict[str, str]],
    pipeline_configs: dict[str, dict],
    workspace_path: str,
    pipeline_ids: list[str] | None = None,
    expand_variants: bool = True,
) -> Run:
    """Create a run from validated experiment config.

    Args:
        config: Experiment configuration
        dataset_infos: Dataset info by ID
        pipeline_configs: Pipeline configs by ID
        workspace_path: Path to workspace
        pipeline_ids: Pipeline IDs to use (defaults to config.pipeline_ids)
        expand_variants: If True, expand generators/sweeps into separate PipelineRun entries
    """
    run_id = f"run_{int(datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
    now = datetime.now().isoformat()

    # Use provided pipeline_ids or fall back to config.pipeline_ids
    effective_pipeline_ids = pipeline_ids if pipeline_ids is not None else list(config.pipeline_ids)

    def expand_pipeline_variants_for_plan(steps: list[dict[str, Any]]) -> Any:
        from .nirs4all_adapter import expand_pipeline_variants

        return expand_pipeline_variants(steps)

    execution_plan = build_legacy_run_execution_plan(
        run_id=run_id,
        dataset_ids=config.dataset_ids,
        effective_pipeline_ids=effective_pipeline_ids,
        dataset_infos=dataset_infos,
        pipeline_configs=pipeline_configs,
        split_group_by_by_dataset=config.split_group_by_by_dataset,
        cv_folds=config.cv_folds,
        expand_variants=expand_variants,
        extract_pipeline_info=_extract_pipeline_info,
        estimate_pipeline_variants=_estimate_pipeline_variants,
        expand_pipeline_variants=expand_pipeline_variants_for_plan,
    )

    run = Run(
        id=run_id,
        name=config.name,
        description=config.description or "",
        execution_backend=config.execution_backend,
        engine=config.engine,
        allow_fallback=config.allow_fallback,
        datasets=_build_dataset_runs_from_execution_plan(execution_plan),
        status="queued",
        created_at=now,
        cv_folds=config.cv_folds,
        total_pipelines=execution_plan.total_pipeline_runs,
        completed_pipelines=0,
        workspace_path=workspace_path,
        project_id=config.project_id,
    )

    return run


@dataclass
class PipelineEstimate:
    """Estimated execution stats for a pipeline."""
    estimated_variants: int
    has_generators: bool
    fold_count: int = 1
    branch_count: int = 1
    total_model_count: int = 1
    model_count_breakdown: str = ""


def _estimate_fold_count(steps: list[dict[str, Any]], cv_folds: int | None = None) -> int:
    """Estimate CV fold count from editor steps, with explicit request override."""
    fold_count = cv_folds or 1

    def visit(step_list: list[dict[str, Any]]) -> None:
        nonlocal fold_count
        for step in step_list:
            if step.get("type") == "splitting":
                params = step.get("params") or {}
                raw_value = params.get("n_splits", params.get("cv_folds"))
                if isinstance(raw_value, (int, float)) and int(raw_value) > 0:
                    fold_count = int(raw_value)

            children = step.get("children") or []
            if children:
                visit(children)

            for branch in step.get("branches") or []:
                visit(branch)

    visit(steps)
    return fold_count


def _estimate_branch_count(steps: list[dict[str, Any]]) -> int:
    """Estimate branching fan-out from editor-only structural nodes."""
    branch_count = 1

    def visit(step_list: list[dict[str, Any]]) -> None:
        nonlocal branch_count
        for step in step_list:
            step_type = step.get("type", "")
            sub_type = step.get("subType", "")
            branches = step.get("branches") or []

            is_branch_container = (
                (step_type == "flow" and sub_type in ("branch", "concat_transform"))
                or (step_type == "generator" and bool(branches))
                or (step_type == "utility" and sub_type == "generator" and bool(branches))
            )
            if is_branch_container and branches:
                branch_count = max(branch_count, len(branches))

            children = step.get("children") or []
            if children:
                visit(children)

            for branch in branches:
                visit(branch)

    visit(steps)
    return branch_count


def _estimate_pipeline_variants(pipeline_config: dict, cv_folds: int | None = None) -> PipelineEstimate:
    """
    Estimate the number of pipeline variants and model count from a configuration.

    Variant counts come from the canonical runtime payload so they match
    nirs4all's library semantics. Fold/branch counts remain lightweight
    editor-structure estimates for UI progress metadata.
    """
    steps = pipeline_config.get("steps", [])
    fold_count = _estimate_fold_count(steps, cv_folds=cv_folds)
    branch_count = _estimate_branch_count(steps)

    try:
        canonical_steps = editor_steps_to_runtime_canonical(steps)
        estimated_variants = count_runtime_variants(canonical_steps)
        has_generators = contains_generators(canonical_steps)
    except Exception as exc:
        pipeline_name = pipeline_config.get("name") or pipeline_config.get("id") or "<unknown>"
        logger.warning(
            "Falling back to default pipeline estimate for %s because canonicalization failed: %s",
            pipeline_name,
            exc,
        )
        estimated_variants = 1
        has_generators = False

    total_model_count = fold_count * branch_count * estimated_variants

    parts = []
    if fold_count > 1:
        parts.append(f"{fold_count} folds")
    if branch_count > 1:
        parts.append(f"{branch_count} branches")
    if estimated_variants > 1:
        parts.append(f"{estimated_variants} variants")

    if parts:
        model_count_breakdown = " × ".join(parts) + f" = {total_model_count} models"
    else:
        model_count_breakdown = "1 model"

    return PipelineEstimate(
        estimated_variants=estimated_variants,
        has_generators=has_generators,
        fold_count=fold_count,
        branch_count=branch_count,
        total_model_count=total_model_count,
        model_count_breakdown=model_count_breakdown,
    )


@router.post("/quick", response_model=Run)
async def quick_run(request: QuickRunRequest):
    """
    Quick Run (Run A): Execute a single pipeline on a single dataset.

    This is the simplified run interface that:
    - Creates a run with persistence
    - Navigates to /runs/{id} for progress tracking
    - Auto-saves model and exports to workspace
    """
    _ensure_runs_loaded()
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    try:
        request.split_group_by_by_dataset = normalize_split_group_by_mapping(
            [request.dataset_id],
            request.split_group_by_by_dataset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Load pipeline configuration
    if request.inline_pipeline:
        pipeline_config = {
            "name": request.inline_pipeline.name,
            "steps": request.inline_pipeline.steps,
        }
    else:
        from .pipelines import _load_pipeline
        try:
            pipeline_config = _load_pipeline(request.pipeline_id)
        except HTTPException:
            raise HTTPException(
                status_code=404,
                detail=f"Pipeline '{request.pipeline_id}' not found",
            )

    # Load dataset info
    from .spectra import _load_dataset
    dataset = _load_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset '{request.dataset_id}' not found",
        )

    runtime_group_by = request.split_group_by_by_dataset.get(request.dataset_id)
    try:
        prepare_pipeline_steps_with_runtime_grouping(
            pipeline_config.get("steps", []),
            dataset,
            runtime_group_by,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Dataset '{request.dataset_id}' cannot run pipeline "
                f"'{pipeline_config.get('name', request.pipeline_id)}': {exc}"
            ),
        ) from exc

    dataset_info = {
        "name": dataset.name if hasattr(dataset, 'name') else request.dataset_id,
        "id": request.dataset_id,
    }

    # Create run
    run = _create_quick_run(request, pipeline_config, dataset_info)
    _runs[run.id] = run
    _save_run_manifest(run)

    # Execute on the shared JobManager thread pool (keeps the event loop free)
    _start_run_job(run)

    return run


@router.post("/{run_id}/stop", response_model=RunActionResponse)
async def stop_run(run_id: str):
    """Stop a running experiment."""
    _ensure_runs_loaded()
    if run_id not in _runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    run = _runs[run_id]
    response, _ = _cancel_run(run, job_id=run_id)
    return response


@router.post("/{run_id}/retry", response_model=Run)
async def retry_run(run_id: str):
    """Retry a failed run."""
    _ensure_runs_loaded()
    if run_id not in _runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    old_run = _runs[run_id]
    if old_run.status != "failed":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot retry run with status {old_run.status}"
        )

    new_run_id = str(uuid.uuid4())[:8]
    now = datetime.now().isoformat()
    retry_plan = build_retry_run_execution_plan(
        old_run=old_run,
        new_run_id=new_run_id,
        created_at=now,
    )

    new_run = Run(
        id=retry_plan.run_id,
        name=retry_plan.name,
        description=retry_plan.description,
        execution_backend=retry_plan.execution_backend,
        # Preserve the experiment's requested ML engine across the retry so a
        # dag-ml selection is not silently downgraded to the library default on
        # re-run (B-017/B-018). Orthogonal to execution_backend; the engine that
        # actually ran is recorded per-pipeline during execution.
        engine=old_run.engine,
        allow_fallback=old_run.allow_fallback,
        datasets=[
            DatasetRun(
                dataset_id=dataset.dataset_id,
                dataset_name=dataset.dataset_name,
                split_group_by=dataset.split_group_by,
                pipelines=[
                    PipelineRun(
                        id=pipeline.pipeline_run_id,
                        pipeline_id=pipeline.pipeline_id,
                        pipeline_name=pipeline.pipeline_name,
                        model=pipeline.model,
                        preprocessing=pipeline.preprocessing,
                        split_strategy=pipeline.split_strategy,
                        status=pipeline.status,
                        progress=pipeline.progress,
                        config=pipeline.pipeline_config,
                        variant_index=pipeline.variant_index,
                        variant_description=pipeline.variant_description,
                        variant_choices=pipeline.variant_choices,
                        is_expanded_variant=pipeline.is_expanded_variant,
                        estimated_variants=pipeline.estimated_variants,
                        has_generators=pipeline.has_generators,
                        fold_count=pipeline.fold_count,
                        branch_count=pipeline.branch_count,
                        total_model_count=pipeline.total_model_count,
                        model_count_breakdown=pipeline.model_count_breakdown,
                    )
                    for pipeline in dataset.pipelines
                ],
            )
            for dataset in retry_plan.datasets
        ],
        status=retry_plan.status,
        created_at=retry_plan.created_at,
        cv_folds=retry_plan.cv_folds,
        total_pipelines=retry_plan.total_pipelines,
        completed_pipelines=retry_plan.completed_pipelines,
        workspace_path=retry_plan.workspace_path,
        project_id=retry_plan.project_id,
    )

    _get_available_execution_driver(new_run.execution_backend)

    _runs[new_run_id] = new_run

    # Execute on the shared JobManager thread pool
    _start_run_job(new_run)

    return new_run


@router.delete("/{run_id}", response_model=RunActionResponse)
async def delete_run(run_id: str):
    """Delete a run."""
    _ensure_runs_loaded()
    if run_id not in _runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    run = _runs[run_id]
    if run.status in ("running", "queued"):
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a running experiment. Stop it first."
        )

    try:
        _delete_run_manifest_dir(run)
    except Exception as exc:
        logger.error("Failed to delete persisted run directory for %s: %s", run_id, exc)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete persisted run {run_id}",
        ) from exc

    if run.store_run_id and run.workspace_path:
        try:
            _open_run_store_repository(run.workspace_path).delete_run(run.store_run_id)
        except Exception as exc:
            logger.warning("Failed to delete store run %s for run %s: %s", run.store_run_id, run_id, exc)

    del _runs[run_id]

    return RunActionResponse(
        success=True,
        message=f"Run {run_id} deleted",
        run_id=run_id,
    )


@router.get("/{run_id}/logs/{pipeline_id}")
async def get_pipeline_logs(run_id: str, pipeline_id: str):
    """Get logs for a specific pipeline within a run."""
    _ensure_runs_loaded()
    if run_id not in _runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    run = _runs[run_id]

    for dataset in run.datasets:
        for pipeline in dataset.pipelines:
            if pipeline.id == pipeline_id:
                return {
                    "pipeline_id": pipeline_id,
                    "logs": pipeline.logs or [
                        "[INFO] Starting pipeline execution...",
                        "[INFO] Loading dataset...",
                        f"[INFO] Applying {pipeline.preprocessing} preprocessing...",
                        f"[INFO] Training {pipeline.model} model...",
                        "[INFO] Evaluating model performance...",
                    ],
                }

    raise HTTPException(
        status_code=404,
        detail=f"Pipeline {pipeline_id} not found in run {run_id}"
    )
