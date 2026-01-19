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
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager
from .jobs import job_manager, Job, JobStatus, JobType
from .nirs4all_adapter import (
    NIRS4ALL_AVAILABLE,
    require_nirs4all,
    build_pipeline_steps,
    build_dataset_spec,
    ensure_models_dir,
    extract_metrics_from_prediction,
)

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

if not NIRS4ALL_AVAILABLE:
    print("Note: nirs4all not available for training API")


router = APIRouter()


# ============= Request/Response Models =============


class TrainingRequest(BaseModel):
    """Request model for starting a training job."""

    pipeline_id: str = Field(..., description="ID of the pipeline to run")
    dataset_id: str = Field(..., description="ID of the dataset to train on")
    partition: str = Field("train", description="Dataset partition to use")
    epochs: int = Field(100, ge=1, le=10000, description="Number of training epochs")
    batch_size: int = Field(32, ge=1, le=1024, description="Batch size for training")
    validation_split: float = Field(0.2, ge=0.0, le=0.5, description="Validation split ratio")
    early_stopping: bool = Field(True, description="Enable early stopping")
    early_stopping_patience: int = Field(10, ge=1, description="Early stopping patience")
    save_best_model: bool = Field(True, description="Save the best model checkpoint")
    random_state: Optional[int] = Field(42, description="Random seed for reproducibility")


class ResumeTrainingRequest(BaseModel):
    """Request model for resuming a training job."""

    job_id: str = Field(..., description="ID of the job to resume")
    additional_epochs: int = Field(50, ge=1, description="Additional epochs to train")


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
    pipeline and dataset configuration.
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
        "epochs": request.epochs,
        "batch_size": request.batch_size,
        "validation_split": request.validation_split,
        "early_stopping": request.early_stopping,
        "early_stopping_patience": request.early_stopping_patience,
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

    Returns epoch-by-epoch metrics including loss, validation metrics,
    and best achieved metrics.
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
    total_epochs = job.config.get("epochs", 0)

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

    Returns the complete epoch-by-epoch history of metrics.
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
        "total_epochs": len(job.history),
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


@router.post("/training/resume")
async def resume_training(request: ResumeTrainingRequest):
    """
    Resume a previously stopped or completed training job.

    Creates a new job that continues training from the last checkpoint.
    """
    original_job = job_manager.get_job(request.job_id)
    if not original_job:
        raise HTTPException(
            status_code=404,
            detail=f"Original job '{request.job_id}' not found",
        )

    if original_job.type != JobType.TRAINING:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{request.job_id}' is not a training job",
        )

    if original_job.status == JobStatus.RUNNING:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{request.job_id}' is still running",
        )

    # Create new job with resumed configuration
    resumed_config = dict(original_job.config)
    resumed_config["resumed_from"] = request.job_id
    resumed_config["epochs"] = request.additional_epochs
    resumed_config["initial_epoch"] = original_job.metrics.get("current_epoch", 0)

    # Get checkpoint path if available
    if original_job.result and original_job.result.get("model_path"):
        resumed_config["checkpoint_path"] = original_job.result["model_path"]

    job = job_manager.create_job(JobType.TRAINING, resumed_config)
    job_manager.submit_job(job, _run_training_task)

    return {
        "success": True,
        "job_id": job.id,
        "resumed_from": request.job_id,
        "status": job.status.value,
    }


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
    Execute the training task.

    This function runs in a background thread and performs the actual
    model training using nirs4all.

    Args:
        job: The job instance
        progress_callback: Callback to report progress

    Returns:
        Training result dictionary
    """
    config = job.config

    # Load dataset
    from .spectra import _load_dataset

    dataset = _load_dataset(config["dataset_id"])
    if not dataset:
        raise ValueError(f"Dataset '{config['dataset_id']}' not found")

    # Get training data
    selector = {"partition": config.get("partition", "train")}
    X = dataset.x(selector, layout="2d")
    if isinstance(X, list):
        X = X[0]

    y = None
    try:
        y = dataset.y(selector)
    except Exception:
        pass

    if y is None:
        raise ValueError("Dataset has no target values for training")

    n_samples = X.shape[0]
    epochs = config.get("epochs", 100)
    validation_split = config.get("validation_split", 0.2)
    initial_epoch = config.get("initial_epoch", 0)

    # Split into train/validation
    if validation_split > 0:
        from sklearn.model_selection import train_test_split

        X_train, X_val, y_train, y_val = train_test_split(
            X, y,
            test_size=validation_split,
            random_state=config.get("random_state", 42),
        )
    else:
        X_train, y_train = X, y
        X_val, y_val = None, None

    # Load pipeline configuration
    from .pipelines import _load_pipeline

    pipeline_config = _load_pipeline(config["pipeline_id"])
    steps = pipeline_config.get("steps", [])

    # Build preprocessing chain and model from pipeline steps
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

    # Apply preprocessing
    if preprocessing_steps:
        from .spectra import _apply_preprocessing_chain

        X_train = _apply_preprocessing_chain(X_train, preprocessing_steps)
        if X_val is not None:
            X_val = _apply_preprocessing_chain(X_val, preprocessing_steps)

    # Get model class
    model = _get_model_instance(model_step, model_params)
    if model is None:
        raise ValueError(f"Model '{model_step}' not found or not supported")

    # Initialize metrics tracking
    best_val_score = float("-inf")
    best_metrics = {}
    history = []

    # Training loop
    for epoch in range(initial_epoch, epochs):
        # Check for cancellation
        if not progress_callback(
            (epoch / epochs) * 100,
            f"Epoch {epoch + 1}/{epochs}",
        ):
            break

        epoch_start = time.time()

        # Fit model (for sklearn-like models, this is a single fit)
        # For iterative models, we would do partial_fit
        if epoch == initial_epoch:
            model.fit(X_train, y_train.ravel() if y_train.ndim > 1 else y_train)

        # Compute training metrics
        y_train_pred = model.predict(X_train)
        train_metrics = _compute_metrics(y_train, y_train_pred)

        # Compute validation metrics
        val_metrics = None
        if X_val is not None and y_val is not None:
            y_val_pred = model.predict(X_val)
            val_metrics = _compute_metrics(y_val, y_val_pred)

            # Track best model
            val_score = val_metrics.get("r2", val_metrics.get("accuracy", 0))
            if val_score > best_val_score:
                best_val_score = val_score
                best_metrics = {
                    "epoch": epoch + 1,
                    "train": train_metrics,
                    "val": val_metrics,
                }

        epoch_time = time.time() - epoch_start

        # Record history
        history_entry = {
            "epoch": epoch + 1,
            "train": train_metrics,
            "val": val_metrics,
            "epoch_time": epoch_time,
        }
        history.append(history_entry)

        # Update job metrics
        job_manager.update_job_metrics(
            job.id,
            {
                "current_epoch": epoch + 1,
                "train": train_metrics,
                "val": val_metrics,
                "best": best_metrics,
            },
            append_history=True,
        )

        # Send WebSocket notification for epoch completion
        _send_epoch_notification(
            job.id,
            epoch + 1,
            epochs,
            train_metrics,
            val_metrics,
        )

        # For sklearn models that fit in one go, we can break after first epoch
        if not hasattr(model, "partial_fit"):
            progress_callback(100, f"Training complete (single-fit model)")
            break

    # Save model if configured
    model_path = None
    if config.get("save_best_model", True):
        model_path = _save_trained_model(
            model,
            config["workspace_path"],
            config["pipeline_id"],
            job.id,
        )

    # Final result
    result = {
        "final_metrics": {
            "train": train_metrics,
            "val": val_metrics,
        },
        "best_metrics": best_metrics,
        "model_path": model_path,
        "total_epochs": len(history),
        "samples_trained": X_train.shape[0],
        "samples_validated": X_val.shape[0] if X_val is not None else 0,
    }

    return result


def _get_model_instance(model_name: str, params: Dict[str, Any]) -> Any:
    """
    Get a model instance by name.

    Args:
        model_name: Name of the model class
        params: Model parameters

    Returns:
        Model instance or None if not found
    """
    if not model_name:
        return None

    # sklearn models
    sklearn_models = {
        "PLSRegression": ("sklearn.cross_decomposition", "PLSRegression"),
        "RandomForestRegressor": ("sklearn.ensemble", "RandomForestRegressor"),
        "GradientBoostingRegressor": ("sklearn.ensemble", "GradientBoostingRegressor"),
        "SVR": ("sklearn.svm", "SVR"),
        "Ridge": ("sklearn.linear_model", "Ridge"),
        "Lasso": ("sklearn.linear_model", "Lasso"),
        "ElasticNet": ("sklearn.linear_model", "ElasticNet"),
        "KNeighborsRegressor": ("sklearn.neighbors", "KNeighborsRegressor"),
        "DecisionTreeRegressor": ("sklearn.tree", "DecisionTreeRegressor"),
        # Classification models
        "RandomForestClassifier": ("sklearn.ensemble", "RandomForestClassifier"),
        "GradientBoostingClassifier": ("sklearn.ensemble", "GradientBoostingClassifier"),
        "SVC": ("sklearn.svm", "SVC"),
        "LogisticRegression": ("sklearn.linear_model", "LogisticRegression"),
    }

    # Check sklearn models
    if model_name in sklearn_models:
        import importlib

        module_name, class_name = sklearn_models[model_name]
        try:
            module = importlib.import_module(module_name)
            model_class = getattr(module, class_name)
            return model_class(**params)
        except Exception as e:
            print(f"Error loading sklearn model {model_name}: {e}")
            return None

    # Check nirs4all models
    if NIRS4ALL_AVAILABLE:
        try:
            from nirs4all.operators import models as nirs4all_models

            model_class = getattr(nirs4all_models, model_name, None)
            if model_class:
                return model_class(**params)
        except Exception as e:
            print(f"Error loading nirs4all model {model_name}: {e}")

    return None


def _compute_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    """
    Compute evaluation metrics.

    Args:
        y_true: True values
        y_pred: Predicted values

    Returns:
        Dictionary of metrics
    """
    from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error

    y_true = y_true.ravel() if y_true.ndim > 1 else y_true
    y_pred = y_pred.ravel() if y_pred.ndim > 1 else y_pred

    metrics = {
        "r2": float(r2_score(y_true, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "mae": float(mean_absolute_error(y_true, y_pred)),
    }

    # Add RPD (Ratio of Performance to Deviation)
    std_dev = np.std(y_true)
    if std_dev > 0:
        metrics["rpd"] = float(std_dev / metrics["rmse"])

    # Add bias
    metrics["bias"] = float(np.mean(y_pred - y_true))

    return metrics


def _save_trained_model(
    model: Any,
    workspace_path: str,
    pipeline_id: str,
    job_id: str,
) -> Optional[str]:
    """
    Save a trained model to disk.

    Args:
        model: The trained model
        workspace_path: Path to the workspace
        pipeline_id: Pipeline ID
        job_id: Training job ID

    Returns:
        Path to the saved model or None if saving failed
    """
    import joblib

    try:
        models_dir = Path(workspace_path) / "models"
        models_dir.mkdir(exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        model_filename = f"{pipeline_id}_{job_id}_{timestamp}.joblib"
        model_path = models_dir / model_filename

        joblib.dump(model, model_path)

        return str(model_path)

    except Exception as e:
        print(f"Error saving model: {e}")
        return None


def _send_epoch_notification(
    job_id: str,
    epoch: int,
    total_epochs: int,
    train_metrics: Dict[str, float],
    val_metrics: Optional[Dict[str, float]] = None,
) -> None:
    """
    Send WebSocket notification for training epoch completion.

    This function handles the async WebSocket notification from
    a synchronous training thread.

    Args:
        job_id: Job identifier
        epoch: Current epoch number
        total_epochs: Total number of epochs
        train_metrics: Training metrics for this epoch
        val_metrics: Optional validation metrics
    """
    import asyncio

    try:
        from websocket import notify_training_epoch

        async def send_notification():
            await notify_training_epoch(
                job_id,
                epoch,
                total_epochs,
                train_metrics,
                val_metrics,
            )

        # Try to get running event loop
        try:
            loop = asyncio.get_running_loop()
            asyncio.run_coroutine_threadsafe(send_notification(), loop)
        except RuntimeError:
            # No running loop - create one for this notification
            try:
                asyncio.run(send_notification())
            except Exception as e:
                print(f"Error running epoch notification: {e}")

    except ImportError:
        # WebSocket module not available, skip notification
        pass
    except Exception as e:
        print(f"Error sending epoch notification: {e}")
