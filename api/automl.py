"""
AutoML API routes for nirs4all webapp.

This module provides FastAPI routes for automated machine learning search,
including hyperparameter optimization, model selection, and pipeline optimization.

Phase 6 Implementation:
- AutoML search start/stop
- Trial tracking and results
- Best model selection
- Search space configuration

Refactored to use nirs4all pipeline generators (_or_, _range_, _log_range_)
instead of manual random search. Uses nirs4all.run() for training and
RunResult.export() for model saving.
"""

from __future__ import annotations

import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager
from .jobs import job_manager, Job, JobStatus, JobType
from .shared.logger import get_logger

logger = get_logger(__name__)

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    import nirs4all
    from nirs4all.data.dataset import SpectroDataset

    NIRS4ALL_AVAILABLE = True
except ImportError as e:
    logger.info("nirs4all not available for AutoML API: %s", e)
    NIRS4ALL_AVAILABLE = False


router = APIRouter()


# ============= Request/Response Models =============


class SearchSpaceParam(BaseModel):
    """Definition of a hyperparameter search space."""

    name: str = Field(..., description="Parameter name")
    type: str = Field(..., description="Parameter type: int, float, categorical")
    low: Optional[float] = Field(None, description="Lower bound (for int/float)")
    high: Optional[float] = Field(None, description="Upper bound (for int/float)")
    choices: Optional[List[Any]] = Field(None, description="Choices (for categorical)")
    log: bool = Field(False, description="Use log scale (for int/float)")


class ModelSearchConfig(BaseModel):
    """Configuration for a model in the search space."""

    model_name: str = Field(..., description="Model class name")
    enabled: bool = Field(True, description="Whether to include in search")
    params: List[SearchSpaceParam] = Field(
        default_factory=list,
        description="Hyperparameters to tune",
    )


class AutoMLRequest(BaseModel):
    """Request model for starting an AutoML search."""

    dataset_id: str = Field(..., description="ID of the dataset to use")
    partition: str = Field("train", description="Dataset partition to use")
    task_type: str = Field("regression", description="Task type: regression or classification")
    metric: str = Field("r2", description="Optimization metric")
    n_trials: int = Field(50, ge=5, le=500, description="Number of trials")
    timeout_seconds: Optional[int] = Field(
        None, ge=60, description="Maximum time in seconds"
    )
    cv_folds: int = Field(5, ge=2, le=10, description="Cross-validation folds")
    validation_split: float = Field(0.2, ge=0.1, le=0.4, description="Validation split ratio")
    random_state: Optional[int] = Field(42, description="Random seed")
    preprocessing_chain: Optional[List[Dict[str, Any]]] = Field(
        None, description="Fixed preprocessing chain to apply"
    )
    models: Optional[List[ModelSearchConfig]] = Field(
        None, description="Models to search (None for defaults)"
    )
    include_preprocessing_search: bool = Field(
        False, description="Include preprocessing in search"
    )


class TrialResult(BaseModel):
    """Result of a single AutoML trial."""

    trial_id: int
    model_name: str
    params: Dict[str, Any]
    score: float
    std: Optional[float] = None
    duration_seconds: float
    status: str  # "completed", "failed", "pruned"
    error: Optional[str] = None


class AutoMLStatus(BaseModel):
    """Status of an AutoML search job."""

    job_id: str
    status: str
    progress: float
    progress_message: str
    trials_completed: int
    trials_total: int
    best_score: Optional[float] = None
    best_model: Optional[str] = None
    elapsed_seconds: float
    created_at: str


class AutoMLResults(BaseModel):
    """Final results of an AutoML search."""

    job_id: str
    status: str
    best_score: float
    best_model: str
    best_params: Dict[str, Any]
    all_trials: List[TrialResult]
    model_path: Optional[str] = None
    search_duration_seconds: float


# ============= Default Search Spaces =============


def get_default_regression_models() -> List[Dict[str, Any]]:
    """Get default model search space for regression tasks."""
    return [
        {
            "model_name": "PLSRegression",
            "enabled": True,
            "params": [
                {"name": "n_components", "type": "int", "low": 2, "high": 50},
            ],
        },
        {
            "model_name": "Ridge",
            "enabled": True,
            "params": [
                {"name": "alpha", "type": "float", "low": 0.001, "high": 100.0, "log": True},
            ],
        },
        {
            "model_name": "Lasso",
            "enabled": True,
            "params": [
                {"name": "alpha", "type": "float", "low": 0.001, "high": 100.0, "log": True},
            ],
        },
        {
            "model_name": "ElasticNet",
            "enabled": True,
            "params": [
                {"name": "alpha", "type": "float", "low": 0.001, "high": 100.0, "log": True},
                {"name": "l1_ratio", "type": "float", "low": 0.1, "high": 0.9},
            ],
        },
        {
            "model_name": "SVR",
            "enabled": True,
            "params": [
                {"name": "C", "type": "float", "low": 0.1, "high": 100.0, "log": True},
                {"name": "gamma", "type": "categorical", "choices": ["scale", "auto"]},
                {"name": "kernel", "type": "categorical", "choices": ["rbf", "linear", "poly"]},
            ],
        },
        {
            "model_name": "RandomForestRegressor",
            "enabled": True,
            "params": [
                {"name": "n_estimators", "type": "int", "low": 50, "high": 300},
                {"name": "max_depth", "type": "int", "low": 3, "high": 20},
                {"name": "min_samples_split", "type": "int", "low": 2, "high": 20},
            ],
        },
        {
            "model_name": "GradientBoostingRegressor",
            "enabled": True,
            "params": [
                {"name": "n_estimators", "type": "int", "low": 50, "high": 200},
                {"name": "max_depth", "type": "int", "low": 2, "high": 10},
                {"name": "learning_rate", "type": "float", "low": 0.01, "high": 0.3, "log": True},
            ],
        },
        {
            "model_name": "KNeighborsRegressor",
            "enabled": True,
            "params": [
                {"name": "n_neighbors", "type": "int", "low": 1, "high": 30},
                {"name": "weights", "type": "categorical", "choices": ["uniform", "distance"]},
            ],
        },
    ]


def get_default_classification_models() -> List[Dict[str, Any]]:
    """Get default model search space for classification tasks."""
    return [
        {
            "model_name": "LogisticRegression",
            "enabled": True,
            "params": [
                {"name": "C", "type": "float", "low": 0.001, "high": 100.0, "log": True},
                {"name": "solver", "type": "categorical", "choices": ["lbfgs", "saga"]},
            ],
        },
        {
            "model_name": "SVC",
            "enabled": True,
            "params": [
                {"name": "C", "type": "float", "low": 0.1, "high": 100.0, "log": True},
                {"name": "gamma", "type": "categorical", "choices": ["scale", "auto"]},
                {"name": "kernel", "type": "categorical", "choices": ["rbf", "linear", "poly"]},
            ],
        },
        {
            "model_name": "RandomForestClassifier",
            "enabled": True,
            "params": [
                {"name": "n_estimators", "type": "int", "low": 50, "high": 300},
                {"name": "max_depth", "type": "int", "low": 3, "high": 20},
                {"name": "min_samples_split", "type": "int", "low": 2, "high": 20},
            ],
        },
        {
            "model_name": "GradientBoostingClassifier",
            "enabled": True,
            "params": [
                {"name": "n_estimators", "type": "int", "low": 50, "high": 200},
                {"name": "max_depth", "type": "int", "low": 2, "high": 10},
                {"name": "learning_rate", "type": "float", "low": 0.01, "high": 0.3, "log": True},
            ],
        },
    ]


# ============= AutoML Routes =============


@router.post("/automl/start", response_model=AutoMLStatus)
async def start_automl(request: AutoMLRequest):
    """
    Start an AutoML search job.

    Performs automated model selection and hyperparameter optimization
    using cross-validation. Supports regression and classification tasks.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all library not available for AutoML",
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Validate dataset exists
    from .spectra import _load_dataset

    dataset = _load_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=404,
            detail=f"Dataset '{request.dataset_id}' not found",
        )

    # Get default models if not specified
    if request.models is None:
        if request.task_type == "classification":
            models_config = get_default_classification_models()
        else:
            models_config = get_default_regression_models()
    else:
        models_config = [m.model_dump() for m in request.models]

    # Filter enabled models
    enabled_models = [m for m in models_config if m.get("enabled", True)]
    if not enabled_models:
        raise HTTPException(
            status_code=400,
            detail="No models enabled for search",
        )

    # Create job configuration
    job_config = {
        "dataset_id": request.dataset_id,
        "dataset_name": dataset.name,
        "partition": request.partition,
        "task_type": request.task_type,
        "metric": request.metric,
        "n_trials": request.n_trials,
        "timeout_seconds": request.timeout_seconds,
        "cv_folds": request.cv_folds,
        "validation_split": request.validation_split,
        "random_state": request.random_state,
        "preprocessing_chain": request.preprocessing_chain,
        "models": enabled_models,
        "include_preprocessing_search": request.include_preprocessing_search,
        "workspace_path": workspace.path,
    }

    # Create and submit job
    job = job_manager.create_job(JobType.AUTOML, job_config)
    job_manager.submit_job(job, _run_automl_task)

    return AutoMLStatus(
        job_id=job.id,
        status=job.status.value,
        progress=job.progress,
        progress_message=job.progress_message,
        trials_completed=0,
        trials_total=request.n_trials,
        best_score=None,
        best_model=None,
        elapsed_seconds=0.0,
        created_at=job.created_at.isoformat(),
    )


@router.get("/automl/{job_id}", response_model=AutoMLStatus)
async def get_automl_status(job_id: str):
    """Get the status of an AutoML search job."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    if job.type != JobType.AUTOML:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_id}' is not an AutoML job",
        )

    return AutoMLStatus(
        job_id=job.id,
        status=job.status.value,
        progress=job.progress,
        progress_message=job.progress_message,
        trials_completed=job.metrics.get("trials_completed", 0),
        trials_total=job.config.get("n_trials", 0),
        best_score=job.metrics.get("best_score"),
        best_model=job.metrics.get("best_model"),
        elapsed_seconds=job._get_duration() or 0.0,
        created_at=job.created_at.isoformat(),
    )


@router.post("/automl/{job_id}/stop")
async def stop_automl(job_id: str):
    """
    Stop a running AutoML search.

    The search will stop after completing the current trial.
    """
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    if job.type != JobType.AUTOML:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_id}' is not an AutoML job",
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
        "message": "Search stop requested",
    }


@router.get("/automl/{job_id}/results", response_model=AutoMLResults)
async def get_automl_results(job_id: str):
    """
    Get the results of a completed AutoML search.

    Returns the best model, parameters, and all trial results.
    """
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    if job.type != JobType.AUTOML:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_id}' is not an AutoML job",
        )

    if job.status not in (JobStatus.COMPLETED, JobStatus.CANCELLED):
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_id}' is not completed (status: {job.status.value})",
        )

    result = job.result or {}
    trials = result.get("trials", [])

    return AutoMLResults(
        job_id=job.id,
        status=job.status.value,
        best_score=result.get("best_score", 0.0),
        best_model=result.get("best_model", "Unknown"),
        best_params=result.get("best_params", {}),
        all_trials=[
            TrialResult(
                trial_id=t.get("trial_id", 0),
                model_name=t.get("model_name", "Unknown"),
                params=t.get("params", {}),
                score=t.get("score", 0.0),
                std=t.get("std"),
                duration_seconds=t.get("duration_seconds", 0.0),
                status=t.get("status", "unknown"),
                error=t.get("error"),
            )
            for t in trials
        ],
        model_path=result.get("model_path"),
        search_duration_seconds=job._get_duration() or 0.0,
    )


@router.get("/automl/{job_id}/trials")
async def get_automl_trials(job_id: str):
    """
    Get all trials from an AutoML search.

    Returns detailed information about each trial including
    parameters, scores, and timing.
    """
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    if job.type != JobType.AUTOML:
        raise HTTPException(
            status_code=400,
            detail=f"Job '{job_id}' is not an AutoML job",
        )

    result = job.result or {}
    trials = result.get("trials", job.history)

    return {
        "job_id": job_id,
        "status": job.status.value,
        "trials_completed": len(trials),
        "trials": trials,
    }


@router.get("/automl/jobs")
async def list_automl_jobs(
    status: Optional[str] = None,
    limit: int = 50,
):
    """
    List all AutoML jobs.

    Returns a list of AutoML jobs with optional status filtering.
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
        job_type=JobType.AUTOML,
        status=status_filter,
        limit=limit,
    )

    return {
        "jobs": [
            {
                "job_id": j.id,
                "status": j.status.value,
                "progress": j.progress,
                "dataset_name": j.config.get("dataset_name", "Unknown"),
                "task_type": j.config.get("task_type", "Unknown"),
                "n_trials": j.config.get("n_trials", 0),
                "trials_completed": j.metrics.get("trials_completed", 0),
                "best_score": j.metrics.get("best_score"),
                "best_model": j.metrics.get("best_model"),
                "created_at": j.created_at.isoformat(),
                "duration_seconds": j._get_duration(),
            }
            for j in jobs
        ],
        "total": len(jobs),
    }


@router.get("/automl/models")
async def list_available_models(task_type: str = "regression"):
    """
    List available models for AutoML search.

    Returns the default search space for the specified task type.
    """
    if task_type == "classification":
        models = get_default_classification_models()
    else:
        models = get_default_regression_models()

    return {
        "task_type": task_type,
        "models": models,
    }


# ============= Pipeline Generator Helpers =============


def _build_model_generator_step(models_config: List[Dict[str, Any]], n_trials: int) -> Dict[str, Any]:
    """
    Build a pipeline model step using nirs4all generator syntax.

    Converts AutoML search space configuration to nirs4all's _or_ and _range_/_log_range_
    generator keywords for automated hyperparameter search.

    Args:
        models_config: List of model configurations with search spaces
        n_trials: Maximum number of trials (used for count limiting)

    Returns:
        Pipeline step dict using generator syntax
    """
    model_choices = []

    for model_config in models_config:
        model_name = model_config["model_name"]
        params = model_config.get("params", [])

        # Build the model class reference
        model_class = _get_model_class(model_name)
        if model_class is None:
            continue

        if not params:
            # No hyperparameters to tune - use model directly
            model_choices.append(model_class)
        else:
            # Build parameter generators using nirs4all syntax
            param_generators = {}
            for p in params:
                param_name = p.get("name")
                p_type = p.get("type", "float")

                if p_type == "categorical":
                    choices = p.get("choices", [])
                    if choices:
                        param_generators[param_name] = {"_or_": choices}

                elif p_type == "int":
                    low = int(p.get("low", 1))
                    high = int(p.get("high", 100))
                    if p.get("log", False):
                        # Use log range for log-scale parameters
                        param_generators[param_name] = {"_log_range_": [low, high, 10]}
                    else:
                        # Use range with step calculated for reasonable coverage
                        step = max(1, (high - low) // 10)
                        param_generators[param_name] = {"_range_": [low, high, step]}

                elif p_type == "float":
                    low = float(p.get("low", 0.0))
                    high = float(p.get("high", 1.0))
                    if p.get("log", False):
                        # Use log range for log-scale parameters
                        param_generators[param_name] = {"_log_range_": [low, high, 10]}
                    else:
                        # Use range with 10 steps
                        step = (high - low) / 10
                        param_generators[param_name] = {"_range_": [low, high, step]}

            # Create model config dict with parameter generators
            model_step = {"class": model_class, **param_generators}
            model_choices.append(model_step)

    # Wrap in _or_ generator with count limit
    return {"model": {"_or_": model_choices}, "count": n_trials}


def _get_model_class(model_name: str):
    """
    Get the model class for a given model name.

    Args:
        model_name: Name of the model class

    Returns:
        Model class or None if not found
    """
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

    if model_name in sklearn_models:
        import importlib
        module_name, class_name = sklearn_models[model_name]
        try:
            module = importlib.import_module(module_name)
            return getattr(module, class_name)
        except Exception as e:
            logger.error("Error loading model %s: %s", model_name, e)
            return None

    return None


# ============= AutoML Task Implementation =============


def _run_automl_task(
    job: Job,
    progress_callback: Callable[[float, str], bool],
) -> Dict[str, Any]:
    """
    Execute the AutoML search task using nirs4all.run() with generator pipelines.

    This function runs in a background thread and performs hyperparameter
    optimization using nirs4all's built-in generator expansion and cross-validation.

    Args:
        job: The job instance
        progress_callback: Callback to report progress

    Returns:
        AutoML result dictionary
    """
    config = job.config
    start_time = time.time()

    # Load dataset
    from .spectra import _load_dataset

    dataset = _load_dataset(config["dataset_id"])
    if not dataset:
        raise ValueError(f"Dataset '{config['dataset_id']}' not found")

    # Get configuration
    n_trials = config.get("n_trials", 50)
    cv_folds = config.get("cv_folds", 5)
    random_state = config.get("random_state", 42)
    models_config = config.get("models", [])
    preprocessing_chain = config.get("preprocessing_chain")
    workspace_path = config.get("workspace_path")

    progress_callback(5.0, "Building pipeline with generators...")

    # Build pipeline using generator syntax
    pipeline_steps = []

    # Add preprocessing if specified
    if preprocessing_chain:
        for step in preprocessing_chain:
            step_name = step.get("name", "")
            step_params = step.get("params", {})
            transformer_class = _get_transformer_class(step_name)
            if transformer_class:
                pipeline_steps.append(transformer_class(**step_params))

    # Add cross-validation splitter
    from sklearn.model_selection import KFold
    pipeline_steps.append(KFold(n_splits=cv_folds, shuffle=True, random_state=random_state))

    # Build model generator step
    model_step = _build_model_generator_step(models_config, n_trials)
    pipeline_steps.append(model_step)

    progress_callback(10.0, f"Running {n_trials} trial configurations...")

    # Run pipeline using nirs4all.run()
    try:
        result = nirs4all.run(
            pipeline=pipeline_steps,
            dataset=dataset,
            verbose=0,
            save_artifacts=True,
            random_state=random_state,
            max_generation_count=n_trials,
            workspace_path=workspace_path,
        )
    except Exception as e:
        raise ValueError(f"Pipeline execution failed: {e}")

    progress_callback(90.0, "Processing results...")

    # Extract trials from predictions
    trials = []
    all_predictions = result.predictions.top(n=n_trials * 10)  # Get all predictions

    for idx, pred in enumerate(all_predictions):
        model_name = pred.get("model_name", "Unknown")
        params = pred.get("model_params", {})
        test_score = pred.get("test_score", 0.0)
        scores = pred.get("scores", {})
        test_scores = scores.get("test", {}) if isinstance(scores, dict) else {}

        trials.append({
            "trial_id": idx,
            "model_name": model_name,
            "params": params,
            "score": float(test_score) if test_score else 0.0,
            "std": None,  # CV std not directly available from predictions
            "duration_seconds": 0.0,  # Timing not tracked per-trial in batch mode
            "status": "completed",
            "error": None,
        })

        # Update job metrics periodically
        if idx % 10 == 0:
            job_manager.update_job_metrics(
                job.id,
                {
                    "trials_completed": idx + 1,
                    "best_score": result.best_score if result.best else None,
                    "best_model": result.best.get("model_name") if result.best else None,
                },
            )
            progress = 10.0 + (idx / len(all_predictions)) * 80.0
            if not progress_callback(progress, f"Processed {idx + 1} trials..."):
                break

    # Get best result
    best = result.best
    best_score = result.best_score if best else 0.0
    best_model_name = best.get("model_name", "Unknown") if best else "Unknown"
    best_params = best.get("model_params", {}) if best else {}

    # Export best model using RunResult.export()
    model_path = None
    if best and workspace_path:
        try:
            models_dir = Path(workspace_path) / "models"
            models_dir.mkdir(exist_ok=True)

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            model_filename = f"automl_{best_model_name}_{job.id}_{timestamp}.n4a"
            export_path = models_dir / model_filename

            result.export(str(export_path))
            model_path = str(export_path)
        except Exception as e:
            logger.error("Error exporting AutoML model: %s", e)

    progress_callback(100.0, "AutoML search complete")

    # Sort trials by score
    completed_trials = [t for t in trials if t["status"] == "completed"]
    completed_trials.sort(key=lambda t: t["score"], reverse=True)

    return {
        "best_score": float(best_score) if best_score else 0.0,
        "best_model": best_model_name,
        "best_params": best_params,
        "trials": completed_trials,
        "model_path": model_path,
        "total_trials": len(trials),
        "completed_trials": len(completed_trials),
        "search_duration_seconds": time.time() - start_time,
    }


def _get_transformer_class(name: str):
    """
    Get a transformer class by name from nirs4all operators.

    Args:
        name: Transformer name

    Returns:
        Transformer class or None
    """
    try:
        from nirs4all.operators import transforms

        # Map common names to transformer classes
        transformer_map = {
            "snv": transforms.SNV,
            "msc": transforms.MSC,
            "detrend": transforms.Detrend,
            "savitzky_golay": transforms.SavitzkyGolay,
            "savgol": transforms.SavitzkyGolay,
            "normalize": transforms.Normalize,
            "center": transforms.Center,
            "autoscale": transforms.Autoscale,
        }

        return transformer_map.get(name.lower())
    except ImportError:
        return None


def _send_trial_notification(
    job_id: str,
    trial_result: Dict[str, Any],
    trial_num: int,
    total_trials: int,
) -> None:
    """
    Send WebSocket notification for trial completion.

    Args:
        job_id: Job identifier
        trial_result: Trial result data
        trial_num: Current trial number
        total_trials: Total number of trials
    """
    import asyncio

    try:
        from websocket import ws_manager

        async def send_notification():
            message = {
                "type": "automl_trial",
                "job_id": job_id,
                "trial_num": trial_num,
                "total_trials": total_trials,
                "trial": trial_result,
            }
            await ws_manager.broadcast_to_channel(f"job:{job_id}", message)

        try:
            loop = asyncio.get_running_loop()
            asyncio.run_coroutine_threadsafe(send_notification(), loop)
        except RuntimeError:
            try:
                asyncio.run(send_notification())
            except Exception as e:
                logger.error("Error running trial notification: %s", e)

    except ImportError:
        pass
    except Exception as e:
        logger.error("Error sending trial notification: %s", e)
