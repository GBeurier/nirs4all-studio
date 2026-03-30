"""Canonical dataset config translator: webapp config → nirs4all config.

Every code path that needs to build a nirs4all-compatible dataset configuration
(preview, stored dataset loading, run, training) MUST use build_nirs4all_config()
to ensure consistent behavior for per-file overrides, aggregation, folds, etc.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

_FILE_TYPE_ALIASES = {
    "x": "X",
    "y": "Y",
    "m": "metadata",
    "meta": "metadata",
    "metadata": "metadata",
    "group": "metadata",
}


def normalize_file_type(file_type: str) -> str | None:
    """Normalize file type string to canonical form (X, Y, metadata).

    Handles uppercase/lowercase and aliases like M, META, GROUP → metadata.
    Returns None if the type is unrecognized.
    """
    return _FILE_TYPE_ALIASES.get(file_type.lower())


def _file_type_to_key_suffix(file_type: str) -> str | None:
    """Map normalized file type to nirs4all config key suffix (x, y, group)."""
    mapping = {"X": "x", "Y": "y", "metadata": "group"}
    return mapping.get(file_type)


def build_nirs4all_config(
    files: list[dict[str, Any]],
    parsing: dict[str, Any],
    *,
    base_path: str | None = None,
    aggregation: dict[str, Any] | None = None,
    folds: dict[str, Any] | None = None,
    task_type: str | None = None,
    dataset_name: str | None = None,
) -> dict[str, Any]:
    """Build a nirs4all-compliant dataset configuration.

    This is the single canonical translator used by all code paths (preview,
    stored dataset preview, validation, run, training) to ensure consistent
    dataset loading behavior.

    Args:
        files: List of file dicts with keys: path, type (X/Y/metadata/M/META/GROUP),
            split (train/test), and optional overrides dict.
        parsing: Global parsing options: delimiter, decimal_separator, has_header,
            and optionally header_unit, signal_type, encoding, na_policy, na_fill_config.
        base_path: Optional base directory for resolving relative file paths.
        aggregation: Optional aggregation config: {enabled, column?, method?}.
        folds: Optional folds config: {source, column?, file?, folds?}.
        task_type: Optional task type (ignored if "auto").
        dataset_name: Optional dataset name.

    Returns:
        A dict compatible with nirs4all.run(dataset=config) / DatasetConfigs().
    """
    # Build global_params (CSV loading params shared across X and Y)
    global_params: dict[str, Any] = {
        "delimiter": parsing.get("delimiter", ";"),
        "decimal_separator": parsing.get("decimal_separator", "."),
        "has_header": parsing.get("has_header", True),
    }

    # Optional global params
    encoding = parsing.get("encoding")
    if encoding:
        global_params["encoding"] = encoding

    na_policy = parsing.get("na_policy")
    if na_policy:
        global_params["na_policy"] = na_policy
        na_fill_config = parsing.get("na_fill_config")
        if na_fill_config:
            global_params["na_fill_config"] = na_fill_config

    # X-specific params (header_unit, signal_type only apply to spectral data)
    x_specific_params: dict[str, Any] = {}
    header_unit = parsing.get("header_unit")
    if header_unit:
        x_specific_params["header_unit"] = header_unit
    signal_type = parsing.get("signal_type")
    if signal_type and signal_type != "auto":
        x_specific_params["signal_type"] = signal_type

    config: dict[str, Any] = {"global_params": global_params}
    resolve_base = Path(base_path) if base_path else None

    # Map files to nirs4all keys
    for file_info in files:
        raw_path = file_info.get("path", "")
        raw_type = file_info.get("type", "")
        split = file_info.get("split", "train").lower()
        overrides = file_info.get("overrides")

        if not raw_path or not raw_type:
            continue

        # Normalize file type
        norm_type = normalize_file_type(raw_type)
        if not norm_type:
            continue

        key_suffix = _file_type_to_key_suffix(norm_type)
        if not key_suffix:
            continue

        file_key = f"{split}_{key_suffix}"

        # Resolve path
        file_path = Path(raw_path)
        if not file_path.is_absolute() and resolve_base:
            file_path = resolve_base / raw_path
        resolved_path = str(file_path)

        # Handle multi-source (multiple X files for same split)
        if file_key in config and norm_type == "X":
            existing = config[file_key]
            if isinstance(existing, list):
                config[file_key].append(resolved_path)
            else:
                config[file_key] = [existing, resolved_path]
        else:
            config[file_key] = resolved_path

        # Per-file params
        params_key = f"{file_key}_params"
        if norm_type == "X" and x_specific_params:
            if overrides:
                config[params_key] = {**x_specific_params, **overrides}
            else:
                config[params_key] = x_specific_params.copy()
        elif overrides:
            config[params_key] = overrides

    # Aggregation → aggregate / aggregate_method / repetition
    if aggregation and aggregation.get("enabled") and aggregation.get("column"):
        config["aggregate"] = aggregation["column"]
        config["repetition"] = aggregation["column"]
        method = aggregation.get("method")
        if method:
            config["aggregate_method"] = method

    # Folds
    if folds:
        fold_source = folds.get("source")
        if fold_source == "file" and folds.get("file"):
            config["folds"] = folds["file"]
        elif fold_source == "column" and folds.get("column"):
            # Fold column is typically in the group/metadata file
            config["fold_column"] = folds["column"]
        elif fold_source == "inline" and folds.get("folds"):
            config["folds"] = folds["folds"]

    # Task type
    if task_type and task_type != "auto":
        config["task_type"] = task_type

    # Dataset name
    if dataset_name:
        config["name"] = dataset_name

    return config


def build_nirs4all_config_from_stored(dataset_record: dict[str, Any]) -> dict[str, Any]:
    """Build nirs4all config from a stored webapp dataset record.

    This handles the full stored dataset format including old-format configs
    (train_x/train_y without files array) and folder auto-detection.

    Args:
        dataset_record: The full dataset record from workspace (with path, config, name, etc.).

    Returns:
        A dict compatible with nirs4all DatasetConfigs.
    """
    dataset_path = dataset_record.get("path", "")
    stored_config = dataset_record.get("config", {})

    # Extract parsing from stored config
    parsing = {
        "delimiter": stored_config.get("delimiter", ";"),
        "decimal_separator": stored_config.get("decimal_separator", "."),
        "has_header": stored_config.get("has_header", True),
        "header_unit": stored_config.get("header_unit", "cm-1"),
        "signal_type": stored_config.get("signal_type", "auto"),
    }

    # Also check global_params for additional settings
    stored_global = stored_config.get("global_params", {})
    for key in ("encoding", "na_policy", "na_fill_config"):
        value = stored_config.get(key) or stored_global.get(key)
        if value is not None:
            parsing[key] = value

    files = stored_config.get("files", [])

    if files:
        return build_nirs4all_config(
            files=files,
            parsing=parsing,
            aggregation=stored_config.get("aggregation"),
            folds=stored_config.get("folds"),
            task_type=stored_config.get("task_type"),
            dataset_name=dataset_record.get("name"),
        )

    # Fallback: old-format configs (train_x/train_y without files array)
    x_specific_params: dict[str, Any] = {}
    header_unit = parsing.get("header_unit")
    if header_unit:
        x_specific_params["header_unit"] = header_unit
    signal_type = parsing.get("signal_type")
    if signal_type and signal_type != "auto":
        x_specific_params["signal_type"] = signal_type

    config: dict[str, Any] = {
        "global_params": {
            "delimiter": parsing["delimiter"],
            "decimal_separator": parsing["decimal_separator"],
            "has_header": parsing["has_header"],
        }
    }

    if stored_config.get("train_x"):
        config["train_x"] = stored_config["train_x"]
        if x_specific_params:
            config["train_x_params"] = x_specific_params.copy()
    if stored_config.get("train_y"):
        config["train_y"] = stored_config["train_y"]
    if stored_config.get("test_x"):
        config["test_x"] = stored_config["test_x"]
        if x_specific_params:
            config["test_x_params"] = x_specific_params.copy()
    if stored_config.get("test_y"):
        config["test_y"] = stored_config["test_y"]
    if stored_config.get("train_group"):
        config["train_group"] = stored_config["train_group"]
    if stored_config.get("test_group"):
        config["test_group"] = stored_config["test_group"]

    # If still no files, try folder auto-detection
    if "train_x" not in config:
        folder_path = Path(dataset_path)
        if folder_path.is_dir():
            config_file = folder_path / "dataset_config.json"
            if config_file.exists():
                import json
                with open(config_file, encoding="utf-8") as f:
                    folder_config = json.load(f)
                    config.update(folder_config)
            else:
                _detect_standard_folder_structure(folder_path, config, x_specific_params)

    dataset_name = dataset_record.get("name")
    if dataset_name:
        config["name"] = dataset_name

    return config


def _detect_standard_folder_structure(
    folder_path: Path,
    config: dict[str, Any],
    x_specific_params: dict[str, Any],
) -> None:
    """Try to detect standard nirs4all folder structure (Xtrain.csv, Ytrain.csv, etc.)."""
    csv_files = list(folder_path.glob("*.csv"))
    csv_lower_map = {f.name.lower(): f for f in csv_files}

    x_train_names = ["xtrain.csv", "x_train.csv", "xcal.csv", "x_cal.csv"]
    x_test_names = ["xtest.csv", "x_test.csv", "xval.csv", "x_val.csv"]
    y_train_names = ["ytrain.csv", "y_train.csv", "ycal.csv", "y_cal.csv"]
    y_test_names = ["ytest.csv", "y_test.csv", "yval.csv", "y_val.csv"]

    for name in x_train_names:
        if name in csv_lower_map:
            config["train_x"] = str(csv_lower_map[name])
            if x_specific_params:
                config["train_x_params"] = x_specific_params.copy()
            break

    for name in x_test_names:
        if name in csv_lower_map:
            config["test_x"] = str(csv_lower_map[name])
            if x_specific_params:
                config["test_x_params"] = x_specific_params.copy()
            break

    for name in y_train_names:
        if name in csv_lower_map:
            config["train_y"] = str(csv_lower_map[name])
            break

    for name in y_test_names:
        if name in csv_lower_map:
            config["test_y"] = str(csv_lower_map[name])
            break
