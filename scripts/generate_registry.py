#!/usr/bin/env python3
"""Generate the canonical node registry JSON by auto-discovering all operators.

This script replaces the old generate_extended_registry.py with a fully
auto-discovery-based approach:

1. Walks nirs4all.operators.* packages to discover ALL operator classes
2. Extracts parameters from inspect.signature() + type hints
3. Reads _webapp_meta class attribute (category, tier, tags) added in Phase 2
4. Applies UI overlays from src/data/nodes/ui-overlays.json (sweep presets,
   finetune ranges, display order, long descriptions)
5. Also discovers sklearn models, scalers, and splitters
6. Outputs a single canonical JSON: src/data/nodes/generated/canonical-registry.json
7. Validates the output (required fields, no duplicate IDs)

Usage:
  python scripts/generate_registry.py
  python scripts/generate_registry.py --out src/data/nodes/generated/canonical-registry.json
  python scripts/generate_registry.py --validate --skip-tensorflow
"""

from __future__ import annotations

import argparse
import importlib
import inspect
import json
import math
import pkgutil
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple, get_args, get_origin


# ============================================================================
# Utilities
# ============================================================================


def snake_case(name: str) -> str:
    """Convert CamelCase or PascalCase to snake_case."""
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\g<1>_\g<2>", name)
    s2 = re.sub(r"([a-z0-9])([A-Z])", r"\g<1>_\g<2>", s1)
    s2 = s2.lower()
    return re.sub(r"[^a-z0-9_]+", "_", s2).strip("_")


def safe_first_line(doc: Optional[str]) -> str:
    """Get the first non-empty line of a docstring."""
    if not doc:
        return ""
    line = doc.strip().splitlines()[0].strip()
    return line[:200]


def module_prefix(module: str) -> str:
    """Get the top two segments of a module path."""
    parts = module.split(".")
    return ".".join(parts[:2]) if len(parts) >= 2 else module


def jsonable_default(value: Any) -> Tuple[bool, Any]:
    """Check if a value can be serialized to JSON and return sanitized version."""
    if value is inspect._empty:
        return False, None
    if isinstance(value, bool):
        return True, value
    if isinstance(value, int):
        return True, value
    if isinstance(value, float):
        if not math.isfinite(value):
            return False, None
        return True, value
    if isinstance(value, str) or value is None:
        return True, value
    if isinstance(value, (list, tuple)):
        sanitized = []
        for v in value:
            ok, sv = jsonable_default(v)
            if ok:
                sanitized.append(sv)
            else:
                return False, None
        return True, sanitized
    if isinstance(value, dict):
        sanitized = {}
        for k, v in value.items():
            ok, sv = jsonable_default(v)
            if ok:
                sanitized[str(k)] = sv
            else:
                return False, None
        return True, sanitized
    # Try numpy types
    try:
        import numpy as np
        if isinstance(value, np.generic):
            return jsonable_default(value.item())
        if isinstance(value, np.ndarray):
            return jsonable_default(value.tolist())
    except ImportError:
        pass
    # Non-serializable
    try:
        json.dumps(value, allow_nan=False)
        return True, value
    except Exception:
        return False, None


def is_internal_class(name: str, cls: type) -> bool:
    """Check if a class is internal and should be skipped."""
    if name.startswith("_"):
        return True
    if inspect.isabstract(cls):
        return True
    # Skip base classes without _webapp_meta
    if name in {"SampleFilter", "CompositeFilter", "CustomSplitter", "BaseEstimator",
                "TransformerMixin", "SpectraTransformerMixin", "RegressorMixin",
                "ClassifierMixin", "BaseAugmenter", "FilteringReport",
                "FilteringReportGenerator", "FilterResult", "GroupedSplitterWrapper"}:
        return True
    return False


# ============================================================================
# Type Inference
# ============================================================================


def infer_param_type_from_annotation(annotation: Any, default: Any) -> str:
    """Infer parameter type from type annotation and default value."""
    if annotation is not inspect._empty and annotation is not None:
        origin = get_origin(annotation)
        args = get_args(annotation)

        # Handle Optional[X] -> unwrap to X
        if origin is type(None):
            return "string"

        # typing.Union with None (Optional)
        if origin is not None:
            type_name = getattr(origin, "__name__", str(origin))
            if type_name == "Union" and type(None) in args:
                non_none = [a for a in args if a is not type(None)]
                if non_none:
                    return infer_param_type_from_annotation(non_none[0], default)

        # typing.Literal -> select
        if hasattr(annotation, "__origin__") and str(annotation.__origin__) == "typing.Literal":
            return "select"

        # Direct type checks
        if annotation is bool:
            return "bool"
        if annotation is int:
            return "int"
        if annotation is float:
            return "float"
        if annotation is str:
            return "string"
        if annotation in (list, tuple) or (origin in (list, tuple)):
            return "array"
        if annotation is dict or origin is dict:
            return "object"

    # Fall back to default value inference
    return _infer_from_default(default)


def _infer_from_default(default: Any) -> str:
    """Infer parameter type from default value."""
    if default is inspect._empty or default is None:
        return "string"
    if isinstance(default, bool):
        return "bool"
    if isinstance(default, int) and not isinstance(default, bool):
        return "int"
    if isinstance(default, float):
        return "float"
    if isinstance(default, str):
        return "string"
    if isinstance(default, (list, tuple)):
        return "array"
    if isinstance(default, dict):
        return "object"
    return "string"


def extract_literal_options(annotation: Any) -> Optional[List[Dict[str, Any]]]:
    """Extract options from a Literal type annotation."""
    if annotation is inspect._empty or annotation is None:
        return None
    if hasattr(annotation, "__origin__") and str(annotation.__origin__) == "typing.Literal":
        args = get_args(annotation)
        if args:
            return [{"value": v, "label": str(v)} for v in args]
    return None


def should_split_tuple_param(annotation: Any, name: str, default: Any) -> bool:
    """Check if a Tuple[float, float] parameter should be split into min/max."""
    if annotation is inspect._empty or annotation is None:
        return False
    origin = get_origin(annotation)
    args = get_args(annotation)
    if origin is tuple and args:
        if len(args) == 2 and all(a in (int, float) for a in args):
            return True
    # Also check default value pattern
    if isinstance(default, (tuple, list)) and len(default) == 2:
        if all(isinstance(v, (int, float)) for v in default):
            # Heuristic: name suggests it's a range
            if any(hint in name for hint in ("range", "bounds", "limits", "interval")):
                return True
    return False


# ============================================================================
# Parameter Extraction
# ============================================================================


def build_parameters(cls: type) -> List[Dict[str, Any]]:
    """Extract parameters from a class's __init__ signature with type hints."""
    params: List[Dict[str, Any]] = []

    try:
        sig = inspect.signature(cls.__init__)
    except Exception:
        return params

    # Get type hints if available
    try:
        hints = getattr(cls.__init__, "__annotations__", {})
    except Exception:
        hints = {}

    for name, p in sig.parameters.items():
        if name in {"self", "cls"}:
            continue
        if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue

        annotation = hints.get(name, p.annotation)
        has_default, default_value = jsonable_default(p.default)

        # Check for Tuple splitting
        if should_split_tuple_param(annotation, name, p.default if p.default is not inspect._empty else None):
            default_val = p.default if p.default is not inspect._empty else (0, 0)
            elem_type = "float"
            args = get_args(annotation) if annotation is not inspect._empty else None
            if args and args[0] is int:
                elem_type = "int"
            for suffix, idx in [("_min", 0), ("_max", 1)]:
                entry: Dict[str, Any] = {
                    "name": f"{name}{suffix}",
                    "type": elem_type,
                    "isAdvanced": True,
                }
                try:
                    dv = default_val[idx]
                    ok, sv = jsonable_default(dv)
                    if ok:
                        entry["default"] = sv
                except (IndexError, TypeError):
                    pass
                params.append(entry)
            continue

        # Normal parameter
        param_type = infer_param_type_from_annotation(annotation, p.default)

        entry: Dict[str, Any] = {
            "name": name,
            "type": param_type,
            "isAdvanced": True,
        }

        if has_default:
            entry["default"] = default_value

        if p.default is inspect._empty:
            entry["required"] = True

        # Extract Literal options
        options = extract_literal_options(annotation)
        if options:
            entry["type"] = "select"
            entry["options"] = options

        params.append(entry)

    return params


def build_function_parameters(func) -> List[Dict[str, Any]]:
    """Extract parameters from a function's signature."""
    params: List[Dict[str, Any]] = []
    try:
        sig = inspect.signature(func)
    except Exception:
        return params

    hints = getattr(func, "__annotations__", {})

    for pname, p in sig.parameters.items():
        if pname in {"self", "cls"}:
            continue
        if p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
            continue

        annotation = hints.get(pname, p.annotation)
        has_default, default_value = jsonable_default(p.default)
        param_type = infer_param_type_from_annotation(annotation, p.default)

        entry: Dict[str, Any] = {
            "name": pname,
            "type": param_type,
            "isAdvanced": True,
        }
        if has_default:
            entry["default"] = default_value
        if p.default is inspect._empty:
            entry["required"] = True

        options = extract_literal_options(annotation)
        if options:
            entry["type"] = "select"
            entry["options"] = options

        params.append(entry)

    return params


# ============================================================================
# Alias Maps (from nirs4all_adapter.py)
# ============================================================================

# Forward aliases: short name -> class name
PREPROCESSING_ALIASES = {
    "SNV": "StandardNormalVariate",
    "MSC": "MultiplicativeScatterCorrection",
    "EMSC": "ExtendedMultiplicativeScatterCorrection",
    "SG": "SavitzkyGolay",
    "RNV": "RobustStandardNormalVariate",
}

SPLITTER_ALIASES = {
    "KennardStone": "KennardStoneSplitter",
    "SPXY": "SPXYSplitter",
}

MODEL_ALIASES = {
    "RandomForest": "RandomForestRegressor",
    "PLS": "PLSRegression",
}

# Reverse aliases: class name -> list of aliases
def build_reverse_aliases() -> Dict[str, List[str]]:
    """Build reverse alias map: class_name -> [alias1, alias2, ...]."""
    reverse: Dict[str, List[str]] = {}
    for alias_map in (PREPROCESSING_ALIASES, SPLITTER_ALIASES, MODEL_ALIASES):
        for alias, class_name in alias_map.items():
            reverse.setdefault(class_name, []).append(alias)
    return reverse

REVERSE_ALIASES = build_reverse_aliases()


# ============================================================================
# Subcategory Mappings for sklearn
# ============================================================================

TRANSFORMER_SUBCATEGORY_MAP = {
    "sklearn.preprocessing": "scikit-scalers",
    "sklearn.impute": "scikit-imputation",
    "sklearn.decomposition": "scikit-dimensionality",
    "sklearn.manifold": "scikit-dimensionality",
    "sklearn.cross_decomposition": "scikit-dimensionality",
    "sklearn.feature_selection": "scikit-feature-selection",
    "sklearn.kernel_approximation": "scikit-kernel-projection",
    "sklearn.random_projection": "scikit-kernel-projection",
    "sklearn.feature_extraction": "scikit-feature-extraction",
    "sklearn.cluster": "scikit-cluster-neighbors",
    "sklearn.neighbors": "scikit-cluster-neighbors",
    "sklearn.compose": "scikit-meta-transformers",
    "sklearn.pipeline": "scikit-meta-transformers",
}

MODEL_SUBCATEGORY_MAP = {
    "sklearn.linear_model": "sklearn-linear",
    "sklearn.svm": "sklearn-svm",
    "sklearn.tree": "sklearn-tree",
    "sklearn.ensemble": "sklearn-ensemble",
    "sklearn.neighbors": "sklearn-neighbors",
    "sklearn.naive_bayes": "sklearn-naive-bayes",
    "sklearn.discriminant_analysis": "sklearn-discriminant",
    "sklearn.gaussian_process": "sklearn-gaussian-process",
    "sklearn.kernel_ridge": "sklearn-kernel",
    "sklearn.neural_network": "sklearn-neural",
    "sklearn.calibration": "sklearn-probabilistic",
    "sklearn.isotonic": "sklearn-probabilistic",
    "sklearn.cross_decomposition": "sklearn-cross-decomposition",
    "sklearn.multiclass": "sklearn-meta",
    "sklearn.multioutput": "sklearn-meta",
    "sklearn.semi_supervised": "sklearn-semi-supervised",
    "sklearn.dummy": "sklearn-baseline",
}

# sklearn scalers that should be y_processing nodes
Y_PROCESSING_SCALERS = {
    "StandardScaler", "MinMaxScaler", "RobustScaler", "MaxAbsScaler",
    "PowerTransformer", "QuantileTransformer",
}


def get_transformer_subcategory(module: str) -> str:
    pref = module_prefix(module)
    if pref == "sklearn.preprocessing":
        if "_encod" in module or "_label" in module or "_discretization" in module:
            return "scikit-encoding"
        return "scikit-scalers"
    return TRANSFORMER_SUBCATEGORY_MAP.get(pref, "scikit-misc-transformers")


def get_model_subcategory(module: str) -> str:
    pref = module_prefix(module)
    if "classification_threshold" in module:
        return "sklearn-probabilistic"
    return MODEL_SUBCATEGORY_MAP.get(pref, "sklearn-misc-models")


# ============================================================================
# nirs4all Operator Auto-Discovery
# ============================================================================


def _walk_package_classes(package_name: str) -> List[Tuple[str, type]]:
    """Recursively discover all classes in a package."""
    results: List[Tuple[str, type]] = []
    try:
        pkg = importlib.import_module(package_name)
    except ImportError as e:
        print(f"[WARN] Cannot import {package_name}: {e}", file=sys.stderr)
        return results

    # Get classes directly from the package's __init__
    for name in dir(pkg):
        obj = getattr(pkg, name)
        if isinstance(obj, type) and not is_internal_class(name, obj):
            # Check that the class actually belongs to this package
            obj_module = getattr(obj, "__module__", "")
            if obj_module.startswith(package_name) or package_name.startswith("nirs4all.operators"):
                results.append((name, obj))

    # Walk submodules
    pkg_path = getattr(pkg, "__path__", None)
    if pkg_path:
        for _importer, modname, _ispkg in pkgutil.walk_packages(pkg_path, prefix=package_name + "."):
            # Skip legacy, test, and internal modules
            if ".legacy." in modname or ".test" in modname or ".__" in modname:
                continue
            try:
                mod = importlib.import_module(modname)
            except ImportError:
                continue
            for name in dir(mod):
                obj = getattr(mod, name)
                if isinstance(obj, type) and not is_internal_class(name, obj):
                    obj_module = getattr(obj, "__module__", "")
                    if obj_module == modname:
                        results.append((name, obj))

    return results


def _determine_node_type(cls: type, package_path: str) -> Optional[str]:
    """Determine the NodeType for a class based on inheritance and package path."""
    cls_module = getattr(cls, "__module__", "")

    # Filters
    if "operators.filters" in cls_module or "operators.filters" in package_path:
        # Check for SampleFilter base
        try:
            from nirs4all.operators.filters.base import SampleFilter
            if issubclass(cls, SampleFilter):
                return "filter"
        except ImportError:
            pass
        return "filter"

    # Augmentation
    if "operators.augmentation" in cls_module or "operators.augmentation" in package_path:
        return "augmentation"

    # Splitters
    if "operators.splitters" in cls_module or "operators.splitters" in package_path:
        return "splitting"

    # Models (nirs4all sklearn models like PLSDA, OPLS, etc.)
    if "operators.models" in cls_module or "operators.models" in package_path:
        if hasattr(cls, "fit") and hasattr(cls, "predict"):
            return "model"
        return "model"

    # Target transforms
    if "operators.transforms.targets" in cls_module:
        return "y_processing"

    # Transforms (preprocessing)
    if "operators.transforms" in cls_module or "operators.transforms" in package_path:
        return "preprocessing"

    return None


def _get_class_path(cls: type) -> str:
    """Get the full import path for a class."""
    module = getattr(cls, "__module__", "")
    return f"{module}.{cls.__name__}"


def discover_nirs4all_operators() -> List[Dict[str, Any]]:
    """Auto-discover ALL nirs4all operators from the operators packages."""
    nodes: List[Dict[str, Any]] = []
    seen_classpaths: Set[str] = set()

    packages_to_scan = [
        ("nirs4all.operators.transforms", "preprocessing"),
        ("nirs4all.operators.filters", "filter"),
        ("nirs4all.operators.augmentation", "augmentation"),
        ("nirs4all.operators.splitters", "splitting"),
        ("nirs4all.operators.models.sklearn", "model"),
        ("nirs4all.operators.models.meta", "model"),
    ]

    for package_name, default_type in packages_to_scan:
        classes = _walk_package_classes(package_name)
        for name, cls in classes:
            class_path = _get_class_path(cls)

            # Skip duplicates
            if class_path in seen_classpaths:
                continue
            seen_classpaths.add(class_path)

            # Determine node type
            node_type = _determine_node_type(cls, package_name) or default_type

            # Read _webapp_meta
            meta = getattr(cls, "_webapp_meta", None)
            if meta is None:
                # Skip classes without _webapp_meta (internal classes)
                continue

            category = meta.get("category", "uncategorized")
            tier = meta.get("tier", "standard")
            tags = meta.get("tags", [])

            # Build slug for ID
            slug = snake_case(name)
            node_id = f"{node_type}.{slug}"

            # Description from docstring
            description = safe_first_line(getattr(cls, "__doc__", None))
            if not description:
                description = f"nirs4all {node_type} {name}"

            # Parameters
            params = build_parameters(cls)

            # Aliases
            aliases = REVERSE_ALIASES.get(name, [])

            node: Dict[str, Any] = {
                "id": node_id,
                "name": name,
                "type": node_type,
                "classPath": class_path,
                "description": description,
                "parameters": params,
                "source": "nirs4all",
                "category": category,
                "tier": tier,
                "tags": tags,
            }

            if aliases:
                node["aliases"] = aliases

            # Tier-based isAdvanced flag
            if tier in ("advanced", "experimental"):
                node["isAdvanced"] = True

            nodes.append(node)

    return nodes


# ============================================================================
# TensorFlow Model Discovery (function-based)
# ============================================================================


def discover_tensorflow_models(skip: bool = False) -> List[Dict[str, Any]]:
    """Discover nirs4all TensorFlow model functions."""
    if skip:
        print("[WARN] Skipping TensorFlow models (--skip-tensorflow)", file=sys.stderr)
        return []

    nodes: List[Dict[str, Any]] = []
    try:
        import os
        os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

        generic_mod = importlib.import_module("nirs4all.operators.models.tensorflow.generic")
        nicon_mod = importlib.import_module("nirs4all.operators.models.tensorflow.nicon")

        for module in (generic_mod, nicon_mod):
            for name, obj in inspect.getmembers(module, inspect.isfunction):
                if name.startswith("_") or name in {"framework", "Input"}:
                    continue
                if hasattr(obj, "__module__") and obj.__module__ != module.__name__:
                    continue

                fw = getattr(obj, "framework", None)
                if fw is None:
                    wrapped = getattr(obj, "__wrapped__", None)
                    if wrapped:
                        fw = getattr(wrapped, "framework", None)
                if fw != "tensorflow":
                    continue

                slug = snake_case(name)
                func_path = f"{obj.__module__}.{name}"
                description = safe_first_line(obj.__doc__) or f"TensorFlow model {name}"
                params = build_function_parameters(obj)

                nodes.append({
                    "id": f"model.tf_{slug}",
                    "name": name,
                    "type": "model",
                    "description": description,
                    "parameters": params,
                    "source": "nirs4all",
                    "functionPath": func_path,
                    "category": "tensorflow-models",
                    "tier": "standard",
                    "tags": ["nirs4all", "tensorflow", "deep-learning"],
                    "isDeepLearning": True,
                })

    except ImportError as e:
        print(f"[WARN] nirs4all TensorFlow models not available: {e}", file=sys.stderr)

    return nodes


# ============================================================================
# sklearn Node Generation
# ============================================================================


def generate_sklearn_transformers() -> List[Dict[str, Any]]:
    """Generate nodes for all sklearn transformers."""
    try:
        from sklearn.utils import all_estimators
    except ImportError:
        print("[WARN] sklearn not available, skipping transformers", file=sys.stderr)
        return []

    nodes: List[Dict[str, Any]] = []
    seen: Set[str] = set()

    for name, cls in all_estimators(type_filter="transformer"):
        slug = snake_case(name)
        if not slug or slug in seen:
            continue
        seen.add(slug)

        module = getattr(cls, "__module__", "")
        class_path = f"{module}.{name}" if module else None
        category = get_transformer_subcategory(module)
        description = safe_first_line(getattr(cls, "__doc__", None))
        if not description:
            description = f"sklearn transformer {name}"

        node: Dict[str, Any] = {
            "id": f"preprocessing.{slug}",
            "name": name,
            "type": "preprocessing",
            "description": description,
            "parameters": build_parameters(cls),
            "source": "sklearn",
            "classPath": class_path,
            "category": category,
            "tags": ["sklearn", "transformer"] + module.split(".")[1:3],
            "isAdvanced": True,
        }

        nodes.append(node)

    return nodes


def generate_sklearn_y_processing() -> List[Dict[str, Any]]:
    """Generate y_processing nodes for sklearn scalers."""
    try:
        import sklearn.preprocessing as skp
    except ImportError:
        return []

    nodes: List[Dict[str, Any]] = []

    for name in Y_PROCESSING_SCALERS:
        cls = getattr(skp, name, None)
        if cls is None:
            continue

        slug = snake_case(name)
        module = getattr(cls, "__module__", "sklearn.preprocessing")
        class_path = f"{module}.{name}"
        description = safe_first_line(getattr(cls, "__doc__", None))
        if not description:
            description = f"sklearn scaler {name}"

        nodes.append({
            "id": f"y_processing.{slug}",
            "name": name,
            "type": "y_processing",
            "description": description,
            "parameters": build_parameters(cls),
            "source": "sklearn",
            "classPath": class_path,
            "category": "target-transforms",
            "tags": ["sklearn", "scaler", "y_processing"],
        })

    return nodes


def generate_sklearn_models() -> List[Dict[str, Any]]:
    """Generate nodes for all sklearn classifiers and regressors."""
    try:
        from sklearn.utils import all_estimators
    except ImportError:
        print("[WARN] sklearn not available, skipping models", file=sys.stderr)
        return []

    info: Dict[str, Dict[str, Any]] = {}
    for est_type in ("classifier", "regressor"):
        for name, cls in all_estimators(type_filter=est_type):
            entry = info.setdefault(name, {"cls": cls, "types": set()})
            entry["types"].add(est_type)

    nodes: List[Dict[str, Any]] = []
    seen: Set[str] = set()

    for name, entry in info.items():
        slug = snake_case(name)
        if not slug or slug in seen:
            continue
        seen.add(slug)

        cls = entry["cls"]
        module = getattr(cls, "__module__", "")
        class_path = f"{module}.{name}" if module else None
        category = get_model_subcategory(module)
        est_types = sorted(entry["types"])
        description = safe_first_line(getattr(cls, "__doc__", None))
        if not description:
            description = f"sklearn {', '.join(est_types)} {name}"

        aliases = REVERSE_ALIASES.get(name, [])
        node: Dict[str, Any] = {
            "id": f"model.{slug}",
            "name": name,
            "type": "model",
            "description": description,
            "parameters": build_parameters(cls),
            "source": "sklearn",
            "classPath": class_path,
            "category": category,
            "tags": ["sklearn"] + est_types + module.split(".")[1:3],
            "isAdvanced": True,
        }
        if aliases:
            node["aliases"] = aliases

        nodes.append(node)

    return nodes


def generate_sklearn_splitters() -> List[Dict[str, Any]]:
    """Generate nodes for sklearn cross-validation splitters."""
    try:
        import sklearn.model_selection as model_selection
    except ImportError:
        print("[WARN] sklearn not available, skipping splitters", file=sys.stderr)
        return []

    splitter_names = [
        "KFold", "StratifiedKFold", "GroupKFold", "RepeatedKFold",
        "RepeatedStratifiedKFold", "ShuffleSplit", "StratifiedShuffleSplit",
        "GroupShuffleSplit", "TimeSeriesSplit", "LeaveOneOut", "LeavePOut",
        "LeaveOneGroupOut", "LeavePGroupsOut", "PredefinedSplit",
        "StratifiedGroupKFold",
    ]

    nodes: List[Dict[str, Any]] = []

    for name in splitter_names:
        cls = getattr(model_selection, name, None)
        if cls is None:
            continue

        slug = snake_case(name)
        module = getattr(cls, "__module__", "sklearn.model_selection")
        class_path = f"{module}.{name}"
        description = safe_first_line(getattr(cls, "__doc__", None))
        if not description:
            description = f"sklearn splitter {name}"

        nodes.append({
            "id": f"splitting.{slug}",
            "name": name,
            "type": "splitting",
            "description": description,
            "parameters": build_parameters(cls),
            "source": "sklearn",
            "classPath": class_path,
            "category": "sklearn-splitters",
            "tags": ["sklearn", "splitter", "cross-validation"],
            "isAdvanced": True,
        })

    return nodes


# ============================================================================
# UI Overlay Application
# ============================================================================


def load_ui_overlays(repo_root: Path) -> Dict[str, Any]:
    """Load UI overlay data from ui-overlays.json."""
    overlay_path = repo_root / "src" / "data" / "nodes" / "ui-overlays.json"
    if not overlay_path.exists():
        print(f"[WARN] UI overlays file not found: {overlay_path}", file=sys.stderr)
        return {}
    try:
        data = json.loads(overlay_path.read_text(encoding="utf-8"))
        # Remove schema/comment keys
        return {k: v for k, v in data.items() if not k.startswith("$") and not k.startswith("_")}
    except Exception as e:
        print(f"[WARN] Error loading UI overlays: {e}", file=sys.stderr)
        return {}


def apply_ui_overlays(nodes: List[Dict[str, Any]], overlays: Dict[str, Any]) -> None:
    """Apply UI overlay data (sweep presets, finetune ranges, display order, descriptions) to nodes."""
    for node in nodes:
        node_id = node["id"]
        overlay = overlays.get(node_id)
        if not overlay:
            continue

        # Long description
        if "longDescription" in overlay:
            node["longDescription"] = overlay["longDescription"]

        # Display order (stored in overlay for sorting, not in node schema)
        # We keep it as metadata for sorting
        if "displayOrder" in overlay:
            node["_displayOrder"] = overlay["displayOrder"]

        # Sweep presets -> apply to matching parameters
        if "sweepPresets" in overlay:
            for param_name, presets in overlay["sweepPresets"].items():
                for param in node.get("parameters", []):
                    if param["name"] == param_name:
                        param["sweepable"] = True
                        param["sweepPresets"] = presets
                        break

        # Finetune ranges -> apply to matching parameters
        if "finetuneRanges" in overlay:
            for param_name, finetune_info in overlay["finetuneRanges"].items():
                for param in node.get("parameters", []):
                    if param["name"] == param_name:
                        param["finetunable"] = True
                        if "type" in finetune_info:
                            param["finetuneType"] = finetune_info["type"]
                        if "range" in finetune_info:
                            param["finetuneRange"] = finetune_info["range"]
                        break

            # Mark models with finetune ranges as supporting finetuning
            if node.get("type") == "model":
                node["supportsFinetuning"] = True


# ============================================================================
# Validation
# ============================================================================


def validate_registry(nodes: List[Dict[str, Any]]) -> List[str]:
    """Basic validation of the registry output."""
    errors: List[str] = []
    required_fields = {"id", "name", "type", "description", "parameters", "source"}
    valid_types = {
        "preprocessing", "y_processing", "splitting", "model",
        "augmentation", "filter", "flow", "utility",
    }
    valid_sources = {"nirs4all", "sklearn", "custom", "editor"}

    seen_ids: Set[str] = set()

    for i, node in enumerate(nodes):
        # Required fields
        for field in required_fields:
            if field not in node:
                errors.append(f"Node [{i}] missing required field '{field}': {node.get('id', 'UNKNOWN')}")

        node_id = node.get("id", "")

        # ID format: type.name with lowercase and underscores
        if not re.match(r"^[a-z_]+\.[a-z_0-9]+$", node_id):
            errors.append(f"Node [{i}] invalid ID format: '{node_id}'")

        # Duplicate IDs
        if node_id in seen_ids:
            errors.append(f"Node [{i}] duplicate ID: '{node_id}'")
        seen_ids.add(node_id)

        # Valid type
        node_type = node.get("type")
        if node_type and node_type not in valid_types:
            errors.append(f"Node '{node_id}' has invalid type: '{node_type}'")

        # Valid source
        node_source = node.get("source")
        if node_source and node_source not in valid_sources:
            errors.append(f"Node '{node_id}' has invalid source: '{node_source}'")

        # Parameters must be array
        params = node.get("parameters")
        if params is not None and not isinstance(params, list):
            errors.append(f"Node '{node_id}' parameters is not an array")

    return errors


# ============================================================================
# Main Generation
# ============================================================================


def generate_all_nodes(skip_tensorflow: bool = False, repo_root: Optional[Path] = None) -> List[Dict[str, Any]]:
    """Generate all registry nodes via auto-discovery."""
    nodes: List[Dict[str, Any]] = []

    # 1. nirs4all operators (auto-discovered)
    print("[INFO] Auto-discovering nirs4all operators...", file=sys.stderr)
    nirs4all_ops = discover_nirs4all_operators()
    print(f"[INFO]   Discovered {len(nirs4all_ops)} nirs4all operators", file=sys.stderr)
    nodes.extend(nirs4all_ops)

    # 2. TensorFlow models (function-based, optional)
    print("[INFO] Discovering TensorFlow models...", file=sys.stderr)
    tf_models = discover_tensorflow_models(skip=skip_tensorflow)
    print(f"[INFO]   Discovered {len(tf_models)} TensorFlow models", file=sys.stderr)
    nodes.extend(tf_models)

    # 3. sklearn models
    print("[INFO] Generating sklearn models...", file=sys.stderr)
    sk_models = generate_sklearn_models()
    print(f"[INFO]   Generated {len(sk_models)} sklearn models", file=sys.stderr)
    nodes.extend(sk_models)

    # 4. sklearn transformers
    print("[INFO] Generating sklearn transformers...", file=sys.stderr)
    sk_transformers = generate_sklearn_transformers()
    print(f"[INFO]   Generated {len(sk_transformers)} sklearn transformers", file=sys.stderr)
    nodes.extend(sk_transformers)

    # 5. sklearn splitters
    print("[INFO] Generating sklearn splitters...", file=sys.stderr)
    sk_splitters = generate_sklearn_splitters()
    print(f"[INFO]   Generated {len(sk_splitters)} sklearn splitters", file=sys.stderr)
    nodes.extend(sk_splitters)

    # 6. sklearn y_processing (scalers for target transforms)
    print("[INFO] Generating sklearn y_processing scalers...", file=sys.stderr)
    sk_y_proc = generate_sklearn_y_processing()
    print(f"[INFO]   Generated {len(sk_y_proc)} sklearn y_processing scalers", file=sys.stderr)
    nodes.extend(sk_y_proc)

    # Apply UI overlays
    if repo_root:
        print("[INFO] Applying UI overlays...", file=sys.stderr)
        overlays = load_ui_overlays(repo_root)
        if overlays:
            apply_ui_overlays(nodes, overlays)
            matched = sum(1 for n in nodes if "_displayOrder" in n)
            print(f"[INFO]   Applied overlays to {matched} nodes", file=sys.stderr)

    # Sort: nirs4all first (by display order if available, then by id),
    # then sklearn by type priority and id
    TYPE_PRIORITY = {"model": 0, "preprocessing": 1, "splitting": 2, "augmentation": 3, "filter": 4, "y_processing": 5}

    def sort_key(n):
        source_priority = 0 if n.get("source") == "nirs4all" else 1
        type_priority = TYPE_PRIORITY.get(n["type"], 99)
        display_order = n.get("_displayOrder", 9999)
        return (source_priority, type_priority, display_order, n["id"])

    nodes.sort(key=sort_key)

    # Dedupe by ID (keep first due to priority sorting)
    # Note: classPath dedup excludes y_processing nodes since a scaler can serve
    # as both preprocessing (StandardScaler for X) and y_processing (StandardScaler for y)
    seen_ids: Set[str] = set()
    seen_classpaths: Set[str] = set()
    deduped: List[Dict[str, Any]] = []
    for n in nodes:
        if n["id"] in seen_ids:
            continue
        cp = n.get("classPath")
        node_type = n.get("type", "")
        # Allow same classPath for different types (e.g. preprocessing + y_processing)
        cp_key = f"{cp}::{node_type}" if cp else None
        if cp_key and cp_key in seen_classpaths:
            continue
        # Also skip if same classPath already exists for same type category
        # (e.g., model.pls_regression vs preprocessing.pls_regression)
        if cp and node_type not in ("y_processing",) and cp in seen_classpaths:
            continue
        seen_ids.add(n["id"])
        if cp:
            seen_classpaths.add(cp)
            if cp_key:
                seen_classpaths.add(cp_key)
        # Clean up internal metadata
        n.pop("_displayOrder", None)
        deduped.append(n)

    print(f"[INFO] Total unique nodes: {len(deduped)}", file=sys.stderr)
    return deduped


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate canonical node registry JSON")
    parser.add_argument(
        "--out",
        default="src/data/nodes/generated/canonical-registry.json",
        help="Output JSON file path (relative to webapp root)",
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate the output after generation",
    )
    parser.add_argument(
        "--skip-tensorflow",
        action="store_true",
        help="Skip TensorFlow model discovery (faster)",
    )

    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    out_path = (repo_root / args.out).resolve() if not Path(args.out).is_absolute() else Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    nodes = generate_all_nodes(skip_tensorflow=args.skip_tensorflow, repo_root=repo_root)

    # Write the registry
    out_path.write_text(
        json.dumps(nodes, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(nodes)} nodes to {out_path.relative_to(repo_root)}")

    # Sidecar metadata
    sklearn_version: Optional[str] = None
    nirs4all_version: Optional[str] = None
    try:
        import sklearn
        sklearn_version = getattr(sklearn, "__version__", None)
    except Exception:
        pass
    try:
        import nirs4all
        nirs4all_version = getattr(nirs4all, "__version__", None)
    except Exception:
        pass

    type_counts: Dict[str, int] = {}
    source_counts: Dict[str, int] = {}
    for n in nodes:
        t = n.get("type", "unknown")
        type_counts[t] = type_counts.get(t, 0) + 1
        s = n.get("source", "unknown")
        source_counts[s] = source_counts.get(s, 0) + 1

    meta_path = out_path.with_name(out_path.stem + ".meta.json")
    meta = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "nodeCount": len(nodes),
        "pythonVersion": sys.version.split()[0],
        "sklearnVersion": sklearn_version,
        "nirs4allVersion": nirs4all_version,
        "generator": {
            "script": "scripts/generate_registry.py",
            "format": "NodeDefinition[]",
        },
        "countsByType": type_counts,
        "countsBySource": source_counts,
    }
    meta_path.write_text(
        json.dumps(meta, indent=2, ensure_ascii=False, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote metadata to {meta_path.relative_to(repo_root)}")

    # Validation
    if args.validate:
        print("[INFO] Validating registry...", file=sys.stderr)
        errors = validate_registry(nodes)
        if errors:
            print(f"[ERROR] Found {len(errors)} validation errors:", file=sys.stderr)
            for err in errors[:20]:
                print(f"  - {err}", file=sys.stderr)
            if len(errors) > 20:
                print(f"  ... and {len(errors) - 20} more", file=sys.stderr)
            return 1
        else:
            print(f"[OK] Registry is valid ({len(nodes)} nodes)", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
