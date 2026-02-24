"""
Evaluation API routes for nirs4all webapp.

This module provides FastAPI routes for model evaluation,
including confusion matrices, residual analysis, and report generation.

Routes delegate metrics computation to nirs4all.core.metrics.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager

logger = logging.getLogger(__name__)

from .lazy_imports import get_cached, is_ml_ready, require_ml_ready

NIRS4ALL_AVAILABLE = True
SKLEARN_AVAILABLE = True
JOBLIB_AVAILABLE = True


router = APIRouter()


# ============= Request/Response Models =============


class EvaluateRequest(BaseModel):
    """Request model for model evaluation."""

    model_id: str = Field(..., description="ID of the trained model to evaluate")
    dataset_id: str = Field(..., description="ID of the dataset for evaluation")
    partition: str = Field("test", description="Dataset partition to use")
    preprocessing_chain: list[dict[str, Any]] = Field(
        default=[], description="Preprocessing steps to apply"
    )


class EvaluateResult(BaseModel):
    """Result of model evaluation."""

    model_id: str
    dataset_id: str
    partition: str
    task_type: str  # regression or classification
    num_samples: int
    metrics: dict[str, float]
    predictions: list[float]
    actual: list[float]
    residuals: list[float] | None = None


class ConfusionMatrixRequest(BaseModel):
    """Request model for confusion matrix computation."""

    y_true: list[Any] = Field(..., description="True labels")
    y_pred: list[Any] = Field(..., description="Predicted labels")
    labels: list[Any] | None = Field(None, description="Class labels in order")
    normalize: str | None = Field(
        None, description="Normalization: 'true', 'pred', 'all', or None"
    )


class ConfusionMatrixResult(BaseModel):
    """Result of confusion matrix computation."""

    matrix: list[list[float]]
    labels: list[Any]
    normalized: bool


class ResidualRequest(BaseModel):
    """Request model for residual analysis."""

    y_true: list[float] = Field(..., description="True values")
    y_pred: list[float] = Field(..., description="Predicted values")


class ResidualResult(BaseModel):
    """Result of residual analysis."""

    residuals: list[float]
    standardized_residuals: list[float]
    statistics: dict[str, float]
    outlier_indices: list[int]
    normality_test: dict[str, float]


class CrossValRequest(BaseModel):
    """Request model for cross-validation."""

    pipeline_id: str = Field(..., description="ID of the pipeline to cross-validate")
    dataset_id: str = Field(..., description="ID of the dataset")
    partition: str = Field("train", description="Dataset partition to use")
    cv: int = Field(5, ge=2, le=20, description="Number of CV folds")
    scoring: str = Field("r2", description="Scoring metric: r2, neg_mse, neg_mae, accuracy")
    preprocessing_chain: list[dict[str, Any]] = Field(default=[])
    return_predictions: bool = Field(False, description="Return cross-validated predictions")


class CrossValResult(BaseModel):
    """Result of cross-validation."""

    pipeline_id: str
    dataset_id: str
    cv: int
    scoring: str
    scores: list[float]
    mean_score: float
    std_score: float
    predictions: list[float] | None = None
    actual: list[float] | None = None


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
    content: dict[str, Any]


# ============= Evaluation Routes =============


@router.post("/evaluation/run", response_model=EvaluateResult)
async def evaluate_model(request: EvaluateRequest):
    """
    Evaluate a trained model on a dataset.

    Computes all relevant metrics based on task type (regression/classification).
    Returns predictions, actual values, and residuals.
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all required for evaluation",
        )
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
        joblib = get_cached("joblib")
        model = joblib.load(model_path)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error loading model: {str(e)}"
        )

    # Load dataset
    from .spectra import _apply_preprocessing_chain, _load_dataset

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

    # Detect task type using nirs4all
    detect_task_type = get_cached("detect_task_type")
    task_type_enum = detect_task_type(y_true)
    task_type_str = task_type_enum.value  # "regression", "binary_classification", or "multiclass_classification"

    # Compute metrics using nirs4all eval_multi
    eval_multi = get_cached("eval_multi")
    metrics = eval_multi(y_true, y_pred, task_type_str)

    # Compute residuals for regression
    residuals = (y_true - y_pred).tolist() if task_type_enum.is_regression else None

    # Normalize task type for response (classification -> classification)
    response_task_type = "regression" if task_type_enum.is_regression else "classification"

    return EvaluateResult(
        model_id=request.model_id,
        dataset_id=request.dataset_id,
        partition=request.partition,
        task_type=response_task_type,
        num_samples=len(y_true),
        metrics=metrics,
        predictions=y_pred.tolist(),
        actual=y_true.tolist(),
        residuals=residuals,
    )


@router.post("/evaluation/confusion", response_model=ConfusionMatrixResult)
async def confusion_matrix(request: ConfusionMatrixRequest):
    """
    Compute confusion matrix for classification results.

    Optionally normalize by true labels, predicted labels, or all samples.
    """
    import numpy as np
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
        labels = sorted(set(y_true.tolist()) | set(y_pred.tolist()))

    # Compute confusion matrix
    sklearn_confusion_matrix = get_cached("sklearn_confusion_matrix")
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
    import numpy as np
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
    import numpy as np
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
    from .spectra import _apply_preprocessing_chain, _load_dataset

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
    KFold = get_cached("KFold")
    cv = KFold(n_splits=request.cv, shuffle=True, random_state=42)

    # Run cross-validation
    cross_val_score = get_cached("cross_val_score")
    scores = cross_val_score(model, X, y_flat, cv=cv, scoring=request.scoring)

    # Optionally get predictions
    predictions = None
    actual = None
    if request.return_predictions:
        cross_val_predict = get_cached("cross_val_predict")
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
    Delegates to nirs4all.core.metrics.get_available_metrics().
    """
    if not NIRS4ALL_AVAILABLE:
        raise HTTPException(
            status_code=501,
            detail="nirs4all required for metrics listing",
        )
    get_available_metrics = get_cached("get_available_metrics")
    return {
        "metrics": {
            "regression": get_available_metrics("regression"),
            "binary_classification": get_available_metrics("binary_classification"),
            "multiclass_classification": get_available_metrics("multiclass_classification"),
        }
    }


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


def _compute_skewness(data) -> float:
    """Compute skewness of data.

    Args:
        data: Input array

    Returns:
        Skewness value
    """
    import numpy as np
    n = len(data)
    if n < 3:
        return 0.0

    mean = np.mean(data)
    std = np.std(data)

    if std == 0:
        return 0.0

    return float(np.mean(((data - mean) / std) ** 3))


def _compute_kurtosis(data) -> float:
    """Compute excess kurtosis of data.

    Args:
        data: Input array

    Returns:
        Excess kurtosis value
    """
    import numpy as np
    n = len(data)
    if n < 4:
        return 0.0

    mean = np.mean(data)
    std = np.std(data)

    if std == 0:
        return 0.0

    return float(np.mean(((data - mean) / std) ** 4) - 3)


def _normality_test(data) -> dict[str, float]:
    """Perform normality test on data.

    Args:
        data: Input array

    Returns:
        Dictionary with test results
    """
    try:
        from scipy.stats import normaltest, shapiro

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


def _build_model_from_pipeline(pipeline_config: dict[str, Any]) -> Any | None:
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


def _format_report_markdown(content: dict[str, Any]) -> str:
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


def _format_report_html(content: dict[str, Any]) -> str:
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
