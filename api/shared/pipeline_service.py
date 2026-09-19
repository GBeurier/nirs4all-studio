"""
Pipeline service utilities shared between playground and preprocessing APIs.

This module provides unified operator resolution and conversion functions
that are used by both the playground and preprocessing endpoints.

Uses dynamic introspection of nirs4all operators instead of hardcoded mappings.
"""

import importlib
import inspect
import math
import re
from typing import Any

from .logger import get_logger

logger = get_logger(__name__)

from ..lazy_imports import get_cached
from ..pipeline_canonical import (
    OperatorResolutionError,
    import_operator_class,
    resolve_editor_class_path,
)

NIRS4ALL_AVAILABLE = True


_RUNTIME_ONLY_PARAMS_BY_OPERATOR_TYPE: dict[str, set[str]] = {
    "splitting": {"group_by", "group", "ignore_repetition", "aggregation", "y_aggregation"},
}


def resolve_operator(
    name: str,
    operator_type: str = "preprocessing"
) -> type | None:
    """Resolve an operator name (or dotted path) to its class.

    Single registry-driven path: ``name -> classPath`` via the shared
    :func:`resolve_editor_class_path` resolver (sourced from the generated node
    registry), then a thin import through :func:`import_operator_class`.  Returns
    the operator class, or ``None`` when it cannot be resolved or imported
    (matching the previous contract relied on by ``instantiate_operator``).

    Args:
        name: Operator name (case-insensitive) or dotted class path
        operator_type: Type of operator ("preprocessing", "splitting", or "augmentation")

    Returns:
        The operator class, or None if not found
    """
    if not NIRS4ALL_AVAILABLE:
        return None

    explicit = name if "." in name else None
    class_path = resolve_editor_class_path(operator_type, name, explicit)
    if "." not in class_path:
        return None

    try:
        return import_operator_class(class_path)
    except OperatorResolutionError:
        return None


def convert_frontend_step(frontend_step: dict[str, Any]) -> dict[str, Any]:
    """Convert a frontend step format to nirs4all pipeline format.

    Frontend format:
        {
            "id": "step_123",
            "type": "preprocessing" | "splitting" | "filter" | "augmentation",
            "name": "StandardNormalVariate",
            "params": {"window_length": 11},
            "enabled": true
        }

    nirs4all format:
        {"preprocessing": "StandardNormalVariate", "window_length": 11}
        {"split": "KFold", "n_splits": 5}
        {"exclude": YOutlierFilter(method="iqr", threshold=1.5)}
        {"augmentation": "GaussianNoise", ...}

    Args:
        frontend_step: Step configuration from frontend

    Returns:
        Step configuration in nirs4all format
    """
    step_type = frontend_step.get("type", "preprocessing")
    name = frontend_step.get("name", "")
    params = frontend_step.get("params", {})

    if step_type == "splitting":
        nirs4all_step = {"split": name}
    elif step_type == "filter":
        # Filters use the exclude keyword with an instantiated filter object
        from .filter_operators import instantiate_filter
        filter_instance = instantiate_filter(name, params)
        if filter_instance is not None and hasattr(filter_instance, '_filter'):
            return {"exclude": filter_instance._filter}
        return {"exclude": name}
    elif step_type == "augmentation":
        nirs4all_step = {"augmentation": name}
    else:
        nirs4all_step = {"preprocessing": name}

    # Merge params into step
    nirs4all_step.update(params)

    return nirs4all_step


def normalize_params(name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Normalize frontend parameters for Python operator constructors.

    Handles JSON-to-Python type mismatches:
    - Reconstructs tuple params from _min/_max suffix pairs
      (e.g. feature_range_min/max -> feature_range=(min, max))
    - Converts LogTransform base strings to floats
    - Filters out None values so Python defaults are used

    Args:
        name: Operator class name
        params: Raw parameters from frontend

    Returns:
        Normalized parameters dict
    """
    normalized = {k: v for k, v in params.items() if v is not None}

    # Generic: reconstruct tuple parameters from _min/_max suffix pairs.
    min_keys = [k for k in list(normalized) if k.endswith("_min")]
    for min_key in min_keys:
        base = min_key[:-4]  # strip "_min"
        max_key = base + "_max"
        if max_key in normalized:
            min_val = normalized.pop(min_key)
            max_val = normalized.pop(max_key)
            if min_val is not None and max_val is not None:
                normalized[base] = (min_val, max_val)

    # SavitzkyGolay: frontend may send "window"; constructor wants "window_length".
    if name == "SavitzkyGolay" and "window" in normalized and "window_length" not in normalized:
        normalized["window_length"] = normalized.pop("window")

    # MovingAverage is implemented as a SavitzkyGolay with polyorder=1, deriv=0.
    if name == "MovingAverage":
        window = normalized.get("window") or normalized.get("window_length") or 5
        normalized = {
            "window_length": window,
            "polyorder": 1,
            "deriv": 0,
        }

    # CropTransformer: end=-1 means "to the end" -> None for the constructor.
    if name == "CropTransformer" and normalized.get("end") == -1:
        normalized["end"] = None

    # LogTransform: convert base string to float
    if name == "LogTransform" and "base" in normalized:
        base_val = normalized["base"]
        if isinstance(base_val, str):
            base_map = {"e": math.e, "10": 10.0, "2": 2.0}
            normalized["base"] = base_map.get(base_val, math.e)

    # CARS: frontend uses n_pls_components, Python constructor uses n_components
    if name == "CARS" and "n_pls_components" in normalized:
        normalized["n_components"] = normalized.pop("n_pls_components")

    # Resampler: frontend uses n_points (int), Python needs target_wavelengths (array).
    # Actual conversion to array happens at execution time (playground, pipeline runner)
    # when wavelength context is available. Here we just remove n_points so it doesn't
    # cause a TypeError on the constructor.
    if name == "Resampler" and "n_points" in normalized:
        normalized.pop("n_points")

    # MinMaxScaler / RobustScaler: coerce list-form range params to tuple.
    # The JSON node defs serialize ranges as lists (e.g. [0, 1]); sklearn requires
    # tuples. Also handle string forms like "(0, 1)" emitted by some playground paths.
    def _coerce_range(value: Any) -> Any:
        if isinstance(value, tuple):
            return value
        if isinstance(value, list):
            return tuple(value)
        if isinstance(value, str):
            import ast
            try:
                parsed = ast.literal_eval(value)
                if isinstance(parsed, (list, tuple)):
                    return tuple(parsed)
            except (ValueError, SyntaxError):
                pass
        return value

    if name == "MinMaxScaler" and "feature_range" in normalized:
        normalized["feature_range"] = _coerce_range(normalized["feature_range"])
    if name == "RobustScaler" and "quantile_range" in normalized:
        normalized["quantile_range"] = _coerce_range(normalized["quantile_range"])

    # sklearn meta-estimators need a nested estimator that the JSON doesn't supply.
    # Inject sensible defaults so the constructor doesn't raise.
    name_lower = name.lower()
    _regression_estimator_meta = {
        "rfe", "rfecv", "selectfrommodel", "sequentialfeatureselector",
        "multioutputregressor",
    }
    _classification_estimator_meta = {
        "multioutputclassifier", "onevsoneclassifier", "onevsrestclassifier",
        "outputcodeclassifier", "fixedthresholdclassifier",
        "tunedthresholdclassifiercv",
    }
    _stacking_voting_regression = {"stackingregressor", "votingregressor"}
    _stacking_voting_classification = {"stackingclassifier", "votingclassifier"}

    needs_estimator = name_lower in _regression_estimator_meta or name_lower in _classification_estimator_meta
    needs_estimators_list = name_lower in _stacking_voting_regression or name_lower in _stacking_voting_classification
    is_metamodel = name_lower == "metamodel"

    if needs_estimator or needs_estimators_list or is_metamodel:
        has_nested = any(
            k in normalized for k in ("estimator", "estimators", "transformers", "transformer_list", "dictionary")
        )
        if not has_nested:
            from sklearn.linear_model import LogisticRegression, Ridge  # lazy import
            if name_lower in _regression_estimator_meta:
                normalized["estimator"] = Ridge()
            elif name_lower in _classification_estimator_meta:
                normalized["estimator"] = LogisticRegression()
            elif name_lower in _stacking_voting_regression:
                normalized["estimators"] = [("ridge", Ridge())]
            elif name_lower in _stacking_voting_classification:
                normalized["estimators"] = [("lr", LogisticRegression())]
            elif is_metamodel:
                normalized["model"] = Ridge()

    return normalized


def strip_runtime_only_params(
    params: dict[str, Any],
    operator_type: str,
) -> dict[str, Any]:
    """Remove execution-time params that must not reach constructors."""
    runtime_only = _RUNTIME_ONLY_PARAMS_BY_OPERATOR_TYPE.get(operator_type)
    if not runtime_only:
        return dict(params)
    return {k: v for k, v in params.items() if k not in runtime_only}


def instantiate_operator(
    name: str,
    params: dict[str, Any],
    operator_type: str = "preprocessing"
) -> Any | None:
    """Create an operator instance from name and parameters.

    Args:
        name: Operator class name
        params: Parameters to pass to constructor
        operator_type: Type of operator ("preprocessing" or "splitting")

    Returns:
        Instantiated operator, or None if class not found

    Raises:
        ValueError: If operator cannot be instantiated with given params
    """
    operator_cls = resolve_operator(name, operator_type)
    if operator_cls is None:
        return None

    params = strip_runtime_only_params(params, operator_type)
    params = normalize_params(name, params)

    try:
        return operator_cls(**params)
    except TypeError:
        # Try without invalid params
        valid_params = get_valid_params(operator_cls, params)
        try:
            return operator_cls(**valid_params)
        except Exception as inner_e:
            raise ValueError(
                f"Failed to instantiate {name} with params {params}: {inner_e}"
            ) from inner_e


def get_valid_params(cls: type, params: dict[str, Any]) -> dict[str, Any]:
    """Filter params to only those accepted by the class constructor.

    Args:
        cls: The class to check
        params: Parameters to filter

    Returns:
        Filtered parameters dict
    """
    try:
        sig = inspect.signature(cls.__init__)
        valid_param_names = set(sig.parameters.keys()) - {"self", "args", "kwargs"}

        # Check if **kwargs is accepted
        has_kwargs = any(
            p.kind == inspect.Parameter.VAR_KEYWORD
            for p in sig.parameters.values()
        )

        if has_kwargs:
            return params

        return {k: v for k, v in params.items() if k in valid_param_names}
    except (ValueError, TypeError):
        return params


def validate_step_params(
    name: str,
    params: dict[str, Any],
    operator_type: str = "preprocessing"
) -> tuple[bool, list[str], list[str]]:
    """Validate parameters for an operator.

    Uses dynamic introspection to validate operator parameters.

    Args:
        name: Operator class name
        params: Parameters to validate
        operator_type: Type of operator

    Returns:
        Tuple of (is_valid, errors, warnings)
    """
    errors = []
    warnings = []

    operator_cls = resolve_operator(name, operator_type)
    if operator_cls is None:
        errors.append(f"Unknown {operator_type} operator: {name}")
        return False, errors, warnings

    params = strip_runtime_only_params(params, operator_type)

    # Get valid parameter names via introspection
    try:
        sig = inspect.signature(operator_cls.__init__)
        valid_params = set(sig.parameters.keys()) - {"self"}

        # Check for unknown parameters
        for param_name in params:
            if param_name not in valid_params:
                has_kwargs = any(
                    p.kind == inspect.Parameter.VAR_KEYWORD
                    for p in sig.parameters.values()
                )
                if not has_kwargs:
                    warnings.append(f"Unknown parameter: {param_name}")

        # Try to instantiate to validate
        try:
            _ = operator_cls(**params)
        except Exception as e:
            errors.append(f"Invalid parameters: {str(e)}")
            return False, errors, warnings

    except (ValueError, TypeError) as e:
        warnings.append(f"Could not validate parameters: {str(e)}")

    return len(errors) == 0, errors, warnings


# Shared by HTTP and the isolated native document host.
from .operator_catalogue import (  # noqa: E402, F401
    _categorize_operator,
    _extract_method_info,
    _to_display_name,
    get_augmentation_methods,
    get_preprocessing_methods,
    get_splitter_methods,
)
