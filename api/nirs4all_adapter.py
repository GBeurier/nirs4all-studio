"""
Helpers to integrate nirs4all public API with webapp pipelines/datasets.

The live editor->runtime conversion goes through
``editor_steps_to_runtime_canonical`` (api/pipeline_canonical.py); this module
provides the operator-resolution surface, variant expansion, Python-code
export, and preflight import checking that the canonical path relies on.
"""

from __future__ import annotations

import importlib
import inspect
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from .lazy_imports import get_cached, is_ml_ready, require_ml_ready
from .pipeline_canonical import (
    contains_generators,
    count_runtime_variants,
    editor_steps_to_runtime_canonical,
    resolve_editor_class_path,
)
from .workspace_manager import workspace_manager

NIRS4ALL_AVAILABLE = True


PREPROCESSING_ALIASES = {
    "SNV": "StandardNormalVariate",
    "RobustSNV": "RobustStandardNormalVariate",
    "LocalSNV": "LocalStandardNormalVariate",
    "MSC": "MultiplicativeScatterCorrection",
    "EMSC": "ExtendedMultiplicativeScatterCorrection",
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
    "LightGBM": "LGBMRegressor",
    "LightGBMClassifier": "LGBMClassifier",
    "XGBoost": "XGBRegressor",
    "XGBoostClassifier": "XGBClassifier",
    "nicon": "nicon",
    "cnn1d": "customizable_nicon",
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

THIRDPARTY_MODEL_MODULES = [
    "xgboost",
    "lightgbm.sklearn",
    "catboost",
    "tabpfn",
    "tabicl",
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
    "nirs4all.operators.models.pytorch.nicon",
]


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


def _normalize_params(name: str, params: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(params or {})

    # Generic: reconstruct tuple parameters from _min/_max suffix pairs.
    # For any pair of keys like "shift_range_min" and "shift_range_max",
    # combine them into "shift_range": (min_val, max_val) and remove the
    # suffixed keys.  This handles augmentation operators whose Python
    # constructors accept tuple parameters (e.g. shift_range, offset_range).
    min_keys = [k for k in list(normalized) if k.endswith("_min")]
    for min_key in min_keys:
        base = min_key[:-4]  # strip "_min"
        max_key = base + "_max"
        if max_key in normalized:
            min_val = normalized.pop(min_key)
            max_val = normalized.pop(max_key)
            if min_val is not None and max_val is not None:
                normalized[base] = (min_val, max_val)
            elif min_val is not None:
                normalized[base] = (min_val, min_val)
            elif max_val is not None:
                normalized[base] = (max_val, max_val)
            # If both are None, don't set the tuple param (let the
            # operator use its own default).

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


def _resolve_alias(aliases: dict[str, str], name: str) -> str:
    if name in aliases:
        return aliases[name]

    lowered = name.lower()
    for alias, target in aliases.items():
        if alias.lower() == lowered:
            return target

    return name


def _is_supported_operator_candidate(
    obj: Any,
    *,
    allow_callables: bool = False,
) -> bool:
    return inspect.isclass(obj) or (allow_callables and callable(obj))


def _lookup_operator_member(
    module: Any,
    name: str,
    *,
    allow_callables: bool = False,
) -> Any | None:
    obj = getattr(module, name, None)
    if _is_supported_operator_candidate(obj, allow_callables=allow_callables):
        return obj

    lowered = name.lower()
    for attr_name in dir(module):
        if attr_name.lower() != lowered:
            continue
        candidate = getattr(module, attr_name, None)
        if _is_supported_operator_candidate(candidate, allow_callables=allow_callables):
            return candidate

    return None


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


def _import_operator_reference(reference: str, step_type: str) -> Any:
    module_path, _, attr_name = reference.rpartition(".")
    if not module_path:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported {step_type} operator '{reference}'",
        )

    try:
        module = importlib.import_module(module_path)
    except ImportError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    obj = _lookup_operator_member(
        module,
        attr_name,
        allow_callables=step_type == "model",
    )
    if obj is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported {step_type} operator '{reference}'",
        )

    return obj


def _resolve_class(
    name: str,
    module_candidates: Iterable[str],
    *,
    allow_callables: bool = False,
) -> Any | None:
    for module_path in module_candidates:
        try:
            module = importlib.import_module(module_path)
        except ImportError:
            continue
        obj = _lookup_operator_member(
            module,
            name,
            allow_callables=allow_callables,
        )
        if obj is not None:
            return obj
    return None


NIRS4ALL_FILTER_MODULES = [
    "nirs4all.operators.filters",
]

NIRS4ALL_AUGMENTATION_MODULES = [
    "nirs4all.operators.augmentation",
]


def _resolve_operator_class(name: str, step_type: str) -> Any:
    if "." in name and step_type in {"model", "preprocessing", "splitting", "filter", "augmentation"}:
        return _import_operator_reference(name, step_type)

    lookup_name = name

    if step_type == "preprocessing":
        lookup_name = _resolve_alias(PREPROCESSING_ALIASES, name)
        cls = _resolve_class(lookup_name, NIRS4ALL_PREPROCESSING_MODULES)
        if cls is None:
            cls = _resolve_class(lookup_name, SKLEARN_PREPROCESSING_MODULES)
    elif step_type == "splitting":
        lookup_name = _resolve_alias(SPLITTER_ALIASES, name)
        cls = _resolve_class(lookup_name, NIRS4ALL_SPLITTER_MODULES)
        if cls is None:
            cls = _resolve_class(lookup_name, SKLEARN_SPLITTER_MODULES)
    elif step_type == "model":
        lookup_name = _resolve_alias(MODEL_ALIASES, name)
        cls = _resolve_class(
            lookup_name,
            NIRS4ALL_MODEL_MODULES,
            allow_callables=True,
        )
        if cls is None:
            cls = _resolve_class(
                lookup_name,
                SKLEARN_MODEL_MODULES,
                allow_callables=True,
            )
        if cls is None:
            cls = _resolve_class(
                lookup_name,
                THIRDPARTY_MODEL_MODULES,
                allow_callables=True,
            )
    elif step_type == "filter":
        cls = _resolve_class(lookup_name, NIRS4ALL_FILTER_MODULES)
        if cls is None:
            # Filters may also live in preprocessing modules
            cls = _resolve_class(lookup_name, NIRS4ALL_PREPROCESSING_MODULES)
    elif step_type == "augmentation":
        cls = _resolve_class(lookup_name, NIRS4ALL_AUGMENTATION_MODULES)
    else:
        cls = None

    if cls is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported {step_type} operator '{name}'",
        )

    return cls


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
    """
    Export pipeline definition to executable Python code.

    Args:
        steps: Frontend pipeline steps
        pipeline_name: Name for the pipeline variable
        dataset_path: Dataset path to include in example

    Returns:
        Python code string
    """
    lines = [
        '"""',
        f'Pipeline: {pipeline_name}',
        'Generated by nirs4all webapp',
        '"""',
        '',
        'import nirs4all',
        'from sklearn.preprocessing import MinMaxScaler, StandardScaler, RobustScaler',
        'from sklearn.cross_decomposition import PLSRegression',
        'from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor',
        'from sklearn.model_selection import KFold, ShuffleSplit',
        '',
        '# Import nirs4all operators',
        'from nirs4all.operators.transforms import (',
        '    StandardNormalVariate, MultiplicativeScatterCorrection,',
        '    SavitzkyGolay, FirstDerivative, SecondDerivative,',
        '    Detrend, Baseline, Gaussian,',
        ')',
        'from nirs4all.operators.splitters import (',
        '    KennardStoneSplitter, SPXYSplitter, SPXYGFold,',
        ')',
        '',
    ]

    # Build pipeline steps as code
    step_codes = []
    for step in steps:
        code = _step_to_python_code(step)
        if code:
            step_codes.append(code)

    lines.append('# Define pipeline')
    lines.append(f'{pipeline_name} = [')
    for i, code in enumerate(step_codes):
        comma = ',' if i < len(step_codes) - 1 else ''
        lines.append(f'    {code}{comma}')
    lines.append(']')
    lines.append('')

    # Add execution code
    lines.extend([
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
    ])

    return '\n'.join(lines)


def _step_to_python_code(step: dict[str, Any]) -> str | None:
    """Convert a single step to Python code representation."""
    step_type = step.get("type", "")
    step_name = step.get("name", "")
    params = step.get("params", {})
    finetune = step.get("finetuneConfig")
    sweeps = step.get("paramSweeps", {})

    if step_type == "metrics":
        return None

    # Get the actual class name
    if step_type == "preprocessing":
        class_name = PREPROCESSING_ALIASES.get(step_name, step_name)
    elif step_type == "splitting":
        class_name = SPLITTER_ALIASES.get(step_name, step_name)
    elif step_type == "model":
        class_name = MODEL_ALIASES.get(step_name, step_name)
    else:
        class_name = step_name

    # Build parameter string
    normalized = _normalize_params(class_name, params)
    param_strs = []
    for k, v in normalized.items():
        if k in sweeps and sweeps[k].get("enabled"):
            # Skip swept params, they're handled separately
            continue
        if isinstance(v, str):
            param_strs.append(f'{k}="{v}"')
        else:
            param_strs.append(f'{k}={v}')

    param_str = ', '.join(param_strs)
    base_code = f'{class_name}({param_str})'

    # Handle sweeps
    has_sweeps = any(s.get("enabled") for s in sweeps.values())
    if has_sweeps:
        sweep_parts = []
        for param_name, sweep in sweeps.items():
            if sweep.get("enabled"):
                sweep_type = sweep.get("type", "range")
                if sweep_type == "range":
                    sweep_parts.append(
                        f'{{"_range_": [{sweep.get("start", 1)}, {sweep.get("end", 10)}, {sweep.get("step", 1)}], "param": "{param_name}"}}'
                    )
                elif sweep_type == "log_range":
                    sweep_parts.append(
                        f'{{"_log_range_": [{sweep.get("start", 0.001)}, {sweep.get("end", 100)}, {sweep.get("count", 10)}], "param": "{param_name}"}}'
                    )

        if sweep_parts:
            sweep_code = ', '.join(sweep_parts)
            base_code = f'{{{base_code}, {sweep_code}}}'

    # Wrap model with keyword
    if step_type == "model":
        if finetune and finetune.get("enabled"):
            finetune_str = _finetune_to_python_code(finetune)
            base_code = f'{{"model": {class_name}({param_str}), "finetune_params": {finetune_str}}}'
        else:
            base_code = f'{{"model": {class_name}({param_str})}}'

    return base_code


def _finetune_to_python_code(finetune: dict[str, Any]) -> str:
    """Convert finetuning config to Python dict string."""
    params = finetune.get("params", [])
    model_params = {}

    for p in params:
        name = p.get("name")
        ptype = p.get("type", "int")
        if ptype in ("int", "float", "log_float"):
            model_params[name] = f'("{ptype}", {p.get("low")}, {p.get("high")})'
        elif ptype == "categorical":
            choices = p.get("choices", [])
            model_params[name] = f'("categorical", {choices})'

    mp_str = ', '.join(f'"{k}": {v}' for k, v in model_params.items())

    return f'{{"n_trials": {finetune.get("n_trials", 50)}, "model_params": {{{mp_str}}}}}'


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
            # Don't report known aliases whose packages are simply not
            # installed — they are valid operators, just optional deps.
            alias_map = {
                "model": MODEL_ALIASES,
                "preprocessing": PREPROCESSING_ALIASES,
                "splitting": SPLITTER_ALIASES,
            }
            known_aliases = alias_map.get(resolve_type, {})
            if step_name in known_aliases:
                pass  # known alias, optional dependency not installed
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
