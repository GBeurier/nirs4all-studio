"""
Evaluation API routes for nirs4all webapp.

This module provides FastAPI routes for model evaluation,
including metrics computation, confusion matrices, residual analysis,
cross-validation, and report generation.

Phase 4 Implementation:
- Evaluation on trained models
- Metrics computation (R², RMSE, MAE, RPD, etc.)
- Confusion matrix for classification
- Residual analysis for regression
- Cross-validation endpoints
- Report generation
"""

import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    from sklearn.metrics import (
        r2_score,
        mean_squared_error,
        mean_absolute_error,
        accuracy_score,
        precision_score,
        recall_score,
        f1_score,
        confusion_matrix as sklearn_confusion_matrix,
    )
    from sklearn.model_selection import cross_val_score, cross_val_predict, KFold

    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

try:
    import joblib

    JOBLIB_AVAILABLE = True
except ImportError:
    JOBLIB_AVAILABLE = False


router = APIRouter()


# ============= Request/Response Models =============


class EvaluateRequest(BaseModel):
    """Request model for model evaluation."""

    model_id: str = Field(..., description="ID of the trained model to evaluate")
    dataset_id: str = Field(..., description="ID of the dataset for evaluation")
    partition: str = Field("test", description="Dataset partition to use")
    preprocessing_chain: List[Dict[str, Any]] = Field(
        default=[], description="Preprocessing steps to apply"
    )


class EvaluateResult(BaseModel):
    """Result of model evaluation."""

    model_id: str
    dataset_id: str
    partition: str
    task_type: str  # regression or classification
    num_samples: int
    metrics: Dict[str, float]
    predictions: List[float]
    actual: List[float]
    residuals: Optional[List[float]] = None


class MetricsRequest(BaseModel):
    """Request model for computing metrics."""

    y_true: List[float] = Field(..., description="True values")
    y_pred: List[float] = Field(..., description="Predicted values")
    task: str = Field("regression", description="Task type: regression or classification")
    labels: Optional[List[Any]] = Field(None, description="Class labels for classification")


class MetricsResult(BaseModel):
    """Result of metrics computation."""

    task: str
    num_samples: int
    metrics: Dict[str, float]


class ConfusionMatrixRequest(BaseModel):
    """Request model for confusion matrix computation."""

    y_true: List[Any] = Field(..., description="True labels")
    y_pred: List[Any] = Field(..., description="Predicted labels")
    labels: Optional[List[Any]] = Field(None, description="Class labels in order")
    normalize: Optional[str] = Field(
        None, description="Normalization: 'true', 'pred', 'all', or None"
    )


class ConfusionMatrixResult(BaseModel):
    """Result of confusion matrix computation."""

    matrix: List[List[float]]
    labels: List[Any]
    normalized: bool


class ResidualRequest(BaseModel):
    """Request model for residual analysis."""

    y_true: List[float] = Field(..., description="True values")
    y_pred: List[float] = Field(..., description="Predicted values")


class ResidualResult(BaseModel):
    """Result of residual analysis."""

    residuals: List[float]
    standardized_residuals: List[float]
    statistics: Dict[str, float]
    outlier_indices: List[int]
    normality_test: Dict[str, float]


class CrossValRequest(BaseModel):
    """Request model for cross-validation."""

    pipeline_id: str = Field(..., description="ID of the pipeline to cross-validate")
    dataset_id: str = Field(..., description="ID of the dataset")
    partition: str = Field("train", description="Dataset partition to use")
    cv: int = Field(5, ge=2, le=20, description="Number of CV folds")
    scoring: str = Field("r2", description="Scoring metric: r2, neg_mse, neg_mae, accuracy")
    preprocessing_chain: List[Dict[str, Any]] = Field(default=[])
    return_predictions: bool = Field(False, description="Return cross-validated predictions")


class CrossValResult(BaseModel):
    """Result of cross-validation."""

    pipeline_id: str
    dataset_id: str
    cv: int
    scoring: str
    scores: List[float]
    mean_score: float
    std_score: float
    predictions: Optional[List[float]] = None
    actual: Optional[List[float]] = None


class ReportRequest(BaseModel):
    """Request model for report generation."""

    model_id: str = Field(..., description="ID of the model")
    dataset_id: str = Field(..., description="ID of the dataset")
    partition: str = Field("test", description="Dataset partition used")
    format: str = Field("json", description="Report format: json, html, markdown")
    include_plots: bool = Field(False, description="Include plot data in report")


class ReportResult(BaseModel):
    """Result of report generation."""

    model_id: str
    dataset_id: str
    generated_at: str
    format: str
    content: Dict[str, Any]


# ============= Evaluation Routes =============


@router.post("/evaluation/run", response_model=EvaluateResult)
async def evaluate_model(request: EvaluateRequest):
    """
    Evaluate a trained model on a dataset.

    Computes all relevant metrics based on task type (regression/classification).
    Returns predictions, actual values, and residuals.
    """
    if not SKLEARN_AVAILABLE or not JOBLIB_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="sklearn and joblib required for evaluation",
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Load model
    model_path = Path(workspace.path) / "models" / f"{request.model_id}.joblib"
    if not model_path.exists():
        raise HTTPException(
            status_code=404, detail=f"Model '{request.model_id}' not found"
        )

    try:
        model = joblib.load(model_path)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error loading model: {str(e)}"
        )

    # Load dataset
    from .spectra import _load_dataset, _apply_preprocessing_chain

    dataset = _load_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=404, detail=f"Dataset '{request.dataset_id}' not found"
        )

    # Get data
    selector = {"partition": request.partition}
    X = dataset.x(selector, layout="2d")
    if isinstance(X, list):
        X = X[0]

    y = None
    try:
        y = dataset.y(selector)
    except Exception:
        pass

    if y is None:
        raise HTTPException(
            status_code=400,
            detail="Dataset has no target values for evaluation",
        )

    # Apply preprocessing
    if request.preprocessing_chain:
        X = _apply_preprocessing_chain(X, request.preprocessing_chain)

    # Make predictions
    y_pred = model.predict(X)

    # Flatten arrays
    y_true = y.ravel() if y.ndim > 1 else y
    y_pred = y_pred.ravel() if y_pred.ndim > 1 else y_pred

    # Detect task type
    task_type = _detect_task_type(y_true)

    # Compute metrics
    if task_type == "regression":
        metrics = _compute_regression_metrics(y_true, y_pred)
        residuals = (y_true - y_pred).tolist()
    else:
        metrics = _compute_classification_metrics(y_true, y_pred)
        residuals = None

    return EvaluateResult(
        model_id=request.model_id,
        dataset_id=request.dataset_id,
        partition=request.partition,
        task_type=task_type,
        num_samples=len(y_true),
        metrics=metrics,
        predictions=y_pred.tolist(),
        actual=y_true.tolist(),
        residuals=residuals,
    )


@router.post("/evaluation/metrics", response_model=MetricsResult)
async def compute_metrics(request: MetricsRequest):
    """
    Compute evaluation metrics from true and predicted values.

    Supports both regression and classification metrics.
    """
    if not SKLEARN_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="sklearn required for metrics computation"
        )

    y_true = np.array(request.y_true)
    y_pred = np.array(request.y_pred)

    if len(y_true) != len(y_pred):
        raise HTTPException(
            status_code=400,
            detail=f"Length mismatch: {len(y_true)} true values vs {len(y_pred)} predictions",
        )

    if request.task == "regression":
        metrics = _compute_regression_metrics(y_true, y_pred)
    elif request.task == "classification":
        metrics = _compute_classification_metrics(y_true, y_pred, request.labels)
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown task type: {request.task}. Supported: regression, classification",
        )

    return MetricsResult(
        task=request.task,
        num_samples=len(y_true),
        metrics=metrics,
    )


@router.post("/evaluation/confusion", response_model=ConfusionMatrixResult)
async def confusion_matrix(request: ConfusionMatrixRequest):
    """
    Compute confusion matrix for classification results.

    Optionally normalize by true labels, predicted labels, or all samples.
    """
    if not SKLEARN_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="sklearn required for confusion matrix"
        )

    y_true = np.array(request.y_true)
    y_pred = np.array(request.y_pred)

    if len(y_true) != len(y_pred):
        raise HTTPException(
            status_code=400,
            detail=f"Length mismatch: {len(y_true)} true values vs {len(y_pred)} predictions",
        )

    # Get labels
    if request.labels:
        labels = request.labels
    else:
        labels = sorted(list(set(y_true.tolist()) | set(y_pred.tolist())))

    # Compute confusion matrix
    cm = sklearn_confusion_matrix(y_true, y_pred, labels=labels)

    # Normalize if requested
    normalized = False
    if request.normalize == "true":
        cm = cm.astype(float) / cm.sum(axis=1, keepdims=True)
        cm = np.nan_to_num(cm, nan=0.0)
        normalized = True
    elif request.normalize == "pred":
        cm = cm.astype(float) / cm.sum(axis=0, keepdims=True)
        cm = np.nan_to_num(cm, nan=0.0)
        normalized = True
    elif request.normalize == "all":
        cm = cm.astype(float) / cm.sum()
        cm = np.nan_to_num(cm, nan=0.0)
        normalized = True

    return ConfusionMatrixResult(
        matrix=cm.tolist(),
        labels=labels,
        normalized=normalized,
    )


@router.post("/evaluation/residuals", response_model=ResidualResult)
async def residual_analysis(request: ResidualRequest):
    """
    Perform residual analysis for regression predictions.

    Returns residuals, standardized residuals, statistics, and normality test.
    """
    y_true = np.array(request.y_true)
    y_pred = np.array(request.y_pred)

    if len(y_true) != len(y_pred):
        raise HTTPException(
            status_code=400,
            detail=f"Length mismatch: {len(y_true)} true values vs {len(y_pred)} predictions",
        )

    # Compute residuals
    residuals = y_true - y_pred

    # Standardized residuals
    residual_std = np.std(residuals)
    if residual_std > 0:
        standardized_residuals = residuals / residual_std
    else:
        standardized_residuals = np.zeros_like(residuals)

    # Statistics
    statistics = {
        "mean": float(np.mean(residuals)),
        "std": float(np.std(residuals)),
        "min": float(np.min(residuals)),
        "max": float(np.max(residuals)),
        "median": float(np.median(residuals)),
        "skewness": float(_compute_skewness(residuals)),
        "kurtosis": float(_compute_kurtosis(residuals)),
    }

    # Detect outliers (standardized residuals > 2 or < -2)
    outlier_indices = np.where(np.abs(standardized_residuals) > 2)[0].tolist()

    # Normality test (Shapiro-Wilk if sample size allows)
    normality_test = _normality_test(residuals)

    return ResidualResult(
        residuals=residuals.tolist(),
        standardized_residuals=standardized_residuals.tolist(),
        statistics=statistics,
        outlier_indices=outlier_indices,
        normality_test=normality_test,
    )


@router.post("/evaluation/crossval", response_model=CrossValResult)
async def cross_validate(request: CrossValRequest):
    """
    Perform cross-validation on a pipeline.

    Returns per-fold scores and optionally cross-validated predictions.
    """
    if not SKLEARN_AVAILABLE:
        raise HTTPException(
            status_code=501, detail="sklearn required for cross-validation"
        )

    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Load pipeline
    from .pipelines import _load_pipeline

    try:
        pipeline_config = _load_pipeline(request.pipeline_id)
    except HTTPException:
        raise HTTPException(
            status_code=404, detail=f"Pipeline '{request.pipeline_id}' not found"
        )

    # Load dataset
    from .spectra import _load_dataset, _apply_preprocessing_chain

    dataset = _load_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(
            status_code=404, detail=f"Dataset '{request.dataset_id}' not found"
        )

    # Get data
    selector = {"partition": request.partition}
    X = dataset.x(selector, layout="2d")
    if isinstance(X, list):
        X = X[0]

    y = None
    try:
        y = dataset.y(selector)
    except Exception:
        pass

    if y is None:
        raise HTTPException(
            status_code=400,
            detail="Dataset has no target values for cross-validation",
        )

    # Apply preprocessing
    if request.preprocessing_chain:
        X = _apply_preprocessing_chain(X, request.preprocessing_chain)

    # Build model from pipeline
    model = _build_model_from_pipeline(pipeline_config)
    if model is None:
        raise HTTPException(
            status_code=400,
            detail="Pipeline does not contain a valid model step",
        )

    # Prepare CV
    y_flat = y.ravel() if y.ndim > 1 else y
    cv = KFold(n_splits=request.cv, shuffle=True, random_state=42)

    # Run cross-validation
    scores = cross_val_score(model, X, y_flat, cv=cv, scoring=request.scoring)

    # Optionally get predictions
    predictions = None
    actual = None
    if request.return_predictions:
        pred = cross_val_predict(model, X, y_flat, cv=cv)
        predictions = pred.tolist()
        actual = y_flat.tolist()

    return CrossValResult(
        pipeline_id=request.pipeline_id,
        dataset_id=request.dataset_id,
        cv=request.cv,
        scoring=request.scoring,
        scores=scores.tolist(),
        mean_score=float(np.mean(scores)),
        std_score=float(np.std(scores)),
        predictions=predictions,
        actual=actual,
    )


@router.post("/evaluation/report", response_model=ReportResult)
async def generate_report(request: ReportRequest):
    """
    Generate an evaluation report for a model.

    Compiles metrics, predictions, and diagnostic information.
    """
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    # Evaluate model first
    eval_request = EvaluateRequest(
        model_id=request.model_id,
        dataset_id=request.dataset_id,
        partition=request.partition,
    )

    eval_result = await evaluate_model(eval_request)

    # Build report content
    content = {
        "summary": {
            "model_id": request.model_id,
            "dataset_id": request.dataset_id,
            "partition": request.partition,
            "task_type": eval_result.task_type,
            "num_samples": eval_result.num_samples,
        },
        "metrics": eval_result.metrics,
    }

    # Add residual analysis for regression
    if eval_result.task_type == "regression" and eval_result.residuals:
        residual_request = ResidualRequest(
            y_true=eval_result.actual,
            y_pred=eval_result.predictions,
        )
        residual_result = await residual_analysis(residual_request)

        content["residual_analysis"] = {
            "statistics": residual_result.statistics,
            "num_outliers": len(residual_result.outlier_indices),
            "normality_test": residual_result.normality_test,
        }

    # Add confusion matrix for classification
    if eval_result.task_type == "classification":
        cm_request = ConfusionMatrixRequest(
            y_true=eval_result.actual,
            y_pred=eval_result.predictions,
        )
        cm_result = await confusion_matrix(cm_request)

        content["confusion_matrix"] = {
            "matrix": cm_result.matrix,
            "labels": cm_result.labels,
        }

    # Add plot data if requested
    if request.include_plots:
        content["plot_data"] = {
            "actual": eval_result.actual,
            "predicted": eval_result.predictions,
        }
        if eval_result.residuals:
            content["plot_data"]["residuals"] = eval_result.residuals

    # Format report if needed
    if request.format == "markdown":
        content["markdown"] = _format_report_markdown(content)
    elif request.format == "html":
        content["html"] = _format_report_html(content)

    return ReportResult(
        model_id=request.model_id,
        dataset_id=request.dataset_id,
        generated_at=datetime.now().isoformat(),
        format=request.format,
        content=content,
    )


@router.get("/evaluation/metrics/available")
async def list_available_metrics():
    """
    List all available evaluation metrics.

    Returns supported metrics for regression and classification tasks.
    """
    metrics = {
        "regression": [
            {
                "name": "r2",
                "display_name": "R² (Coefficient of Determination)",
                "description": "Proportion of variance explained (higher is better)",
                "range": "(-∞, 1]",
                "best": "1.0",
            },
            {
                "name": "rmse",
                "display_name": "RMSE (Root Mean Square Error)",
                "description": "Square root of average squared errors (lower is better)",
                "range": "[0, ∞)",
                "best": "0.0",
            },
            {
                "name": "mae",
                "display_name": "MAE (Mean Absolute Error)",
                "description": "Average absolute error (lower is better)",
                "range": "[0, ∞)",
                "best": "0.0",
            },
            {
                "name": "rpd",
                "display_name": "RPD (Ratio of Performance to Deviation)",
                "description": "Std dev of reference / RMSE (higher is better)",
                "range": "[0, ∞)",
                "best": ">3.0",
            },
            {
                "name": "bias",
                "display_name": "Bias",
                "description": "Mean prediction error (closer to 0 is better)",
                "range": "(-∞, ∞)",
                "best": "0.0",
            },
            {
                "name": "mape",
                "display_name": "MAPE (Mean Absolute Percentage Error)",
                "description": "Average percentage error (lower is better)",
                "range": "[0, ∞)",
                "best": "0.0%",
            },
        ],
        "classification": [
            {
                "name": "accuracy",
                "display_name": "Accuracy",
                "description": "Proportion of correct predictions",
                "range": "[0, 1]",
                "best": "1.0",
            },
            {
                "name": "precision",
                "display_name": "Precision",
                "description": "True positives / predicted positives",
                "range": "[0, 1]",
                "best": "1.0",
            },
            {
                "name": "recall",
                "display_name": "Recall",
                "description": "True positives / actual positives",
                "range": "[0, 1]",
                "best": "1.0",
            },
            {
                "name": "f1",
                "display_name": "F1 Score",
                "description": "Harmonic mean of precision and recall",
                "range": "[0, 1]",
                "best": "1.0",
            },
        ],
    }

    return {"metrics": metrics}


@router.get("/evaluation/scoring/available")
async def list_available_scoring():
    """
    List available scoring functions for cross-validation.
    """
    scoring = [
        {"name": "r2", "display_name": "R²", "task": "regression"},
        {"name": "neg_mean_squared_error", "display_name": "Negative MSE", "task": "regression"},
        {"name": "neg_root_mean_squared_error", "display_name": "Negative RMSE", "task": "regression"},
        {"name": "neg_mean_absolute_error", "display_name": "Negative MAE", "task": "regression"},
        {"name": "accuracy", "display_name": "Accuracy", "task": "classification"},
        {"name": "f1", "display_name": "F1 Score (binary)", "task": "classification"},
        {"name": "f1_weighted", "display_name": "F1 Score (weighted)", "task": "classification"},
        {"name": "precision", "display_name": "Precision (binary)", "task": "classification"},
        {"name": "recall", "display_name": "Recall (binary)", "task": "classification"},
    ]

    return {"scoring": scoring}


# ============= Helper Functions =============


def _detect_task_type(y: np.ndarray) -> str:
    """Detect if this is a regression or classification task.

    Args:
        y: Target values

    Returns:
        'regression' or 'classification'
    """
    # Check if values are integers or have few unique values
    unique_values = np.unique(y)

    if len(unique_values) <= 20:  # Arbitrary threshold
        # Check if values look like class labels
        if np.all(unique_values == unique_values.astype(int)):
            return "classification"

    return "regression"


def _compute_regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    """Compute regression evaluation metrics.

    Args:
        y_true: True values
        y_pred: Predicted values

    Returns:
        Dictionary of metric name -> value
    """
    y_true = y_true.ravel() if y_true.ndim > 1 else y_true
    y_pred = y_pred.ravel() if y_pred.ndim > 1 else y_pred

    mse = mean_squared_error(y_true, y_pred)
    rmse = np.sqrt(mse)
    std_dev = np.std(y_true)

    metrics = {
        "r2": float(r2_score(y_true, y_pred)),
        "rmse": float(rmse),
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "mse": float(mse),
        "bias": float(np.mean(y_pred - y_true)),
    }

    # RPD (Ratio of Performance to Deviation)
    if rmse > 0:
        metrics["rpd"] = float(std_dev / rmse)
    else:
        metrics["rpd"] = float("inf")

    # MAPE (Mean Absolute Percentage Error)
    mask = y_true != 0
    if np.any(mask):
        mape = np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100
        metrics["mape"] = float(mape)

    return metrics


def _compute_classification_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    labels: Optional[List[Any]] = None,
) -> Dict[str, float]:
    """Compute classification evaluation metrics.

    Args:
        y_true: True labels
        y_pred: Predicted labels
        labels: Optional list of class labels

    Returns:
        Dictionary of metric name -> value
    """
    y_true = y_true.ravel() if hasattr(y_true, "ravel") else np.array(y_true)
    y_pred = y_pred.ravel() if hasattr(y_pred, "ravel") else np.array(y_pred)

    metrics = {
        "accuracy": float(accuracy_score(y_true, y_pred)),
    }

    # Handle binary vs multiclass
    unique_labels = set(y_true.tolist()) | set(y_pred.tolist())
    n_classes = len(unique_labels)

    if n_classes == 2:
        # Binary classification
        metrics["precision"] = float(precision_score(y_true, y_pred, zero_division=0))
        metrics["recall"] = float(recall_score(y_true, y_pred, zero_division=0))
        metrics["f1"] = float(f1_score(y_true, y_pred, zero_division=0))
    else:
        # Multiclass - use weighted average
        metrics["precision_weighted"] = float(
            precision_score(y_true, y_pred, average="weighted", zero_division=0)
        )
        metrics["recall_weighted"] = float(
            recall_score(y_true, y_pred, average="weighted", zero_division=0)
        )
        metrics["f1_weighted"] = float(
            f1_score(y_true, y_pred, average="weighted", zero_division=0)
        )
        metrics["f1_macro"] = float(
            f1_score(y_true, y_pred, average="macro", zero_division=0)
        )

    return metrics


def _compute_skewness(data: np.ndarray) -> float:
    """Compute skewness of data.

    Args:
        data: Input array

    Returns:
        Skewness value
    """
    n = len(data)
    if n < 3:
        return 0.0

    mean = np.mean(data)
    std = np.std(data)

    if std == 0:
        return 0.0

    return float(np.mean(((data - mean) / std) ** 3))


def _compute_kurtosis(data: np.ndarray) -> float:
    """Compute excess kurtosis of data.

    Args:
        data: Input array

    Returns:
        Excess kurtosis value
    """
    n = len(data)
    if n < 4:
        return 0.0

    mean = np.mean(data)
    std = np.std(data)

    if std == 0:
        return 0.0

    return float(np.mean(((data - mean) / std) ** 4) - 3)


def _normality_test(data: np.ndarray) -> Dict[str, float]:
    """Perform normality test on data.

    Args:
        data: Input array

    Returns:
        Dictionary with test results
    """
    try:
        from scipy.stats import shapiro, normaltest

        n = len(data)

        result = {"sample_size": n}

        # Shapiro-Wilk test (for small samples)
        if 3 <= n <= 5000:
            stat, p_value = shapiro(data)
            result["shapiro_statistic"] = float(stat)
            result["shapiro_p_value"] = float(p_value)
            result["is_normal_shapiro"] = p_value > 0.05

        # D'Agostino-Pearson test (for larger samples)
        if n >= 20:
            stat, p_value = normaltest(data)
            result["dagostino_statistic"] = float(stat)
            result["dagostino_p_value"] = float(p_value)
            result["is_normal_dagostino"] = p_value > 0.05

        return result

    except Exception as e:
        return {"error": str(e)}


def _build_model_from_pipeline(pipeline_config: Dict[str, Any]) -> Optional[Any]:
    """Build a sklearn model from pipeline configuration.

    Args:
        pipeline_config: Pipeline configuration dictionary

    Returns:
        Model instance or None
    """
    from .training import _get_model_instance

    steps = pipeline_config.get("steps", [])

    for step in steps:
        if step.get("type") == "model":
            model_name = step.get("name")
            model_params = step.get("params", {})
            return _get_model_instance(model_name, model_params)

    return None


def _format_report_markdown(content: Dict[str, Any]) -> str:
    """Format report content as Markdown.

    Args:
        content: Report content dictionary

    Returns:
        Markdown-formatted string
    """
    lines = []
    lines.append("# Model Evaluation Report\n")

    # Summary
    summary = content.get("summary", {})
    lines.append("## Summary\n")
    lines.append(f"- **Model ID**: {summary.get('model_id')}")
    lines.append(f"- **Dataset ID**: {summary.get('dataset_id')}")
    lines.append(f"- **Partition**: {summary.get('partition')}")
    lines.append(f"- **Task Type**: {summary.get('task_type')}")
    lines.append(f"- **Number of Samples**: {summary.get('num_samples')}")
    lines.append("")

    # Metrics
    metrics = content.get("metrics", {})
    lines.append("## Metrics\n")
    lines.append("| Metric | Value |")
    lines.append("|--------|-------|")
    for name, value in metrics.items():
        if isinstance(value, float):
            lines.append(f"| {name} | {value:.4f} |")
        else:
            lines.append(f"| {name} | {value} |")
    lines.append("")

    # Residual analysis
    if "residual_analysis" in content:
        ra = content["residual_analysis"]
        lines.append("## Residual Analysis\n")
        lines.append(f"- **Mean**: {ra['statistics'].get('mean', 'N/A'):.4f}")
        lines.append(f"- **Std Dev**: {ra['statistics'].get('std', 'N/A'):.4f}")
        lines.append(f"- **Outliers**: {ra.get('num_outliers', 0)}")
        lines.append("")

    return "\n".join(lines)


def _format_report_html(content: Dict[str, Any]) -> str:
    """Format report content as HTML.

    Args:
        content: Report content dictionary

    Returns:
        HTML-formatted string
    """
    html = ["<html><head><style>"]
    html.append("body { font-family: Arial, sans-serif; margin: 20px; }")
    html.append("table { border-collapse: collapse; margin: 10px 0; }")
    html.append("th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }")
    html.append("th { background-color: #4CAF50; color: white; }")
    html.append("</style></head><body>")

    html.append("<h1>Model Evaluation Report</h1>")

    # Summary
    summary = content.get("summary", {})
    html.append("<h2>Summary</h2>")
    html.append("<ul>")
    html.append(f"<li><b>Model ID</b>: {summary.get('model_id')}</li>")
    html.append(f"<li><b>Dataset ID</b>: {summary.get('dataset_id')}</li>")
    html.append(f"<li><b>Task Type</b>: {summary.get('task_type')}</li>")
    html.append(f"<li><b>Samples</b>: {summary.get('num_samples')}</li>")
    html.append("</ul>")

    # Metrics
    metrics = content.get("metrics", {})
    html.append("<h2>Metrics</h2>")
    html.append("<table><tr><th>Metric</th><th>Value</th></tr>")
    for name, value in metrics.items():
        if isinstance(value, float):
            html.append(f"<tr><td>{name}</td><td>{value:.4f}</td></tr>")
        else:
            html.append(f"<tr><td>{name}</td><td>{value}</td></tr>")
    html.append("</table>")

    html.append("</body></html>")

    return "\n".join(html)
