"""
AutoML API routes for nirs4all webapp.

This module provides FastAPI routes for automated machine learning search,
including hyperparameter optimization, model selection, and pipeline optimization.

Phase 6 Implementation:
- AutoML search start/stop
- Trial tracking and results
- Best model selection
- Search space configuration
"""

import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager
from .jobs import job_manager, Job, JobStatus, JobType

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    from nirs4all.data.dataset import SpectroDataset

    NIRS4ALL_AVAILABLE = True
except ImportError as e:
    print(f"Note: nirs4all not available for AutoML API: {e}")
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


# ============= AutoML Task Implementation =============


def _run_automl_task(
    job: Job,
    progress_callback: Callable[[float, str], bool],
) -> Dict[str, Any]:
    """
    Execute the AutoML search task.

    This function runs in a background thread and performs the actual
    hyperparameter optimization using cross-validation.

    Args:
        job: The job instance
        progress_callback: Callback to report progress

    Returns:
        AutoML result dictionary
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
        raise ValueError("Dataset has no target values for AutoML")

    y = y.ravel() if y.ndim > 1 else y

    # Apply preprocessing if specified
    preprocessing_chain = config.get("preprocessing_chain")
    if preprocessing_chain:
        from .spectra import _apply_preprocessing_chain

        X = _apply_preprocessing_chain(X, preprocessing_chain)

    # Get search configuration
    n_trials = config.get("n_trials", 50)
    cv_folds = config.get("cv_folds", 5)
    metric = config.get("metric", "r2")
    task_type = config.get("task_type", "regression")
    timeout = config.get("timeout_seconds")
    random_state = config.get("random_state", 42)
    models_config = config.get("models", [])

    # Scoring function
    from sklearn.model_selection import cross_val_score

    scoring = _get_sklearn_scorer(metric, task_type)

    # Track results
    trials: List[Dict[str, Any]] = []
    best_score = float("-inf")
    best_model_name = ""
    best_params: Dict[str, Any] = {}
    best_model_instance = None

    start_time = time.time()
    trial_idx = 0

    # Random search across models and parameters
    np.random.seed(random_state)

    while trial_idx < n_trials:
        # Check for cancellation
        elapsed = time.time() - start_time
        if timeout and elapsed > timeout:
            break

        progress = (trial_idx / n_trials) * 100
        if not progress_callback(progress, f"Trial {trial_idx + 1}/{n_trials}"):
            break

        # Select a random model
        model_config = models_config[np.random.randint(len(models_config))]
        model_name = model_config["model_name"]

        # Sample hyperparameters
        params = _sample_params(model_config.get("params", []))

        trial_start = time.time()
        trial_result: Dict[str, Any] = {
            "trial_id": trial_idx,
            "model_name": model_name,
            "params": params,
            "status": "failed",
            "score": 0.0,
            "std": None,
            "duration_seconds": 0.0,
            "error": None,
        }

        try:
            # Create model instance
            model = _get_model_instance(model_name, params)
            if model is None:
                raise ValueError(f"Model '{model_name}' not found")

            # Evaluate with cross-validation
            cv_scores = cross_val_score(
                model, X, y,
                cv=cv_folds,
                scoring=scoring,
            )

            score = cv_scores.mean()
            std = cv_scores.std()

            trial_result["status"] = "completed"
            trial_result["score"] = float(score)
            trial_result["std"] = float(std)

            # Track best
            if score > best_score:
                best_score = score
                best_model_name = model_name
                best_params = params
                # Retrain on full data for the best model
                best_model_instance = model.fit(X, y)

        except Exception as e:
            trial_result["status"] = "failed"
            trial_result["error"] = str(e)

        trial_result["duration_seconds"] = time.time() - trial_start
        trials.append(trial_result)

        # Update job metrics
        job_manager.update_job_metrics(
            job.id,
            {
                "trials_completed": trial_idx + 1,
                "best_score": best_score if best_score > float("-inf") else None,
                "best_model": best_model_name,
                "last_trial": trial_result,
            },
            append_history=True,
        )

        # Send WebSocket notification
        _send_trial_notification(job.id, trial_result, trial_idx + 1, n_trials)

        trial_idx += 1

    # Save best model if we have one
    model_path = None
    if best_model_instance is not None:
        model_path = _save_automl_model(
            best_model_instance,
            config["workspace_path"],
            job.id,
            best_model_name,
        )

    # Sort trials by score
    completed_trials = [t for t in trials if t["status"] == "completed"]
    completed_trials.sort(key=lambda t: t["score"], reverse=True)
    failed_trials = [t for t in trials if t["status"] != "completed"]
    sorted_trials = completed_trials + failed_trials

    # Final result
    result = {
        "best_score": best_score if best_score > float("-inf") else 0.0,
        "best_model": best_model_name,
        "best_params": best_params,
        "trials": sorted_trials,
        "model_path": model_path,
        "total_trials": len(trials),
        "completed_trials": len(completed_trials),
        "search_duration_seconds": time.time() - start_time,
    }

    return result


def _sample_params(param_configs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Sample hyperparameters from search space definitions.

    Args:
        param_configs: List of parameter configurations

    Returns:
        Dictionary of sampled parameters
    """
    params = {}

    for p in param_configs:
        name = p.get("name")
        p_type = p.get("type", "float")

        if p_type == "categorical":
            choices = p.get("choices", [])
            if choices:
                params[name] = choices[np.random.randint(len(choices))]

        elif p_type == "int":
            low = int(p.get("low", 1))
            high = int(p.get("high", 100))
            if p.get("log", False):
                # Log-uniform sampling for integers
                log_low = np.log(max(low, 1))
                log_high = np.log(max(high, 1))
                params[name] = int(np.exp(np.random.uniform(log_low, log_high)))
            else:
                params[name] = np.random.randint(low, high + 1)

        elif p_type == "float":
            low = float(p.get("low", 0.0))
            high = float(p.get("high", 1.0))
            if p.get("log", False):
                # Log-uniform sampling
                log_low = np.log(max(low, 1e-10))
                log_high = np.log(max(high, 1e-10))
                params[name] = float(np.exp(np.random.uniform(log_low, log_high)))
            else:
                params[name] = float(np.random.uniform(low, high))

    return params


def _get_sklearn_scorer(metric: str, task_type: str) -> str:
    """
    Convert metric name to sklearn scorer string.

    Args:
        metric: Metric name (r2, rmse, mae, accuracy, f1, etc.)
        task_type: Task type (regression or classification)

    Returns:
        sklearn scorer string
    """
    regression_scorers = {
        "r2": "r2",
        "rmse": "neg_root_mean_squared_error",
        "mse": "neg_mean_squared_error",
        "mae": "neg_mean_absolute_error",
    }

    classification_scorers = {
        "accuracy": "accuracy",
        "f1": "f1_weighted",
        "precision": "precision_weighted",
        "recall": "recall_weighted",
        "roc_auc": "roc_auc",
    }

    if task_type == "classification":
        return classification_scorers.get(metric, "accuracy")
    else:
        return regression_scorers.get(metric, "r2")


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

    if model_name in sklearn_models:
        import importlib

        module_name, class_name = sklearn_models[model_name]
        try:
            module = importlib.import_module(module_name)
            model_class = getattr(module, class_name)
            return model_class(**params)
        except Exception as e:
            print(f"Error loading model {model_name}: {e}")
            return None

    return None


def _save_automl_model(
    model: Any,
    workspace_path: str,
    job_id: str,
    model_name: str,
) -> Optional[str]:
    """
    Save the best AutoML model to disk.

    Args:
        model: The trained model
        workspace_path: Path to the workspace
        job_id: AutoML job ID
        model_name: Name of the model class

    Returns:
        Path to the saved model or None if saving failed
    """
    import joblib

    try:
        models_dir = Path(workspace_path) / "models"
        models_dir.mkdir(exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        model_filename = f"automl_{model_name}_{job_id}_{timestamp}.joblib"
        model_path = models_dir / model_filename

        joblib.dump(model, model_path)

        return str(model_path)

    except Exception as e:
        print(f"Error saving AutoML model: {e}")
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
                print(f"Error running trial notification: {e}")

    except ImportError:
        pass
    except Exception as e:
        print(f"Error sending trial notification: {e}")
