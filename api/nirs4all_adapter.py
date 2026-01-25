"""
Helpers to integrate nirs4all public API with webapp pipelines/datasets.

Phase 6 Implementation:
- Complete pipeline serialization to nirs4all format
- Support for generators (_or_, _range_, _log_range_, _cartesian_)
- Support for finetuning (finetune_params, Optuna)
- Support for y_processing and feature_augmentation
- Export to Python code and YAML
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

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


# ============================================================================
# Phase 6: Advanced Pipeline Serialization
# ============================================================================


@dataclass
class FullPipelineBuildResult:
    """Complete pipeline with all nirs4all features."""
    steps: List[Any]
    metrics: List[str]
    y_processing: Optional[Any]
    finetuning_config: Optional[Dict[str, Any]]
    has_generators: bool
    estimated_variants: int
    total_model_count: int = 1
    model_count_breakdown: str = ""


def _build_generator_sweep(sweep: Dict[str, Any], param_name: str) -> Dict[str, Any]:
    """Convert frontend sweep config to nirs4all generator syntax."""
    sweep_type = sweep.get("type", "range")

    if sweep_type == "range":
        start = sweep.get("start", 1)
        end = sweep.get("end", 10)
        step = sweep.get("step", 1)
        return {"_range_": [start, end, step], "param": param_name}

    elif sweep_type == "log_range":
        start = sweep.get("start", 0.001)
        end = sweep.get("end", 100)
        count = sweep.get("count", 10)
        return {"_log_range_": [start, end, count], "param": param_name}

    elif sweep_type == "choices":
        choices = sweep.get("choices", [])
        return {"_or_": choices, "param": param_name}

    return {}


def _build_finetuning_params(finetune_config: Dict[str, Any]) -> Dict[str, Any]:
    """Convert frontend finetuning config to nirs4all finetune_params."""
    if not finetune_config or not finetune_config.get("enabled"):
        return {}

    params = finetune_config.get("params", [])
    model_params = {}

    for param in params:
        param_name = param.get("name")
        param_type = param.get("type", "int")
        low = param.get("low")
        high = param.get("high")

        if param_type == "int":
            model_params[param_name] = ("int", low, high)
        elif param_type == "float":
            model_params[param_name] = ("float", low, high)
        elif param_type == "log_float":
            model_params[param_name] = ("log_float", low, high)
        elif param_type == "categorical":
            choices = param.get("choices", [])
            model_params[param_name] = ("categorical", choices)

    finetune_params = {
        "n_trials": finetune_config.get("n_trials", 50),
        "model_params": model_params,
    }

    if finetune_config.get("timeout"):
        finetune_params["timeout"] = finetune_config["timeout"]
    if finetune_config.get("approach"):
        finetune_params["approach"] = finetune_config["approach"]
    if finetune_config.get("eval_mode"):
        finetune_params["eval_mode"] = finetune_config["eval_mode"]

    return finetune_params


def _build_y_processing(y_config: Dict[str, Any]) -> Optional[Any]:
    """Convert frontend y_processing config to nirs4all scaler instance."""
    if not y_config or not y_config.get("enabled"):
        return None

    scaler_name = y_config.get("scaler", "MinMaxScaler")
    params = y_config.get("params", {})

    # Resolve scaler class
    scaler_class = _resolve_class(scaler_name, ["sklearn.preprocessing"])
    if not scaler_class:
        # Try nirs4all discretizers
        scaler_class = _resolve_class(scaler_name, ["nirs4all.operators.transforms"])

    if scaler_class:
        normalized = _normalize_params(scaler_name, params)
        return scaler_class(**normalized)

    return None


def _build_or_generator(children: List[Dict[str, Any]], options: Dict[str, Any] = None) -> Dict[str, Any]:
    """Convert frontend OR generator children to nirs4all _or_ syntax."""
    alternatives = []

    for child in children:
        child_step = build_full_step(child)
        alternatives.append(child_step)

    result = {"_or_": alternatives}

    if options:
        if options.get("pick"):
            result["pick"] = options["pick"]
        if options.get("arrange"):
            result["arrange"] = options["arrange"]
        if options.get("count"):
            result["count"] = options["count"]

    return result


def _build_branch(children: List[List[Dict[str, Any]]]) -> Dict[str, Any]:
    """Convert frontend branch children to nirs4all branch syntax."""
    branches = []

    for branch_steps in children:
        branch_pipeline = [build_full_step(step) for step in branch_steps]
        branches.append(branch_pipeline)

    return {"branch": branches}


def build_full_step(step: Dict[str, Any]) -> Any:
    """
    Build a single pipeline step with full generator/finetuning support.

    Handles editor format with:
    - generatorKind: "or" | "cartesian"
    - generatorOptions: {pick, arrange, count, ...}
    - branches: [[...], [...]] for branch/generator steps
    - stepGenerator: step-level generators like _range_

    Returns the nirs4all-compatible step representation.
    """
    step_type = step.get("type", "")
    step_name = step.get("name", "")
    params = step.get("params", {})
    sweeps = step.get("paramSweeps", {})
    finetune = step.get("finetuneConfig")
    children = step.get("children", [])
    branches = step.get("branches", [])
    generator_options = step.get("generatorOptions", {})

    # Handle branch nodes
    if step_type == "branch" and branches:
        return _build_branch(branches)

    # Handle generator steps (editor format with generatorKind="or" and branches)
    if step_type == "generator" and branches:
        alternatives = []
        for branch in branches:
            if len(branch) == 1:
                alternatives.append(build_full_step(branch[0]))
            else:
                alternatives.append([build_full_step(s) for s in branch])
        result = {"_or_": alternatives}
        # Apply generator options (pick, arrange, count)
        if generator_options.get("pick"):
            result["pick"] = generator_options["pick"]
        if generator_options.get("arrange"):
            result["arrange"] = generator_options["arrange"]
        if generator_options.get("count"):
            result["count"] = generator_options["count"]
        return result

    # Handle OR generator (choice) - legacy format
    if step_type == "choice" or step.get("generator", {}).get("_or_"):
        return _build_or_generator(children, step.get("generator"))

    # Handle y_processing
    if step_type == "y_processing":
        y_scaler = _build_y_processing(step)
        if y_scaler:
            return {"y_processing": y_scaler}
        return None

    # Handle merge
    if step_type == "merge":
        merge_type = params.get("merge_type", "predictions")
        return {"merge": merge_type}

    # Build base operator
    operator_class = _resolve_operator_class(step_name, step_type)
    normalized_params = _normalize_params(
        PREPROCESSING_ALIASES.get(step_name, step_name),
        params,
    )

    # Check for parameter sweeps
    has_sweeps = bool(sweeps)

    if has_sweeps:
        # Build with generators
        step_dict = {}
        base_params = dict(normalized_params)

        for param_name, sweep_config in sweeps.items():
            if sweep_config.get("enabled"):
                generator = _build_generator_sweep(sweep_config, param_name)
                step_dict.update(generator)
                base_params.pop(param_name, None)

        # Create instance with non-sweep params
        try:
            instance = operator_class(**base_params)
        except Exception:
            instance = operator_class()

        if step_type == "model":
            step_dict["model"] = instance

            # Add finetuning if configured
            if finetune and finetune.get("enabled"):
                step_dict["finetune_params"] = _build_finetuning_params(finetune)
        else:
            step_dict["operator"] = instance

        return step_dict

    # No sweeps - simple operator
    try:
        instance = operator_class(**normalized_params)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid parameters for {step_name}: {exc}",
        )

    if step_type == "model":
        result = {"model": instance}
        if step.get("name_alias"):
            result["name"] = step["name_alias"]

        # Add finetuning if configured
        if finetune and finetune.get("enabled"):
            result["finetune_params"] = _build_finetuning_params(finetune)

        return result

    return instance


def build_full_pipeline(steps: List[Dict[str, Any]], config: Dict[str, Any] = None) -> FullPipelineBuildResult:
    """
    Build complete pipeline with generators, finetuning, y_processing support.

    Args:
        steps: Frontend pipeline steps
        config: Optional pipeline-level configuration

    Returns:
        FullPipelineBuildResult with all pipeline components
    """
    pipeline_steps: List[Any] = []
    metrics: List[str] = []
    y_processing = None
    has_generators = False
    finetuning_config = None

    config = config or {}

    # Process pipeline-level y_processing
    if config.get("y_processing"):
        y_processing = _build_y_processing(config["y_processing"])
        if y_processing:
            pipeline_steps.insert(0, {"y_processing": y_processing})

    # Process each step
    for step in steps:
        step_type = step.get("type", "")

        if step_type == "metrics":
            metrics.append(step.get("name", ""))
            continue

        # Check for generators or finetuning (supporting both legacy and editor formats)
        if step.get("paramSweeps"):
            has_generators = True
        if step.get("finetuneConfig", {}).get("enabled"):
            finetuning_config = step.get("finetuneConfig")
        if step.get("generator"):
            has_generators = True
        # Editor format: generatorKind, stepGenerator, branches
        if step.get("generatorKind") in ("or", "cartesian"):
            has_generators = True
        if step.get("stepGenerator"):
            has_generators = True
        if step_type == "generator" and step.get("branches"):
            has_generators = True

        built_step = build_full_step(step)
        if built_step is not None:
            pipeline_steps.append(built_step)

    # Count variants using nirs4all's count_combinations
    estimated_variants = 1
    if NIRS4ALL_AVAILABLE:
        try:
            from nirs4all.pipeline.config.generator import count_combinations
            estimated_variants = count_combinations(pipeline_steps)
        except Exception:
            pass

    # Build breakdown string based on variant count
    if estimated_variants > 1:
        model_count_breakdown = f"{estimated_variants} variants"
    else:
        model_count_breakdown = "1 model"

    return FullPipelineBuildResult(
        steps=pipeline_steps,
        metrics=metrics,
        y_processing=y_processing,
        finetuning_config=finetuning_config,
        has_generators=has_generators,
        estimated_variants=estimated_variants,
        total_model_count=estimated_variants,
        model_count_breakdown=model_count_breakdown,
    )


@dataclass
class PipelineVariant:
    """Represents a single expanded pipeline variant."""
    index: int
    steps: List[Any]  # nirs4all-compatible steps
    description: str  # Human-readable description of choices
    choices: Dict[str, Any]  # Mapping of parameter -> value for this variant
    model_name: str  # Primary model name for this variant
    preprocessing_names: List[str]  # Preprocessing steps for this variant


def expand_pipeline_variants(steps: List[Dict[str, Any]]) -> List[PipelineVariant]:
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

    # Build the pipeline with generators intact
    build_result = build_full_pipeline(steps)

    if not build_result.has_generators:
        # No generators, single variant
        return [PipelineVariant(
            index=0,
            steps=build_result.steps,
            description="Single configuration",
            choices={},
            model_name=_extract_first_model(steps),
            preprocessing_names=_extract_preprocessing_names(steps),
        )]

    # Expand with choice tracking
    expanded = expand_spec_with_choices(build_result.steps)

    variants = []
    for idx, (config, choices_list) in enumerate(expanded):
        # Build human-readable description from choices
        choices_dict = {}
        desc_parts = []
        for choice in choices_list:
            for key, value in choice.items():
                if key.startswith("_"):
                    # Generator choice (_or_, _range_, etc)
                    if isinstance(value, type):
                        value_str = value.__name__
                    elif hasattr(value, '__name__'):
                        value_str = value.__name__
                    elif isinstance(value, dict) and "model" in value:
                        model = value.get("model")
                        if hasattr(model, '__class__'):
                            value_str = model.__class__.__name__
                        else:
                            value_str = str(value)
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


def _extract_first_model(steps: List[Dict[str, Any]]) -> str:
    """Extract the first model name from frontend steps."""
    for step in steps:
        if step.get("type") == "model":
            return step.get("name", "Unknown")
        for branch in step.get("branches", []):
            for substep in branch:
                if substep.get("type") == "model":
                    return substep.get("name", "Unknown")
    return "Unknown"


def _extract_preprocessing_names(steps: List[Dict[str, Any]]) -> List[str]:
    """Extract preprocessing names from frontend steps."""
    names = []
    for step in steps:
        if step.get("type") == "preprocessing":
            names.append(step.get("name", "Unknown"))
        for branch in step.get("branches", []):
            for substep in branch:
                if substep.get("type") == "preprocessing":
                    names.append(substep.get("name", "Unknown"))
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
            model = config["model"]
            if hasattr(model, '__class__'):
                return model.__class__.__name__
            return str(model)
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


def _extract_preprocessing_from_config(config) -> List[str]:
    """Extract preprocessing names from expanded nirs4all config."""
    names = []
    if isinstance(config, list):
        for item in config:
            names.extend(_extract_preprocessing_from_config(item))
    elif isinstance(config, dict):
        for key, value in config.items():
            if key not in ("model", "y_processing"):
                names.extend(_extract_preprocessing_from_config(value))
    elif hasattr(config, '__class__'):
        class_name = config.__class__.__name__
        # Common preprocessing classes
        if class_name in ("StandardNormalVariate", "SNV", "MultiplicativeScatterCorrection", "MSC",
                          "SavitzkyGolay", "FirstDerivative", "SecondDerivative", "Detrend",
                          "StandardScaler", "MinMaxScaler", "RobustScaler", "MaxAbsScaler",
                          "Baseline", "Gaussian", "CropTransformer"):
            names.append(class_name)
    return names


# ============================================================================
# Phase 6: Export Capabilities
# ============================================================================


def export_pipeline_to_python(
    steps: List[Dict[str, Any]],
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


def _step_to_python_code(step: Dict[str, Any]) -> Optional[str]:
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


def _finetune_to_python_code(finetune: Dict[str, Any]) -> str:
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


def export_pipeline_to_yaml(steps: List[Dict[str, Any]], config: Dict[str, Any] = None) -> str:
    """
    Export pipeline to YAML format.

    Args:
        steps: Frontend pipeline steps
        config: Optional pipeline configuration

    Returns:
        YAML string
    """
    import yaml

    config = config or {}

    yaml_data = {
        "name": config.get("name", "pipeline"),
        "description": config.get("description", ""),
        "version": "1.0",
        "steps": [],
    }

    for step in steps:
        step_data = {
            "type": step.get("type"),
            "name": step.get("name"),
            "params": step.get("params", {}),
        }

        # Include sweeps
        if step.get("paramSweeps"):
            step_data["sweeps"] = step["paramSweeps"]

        # Include finetuning
        if step.get("finetuneConfig", {}).get("enabled"):
            step_data["finetuning"] = step["finetuneConfig"]

        yaml_data["steps"].append(step_data)

    # Include y_processing if configured
    if config.get("y_processing", {}).get("enabled"):
        yaml_data["y_processing"] = config["y_processing"]

    return yaml.dump(yaml_data, default_flow_style=False, sort_keys=False)


def import_pipeline_from_yaml(yaml_content: str) -> Dict[str, Any]:
    """
    Import pipeline from YAML format.

    Args:
        yaml_content: YAML string

    Returns:
        Pipeline configuration dict
    """
    import yaml

    try:
        data = yaml.safe_load(yaml_content)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")

    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="YAML must be a dictionary")

    return {
        "name": data.get("name", "Imported Pipeline"),
        "description": data.get("description", ""),
        "steps": data.get("steps", []),
        "y_processing": data.get("y_processing"),
    }

