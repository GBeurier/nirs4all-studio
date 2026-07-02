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

# Also ensure nirs4all library is importable from normal and RC worktree layouts.
for nirs4all_path in (
    webapp_root.parent / "nirs4all",
    webapp_root.parent / "RC-v1-nirs4all-python",
    webapp_root.parent.parent / "nirs4all",
):
    if nirs4all_path.exists():
        if str(nirs4all_path) not in sys.path:
            sys.path.insert(0, str(nirs4all_path))
        break

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


# Operators that require y for fit.
REQUIRES_Y = {
    "OSC",
    "CARS",
    "MCUVE",
    "PLSSVD",
    "TargetEncoder",
    "GenericUnivariateSelect",
    "RFE",
    "RFECV",
    "SelectFdr",
    "SelectFpr",
    "SelectFromModel",
    "SelectFwe",
    "SelectKBest",
    "SelectPercentile",
    "SequentialFeatureSelector",
}

CATEGORICAL_INPUT_OPS = {"OneHotEncoder", "OrdinalEncoder", "TargetEncoder"}
NAN_INPUT_OPS = {"KNNImputer", "MissingIndicator", "SimpleImputer"}

# Per-operator execution fixtures keep slow or context-sensitive operators
# deterministic while still proving that JSON-defined operators run end-to-end.
FIT_TRANSFORM_PARAM_OVERRIDES = {
    "Resampler": {"target_wavelengths": np.linspace(1050, 2450, 25)},
    "CARS": {"n_components": 2, "n_sampling_runs": 3, "cv_folds": 2, "random_state": 42},
    "MCUVE": {"n_components": 2, "n_iterations": 3, "random_state": 42},
    "TSNE": {"perplexity": 5, "max_iter": 250, "random_state": 42, "init": "random"},
    "BernoulliRBM": {"n_components": 8, "n_iter": 2, "random_state": 42},
    "RandomTreesEmbedding": {"n_estimators": 5, "random_state": 42},
    "DictionaryLearning": {"n_components": 5, "max_iter": 20, "random_state": 42},
    "MiniBatchDictionaryLearning": {"n_components": 5, "max_iter": 20, "batch_size": 10, "random_state": 42},
    "KMeans": {"random_state": 42},
    "MiniBatchKMeans": {"random_state": 42},
    "BisectingKMeans": {"random_state": 42},
    "RFE": {"n_features_to_select": 5},
    "RFECV": {"cv": 2},
    "SequentialFeatureSelector": {"cv": 2, "n_features_to_select": 5},
    # The node definition uses sklearn's legacy "warn" sentinel; fit needs a concrete method.
    "KBinsDiscretizer": {"quantile_method": "averaged_inverted_cdf"},
}

FILTER_PARAM_OVERRIDES = {
    "MetadataFilter": {"column": "sample_type", "values_to_keep": ["calibration"]},
}

SPLITTER_PARAM_OVERRIDES = {
    "PredefinedSplit": {"test_fold": [0, 0, -1, 1, 1, -1]},
}

# Parameters that exist only in the UI and are transformed at runtime
# (e.g. n_points → target_wavelengths array when wavelength context is available)
UI_ONLY_PARAMS = {
    ("Resampler", "n_points"),
}


def _build_fit_transform_fixture(name: str) -> tuple[np.ndarray, np.ndarray | None, dict]:
    """Return representative X, optional y, and fit kwargs for an operator."""
    rng = np.random.RandomState(42)

    if name in CATEGORICAL_INPUT_OPS:
        X = np.array(
            [
                ["a", "x"],
                ["b", "x"],
                ["a", "y"],
                ["c", "y"],
                ["b", "z"],
                ["c", "z"],
                ["a", "x"],
                ["b", "y"],
                ["c", "z"],
                ["a", "z"],
            ],
            dtype=object,
        )
        y = np.array([0, 1, 0, 1, 1, 0, 0, 1, 0, 1])
        return X, y, {}

    if name in NAN_INPUT_OPS:
        X = rng.rand(12, 6)
        X[0, 0] = np.nan
        X[2, 3] = np.nan
        X[5, 1] = np.nan
        return X, None, {}

    n_samples = 40 if name == "TSNE" else 30
    X = rng.rand(n_samples, 50) + 1.0
    y = np.arange(n_samples) % 2
    X[:, 0] = y + 1.0 + rng.normal(scale=0.01, size=n_samples)

    fit_kwargs = {}
    if name == "Resampler":
        fit_kwargs["wavelengths"] = np.linspace(1000, 2500, X.shape[1])

    return X, y, fit_kwargs


def _assert_result_rows_match_input(name: str, result, n_rows: int) -> None:
    """Check row preservation for arrays, sparse matrices, and tuple results."""
    results = result if isinstance(result, tuple) else (result,)
    assert results, f"{name}: fit_transform returned an empty tuple"
    for item in results:
        assert hasattr(item, "shape"), f"{name}: fit_transform returned item without shape: {type(item)!r}"
        assert item.shape[0] == n_rows, (
            f"{name}: output rows ({item.shape[0]}) != input rows ({n_rows})"
        )


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
    """Each preprocessing operator must instantiate and fit_transform."""
    class_path = op_def.get("classPath", "")
    cls = _import_class(class_path)
    if cls is None:
        pytest.skip(f"{name} not importable (covered by resolve test)")

    defaults = _build_defaults(op_def)
    defaults = normalize_params(name, defaults)
    defaults.update(FIT_TRANSFORM_PARAM_OVERRIDES.get(name, {}))
    valid = get_valid_params(cls, defaults)

    operator = cls(**valid)

    X, y, fit_kwargs = _build_fit_transform_fixture(name)

    if name in REQUIRES_Y:
        result = operator.fit_transform(X, y, **fit_kwargs)
    else:
        result = operator.fit_transform(X, **fit_kwargs)

    _assert_result_rows_match_input(name, result, X.shape[0])


@pytest.mark.parametrize(
    "name,op_def",
    _preprocessing_ops,
    ids=[name for name, _ in _preprocessing_ops],
)
def test_preprocessing_params_accepted(name, op_def):
    """Each non-hidden parameter in JSON must be accepted by the operator constructor."""
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

    # Build raw defaults and normalize them (applies rename mappings like n_pls_components → n_components)
    raw_params = _build_defaults(op_def)
    normalized = normalize_params(name, raw_params)
    normalized_names = set(normalized.keys())

    visible_params = [
        param
        for param in op_def.get("parameters", [])
        if not param.get("isHidden") and (name, param["name"]) not in UI_ONLY_PARAMS
    ]
    if has_kwargs:
        operator = cls(**normalized)
        assert operator is not None
        return

    for param in visible_params:
        param_name = param["name"]
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
    class_path = op_def.get("classPath", "")
    cls = _import_class(class_path)
    if cls is None:
        pytest.skip(f"{name} not importable")

    defaults = _build_defaults(op_def)
    defaults = normalize_params(name, defaults)
    defaults.update(FILTER_PARAM_OVERRIDES.get(name, {}))
    valid = get_valid_params(cls, defaults)

    operator = cls(**valid)
    assert operator is not None


# ============================================================================
# Splitter operators
# ============================================================================

_splitter_ops = _load_definitions("splitting")


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
    class_path = op_def.get("classPath", "")
    cls = _import_class(class_path)
    if cls is None:
        pytest.skip(f"{name} not importable")

    defaults = _build_defaults(op_def)
    defaults = normalize_params(name, defaults)
    defaults.update(SPLITTER_PARAM_OVERRIDES.get(name, {}))
    valid = get_valid_params(cls, defaults)

    operator = cls(**valid)
    assert operator is not None
