"""
Helpers to integrate nirs4all public API with webapp pipelines/datasets.

The live editor->runtime conversion goes through
``editor_steps_to_runtime_canonical`` (api/pipeline_canonical.py); this module
provides the operator-resolution surface, variant expansion, Python-code
export, and preflight import checking that the canonical path relies on.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from .lazy_imports import require_ml_ready
from .pipeline_canonical import (
    OperatorResolutionError,
    contains_generators,
    count_runtime_variants,
    editor_steps_to_runtime_canonical,
    import_operator_class,
    resolve_editor_class_path,
)
from .shared.pipeline_service import normalize_params as _normalize_params
from .workspace_manager import workspace_manager

NIRS4ALL_AVAILABLE = True


def require_nirs4all() -> None:
    """Require nirs4all to be available."""
    require_ml_ready()


def get_dataset_record(dataset_id: str) -> dict[str, Any]:
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


def build_dataset_config(dataset_id: str) -> dict[str, Any]:
    """Build a nirs4all-compliant dataset configuration from webapp dataset record.

    Delegates to the canonical translator in shared.dataset_config, ensuring
    per-file overrides, aggregation, and folds are properly forwarded.

    Args:
        dataset_id: The dataset ID from the webapp.

    Returns:
        A dict configuration compatible with nirs4all.run(dataset=config).
    """
    from .shared.dataset_config import build_nirs4all_config

    dataset = get_dataset_record(dataset_id)
    config = dataset.get("config", {})
    files = config.get("files", [])

    if not files:
        # Fallback to folder path if no files configured
        dataset_path = dataset.get("path")
        if not dataset_path:
            raise HTTPException(status_code=400, detail=f"Dataset '{dataset_id}' has no files or path")
        config_dict: dict[str, Any] = {"folder": dataset_path}
        dataset_name = dataset.get("name")
        if dataset_name:
            config_dict["name"] = dataset_name
        return config_dict

    # Verify all files exist
    for file_info in files:
        file_path = file_info.get("path")
        if file_path and not Path(file_path).exists():
            raise HTTPException(
                status_code=404,
                detail=f"Dataset file does not exist: {file_path}"
            )

    # Build parsing dict from config top-level keys + global_params
    stored_global = config.get("global_params", {})
    parsing: dict[str, Any] = {}
    for key in ("delimiter", "decimal_separator", "has_header", "encoding",
                "header_unit", "signal_type", "na_policy", "na_fill_config"):
        value = config.get(key) or stored_global.get(key)
        if value is not None:
            parsing[key] = value

    return build_nirs4all_config(
        files=files,
        parsing=parsing,
        aggregation=config.get("aggregation"),
        folds=config.get("folds"),
        task_type=config.get("task_type") or dataset.get("task_type"),
        dataset_name=dataset.get("name"),
    )


def _looks_like_function_model_path(reference: Any) -> bool:
    if not isinstance(reference, str) or "." not in reference:
        return False

    leaf_name = reference.rsplit(".", 1)[-1]
    return bool(leaf_name) and leaf_name[0].islower()


def _model_reference_from_step(step: dict[str, Any]) -> str:
    """Resolve the best import reference for a model step.

    Prefer explicit dotted paths from the editor payload so optional third-party
    models do not depend on bare-name module whitelists.
    """
    step_name = str(step.get("name", "") or "")
    function_path = step.get("functionPath")
    if isinstance(function_path, str) and "." in function_path:
        return function_path

    class_path = step.get("classPath")
    if isinstance(class_path, str) and "." in class_path:
        resolved = resolve_editor_class_path("model", step_name, class_path)
        if "." in resolved:
            return resolved

    return step_name


def _operator_reference_from_step(step: dict[str, Any], step_type: str) -> str:
    """Resolve the best import reference for an editor step."""
    step_name = str(step.get("name", "") or "")

    if step_type == "model":
        return _model_reference_from_step(step)

    class_path = step.get("classPath")
    if isinstance(class_path, str) and "." in class_path:
        resolved = resolve_editor_class_path(step_type, step_name, class_path)
        if "." in resolved:
            return resolved

    return step_name


def _resolve_operator_class(name: str, step_type: str) -> Any:
    """Resolve an operator name (or dotted path) to its class/callable.

    Single registry-driven path: ``name -> classPath`` via the shared
    :func:`resolve_editor_class_path` resolver, then a thin import through
    :func:`import_operator_class`.  Models additionally accept callables
    (function-style models such as ``nicon``).  Raises ``HTTPException(400)``
    when the operator cannot be resolved or imported, matching the contract
    relied on by ``check_pipeline_imports`` and the model instantiate route.
    """
    explicit = name if "." in name else None
    class_path = resolve_editor_class_path(step_type, name, explicit)
    if "." not in class_path:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported {step_type} operator '{name}'",
        )

    try:
        return import_operator_class(class_path, allow_callable=step_type == "model")
    except OperatorResolutionError as exc:
        http_exc = HTTPException(status_code=400, detail=str(exc))
        # Surface whether the failure is a missing optional dependency so the
        # preflight checker can keep valid-but-uninstalled operators out of the
        # blocking issue list.
        http_exc.operator_missing_dependency = exc.missing_dependency
        raise http_exc from exc


def build_dataset_spec(dataset_id: str) -> str:
    return resolve_dataset_path(dataset_id)


def get_model_bundle_path(model_id: str, workspace_path: str) -> Path:
    model_path = Path(workspace_path) / "models" / f"{model_id}.n4a"
    if not model_path.exists():
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")
    return model_path


def ensure_models_dir(workspace_path: str) -> Path:
    models_dir = Path(workspace_path) / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    return models_dir


@dataclass
class PipelineVariant:
    """Represents a single expanded pipeline variant."""
    index: int
    steps: list[Any]  # nirs4all-compatible steps
    description: str  # Human-readable description of choices
    choices: dict[str, Any]  # Mapping of parameter -> value for this variant
    model_name: str  # Primary model name for this variant
    preprocessing_names: list[str]  # Preprocessing steps for this variant


def expand_pipeline_variants(steps: list[dict[str, Any]]) -> list[PipelineVariant]:
    """
    Expand pipeline steps into all concrete variants.

    This creates separate variant entries for:
    - Each branch alternative
    - Each sweep value combination
    - Does NOT include finetuning trials (those are internal optimization)

    Args:
        steps: Frontend pipeline steps with generators/sweeps

    Returns:
        List of PipelineVariant, each representing a concrete pipeline

    Raises:
        HTTPException: If nirs4all is not available
    """
    require_nirs4all()

    from nirs4all.pipeline.config.generator import expand_spec_with_choices

    canonical_steps = editor_steps_to_runtime_canonical(steps)
    estimated_variants = count_runtime_variants(canonical_steps)
    has_generators = contains_generators(canonical_steps)

    if not has_generators or estimated_variants <= 1:
        # No generators, single variant
        return [PipelineVariant(
            index=0,
            steps=canonical_steps,
            description="Single configuration",
            choices={},
            model_name=_extract_first_model(steps),
            preprocessing_names=_extract_preprocessing_names(steps),
        )]

    # Expand with choice tracking
    expanded = expand_spec_with_choices(canonical_steps)

    variants = []
    for idx, (config, choices_list) in enumerate(expanded):
        # Build human-readable description from choices
        choices_dict = {}
        desc_parts = []
        for choice in choices_list:
            for key, value in choice.items():
                if key.startswith("_"):
                    # Generator choice (_or_, _range_, etc)
                    display_name = _component_display_name(value)
                    if display_name:
                        value_str = display_name
                    elif isinstance(value, type) or hasattr(value, '__name__'):
                        value_str = value.__name__
                    else:
                        value_str = str(value)

                    # Simplify key name
                    clean_key = key.strip("_")
                    choices_dict[clean_key] = value
                    desc_parts.append(f"{value_str}")
                else:
                    # Regular parameter choice
                    choices_dict[key] = value
                    desc_parts.append(f"{key}={value}")

        description = " | ".join(desc_parts) if desc_parts else f"Variant {idx + 1}"

        # Extract model and preprocessing from the expanded config
        model_name = _extract_model_from_config(config)
        preprocessing = _extract_preprocessing_from_config(config)

        variants.append(PipelineVariant(
            index=idx,
            steps=config if isinstance(config, list) else [config],
            description=description,
            choices=choices_dict,
            model_name=model_name,
            preprocessing_names=preprocessing,
        ))

    return variants


def _extract_first_model(steps: list[dict[str, Any]]) -> str:
    """Extract the first model name from frontend steps."""
    for step in steps:
        if step.get("type") == "model":
            return step.get("name", "Unknown")
        for branch in step.get("branches", []):
            result = _extract_first_model(branch)
            if result != "Unknown":
                return result
        for child in step.get("children", []):
            if child.get("type") == "model":
                return child.get("name", "Unknown")
    return "Unknown"


def _extract_preprocessing_names(steps: list[dict[str, Any]]) -> list[str]:
    """Extract preprocessing names from frontend steps."""
    names = []
    for step in steps:
        if step.get("type") == "preprocessing":
            names.append(step.get("name", "Unknown"))
        for branch in step.get("branches", []):
            names.extend(_extract_preprocessing_names(branch))
        for child in step.get("children", []):
            if child.get("type") == "preprocessing":
                names.append(child.get("name", "Unknown"))
    return names


def _extract_model_from_config(config) -> str:
    """Extract model name from expanded nirs4all config."""
    if isinstance(config, list):
        for item in config:
            result = _extract_model_from_config(item)
            if result != "Unknown":
                return result
    elif isinstance(config, dict):
        if "model" in config:
            model_name = _component_display_name(config["model"])
            if model_name:
                return model_name
        for value in config.values():
            result = _extract_model_from_config(value)
            if result != "Unknown":
                return result
    elif hasattr(config, '__class__'):
        # Could be a model instance
        class_name = config.__class__.__name__
        if "Regressor" in class_name or "Classifier" in class_name or "PLS" in class_name:
            return class_name
    return "Unknown"


def _extract_preprocessing_from_config(config) -> list[str]:
    """Extract preprocessing names from expanded nirs4all config."""
    names = []
    if isinstance(config, list):
        for item in config:
            names.extend(_extract_preprocessing_from_config(item))
    elif isinstance(config, dict):
        display_name = _component_display_name(config)
        if display_name and _is_preprocessing_reference(config):
            names.append(display_name)
            return names
        for key, value in config.items():
            if key not in ("model", "y_processing"):
                names.extend(_extract_preprocessing_from_config(value))
    elif _is_preprocessing_reference(config):
        display_name = _component_display_name(config)
        if display_name:
            names.append(display_name)
    elif hasattr(config, '__class__'):
        class_name = config.__class__.__name__
        # Common preprocessing classes
        if class_name in ("StandardNormalVariate", "SNV", "MultiplicativeScatterCorrection", "MSC",
                          "SavitzkyGolay", "FirstDerivative", "SecondDerivative", "Detrend",
                          "StandardScaler", "MinMaxScaler", "RobustScaler", "MaxAbsScaler",
                          "Baseline", "Gaussian", "CropTransformer"):
            names.append(class_name)
    return names


def _component_reference_path(component: Any) -> str | None:
    """Return the canonical class/function path when available."""
    if isinstance(component, str):
        return component
    if isinstance(component, dict):
        if "model" in component:
            return _component_reference_path(component["model"])
        if isinstance(component.get("class"), str):
            return component["class"]
        if isinstance(component.get("function"), str):
            return component["function"]
    return None


def _component_display_name(component: Any) -> str | None:
    """Return a short component name for canonical or instantiated payloads."""
    path = _component_reference_path(component)
    if path:
        return path.rsplit(".", 1)[-1]

    if isinstance(component, (dict, list, tuple, set)):
        return None

    if hasattr(component, "__name__"):
        return component.__name__

    if (
        hasattr(component, "__class__")
        and component.__class__ is not object
        and component.__class__.__module__ != "builtins"
    ):
        return component.__class__.__name__

    return None


def _is_preprocessing_reference(component: Any) -> bool:
    """Return whether a canonical or instantiated component looks like preprocessing."""
    path = _component_reference_path(component)
    if path:
        return (
            path.startswith("sklearn.preprocessing.")
            or path.startswith("nirs4all.operators.transforms.")
        )

    if hasattr(component, "__class__"):
        class_name = component.__class__.__name__
        return class_name in {
            "StandardNormalVariate",
            "SNV",
            "MultiplicativeScatterCorrection",
            "MSC",
            "SavitzkyGolay",
            "FirstDerivative",
            "SecondDerivative",
            "Detrend",
            "StandardScaler",
            "MinMaxScaler",
            "RobustScaler",
            "MaxAbsScaler",
            "Baseline",
            "Gaussian",
            "CropTransformer",
        }

    return False


# ============================================================================
# Phase 6: Export Capabilities
# ============================================================================


def export_pipeline_to_python(
    steps: list[dict[str, Any]],
    pipeline_name: str = "my_pipeline",
    dataset_path: str = "path/to/dataset",
) -> str:
    """Export a pipeline definition to executable Python code.

    The pipeline is emitted as its canonical nirs4all representation (the same
    payload produced by :func:`editor_steps_to_runtime_canonical` and accepted
    directly by ``nirs4all.run``).  Operators are referenced by their canonical
    dotted class paths — resolved through the single registry-driven resolver —
    so the generated code never re-encodes operator aliases or generator syntax
    and cannot drift from runtime behaviour.

    Args:
        steps: Frontend pipeline steps
        pipeline_name: Name for the pipeline variable
        dataset_path: Dataset path to include in example

    Returns:
        Python code string
    """
    import pprint

    canonical_steps = editor_steps_to_runtime_canonical(steps)
    pipeline_literal = pprint.pformat(canonical_steps, indent=4, sort_dicts=False, width=88)

    lines = [
        '"""',
        f'Pipeline: {pipeline_name}',
        'Generated by nirs4all webapp',
        '"""',
        '',
        'import nirs4all',
        '',
        '# Pipeline steps in canonical nirs4all format.',
        '# Operators are referenced by their dotted class paths; nirs4all',
        '# instantiates them at run time.',
        f'{pipeline_name} = {pipeline_literal}',
        '',
        '# Run the pipeline',
        'result = nirs4all.run(',
        f'    pipeline={pipeline_name},',
        f'    dataset="{dataset_path}",',
        '    verbose=1,',
        ')',
        '',
        '# Access results',
        'print(f"Best RMSE: {result.best_rmse:.4f}")',
        'print(f"Best R²: {result.best_r2:.4f}")',
        '',
        '# Export trained model',
        '# result.export("model.n4a")',
    ]

    return '\n'.join(lines)


# ============================================================================
# Preflight Import Checking
# ============================================================================


def check_pipeline_imports(steps: list[dict[str, Any]]) -> list[dict[str, str | None]]:
    """Check if all pipeline step operator classes can be resolved (imported).

    Walks the step tree and attempts to resolve each operator class without
    instantiating it.  This catches missing optional packages (e.g. pyopls,
    ikpls, tensorflow) before a training run starts.

    Args:
        steps: Pipeline steps in the editor format (from saved pipeline config).

    Returns:
        List of issues.  Each issue is a dict with ``step_name``, ``step_type``,
        and ``error`` keys.  An empty list means all imports succeed.
    """
    issues: list[dict[str, str | None]] = []

    for step in steps:
        _check_step_imports(step, issues)

    return issues


def _check_step_imports(step: dict[str, Any], issues: list[dict[str, str | None]]) -> None:
    """Recursively check a single step and its children/branches."""
    step_id = str(step.get("id", "") or "")
    step_type = step.get("type", "")
    step_name = step.get("name", "")
    sub_type = step.get("subType", "")

    # Skip non-executing steps (comments, charts, merges, metrics)
    if step_type == "metrics":
        return
    if step_type == "flow" and sub_type == "merge":
        return

    # Generator/utility nodes don't execute directly, but their branches
    # contain real operators that need import checking (e.g. _or_, _cartesian_)
    if step_type == "utility" or (step_type == "flow" and sub_type == "generator"):
        for branch in step.get("branches", []):
            for child in branch:
                _check_step_imports(child, issues)
        return

    # For branch/container flow types, recurse into children/branches
    if step_type == "flow":
        for branch in step.get("branches", []):
            for child in branch:
                _check_step_imports(child, issues)
        for child in step.get("children", []):
            _check_step_imports(child, issues)
        return

    # Legacy branch/generator/choice nodes — recurse into branches and children
    if step_type in ("branch", "generator", "choice"):
        for branch in step.get("branches", []):
            for child in branch:
                _check_step_imports(child, issues)
        for child in step.get("children", []):
            _check_step_imports(child, issues)
        return

    # For actual operator steps, try to resolve the class
    if step_name and step_type in ("preprocessing", "model", "splitting", "filter", "augmentation", "y_processing"):
        resolve_type = step_type
        if resolve_type == "y_processing":
            resolve_type = "preprocessing"

        reference = _operator_reference_from_step(step, resolve_type)
        try:
            _resolve_operator_class(reference, resolve_type)
        except HTTPException as exc:
            # Don't report registry-known operators whose optional package is
            # simply not installed — they are valid, just optional deps.
            if getattr(exc, "operator_missing_dependency", False):
                pass
            else:
                issues.append({
                    "step_id": step_id or None,
                    "step_name": step_name,
                    "step_type": step_type,
                    "class_path": str(step.get("classPath", "") or "") or None,
                    "function_path": str(step.get("functionPath", "") or "") or None,
                    "error": str(exc.detail),
                })

    # Recurse into children (for containers like sample_augmentation)
    for child in step.get("children", []):
        _check_step_imports(child, issues)


# ============================================================================
# Run-result metric extraction (single source of truth for all run wrappers)
# ============================================================================

def extract_best_metrics(result: Any) -> dict[str, Any]:
    """NaN-safe extraction of the best metrics from a nirs4all RunResult.

    The single implementation behind every ``nirs4all.run()`` wrapper
    (api/runs.py, api/pipelines.py, api/training.py). Missing metrics stay
    absent — callers must tolerate ``None``/absent keys (never fabricate
    sentinel values like ``rmse=999``).

    Returns keys (all optional): ``rmse``, ``r2``, ``score``, ``accuracy``,
    ``score_metric``, ``task_type``, ``rpd``.
    """
    import math

    metrics: dict[str, Any] = {}

    primary_metric: str | None = None
    task_type: str | None = None
    best_entry_score: float | None = None
    try:
        predictions = getattr(result, "predictions", None)
        if predictions:
            best_entries = predictions.top(n=1)
            if best_entries and isinstance(best_entries[0], dict):
                entry = best_entries[0]
                raw_metric = entry.get("metric")
                raw_task_type = entry.get("task_type")
                raw_score = entry.get("test_score")
                if raw_score is None:
                    raw_score = entry.get("val_score")
                primary_metric = str(raw_metric) if raw_metric is not None else None
                task_type = str(raw_task_type) if raw_task_type is not None else None
                if isinstance(raw_score, (int, float)) and not math.isnan(raw_score):
                    best_entry_score = float(raw_score)
    except Exception:
        pass

    # RunResult best_* properties return float('nan') when unavailable, not None.
    for attr, key in (
        ("best_rmse", "rmse"),
        ("best_r2", "r2"),
        ("best_score", "score"),
        ("best_accuracy", "accuracy"),
    ):
        if not hasattr(result, attr):
            continue
        try:
            value = getattr(result, attr)
        except Exception:
            continue
        if isinstance(value, (int, float)) and not (
            isinstance(value, float) and (math.isnan(value) or math.isinf(value))
        ):
            metrics[key] = float(value)

    if "score" not in metrics and best_entry_score is not None:
        metrics["score"] = best_entry_score
    if primary_metric:
        metrics["score_metric"] = primary_metric
    if task_type:
        metrics["task_type"] = task_type

    # The primary score IS a named metric (e.g. rmse) — surface it under its
    # own key as well so consumers keyed on rmse/r2/mae/accuracy see the real
    # value even when the RunResult best_* properties return NaN.
    metric_key = (primary_metric or "").lower()
    if metric_key in ("rmse", "r2", "mae", "accuracy") and metric_key not in metrics and "score" in metrics:
        metrics[metric_key] = metrics["score"]

    # RPD only makes sense for regression with a usable RMSE.
    is_classification = "classification" in (task_type or "").lower()
    if not is_classification and metrics.get("rmse"):
        try:
            predictions = getattr(result, "predictions", None)
            if predictions:
                best_pred = predictions.best()
                if best_pred is not None and hasattr(best_pred, "y_true"):
                    import numpy as np

                    std_dev = float(np.std(best_pred.y_true))
                    if metrics["rmse"] > 0:
                        metrics["rpd"] = std_dev / metrics["rmse"]
        except Exception:
            pass

    return metrics
