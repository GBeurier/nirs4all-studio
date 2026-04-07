"""
Validate that all JSON-defined operators can be resolved, instantiated,
and executed with their default parameters.

This test catches mismatches between webapp JSON node definitions and actual
Python operator signatures (wrong param names, wrong types, missing classes, etc.).
Runs in seconds and covers all operators automatically — including future additions.
"""

import importlib
import inspect
import json
import sys
from pathlib import Path

import numpy as np
import pytest

# Ensure the webapp root is in the path
webapp_root = Path(__file__).parent.parent
if str(webapp_root) not in sys.path:
    sys.path.insert(0, str(webapp_root))

# Also ensure nirs4all library is importable
nirs4all_path = webapp_root.parent / "nirs4all"
if nirs4all_path.exists() and str(nirs4all_path) not in sys.path:
    sys.path.insert(0, str(nirs4all_path))

from api.shared.pipeline_service import get_valid_params, normalize_params  # noqa: E402

DEFINITIONS_DIR = webapp_root / "src" / "data" / "nodes" / "definitions"


def _import_class(class_path: str):
    """Import a class from its full dotted path (e.g. 'nirs4all.operators.transforms.SNV')."""
    parts = class_path.rsplit(".", 1)
    if len(parts) != 2:
        return None
    module_path, class_name = parts
    try:
        module = importlib.import_module(module_path)
        return getattr(module, class_name, None)
    except ImportError:
        return None


def _load_definitions(subdir: str) -> list[tuple[str, dict]]:
    """Load all JSON operator definitions from a subdirectory."""
    operators = []
    definitions_path = DEFINITIONS_DIR / subdir
    if not definitions_path.exists():
        return operators
    for json_file in sorted(definitions_path.glob("*.json")):
        with open(json_file, encoding="utf-8") as f:
            defs = json.load(f)
        for op_def in defs:
            operators.append((op_def.get("name", "unknown"), op_def))
    return operators


def _build_defaults(op_def: dict) -> dict:
    """Extract default parameters from a node definition."""
    defaults = {}
    for param in op_def.get("parameters", []):
        if param.get("default") is not None:
            defaults[param["name"]] = param["default"]
    return defaults


# Operators that require y for fit
REQUIRES_Y = {"OSC"}

# Operators that cannot be tested with simple fit_transform on random data
SKIP_FIT_TRANSFORM = {
    # EPO requires paired samples from different conditions
    "EPO",
    # Feature selection operators require y and specific data structure
    "VarianceThreshold",
    "SelectKBest", "SelectPercentile", "GenericUnivariateSelect",
    "SelectFwe", "SelectFpr", "SelectFdr",
    "SequentialFeatureSelector", "RFE", "RFECV", "SelectFromModel",
    # CARS/MCUVE/VIP require y and model-based selection
    "CARS", "MCUVE", "VIP",
    # Sklearn encoders that require specific input formats
    "OrdinalEncoder", "OneHotEncoder", "TargetEncoder",
    "KBinsDiscretizer",
    # Imputers need NaN data to be meaningful
    "SimpleImputer", "KNNImputer", "IterativeImputer", "MissingIndicator",
    # Clustering-based operators
    "KMeans", "MiniBatchKMeans", "DBSCAN", "AgglomerativeClustering",
    "SpectralClustering", "Birch", "BisectingKMeans",
    # Neighbors-based operators (graph transformers)
    "NearestNeighbors", "KNeighborsTransformer", "RadiusNeighborsTransformer",
    # Misc sklearn that need specific input
    "FunctionTransformer", "SplineTransformer",
    "BernoulliRBM", "RandomTreesEmbedding",
    # Dictionary learning needs specific data shapes
    "DictionaryLearning", "MiniBatchDictionaryLearning",
    # CropTransformer needs wavelengths context
    "CropTransformer",
    # Resampler requires target_wavelengths (no default)
    "Resampler",
    # PLSSVD requires y
    "PLSSVD",
    # TSNE perplexity must be < n_samples
    "TSNE",
}

# Operators whose classPath may not be directly importable but work via aliases
SKIP_RESOLVE = {
    "MovingAverage",  # alias to SavitzkyGolay (JSON now fixed, but legacyClassPath)
}

# Parameters that exist only in the UI and are transformed at runtime
# (e.g. n_points → target_wavelengths array when wavelength context is available)
UI_ONLY_PARAMS = {
    ("Resampler", "n_points"),
}


# ============================================================================
# Preprocessing operators
# ============================================================================

_preprocessing_ops = _load_definitions("preprocessing")


@pytest.mark.parametrize(
    "name,op_def",
    _preprocessing_ops,
    ids=[name for name, _ in _preprocessing_ops],
)
def test_preprocessing_resolve(name, op_def):
    """Each preprocessing operator's classPath must resolve to a Python class."""
    if name in SKIP_RESOLVE:
        pytest.skip(f"{name} uses alias resolution")

    class_path = op_def.get("classPath", "")
    cls = _import_class(class_path)
    assert cls is not None, (
        f"Cannot import operator '{name}' from classPath '{class_path}'"
    )


@pytest.mark.parametrize(
    "name,op_def",
    _preprocessing_ops,
    ids=[name for name, _ in _preprocessing_ops],
)
def test_preprocessing_instantiate_and_transform(name, op_def):
    """Each preprocessing operator must instantiate and fit_transform with defaults."""
    if name in SKIP_FIT_TRANSFORM:
        pytest.skip(f"{name} excluded from fit_transform test")

    class_path = op_def.get("classPath", "")
    cls = _import_class(class_path)
    if cls is None:
        pytest.skip(f"{name} not importable (covered by resolve test)")

    defaults = _build_defaults(op_def)
    defaults = normalize_params(name, defaults)
    valid = get_valid_params(cls, defaults)

    operator = cls(**valid)

    rng = np.random.RandomState(42)
    X = rng.rand(10, 50) + 1.0  # +1.0 ensures all-positive for log transforms

    if name in REQUIRES_Y:
        y = rng.rand(10) * 10
        result = operator.fit_transform(X, y)
    else:
        result = operator.fit_transform(X)

    assert result.shape[0] == X.shape[0], (
        f"{name}: output rows ({result.shape[0]}) != input rows ({X.shape[0]})"
    )


@pytest.mark.parametrize(
    "name,op_def",
    _preprocessing_ops,
    ids=[name for name, _ in _preprocessing_ops],
)
def test_preprocessing_params_accepted(name, op_def):
    """Each non-hidden parameter in JSON must be accepted by the operator constructor."""
    if name in SKIP_RESOLVE:
        pytest.skip(f"{name} uses alias resolution")

    class_path = op_def.get("classPath", "")
    cls = _import_class(class_path)
    if cls is None:
        pytest.skip(f"{name} not importable")

    try:
        sig = inspect.signature(cls.__init__)
    except (ValueError, TypeError):
        pytest.skip(f"{name} signature not inspectable")

    valid_param_names = set(sig.parameters.keys()) - {"self"}
    has_kwargs = any(
        p.kind == inspect.Parameter.VAR_KEYWORD
        for p in sig.parameters.values()
    )

    if has_kwargs:
        pytest.skip(f"{name} accepts **kwargs")

    # Build raw defaults and normalize them (applies rename mappings like n_pls_components → n_components)
    raw_params = _build_defaults(op_def)
    normalized = normalize_params(name, raw_params)
    normalized_names = set(normalized.keys())

    for param in op_def.get("parameters", []):
        param_name = param["name"]
        if param.get("isHidden"):
            continue
        # Skip UI-only params that are transformed at runtime
        if (name, param_name) in UI_ONLY_PARAMS:
            continue
        # Use normalized name if the param was renamed by normalize_params
        effective_name = param_name
        if param_name not in normalized_names:
            # Check if normalize_params renamed this param
            renamed = normalized_names - {p["name"] for p in op_def.get("parameters", [])}
            if len(renamed) == 1:
                effective_name = next(iter(renamed))
        # After normalization, _min/_max pairs become tuple params
        if effective_name.endswith("_min") or effective_name.endswith("_max"):
            base = effective_name[:-4]
            assert base in valid_param_names or effective_name in valid_param_names, (
                f"{name}: param '{param_name}' (or base '{base}') not accepted by constructor. "
                f"Valid params: {sorted(valid_param_names)}"
            )
        else:
            assert effective_name in valid_param_names, (
                f"{name}: param '{param_name}' (normalized to '{effective_name}') not accepted by constructor. "
                f"Valid params: {sorted(valid_param_names)}"
            )


# ============================================================================
# Augmentation operators
# ============================================================================

_augmentation_ops = _load_definitions("augmentation")


@pytest.mark.parametrize(
    "name,op_def",
    _augmentation_ops,
    ids=[name for name, _ in _augmentation_ops],
)
def test_augmentation_resolve(name, op_def):
    """Each augmentation operator's classPath must resolve to a Python class."""
    class_path = op_def.get("classPath", "")
    cls = _import_class(class_path)
    assert cls is not None, (
        f"Cannot import augmentation operator '{name}' from '{class_path}'"
    )


@pytest.mark.parametrize(
    "name,op_def",
    _augmentation_ops,
    ids=[name for name, _ in _augmentation_ops],
)
def test_augmentation_instantiate_and_transform(name, op_def):
    """Each augmentation operator must instantiate and fit_transform with defaults."""
    class_path = op_def.get("classPath", "")
    cls = _import_class(class_path)
    if cls is None:
        pytest.skip(f"{name} not importable")

    defaults = _build_defaults(op_def)
    defaults = normalize_params(name, defaults)
    valid = get_valid_params(cls, defaults)

    operator = cls(**valid)

    rng = np.random.RandomState(42)
    n_features = 50
    X = rng.rand(10, n_features) + 1.0
    wavelengths = np.linspace(1000, 2500, n_features)

    # Some augmenters require wavelengths (SpectraTransformerMixin)
    requires_wl = getattr(cls, "_requires_wavelengths", False)
    if requires_wl is True or requires_wl == "optional":
        result = operator.fit_transform(X, wavelengths=wavelengths)
    else:
        result = operator.fit_transform(X)

    assert result.shape[0] == X.shape[0], (
        f"{name}: output rows ({result.shape[0]}) != input rows ({X.shape[0]})"
    )


# ============================================================================
# Filter operators
# ============================================================================

_filter_ops = _load_definitions("filters")

# Filters that need metadata or specific data patterns
SKIP_FILTER = {"MetadataFilter"}


@pytest.mark.parametrize(
    "name,op_def",
    _filter_ops,
    ids=[name for name, _ in _filter_ops],
)
def test_filter_resolve(name, op_def):
    """Each filter operator's classPath must resolve to a Python class."""
    class_path = op_def.get("classPath", "")
    cls = _import_class(class_path)
    assert cls is not None, f"Cannot import filter '{name}' from '{class_path}'"


@pytest.mark.parametrize(
    "name,op_def",
    _filter_ops,
    ids=[name for name, _ in _filter_ops],
)
def test_filter_instantiate(name, op_def):
    """Each filter operator must instantiate with default params."""
    if name in SKIP_FILTER:
        pytest.skip(f"{name} needs metadata")

    class_path = op_def.get("classPath", "")
    cls = _import_class(class_path)
    if cls is None:
        pytest.skip(f"{name} not importable")

    defaults = _build_defaults(op_def)
    defaults = normalize_params(name, defaults)
    valid = get_valid_params(cls, defaults)

    operator = cls(**valid)
    assert operator is not None


# ============================================================================
# Splitter operators
# ============================================================================

_splitter_ops = _load_definitions("splitting")

SKIP_SPLITTER = {
    "GroupKFold", "GroupShuffleSplit", "LeavePGroupsOut",
    "LeaveOneGroupOut", "StratifiedGroupKFold",
    # Require positional args with no defaults
    "LeavePOut", "PredefinedSplit",
}


@pytest.mark.parametrize(
    "name,op_def",
    _splitter_ops,
    ids=[name for name, _ in _splitter_ops],
)
def test_splitter_resolve(name, op_def):
    """Each splitter operator's classPath must resolve to a Python class."""
    class_path = op_def.get("classPath", "")
    cls = _import_class(class_path)
    assert cls is not None, f"Cannot import splitter '{name}' from '{class_path}'"


@pytest.mark.parametrize(
    "name,op_def",
    _splitter_ops,
    ids=[name for name, _ in _splitter_ops],
)
def test_splitter_instantiate(name, op_def):
    """Each splitter operator must instantiate with default params."""
    if name in SKIP_SPLITTER:
        pytest.skip(f"{name} requires group info")

    class_path = op_def.get("classPath", "")
    cls = _import_class(class_path)
    if cls is None:
        pytest.skip(f"{name} not importable")

    defaults = _build_defaults(op_def)
    defaults = normalize_params(name, defaults)
    valid = get_valid_params(cls, defaults)

    operator = cls(**valid)
    assert operator is not None
