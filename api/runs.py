"""
Runs API endpoints for nirs4all webapp.
Phase 8: Runs Management

This module provides endpoints for managing experiment runs:
- List all runs
- Get run details
- Create new run (experiment)
- Stop/pause running experiments
- Retry failed runs
- Delete runs
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime
import uuid

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
    logs: Optional[list[str]] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error_message: Optional[str] = None


class DatasetRun(BaseModel):
    """Status of all pipelines for a single dataset."""
    dataset_id: str
    dataset_name: str
    pipelines: list[PipelineRun]


class Run(BaseModel):
    """Complete run (experiment) information."""
    id: str
    name: str
    description: Optional[str] = None
    datasets: list[DatasetRun]
    status: Literal["queued", "running", "completed", "failed", "paused"]
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration: Optional[str] = None
    created_by: Optional[str] = None
    cv_folds: Optional[int] = None
    total_pipelines: Optional[int] = None
    completed_pipelines: Optional[int] = None


class ExperimentConfig(BaseModel):
    """Configuration for creating a new experiment."""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    dataset_ids: list[str] = Field(..., min_length=1)
    pipeline_ids: list[str] = Field(..., min_length=1)
    cv_folds: int = Field(default=5, ge=2, le=50)
    cv_strategy: Literal["kfold", "stratified", "loo", "holdout"] = "kfold"
    test_size: Optional[float] = Field(default=0.2, ge=0.1, le=0.5)
    shuffle: bool = True
    random_state: Optional[int] = None


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
# In-memory storage for runs (replace with database in production)
# ============================================================================

_runs: dict[str, Run] = {}


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


def _create_mock_run(config: ExperimentConfig) -> Run:
    """Create a new run from experiment config."""
    run_id = str(uuid.uuid4())[:8]
    now = datetime.now().isoformat()

    # Build dataset runs from config
    # In real implementation, this would load actual dataset and pipeline info
    datasets = []
    for ds_id in config.dataset_ids:
        pipelines = []
        for pl_id in config.pipeline_ids:
            pipeline_run = PipelineRun(
                id=f"{run_id}-{ds_id}-{pl_id}",
                pipeline_id=pl_id,
                pipeline_name=f"Pipeline {pl_id}",
                model="PLS",  # Would be extracted from actual pipeline
                preprocessing="SNV",  # Would be extracted from actual pipeline
                split_strategy=f"KFold({config.cv_folds})",
                status="queued",
                progress=0,
            )
            pipelines.append(pipeline_run)

        dataset_run = DatasetRun(
            dataset_id=ds_id,
            dataset_name=f"Dataset {ds_id}",  # Would be loaded from actual dataset
            pipelines=pipelines,
        )
        datasets.append(dataset_run)

    total_pipelines = len(config.dataset_ids) * len(config.pipeline_ids)

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
    )

    return run


async def _execute_run(run_id: str):
    """
    Background task to execute a run.
    This is a placeholder - real implementation would use nirs4all library.
    """
    import asyncio

    if run_id not in _runs:
        return

    run = _runs[run_id]
    run.status = "running"
    run.started_at = datetime.now().isoformat()

    # Simulate pipeline execution
    for dataset in run.datasets:
        for pipeline in dataset.pipelines:
            pipeline.status = "running"
            pipeline.started_at = datetime.now().isoformat()

            # Simulate progress
            for progress in range(0, 101, 10):
                await asyncio.sleep(0.1)  # Simulate work
                pipeline.progress = progress

            # Simulate completion
            pipeline.status = "completed"
            pipeline.progress = 100
            pipeline.completed_at = datetime.now().isoformat()
            pipeline.metrics = RunMetrics(
                r2=0.95 + (hash(pipeline.id) % 50) / 1000,
                rmse=0.3 + (hash(pipeline.id) % 30) / 100,
            )

            if run.completed_pipelines is not None:
                run.completed_pipelines += 1

    run.status = "completed"
    run.completed_at = datetime.now().isoformat()


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

    run.status = "failed"
    for dataset in run.datasets:
        for pipeline in dataset.pipelines:
            if pipeline.status in ("running", "queued"):
                pipeline.status = "failed"
                pipeline.error_message = "Stopped by user"

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
