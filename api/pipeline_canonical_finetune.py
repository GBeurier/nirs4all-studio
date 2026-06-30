"""Finetune search-space conversion helpers for canonical pipeline payloads."""

from __future__ import annotations

import copy
from typing import Any

SEARCH_SPACE_TOKEN_ALIASES = {"float_log": "log_float"}
SEARCH_SPACE_TOKENS = {"int", "float", "categorical", "log_float"} | set(
    SEARCH_SPACE_TOKEN_ALIASES
)


def _clone_value(value: Any) -> Any:
    return copy.deepcopy(value)


def _normalize_search_space_token(token: Any) -> Any:
    if isinstance(token, str):
        return SEARCH_SPACE_TOKEN_ALIASES.get(token, token)
    return token


def _normalize_search_space_raw_value(value: Any) -> Any:
    normalized = _clone_value(value)
    if isinstance(normalized, list) and normalized and isinstance(normalized[0], str):
        normalized[0] = _normalize_search_space_token(normalized[0])
    elif isinstance(normalized, dict) and normalized.get("type") == "float_log":
        normalized["type"] = "log_float"
    return normalized


def _parse_finetune_param_config(name: str, config: Any) -> dict[str, Any]:
    if isinstance(config, list):
        if config and isinstance(config[0], str) and config[0] in SEARCH_SPACE_TOKENS:
            token = _normalize_search_space_token(config[0])
            rest = config[1:]
            raw_value = _normalize_search_space_raw_value(config)
            if token == "categorical":
                choices = rest[0] if rest and isinstance(rest[0], list) else rest
                return {
                    "name": name,
                    "type": "categorical",
                    "choices": _clone_value(choices),
                    "rawValue": raw_value,
                }
            return {
                "name": name,
                "type": token,
                "low": rest[0] if len(rest) > 0 else None,
                "high": rest[1] if len(rest) > 1 else None,
                "step": rest[2] if len(rest) > 2 else None,
                "rawValue": raw_value,
            }
        return {
            "name": name,
            "type": "categorical",
            "choices": _clone_value(config),
            "rawValue": _clone_value(config),
        }

    if isinstance(config, dict):
        param_type = str(_normalize_search_space_token(config.get("type") or "int"))
        if config.get("log"):
            param_type = "log_float"
        return {
            "name": name,
            "type": param_type,
            "low": config.get("low"),
            "high": config.get("high"),
            "step": config.get("step"),
            "choices": _clone_value(config.get("choices")),
            "rawValue": _normalize_search_space_raw_value(config),
        }

    return {
        "name": name,
        "type": "categorical",
        "choices": [_clone_value(config)],
        "rawValue": _clone_value(config),
    }


def _finetune_param_values_equivalent(left: Any, right: Any) -> bool:
    if isinstance(left, list) or isinstance(right, list):
        if not isinstance(left, list) or not isinstance(right, list):
            return False
        if len(left) != len(right):
            return False
        return all(
            _finetune_param_values_equivalent(value, right[index])
            for index, value in enumerate(left)
        )

    if isinstance(left, dict):
        if not isinstance(right, dict):
            return False
        if set(left.keys()) != set(right.keys()):
            return False
        return all(
            _finetune_param_values_equivalent(value, right[key])
            for key, value in left.items()
        )

    return left == right


def _comparable_finetune_param_shape(param: dict[str, Any]) -> dict[str, Any]:
    param_type = param.get("type")
    if param_type == "categorical":
        return {
            "type": "categorical",
            "choices": _clone_value(param.get("choices") or []),
        }

    return {
        "type": param_type,
        "low": param.get("low"),
        "high": param.get("high"),
        "step": param.get("step"),
    }


def _should_reuse_raw_finetune_param_value(param: dict[str, Any]) -> bool:
    if "rawValue" not in param:
        return False

    parsed_raw_value = _parse_finetune_param_config(
        str(param.get("name") or ""), param["rawValue"]
    )
    return _finetune_param_values_equivalent(
        _comparable_finetune_param_shape(param),
        _comparable_finetune_param_shape(parsed_raw_value),
    )


def _serialize_finetune_param_config(param: dict[str, Any]) -> Any:
    if _should_reuse_raw_finetune_param_value(param):
        return _clone_value(param["rawValue"])

    param_type = param.get("type")
    if param_type == "categorical":
        return _clone_value(param.get("choices") or [])

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
