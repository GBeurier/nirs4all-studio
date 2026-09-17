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


def _with_native_na_params(params: dict[str, Any]) -> dict[str, Any]:
    """Keep oracle NA fields and expose the equivalent native IO contract."""
    if "na_policy" not in params and "na_fill_config" not in params:
        return params
    native_na = {"policy": params.get("na_policy") or "auto"}
    if params.get("na_fill_config"):
        native_na["fill"] = params["na_fill_config"]
    return {**params, "na": native_na}


def _na_policy(params: dict[str, Any], default: str | None = "auto") -> str | None:
    native_na = params.get("na", {})
    return params.get("na_policy", native_na.get("policy", default) if isinstance(native_na, dict) else default)


def _normalize_library_loading_params(config: dict[str, Any]) -> dict[str, Any]:
    """Bridge NA fields without dropping library-owned dataset settings."""
    result = dict(config)
    for key, value in config.items():
        if key.endswith("_params") and isinstance(value, dict):
            result[key] = _with_native_na_params(value)
    for split in ("train", "test"):
        if not result.get(f"{split}_group"):
            continue
        effective_policy = "auto"
        for key in ("global_params", "group_params", f"{split}_params", f"{split}_group_params"):
            params = result.get(key, {})
            if isinstance(params, dict):
                policy = _na_policy(params, None)
                if policy is not None:
                    effective_policy = policy
        if effective_policy == "auto":
            key = f"{split}_group_params"
            result[key] = _with_native_na_params({**result.get(key, {}), "na_policy": "ignore"})
    return result


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

    na_policy = _na_policy(parsing, None)
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

    config: dict[str, Any] = {"global_params": _with_native_na_params(global_params)}
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
        elif norm_type == "metadata":
            params = dict(overrides or {})
            if _na_policy(params, _na_policy(parsing)) in (None, "auto"):
                params["na_policy"] = "ignore"
            config[params_key] = params
        elif overrides:
            config[params_key] = overrides
        if params_key in config:
            config[params_key] = _with_native_na_params(config[params_key])

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

    # Top-level wizard settings override shared settings, including False.
    stored_global = stored_config.get("global_params", {})
    parsing = {
        "delimiter": ";", "decimal_separator": ".", "has_header": True,
        "header_unit": "cm-1", "signal_type": "auto",
        **stored_global,
    }
    for key in ("delimiter", "decimal_separator", "has_header", "header_unit", "signal_type", "encoding", "na_policy", "na_fill_config"):
        if key in stored_config:
            parsing[key] = stored_config[key]

    files = stored_config.get("files", [])

    if files:
        return build_nirs4all_config(
            files=files,
            parsing=parsing,
            base_path=dataset_path,
            aggregation=stored_config.get("aggregation"),
            folds=stored_config.get("folds"),
            task_type=stored_config.get("task_type"),
            dataset_name=dataset_record.get("name"),
        )

    # Existing library configs remain complete: source parameters, selections,
    # repetitions, folds and future library-owned fields must survive reloads.
    x_specific_params: dict[str, Any] = {}
    header_unit = parsing.get("header_unit")
    if header_unit and ("global_params" not in stored_config or "header_unit" in stored_config):
        x_specific_params["header_unit"] = header_unit
    signal_type = parsing.get("signal_type")
    if signal_type and signal_type != "auto":
        x_specific_params["signal_type"] = signal_type

    config: dict[str, Any] = {
        **stored_config,
        "global_params": {
            **({key: parsing[key] for key in ("delimiter", "decimal_separator", "has_header")}
               if "global_params" not in stored_config else {}),
            **stored_global,
            **{key: parsing[key] for key in ("delimiter", "decimal_separator", "has_header", "encoding", "na_policy", "na_fill_config")
               if key in stored_config},
        }
    }

    if stored_config.get("train_x"):
        config["train_x"] = stored_config["train_x"]
        if x_specific_params:
            config["train_x_params"] = {**x_specific_params, **stored_config.get("train_x_params", {})}
    if stored_config.get("train_y"):
        config["train_y"] = stored_config["train_y"]
    if stored_config.get("test_x"):
        config["test_x"] = stored_config["test_x"]
        if x_specific_params:
            config["test_x_params"] = {**x_specific_params, **stored_config.get("test_x_params", {})}
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

    return _normalize_library_loading_params(config)


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
