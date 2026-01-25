"""
Training API routes for nirs4all webapp.

This module provides FastAPI routes for training management,
including starting training jobs, monitoring progress, and retrieving results.

Phase 3 Implementation:
- Background job training with progress tracking
- Job status and metrics endpoints
- Training history and resume support

Phase 5 Enhancement:
- WebSocket integration for real-time training updates

Refactored: Uses nirs4all.run() for training instead of custom implementation.
"""

from __future__ import annotations

import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager
from .jobs import job_manager, Job, JobStatus, JobType
from .nirs4all_adapter import (
    NIRS4ALL_AVAILABLE,
    require_nirs4all,
    build_full_pipeline,
    build_dataset_spec,
    extract_metrics_from_prediction,
    ensure_models_dir,
)


if not NIRS4ALL_AVAILABLE:
    print("Note: nirs4all not available for training API")


router = APIRouter()


# ============= Request/Response Models =============


class TrainingRequest(BaseModel):
    """Request model for starting a training job."""

    pipeline_id: str = Field(..., description="ID of the pipeline to run")
    dataset_id: str = Field(..., description="ID of the dataset to train on")
    partition: str = Field("train", description="Dataset partition to use")
    verbose: int = Field(1, ge=0, le=3, description="Verbosity level")
    save_best_model: bool = Field(True, description="Save the best model checkpoint")
    random_state: Optional[int] = Field(42, description="Random seed for reproducibility")


class TrainingJobResponse(BaseModel):
    """Response model for training job status."""

    job_id: str
    status: str
    progress: float
    progress_message: str
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_seconds: Optional[float] = None
    config: Dict[str, Any]
    metrics: Dict[str, Any] = {}
    error: Optional[str] = None


class TrainingMetricsResponse(BaseModel):
    """Response model for training metrics."""

    job_id: str
    current_epoch: int
    total_epochs: int
    train_metrics: Dict[str, float]
    val_metrics: Optional[Dict[str, float]] = None
    best_metrics: Optional[Dict[str, float]] = None
    history: List[Dict[str, Any]] = []


class TrainingResultResponse(BaseModel):
    """Response model for completed training."""

    job_id: str
    status: str
    final_metrics: Dict[str, float]
    best_metrics: Dict[str, float]
    model_path: Optional[str] = None
    history: List[Dict[str, Any]]
    duration_seconds: float


# ============= Training Routes =============


@router.post("/training/start", response_model=TrainingJobResponse)
async def start_training(request: TrainingRequest):
    """
    Start a new training job.

    Creates a background job that trains a model using the specified
    pipeline and dataset configuration via nirs4all.run().
    """
    require_nirs4all()

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Validate pipeline exists
    from .pipelines import _load_pipeline

    try:
        pipeline = _load_pipeline(request.pipeline_id)
    except HTTPException:
        raise HTTPException(
            status_code=404,
            detail=f"Pipeline '{request.pipeline_id}' not found",
        )

    # Validate dataset exists
    from .spectra import _load_dataset

    dataset = _load_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset '{request.dataset_id}' not found",
        )

    # Create job configuration
    job_config = {
        "pipeline_id": request.pipeline_id,
        "pipeline_name": pipeline.get("name", "Unknown"),
        "dataset_id": request.dataset_id,
        "dataset_name": dataset.name,
        "partition": request.partition,
        "verbose": request.verbose,
        "save_best_model": request.save_best_model,
        "random_state": request.random_state,
        "workspace_path": workspace.path,
    }

    # Create and submit job
    job = job_manager.create_job(JobType.TRAINING, job_config)
    job_manager.submit_job(job, _run_training_task)

    return TrainingJobResponse(
        job_id=job.id,
        status=job.status.value,
        progress=job.progress,
        progress_message=job.progress_message,
        created_at=job.created_at.isoformat(),
        started_at=job.started_at.isoformat() if job.started_at else None,
        completed_at=job.completed_at.isoformat() if job.completed_at else None,
        duration_seconds=job._get_duration(),
        config=job.config,
        metrics=job.metrics,
        error=job.error,
    )


@router.get("/training/{job_id}", response_model=TrainingJobResponse)
async def get_training_status(job_id: str):
    """Get the status of a training job."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    if job.type != JobType.TRAINING:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_id}' is not a training job",
        )

    return TrainingJobResponse(
        job_id=job.id,
        status=job.status.value,
        progress=job.progress,
        progress_message=job.progress_message,
        created_at=job.created_at.isoformat(),
        started_at=job.started_at.isoformat() if job.started_at else None,
        completed_at=job.completed_at.isoformat() if job.completed_at else None,
        duration_seconds=job._get_duration(),
        config=job.config,
        metrics=job.metrics,
        error=job.error,
    )


@router.post("/training/{job_id}/stop")
async def stop_training(job_id: str):
    """
    Stop a running training job.

    Requests cancellation of the job. The job will stop at the next
    checkpoint opportunity.
    """
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    if job.type != JobType.TRAINING:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_id}' is not a training job",
        )

    if job.status not in (JobStatus.PENDING, JobStatus.RUNNING):
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_id}' is not running (status: {job.status.value})",
        )

    success = job_manager.cancel_job(job_id)
    if not success:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to cancel job '{job_id}'",
        )

    return {
        "success": True,
        "job_id": job_id,
        "status": job.status.value,
        "message": "Cancellation requested",
    }


@router.get("/training/{job_id}/metrics", response_model=TrainingMetricsResponse)
async def get_training_metrics(job_id: str):
    """
    Get current training metrics for a job.

    Returns training metrics including best scores achieved.
    """
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    if job.type != JobType.TRAINING:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_id}' is not a training job",
        )

    current_epoch = job.metrics.get("current_epoch", 0)
    total_epochs = job.config.get("total_variants", 1)

    return TrainingMetricsResponse(
        job_id=job.id,
        current_epoch=current_epoch,
        total_epochs=total_epochs,
        train_metrics=job.metrics.get("train", {}),
        val_metrics=job.metrics.get("val"),
        best_metrics=job.metrics.get("best"),
        history=job.history,
    )


@router.get("/training/{job_id}/history")
async def get_training_history(job_id: str):
    """
    Get full training history for a job.

    Returns the complete history of metrics from the run.
    """
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    if job.type != JobType.TRAINING:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_id}' is not a training job",
        )

    return {
        "job_id": job.id,
        "status": job.status.value,
        "total_variants": len(job.history),
        "history": job.history,
        "final_metrics": job.metrics,
    }


@router.get("/training/{job_id}/result", response_model=TrainingResultResponse)
async def get_training_result(job_id: str):
    """
    Get the final result of a completed training job.

    Returns final metrics, best metrics, model path, and full history.
    """
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    if job.type != JobType.TRAINING:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_id}' is not a training job",
        )

    if job.status != JobStatus.COMPLETED:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_id}' is not completed (status: {job.status.value})",
        )

    result = job.result or {}

    return TrainingResultResponse(
        job_id=job.id,
        status=job.status.value,
        final_metrics=result.get("final_metrics", {}),
        best_metrics=result.get("best_metrics", {}),
        model_path=result.get("model_path"),
        history=job.history,
        duration_seconds=job._get_duration() or 0.0,
    )


@router.get("/training/jobs")
async def list_training_jobs(
    status: Optional[str] = None,
    limit: int = 50,
):
    """
    List all training jobs.

    Returns a list of training jobs with optional status filtering.
    """
    status_filter = None
    if status:
        try:
            status_filter = JobStatus(status)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status: {status}. Valid values: {[s.value for s in JobStatus]}",
            )

    jobs = job_manager.list_jobs(
        job_type=JobType.TRAINING,
        status=status_filter,
        limit=limit,
    )

    return {
        "jobs": [
            {
                "job_id": j.id,
                "status": j.status.value,
                "progress": j.progress,
                "pipeline_name": j.config.get("pipeline_name", "Unknown"),
                "dataset_name": j.config.get("dataset_name", "Unknown"),
                "created_at": j.created_at.isoformat(),
                "duration_seconds": j._get_duration(),
            }
            for j in jobs
        ],
        "total": len(jobs),
    }


# ============= Training Task Implementation =============


def _run_training_task(
    job: Job,
    progress_callback: Callable[[float, str], bool],
) -> Dict[str, Any]:
    """
    Execute the training task using nirs4all.run().

    This function runs in a background thread and performs the actual
    model training using the nirs4all library.

    Args:
        job: The job instance
        progress_callback: Callback to report progress

    Returns:
        Training result dictionary
    """
    import nirs4all

    config = job.config
    start_time = time.time()

    # Update progress
    if not progress_callback(5, "Loading pipeline configuration..."):
        return {"error": "Cancelled"}

    # Load pipeline configuration
    from .pipelines import _load_pipeline

    pipeline_config = _load_pipeline(config["pipeline_id"])
    steps = pipeline_config.get("steps", [])

    # Build nirs4all pipeline steps
    build_result = build_full_pipeline(steps, pipeline_config.get("config", {}))

    if not progress_callback(10, "Loading dataset..."):
        return {"error": "Cancelled"}

    # Get dataset path
    dataset_path = build_dataset_spec(config["dataset_id"])

    if not progress_callback(15, "Starting training with nirs4all.run()..."):
        return {"error": "Cancelled"}

    # Run training using nirs4all.run()
    try:
        result = nirs4all.run(
            pipeline=build_result.steps,
            dataset=dataset_path,
            verbose=config.get("verbose", 1),
            save_artifacts=True,
            save_charts=False,
            plots_visible=False,
            random_state=config.get("random_state"),
        )
    except Exception as e:
        raise ValueError(f"Training failed: {str(e)}")

    if not progress_callback(80, "Processing results..."):
        return {"error": "Cancelled"}

    # Extract metrics from the result
    best_prediction = result.best
    best_metrics = extract_metrics_from_prediction(best_prediction) if best_prediction else {}

    # Get all predictions for history
    history = []
    all_predictions = result.top(n=result.num_predictions)
    for idx, pred in enumerate(all_predictions):
        pred_metrics = extract_metrics_from_prediction(pred)
        history.append({
            "variant": idx + 1,
            "model": pred.get("model_name", "Unknown"),
            "metrics": pred_metrics,
        })

    # Update job metrics
    job_manager.update_job_metrics(
        job.id,
        {
            "current_epoch": len(history),
            "train": best_metrics,
            "best": {
                "model_name": best_prediction.get("model_name", "Unknown") if best_prediction else "Unknown",
                "metrics": best_metrics,
            },
        },
        append_history=False,
    )

    # Save model if configured
    model_path = None
    if config.get("save_best_model", True) and best_prediction:
        if not progress_callback(90, "Saving model..."):
            return {"error": "Cancelled"}

        try:
            models_dir = ensure_models_dir(config["workspace_path"])
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            model_filename = f"{config['pipeline_id']}_{job.id}_{timestamp}.n4a"
            export_path = models_dir / model_filename

            result.export(str(export_path))
            model_path = str(export_path)
        except Exception as e:
            print(f"Warning: Failed to export model: {e}")

    progress_callback(100, "Training complete")

    # Send completion notification
    _send_training_completion_notification(
        job.id,
        best_metrics,
        len(history),
    )

    duration = time.time() - start_time

    # Final result
    return {
        "final_metrics": best_metrics,
        "best_metrics": {
            "model_name": best_prediction.get("model_name", "Unknown") if best_prediction else "Unknown",
            "metrics": best_metrics,
        },
        "model_path": model_path,
        "total_variants": len(history),
        "num_predictions": result.num_predictions,
        "duration_seconds": duration,
    }


def _send_training_completion_notification(
    job_id: str,
    metrics: Dict[str, float],
    total_variants: int,
) -> None:
    """
    Send WebSocket notification for training completion.

    Args:
        job_id: Job identifier
        metrics: Final metrics
        total_variants: Number of pipeline variants evaluated
    """
    import asyncio

    try:
        from websocket import notify_training_complete

        async def send_notification():
            await notify_training_complete(
                job_id,
                metrics,
                total_variants,
            )

        try:
            loop = asyncio.get_running_loop()
            asyncio.run_coroutine_threadsafe(send_notification(), loop)
        except RuntimeError:
            try:
                asyncio.run(send_notification())
            except Exception as e:
                print(f"Error running completion notification: {e}")

    except ImportError:
        pass
    except Exception as e:
        print(f"Error sending completion notification: {e}")
