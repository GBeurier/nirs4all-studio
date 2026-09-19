"""Pure stored pipeline presentation shared by HTTP and the native host."""
from __future__ import annotations

import copy
from typing import Any

from .shared.json_safe import sanitize_dict
from .store_adapter import _parse_json_maybe

CHAIN_CANONICAL_STEP_KEYS = {
    "class",
    "function",
    "model",
    "y_processing",
    "branch",
    "merge",
    "sample_augmentation",
    "feature_augmentation",
    "sample_filter",
    "concat_transform",
    "chart_2d",
    "chart_y",
    "preprocessing",
    "exclude",
    "tag",
    "_or_",
    "_range_",
    "_log_range_",
    "_grid_",
    "_cartesian_",
    "_zip_",
    "_chain_",
    "_sample_",
}

CHAIN_LEGACY_REFERENCE_ALIASES = {
    "xgboost.sklearn.xgbregressor": "xgboost.XGBRegressor",
    "xgboost.sklearn.xgbclassifier": "xgboost.XGBClassifier",
    "lightgbm.sklearn.lgbmregressor": "lightgbm.LGBMRegressor",
    "lightgbm.sklearn.lgbmclassifier": "lightgbm.LGBMClassifier",
}

def _normalize_chain_reference(reference: Any) -> Any:
    if not isinstance(reference, str):
        return reference
    normalized = reference.strip()
    if not normalized:
        return normalized
    return CHAIN_LEGACY_REFERENCE_ALIASES.get(normalized.lower(), normalized)

def _normalize_chain_payload(payload: Any) -> Any:
    if isinstance(payload, list):
        return [_normalize_chain_payload(item) for item in payload]

    if not isinstance(payload, dict):
        return payload

    normalized: dict[str, Any] = {}
    for key, value in payload.items():
        if (key in {"class", "function"} or key in {"model", "y_processing"}) and isinstance(value, str):
            normalized[key] = _normalize_chain_reference(value)
        else:
            normalized[key] = _normalize_chain_payload(value)
    return normalized

def _looks_like_canonical_chain_payload(value: Any) -> bool:
    return isinstance(value, dict) and any(key in value for key in CHAIN_CANONICAL_STEP_KEYS)

_DROP_PIPELINE_STEP = object()

def _is_runtime_only_step_repr(value: Any) -> bool:
    return (
        isinstance(value, str)
        and " object at 0x" in value
        and value.strip().startswith("<")
        and value.strip().endswith(">")
    )

def _clean_expanded_pipeline_step(step: Any) -> Any:
    if step is None:
        return None

    if isinstance(step, list):
        cleaned_items: list[Any] = []
        for item in step:
            cleaned = _clean_expanded_pipeline_step(item)
            if cleaned is _DROP_PIPELINE_STEP:
                continue
            cleaned_items.append(cleaned)
        return cleaned_items

    if isinstance(step, dict):
        if _is_runtime_only_step_repr(step.get("class")):
            return _DROP_PIPELINE_STEP
        if _is_runtime_only_step_repr(step.get("function")):
            return _DROP_PIPELINE_STEP

        model_ref = step.get("model")
        if isinstance(model_ref, str) and _is_runtime_only_step_repr(model_ref):
            return _DROP_PIPELINE_STEP

        cleaned_dict: dict[str, Any] = {}
        for key, value in step.items():
            cleaned = _clean_expanded_pipeline_step(value)
            if cleaned is _DROP_PIPELINE_STEP:
                continue
            cleaned_dict[key] = cleaned
        return _normalize_chain_payload(cleaned_dict)

    if _is_runtime_only_step_repr(step):
        return _DROP_PIPELINE_STEP

    if isinstance(step, str):
        return _normalize_chain_reference(step)

    return step

def _extract_stored_pipeline_steps(stored_pipeline: Any) -> list[Any]:
    expanded_config = _parse_json_maybe(stored_pipeline)

    if isinstance(expanded_config, dict) and isinstance(expanded_config.get("pipeline"), list):
        expanded_steps = expanded_config["pipeline"]
    elif isinstance(expanded_config, list):
        expanded_steps = expanded_config
    elif expanded_config is None:
        expanded_steps = []
    else:
        expanded_steps = [expanded_config]

    cleaned_steps: list[Any] = []
    for step in expanded_steps:
        cleaned = _clean_expanded_pipeline_step(step)
        if cleaned is _DROP_PIPELINE_STEP:
            continue
        cleaned_steps.append(cleaned)

    return sanitize_dict({"pipeline": cleaned_steps})["pipeline"]

def _extract_expanded_pipeline_steps(pipeline: dict[str, Any]) -> list[Any]:
    return _extract_stored_pipeline_steps(pipeline.get("expanded_config"))

def _chain_step_to_canonical(step: dict[str, Any], *, is_model: bool) -> Any | None:
    """Rebuild a canonical step payload from a stored chain step.

    Chain rows often persist the original canonical operator config inside the
    ``params`` field. Prefer that payload when present instead of re-wrapping
    the short ``operator_class`` label, which loses both type fidelity and the
    original parameter shape.
    """
    operator_class = _normalize_chain_reference(step.get("operator_class", ""))
    params = copy.deepcopy(step.get("params"))

    if _looks_like_canonical_chain_payload(params):
        payload = params
    elif is_model:
        if isinstance(params, dict) and ("class" in params or "function" in params):
            payload = {"model": params}
        elif params:
            payload = {"model": {"class": operator_class, "params": params}}
        elif operator_class:
            payload = {"model": operator_class}
        else:
            payload = None
    else:
        if isinstance(params, dict) and ("class" in params or "function" in params):
            payload = params
        elif params:
            payload = {"class": operator_class, "params": params}
        elif operator_class:
            payload = operator_class
        else:
            payload = None

    return _normalize_chain_payload(payload)
