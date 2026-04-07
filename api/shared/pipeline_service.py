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
from typing import Any, Dict, List, Optional, Tuple, Type

from .logger import get_logger

logger = get_logger(__name__)

from ..lazy_imports import get_cached, is_ml_ready

NIRS4ALL_AVAILABLE = True


# Cache for dynamically discovered operators
_preprocessing_cache: dict[str, type] | None = None
_splitter_cache: dict[str, tuple[str, str]] | None = None
_augmentation_cache: dict[str, type] | None = None


def _build_preprocessing_cache() -> dict[str, type]:
    """Build cache of preprocessing operators from nirs4all.operators.transforms.

    Uses the module's __all__ exports and TransformerMixin detection for discovery.
    Also includes common abbreviation aliases for user convenience.

    Returns:
        Dict mapping lowercase names to operator classes
    """
    cache = {}

    transforms = get_cached("transforms")
    if not NIRS4ALL_AVAILABLE or transforms is None:
        return cache

    # Common abbreviation aliases for user convenience
    # Maps lowercase alias -> full class name (also lowercase)
    common_aliases = {
        "snv": "standardnormalvariate",
        "robustsnv": "robuststandardnormalvariate",
        "localsnv": "localstandardnormalvariate",
        "msc": "multiplicativescattercorrection",
        "savgol": "savitzkygolay",
        "movingaverage": "savitzkygolay",
        "baselinecorrection": "baseline",
    }

    # Get all exported names from transforms module
    exported_names = getattr(transforms, "__all__", [])

    for name in exported_names:
        obj = getattr(transforms, name, None)
        if obj is None:
            continue

        # Only include classes that are transformers
        if not inspect.isclass(obj):
            continue

        if not hasattr(obj, "fit_transform"):
            continue

        # Add with multiple key variants for flexible lookup
        cache[name.lower()] = obj
        # Also add without common suffixes
        name_normalized = name.lower().replace("_", "").replace("-", "")
        cache[name_normalized] = obj

    # Add common aliases pointing to their full class names
    for alias, full_name in common_aliases.items():
        if full_name in cache:
            cache[alias] = cache[full_name]

    # Add sklearn preprocessing and decomposition classes
    sklearn_modules = [
        "sklearn.preprocessing",
        "sklearn.decomposition",
        "sklearn.cluster",
        "sklearn.neighbors",
        "sklearn.manifold",
        "sklearn.cross_decomposition",
        "sklearn.feature_selection",
        "sklearn.feature_extraction",
        "sklearn.feature_extraction.text",
        "sklearn.feature_extraction.image",
        "sklearn.impute",
        "sklearn.kernel_approximation",
        "sklearn.random_projection",
        "sklearn.neural_network",
        "sklearn.compose",
        "sklearn.pipeline",
        "sklearn.ensemble",
    ]

    for module_path in sklearn_modules:
        try:
            module = importlib.import_module(module_path)
            for attr_name in dir(module):
                if attr_name.startswith("_"):
                    continue
                obj = getattr(module, attr_name, None)
                if obj is None or not inspect.isclass(obj):
                    continue
                if hasattr(obj, "fit_transform") or hasattr(obj, "transform"):
                    cache[attr_name.lower()] = obj
        except ImportError:
            pass

    return cache


def _build_splitter_cache() -> dict[str, tuple[str, str]]:
    """Build cache of splitter operators from sklearn and nirs4all.

    Returns:
        Dict mapping lowercase names to (module_path, class_name) tuples
    """
    cache = {}

    # sklearn splitters
    sklearn_splitters = [
        "KFold", "StratifiedKFold", "GroupKFold",
        "ShuffleSplit", "StratifiedShuffleSplit", "GroupShuffleSplit",
        "LeaveOneOut", "LeavePGroupsOut", "TimeSeriesSplit",
    ]

    for name in sklearn_splitters:
        key = name.lower().replace("_", "")
        cache[key] = ("sklearn.model_selection", name)

    # nirs4all splitters - use module's __all__ exports
    nirs_splitters = get_cached("nirs_splitters")
    if nirs_splitters is not None:
        exported_names = getattr(nirs_splitters, "__all__", [])
        for name in exported_names:
            obj = getattr(nirs_splitters, name, None)
            if obj is None or not inspect.isclass(obj):
                continue
            # Check if it has a split method (splitter interface)
            if not hasattr(obj, "split"):
                continue
            key = name.lower().replace("_", "")
            cache[key] = ("nirs4all.operators.splitters", name)

    # Short-name aliases for nirs4all splitters
    cache["kennardstone"] = ("nirs4all.operators.splitters", "KennardStoneSplitter")
    cache["spxy"] = ("nirs4all.operators.splitters", "SPXYSplitter")

    return cache


def _build_augmentation_cache() -> dict[str, type]:
    """Build cache of augmentation operators from nirs4all.operators.augmentation.

    Scans all augmentation submodules using the cached imports.

    Returns:
        Dict mapping lowercase names to operator classes
    """
    cache = {}

    if not NIRS4ALL_AVAILABLE:
        return cache

    # Scan all cached augmentation modules
    augmentation_modules = [
        get_cached("augmentation_spectral"),
        get_cached("augmentation_random"),
        get_cached("augmentation_splines"),
        get_cached("augmentation_environmental"),
        get_cached("augmentation_scattering"),
        get_cached("augmentation_edge_artifacts"),
        get_cached("augmentation_synthesis"),
    ]

    for module in augmentation_modules:
        if module is None:
            continue

        exported_names = getattr(module, "__all__", dir(module))
        for name in exported_names:
            if name.startswith("_"):
                continue

            obj = getattr(module, name, None)
            if obj is None or not inspect.isclass(obj):
                continue

            # Check if it's an augmenter (has augment or fit_transform)
            if not (hasattr(obj, "augment") or hasattr(obj, "fit_transform")):
                continue

            # Skip base classes
            if name in ("Augmenter", "BaseEstimator", "TransformerMixin", "SpectraTransformerMixin"):
                continue

            cache[name.lower()] = obj
            name_normalized = name.lower().replace("_", "").replace("-", "")
            cache[name_normalized] = obj

    return cache


def _get_preprocessing_cache() -> dict[str, type]:
    """Get or build preprocessing operator cache."""
    global _preprocessing_cache
    if _preprocessing_cache is None:
        cache = _build_preprocessing_cache()
        # Only memoize if ML deps are loaded, otherwise retry next call
        if cache:
            _preprocessing_cache = cache
        return cache
    return _preprocessing_cache


def _get_splitter_cache() -> dict[str, tuple[str, str]]:
    """Get or build splitter operator cache."""
    global _splitter_cache
    if _splitter_cache is None:
        cache = _build_splitter_cache()
        if cache:
            _splitter_cache = cache
        return cache
    return _splitter_cache


def _get_augmentation_cache() -> dict[str, type]:
    """Get or build augmentation operator cache."""
    global _augmentation_cache
    if _augmentation_cache is None:
        cache = _build_augmentation_cache()
        if cache:
            _augmentation_cache = cache
        return cache
    return _augmentation_cache


def resolve_operator(
    name: str,
    operator_type: str = "preprocessing"
) -> type | None:
    """Resolve an operator name to its class using dynamic introspection.

    Args:
        name: Operator name (case-insensitive)
        operator_type: Type of operator ("preprocessing", "splitting", or "augmentation")

    Returns:
        The operator class, or None if not found
    """
    if not NIRS4ALL_AVAILABLE:
        return None

    name_normalized = name.lower().replace("_", "").replace("-", "")

    if operator_type == "splitting":
        cache = _get_splitter_cache()

        # Try normalized name in cache
        if name_normalized in cache:
            module_path, class_name = cache[name_normalized]
            try:
                module = importlib.import_module(module_path)
                return getattr(module, class_name, None)
            except ImportError:
                return None

        # Try exact match from sklearn
        try:
            from sklearn import model_selection
            splitter_cls = getattr(model_selection, name, None)
            if splitter_cls:
                return splitter_cls
        except ImportError:
            pass

        # Try nirs4all splitters direct lookup
        nirs_splitters = get_cached("nirs_splitters")
        if nirs_splitters:
            splitter_cls = getattr(nirs_splitters, name, None)
            if splitter_cls:
                return splitter_cls

        return None

    elif operator_type == "augmentation":
        cache = _get_augmentation_cache()

        # Try normalized name in cache
        if name_normalized in cache:
            return cache[name_normalized]

        # Try exact name match
        if name.lower() in cache:
            return cache[name.lower()]

        # Try direct lookup from augmentation package
        try:
            augmentation_pkg = importlib.import_module("nirs4all.operators.augmentation")
            aug_cls = getattr(augmentation_pkg, name, None)
            if aug_cls:
                return aug_cls
        except ImportError:
            pass

        return None

    else:  # preprocessing
        cache = _get_preprocessing_cache()

        # Try normalized name in cache
        if name_normalized in cache:
            return cache[name_normalized]

        # Try exact name match
        if name.lower() in cache:
            return cache[name.lower()]

        # Try direct lookup from transforms module
        transforms = get_cached("transforms")
        if transforms:
            transformer_cls = getattr(transforms, name, None)
            if transformer_cls:
                return transformer_cls

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
            from sklearn.linear_model import Ridge, LogisticRegression  # lazy import
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


def get_preprocessing_methods() -> list[dict[str, Any]]:
    """Get list of available preprocessing methods with metadata.

    Uses dynamic introspection of nirs4all.operators.transforms module.

    Returns:
        List of method info dicts with name, display_name, category, params
    """
    transforms = get_cached("transforms")
    if not NIRS4ALL_AVAILABLE or transforms is None:
        return []

    methods = []
    seen_names = set()

    # Operators that fundamentally cannot be defaulted in the playground:
    # EPO needs an external `d` reference matrix.
    _PLAYGROUND_DENYLIST = {"EPO"}

    # Scan nirs4all.operators.transforms using __all__ exports
    exported_names = getattr(transforms, "__all__", [])

    for name in exported_names:
        if name.startswith("_"):
            continue
        if name in _PLAYGROUND_DENYLIST:
            continue

        obj = getattr(transforms, name, None)
        if obj is None or not inspect.isclass(obj):
            continue

        # Check if it's a transformer
        if not hasattr(obj, "fit_transform"):
            continue

        # Skip duplicates
        if name in seen_names:
            continue
        seen_names.add(name)

        # Extract method info
        method_info = _extract_method_info(obj, name, "preprocessing")
        if method_info:
            method_info["source"] = "nirs4all"
            methods.append(method_info)

    # Add sklearn scalers
    sklearn_scalers = [
        ("sklearn.preprocessing", "StandardScaler"),
        ("sklearn.preprocessing", "MinMaxScaler"),
        ("sklearn.preprocessing", "RobustScaler"),
    ]

    for module_path, class_name in sklearn_scalers:
        try:
            module = importlib.import_module(module_path)
            obj = getattr(module, class_name)
            method_info = _extract_method_info(obj, class_name, "preprocessing")
            if method_info:
                method_info["source"] = "sklearn"
                methods.append(method_info)
        except ImportError:
            pass

    return methods


def get_splitter_methods() -> list[dict[str, Any]]:
    """Get list of available splitter methods with metadata.

    Uses dynamic introspection of sklearn and nirs4all splitter modules.

    Returns:
        List of method info dicts with name, display_name, category, params
    """
    methods = []

    # sklearn splitters
    try:
        from sklearn import model_selection

        sklearn_splitters = [
            "KFold", "StratifiedKFold", "GroupKFold",
            "ShuffleSplit", "StratifiedShuffleSplit", "GroupShuffleSplit",
            "LeaveOneOut", "LeavePGroupsOut", "TimeSeriesSplit",
        ]

        for name in sklearn_splitters:
            obj = getattr(model_selection, name, None)
            if obj:
                method_info = _extract_method_info(obj, name, "splitting")
                if method_info:
                    method_info["source"] = "sklearn"
                    methods.append(method_info)
    except ImportError:
        pass

    # nirs4all splitters - use __all__ exports for dynamic discovery
    nirs_splitters = get_cached("nirs_splitters")
    if nirs_splitters:
        exported_names = getattr(nirs_splitters, "__all__", [])

        for name in exported_names:
            obj = getattr(nirs_splitters, name, None)
            if obj is None or not inspect.isclass(obj):
                continue
            # Check if it has a split method
            if not hasattr(obj, "split"):
                continue

            method_info = _extract_method_info(obj, name, "splitting")
            if method_info:
                method_info["source"] = "nirs4all"
                methods.append(method_info)

    return methods


def get_augmentation_methods() -> list[dict[str, Any]]:
    """Get list of available augmentation methods with metadata.

    Augmentation methods generate synthetic variations of spectra for
    training data augmentation (noise, baseline drift, wavelength shifts, etc.)

    Returns:
        List of method info dicts with name, display_name, category, params
    """
    if not NIRS4ALL_AVAILABLE:
        return []

    methods = []
    seen_names: set[str] = set()

    # Scan all cached augmentation modules
    augmentation_modules: list[tuple] = [
        (get_cached("augmentation_spectral"), "spectral"),
        (get_cached("augmentation_random"), "random"),
        (get_cached("augmentation_splines"), "splines"),
        (get_cached("augmentation_environmental"), "environmental"),
        (get_cached("augmentation_scattering"), "scattering"),
        (get_cached("augmentation_edge_artifacts"), "edge_artifacts"),
        (get_cached("augmentation_synthesis"), "synthesis"),
    ]

    for module, source in augmentation_modules:
        if module is None:
            continue

        exported_names = getattr(module, "__all__", dir(module))

        for name in exported_names:
            if name.startswith("_"):
                continue
            if name in seen_names:
                continue

            obj = getattr(module, name, None)
            if obj is None or not inspect.isclass(obj):
                continue

            # Check if it's an augmenter
            if not (hasattr(obj, "augment") or hasattr(obj, "fit_transform")):
                continue

            # Skip base classes and constants
            if name in ("Augmenter", "BaseEstimator", "TransformerMixin", "SpectraTransformerMixin"):
                continue

            seen_names.add(name)

            method_info = _extract_method_info(obj, name, "augmentation")
            if method_info:
                method_info["source"] = f"nirs4all.{source}"
                methods.append(method_info)

    return methods


def _extract_method_info(cls: type, name: str, operator_type: str) -> dict[str, Any] | None:
    """Extract method info from a class.

    Args:
        cls: The class to inspect
        name: Display name for the class
        operator_type: "preprocessing" or "splitting"

    Returns:
        Method info dict, or None if extraction fails
    """
    try:
        # Get docstring
        description = ""
        if cls.__doc__:
            description = cls.__doc__.strip().split("\n")[0]

        # Get parameters
        params = {}
        try:
            sig = inspect.signature(cls.__init__)
            for param_name, param in sig.parameters.items():
                if param_name in ("self", "args", "kwargs"):
                    continue

                param_info = {"required": param.default is inspect.Parameter.empty}

                if param.default is not inspect.Parameter.empty:
                    # Convert default to JSON-serializable format
                    default = param.default
                    if default is None or isinstance(default, (bool, int, float, str)):
                        param_info["default"] = default
                    elif isinstance(default, (list, tuple)):
                        # Try to convert list/tuple elements
                        try:
                            param_info["default"] = list(default)
                        except (TypeError, ValueError):
                            param_info["default"] = str(default)
                    elif callable(default):
                        # Skip callable defaults (functions, methods)
                        param_info["default"] = None
                        param_info["default_is_callable"] = True
                    else:
                        # Convert to string for non-serializable types
                        param_info["default"] = str(default)

                if param.annotation is not inspect.Parameter.empty:
                    type_name = getattr(param.annotation, "__name__", str(param.annotation))
                    param_info["type"] = type_name.lower()

                params[param_name] = param_info
        except (ValueError, TypeError):
            pass

        # Read _webapp_meta if available (nirs4all operators)
        webapp_meta = getattr(cls, "_webapp_meta", None)

        # Categorize (prefer _webapp_meta category if available)
        if webapp_meta and "category" in webapp_meta:
            category = webapp_meta["category"]
        else:
            category = _categorize_operator(name, operator_type)

        result = {
            "name": name,
            "display_name": _to_display_name(name),
            "description": description,
            "category": category,
            "params": params,
            "type": operator_type,
        }

        # Add tier and tags from _webapp_meta
        if webapp_meta:
            if "tier" in webapp_meta:
                result["tier"] = webapp_meta["tier"]
            if "tags" in webapp_meta:
                result["tags"] = webapp_meta["tags"]

        return result
    except Exception:
        return None


def _categorize_operator(name: str, operator_type: str) -> str:
    """Categorize an operator by name."""
    name_lower = name.lower()

    if operator_type == "splitting":
        if "group" in name_lower:
            return "grouped"
        if "stratified" in name_lower:
            return "stratified"
        if "shuffle" in name_lower:
            return "shuffle"
        if any(x in name_lower for x in ["kfold", "fold"]):
            return "kfold"
        if any(x in name_lower for x in ["kennard", "spxy", "distance"]):
            return "distance"
        return "other"

    elif operator_type == "augmentation":
        # Augmentation categories
        if any(x in name_lower for x in ["noise", "additive", "multiplicative"]):
            return "noise"
        if any(x in name_lower for x in ["baseline", "drift", "polynomial"]):
            return "baseline_drift"
        if any(x in name_lower for x in ["wavelength", "shift", "stretch", "warp"]):
            return "wavelength_distortion"
        if any(x in name_lower for x in ["smooth", "unsharp", "resolution", "jitter"]):
            return "resolution"
        if any(x in name_lower for x in ["mask", "dropout", "band"]):
            return "masking"
        if any(x in name_lower for x in ["spike", "clip", "artefact"]):
            return "artefacts"
        if any(x in name_lower for x in ["mixup", "mix"]):
            return "mixing"
        if any(x in name_lower for x in ["scatter", "msc"]):
            return "scatter_simulation"
        if any(x in name_lower for x in ["rotate", "translate", "random"]):
            return "geometric"
        return "other"

    else:  # preprocessing
        if any(x in name_lower for x in ["snv", "msc", "scatter"]):
            return "scatter_correction"
        if any(x in name_lower for x in ["derivative", "deriv", "first", "second"]):
            return "derivative"
        if any(x in name_lower for x in ["baseline", "asls", "airpls", "arpls", "snip", "detrend"]):
            return "baseline"
        if any(x in name_lower for x in ["gaussian", "smooth", "savgol", "savitzky"]):
            return "smoothing"
        if any(x in name_lower for x in ["normalize", "scaler", "scale", "standard"]):
            return "scaling"
        if any(x in name_lower for x in ["wavelet", "haar"]):
            return "wavelet"
        if any(x in name_lower for x in ["absorbance", "reflectance", "convert", "transform"]):
            return "conversion"
        if any(x in name_lower for x in ["crop", "resample"]):
            return "features"
        return "other"


def _to_display_name(name: str) -> str:
    """Convert class name to human-readable display name."""
    # Handle common abbreviations
    abbreviations = {
        "SNV": "SNV",
        "MSC": "MSC",
        "ASLS": "ASLS",
        "ArPLS": "ArPLS",
        "AirPLS": "AirPLS",
        "SNIP": "SNIP",
        "PCA": "PCA",
        "SPXY": "SPXY",
    }

    # Check for exact abbreviation match
    name_upper = name.upper()
    for abbr, display in abbreviations.items():
        if name_upper == abbr.upper():
            return display

    # Insert spaces before capital letters
    result = re.sub(r"([A-Z])", r" \1", name).strip()

    # Handle "Splitter" suffix
    if result.endswith(" Splitter"):
        result = result[:-9]

    return result
