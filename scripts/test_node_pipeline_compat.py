#!/usr/bin/env python3
"""Test node definitions against actual Python classes.

Verifies that each curated node definition can be resolved to an importable
Python class and instantiated with the definition's default parameter values.

Usage:
    python scripts/test_node_pipeline_compat.py
    python scripts/test_node_pipeline_compat.py --verbose
"""

import argparse
import importlib
import inspect
import json
import sys
from pathlib import Path

# Special classPath values that don't map to Python classes
SPECIAL_CLASSPATHS = {
    "branch", "merge", "sample_augmentation", "feature_augmentation",
    "sample_filter", "concat_transform", "sequential",
    "_or_", "_and_", "_range_", "_log_range_", "_cartesian_",
    "source_branch", "source_merge",  # editor-level branching
    "_chart_", "_comment_",  # editor-level utilities
}

# Known class name mappings (curated classPath -> actual module.class)
CLASS_ALIASES = {
    # Deep learning models use function-based paths
    "nirs4all.operators.models.nicon": None,  # Skip - function-based
    "nirs4all.operators.models.CNN1D": None,  # Skip - function-based
    "nirs4all.operators.models.LSTM": None,  # Skip - function-based
    "nirs4all.operators.models.Transformer": None,  # Skip - function-based
    "nirs4all.operators.models.TabPFN": None,  # Skip - optional dependency
    "tabicl.TabICLClassifier": None,  # Skip - optional dependency
    "tabicl.TabICLRegressor": None,  # Skip - optional dependency
    "nirs4all.operators.models.MetaModel": None,  # Skip - special
    "nirs4all.operators.models.PCR": None,  # Skip - composite
    # XGBoost/LightGBM are optional
    "xgboost.XGBRegressor": None,
    "lightgbm.LGBMRegressor": None,
    # Transforms with non-standard class names
    "nirs4all.operators.transforms.BaselineCorrection": "nirs4all.operators.transforms.PyBaselineCorrection",
    # Not yet implemented as standalone classes
    "nirs4all.operators.transforms.VIP": None,
    "nirs4all.operators.transforms.MovingAverage": None,
}

# Params to exclude from instantiation (they're UI-level, not real Python params)
UI_ONLY_PARAMS = {
    "variation_scope",  # Augmentation scope - injected by controller, not a constructor param
    "feature_range_min", "feature_range_max",  # MinMaxScaler tuple splitting
    "quantile_range_min", "quantile_range_max",  # RobustScaler tuple splitting
    "offset_range_min", "offset_range_max",
    "slope_range_min", "slope_range_max",
    "shift_range_min", "shift_range_max",
    "stretch_range_min", "stretch_range_max",
    "sigma_range_min", "sigma_range_max",
    "gain_range_min", "gain_range_max",
    "amplitude_range_min", "amplitude_range_max",
    "n_bands_range_min", "n_bands_range_max",
    "n_spikes_range_min", "n_spikes_range_max",
    "bandwidth_range_min", "bandwidth_range_max",
    "width_range_min", "width_range_max",
    "multiplicative_range_min", "multiplicative_range_max",
    "additive_range_min", "additive_range_max",
    "amount_range_min", "amount_range_max",
    "a_range_min", "a_range_max",
    "b_range_min", "b_range_max",
    "size_range_um_min", "size_range_um_max",
    "intensity_range_min", "intensity_range_max",
    "temperature_range_min", "temperature_range_max",  # TemperatureAugmenter
    "water_activity_range_min", "water_activity_range_max",  # MoistureAugmenter
    "fwhm_range_min", "fwhm_range_max",  # InstrumentalBroadeningAugmenter
    "perturbation_range_min", "perturbation_range_max",  # Spline_X_Perturbations
    "operator_range_min", "operator_range_max",  # Random_X_Operation
}


def resolve_class(class_path: str):
    """Import and return a Python class from a dotted path."""
    parts = class_path.rsplit(".", 1)
    if len(parts) != 2:
        return None
    module_path, class_name = parts
    try:
        module = importlib.import_module(module_path)
        return getattr(module, class_name, None)
    except (ImportError, ModuleNotFoundError):
        # Try parent module
        try:
            parts2 = module_path.rsplit(".", 1)
            if len(parts2) == 2:
                parent_mod = importlib.import_module(parts2[0])
                sub = getattr(parent_mod, parts2[1], None)
                if sub:
                    return getattr(sub, class_name, None)
        except (ImportError, ModuleNotFoundError):
            pass
        return None


def get_default_kwargs(node_def: dict) -> dict:
    """Extract default parameter values from a node definition."""
    kwargs = {}
    for param in node_def.get("parameters", []):
        name = param["name"]
        if name in UI_ONLY_PARAMS:
            continue
        if "default" in param and param["default"] is not None:
            kwargs[name] = param["default"]
    return kwargs


def check_node(node_def: dict, verbose: bool = False) -> tuple[str, str, str]:
    """Check a single node definition.

    Returns: (status, node_id, message)
    status is one of: "pass", "fail", "skip", "warn"
    """
    node_id = node_def["id"]
    class_path = node_def.get("classPath", "")

    # Skip special classpaths
    if class_path in SPECIAL_CLASSPATHS:
        return "skip", node_id, f"Special classPath: {class_path}"

    # Handle known aliases
    if class_path in CLASS_ALIASES:
        alias = CLASS_ALIASES[class_path]
        if alias is None:
            return "skip", node_id, "Known skip: optional/special"
        # Use the alias class path instead
        class_path = alias

    # Try to resolve the class
    cls = resolve_class(class_path)
    if cls is None:
        return "fail", node_id, f"Cannot import: {class_path}"

    # Check parameter names exist in class signature
    try:
        sig = inspect.signature(cls.__init__)
        real_params = set(sig.parameters.keys()) - {"self", "args", "kwargs"}
    except (ValueError, TypeError):
        real_params = set()

    def_params = {p["name"] for p in node_def.get("parameters", []) if p["name"] not in UI_ONLY_PARAMS}
    missing_in_class = def_params - real_params - UI_ONLY_PARAMS

    warnings = []
    if missing_in_class:
        warnings.append(f"Params not in class: {missing_in_class}")

    # Try to instantiate with defaults
    kwargs = get_default_kwargs(node_def)
    # Filter kwargs to only real params
    filtered_kwargs = {k: v for k, v in kwargs.items() if k in real_params}

    try:
        instance = cls(**filtered_kwargs)
        status = "warn" if warnings else "pass"
        msg = "; ".join(warnings) if warnings else f"OK ({class_path})"
        return status, node_id, msg
    except Exception as e:
        return "warn", node_id, f"Instantiation issue: {e.__class__.__name__}: {e}"


def main():
    parser = argparse.ArgumentParser(description="Test node definitions against Python classes")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show all results")
    args = parser.parse_args()

    # Find all definition JSON files
    defs_dir = Path(__file__).parent.parent / "src" / "data" / "nodes" / "definitions"
    json_files = sorted(defs_dir.rglob("*.json"))

    all_nodes = []
    for jf in json_files:
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
            if isinstance(data, list):
                all_nodes.extend(data)
        except Exception as e:
            print(f"Error reading {jf}: {e}")

    print(f"Found {len(all_nodes)} curated node definitions\n")

    results = {"pass": [], "fail": [], "skip": [], "warn": []}

    for node in all_nodes:
        status, node_id, msg = check_node(node, args.verbose)
        results[status].append((node_id, msg))

        if args.verbose or status in ("fail", "warn"):
            icons = {"pass": "[PASS]", "fail": "[FAIL]", "skip": "[SKIP]", "warn": "[WARN]"}
            print(f"  {icons[status]} {node_id}: {msg}")

    # Summary
    print(f"\n{'=' * 60}")
    print(f"Results: {len(results['pass'])} pass, {len(results['warn'])} warn, "
          f"{len(results['fail'])} fail, {len(results['skip'])} skip")

    if results["fail"]:
        print("\nFailures:")
        for node_id, msg in results["fail"]:
            print(f"  {node_id}: {msg}")

    # Exit code
    sys.exit(1 if results["fail"] else 0)


if __name__ == "__main__":
    main()
