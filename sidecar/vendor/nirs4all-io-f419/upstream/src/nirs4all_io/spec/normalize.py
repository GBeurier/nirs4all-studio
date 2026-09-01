# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Alias normalization + legacy-keys -> DatasetSpec conversion (Epic 2.2).

Two responsibilities:

1. ``apply_key_aliases`` — map any accepted synonym (``xtrain``, ``X_cal``,
   ``calibration_features``, ``meta``, ``cv``, ...) onto canonical legacy keys
   (``train_x``/``test_y``/``train_group``/``folds``/...). The synonym map is
   **copied from** ``nirs4all/data/parsers/normalizer.py`` (``_key_alias_map``);
   see COPY_PROVENANCE.md row 2.

2. ``legacy_to_spec_dict`` — the *new* piece: wire those legacy keys into the
   canonical :class:`DatasetSpec` shape (``sources`` + ``partitions`` + ``folds``),
   which nirs4all's runtime never did (it consumed the legacy keys directly).

``normalize_to_spec_dict`` chains them: alias-normalize, then either pass a
``sources``-bearing dict through (already a spec) or convert legacy keys.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

# Canonical "role" buckets keyed by partition. Copied from nirs4all normalizer.py.
_TRAIN_PARTITIONS = ["train", "trn", "cal", "calibration", "fit"]
_TEST_PARTITIONS = ["test", "tst", "val", "validation", "eval", "holdout", "predict", "inference"]
_FEATURE_ROLES = ["x", "feature", "features", "spectrum", "spectra", "signal", "signals"]
_TARGET_ROLES = ["y", "target", "targets", "label", "labels", "response", "responses"]
_METADATA_ROLES = ["group", "groups", "meta", "metadata", "m", "samplemeta", "samplemetadata"]

# Root-level loading-param keys accepted as a shorthand (A.12/75), folded into params.
_ROOT_PARAM_KEYS = {"delimiter", "decimal_separator", "decimal", "has_header", "header", "header_unit", "na", "na_policy", "categorical", "categorical_mode", "encoding", "signal_type"}


def normalize_key(key: Any) -> str:
    """Case/separator-insensitive key: keep alphanumerics, lowercase."""
    return "".join(ch.lower() for ch in str(key) if ch.isalnum())


def _combine_partition_role(partitions: list[str], roles: list[str]) -> list[str]:
    aliases: list[str] = []
    for partition in partitions:
        for role in roles:
            aliases.extend([f"{partition}_{role}", f"{role}_{partition}", f"{partition}{role}", f"{role}{partition}"])
    return aliases


@lru_cache(maxsize=1)
def alias_map() -> dict[str, str]:
    """Mapping of normalized alias -> canonical legacy key (first mapping wins)."""
    aliases_by_key: dict[str, list[str]] = {
        "train_x": _combine_partition_role(_TRAIN_PARTITIONS, _FEATURE_ROLES),
        "test_x": _combine_partition_role(_TEST_PARTITIONS, _FEATURE_ROLES),
        "train_y": _combine_partition_role(_TRAIN_PARTITIONS, _TARGET_ROLES),
        "test_y": _combine_partition_role(_TEST_PARTITIONS, _TARGET_ROLES),
        "train_group": _combine_partition_role(_TRAIN_PARTITIONS, _METADATA_ROLES),
        "test_group": _combine_partition_role(_TEST_PARTITIONS, _METADATA_ROLES),
        "name": ["dataset_name", "data_name"],
        "description": ["desc", "dataset_description", "data_description"],
        "task_type": ["task", "tasktype", "problem_type", "problemtype", "ml_task", "target_type"],
        "folder": ["dir", "directory", "data_folder", "data_dir", "folder_path", "path"],
        "global_params": [
            "global", "global_config", "global_settings", "global_options",
            "loading_params", "loader_params", "read_params", "io_params",
            "global_loading_params", "global_loading_options", "shared_params",
        ],
        "train_params": _combine_partition_role(_TRAIN_PARTITIONS, ["params", "param", "config", "settings", "options"]),
        "test_params": _combine_partition_role(_TEST_PARTITIONS, ["params", "param", "config", "settings", "options"]),
        "aggregate": ["aggregation", "aggregate_by", "aggregation_by", "group_by", "groupby", "aggregate_column", "aggregation_column"],
        "aggregate_method": ["aggregation_method", "aggregate_mode", "aggregation_mode", "aggregate_strategy", "aggregation_strategy"],
        "aggregate_exclude_outliers": [
            "exclude_outliers", "remove_outliers", "drop_outliers",
            "exclude_outliers_before_aggregation", "remove_outliers_before_aggregation", "aggregation_exclude_outliers",
        ],
        "repetition": ["repetitions", "repeat", "repeat_by", "repetition_column", "repeat_column", "sample_id_column", "sampleidcolumn", "group_column"],
        "folds": ["fold", "cv", "cv_folds", "cross_validation", "cross_validation_folds", "splits", "cv_splits"],
        "files": ["file_list", "data_files", "input_files"],
        "sources": ["source_list", "sensor_sources", "input_sources", "feature_sources", "modalities"],
        "targets": ["target_spec", "targets_spec", "shared_targets", "shared_target", "common_targets"],
        "metadata": ["metadata_spec", "meta_spec", "shared_metadata", "shared_meta", "common_metadata"],
    }

    # *_params and *_filter variants of the six partitioned x/y/group bases.
    suffix_aliases = {
        "_params": ["params", "param", "config", "configs", "settings", "options"],
        "_filter": ["filter", "filters", "columns", "cols", "indices", "idx", "select", "selection"],
    }
    for base_key in ["train_x", "test_x", "train_y", "test_y", "train_group", "test_group"]:
        base_aliases = list(aliases_by_key.get(base_key, []))
        for suffix, terms in suffix_aliases.items():
            derived: list[str] = []
            for base_alias in base_aliases:
                for term in terms:
                    derived.extend([f"{base_alias}_{term}", f"{base_alias}{term}", f"{term}_{base_alias}", f"{term}{base_alias}"])
            aliases_by_key[f"{base_key}{suffix}"] = derived

    mapping: dict[str, str] = {}
    for canonical_key, aliases in aliases_by_key.items():
        for alias in [canonical_key, *aliases]:
            norm = normalize_key(alias)
            if norm not in mapping:  # first mapping wins
                mapping[norm] = canonical_key
    return mapping


def apply_key_aliases(config: dict[str, Any]) -> dict[str, Any]:
    """Rewrite accepted alias keys to canonical legacy keys (canonical wins)."""
    if not isinstance(config, dict):
        return config
    amap = alias_map()
    normalized = dict(config)
    for key, value in list(config.items()):
        mapped = amap.get(normalize_key(key))
        if mapped is None or key == mapped:
            continue
        if mapped not in normalized:
            normalized[mapped] = value
        normalized.pop(key, None)
    return normalized


# --------------------------------------------------------------------------- #
# Legacy keys -> DatasetSpec dict                                             #
# --------------------------------------------------------------------------- #
_PARTITION_OF = {"train": "train", "test": "test"}


def _as_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, (list, tuple)) else [value]


def legacy_to_spec_dict(config: dict[str, Any]) -> dict[str, Any]:
    """Convert an alias-normalized legacy-keyed config into a DatasetSpec dict.

    Handles the runtime-effective subset (Critique C3): separate x/y/group files
    (single or multi-source lists), 1:1 alignment, partitions, folds, global/
    per-partition loading params, ``*_filter`` column selection, and the
    "Y as columns of X" case (``train_y_filter`` without ``train_y``).
    """
    spec: dict[str, Any] = {}
    if config.get("name") is not None:
        spec["name"] = config["name"]
    if config.get("description") is not None:
        spec["description"] = config["description"]
    if config.get("task_type") is not None:
        spec["task_type"] = config["task_type"]
    # root-level loading params (A.12/75 shorthand) folded into global params;
    # an explicit `global_params` block wins over root keys.
    root_params = {k: config[k] for k in _ROOT_PARAM_KEYS if k in config}
    gp = config.get("global_params")
    global_block: dict[str, Any] = gp if isinstance(gp, dict) else {}
    merged_params = {**root_params, **global_block}
    if merged_params:
        spec["params"] = merged_params
    if config.get("repetition") is not None:
        spec["repetition"] = config["repetition"]
        spec.setdefault("sample_index", {})["repetition_id"] = config["repetition"]

    agg = _aggregate_block(config)
    if agg:
        spec["aggregate"] = agg

    sources: list[dict[str, Any]] = []
    first_feature_id_by_partition: dict[str, str] = {}

    for partition in ("train", "test"):
        x_val = config.get(f"{partition}_x")
        x_filter = config.get(f"{partition}_x_filter")
        x_params = _merge_params(config.get(f"{partition}_params"), config.get(f"{partition}_x_params"))
        y_val = config.get(f"{partition}_y")
        y_filter = config.get(f"{partition}_y_filter")
        g_val = config.get(f"{partition}_group")
        g_filter = config.get(f"{partition}_group_filter")

        if x_val is not None:
            x_inputs = _as_list(x_val)
            for i, inp in enumerate(x_inputs):
                sid = f"{partition}_x" if len(x_inputs) == 1 else f"{partition}_x_{i}"
                src: dict[str, Any] = {"id": sid, "role": "features", "input": inp, "partition": partition}
                if x_params:
                    src["params"] = x_params
                # Y carried inside X columns (no separate y file)
                if y_val is None and y_filter is not None:
                    src["role"] = "mixed"
                    src["strict_columns"] = False
                    cols = [{"role": "targets", "select": y_filter}]
                    cols.append({"role": "features", "select": x_filter if x_filter is not None else "rest"})
                    src["columns"] = cols
                elif x_filter is not None:
                    src["role"] = "mixed"
                    src["columns"] = [{"role": "features", "select": x_filter}, {"role": "ignore", "select": "rest"}]
                sources.append(src)
                if i == 0:
                    first_feature_id_by_partition[partition] = sid

        anchor = first_feature_id_by_partition.get(partition)
        if y_val is not None:
            ysrc: dict[str, Any] = {"id": f"{partition}_y", "role": "targets", "input": y_val, "partition": partition}
            if y_filter is not None:
                ysrc["columns"] = [{"role": "targets", "select": y_filter}]
                ysrc["role"] = "mixed"
            if anchor:
                ysrc["join"] = {"to": anchor, "how": "1:1"}
            sources.append(ysrc)
        if g_val is not None:
            gsrc: dict[str, Any] = {"id": f"{partition}_m", "role": "metadata", "input": g_val, "partition": partition}
            if g_filter is not None:
                gsrc["columns"] = [{"role": "metadata", "select": g_filter}]
                gsrc["role"] = "mixed"
            if anchor:
                gsrc["join"] = {"to": anchor, "how": "1:1"}
            sources.append(gsrc)

    if sources:
        spec["sources"] = sources

    folds = config.get("folds")
    if folds is not None:
        if isinstance(folds, str):
            spec["folds"] = {"file": folds, "format": "auto"}
        elif isinstance(folds, list):
            spec["folds"] = {"inline": folds}
        elif isinstance(folds, dict):
            spec["folds"] = folds

    return spec


def _merge_params(*blocks: Any) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for block in blocks:
        if isinstance(block, dict):
            merged.update(block)
    return merged


def _aggregate_block(config: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if config.get("aggregate") is not None:
        out["by"] = config["aggregate"]
    if config.get("aggregate_method") is not None:
        out["method"] = config["aggregate_method"]
    if config.get("aggregate_exclude_outliers") is not None:
        out["exclude_outliers"] = bool(config["aggregate_exclude_outliers"])
    return out


def normalize_to_spec_dict(config: dict[str, Any]) -> dict[str, Any]:
    """Normalize any dict config to a canonical DatasetSpec dict.

    - applies the alias map;
    - if the result already declares ``sources``, it is treated as a (mostly)
      canonical spec and returned as-is;
    - otherwise the legacy x/y/group/folds keys are wired into ``sources`` + ``folds``.
    """
    aliased = apply_key_aliases(config)
    if "sources" in aliased:
        return aliased
    legacy_keys = {"train_x", "test_x", "train_y", "test_y", "train_group", "test_group", "folds"}
    if any(k in aliased for k in legacy_keys):
        return legacy_to_spec_dict(aliased)
    return aliased
