"""
Helpers to integrate nirs4all public API with webapp pipelines/datasets.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from fastapi import HTTPException

from .workspace_manager import workspace_manager

try:
    import nirs4all
    from nirs4all.data import DatasetConfigs

    NIRS4ALL_AVAILABLE = True
except ImportError as exc:
    nirs4all = None
    DatasetConfigs = None
    NIRS4ALL_AVAILABLE = False
    _NIRS4ALL_IMPORT_ERROR = exc


PREPROCESSING_ALIASES = {
    "SNV": "StandardNormalVariate",
    "MSC": "MultiplicativeScatterCorrection",
    "MovingAverage": "SavitzkyGolay",
    "BaselineCorrection": "Baseline",
    "Trim": "CropTransformer",
}

SPLITTER_ALIASES = {
    "KennardStone": "KennardStoneSplitter",
    "SPXY": "SPXYSplitter",
}

MODEL_ALIASES = {
    "RandomForest": "RandomForestRegressor",
}

SKLEARN_PREPROCESSING_MODULES = [
    "sklearn.preprocessing",
]

SKLEARN_SPLITTER_MODULES = [
    "sklearn.model_selection",
]

SKLEARN_MODEL_MODULES = [
    "sklearn.cross_decomposition",
    "sklearn.ensemble",
    "sklearn.linear_model",
    "sklearn.neighbors",
    "sklearn.svm",
]

NIRS4ALL_PREPROCESSING_MODULES = [
    "nirs4all.operators.transforms",
    "nirs4all.operators.filters",
]

NIRS4ALL_SPLITTER_MODULES = [
    "nirs4all.operators.splitters",
]

NIRS4ALL_MODEL_MODULES = [
    "nirs4all.operators.models",
]


@dataclass
class PipelineBuildResult:
    steps: List[Any]
    metrics: List[str]


def require_nirs4all() -> None:
    if not NIRS4ALL_AVAILABLE:
        detail = "nirs4all library not available"
        if "_NIRS4ALL_IMPORT_ERROR" in globals():
            detail = f"{detail}: {_NIRS4ALL_IMPORT_ERROR}"
        raise HTTPException(status_code=501, detail=detail)


def get_dataset_record(dataset_id: str) -> Dict[str, Any]:
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")

    dataset = next((d for d in workspace.datasets if d.get("id") == dataset_id), None)
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_id}' not found")

    return dataset


def resolve_dataset_path(dataset_id: str) -> str:
    dataset = get_dataset_record(dataset_id)
    dataset_path = dataset.get("path")
    if not dataset_path:
        raise HTTPException(status_code=400, detail=f"Dataset '{dataset_id}' missing path")

    path = Path(dataset_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Dataset path does not exist: {dataset_path}")

    return str(path)


def _normalize_params(name: str, params: Dict[str, Any]) -> Dict[str, Any]:
    normalized = dict(params or {})

    if name == "MinMaxScaler":
        min_val = normalized.pop("feature_range_min", None)
        max_val = normalized.pop("feature_range_max", None)
        if min_val is not None or max_val is not None:
            normalized["feature_range"] = (
                0 if min_val is None else min_val,
                1 if max_val is None else max_val,
            )

    if name == "SavitzkyGolay":
        if "window" in normalized and "window_length" not in normalized:
            normalized["window_length"] = normalized.pop("window")

    if name == "MovingAverage":
        window = normalized.get("window") or normalized.get("window_length") or 5
        normalized = {
            "window_length": window,
            "polyorder": 1,
            "deriv": 0,
        }

    if name == "CropTransformer":
        if normalized.get("end") == -1:
            normalized["end"] = None

    return normalized


def _resolve_class(name: str, module_candidates: Iterable[str]) -> Optional[Any]:
    for module_path in module_candidates:
        try:
            module = importlib.import_module(module_path)
        except ImportError:
            continue
        if hasattr(module, name):
            return getattr(module, name)
    return None


def _resolve_operator_class(name: str, step_type: str) -> Any:
    lookup_name = name

    if step_type == "preprocessing":
        lookup_name = PREPROCESSING_ALIASES.get(name, name)
        cls = _resolve_class(lookup_name, NIRS4ALL_PREPROCESSING_MODULES)
        if cls is None:
            cls = _resolve_class(lookup_name, SKLEARN_PREPROCESSING_MODULES)
    elif step_type == "splitting":
        lookup_name = SPLITTER_ALIASES.get(name, name)
        cls = _resolve_class(lookup_name, NIRS4ALL_SPLITTER_MODULES)
        if cls is None:
            cls = _resolve_class(lookup_name, SKLEARN_SPLITTER_MODULES)
    elif step_type == "model":
        lookup_name = MODEL_ALIASES.get(name, name)
        cls = _resolve_class(lookup_name, NIRS4ALL_MODEL_MODULES)
        if cls is None:
            cls = _resolve_class(lookup_name, SKLEARN_MODEL_MODULES)
    else:
        cls = None

    if cls is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported {step_type} operator '{name}'",
        )

    return cls


def build_pipeline_steps(steps: List[Dict[str, Any]]) -> PipelineBuildResult:
    pipeline_steps: List[Any] = []
    metrics: List[str] = []

    for step in steps:
        step_type = step.get("type", "")
        step_name = step.get("name", "")
        params = step.get("params") or {}

        if step_type == "metrics":
            if step_name:
                metrics.append(step_name)
            continue

        operator_class = _resolve_operator_class(step_name, step_type)
        normalized_params = _normalize_params(
            PREPROCESSING_ALIASES.get(step_name, step_name),
            params,
        )

        try:
            instance = operator_class(**normalized_params)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid parameters for {step_name}: {exc}",
            )

        if step_type == "model":
            pipeline_steps.append({"model": instance, "name": step_name})
        else:
            pipeline_steps.append(instance)

    if not pipeline_steps:
        raise HTTPException(status_code=400, detail="Pipeline has no executable steps")

    return PipelineBuildResult(steps=pipeline_steps, metrics=metrics)


def build_dataset_spec(dataset_id: str) -> str:
    return resolve_dataset_path(dataset_id)


def extract_metrics_from_prediction(prediction: Dict[str, Any]) -> Dict[str, float]:
    scores = prediction.get("scores") or {}
    if isinstance(scores, str):
        scores = {}

    partition_scores = scores.get("test") or scores.get("val") or {}
    if isinstance(partition_scores, str):
        partition_scores = {}

    metrics = {}
    for key in ["r2", "rmse", "mae", "rpd", "nrmse"]:
        value = partition_scores.get(key)
        if value is not None:
            metrics[key] = float(value)

    if not metrics:
        metric_name = prediction.get("metric")
        test_score = prediction.get("test_score")
        if metric_name and test_score is not None:
            metrics[metric_name.lower()] = float(test_score)

    return metrics


def get_model_bundle_path(model_id: str, workspace_path: str) -> Path:
    model_path = Path(workspace_path) / "models" / f"{model_id}.n4a"
    if not model_path.exists():
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")
    return model_path


def ensure_models_dir(workspace_path: str) -> Path:
    models_dir = Path(workspace_path) / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    return models_dir

