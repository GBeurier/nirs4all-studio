"""Operator metadata shared by Studio transports; no HTTP or workspace state."""
from __future__ import annotations

import importlib
import inspect
import re
from typing import Any

NIRS4ALL_AVAILABLE = True


def get_cached(name: str) -> Any:
    """Import only the requested owner namespace (Python caches modules)."""
    modules = {"transforms": "nirs4all.operators.transforms", "nirs_splitters": "nirs4all.operators.splitters"}
    module = modules.get(name)
    if name.startswith("augmentation_"):
        module = "nirs4all.operators.augmentation." + name.removeprefix("augmentation_")
    if module is None:
        raise ValueError(f"Unknown operator namespace: {name}")
    return importlib.import_module(module)


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
