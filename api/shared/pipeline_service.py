"""
Pipeline service utilities shared between playground and preprocessing APIs.

This module provides unified operator resolution and conversion functions
that are used by both the playground and preprocessing endpoints.
"""

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Type, Union
import importlib
import inspect

# Add nirs4all to path if needed
nirs4all_path = Path(__file__).parent.parent.parent.parent / "nirs4all"
if str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

try:
    from nirs4all.operators import transforms
    from nirs4all.operators import splitters as nirs_splitters
    from nirs4all.operators.augmentation import spectral as augmentation_spectral
    from nirs4all.operators.augmentation import random as augmentation_random

    NIRS4ALL_AVAILABLE = True
except ImportError as e:
    print(f"Note: nirs4all not available for pipeline service: {e}")
    NIRS4ALL_AVAILABLE = False
    transforms = None
    nirs_splitters = None
    augmentation_spectral = None
    augmentation_random = None


# Mapping of frontend operator names to nirs4all/sklearn classes
PREPROCESSING_CLASS_MAP: Dict[str, str] = {
    # Scatter correction
    "snv": "StandardNormalVariate",
    "standardnormalvariate": "StandardNormalVariate",
    "msc": "MultiplicativeScatterCorrection",
    "multiplicativescattercorrection": "MultiplicativeScatterCorrection",
    # Derivatives
    "savitzkygolay": "SavitzkyGolay",
    "savgol": "SavitzkyGolay",
    "firstderivative": "FirstDerivative",
    "secondderivative": "SecondDerivative",
    "derivate": "Derivate",
    # Smoothing
    "gaussian": "Gaussian",
    "movingaverage": "MovingAverage",
    # Baseline
    "baseline": "Baseline",
    "detrend": "Detrend",
    "aslsbaseline": "ASLSBaseline",
    "airpls": "AirPLS",
    "arpls": "ArPLS",
    "snip": "SNIP",
    # Scaling
    "normalize": "Normalize",
    "standardscaler": "StandardScaler",
    "minmaxscaler": "MinMaxScaler",
    "robustscaler": "RobustScaler",
    # Features
    "croptransformer": "CropTransformer",
    "resampler": "Resampler",
    "resampletransformer": "ResampleTransformer",
    # Conversion
    "logtransform": "LogTransform",
    "reflectancetoabsorbance": "ReflectanceToAbsorbance",
    # Wavelets
    "haar": "Haar",
    "wavelet": "Wavelet",
    "waveletpca": "WaveletPCA",
}

# Mapping of frontend splitter names to sklearn/nirs4all classes
SPLITTER_CLASS_MAP: Dict[str, Tuple[str, str]] = {
    # sklearn splitters
    "kfold": ("sklearn.model_selection", "KFold"),
    "stratifiedkfold": ("sklearn.model_selection", "StratifiedKFold"),
    "groupkfold": ("sklearn.model_selection", "GroupKFold"),
    "shufflesplit": ("sklearn.model_selection", "ShuffleSplit"),
    "stratifiedshufflesplit": ("sklearn.model_selection", "StratifiedShuffleSplit"),
    "groupshufflesplit": ("sklearn.model_selection", "GroupShuffleSplit"),
    "leaveoneout": ("sklearn.model_selection", "LeaveOneOut"),
    "leavepgroupsout": ("sklearn.model_selection", "LeavePGroupsOut"),
    "timeseriessplit": ("sklearn.model_selection", "TimeSeriesSplit"),
    # nirs4all splitters
    "kennardstone": ("nirs4all.operators.splitters", "KennardStoneSplitter"),
    "kennardstonesplitter": ("nirs4all.operators.splitters", "KennardStoneSplitter"),
    "spxy": ("nirs4all.operators.splitters", "SPXYSplitter"),
    "spxysplitter": ("nirs4all.operators.splitters", "SPXYSplitter"),
    "spxygfold": ("nirs4all.operators.splitters", "SPXYGFold"),
    "kmeanssplitter": ("nirs4all.operators.splitters", "KMeansSplitter"),
    "binnedstratifiedgroupkfold": ("nirs4all.operators.splitters", "BinnedStratifiedGroupKFold"),
}

# sklearn scalers that need special import
SKLEARN_SCALERS = {
    "StandardScaler": ("sklearn.preprocessing", "StandardScaler"),
    "MinMaxScaler": ("sklearn.preprocessing", "MinMaxScaler"),
    "RobustScaler": ("sklearn.preprocessing", "RobustScaler"),
}


def resolve_operator(
    name: str,
    operator_type: str = "preprocessing"
) -> Optional[Type]:
    """Resolve an operator name to its class.

    Args:
        name: Operator name (case-insensitive)
        operator_type: Type of operator ("preprocessing" or "splitting")

    Returns:
        The operator class, or None if not found
    """
    if not NIRS4ALL_AVAILABLE:
        return None

    name_lower = name.lower().replace("_", "").replace("-", "")

    if operator_type == "splitting":
        # Try splitter class map
        if name_lower in SPLITTER_CLASS_MAP:
            module_path, class_name = SPLITTER_CLASS_MAP[name_lower]
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

        # Try nirs4all splitters
        if nirs_splitters:
            splitter_cls = getattr(nirs_splitters, name, None)
            if splitter_cls:
                return splitter_cls

        return None

    else:  # preprocessing
        # Try preprocessing class map
        if name_lower in PREPROCESSING_CLASS_MAP:
            resolved_name = PREPROCESSING_CLASS_MAP[name_lower]
        else:
            resolved_name = name

        # Check sklearn scalers first
        if resolved_name in SKLEARN_SCALERS:
            module_path, class_name = SKLEARN_SCALERS[resolved_name]
            try:
                module = importlib.import_module(module_path)
                return getattr(module, class_name, None)
            except ImportError:
                return None

        # Try nirs4all transforms
        if transforms:
            transformer_cls = getattr(transforms, resolved_name, None)
            if transformer_cls:
                return transformer_cls

        return None


def convert_frontend_step(frontend_step: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a frontend step format to nirs4all pipeline format.

    Frontend format:
        {
            "id": "step_123",
            "type": "preprocessing" | "splitting",
            "name": "StandardNormalVariate",
            "params": {"window_length": 11},
            "enabled": true
        }

    nirs4all format:
        {"preprocessing": "StandardNormalVariate", "window_length": 11}
        {"split": "KFold", "n_splits": 5}

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
    else:
        nirs4all_step = {"preprocessing": name}

    # Merge params into step
    nirs4all_step.update(params)

    return nirs4all_step


def instantiate_operator(
    name: str,
    params: Dict[str, Any],
    operator_type: str = "preprocessing"
) -> Optional[Any]:
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

    try:
        return operator_cls(**params)
    except TypeError as e:
        # Try without invalid params
        valid_params = get_valid_params(operator_cls, params)
        try:
            return operator_cls(**valid_params)
        except Exception as inner_e:
            raise ValueError(
                f"Failed to instantiate {name} with params {params}: {inner_e}"
            ) from inner_e


def get_valid_params(cls: Type, params: Dict[str, Any]) -> Dict[str, Any]:
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
    params: Dict[str, Any],
    operator_type: str = "preprocessing"
) -> Tuple[bool, List[str], List[str]]:
    """Validate parameters for an operator.

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

    # Get valid parameter names
    try:
        sig = inspect.signature(operator_cls.__init__)
        valid_params = set(sig.parameters.keys()) - {"self"}

        # Check for unknown parameters
        for param_name in params.keys():
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


def get_preprocessing_methods() -> List[Dict[str, Any]]:
    """Get list of available preprocessing methods with metadata.

    Returns:
        List of method info dicts with name, display_name, category, params
    """
    if not NIRS4ALL_AVAILABLE or transforms is None:
        return []

    methods = []

    # Scan nirs4all.operators.transforms
    for name in dir(transforms):
        if name.startswith("_"):
            continue

        obj = getattr(transforms, name)
        if not inspect.isclass(obj):
            continue

        # Check if it's a transformer
        if not hasattr(obj, "fit_transform"):
            continue

        # Extract method info
        method_info = _extract_method_info(obj, name, "preprocessing")
        if method_info:
            methods.append(method_info)

    # Add sklearn scalers
    for name, (module_path, class_name) in SKLEARN_SCALERS.items():
        try:
            module = importlib.import_module(module_path)
            obj = getattr(module, class_name)
            method_info = _extract_method_info(obj, name, "preprocessing")
            if method_info:
                method_info["source"] = "sklearn"
                methods.append(method_info)
        except ImportError:
            pass

    return methods


def get_splitter_methods() -> List[Dict[str, Any]]:
    """Get list of available splitter methods with metadata.

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

    # nirs4all splitters
    if nirs_splitters:
        nirs_splitter_names = [
            "KennardStoneSplitter", "SPXYSplitter", "SPXYGFold",
            "KMeansSplitter", "BinnedStratifiedGroupKFold",
        ]

        for name in nirs_splitter_names:
            obj = getattr(nirs_splitters, name, None)
            if obj:
                method_info = _extract_method_info(obj, name, "splitting")
                if method_info:
                    method_info["source"] = "nirs4all"
                    methods.append(method_info)

    return methods


def get_augmentation_methods() -> List[Dict[str, Any]]:
    """Get list of available augmentation methods with metadata.

    Augmentation methods generate synthetic variations of spectra for
    training data augmentation (noise, baseline drift, wavelength shifts, etc.)

    Returns:
        List of method info dicts with name, display_name, category, params
    """
    if not NIRS4ALL_AVAILABLE:
        return []

    methods = []

    # Scan augmentation modules
    augmentation_modules = [
        (augmentation_spectral, "spectral"),
        (augmentation_random, "random"),
    ]

    for module, source in augmentation_modules:
        if module is None:
            continue

        for name in dir(module):
            if name.startswith("_"):
                continue

            obj = getattr(module, name)
            if not inspect.isclass(obj):
                continue

            # Check if it's an augmenter (has augment or fit_transform method)
            if not (hasattr(obj, "augment") or hasattr(obj, "fit_transform")):
                continue

            # Skip base classes
            if name in ("Augmenter", "BaseEstimator", "TransformerMixin"):
                continue

            # Extract method info
            method_info = _extract_method_info(obj, name, "augmentation")
            if method_info:
                method_info["source"] = f"nirs4all.{source}"
                methods.append(method_info)

    return methods


def _extract_method_info(cls: Type, name: str, operator_type: str) -> Optional[Dict[str, Any]]:
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

        # Categorize
        category = _categorize_operator(name, operator_type)

        return {
            "name": name,
            "display_name": _to_display_name(name),
            "description": description,
            "category": category,
            "params": params,
            "type": operator_type,
        }
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
    import re

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
