"""Backend-authoritative canonical <-> editor pipeline conversion."""

from __future__ import annotations

import copy
import json
from functools import lru_cache
from pathlib import Path
from typing import Any
from uuid import uuid4

SEARCH_SPACE_TOKENS = {"int", "float", "categorical", "log_float"}
SEPARATION_BRANCH_KEYS = ("by_tag", "by_metadata", "by_filter", "by_source")
GENERATOR_KEYWORDS = {
    "_or_",
    "_range_",
    "_log_range_",
    "_grid_",
    "_cartesian_",
    "_zip_",
    "_chain_",
    "_sample_",
}
FLOW_SUBTYPES = {
    "branch",
    "merge",
    "generator",
    "sample_augmentation",
    "feature_augmentation",
    "sample_filter",
    "concat_transform",
    "sequential",
}
UTILITY_SUBTYPES = {"chart", "comment"}
TYPE_PRIORITY = {
    "model": 0,
    "preprocessing": 1,
    "splitting": 2,
    "augmentation": 3,
    "filter": 4,
    "y_processing": 5,
}
SAMPLER_KEYS = {"sample", "sampler"}
FUNCTION_MODEL_CLASS_PATHS = {
    "nicon": "nirs4all.operators.models.pytorch.nicon.nicon",
    "cnn1d": "nirs4all.operators.models.pytorch.nicon.customizable_nicon",
}
MODEL_CLASS_PATH_ALIASES = {
    "xgboost": "xgboost.XGBRegressor",
    "xgbregressor": "xgboost.XGBRegressor",
    "xgboostclassifier": "xgboost.XGBClassifier",
    "xgbclassifier": "xgboost.XGBClassifier",
    "xgboost.sklearn.xgbregressor": "xgboost.XGBRegressor",
    "xgboost.sklearn.xgbclassifier": "xgboost.XGBClassifier",
    "lightgbm": "lightgbm.LGBMRegressor",
    "lightgbmclassifier": "lightgbm.LGBMClassifier",
    "lgbmregressor": "lightgbm.LGBMRegressor",
    "lgbmclassifier": "lightgbm.LGBMClassifier",
    "lightgbm.sklearn.lgbmregressor": "lightgbm.LGBMRegressor",
    "lightgbm.sklearn.lgbmclassifier": "lightgbm.LGBMClassifier",
}
MODEL_DISPLAY_NAME_ALIASES = {
    "xgboost": "XGBoost",
    "xgbregressor": "XGBoost",
    "xgboost.xgbregressor": "XGBoost",
    "xgboost.sklearn.xgbregressor": "XGBoost",
    "xgboostclassifier": "XGBoostClassifier",
    "xgbclassifier": "XGBoostClassifier",
    "xgboost.xgbclassifier": "XGBoostClassifier",
    "xgboost.sklearn.xgbclassifier": "XGBoostClassifier",
    "lightgbm": "LightGBM",
    "lgbmregressor": "LightGBM",
    "lightgbm.lgbmregressor": "LightGBM",
    "lightgbm.sklearn.lgbmregressor": "LightGBM",
    "lightgbmclassifier": "LightGBMClassifier",
    "lgbmclassifier": "LightGBMClassifier",
    "lightgbm.lgbmclassifier": "LightGBMClassifier",
    "lightgbm.sklearn.lgbmclassifier": "LightGBMClassifier",
}
KNOWN_FINETUNE_KEYS = {
    "n_trials",
    "approach",
    "eval_mode",
    "sample",
    "sampler",
    "verbose",
    "model_params",
    "train_params",
}


def _step_id() -> str:
    return f"step-{uuid4().hex[:12]}"


def clone_value(value: Any) -> Any:
    return copy.deepcopy(value)


def filter_comments(payload: Any) -> Any:
    """Remove explicit ``_comment`` metadata recursively."""
    if isinstance(payload, list):
        filtered: list[Any] = []
        for item in payload:
            cleaned = filter_comments(item)
            if cleaned is not None:
                filtered.append(cleaned)
        return filtered

    if isinstance(payload, dict):
        if set(payload.keys()) == {"_comment"}:
            return None
        filtered_dict: dict[str, Any] = {}
        for key, value in payload.items():
            if key == "_comment":
                continue
            cleaned = filter_comments(value)
            if cleaned is not None:
                filtered_dict[key] = cleaned
        return filtered_dict

    return payload


def contains_generators(payload: Any) -> bool:
    """Return ``True`` when a canonical payload still contains generator syntax."""
    if isinstance(payload, list):
        return any(contains_generators(item) for item in payload)

    if isinstance(payload, dict):
        if any(key in payload for key in GENERATOR_KEYWORDS):
            return True
        return any(contains_generators(value) for value in payload.values())

    return False


def editor_steps_to_runtime_canonical(steps: list[dict[str, Any]]) -> list[Any]:
    """Convert editor steps into canonical runtime payload with comments stripped."""
    return filter_comments(editor_to_canonical(hydrate_editor_steps(steps)))


def count_runtime_variants(canonical_steps: list[Any]) -> int:
    """Count canonical pipeline variants using the library generator semantics."""
    if not canonical_steps:
        return 1

    from nirs4all.pipeline.config.generator import count_combinations

    return count_combinations(canonical_steps)


def _stable_sort_template(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _stable_sort_template(child)
            for key, child in sorted(value.items(), key=lambda item: item[0])
        }
    if isinstance(value, list):
        return [_stable_sort_template(item) for item in value]
    return value


def unwrap_canonical_payload(payload: Any) -> tuple[str, str, list[Any]]:
    """Return ``(name, description, steps)`` from a canonical wrapper or step list."""
    if isinstance(payload, list):
        return "", "", clone_value(payload)
    if isinstance(payload, dict):
        if "pipeline" in payload:
            steps = payload.get("pipeline")
            if not isinstance(steps, list):
                raise ValueError("Canonical payload 'pipeline' must be a list")
            return (
                str(payload.get("name", "") or ""),
                str(payload.get("description", "") or ""),
                clone_value(steps),
            )
        if "steps" in payload:
            steps = payload.get("steps")
            if not isinstance(steps, list):
                raise ValueError("Editor payload 'steps' must be a list")
            return (
                str(payload.get("name", "") or ""),
                str(payload.get("description", "") or ""),
                clone_value(steps),
            )
    raise ValueError("Payload must be a canonical wrapper, editor wrapper, or step list")


@lru_cache(maxsize=1)
def _registry_paths() -> tuple[Path, ...]:
    generated_dir = (
        Path(__file__).resolve().parent.parent
        / "src"
        / "data"
        / "nodes"
        / "generated"
    )
    return (
        generated_dir / "node-reference.json",
        generated_dir / "canonical-registry.json",
    )


@lru_cache(maxsize=1)
def _load_registry_nodes() -> list[dict[str, Any]]:
    for path in _registry_paths():
        if not path.exists():
            continue
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and isinstance(data.get("nodes"), list):
            return data["nodes"]
    return []


def _class_name_from_path(class_path: str) -> str:
    if not class_path:
        return ""
    return class_path.rsplit(".", 1)[-1]


def _looks_like_function_model_path(reference: str | None) -> bool:
    if not isinstance(reference, str) or "." not in reference:
        return False

    leaf_name = _class_name_from_path(reference)
    return bool(leaf_name) and leaf_name[0].islower()


def _infer_model_framework_from_path(reference: str | None) -> str | None:
    if not isinstance(reference, str):
        return None

    normalized = reference.lower()
    if ".pytorch." in normalized or ".torch." in normalized:
        return "pytorch"
    if ".tensorflow." in normalized or ".keras." in normalized:
        return "tensorflow"
    if ".jax." in normalized or ".flax." in normalized:
        return "jax"
    return None


@lru_cache(maxsize=1)
def _reference_lookup() -> dict[str, list[dict[str, Any]]]:
    lookup: dict[str, list[dict[str, Any]]] = {}

    def register(key: str | None, node: dict[str, Any]) -> None:
        if not key:
            return
        normalized = key.strip().lower()
        if not normalized:
            return
        lookup.setdefault(normalized, []).append(node)

    for node in _load_registry_nodes():
        register(node.get("name"), node)
        register(node.get("classPath"), node)
        register(_class_name_from_path(str(node.get("classPath") or "")), node)
        for alias in node.get("aliases") or []:
            register(alias, node)

    return lookup


@lru_cache(maxsize=1)
def _name_type_lookup() -> dict[tuple[str, str], str]:
    lookup: dict[tuple[str, str], str] = {}
    for node in _load_registry_nodes():
        node_type = str(node.get("type") or "")
        class_path = node.get("classPath")
        if not node_type or not class_path:
            continue
        keys = [node.get("name"), *(node.get("aliases") or [])]
        for key in keys:
            if not key:
                continue
            lookup.setdefault((node_type, str(key).lower()), class_path)
    return lookup


def _select_registry_node(
    candidates: list[dict[str, Any]],
    forced_type: str | None = None,
) -> dict[str, Any] | None:
    if not candidates:
        return None
    if forced_type:
        for candidate in candidates:
            if candidate.get("type") == forced_type:
                return candidate
    return sorted(
        candidates,
        key=lambda node: (
            TYPE_PRIORITY.get(str(node.get("type") or ""), 99),
            str(node.get("name") or ""),
        ),
    )[0]


def _infer_type_from_path(class_path: str, forced_type: str | None = None) -> str:
    if forced_type:
        return forced_type
    if "model_selection" in class_path or ".splitters" in class_path:
        return "splitting"
    if (
        "cross_decomposition" in class_path
        or ".models" in class_path
        or "ensemble" in class_path
        or "linear_model" in class_path
        or "svm" in class_path
        or "xgboost" in class_path
        or "lightgbm" in class_path
        or "catboost" in class_path
    ):
        return "model"
    if "augmentation" in class_path:
        return "augmentation"
    if "filters" in class_path:
        return "filter"
    if "preprocessing" in class_path or "decomposition" in class_path or "transforms" in class_path:
        return "preprocessing"
    return "preprocessing"


def resolve_class_reference(
    reference: str,
    *,
    forced_type: str | None = None,
) -> dict[str, Any]:
    """Resolve a class/function reference using the generated registry first."""
    raw_ref = str(reference or "").strip()
    ref = MODEL_CLASS_PATH_ALIASES.get(raw_ref.lower(), raw_ref)
    candidates = _reference_lookup().get(ref.strip().lower(), [])
    node = _select_registry_node(candidates, forced_type=forced_type)
    class_name = _class_name_from_path(ref)
    display_name = (
        MODEL_DISPLAY_NAME_ALIASES.get(raw_ref.lower())
        or MODEL_DISPLAY_NAME_ALIASES.get(ref.lower())
        or MODEL_DISPLAY_NAME_ALIASES.get(class_name.lower())
    )

    if node:
        return {
            "name": str(node.get("name") or class_name or ref),
            "type": forced_type or str(node.get("type") or _infer_type_from_path(ref)),
            "classPath": ref if "." in ref else node.get("classPath"),
        }

    if "." in ref:
        class_name = _class_name_from_path(ref)
        node = _select_registry_node(
            _reference_lookup().get(class_name.lower(), []),
            forced_type=forced_type,
        )
        if node:
            return {
                "name": str(node.get("name") or class_name),
                "type": forced_type or str(node.get("type") or _infer_type_from_path(ref)),
                "classPath": ref,
            }

    return {
        "name": display_name or class_name or ref or "Unknown",
        "type": _infer_type_from_path(ref, forced_type=forced_type),
        "classPath": ref if "." in ref else None,
    }


def resolve_editor_class_path(
    step_type: str,
    name: str,
    class_path: str | None = None,
) -> str:
    normalized_name = str(name or "").strip()
    if not normalized_name:
        return str(class_path or "")

    if class_path and step_type != "model":
        return str(class_path)

    lookup = _name_type_lookup()
    candidate = lookup.get((step_type, normalized_name.lower()))
    if candidate:
        return candidate

    if step_type == "model":
        function_model_path = FUNCTION_MODEL_CLASS_PATHS.get(normalized_name.lower())
        if function_model_path:
            return function_model_path

        model_class_path = MODEL_CLASS_PATH_ALIASES.get(normalized_name.lower())
        if model_class_path:
            return model_class_path

    if class_path:
        return str(class_path)

    resolved = resolve_class_reference(normalized_name, forced_type=step_type)
    resolved_class_path = resolved.get("classPath")
    if isinstance(resolved_class_path, str) and resolved_class_path:
        return resolved_class_path

    if step_type == "preprocessing":
        return f"sklearn.preprocessing.{normalized_name}"
    if step_type == "splitting":
        return f"sklearn.model_selection.{normalized_name}"
    if step_type == "y_processing":
        return f"sklearn.preprocessing.{normalized_name}"

    # Models and custom components span multiple namespaces. If we cannot
    # resolve a class path, keep the unresolved name so strict callers can
    # raise a clear validation error instead of inventing a wrong module path.
    return normalized_name


def resolve_required_editor_class_path(
    step_type: str,
    name: str,
    class_path: str | None = None,
) -> str:
    resolved = resolve_editor_class_path(step_type, name, class_path)
    if "." in resolved:
        return resolved
    raise ValueError(
        f"Could not resolve class path for {step_type} step '{name}'. "
        "Check that the step definition is valid."
    )


def _normalize_editor_kind(step: dict[str, Any]) -> tuple[str, str | None]:
    step_type = str(step.get("type") or "preprocessing")
    sub_type = step.get("subType")
    if isinstance(sub_type, str):
        return step_type, sub_type
    if step_type in FLOW_SUBTYPES:
        return "flow", step_type
    if step_type in UTILITY_SUBTYPES:
        return "utility", step_type
    return step_type, None


def _hydrate_editor_step(step: dict[str, Any]) -> dict[str, Any]:
    hydrated = clone_value(step)
    step_type, _sub_type = _normalize_editor_kind(hydrated)

    if (
        not hydrated.get("functionPath")
        and hydrated.get("rawNirs4all") is None
        and step_type not in {"flow", "utility"}
    ):
        resolved = resolve_editor_class_path(
            step_type,
            str(hydrated.get("name") or ""),
            hydrated.get("classPath"),
        )
        if "." in resolved:
            hydrated["classPath"] = resolved

    if step_type == "model" and not hydrated.get("functionPath"):
        class_path = hydrated.get("classPath")
        if _looks_like_function_model_path(class_path):
            hydrated["functionPath"] = class_path
            framework = _infer_model_framework_from_path(class_path)
            if framework and not hydrated.get("framework"):
                hydrated["framework"] = framework

    branches = hydrated.get("branches")
    if isinstance(branches, list):
        hydrated["branches"] = [
            [
                _hydrate_editor_step(branch_step)
                if isinstance(branch_step, dict)
                else branch_step
                for branch_step in branch
            ]
            if isinstance(branch, list)
            else branch
            for branch in branches
        ]

    children = hydrated.get("children")
    if isinstance(children, list):
        hydrated["children"] = [
            _hydrate_editor_step(child) if isinstance(child, dict) else child
            for child in children
        ]

    return hydrated


def hydrate_editor_steps(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        _hydrate_editor_step(step) if isinstance(step, dict) else step
        for step in steps
    ]


def _clean_params(params: dict[str, Any] | None) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in (params or {}).items():
        if not str(key).startswith("_"):
            result[str(key)] = clone_value(value)
    return result


def _create_no_op_editor_step() -> dict[str, Any]:
    return {
        "id": _step_id(),
        "type": "utility",
        "name": "NoOp",
        "params": {},
        "isNoOp": True,
        "rawNirs4all": None,
    }


def _passthrough_editor_step(
    raw_step: Any,
    *,
    name: str,
    step_type: str = "preprocessing",
    sub_type: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    step: dict[str, Any] = {
        "id": _step_id(),
        "type": step_type,
        "name": name,
        "params": {},
        "rawNirs4all": clone_value(raw_step),
    }
    if sub_type:
        step["subType"] = sub_type
    if extra:
        step.update(extra)
    return step


def _convert_generator_branch_to_editor(branch_value: Any) -> list[dict[str, Any]]:
    if branch_value is None:
        return [_create_no_op_editor_step()]
    if isinstance(branch_value, list):
        return [_convert_step_to_editor(item) for item in branch_value]
    return [_convert_step_to_editor(branch_value)]


def _sequence_child_from_steps(steps: list[dict[str, Any]]) -> dict[str, Any]:
    if len(steps) == 1:
        return steps[0]
    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "sequential",
        "name": "Sequential",
        "params": {},
        "children": steps,
    }


def _parse_finetune_param_config(name: str, config: Any) -> dict[str, Any]:
    if isinstance(config, list):
        if config and isinstance(config[0], str) and config[0] in SEARCH_SPACE_TOKENS:
            token = config[0]
            rest = config[1:]
            if token == "categorical":
                choices = rest[0] if rest and isinstance(rest[0], list) else rest
                return {
                    "name": name,
                    "type": "categorical",
                    "choices": clone_value(choices),
                    "rawValue": clone_value(config),
                }
            return {
                "name": name,
                "type": token,
                "low": rest[0] if len(rest) > 0 else None,
                "high": rest[1] if len(rest) > 1 else None,
                "step": rest[2] if len(rest) > 2 else None,
                "rawValue": clone_value(config),
            }
        return {
            "name": name,
            "type": "categorical",
            "choices": clone_value(config),
            "rawValue": clone_value(config),
        }

    if isinstance(config, dict):
        param_type = str(config.get("type") or "int")
        if config.get("log"):
            param_type = "log_float"
        return {
            "name": name,
            "type": param_type,
            "low": config.get("low"),
            "high": config.get("high"),
            "step": config.get("step"),
            "choices": clone_value(config.get("choices")),
            "rawValue": clone_value(config),
        }

    return {
        "name": name,
        "type": "categorical",
        "choices": [clone_value(config)],
        "rawValue": clone_value(config),
    }


def _is_separation_branch(branch_data: Any) -> bool:
    return (
        isinstance(branch_data, dict)
        and "steps" in branch_data
        and any(
            key in branch_data
            for key in SEPARATION_BRANCH_KEYS
        )
    )


def _branch_value_label(value: Any) -> str:
    if isinstance(value, bool):
        return "True" if value else "False"
    if value is None:
        return "null"
    return str(value)


def _build_separation_branch_name(config: dict[str, Any]) -> str:
    kind = config.get("kind")
    if kind == "by_tag":
        return f"Branch by tag: {config.get('key', '')}".rstrip(": ")
    if kind == "by_metadata":
        return f"Branch by metadata: {config.get('key', '')}".rstrip(": ")
    if kind == "by_source":
        return "Branch by source"
    return "Branch by filter"


def _apply_attached_generators(
    editor_step: dict[str, Any],
    source_step: dict[str, Any],
) -> None:
    param_sweeps: dict[str, Any] = {}
    param_name = source_step.get("param")

    range_value = source_step.get("_range_")
    if isinstance(range_value, list) and param_name:
        param_sweeps[str(param_name)] = {
            "type": "range",
            "from": range_value[0] if len(range_value) > 0 else 0,
            "to": range_value[1] if len(range_value) > 1 else 0,
            "step": range_value[2] if len(range_value) > 2 else 1,
        }

    log_range_value = source_step.get("_log_range_")
    if isinstance(log_range_value, list) and param_name:
        param_sweeps[str(param_name)] = {
            "type": "log_range",
            "from": log_range_value[0] if len(log_range_value) > 0 else 0,
            "to": log_range_value[1] if len(log_range_value) > 1 else 0,
            "count": log_range_value[2] if len(log_range_value) > 2 else 10,
        }

    grid_value = source_step.get("_grid_")
    if isinstance(grid_value, dict):
        for key, values in grid_value.items():
            if isinstance(values, list):
                param_sweeps[str(key)] = {
                    "type": "or",
                    "choices": clone_value(values),
                }

    if param_sweeps:
        editor_step["paramSweeps"] = param_sweeps


def _apply_attached_comment(
    editor_step: dict[str, Any],
    comment_text: Any,
) -> None:
    if comment_text is not None:
        editor_step["attachedComment"] = clone_value(comment_text)


def _component_to_editor(
    reference: str,
    params: dict[str, Any] | None,
    *,
    forced_type: str | None = None,
    source_step: dict[str, Any] | None = None,
    component_style: str | None = None,
    wrapper_key: str | None = None,
) -> dict[str, Any]:
    resolved = resolve_class_reference(reference, forced_type=forced_type)
    step: dict[str, Any] = {
        "id": _step_id(),
        "type": resolved["type"],
        "name": resolved["name"],
        "params": clone_value(params or {}),
    }
    if resolved.get("classPath"):
        step["classPath"] = resolved["classPath"]
    if component_style:
        step["componentStyle"] = component_style
    if wrapper_key:
        step["canonicalWrapperKey"] = wrapper_key
    if source_step:
        _apply_attached_generators(step, source_step)
    return step


def _component_config_from_canonical(component: Any) -> dict[str, Any]:
    if isinstance(component, str):
        resolved = resolve_class_reference(component)
        return {
            "id": _step_id(),
            "name": resolved["name"],
            "classPath": component,
            "params": {},
            "enabled": True,
        }
    if isinstance(component, dict) and "class" in component:
        resolved = resolve_class_reference(str(component["class"]))
        return {
            "id": _step_id(),
            "name": resolved["name"],
            "classPath": component["class"],
            "params": clone_value(component.get("params") or {}),
            "enabled": True,
        }
    return {
        "id": _step_id(),
        "name": "Unsupported",
        "params": {},
        "enabled": True,
    }


def _convert_model_step_to_editor(step: dict[str, Any]) -> dict[str, Any]:
    model_value = step.get("model")
    editor_step: dict[str, Any] = {
        "id": _step_id(),
        "type": "model",
        "name": "UnknownModel",
        "params": {},
    }

    if isinstance(model_value, str):
        resolved = resolve_class_reference(model_value, forced_type="model")
        editor_step["name"] = resolved["name"]
        editor_step["classPath"] = resolved.get("classPath") or model_value
        editor_step["modelStyle"] = "string"
    elif isinstance(model_value, dict) and "class" in model_value:
        resolved = resolve_class_reference(str(model_value["class"]), forced_type="model")
        editor_step["name"] = resolved["name"]
        editor_step["classPath"] = resolved.get("classPath") or model_value["class"]
        editor_step["params"] = clone_value(model_value.get("params") or {})
        editor_step["modelStyle"] = "class_dict"
    elif isinstance(model_value, dict) and "function" in model_value:
        function_path = str(model_value["function"])
        editor_step["name"] = _class_name_from_path(function_path)
        editor_step["functionPath"] = function_path
        editor_step["params"] = clone_value(model_value.get("params") or {})
        editor_step["modelStyle"] = "function"
        if "framework" in model_value:
            editor_step["framework"] = model_value["framework"]
    else:
        return _passthrough_editor_step(step, name="UnknownModel", step_type="model")

    if step.get("name"):
        editor_step["customName"] = step["name"]
        editor_step["stepMetadata"] = {"customName": step["name"]}

    finetune_params = step.get("finetune_params")
    if isinstance(finetune_params, dict):
        finetune_config: dict[str, Any] = {
            "enabled": True,
            "n_trials": finetune_params.get("n_trials", 50),
            "approach": finetune_params.get("approach", "single"),
            "eval_mode": finetune_params.get("eval_mode", "best"),
            "verbose": finetune_params.get("verbose"),
            "model_params": [],
        }

        sampler_key = None
        sampler_value = None
        for key in SAMPLER_KEYS:
            if key in finetune_params:
                sampler_key = key
                sampler_value = finetune_params[key]
                break
        if sampler_key is not None:
            editor_step["finetuneSamplerKey"] = sampler_key
            editor_step["finetuneSampler"] = sampler_value
            if sampler_value in {"grid", "random", "hyperband"}:
                finetune_config["sample"] = sampler_value

        model_params = finetune_params.get("model_params")
        if isinstance(model_params, dict):
            for name, param_config in model_params.items():
                if isinstance(param_config, (list, dict)):
                    finetune_config["model_params"].append(
                        _parse_finetune_param_config(str(name), param_config)
                    )

        train_params = finetune_params.get("train_params")
        if isinstance(train_params, dict):
            train_param_configs: list[dict[str, Any]] = []
            trial_train_params: dict[str, Any] = {}
            for name, param_config in train_params.items():
                if isinstance(param_config, (list, dict)):
                    train_param_configs.append(
                        _parse_finetune_param_config(str(name), param_config)
                    )
                else:
                    trial_train_params[str(name)] = clone_value(param_config)
            if train_param_configs:
                finetune_config["train_params"] = train_param_configs
            if trial_train_params:
                finetune_config["trial_train_params"] = trial_train_params

        extra = {
            key: clone_value(value)
            for key, value in finetune_params.items()
            if key not in KNOWN_FINETUNE_KEYS
        }
        if extra:
            editor_step["finetuneExtra"] = extra

        editor_step["finetunePresentKeys"] = sorted(finetune_params.keys())
        editor_step["finetuneConfig"] = finetune_config

    train_params = step.get("train_params")
    if isinstance(train_params, dict):
        editor_step["trainingConfig"] = clone_value(train_params)
        step_metadata = clone_value(editor_step.get("stepMetadata") or {})
        step_metadata["trainParams"] = clone_value(train_params)
        editor_step["stepMetadata"] = step_metadata

    _apply_attached_generators(editor_step, step)
    return editor_step


def _convert_y_processing_to_editor(step: dict[str, Any]) -> dict[str, Any]:
    value = step.get("y_processing")
    if isinstance(value, str):
        resolved = resolve_class_reference(value, forced_type="y_processing")
        return {
            "id": _step_id(),
            "type": "y_processing",
            "name": resolved["name"],
            "params": {},
            "classPath": resolved.get("classPath") or value,
            "componentStyle": "string",
        }
    if isinstance(value, dict) and "class" in value:
        resolved = resolve_class_reference(str(value["class"]), forced_type="y_processing")
        return {
            "id": _step_id(),
            "type": "y_processing",
            "name": resolved["name"],
            "params": clone_value(value.get("params") or {}),
            "classPath": resolved.get("classPath") or value["class"],
            "componentStyle": "class_dict",
        }
    return _passthrough_editor_step(step, name="YProcessing", step_type="y_processing")


def _convert_branch_to_editor(step: dict[str, Any]) -> dict[str, Any]:
    branch_data = step.get("branch")
    if _is_separation_branch(branch_data):
        separation_config: dict[str, Any] = {}
        for key in SEPARATION_BRANCH_KEYS:
            if key not in branch_data:
                continue
            separation_config["kind"] = key
            if key in {"by_tag", "by_metadata"}:
                separation_config["key"] = clone_value(branch_data[key])
            elif key == "by_filter":
                separation_config["filter"] = clone_value(branch_data[key])
            elif key == "by_source":
                separation_config["enabled"] = bool(branch_data.get("by_source", True))
            break

        separation_steps = branch_data.get("steps")
        branches: list[list[dict[str, Any]]] = []
        branch_metadata: list[dict[str, Any]] = []

        if isinstance(separation_steps, list):
            branches.append([_convert_step_to_editor(item) for item in separation_steps])
            branch_metadata.append({"name": "All values"})
            separation_config["sharedSteps"] = True
        elif isinstance(separation_steps, dict):
            for branch_value, branch_steps in separation_steps.items():
                items = branch_steps if isinstance(branch_steps, list) else [branch_steps]
                branches.append([_convert_step_to_editor(item) for item in items])
                branch_metadata.append(
                    {
                        "name": _branch_value_label(branch_value),
                        "value": clone_value(branch_value),
                    }
                )
        else:
            return _passthrough_editor_step(
                step,
                name=_build_separation_branch_name(separation_config),
                step_type="flow",
                sub_type="branch",
                extra={"branchMode": "separation"},
            )

        return {
            "id": _step_id(),
            "type": "flow",
            "subType": "branch",
            "name": _build_separation_branch_name(separation_config),
            "params": {},
            "branches": branches,
            "branchMetadata": branch_metadata,
            "branchMode": "separation",
            "separationConfig": separation_config,
        }

    if not isinstance(branch_data, (list, dict)):
        return _passthrough_editor_step(step, name="ParallelBranch", step_type="flow", sub_type="branch")

    branches: list[list[dict[str, Any]]] = []
    branch_metadata: list[dict[str, Any]] = []

    if isinstance(branch_data, list):
        for branch_steps in branch_data:
            if not isinstance(branch_steps, list):
                branch_steps = [branch_steps]
            branches.append([_convert_step_to_editor(item) for item in branch_steps])
            branch_metadata.append({})
    else:
        for branch_name, branch_steps in branch_data.items():
            items = branch_steps if isinstance(branch_steps, list) else [branch_steps]
            branches.append([_convert_step_to_editor(item) for item in items])
            branch_metadata.append({"name": branch_name})

    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "branch",
        "name": "ParallelBranch",
        "params": {},
        "branches": branches,
        "branchMetadata": branch_metadata,
        "branchMode": "duplication",
    }


def _convert_merge_to_editor(step: dict[str, Any]) -> dict[str, Any]:
    merge_value = step.get("merge")
    if isinstance(merge_value, str):
        return {
            "id": _step_id(),
            "type": "flow",
            "subType": "merge",
            "name": "Stacking" if merge_value == "predictions" else "Concatenate",
            "params": {"merge_type": merge_value},
            "mergeConfig": {"mode": merge_value},
        }
    if isinstance(merge_value, dict):
        if "sources" in merge_value:
            known_keys = {"sources", "output_as", "on_missing"}
            editor_step = {
                "id": _step_id(),
                "type": "flow",
                "subType": "merge",
                "name": "Concatenate",
                "params": {"merge_type": "sources"},
                "mergeConfig": {
                    "mode": "sources",
                    "sources": clone_value(merge_value.get("sources")),
                    "output_as": merge_value.get("output_as"),
                    "on_missing": merge_value.get("on_missing"),
                },
            }
            if any(key not in known_keys for key in merge_value):
                editor_step["rawNirs4all"] = clone_value(step)
            return editor_step
        editor_step = {
            "id": _step_id(),
            "type": "flow",
            "subType": "merge",
            "name": "Stacking",
            "params": {},
            "mergeConfig": {
                "mode": "predictions",
                "predictions": clone_value(merge_value.get("predictions")),
                "features": clone_value(merge_value.get("features")),
                "output_as": merge_value.get("output_as"),
                "on_missing": merge_value.get("on_missing"),
            },
        }
        if any(key not in {"predictions", "features", "output_as", "on_missing"} for key in merge_value):
            editor_step["rawNirs4all"] = clone_value(step)
        return editor_step
    return _passthrough_editor_step(step, name="Merge", step_type="flow", sub_type="merge")


def _convert_sample_augmentation_to_editor(step: dict[str, Any]) -> dict[str, Any]:
    augmentation = step.get("sample_augmentation")
    if not isinstance(augmentation, dict):
        return _passthrough_editor_step(
            step,
            name="SampleAugmentation",
            step_type="flow",
            sub_type="sample_augmentation",
        )

    transformers = augmentation.get("transformers") or []
    child_steps = [_convert_step_to_editor(item) for item in transformers]
    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "sample_augmentation",
        "name": "SampleAugmentation",
        "params": {
            "count": augmentation.get("count", 1),
            "selection": augmentation.get("selection", "random"),
            "random_state": augmentation.get("random_state", 42),
            "variation_scope": augmentation.get("variation_scope", "sample"),
        },
        "children": child_steps,
        "branches": [child_steps],
        "sampleAugmentationConfig": {
            "transformers": [_component_config_from_canonical(item) for item in transformers],
            "count": augmentation.get("count"),
            "selection": augmentation.get("selection"),
            "random_state": augmentation.get("random_state"),
            "variation_scope": augmentation.get("variation_scope"),
        },
    }


def _convert_feature_augmentation_to_editor(step: dict[str, Any]) -> dict[str, Any]:
    augmentation = step.get("feature_augmentation")
    if isinstance(augmentation, list):
        child_steps = [_convert_step_to_editor(item) for item in augmentation]
        return {
            "id": _step_id(),
            "type": "flow",
            "subType": "feature_augmentation",
            "name": "FeatureAugmentation",
            "params": {"action": step.get("action", "extend")},
            "children": child_steps,
            "branches": [child_steps],
            "featureAugmentationConfig": {
                "action": step.get("action"),
                "transforms": [_component_config_from_canonical(item) for item in augmentation],
            },
        }

    if isinstance(augmentation, dict) and "_or_" in augmentation:
        alternatives = augmentation.get("_or_") or []
        branches = [_convert_generator_branch_to_editor(item) for item in alternatives]
        child_steps = [_sequence_child_from_steps(branch) for branch in branches]
        or_options = []
        for item in alternatives:
            if item is None or isinstance(item, list):
                continue
            or_options.append(_component_config_from_canonical(item))

        return {
            "id": _step_id(),
            "type": "flow",
            "subType": "feature_augmentation",
            "name": "FeatureAugmentation",
            "params": {
                "action": step.get("action", "extend"),
                "pick": augmentation.get("pick"),
                "count": augmentation.get("count", 0),
            },
            "children": child_steps,
            "branches": branches,
            "generatorKind": "or",
            "generatorOptions": {
                "pick": augmentation.get("pick"),
                "count": augmentation.get("count"),
            },
            "featureAugmentationConfig": {
                "action": step.get("action"),
                "orOptions": or_options,
                "pick": augmentation.get("pick"),
                "count": augmentation.get("count"),
            },
        }

    return _passthrough_editor_step(
        step,
        name="FeatureAugmentation",
        step_type="flow",
        sub_type="feature_augmentation",
    )


def _convert_sample_filter_to_editor(step: dict[str, Any]) -> dict[str, Any]:
    filter_value = step.get("sample_filter")
    if not isinstance(filter_value, dict):
        return _passthrough_editor_step(step, name="SampleFilter", step_type="flow", sub_type="sample_filter")

    filters = filter_value.get("filters") or []
    child_steps = [_convert_step_to_editor(item) for item in filters]
    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "sample_filter",
        "name": "SampleFilter",
        "params": {
            "mode": filter_value.get("mode", "any"),
            "report": filter_value.get("report", True),
        },
        "children": child_steps,
        "branches": [child_steps],
        "sampleFilterConfig": {
            "filters": [_component_config_from_canonical(item) for item in filters],
            "mode": filter_value.get("mode"),
            "report": filter_value.get("report"),
        },
        "filterOrigin": "sample_filter",
    }


def _convert_filter_wrapper_to_editor(step: dict[str, Any]) -> dict[str, Any]:
    origin = "exclude" if "exclude" in step else "tag"
    raw_filters = step.get(origin)
    filters = raw_filters if isinstance(raw_filters, list) else [raw_filters] if raw_filters is not None else []
    child_steps = [_convert_step_to_editor(item) for item in filters]

    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "sample_filter",
        "name": "TagFilter" if origin == "tag" else "SampleFilter",
        "params": {"mode": step.get("mode")} if origin == "exclude" and "mode" in step else {},
        "children": child_steps,
        "branches": [child_steps],
        "sampleFilterConfig": {
            "filters": [_component_config_from_canonical(item) for item in filters],
            "mode": step.get("mode"),
        },
        "filterOrigin": origin,
    }


def _convert_concat_transform_to_editor(step: dict[str, Any]) -> dict[str, Any]:
    transforms = step.get("concat_transform")
    if not isinstance(transforms, list):
        return _passthrough_editor_step(
            step,
            name="ConcatTransform",
            step_type="flow",
            sub_type="concat_transform",
        )

    branches: list[list[dict[str, Any]]] = []
    child_steps: list[dict[str, Any]] = []
    branch_configs: list[list[dict[str, Any]]] = []

    for item in transforms:
        if isinstance(item, list):
            branch_steps = [_convert_step_to_editor(child) for child in item]
            branches.append(branch_steps)
            child_steps.extend(branch_steps)
            branch_configs.append([_component_config_from_canonical(child) for child in item])
        else:
            branch_step = _convert_step_to_editor(item)
            branches.append([branch_step])
            child_steps.append(branch_step)
            branch_configs.append([_component_config_from_canonical(item)])

    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "concat_transform",
        "name": "ConcatTransform",
        "params": {},
        "children": child_steps,
        "branches": branches,
        "concatTransformConfig": {"branches": branch_configs},
    }


def _convert_or_generator_to_editor(step: dict[str, Any]) -> dict[str, Any]:
    alternatives = step.get("_or_") or []
    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "generator",
        "name": "Or",
        "params": {},
        "branches": [_convert_generator_branch_to_editor(item) for item in alternatives],
        "generatorKind": "or",
        "generatorOptions": {
            "pick": step.get("pick"),
            "arrange": step.get("arrange"),
            "then_pick": step.get("then_pick"),
            "then_arrange": step.get("then_arrange"),
            "count": step.get("count"),
        },
    }


def _convert_cartesian_generator_to_editor(step: dict[str, Any]) -> dict[str, Any]:
    stages = step.get("_cartesian_") or []
    params = {"_seed_": step.get("_seed_")} if "_seed_" in step else {}
    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "generator",
        "name": "Cartesian",
        "params": params,
        "branches": [_convert_generator_branch_to_editor(stage) for stage in stages],
        "generatorKind": "cartesian",
        "generatorOptions": {
            "pick": step.get("pick"),
            "arrange": step.get("arrange"),
            "count": step.get("count"),
        },
    }


def _convert_chain_generator_to_editor(step: dict[str, Any]) -> dict[str, Any]:
    configs = step.get("_chain_") or []
    params = {"_seed_": step.get("_seed_")} if "_seed_" in step else {}
    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "generator",
        "name": "Chain",
        "params": params,
        "branches": [_convert_generator_branch_to_editor(config) for config in configs],
        "generatorKind": "chain",
        "generatorOptions": {"count": step.get("count")},
    }


def _convert_scalar_generator_to_editor(
    step: dict[str, Any],
    *,
    kind: str,
) -> dict[str, Any]:
    params = {"_seed_": step.get("_seed_")} if "_seed_" in step else {}
    generator_options = {"count": step.get("count")} if step.get("count") is not None else {}

    if kind in {"grid", "zip"}:
        payload = step.get(f"_{kind}_")
        if not isinstance(payload, dict):
            return _passthrough_editor_step(
                step,
                name=kind.capitalize(),
                step_type="flow",
                sub_type="generator",
                extra={"generatorKind": kind},
            )
        entries = [
            {
                "id": _step_id(),
                "key": str(param_name),
                "values": clone_value(values if isinstance(values, list) else [values]),
            }
            for param_name, values in payload.items()
        ]
        return {
            "id": _step_id(),
            "type": "flow",
            "subType": "generator",
            "name": "Grid" if kind == "grid" else "Zip",
            "params": params,
            "generatorKind": kind,
            "generatorOptions": generator_options,
            "scalarGeneratorConfig": {"entries": entries},
        }

    payload = step.get("_sample_")
    if not isinstance(payload, dict):
        return _passthrough_editor_step(
            step,
            name="Sample",
            step_type="flow",
            sub_type="generator",
            extra={"generatorKind": "sample"},
        )
    return {
        "id": _step_id(),
        "type": "flow",
        "subType": "generator",
        "name": "Sample",
        "params": params,
        "generatorKind": "sample",
        "generatorOptions": generator_options,
        "scalarGeneratorConfig": {"sample": clone_value(payload)},
    }


def _convert_step_to_editor(step: Any) -> dict[str, Any]:
    if step is None:
        return _create_no_op_editor_step()

    if isinstance(step, str):
        if step in {"chart_2d", "chart_y"}:
            return {
                "id": _step_id(),
                "type": "utility",
                "subType": "chart",
                "name": step,
                "params": {},
                "chartConfig": {"chartType": step},
                "chartStyle": "string",
            }

        resolved = resolve_class_reference(step)
        editor_step = {
            "id": _step_id(),
            "type": resolved["type"],
            "name": resolved["name"],
            "params": {},
            "componentStyle": "string",
        }
        if resolved.get("classPath"):
            editor_step["classPath"] = resolved["classPath"]
        return editor_step

    if not isinstance(step, dict):
        return _passthrough_editor_step(step, name="Unknown")

    if set(step.keys()) == {"_comment"}:
        return {
            "id": _step_id(),
            "type": "utility",
            "subType": "comment",
            "name": "Comment",
            "params": {"text": step["_comment"]},
        }

    comment_text = step.get("_comment")
    payload = {key: value for key, value in step.items() if key != "_comment"}

    if "model" in payload:
        editor_step = _convert_model_step_to_editor(payload)
    elif "y_processing" in payload:
        editor_step = _convert_y_processing_to_editor(payload)
    elif "branch" in payload:
        editor_step = _convert_branch_to_editor(payload)
    elif "merge" in payload:
        editor_step = _convert_merge_to_editor(payload)
    elif "sample_augmentation" in payload:
        editor_step = _convert_sample_augmentation_to_editor(payload)
    elif "feature_augmentation" in payload:
        editor_step = _convert_feature_augmentation_to_editor(payload)
    elif "sample_filter" in payload:
        editor_step = _convert_sample_filter_to_editor(payload)
    elif "exclude" in payload or "tag" in payload:
        editor_step = _convert_filter_wrapper_to_editor(payload)
    elif "concat_transform" in payload:
        editor_step = _convert_concat_transform_to_editor(payload)
    elif "preprocessing" in payload:
        value = payload["preprocessing"]
        if isinstance(value, str):
            editor_step = _component_to_editor(
                value,
                {},
                source_step=payload,
                component_style="string",
                wrapper_key="preprocessing",
            )
        elif isinstance(value, dict) and "class" in value:
            editor_step = _component_to_editor(
                str(value["class"]),
                value.get("params") or {},
                source_step=payload,
                component_style="class_dict",
                wrapper_key="preprocessing",
            )
        else:
            editor_step = _passthrough_editor_step(payload, name="Preprocessing")
    elif "chart_2d" in payload or "chart_y" in payload:
        chart_type = "chart_2d" if "chart_2d" in payload else "chart_y"
        chart_value = payload.get(chart_type)
        chart_params = clone_value(chart_value) if isinstance(chart_value, dict) else {}
        editor_step = {
            "id": _step_id(),
            "type": "utility",
            "subType": "chart",
            "name": chart_type,
            "params": chart_params,
            "chartConfig": {"chartType": chart_type, **chart_params},
            "chartStyle": "dict",
        }
    elif "_cartesian_" in payload:
        editor_step = _convert_cartesian_generator_to_editor(payload)
    elif "_chain_" in payload:
        editor_step = _convert_chain_generator_to_editor(payload)
    elif "_or_" in payload:
            editor_step = _convert_or_generator_to_editor(payload)
    elif "_grid_" in payload:
        editor_step = _convert_scalar_generator_to_editor(payload, kind="grid")
    elif "_zip_" in payload:
        editor_step = _convert_scalar_generator_to_editor(payload, kind="zip")
    elif "_sample_" in payload:
        editor_step = _convert_scalar_generator_to_editor(payload, kind="sample")
    elif "class" in payload:
        editor_step = _component_to_editor(
            str(payload["class"]),
            payload.get("params") or {},
            source_step=payload,
            component_style="class_dict",
        )
    else:
        name = next(iter(payload.keys()), "Unknown")
        editor_step = _passthrough_editor_step(step, name=str(name))

    _apply_attached_comment(editor_step, comment_text)
    return editor_step


def canonical_to_editor(payload: Any) -> list[dict[str, Any]]:
    """Convert canonical nirs4all JSON/YAML payload into editor steps."""
    _, _, steps = unwrap_canonical_payload(payload)
    return [_convert_step_to_editor(step) for step in steps]


def _ensure_mapping_payload(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    return {}


def _append_attached_comment(payload: Any, step: dict[str, Any]) -> Any:
    comment_text = step.get("attachedComment")
    if comment_text is None:
        return payload
    if isinstance(payload, str):
        return {"class": payload, "_comment": clone_value(comment_text)}
    if isinstance(payload, dict):
        result = clone_value(payload)
        result["_comment"] = clone_value(comment_text)
        return result
    return payload


def _apply_param_sweeps(payload: Any, step: dict[str, Any]) -> Any:
    param_sweeps = step.get("paramSweeps") or {}
    if not param_sweeps:
        return payload

    if isinstance(payload, str):
        payload = {"class": payload}
    result = clone_value(payload)

    # Find the params dict where sweep specs should be injected.
    # Generator keywords (_or_, _range_, etc.) must be placed inside the
    # params dict so they are recognised as pure generator nodes during
    # pipeline expansion.  Placing them at the step level (next to "class"
    # or "model") made them part of a mixed dict that the generator system
    # silently ignored — producing 1 variant instead of N.
    params_dict = _find_sweep_params_dict(result)

    for param_name, sweep in _ensure_mapping_payload(param_sweeps).items():
        if not isinstance(sweep, dict):
            continue
        sweep_type = sweep.get("type")
        if sweep_type == "range":
            params_dict[param_name] = {
                "_range_": [
                    sweep.get("from", 0),
                    sweep.get("to", 10),
                    sweep.get("step", 1),
                ]
            }
        elif sweep_type == "log_range":
            params_dict[param_name] = {
                "_log_range_": [
                    sweep.get("from", 0.001),
                    sweep.get("to", 100),
                    sweep.get("count", 10),
                ]
            }
        elif sweep_type in {"or", "grid"}:
            choices = sweep.get("choices")
            if isinstance(choices, list):
                params_dict[param_name] = {"_or_": clone_value(choices)}

    return result


def _find_sweep_params_dict(payload: dict[str, Any]) -> dict[str, Any]:
    """Locate (or create) the ``params`` dict inside a canonical step payload.

    Handles both regular components (``{"class": ..., "params": {...}}``) and
    model wrappers (``{"model": {"class": ..., "params": {...}}}``).
    """
    # Regular component
    if "params" in payload and isinstance(payload["params"], dict):
        return payload["params"]
    # Model wrapper
    if "model" in payload and isinstance(payload["model"], dict):
        model = payload["model"]
        if "params" not in model or not isinstance(model.get("params"), dict):
            model["params"] = {}
        return model["params"]
    # Fallback: create params on the payload itself
    if "params" not in payload:
        payload["params"] = {}
    return payload["params"]


def _component_payload_from_editor(step: dict[str, Any], class_path: str) -> Any:
    params = _clean_params(_ensure_mapping_payload(step.get("params")))
    style = step.get("componentStyle") or "string"
    needs_dict = bool(params or step.get("attachedComment") is not None or step.get("paramSweeps"))
    if needs_dict or style == "class_dict":
        payload: Any = {"class": class_path}
    else:
        payload = class_path
    if isinstance(payload, dict) and params:
        payload["params"] = params
    payload = _apply_param_sweeps(payload, step)
    payload = _append_attached_comment(payload, step)
    wrapper_key = step.get("canonicalWrapperKey")
    if wrapper_key:
        payload = {wrapper_key: payload}
    return payload


def _serialize_editor_steps(steps: list[dict[str, Any]]) -> list[Any]:
    result: list[Any] = []
    for step in steps:
        converted = _convert_editor_step_to_canonical(step)
        if isinstance(converted, list):
            result.extend(converted)
        else:
            result.append(converted)
    return result


def _serialize_branch_value(branch_steps: list[dict[str, Any]]) -> Any:
    converted = _serialize_editor_steps(branch_steps)
    if len(converted) == 1:
        return converted[0]
    return converted


def _serialize_component_list(steps: list[dict[str, Any]]) -> list[Any]:
    return _serialize_editor_steps(steps)


def _serialize_finetune_param_config(param: dict[str, Any]) -> Any:
    if "rawValue" in param:
        return clone_value(param["rawValue"])

    param_type = param.get("type")
    if param_type == "categorical":
        return clone_value(param.get("choices") or [])

    result: dict[str, Any] = {"type": param_type}
    if param.get("low") is not None:
        result["low"] = param["low"]
    if param.get("high") is not None:
        result["high"] = param["high"]
    if param.get("step") is not None:
        result["step"] = param["step"]
    if param_type == "log_float":
        result["log"] = True
    return result


def _build_train_params(step: dict[str, Any]) -> dict[str, Any] | None:
    training_config = _ensure_mapping_payload(step.get("trainingConfig"))
    metadata = _ensure_mapping_payload(step.get("stepMetadata"))
    metadata_train = _ensure_mapping_payload(metadata.get("trainParams"))

    result = clone_value(metadata_train)
    for key, value in training_config.items():
        result[str(key)] = clone_value(value)

    return result or None


def _build_model_payload(step: dict[str, Any]) -> dict[str, Any]:
    if "functionPath" in step:
        model_payload: dict[str, Any] = {"function": step["functionPath"]}
        params = _clean_params(_ensure_mapping_payload(step.get("params")))
        if params:
            model_payload["params"] = params
        if step.get("framework"):
            model_payload["framework"] = step["framework"]
    else:
        class_path = resolve_required_editor_class_path(
            "model",
            str(step.get("name") or "UnknownModel"),
            step.get("classPath"),
        )
        params = _clean_params(_ensure_mapping_payload(step.get("params")))
        if step.get("modelStyle") == "string" and not params:
            model_payload = class_path
        else:
            model_payload = {"class": class_path}
            if params:
                model_payload["params"] = params
    return model_payload


def _convert_editor_model_to_canonical(step: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"model": _build_model_payload(step)}

    custom_name = step.get("customName") or _ensure_mapping_payload(step.get("stepMetadata")).get("customName")
    if custom_name:
        result["name"] = custom_name

    finetune_config = _ensure_mapping_payload(step.get("finetuneConfig"))
    if finetune_config.get("enabled"):
        finetune_payload = clone_value(_ensure_mapping_payload(step.get("finetuneExtra")))
        present_keys = set(step.get("finetunePresentKeys") or [])
        preserve_presence = bool(present_keys)

        if not preserve_presence or "n_trials" in present_keys:
            finetune_payload["n_trials"] = finetune_config.get("n_trials", 50)
        if not preserve_presence or "approach" in present_keys:
            finetune_payload["approach"] = finetune_config.get("approach", "single")
        if not preserve_presence or "eval_mode" in present_keys:
            finetune_payload["eval_mode"] = finetune_config.get("eval_mode", "best")

        sampler_value = step.get("finetuneSampler")
        sampler_key = step.get("finetuneSamplerKey")
        if sampler_value is not None:
            finetune_payload[str(sampler_key or "sampler")] = sampler_value
        elif finetune_config.get("sample") is not None:
            finetune_payload["sample"] = finetune_config.get("sample")

        if finetune_config.get("verbose") is not None and (
            not preserve_presence or "verbose" in present_keys
        ):
            finetune_payload["verbose"] = finetune_config.get("verbose")

        model_params: dict[str, Any] = {}
        for param in finetune_config.get("model_params") or []:
            if isinstance(param, dict) and param.get("name"):
                model_params[str(param["name"])] = _serialize_finetune_param_config(param)
        if model_params:
            finetune_payload["model_params"] = model_params

        train_params_payload: dict[str, Any] = {}
        for param in finetune_config.get("train_params") or []:
            if isinstance(param, dict) and param.get("name"):
                train_params_payload[str(param["name"])] = _serialize_finetune_param_config(param)
        for key, value in _ensure_mapping_payload(finetune_config.get("trial_train_params")).items():
            train_params_payload[str(key)] = clone_value(value)
        if train_params_payload:
            finetune_payload["train_params"] = train_params_payload

        result["finetune_params"] = finetune_payload

    train_params = _build_train_params(step)
    if train_params:
        result["train_params"] = train_params

    result = _apply_param_sweeps(result, step)
    result = _append_attached_comment(result, step)
    return result


def _convert_editor_y_processing_to_canonical(step: dict[str, Any]) -> dict[str, Any]:
    class_path = resolve_required_editor_class_path(
        "y_processing",
        str(step.get("name") or "StandardScaler"),
        step.get("classPath"),
    )
    payload = _component_payload_from_editor(step, class_path)
    return {"y_processing": payload}


def _convert_editor_branch_to_canonical(step: dict[str, Any]) -> dict[str, Any]:
    if step.get("branchMode") == "separation":
        separation_config = _ensure_mapping_payload(step.get("separationConfig"))
        separation_kind = str(
            separation_config.get("kind")
            or _ensure_mapping_payload(step.get("params")).get("separationKind")
            or "by_tag"
        )
        branch_payload: dict[str, Any] = {}
        if separation_kind in {"by_tag", "by_metadata"}:
            branch_payload[separation_kind] = clone_value(separation_config.get("key"))
        elif separation_kind == "by_filter":
            branch_payload[separation_kind] = clone_value(separation_config.get("filter"))
        elif separation_kind == "by_source":
            branch_payload["by_source"] = True

        branches = step.get("branches") or []
        metadata_list = step.get("branchMetadata") or []
        shared_steps = bool(separation_config.get("sharedSteps")) and len(branches) == 1
        if shared_steps:
            branch_payload["steps"] = _serialize_editor_steps(branches[0])
        else:
            route_steps: dict[Any, Any] = {}
            for index, branch_steps in enumerate(branches):
                metadata = (
                    _ensure_mapping_payload(metadata_list[index])
                    if index < len(metadata_list)
                    else {}
                )
                route_key = metadata.get("value", metadata.get("name", f"branch_{index}"))
                route_steps[route_key] = _serialize_editor_steps(branch_steps)
            branch_payload["steps"] = route_steps

        return _append_attached_comment({"branch": branch_payload}, step)

    branches = step.get("branches") or []
    if not branches:
        payload: dict[str, Any] = {"branch": {}}
        return _append_attached_comment(payload, step)

    metadata_list = step.get("branchMetadata") or []
    has_names = any(isinstance(item, dict) and item.get("name") for item in metadata_list)

    if has_names:
        branch_payload: dict[str, Any] = {}
        for index, branch_steps in enumerate(branches):
            metadata = _ensure_mapping_payload(metadata_list[index]) if index < len(metadata_list) else {}
            branch_name = metadata.get("name") or f"branch_{index}"
            branch_payload[str(branch_name)] = _serialize_editor_steps(branch_steps)
        payload = {"branch": branch_payload}
    else:
        payload = {"branch": [_serialize_editor_steps(branch_steps) for branch_steps in branches]}

    return _append_attached_comment(payload, step)


def _convert_editor_merge_to_canonical(step: dict[str, Any]) -> dict[str, Any]:
    merge_config = _ensure_mapping_payload(step.get("mergeConfig"))
    if merge_config:
        if merge_config.get("sources") is not None or merge_config.get("mode") == "sources":
            merge_payload: dict[str, Any] = {
                "sources": clone_value(merge_config.get("sources", "concat"))
            }
            for key in ("output_as", "on_missing"):
                if merge_config.get(key) is not None:
                    merge_payload[key] = clone_value(merge_config[key])
            return _append_attached_comment({"merge": merge_payload}, step)

        if merge_config.get("mode") and not merge_config.get("predictions") and not merge_config.get("features"):
            payload = {"merge": merge_config["mode"]}
            return _append_attached_comment(payload, step)

        merge_payload: dict[str, Any] = {}
        for key in ("predictions", "features", "output_as", "on_missing"):
            if merge_config.get(key) is not None:
                merge_payload[key] = clone_value(merge_config[key])
        payload = {"merge": merge_payload}
        return _append_attached_comment(payload, step)

    params = _ensure_mapping_payload(step.get("params"))
    if params.get("merge_type") and not params.get("predictions"):
        payload = {"merge": params["merge_type"]}
        return _append_attached_comment(payload, step)

    payload = {"merge": clone_value(params)}
    return _append_attached_comment(payload, step)


def _convert_editor_sample_augmentation_to_canonical(step: dict[str, Any]) -> dict[str, Any]:
    children = step.get("children") or []
    transformers = _serialize_component_list(children)
    params = _ensure_mapping_payload(step.get("params"))
    config = _ensure_mapping_payload(step.get("sampleAugmentationConfig"))
    payload = {
        "sample_augmentation": {
            "transformers": transformers,
            "count": params.get("count", config.get("count", 1)),
            "selection": params.get("selection", config.get("selection", "random")),
            "random_state": params.get("random_state", config.get("random_state", 42)),
            "variation_scope": params.get("variation_scope", config.get("variation_scope", "sample")),
        }
    }
    return _append_attached_comment(payload, step)


def _convert_editor_feature_augmentation_to_canonical(step: dict[str, Any]) -> dict[str, Any]:
    params = _ensure_mapping_payload(step.get("params"))
    action = params.get("action") or _ensure_mapping_payload(step.get("featureAugmentationConfig")).get("action")
    children = step.get("children") or []
    branches = step.get("branches") or []

    if step.get("generatorKind") == "or" or any(child.get("isNoOp") for child in children if isinstance(child, dict)):
        alternatives = [_serialize_branch_value(branch) for branch in branches] if branches else [
            _convert_editor_step_to_canonical(child) for child in children
        ]
        feature_payload: dict[str, Any] = {"_or_": alternatives}
        generator_options = _ensure_mapping_payload(step.get("generatorOptions"))
        if generator_options.get("pick") is not None:
            feature_payload["pick"] = clone_value(generator_options["pick"])
        if generator_options.get("count") is not None:
            feature_payload["count"] = generator_options["count"]
        payload: dict[str, Any] = {"feature_augmentation": feature_payload}
    else:
        direct_list = _serialize_component_list(children) if children else [
            _serialize_branch_value(branch) for branch in branches
        ]
        payload = {"feature_augmentation": direct_list}

    if action is not None:
        payload["action"] = action
    return _append_attached_comment(payload, step)


def _convert_editor_sample_filter_to_canonical(step: dict[str, Any]) -> dict[str, Any]:
    origin = step.get("filterOrigin") or "sample_filter"
    params = _ensure_mapping_payload(step.get("params"))
    config = _ensure_mapping_payload(step.get("sampleFilterConfig"))
    children = step.get("children") or []
    filters = _serialize_component_list(children)

    if origin == "sample_filter":
        payload = {
            "sample_filter": {
                "filters": filters,
                "mode": params.get("mode", config.get("mode", "any")),
                "report": params.get("report", config.get("report", True)),
            }
        }
        return _append_attached_comment(payload, step)

    wrapper: dict[str, Any] = {str(origin): filters[0] if len(filters) == 1 else filters}
    if origin == "exclude":
        mode = params.get("mode", config.get("mode"))
        if mode is not None:
            wrapper["mode"] = mode
    return _append_attached_comment(wrapper, step)


def _convert_editor_concat_transform_to_canonical(step: dict[str, Any]) -> dict[str, Any]:
    branches = step.get("branches") or []
    if branches:
        concat_payload = [_serialize_branch_value(branch) for branch in branches]
    else:
        concat_payload = _serialize_component_list(step.get("children") or [])
    payload = {"concat_transform": concat_payload}
    return _append_attached_comment(payload, step)


def _convert_editor_chart_to_canonical(step: dict[str, Any]) -> dict[str, Any]:
    chart_config = _ensure_mapping_payload(step.get("chartConfig"))
    chart_type = str(chart_config.get("chartType") or _ensure_mapping_payload(step.get("params")).get("chartType") or "chart_2d")
    chart_params = clone_value(chart_config) if chart_config else _clean_params(_ensure_mapping_payload(step.get("params")))
    chart_params.pop("chartType", None)
    if step.get("chartStyle") == "string" and not chart_params and step.get("attachedComment") is None:
        return chart_type
    payload: dict[str, Any] = {chart_type: chart_params or {}}
    return _append_attached_comment(payload, step)


def _convert_editor_generator_to_canonical(step: dict[str, Any]) -> dict[str, Any]:
    branches = step.get("branches") or []
    generator_options = _ensure_mapping_payload(step.get("generatorOptions"))
    params = _ensure_mapping_payload(step.get("params"))
    kind = step.get("generatorKind") or "or"
    scalar_generator_config = _ensure_mapping_payload(step.get("scalarGeneratorConfig"))

    def add_modifiers(payload: dict[str, Any]) -> dict[str, Any]:
        result = clone_value(payload)
        for key in ("pick", "arrange", "then_pick", "then_arrange", "count"):
            if generator_options.get(key) is not None:
                result[key] = clone_value(generator_options[key])
        if params.get("_seed_") is not None:
            result["_seed_"] = params["_seed_"]
        return result

    if kind == "cartesian":
        payload = {"_cartesian_": [_serialize_branch_value(branch) for branch in branches]}
        return _append_attached_comment(add_modifiers(payload), step)

    if kind == "grid":
        entries = scalar_generator_config.get("entries")
        if isinstance(entries, list):
            grid_payload = {
                str(entry.get("key")): clone_value(entry.get("values") or [])
                for entry in entries
                if isinstance(entry, dict) and entry.get("key")
            }
            if grid_payload:
                return _append_attached_comment(add_modifiers({"_grid_": grid_payload}), step)
        grid_payload: dict[str, Any] = {}
        metadata_list = step.get("branchMetadata") or []
        for index, branch in enumerate(branches):
            metadata = _ensure_mapping_payload(metadata_list[index]) if index < len(metadata_list) else {}
            param_name = metadata.get("name") or f"param_{index}"
            grid_payload[str(param_name)] = _serialize_editor_steps(branch)
        return _append_attached_comment(add_modifiers({"_grid_": grid_payload}), step)

    if kind == "zip":
        entries = scalar_generator_config.get("entries")
        if isinstance(entries, list):
            zip_payload = {
                str(entry.get("key")): clone_value(entry.get("values") or [])
                for entry in entries
                if isinstance(entry, dict) and entry.get("key")
            }
            if zip_payload:
                return _append_attached_comment(add_modifiers({"_zip_": zip_payload}), step)
        zip_payload: dict[str, Any] = {}
        metadata_list = step.get("branchMetadata") or []
        for index, branch in enumerate(branches):
            metadata = _ensure_mapping_payload(metadata_list[index]) if index < len(metadata_list) else {}
            param_name = metadata.get("name") or f"param_{index}"
            zip_payload[str(param_name)] = _serialize_editor_steps(branch)
        return _append_attached_comment(add_modifiers({"_zip_": zip_payload}), step)

    if kind == "sample":
        sample_payload = _ensure_mapping_payload(scalar_generator_config.get("sample"))
        return _append_attached_comment(
            add_modifiers({"_sample_": clone_value(sample_payload)}),
            step,
        )

    if kind == "chain":
        payload = {"_chain_": [_serialize_branch_value(branch) for branch in branches]}
        return _append_attached_comment(add_modifiers(payload), step)

    payload = {"_or_": [_serialize_branch_value(branch) for branch in branches]}
    return _append_attached_comment(add_modifiers(payload), step)


def _convert_editor_step_to_canonical(step: dict[str, Any]) -> Any:
    if "rawNirs4all" in step:
        return clone_value(step["rawNirs4all"])

    step_type, sub_type = _normalize_editor_kind(step)

    if step_type == "flow" and sub_type:
        if sub_type == "branch":
            return _convert_editor_branch_to_canonical(step)
        if sub_type == "merge":
            return _convert_editor_merge_to_canonical(step)
        if sub_type == "generator":
            return _convert_editor_generator_to_canonical(step)
        if sub_type == "sample_augmentation":
            return _convert_editor_sample_augmentation_to_canonical(step)
        if sub_type == "feature_augmentation":
            return _convert_editor_feature_augmentation_to_canonical(step)
        if sub_type == "sample_filter":
            return _convert_editor_sample_filter_to_canonical(step)
        if sub_type == "concat_transform":
            return _convert_editor_concat_transform_to_canonical(step)
        if sub_type == "sequential":
            return _serialize_editor_steps(step.get("children") or [])

    if step_type == "utility" and sub_type:
        if sub_type == "chart":
            return _convert_editor_chart_to_canonical(step)
        if sub_type == "comment":
            return {"_comment": str(_ensure_mapping_payload(step.get("params")).get("text") or "")}

    if step_type == "model":
        return _convert_editor_model_to_canonical(step)

    if step_type == "y_processing":
        return _convert_editor_y_processing_to_canonical(step)

    class_path = resolve_required_editor_class_path(
        step_type,
        str(step.get("name") or "Unknown"),
        step.get("classPath"),
    )
    return _component_payload_from_editor(step, class_path)


def editor_to_canonical(
    steps: list[dict[str, Any]],
    *,
    name: str | None = None,
    description: str | None = None,
    include_wrapper: bool = False,
) -> list[Any] | dict[str, Any]:
    """Convert editor steps back into canonical nirs4all JSON/YAML format."""
    canonical_steps = _serialize_editor_steps(hydrate_editor_steps(steps))
    if include_wrapper:
        return {
            "name": name or "pipeline",
            "description": description or "",
            "pipeline": canonical_steps,
        }
    return canonical_steps


def validate_canonical(payload: Any) -> dict[str, Any]:
    """Validate canonical payload using nirs4all's pipeline semantics."""
    from nirs4all.pipeline.config.pipeline_config import PipelineConfigs

    name, description, steps = unwrap_canonical_payload(payload)
    filtered_steps = filter_comments(steps)
    config = PipelineConfigs(filtered_steps, name=name, description=description)
    return {
        "valid": True,
        "pipeline": _stable_sort_template(config.original_template),
        "has_generators": config.has_configurations,
        "num_configurations": len(config.steps),
    }
