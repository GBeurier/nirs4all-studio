"""Translate Studio's JSON parameter vocabulary into supported operator inputs.

This module performs no scientific imports. Saved editor payloads and Playground
must use the same conversions before handing execution to the library.
"""
from __future__ import annotations

import ast
import math
from functools import lru_cache
from importlib.metadata import version
from typing import Any

_ALPHA_GRID_MODELS = {"ElasticNetCV", "LassoCV", "MultiTaskElasticNetCV", "MultiTaskLassoCV"}
_SCORE_SELECTORS = {"SelectFdr", "SelectFpr", "SelectFwe", "SelectKBest", "SelectPercentile", "GenericUnivariateSelect"}


@lru_cache(maxsize=1)
def _sklearn_version() -> tuple[int, int]:
    parts = version("scikit-learn").split(".")
    return int(parts[0]), int(parts[1])


def _float_parameter(value: Any) -> Any:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    if isinstance(value, dict):
        return {
            key: [_float_parameter(item) for item in entries]
            if key in {"_or_", "_range_", "_log_range_"} and isinstance(entries, list) else entries
            for key, entries in value.items()
        }
    return value


def _layer_sizes(value: Any) -> Any:
    if isinstance(value, str):
        try:
            value = ast.literal_eval(value)
        except (ValueError, SyntaxError):
            return value  # Invalid values remain visible to sklearn validation.
    if isinstance(value, dict):
        return {key: [_layer_sizes(item) for item in entries]
                if key == "_or_" and isinstance(entries, list) else entries
                for key, entries in value.items()}
    return tuple(value) if isinstance(value, (list, tuple)) else value


def normalize_operator_parameters(name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Preserve parameter meaning across JSON types and sklearn API versions."""
    name = name.rsplit(".", 1)[-1]
    result = dict(params)
    if name in {"MLPRegressor", "MLPClassifier"} and "hidden_layer_sizes" in result:
        result["hidden_layer_sizes"] = _layer_sizes(result["hidden_layer_sizes"])
    if name == "SparseCoder" and isinstance(result.get("dictionary"), list):
        result["dictionary"] = {"class": "numpy.array", "params": {"object": result["dictionary"]}}
    if name in _SCORE_SELECTORS and isinstance(result.get("score_func"), str):
        reference = result["score_func"].strip()
        if not reference:
            result.pop("score_func")
        else:
            if "." not in reference:
                reference = f"sklearn.feature_selection.{reference}"
            result["score_func"] = {"function": reference}
    if name in {"HistGradientBoostingClassifier", "HistGradientBoostingRegressor"} and "max_features" in result:
        # JSON.stringify(1.0) emits 1, but this parameter is a fraction, not a
        # feature count. Other estimators assign different meanings to int/float.
        result["max_features"] = _float_parameter(result["max_features"])

    if name in _ALPHA_GRID_MODELS:
        if isinstance(result.get("alphas"), str) and result["alphas"] == "warn":
            result.pop("alphas")  # The historical sentinel meant the default grid.
        if result.get("n_alphas") == "deprecated":
            result.pop("n_alphas")
        if _sklearn_version() >= (1, 7):
            count = result.pop("n_alphas", None)
            if count is not None and result.get("alphas") is None:
                result["alphas"] = count
        elif isinstance(result.get("alphas"), int) and not isinstance(result["alphas"], bool):
            result["n_alphas"] = result.pop("alphas")

    if name == "KBinsDiscretizer":
        if result.get("quantile_method") == "warn":
            result["quantile_method"] = "linear"
        if "quantile_method" in result and _sklearn_version() < (1, 7):
            if result["quantile_method"] != "linear":
                raise ValueError("KBinsDiscretizer quantile_method other than 'linear' requires scikit-learn >= 1.7")
            result.pop("quantile_method")  # Older sklearn always used linear.

    range_key = {"MinMaxScaler": "feature_range", "RobustScaler": "quantile_range"}.get(name)
    if range_key and range_key in result:
        value = result[range_key]
        if isinstance(value, str):
            try:
                value = ast.literal_eval(value)
            except (ValueError, SyntaxError):
                pass  # Leave invalid user values for the operator to reject.
        if isinstance(value, (list, tuple)):
            result[range_key] = tuple(value)

    if name == "LogTransform" and isinstance(result.get("base"), str):
        result["base"] = math.e if result["base"] == "e" else float(result["base"])
    return result


def normalize_runtime_operator_parameters(payload: Any) -> Any:
    """Apply the adapter to canonical operators, including branches and y steps."""
    if isinstance(payload, list):
        return [normalize_runtime_operator_parameters(item) for item in payload]
    if not isinstance(payload, dict):
        return payload
    result = {key: normalize_runtime_operator_parameters(value) for key, value in payload.items()}
    if isinstance(result.get("class"), str) and isinstance(result.get("params"), dict):
        result["params"] = normalize_operator_parameters(result["class"], result["params"])
    return result
