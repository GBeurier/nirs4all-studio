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
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager

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
    r2: float
    rmse: float
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


class ExperimentConfig(BaseModel):
    """Configuration for creating a new experiment."""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    dataset_ids: List[str] = Field(..., min_length=1)
    pipeline_ids: List[str] = Field(..., min_length=1)
    cv_folds: int = Field(default=5, ge=2, le=50)
    cv_strategy: Literal["kfold", "stratified", "loo", "holdout"] = "kfold"
    test_size: Optional[float] = Field(default=0.2, ge=0.1, le=0.5)
    shuffle: bool = True
    random_state: Optional[int] = None


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


def _get_runs_dir() -> Optional[Path]:
    """Get the runs directory for the current workspace."""
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        return None
    runs_dir = Path(workspace.path) / "workspace" / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)
    return runs_dir


def _save_run_manifest(run: Run) -> bool:
    """Save run manifest to workspace for persistence."""
    runs_dir = _get_runs_dir()
    if not runs_dir:
        return False

    try:
        # Create run-specific directory
        run_dir = runs_dir / run.id
        run_dir.mkdir(exist_ok=True)

        # Save manifest
        manifest_path = run_dir / "manifest.json"
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(run.model_dump(), f, indent=2)
        return True
    except Exception as e:
        print(f"Error saving run manifest: {e}")
        return False


def _load_persisted_runs() -> List[Run]:
    """Load persisted runs from workspace."""
    runs_dir = _get_runs_dir()
    if not runs_dir or not runs_dir.exists():
        return []

    runs = []
    for run_dir in runs_dir.iterdir():
        if not run_dir.is_dir():
            continue
        manifest_path = run_dir / "manifest.json"
        if manifest_path.exists():
            try:
                with open(manifest_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    runs.append(Run(**data))
            except Exception as e:
                print(f"Error loading run {run_dir.name}: {e}")
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
    """Extract model, preprocessing, and split info from pipeline config."""
    steps = pipeline_config.get("steps", [])
    model = "Unknown"
    preprocessing = []
    split_strategy = "KFold(5)"

    for step in steps:
        step_type = step.get("type", "")
        step_name = step.get("name", "")

        if step_type == "model":
            model = step_name
        elif step_type == "preprocessing":
            preprocessing.append(step_name)
        elif step_type == "splitting":
            split_strategy = step_name

    return model, " → ".join(preprocessing) if preprocessing else "None", split_strategy


def _create_quick_run(request: QuickRunRequest, pipeline_config: dict, dataset_info: dict) -> Run:
    """Create a run from quick run request."""
    run_id = f"run_{int(datetime.now().timestamp())}_{uuid.uuid4().hex[:6]}"
    now = datetime.now().isoformat()

    model, preprocessing, split_strategy = _extract_pipeline_info(pipeline_config)

    # Create single pipeline run
    pipeline_run = PipelineRun(
        id=f"{run_id}-{request.pipeline_id}",
        pipeline_id=request.pipeline_id,
        pipeline_name=pipeline_config.get("name", request.pipeline_id),
        model=model,
        preprocessing=preprocessing,
        split_strategy=f"KFold({request.cv_folds})" if split_strategy == "KFold(5)" else split_strategy,
        status="queued",
        progress=0,
        config=pipeline_config,
    )

    dataset_run = DatasetRun(
        dataset_id=request.dataset_id,
        dataset_name=dataset_info.get("name", request.dataset_id),
        pipelines=[pipeline_run],
    )

    workspace = workspace_manager.get_current_workspace()

    run = Run(
        id=run_id,
        name=request.name or f"Quick Run: {pipeline_config.get('name', 'Pipeline')}",
        description=f"Training on {dataset_info.get('name', request.dataset_id)}",
        datasets=[dataset_run],
        status="queued",
        created_at=now,
        cv_folds=request.cv_folds,
        total_pipelines=1,
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
        )
        ws_available = True
    except ImportError:
        ws_available = False
        print("WebSocket notifications not available")

    # Notify run started
    if ws_available:
        await notify_job_started(run_id, {"run_id": run_id, "name": run.name})

    try:
        for dataset in run.datasets:
            for pipeline in dataset.pipelines:
                # Check for cancellation
                if _run_cancellation_flags.get(run_id, False):
                    pipeline.status = "failed"
                    pipeline.error_message = "Cancelled by user"
                    continue

                pipeline.status = "running"
                pipeline.started_at = datetime.now().isoformat()
                pipeline.logs = [f"[INFO] Starting pipeline: {pipeline.pipeline_name}"]
                _save_run_manifest(run)

                if ws_available:
                    await notify_job_progress(
                        run_id,
                        (run.completed_pipelines or 0) / (run.total_pipelines or 1) * 100,
                        f"Running {pipeline.pipeline_name}...",
                    )

                try:
                    # Execute the actual training
                    result = await _execute_pipeline_training(
                        pipeline,
                        dataset.dataset_id,
                        run.cv_folds or 5,
                        run.workspace_path,
                        run_id,
                        ws_available,
                    )

                    pipeline.status = "completed"
                    pipeline.progress = 100
                    pipeline.completed_at = datetime.now().isoformat()
                    pipeline.metrics = RunMetrics(**result.get("metrics", {}))
                    pipeline.model_path = result.get("model_path")
                    pipeline.logs = pipeline.logs or []
                    pipeline.logs.append(f"[INFO] Training complete. R²: {result.get('metrics', {}).get('r2', 0):.4f}")

                    if run.completed_pipelines is not None:
                        run.completed_pipelines += 1

                except Exception as e:
                    pipeline.status = "failed"
                    pipeline.error_message = str(e)
                    pipeline.logs = pipeline.logs or []
                    pipeline.logs.append(f"[ERROR] {str(e)}")
                    print(f"Pipeline execution error: {e}")

                _save_run_manifest(run)

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
    notify_progress: bool = False,
) -> Dict[str, Any]:
    """
    Execute actual pipeline training using nirs4all or sklearn.

    Returns dict with metrics and model_path.
    """
    import numpy as np

    # Load dataset
    from .spectra import _load_dataset
    dataset = _load_dataset(dataset_id)
    if not dataset:
        raise ValueError(f"Dataset '{dataset_id}' not found")

    # Get training data
    X = dataset.x({}, layout="2d")
    if isinstance(X, list):
        X = X[0]

    y = None
    try:
        y = dataset.y({})
    except Exception:
        pass

    if y is None:
        raise ValueError("Dataset has no target values for training")

    pipeline.logs = pipeline.logs or []
    pipeline.logs.append(f"[INFO] Loaded dataset: {X.shape[0]} samples, {X.shape[1]} features")

    # Get preprocessing steps and model from pipeline config
    config = pipeline.config or {}
    steps = config.get("steps", [])

    preprocessing_steps = []
    model_step = None
    model_params = {}

    for step in steps:
        step_type = step.get("type", "")
        step_name = step.get("name", "")
        step_params = step.get("params", {})

        if step_type == "preprocessing":
            preprocessing_steps.append({"name": step_name, "params": step_params})
        elif step_type == "model":
            model_step = step_name
            model_params = step_params

    # Apply preprocessing if available
    if preprocessing_steps:
        try:
            from .spectra import _apply_preprocessing_chain
            X = _apply_preprocessing_chain(X, preprocessing_steps)
            pipeline.logs.append(f"[INFO] Applied preprocessing: {', '.join(s['name'] for s in preprocessing_steps)}")
        except Exception as e:
            pipeline.logs.append(f"[WARN] Preprocessing error: {e}")

    # Get model
    if model_step:
        from .training import _get_model_instance
        model = _get_model_instance(model_step, model_params)
        pipeline.logs.append(f"[INFO] Training {model_step} model...")
    else:
        # Default to PLSRegression
        from sklearn.cross_decomposition import PLSRegression
        model = PLSRegression(n_components=min(10, X.shape[1], X.shape[0] - 1))
        pipeline.logs.append("[INFO] Training default PLSRegression model...")

    if model is None:
        raise ValueError(f"Could not instantiate model: {model_step}")

    # Cross-validation
    from sklearn.model_selection import cross_val_predict, KFold

    kfold = KFold(n_splits=cv_folds, shuffle=True, random_state=42)
    y_flat = y.ravel() if y.ndim > 1 else y

    pipeline.logs.append(f"[INFO] Running {cv_folds}-fold cross-validation...")

    # Simulate progress updates
    for i in range(cv_folds):
        pipeline.progress = int((i + 1) / cv_folds * 80)
        await asyncio.sleep(0.1)  # Allow other tasks to run

    # Perform cross-validation prediction
    try:
        y_pred = cross_val_predict(model, X, y_flat, cv=kfold)
    except Exception as e:
        # Fallback: simple train/test split
        from sklearn.model_selection import train_test_split
        X_train, X_test, y_train, y_test = train_test_split(X, y_flat, test_size=0.2, random_state=42)
        model.fit(X_train, y_train)
        y_pred = model.predict(X)

    # Compute metrics
    from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
    r2 = float(r2_score(y_flat, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_flat, y_pred)))
    mae = float(mean_absolute_error(y_flat, y_pred))

    # Compute RPD
    std_dev = float(np.std(y_flat))
    rpd = std_dev / rmse if rmse > 0 else 0

    metrics = {
        "r2": r2,
        "rmse": rmse,
        "mae": mae,
        "rpd": rpd,
    }

    pipeline.logs.append(f"[INFO] R² = {r2:.4f}, RMSE = {rmse:.4f}")

    # Fit final model on all data
    model.fit(X, y_flat)

    # Save model if workspace is available
    model_path = None
    if workspace_path:
        try:
            import joblib
            models_dir = Path(workspace_path) / "models"
            models_dir.mkdir(exist_ok=True)

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            model_filename = f"{pipeline.pipeline_id}_{run_id}_{timestamp}.joblib"
            model_path = models_dir / model_filename

            joblib.dump(model, model_path)
            model_path = str(model_path)
            pipeline.logs.append(f"[INFO] Model saved: {model_filename}")
        except Exception as e:
            pipeline.logs.append(f"[WARN] Failed to save model: {e}")

    pipeline.progress = 100

    return {
        "metrics": metrics,
        "model_path": model_path,
    }


# ============================================================================
# API Endpoints
# ============================================================================

@router.get("", response_model=RunListResponse)
async def list_runs():
    """List all runs."""
    runs = list(_runs.values())
    # Sort by created_at descending (newest first)
    runs.sort(key=lambda r: r.created_at, reverse=True)
    return RunListResponse(runs=runs, total=len(runs))


@router.get("/stats", response_model=RunStatsResponse)
async def get_run_stats():
    """Get run statistics."""
    return _compute_run_stats()


@router.get("/{run_id}", response_model=Run)
async def get_run(run_id: str):
    """Get details of a specific run."""
    if run_id not in _runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return _runs[run_id]


@router.post("", response_model=Run)
async def create_run(request: CreateRunRequest, background_tasks: BackgroundTasks):
    """Create and start a new run (experiment)."""
    config = request.config

    # Validate that datasets and pipelines exist
    # In real implementation, this would check the database

    run = _create_mock_run(config)
    _runs[run.id] = run
    _save_run_manifest(run)

    # Start execution in background
    background_tasks.add_task(_execute_run, run.id)

    return run


@router.post("/quick", response_model=Run)
async def quick_run(request: QuickRunRequest, background_tasks: BackgroundTasks):
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

    # Start execution in background
    background_tasks.add_task(_execute_run, run.id)

    return run


@router.post("/{run_id}/stop", response_model=RunActionResponse)
async def stop_run(run_id: str):
    """Stop a running experiment."""
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
async def resume_run(run_id: str, background_tasks: BackgroundTasks):
    """Resume a paused experiment."""
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

    # Resume execution in background
    background_tasks.add_task(_execute_run, run_id)

    return RunActionResponse(
        success=True,
        message=f"Run {run_id} resumed",
        run_id=run_id,
    )


@router.post("/{run_id}/retry", response_model=Run)
async def retry_run(run_id: str, background_tasks: BackgroundTasks):
    """Retry a failed run."""
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

    # Start execution in background
    background_tasks.add_task(_execute_run, new_run_id)

    return new_run


@router.delete("/{run_id}", response_model=RunActionResponse)
async def delete_run(run_id: str):
    """Delete a run."""
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
