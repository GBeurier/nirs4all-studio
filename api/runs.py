"""
Runs API endpoints for nirs4all webapp.
Phase 8: Runs Management (Run A Implementation)

This module provides endpoints for managing experiment runs:
- List all runs
- Get run details
- Create new run (experiment) with persistence
- Real-time progress via WebSocket
- Stop/pause running experiments
- Retry failed runs
- Delete runs
- Quick run endpoint for single pipeline execution
"""

import asyncio
import json
import math
import re
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Union

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager
from .shared.logger import get_logger

logger = get_logger(__name__)


# ============================================================================
# Log Parsing Patterns for Granular Progress
# ============================================================================

# Fold patterns: "Fold 3/5", "fold 3 of 5", "[Fold 3]"
FOLD_PATTERN = re.compile(r"[Ff]old\s*(\d+)\s*[/of]+\s*(\d+)", re.IGNORECASE)
FOLD_START_PATTERN = re.compile(r"[Ff]old\s*(\d+)\s*[:|-]?\s*[Ss]tart", re.IGNORECASE)
FOLD_COMPLETE_PATTERN = re.compile(r"[Ff]old\s*(\d+)\s*[:|-]?\s*[Cc]omplete|[Dd]one|[Ff]inish", re.IGNORECASE)

# Branch patterns: "Branch [0]:", "branch 1:", "Branch: SNV -> PLS"
BRANCH_PATTERN = re.compile(r"[Bb]ranch\s*\[?(\d+)\]?\s*[:|-]\s*(.+)")
BRANCH_NAME_PATTERN = re.compile(r"[Bb]ranch:\s*(.+)")

# Variant patterns: "Variant 2/6", "Config 3 of 10", "Testing variant 5"
VARIANT_PATTERN = re.compile(r"[Vv]ariant\s*(\d+)\s*[/of]+\s*(\d+)", re.IGNORECASE)
CONFIG_PATTERN = re.compile(r"[Cc]onfig(?:uration)?\s*(\d+)\s*[/of]+\s*(\d+)", re.IGNORECASE)

# Step patterns: "Step 2/10", "Processing step 3"
STEP_PATTERN = re.compile(r"[Ss]tep\s*(\d+)\s*[/of]+\s*(\d+)", re.IGNORECASE)


def parse_log_for_progress(log_entry: str) -> Dict[str, Any]:
    """
    Parse a log entry for granular progress information.

    Returns dict with parsed info:
    - fold_id, total_folds: if fold progress detected
    - branch_path, branch_name: if branch info detected
    - variant_index, total_variants, variant_description: if variant progress detected
    - step_index, total_steps: if step progress detected
    """
    result = {}

    # Check for fold patterns
    fold_match = FOLD_PATTERN.search(log_entry)
    if fold_match:
        result["fold_id"] = int(fold_match.group(1))
        result["total_folds"] = int(fold_match.group(2))

    # Check for fold start
    fold_start = FOLD_START_PATTERN.search(log_entry)
    if fold_start:
        result["fold_id"] = int(fold_start.group(1))
        result["fold_status"] = "started"

    # Check for fold complete
    fold_complete = FOLD_COMPLETE_PATTERN.search(log_entry)
    if fold_complete:
        result["fold_id"] = int(fold_complete.group(1))
        result["fold_status"] = "completed"

    # Check for branch patterns
    branch_match = BRANCH_PATTERN.search(log_entry)
    if branch_match:
        result["branch_path"] = [int(branch_match.group(1))]
        result["branch_name"] = branch_match.group(2).strip()

    branch_name_match = BRANCH_NAME_PATTERN.search(log_entry)
    if branch_name_match and "branch_name" not in result:
        result["branch_name"] = branch_name_match.group(1).strip()

    # Check for variant patterns
    variant_match = VARIANT_PATTERN.search(log_entry)
    if variant_match:
        result["variant_index"] = int(variant_match.group(1))
        result["total_variants"] = int(variant_match.group(2))

    config_match = CONFIG_PATTERN.search(log_entry)
    if config_match and "variant_index" not in result:
        result["variant_index"] = int(config_match.group(1))
        result["total_variants"] = int(config_match.group(2))

    # Check for step patterns
    step_match = STEP_PATTERN.search(log_entry)
    if step_match:
        result["step_index"] = int(step_match.group(1))
        result["total_steps"] = int(step_match.group(2))

    return result


def _sanitize_float(value: Union[float, int, None]) -> Optional[float]:
    """Sanitize float values for JSON serialization (NaN/Inf -> None)."""
    if value is None:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return float(value)


def _sanitize_metrics(metrics: dict) -> dict:
    """Sanitize all float values in a metrics dict for JSON serialization."""
    return {k: _sanitize_float(v) if isinstance(v, (int, float)) else v for k, v in metrics.items()}

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
    r2: Optional[float] = None
    rmse: Optional[float] = None
    mae: Optional[float] = None
    rpd: Optional[float] = None
    nrmse: Optional[float] = None


class PipelineRun(BaseModel):
    """Status of a single pipeline within a run."""
    id: str
    pipeline_id: str
    pipeline_name: str
    model: str
    preprocessing: str
    split_strategy: str
    status: Literal["queued", "running", "completed", "failed", "paused"]
    progress: int = 0
    metrics: Optional[RunMetrics] = None
    config: Optional[dict] = None
    logs: Optional[List[str]] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error_message: Optional[str] = None
    model_path: Optional[str] = None  # Path to saved model
    # Variant tracking for sweeps/branches
    variant_index: Optional[int] = None  # Index of this variant (0-based)
    variant_description: Optional[str] = None  # Human-readable description (e.g., "n_components=10 | StandardScaler")
    variant_choices: Optional[dict] = None  # Raw choices for this variant
    estimated_variants: Optional[int] = 1  # Number of pipeline variants to test
    tested_variants: Optional[int] = None  # Actual variants tested after completion
    has_generators: Optional[bool] = False  # Whether pipeline has sweeps/branches
    is_expanded_variant: Optional[bool] = False  # True if this is an expanded variant
    # Model count breakdown (folds × branches × variants)
    fold_count: Optional[int] = None  # Number of CV folds
    branch_count: Optional[int] = None  # Number of pipeline branches
    total_model_count: Optional[int] = None  # Total models: folds × branches × variants
    model_count_breakdown: Optional[str] = None  # Human-readable: "5 folds × 3 branches = 15 models"
    # Granular progress tracking
    current_fold: Optional[int] = None  # Current fold being trained (1-based)
    current_branch: Optional[str] = None  # Current branch name
    current_variant: Optional[int] = None  # Current variant index (1-based)
    fold_metrics: Optional[Dict[int, RunMetrics]] = None  # Per-fold metrics


class DatasetRun(BaseModel):
    """Status of all pipelines for a single dataset."""
    dataset_id: str
    dataset_name: str
    pipelines: List[PipelineRun]


class Run(BaseModel):
    """Complete run (experiment) information."""
    id: str
    name: str
    description: Optional[str] = None
    datasets: List[DatasetRun]
    status: Literal["queued", "running", "completed", "failed", "paused"]
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration: Optional[str] = None
    created_by: Optional[str] = None
    cv_folds: Optional[int] = None
    total_pipelines: Optional[int] = None
    completed_pipelines: Optional[int] = None
    workspace_path: Optional[str] = None  # For persistence
    store_run_id: Optional[str] = None  # DuckDB WorkspaceStore run UUID
    project_id: Optional[str] = None  # Project grouping


class InlinePipeline(BaseModel):
    """Inline pipeline definition for unsaved pipelines from editor."""
    name: str
    steps: List[Dict[str, Any]]


class ExperimentConfig(BaseModel):
    """Configuration for creating a new experiment."""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    dataset_ids: List[str] = Field(..., min_length=1)
    pipeline_ids: List[str] = Field(default_factory=list)  # Can be empty if inline_pipeline is provided
    cv_folds: int = Field(default=5, ge=2, le=50)
    cv_strategy: Literal["kfold", "stratified", "loo", "holdout"] = "kfold"
    test_size: Optional[float] = Field(default=0.2, ge=0.1, le=0.5)
    shuffle: bool = True
    random_state: Optional[int] = None
    inline_pipeline: Optional[InlinePipeline] = None  # Unsaved pipeline from editor
    project_id: Optional[str] = None  # Project grouping


class QuickRunRequest(BaseModel):
    """Request for quick single-pipeline run (Run A)."""
    pipeline_id: str = Field(..., description="ID of the pipeline to run")
    dataset_id: str = Field(..., description="ID of the dataset to train on")
    name: Optional[str] = Field(None, description="Optional run name")
    export_model: bool = Field(True, description="Save trained model")
    cv_folds: int = Field(default=5, ge=2, le=50)
    random_state: Optional[int] = Field(42, description="Random seed")


class CreateRunRequest(BaseModel):
    """Request body for creating a new run."""
    config: ExperimentConfig


class RunActionResponse(BaseModel):
    """Response for run actions (stop, pause, retry)."""
    success: bool
    message: str
    run_id: Optional[str] = None


class RunListResponse(BaseModel):
    """Response for listing runs."""
    runs: List[Run]
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

_runs: Dict[str, Run] = {}
_run_cancellation_flags: Dict[str, bool] = {}  # Track cancellation requests
_runs_loaded: bool = False  # Track if runs have been loaded from disk
_current_workspace_path: Optional[str] = None  # Track which workspace runs were loaded for


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


def _get_runs_dir() -> Optional[Path]:
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
    def default(self, obj):
        return super().default(obj)

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
    """Save run manifest to workspace for persistence."""
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


def _sanitize_run_metrics(data: dict) -> dict:
    """Sanitize metrics in a run data dict loaded from disk."""
    for dataset in data.get("datasets", []):
        for pipeline in dataset.get("pipelines", []):
            if pipeline.get("metrics"):
                pipeline["metrics"] = _sanitize_metrics(pipeline["metrics"])
    return data


def _load_persisted_runs() -> List[Run]:
    """Load persisted runs from workspace.

    Checks both the correct location (workspace/runs) and legacy location
    (workspace/workspace/runs) for backward compatibility.
    """
    runs = []
    seen_run_ids = set()

    # Primary location: workspace.path / "runs"
    runs_dir = _get_runs_dir()
    if runs_dir and runs_dir.exists():
        for run_dir in runs_dir.iterdir():
            if not run_dir.is_dir():
                continue
            manifest_path = run_dir / "manifest.json"
            if manifest_path.exists():
                try:
                    with open(manifest_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        data = _sanitize_run_metrics(data)
                        run = Run(**data)
                        runs.append(run)
                        seen_run_ids.add(run.id)
                except Exception as e:
                    logger.error("Error loading run %s: %s", run_dir.name, e)

    # Legacy location: workspace.path / "workspace" / "runs"
    # (for runs created before the path fix)
    workspace = workspace_manager.get_current_workspace()
    if workspace:
        legacy_runs_dir = Path(workspace.path) / "workspace" / "runs"
        if legacy_runs_dir.exists() and legacy_runs_dir != runs_dir:
            for run_dir in legacy_runs_dir.iterdir():
                if not run_dir.is_dir():
                    continue
                manifest_path = run_dir / "manifest.json"
                if manifest_path.exists():
                    try:
                        with open(manifest_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            data = _sanitize_run_metrics(data)
                            run = Run(**data)
                            # Avoid duplicates
                            if run.id not in seen_run_ids:
                                runs.append(run)
                                seen_run_ids.add(run.id)
                    except Exception as e:
                        logger.error("Error loading legacy run %s: %s", run_dir.name, e)

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
        datasets=[dataset_run],
        status="queued",
        created_at=now,
        cv_folds=request.cv_folds,
        total_pipelines=len(pipelines),
        completed_pipelines=0,
        workspace_path=workspace.path if workspace else None,
    )

    return run


def _create_mock_run(config: ExperimentConfig) -> Run:
    """Create a new run from experiment config."""
    run_id = f"run_{int(datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
    now = datetime.now().isoformat()

    # Build dataset runs from config
    datasets = []
    for ds_id in config.dataset_ids:
        pipelines = []
        for pl_id in config.pipeline_ids:
            pipeline_run = PipelineRun(
                id=f"{run_id}-{ds_id}-{pl_id}",
                pipeline_id=pl_id,
                pipeline_name=f"Pipeline {pl_id}",
                model="PLS",
                preprocessing="SNV",
                split_strategy=f"KFold({config.cv_folds})",
                status="queued",
                progress=0,
            )
            pipelines.append(pipeline_run)

        dataset_run = DatasetRun(
            dataset_id=ds_id,
            dataset_name=f"Dataset {ds_id}",
            pipelines=pipelines,
        )
        datasets.append(dataset_run)

    total_pipelines = len(config.dataset_ids) * len(config.pipeline_ids)
    workspace = workspace_manager.get_current_workspace()

    run = Run(
        id=run_id,
        name=config.name,
        description=config.description,
        datasets=datasets,
        status="queued",
        created_at=now,
        cv_folds=config.cv_folds,
        total_pipelines=total_pipelines,
        completed_pipelines=0,
        workspace_path=workspace.path if workspace else None,
        project_id=config.project_id,
    )

    return run


async def _execute_run(run_id: str):
    """
    Background task to execute a run.
    Uses nirs4all library for actual training with WebSocket progress updates.
    """
    if run_id not in _runs:
        return

    run = _runs[run_id]
    run.status = "running"
    run.started_at = datetime.now().isoformat()
    _save_run_manifest(run)

    # Import WebSocket notification functions
    try:
        from websocket.manager import (
            notify_job_started,
            notify_job_progress,
            notify_job_completed,
            notify_job_failed,
            notify_job_log,
        )
        ws_available = True
    except ImportError:
        ws_available = False
        logger.info("WebSocket notifications not available")

    async def send_log(message: str, level: str = "info"):
        """Helper to send log via WebSocket."""
        if ws_available:
            await notify_job_log(run_id, message, level)

    async def send_progress(progress: float, message: str = "", metrics: dict = None):
        """Helper to send progress via WebSocket."""
        if ws_available:
            await notify_job_progress(run_id, progress, message, metrics)

    # Notify run started
    if ws_available:
        await notify_job_started(run_id, {
            "run_id": run_id,
            "name": run.name,
            "total_pipelines": run.total_pipelines,
            "datasets": [d.dataset_name for d in run.datasets],
        })

    try:
        pipeline_index = 0
        total_pipelines = run.total_pipelines or 1

        # Pre-create a single store run so all pipelines are grouped together
        shared_store_run_id: Optional[str] = None
        if total_pipelines > 1 and run.workspace_path:
            try:
                from nirs4all.pipeline.storage import WorkspaceStore
                _pre_store = WorkspaceStore(Path(run.workspace_path))
                dataset_meta = [{"name": d.dataset_name} for d in run.datasets]
                shared_store_run_id = _pre_store.begin_run(
                    name=run.name or "run",
                    config={"n_pipelines": total_pipelines, "n_datasets": len(run.datasets)},
                    datasets=dataset_meta,
                )
                run.store_run_id = shared_store_run_id
                if run.project_id:
                    _pre_store._fetch_pl(
                        "UPDATE runs SET project_id = $2 WHERE run_id = $1",
                        [shared_store_run_id, run.project_id],
                    )
                _pre_store.close()
            except Exception as e:
                logger.warning("Failed to pre-create store run: %s", e)
                shared_store_run_id = None

        for dataset in run.datasets:
            for pipeline in dataset.pipelines:
                # Check for cancellation
                if _run_cancellation_flags.get(run_id, False):
                    pipeline.status = "failed"
                    pipeline.error_message = "Cancelled by user"
                    await send_log(f"[WARN] Pipeline {pipeline.pipeline_name} cancelled by user", "warn")
                    continue

                pipeline.status = "running"
                pipeline.started_at = datetime.now().isoformat()
                pipeline.logs = [f"[INFO] Starting pipeline: {pipeline.pipeline_name}"]
                _save_run_manifest(run)

                # Calculate overall progress
                base_progress = (pipeline_index / total_pipelines) * 100
                await send_progress(
                    base_progress,
                    f"Starting {pipeline.pipeline_name} on {dataset.dataset_name}...",
                )
                await send_log(f"[INFO] Starting pipeline: {pipeline.pipeline_name}")

                try:
                    # Execute the actual training with progress callback
                    async def pipeline_progress_callback(step_progress: float, step_message: str):
                        """Callback to update progress during pipeline execution."""
                        # step_progress is 0-100 within this pipeline
                        overall = base_progress + (step_progress / 100) * (100 / total_pipelines)
                        await send_progress(overall, step_message)

                    result = await _execute_pipeline_training(
                        pipeline,
                        dataset.dataset_id,
                        run.cv_folds or 5,
                        run.workspace_path,
                        run_id,
                        pipeline_progress_callback if ws_available else None,
                        store_run_id=shared_store_run_id,
                    )

                    pipeline.status = "completed"
                    pipeline.progress = 100
                    pipeline.completed_at = datetime.now().isoformat()
                    # Sanitize metrics to handle NaN/Inf values
                    sanitized_metrics = _sanitize_metrics(result.get("metrics", {}))
                    pipeline.metrics = RunMetrics(**sanitized_metrics)
                    pipeline.model_path = result.get("model_path")
                    pipeline.logs = result.get("logs", pipeline.logs or [])
                    pipeline.tested_variants = result.get("variants_tested", 1)

                    # Capture store_run_id (from shared pre-created run or single pipeline)
                    result_store_run_id = result.get("store_run_id")
                    if result_store_run_id and not run.store_run_id:
                        run.store_run_id = result_store_run_id

                    # Log summary based on variants tested
                    variants_info = f" ({pipeline.tested_variants} variants tested)" if pipeline.tested_variants > 1 else ""
                    r2_val = result.get('metrics', {}).get('r2') or 0
                    pipeline.logs.append(f"[INFO] Training complete{variants_info}. Best R²: {r2_val:.4f}")

                    if run.completed_pipelines is not None:
                        run.completed_pipelines += 1

                    await send_log(f"[INFO] Completed {pipeline.pipeline_name}{variants_info}: R²={r2_val:.4f}")
                    await send_progress(
                        ((pipeline_index + 1) / total_pipelines) * 100,
                        f"Completed {pipeline.pipeline_name}",
                        result.get("metrics"),
                    )

                except Exception as e:
                    pipeline.status = "failed"
                    pipeline.error_message = str(e)
                    pipeline.logs = pipeline.logs or []
                    pipeline.logs.append(f"[ERROR] {str(e)}")
                    logger.error("Pipeline execution error: %s", e, exc_info=True)
                    await send_log(f"[ERROR] {pipeline.pipeline_name} failed: {str(e)}", "error")

                _save_run_manifest(run)
                pipeline_index += 1

        # Determine overall run status
        all_completed = all(
            p.status == "completed"
            for d in run.datasets
            for p in d.pipelines
        )
        any_failed = any(
            p.status == "failed"
            for d in run.datasets
            for p in d.pipelines
        )

        if all_completed:
            run.status = "completed"
        elif any_failed:
            run.status = "failed"
        else:
            run.status = "completed"

        run.completed_at = datetime.now().isoformat()

        # Calculate duration
        if run.started_at:
            start = datetime.fromisoformat(run.started_at)
            end = datetime.fromisoformat(run.completed_at)
            duration = end - start
            run.duration = f"{int(duration.total_seconds() // 60)}m {int(duration.total_seconds() % 60)}s"

        _save_run_manifest(run)

        # Complete the shared store run
        if shared_store_run_id and run.workspace_path:
            try:
                from nirs4all.pipeline.storage import WorkspaceStore
                _post_store = WorkspaceStore(Path(run.workspace_path))
                summary = {"total_pipelines": total_pipelines}
                _post_store.complete_run(shared_store_run_id, summary)
                _post_store.close()
            except Exception as e:
                logger.warning("Failed to complete store run: %s", e)

        if ws_available:
            await notify_job_completed(run_id, {
                "run_id": run_id,
                "status": run.status,
                "duration": run.duration,
            })

    except Exception as e:
        run.status = "failed"
        run.completed_at = datetime.now().isoformat()
        _save_run_manifest(run)

        # Fail the shared store run
        if shared_store_run_id and run.workspace_path:
            try:
                from nirs4all.pipeline.storage import WorkspaceStore
                _fail_store = WorkspaceStore(Path(run.workspace_path))
                _fail_store.fail_run(shared_store_run_id, str(e))
                _fail_store.close()
            except Exception:
                pass

        if ws_available:
            await notify_job_failed(run_id, str(e))

    finally:
        # Clean up cancellation flag
        _run_cancellation_flags.pop(run_id, None)



async def _execute_pipeline_training(
    pipeline: PipelineRun,
    dataset_id: str,
    cv_folds: int,
    workspace_path: Optional[str],
    run_id: str,
    progress_callback: Optional[Any] = None,
    store_run_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Execute pipeline training using nirs4all.run().

    This function uses the full nirs4all API which supports:
    - Sweeps (_range_, _or_, etc.) generating multiple pipeline variants
    - Branching (parallel execution paths)
    - Finetuning (Optuna hyperparameter optimization)

    Args:
        pipeline: The pipeline run configuration
        dataset_id: ID of the dataset to train on
        cv_folds: Number of cross-validation folds
        workspace_path: Path to workspace for saving models
        run_id: ID of the parent run
        progress_callback: Optional async callback(progress: float, message: str)

    Returns:
        Dict with metrics, model_path, logs, and variant info
    """
    logs = []

    # Import WebSocket notification for streaming logs
    try:
        from websocket.manager import (
            notify_job_log,
            notify_fold_progress,
            notify_branch_progress,
            notify_variant_progress,
        )
        ws_available = True
    except ImportError:
        ws_available = False

    # Track granular progress state
    granular_state = {
        "current_fold": None,
        "total_folds": pipeline.fold_count or 1,
        "current_branch": None,
        "current_variant": None,
        "total_variants": pipeline.estimated_variants or 1,
    }

    async def report_progress(progress: float, message: str):
        """Report progress via callback and update pipeline."""
        pipeline.progress = int(progress)
        if progress_callback:
            await progress_callback(progress, message)

    async def stream_log(log_entry: str, level: str = "info"):
        """Stream a log entry via WebSocket with granular progress parsing."""
        # Parse log for granular progress info
        parsed = parse_log_for_progress(log_entry)
        context = None

        if ws_available and parsed:
            # Build context for log
            context = {}
            if "fold_id" in parsed:
                context["fold_id"] = parsed["fold_id"]
                context["total_folds"] = parsed.get("total_folds", granular_state["total_folds"])
                # Send fold progress notification
                fold_status = parsed.get("fold_status", "started")
                await notify_fold_progress(
                    run_id,
                    parsed["fold_id"],
                    context["total_folds"],
                    status=fold_status,
                )
                # Update pipeline tracking
                pipeline.current_fold = parsed["fold_id"]
                granular_state["current_fold"] = parsed["fold_id"]

            if "branch_name" in parsed:
                context["branch_name"] = parsed["branch_name"]
                branch_path = parsed.get("branch_path", [])
                await notify_branch_progress(
                    run_id,
                    branch_path,
                    parsed["branch_name"],
                    status="entered",
                )
                pipeline.current_branch = parsed["branch_name"]
                granular_state["current_branch"] = parsed["branch_name"]

            if "variant_index" in parsed:
                context["variant_index"] = parsed["variant_index"]
                context["total_variants"] = parsed.get("total_variants", granular_state["total_variants"])
                await notify_variant_progress(
                    run_id,
                    parsed["variant_index"],
                    context["total_variants"],
                    f"Variant {parsed['variant_index']}",
                    status="started",
                )
                pipeline.current_variant = parsed["variant_index"]
                granular_state["current_variant"] = parsed["variant_index"]

        # Send log with context
        if ws_available:
            await notify_job_log(run_id, log_entry, level, context)

        logs.append(log_entry)
        # Also update pipeline logs in real-time
        if pipeline.logs is None:
            pipeline.logs = []
        pipeline.logs.append(log_entry)

    await report_progress(5, "Preparing pipeline...")
    await stream_log("[INFO] Preparing pipeline...")

    # Get pipeline config
    config = pipeline.config or {}
    steps = config.get("steps", [])

    # Extract step info for progress messages
    model_name = pipeline.model or "Unknown"
    preprocessing_name = pipeline.preprocessing or "None"
    estimated_variants = pipeline.estimated_variants or 1
    has_variants = pipeline.has_generators or estimated_variants > 1

    # Thread-safe queue for streaming logs from thread to async
    import queue
    log_queue: queue.Queue = queue.Queue()

    # Run all heavy operations in a thread to avoid blocking the event loop
    import concurrent.futures

    def run_pipeline_in_thread():
        """Execute all pipeline operations in a thread to avoid blocking the event loop."""
        thread_logs = []

        def log(msg: str):
            """Add log entry and queue it for streaming."""
            thread_logs.append(msg)
            log_queue.put(msg)

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

        # Import nirs4all in thread to avoid blocking event loop during heavy import
        try:
            import nirs4all
        except ImportError as e:
            raise ValueError(f"nirs4all is required for training: {e}")

        import logging

        class _QueueLogHandler(logging.Handler):
            def emit(self, record):
                try:
                    msg = self.format(record)
                except Exception:
                    msg = record.getMessage()
                if msg:
                    log_queue.put(msg)

        log_handler = _QueueLogHandler()
        log_handler.setLevel(logging.INFO)
        log_handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))
        root_logger = logging.getLogger()
        root_logger.addHandler(log_handler)

        try:
            # Build dataset config with proper loading parameters (delimiter, etc.)
            from .nirs4all_adapter import build_dataset_config, build_full_pipeline, ensure_models_dir, expand_pipeline_variants
            try:
                dataset_config = build_dataset_config(dataset_id)
                log(f"[INFO] Dataset config keys: {list(dataset_config.keys())}")
            except Exception as e:
                raise ValueError(f"Dataset '{dataset_id}' config build failed: {e}")
            # Build pipeline - handle expanded variants vs full pipelines
            nirs4all_steps = None
            estimated_variants = 1
            has_generators = False

            # Check if this is an already-expanded variant
            is_expanded_variant = pipeline.is_expanded_variant or False
            variant_index = pipeline.variant_index

            if steps:
                try:
                    if is_expanded_variant and variant_index is not None:
                        # This is a specific variant - get its pre-expanded steps
                        variants = expand_pipeline_variants(steps)
                        if 0 <= variant_index < len(variants):
                            selected_variant = variants[variant_index]
                            nirs4all_steps = selected_variant.steps
                            log(f"[INFO] Running variant {variant_index + 1}/{len(variants)}: {selected_variant.description}")
                        else:
                            log(f"[WARN] Variant index {variant_index} out of range, using first variant")
                            if variants:
                                nirs4all_steps = variants[0].steps
                            else:
                                build_result = build_full_pipeline(steps, {"cv_folds": cv_folds})
                                nirs4all_steps = build_result.steps
                        estimated_variants = 1  # Only running this one variant
                        has_generators = False
                    else:
                        # Full pipeline with all generators
                        build_result = build_full_pipeline(steps, {"cv_folds": cv_folds})
                        nirs4all_steps = build_result.steps
                        estimated_variants = build_result.estimated_variants
                        has_generators = build_result.has_generators

                        log(f"[INFO] Pipeline built: {len(nirs4all_steps)} steps")

                        if has_generators:
                            log(f"[INFO] Generators detected: ~{estimated_variants} variants will be tested")
                        if build_result.finetuning_config:
                            log(f"[INFO] Finetuning enabled: {build_result.finetuning_config.get('n_trials', 50)} trials")

                except Exception as e:
                    raise ValueError(f"Pipeline build failed: {e}")
            else:
                raise ValueError("No pipeline steps provided")

            # Execute using nirs4all.run()
            log("[INFO] Executing nirs4all.run() with dataset config...")
            log(f"[INFO] Training {model_name}...")

            run_kwargs = dict(
                pipeline=nirs4all_steps,
                dataset=dataset_config,
                verbose=1,
                save_artifacts=True,
                save_charts=False,
                plots_visible=False,
                workspace_path=workspace_path,
            )
            if store_run_id:
                run_kwargs["store_run_id"] = store_run_id
            result = nirs4all.run(**run_kwargs)
        finally:
            root_logger.removeHandler(log_handler)

        log("[INFO] Training completed, extracting metrics...")

        # Extract metrics using RunResult properties
        # Note: best_rmse/best_r2 return float('nan') when unavailable, not None
        metrics = {}
        if hasattr(result, 'best_rmse'):
            rmse_val = result.best_rmse
            if rmse_val is not None and not math.isnan(rmse_val):
                metrics['rmse'] = float(rmse_val)
        if hasattr(result, 'best_r2'):
            r2_val = result.best_r2
            if r2_val is not None and not math.isnan(r2_val):
                metrics['r2'] = float(r2_val)
        if hasattr(result, 'best_score'):
            score_val = result.best_score
            if score_val is not None and not math.isnan(score_val):
                metrics['score'] = float(score_val)

        # Compute RPD if we have rmse
        if 'rmse' in metrics and metrics['rmse'] > 0:
            try:
                if hasattr(result, 'predictions') and result.predictions:
                    best_pred = result.predictions.best()
                    if best_pred and hasattr(best_pred, 'y_true'):
                        import numpy as np
                        std_dev = float(np.std(best_pred.y_true))
                        metrics['rpd'] = std_dev / metrics['rmse']
            except Exception:
                pass

        # Ensure required metrics exist with defaults
        if 'r2' not in metrics or metrics['r2'] is None:
            metrics['r2'] = 0.0
        if 'rmse' not in metrics or metrics['rmse'] is None:
            metrics['rmse'] = 999.0
        if 'mae' not in metrics or metrics['mae'] is None:
            metrics['mae'] = metrics.get('rmse', 0.0)
        if 'rpd' not in metrics or metrics['rpd'] is None:
            metrics['rpd'] = 0.0

        # Sanitize all metrics to handle NaN/Inf values
        metrics = _sanitize_metrics(metrics)

        # Get count of variants tested
        num_predictions = 1
        if hasattr(result, 'num_predictions'):
            num_predictions = result.num_predictions
        elif hasattr(result, 'predictions') and result.predictions:
            num_predictions = len(result.predictions)

        log(f"[INFO] Tested {num_predictions} pipeline variant(s)")
        r2_str = f"{metrics['r2']:.4f}" if metrics.get('r2') is not None else "N/A"
        rmse_str = f"{metrics['rmse']:.4f}" if metrics.get('rmse') is not None else "N/A"
        log(f"[INFO] Best R² = {r2_str}, RMSE = {rmse_str}")

        # Fold summary (if available)
        try:
            _summarize_folds(result.predictions)
        except Exception:
            pass

        # Get top results for logging
        if has_generators and hasattr(result, 'top'):
            try:
                top_3 = list(result.top(3))
                log("[INFO] Top 3 configurations:")
                for i, pred in enumerate(top_3, 1):
                    pred_rmse = getattr(pred, 'rmse', getattr(pred, 'test_rmse', None))
                    pred_r2 = getattr(pred, 'r2', getattr(pred, 'test_r2', None))
                    if pred_rmse is not None and pred_r2 is not None:
                        log(f"[INFO]   {i}. RMSE={pred_rmse:.4f}, R²={pred_r2:.4f}")
                    elif pred_rmse is not None:
                        log(f"[INFO]   {i}. RMSE={pred_rmse:.4f}")
            except Exception:
                pass

        # Extract result_store_run_id from the orchestrator
        result_store_run_id = store_run_id  # Start with the caller-provided ID
        try:
            if hasattr(result, '_runner') and result._runner is not None:
                orchestrator = getattr(result._runner, 'orchestrator', None)
                if orchestrator is not None:
                    orch_run_id = getattr(orchestrator, 'last_run_id', None)
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
            "logs": thread_logs,
            "variants_tested": num_predictions,
            "store_run_id": result_store_run_id,
        }

    # Run the pipeline in a thread pool
    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(run_pipeline_in_thread)

        # Poll for completion with progress updates
        # Progress phases based on pipeline execution stages
        progress_step = 5
        elapsed_ticks = 0

        # Build dynamic progress messages based on pipeline content
        progress_phases = []

        # Phase 1: Loading and preprocessing (5-20%)
        progress_phases.append((5, "Loading dataset..."))
        if preprocessing_name and preprocessing_name != "None":
            progress_phases.append((12, f"Applying {preprocessing_name}..."))
        else:
            progress_phases.append((12, "Preparing data..."))

        # Phase 2: Training (20-75%)
        if has_variants:
            # For pipelines with variants, show variant-based progress
            variants_to_show = min(estimated_variants, 10)  # Don't show too many
            for i in range(variants_to_show):
                pct = 20 + int((i / variants_to_show) * 50)
                if i == 0:
                    progress_phases.append((pct, f"Training {model_name} (variant 1/{estimated_variants})..."))
                else:
                    progress_phases.append((pct, f"Training variant {i+1}/{estimated_variants}..."))
            progress_phases.append((72, f"Evaluating {estimated_variants} configurations..."))
        else:
            # Single model training
            progress_phases.append((25, f"Training {model_name}..."))
            progress_phases.append((45, f"Cross-validating {model_name}..."))
            progress_phases.append((65, "Evaluating performance..."))

        # Phase 3: Finalization (75-90%)
        progress_phases.append((78, "Selecting best model..."))
        progress_phases.append((85, "Finalizing results..."))

        phase_index = 0
        current_msg = "Starting..."

        while not future.done():
            await asyncio.sleep(0.2)  # Faster polling for log streaming
            elapsed_ticks += 1

            # Drain log queue and stream logs via WebSocket
            while True:
                try:
                    log_entry = log_queue.get_nowait()
                    await stream_log(log_entry)
                except queue.Empty:
                    break

            # Slowly increment progress (max 90% while running)
            if progress_step < 90:
                # Slow progression - about 1% every 2 seconds
                if elapsed_ticks % 10 == 0:
                    progress_step += 1

            # Update message based on progress
            while phase_index < len(progress_phases) and progress_step >= progress_phases[phase_index][0]:
                current_msg = progress_phases[phase_index][1]
                phase_index += 1

            await report_progress(progress_step, current_msg)

        # Drain any remaining logs after thread completes
        while True:
            try:
                log_entry = log_queue.get_nowait()
                await stream_log(log_entry)
            except queue.Empty:
                break

        # Get result or raise exception
        result = future.result()
        # Logs already streamed via queue, but add any missed ones
        for log_entry in result.get("logs", []):
            if log_entry not in logs:
                logs.append(log_entry)
        await report_progress(100, "Complete!")
        await stream_log("[INFO] Pipeline execution complete!")
        return result


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
        allowed_statuses = set(s.strip() for s in status.split(","))
        runs = [r for r in runs if r.status in allowed_statuses]

    # Sort by created_at descending (newest first)
    runs.sort(key=lambda r: r.created_at, reverse=True)
    return RunListResponse(runs=runs, total=len(runs))


@router.get("/stats", response_model=RunStatsResponse)
async def get_run_stats():
    """Get run statistics."""
    _ensure_runs_loaded()
    return _compute_run_stats()


@router.get("/{run_id}", response_model=Run)
async def get_run(run_id: str):
    """Get details of a specific run."""
    _ensure_runs_loaded()
    if run_id not in _runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return _runs[run_id]


@router.post("", response_model=Run)
async def create_run(request: CreateRunRequest):
    """Create and start a new run (experiment)."""
    _ensure_runs_loaded()
    config = request.config

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Validate that at least one pipeline is specified (either saved or inline)
    if not config.pipeline_ids and not config.inline_pipeline:
        raise HTTPException(
            status_code=422,
            detail="At least one pipeline (saved or inline) must be specified"
        )

    # Validate that datasets exist
    from .spectra import _load_dataset
    dataset_infos = {}
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

    # Handle inline pipeline from editor
    if config.inline_pipeline:
        inline_id = "__inline__"
        pipeline_ids_to_use.append(inline_id)
        pipeline_configs[inline_id] = {
            "name": config.inline_pipeline.name,
            "steps": config.inline_pipeline.steps,
        }

    # Create run from validated config (use modified pipeline_ids)
    run = _create_run_from_config(config, dataset_infos, pipeline_configs, workspace.path, pipeline_ids_to_use)
    _runs[run.id] = run
    _save_run_manifest(run)

    # Start execution in background using asyncio.create_task for proper async execution
    # This ensures the event loop remains responsive while the run executes
    asyncio.create_task(_execute_run(run.id))

    return run


def _create_run_from_config(
    config: ExperimentConfig,
    dataset_infos: Dict[str, Dict[str, str]],
    pipeline_configs: Dict[str, dict],
    workspace_path: str,
    pipeline_ids: Optional[List[str]] = None,
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

    datasets = []
    total_pipeline_runs = 0

    for ds_id in config.dataset_ids:
        pipelines = []
        ds_info = dataset_infos.get(ds_id, {"name": ds_id, "id": ds_id})

        for pl_id in effective_pipeline_ids:
            pl_config = pipeline_configs.get(pl_id, {})
            pl_steps = pl_config.get("steps", [])
            base_model, base_preprocessing, split_strategy = _extract_pipeline_info(pl_config)

            # Expand variants if requested and pipeline has generators
            estimate = _estimate_pipeline_variants(pl_config, cv_folds=config.cv_folds)

            if expand_variants and estimate.has_generators and estimate.estimated_variants > 1:
                # Expand pipeline into separate variant entries
                from .nirs4all_adapter import expand_pipeline_variants
                variants = expand_pipeline_variants(pl_steps)

                for variant in variants:
                    # Build variant-specific name
                    variant_name = f"{pl_config.get('name', pl_id)}"
                    if variant.description:
                        variant_name = f"{variant_name} [{variant.description}]"

                    # Use variant-specific model/preprocessing or fall back to extracted
                    model_name = variant.model_name if variant.model_name != "Unknown" else base_model
                    preprocessing_str = " → ".join(variant.preprocessing_names) if variant.preprocessing_names else base_preprocessing

                    pipeline_run = PipelineRun(
                        id=f"{run_id}-{ds_id}-{pl_id}-v{variant.index}",
                        pipeline_id=pl_id,
                        pipeline_name=variant_name,
                        model=model_name,
                        preprocessing=preprocessing_str,
                        split_strategy=f"KFold({config.cv_folds})" if split_strategy == "KFold(5)" else split_strategy,
                        status="queued",
                        progress=0,
                        config=pl_config,
                        variant_index=variant.index,
                        variant_description=variant.description,
                        variant_choices=variant.choices,
                        is_expanded_variant=True,
                        estimated_variants=1,  # This IS the variant
                        has_generators=False,  # Already expanded
                        fold_count=estimate.fold_count,
                        branch_count=1,  # Variants are already expanded
                        total_model_count=estimate.fold_count,
                        model_count_breakdown=f"{estimate.fold_count} folds" if estimate.fold_count > 1 else "1 model",
                    )
                    pipelines.append(pipeline_run)
                    total_pipeline_runs += 1
            else:
                # Single pipeline (no generators or expansion disabled)
                pipeline_run = PipelineRun(
                    id=f"{run_id}-{ds_id}-{pl_id}",
                    pipeline_id=pl_id,
                    pipeline_name=pl_config.get("name", pl_id),
                    model=base_model,
                    preprocessing=base_preprocessing,
                    split_strategy=f"KFold({config.cv_folds})" if split_strategy == "KFold(5)" else split_strategy,
                    status="queued",
                    progress=0,
                    config=pl_config,
                    estimated_variants=estimate.estimated_variants,
                    has_generators=estimate.has_generators,
                    fold_count=estimate.fold_count,
                    branch_count=estimate.branch_count,
                    total_model_count=estimate.total_model_count,
                    model_count_breakdown=estimate.model_count_breakdown,
                )
                pipelines.append(pipeline_run)
                total_pipeline_runs += 1

        dataset_run = DatasetRun(
            dataset_id=ds_id,
            dataset_name=ds_info.get("name", ds_id),
            pipelines=pipelines,
        )
        datasets.append(dataset_run)

    run = Run(
        id=run_id,
        name=config.name,
        description=config.description or "",
        datasets=datasets,
        status="queued",
        created_at=now,
        cv_folds=config.cv_folds,
        total_pipelines=total_pipeline_runs,
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


def _estimate_pipeline_variants(pipeline_config: dict, cv_folds: Optional[int] = None) -> PipelineEstimate:
    """
    Estimate the number of pipeline variants and model count from a configuration.

    Uses build_full_pipeline() from nirs4all_adapter which handles all formats
    (legacy and editor) and uses nirs4all's count_combinations for accurate counts.

    Returns PipelineEstimate with variant count, fold/branch counts, and breakdown.
    """
    steps = pipeline_config.get("steps", [])

    from .nirs4all_adapter import build_full_pipeline
    config = {"cv_folds": cv_folds} if cv_folds else {}
    build_result = build_full_pipeline(steps, config)
    return PipelineEstimate(
        estimated_variants=build_result.estimated_variants,
        has_generators=build_result.has_generators,
        fold_count=build_result.fold_count,
        branch_count=build_result.branch_count,
        total_model_count=build_result.total_model_count,
        model_count_breakdown=build_result.model_count_breakdown,
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
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Load pipeline configuration
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

    dataset_info = {
        "name": dataset.name if hasattr(dataset, 'name') else request.dataset_id,
        "id": request.dataset_id,
    }

    # Create run
    run = _create_quick_run(request, pipeline_config, dataset_info)
    _runs[run.id] = run
    _save_run_manifest(run)

    # Start execution in background using asyncio.create_task for proper async execution
    # This ensures the event loop remains responsive while the run executes
    asyncio.create_task(_execute_run(run.id))

    return run


@router.post("/{run_id}/stop", response_model=RunActionResponse)
async def stop_run(run_id: str):
    """Stop a running experiment."""
    _ensure_runs_loaded()
    if run_id not in _runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    run = _runs[run_id]
    if run.status not in ("running", "queued"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot stop run with status {run.status}"
        )

    # Set cancellation flag for background task
    _run_cancellation_flags[run_id] = True

    run.status = "failed"
    for dataset in run.datasets:
        for pipeline in dataset.pipelines:
            if pipeline.status in ("running", "queued"):
                pipeline.status = "failed"
                pipeline.error_message = "Stopped by user"

    _save_run_manifest(run)

    return RunActionResponse(
        success=True,
        message=f"Run {run_id} stopped",
        run_id=run_id,
    )


@router.post("/{run_id}/pause", response_model=RunActionResponse)
async def pause_run(run_id: str):
    """Pause a running experiment."""
    _ensure_runs_loaded()
    if run_id not in _runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    run = _runs[run_id]
    if run.status != "running":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot pause run with status {run.status}"
        )

    run.status = "paused"
    for dataset in run.datasets:
        for pipeline in dataset.pipelines:
            if pipeline.status == "running":
                pipeline.status = "paused"

    return RunActionResponse(
        success=True,
        message=f"Run {run_id} paused",
        run_id=run_id,
    )


@router.post("/{run_id}/resume", response_model=RunActionResponse)
async def resume_run(run_id: str):
    """Resume a paused experiment."""
    _ensure_runs_loaded()
    if run_id not in _runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    run = _runs[run_id]
    if run.status != "paused":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot resume run with status {run.status}"
        )

    run.status = "running"
    for dataset in run.datasets:
        for pipeline in dataset.pipelines:
            if pipeline.status == "paused":
                pipeline.status = "queued"

    # Resume execution in background using asyncio.create_task for proper async execution
    asyncio.create_task(_execute_run(run_id))

    return RunActionResponse(
        success=True,
        message=f"Run {run_id} resumed",
        run_id=run_id,
    )


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

    # Create a new run with same config
    new_run_id = str(uuid.uuid4())[:8]
    now = datetime.now().isoformat()

    # Reset all pipelines to queued
    new_datasets = []
    for dataset in old_run.datasets:
        new_pipelines = []
        for pipeline in dataset.pipelines:
            new_pipeline = PipelineRun(
                id=f"{new_run_id}-{pipeline.pipeline_id}",
                pipeline_id=pipeline.pipeline_id,
                pipeline_name=pipeline.pipeline_name,
                model=pipeline.model,
                preprocessing=pipeline.preprocessing,
                split_strategy=pipeline.split_strategy,
                status="queued",
                progress=0,
            )
            new_pipelines.append(new_pipeline)

        new_dataset = DatasetRun(
            dataset_id=dataset.dataset_id,
            dataset_name=dataset.dataset_name,
            pipelines=new_pipelines,
        )
        new_datasets.append(new_dataset)

    new_run = Run(
        id=new_run_id,
        name=f"{old_run.name} (retry)",
        description=old_run.description,
        datasets=new_datasets,
        status="queued",
        created_at=now,
        cv_folds=old_run.cv_folds,
        total_pipelines=old_run.total_pipelines,
        completed_pipelines=0,
    )

    _runs[new_run_id] = new_run

    # Start execution in background using asyncio.create_task for proper async execution
    asyncio.create_task(_execute_run(new_run_id))

    return new_run


@router.delete("/{run_id}", response_model=RunActionResponse)
async def delete_run(run_id: str):
    """Delete a run."""
    _ensure_runs_loaded()
    if run_id not in _runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    run = _runs[run_id]
    if run.status == "running":
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a running experiment. Stop it first."
        )

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
