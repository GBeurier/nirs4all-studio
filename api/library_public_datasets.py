"""Public nirs4all-datasets catalogue and workspace import adapter.

The nirs4all-datasets package owns the catalogue, acquisition, cache and the
canonical readers. Studio owns only the faithful serialization of one public
dataset into its ordinary file-import layout (X / Y / metadata Parquet files). The
adapter never accepts a filesystem root, tier, token or service from the client.
Every import re-checks the requested identifier against the public catalogue
before calling the owner. Spectral rows are serialized in owner order. Targets
and metadata are joined by the owner-declared identity key, never by row position.
"""

from __future__ import annotations

import contextlib
import importlib
import json
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

PUBLIC_TIER = "public"
_SAMPLE_KEY = "sample_id"
_OBSERVATION_KEY = "observation_id"
_IDENTITY_COLUMNS = (_SAMPLE_KEY, _OBSERVATION_KEY)
_DELIMITER = ";"
# Same rule as the owner catalogue: these declared types are class labels.
_CLASS_TYPES = frozenset({"categorical", "text", "identifier"})
# Same aggregate raw-input budget as the Studio upload inspection.
_MAX_INPUT_BYTES = 512 * 1024 * 1024
_MAX_NAME_LENGTH = 256
_IMPORT_FIELDS = frozenset({"dataset_id", "source_id", "output_dir", "cache_dir"})
_REQUIRED_IMPORT_FIELDS = frozenset({"dataset_id", "output_dir", "cache_dir"})
_INSPECTION_FIELDS = ("success", "error", "summary", "reader", "target_distribution",
                      "target_distribution_by_partition", "target_distributions")


def _bank() -> Any:
    """Import the catalogue owner lazily so Studio starts without it."""
    try:
        return importlib.import_module("nirs4all_datasets")
    except ImportError as error:
        raise RuntimeError("Public dataset catalogue requires the nirs4all-datasets package") from error


@contextlib.contextmanager
def _isolated_root() -> Iterator[str]:
    """Yield an empty private registry root so only the packaged catalogue resolves.

    The owner defaults to the process working directory, where a stray checkout
    would silently replace the bundled catalogue and local-first data.
    """
    with tempfile.TemporaryDirectory(prefix="studio-public-datasets-") as root:
        yield root


def _count(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _strings(value: Any) -> list[str]:
    return [str(item) for item in value] if isinstance(value, (list, tuple)) else []


def _project(entry: dict[str, Any]) -> dict[str, Any]:
    dataset_id = entry["id"]
    return {
        "id": dataset_id,
        "name": _text(entry.get("name")) or dataset_id,
        "domain": _text(entry.get("domain")),
        "spectro_family": _text(entry.get("spectro_family")),
        "n_samples": _count(entry.get("n_samples")),
        "n_features_total": _count(entry.get("n_features_total")),
        "n_targets": _count(entry.get("n_targets")),
        "n_sources": _count(entry.get("n_sources")),
        "source_ids": _strings(entry.get("source_ids")),
        "license": _text(entry.get("license")),
        "targets": _strings(entry.get("targets")),
    }


def _public_entries(bank: Any, root: str) -> list[dict[str, Any]]:
    """Return the owner's public-tier entries, re-checking each entry's own tier."""
    return [_project(entry) for entry in bank.list(root, tier=PUBLIC_TIER)
            if isinstance(entry, dict) and entry.get("tier") == PUBLIC_TIER and _text(entry.get("id"))]


def catalogue(document: dict[str, Any]) -> dict[str, Any]:
    """List the public tier of the installed nirs4all-datasets catalogue.

    Args:
        document: Must be empty; roots, tiers and filters are not client choices.

    Returns:
        ``{"datasets": [...], "version": <owner package version>}``.
    """
    if not isinstance(document, dict) or document:
        raise ValueError("Public dataset catalogue does not accept request fields")
    bank = _bank()
    with _isolated_root() as root:
        datasets = _public_entries(bank, root)
    return {"datasets": datasets, "version": str(bank.__version__)}


def _absolute_path(document: dict[str, Any], field: str) -> Path:
    value = document.get(field)
    if not isinstance(value, str) or not value or not Path(value).is_absolute():
        raise ValueError(f"Public dataset import requires an absolute {field}")
    return Path(value)


def _select_source(source_ids: list[str], requested: str | None) -> str:
    if requested is not None:
        if requested not in source_ids:
            raise ValueError(f"Unknown source {requested!r}; available sources: {', '.join(source_ids)}")
        return requested
    if len(source_ids) == 1:
        return source_ids[0]
    if not source_ids:
        raise ValueError("Public dataset declares no spectral source")
    raise ValueError(f"Dataset has {len(source_ids)} spectral sources; choose one of: {', '.join(source_ids)}")


def _write_parquet(path: Path, frame: Any) -> None:
    # Typed Parquet keeps literal text (including "NA" or ""), nulls and float32
    # values exact. Exclusive creation never follows or replaces a stage entry.
    with path.open("xb") as handle:
        frame.to_parquet(handle, index=False)


def _aligned(frame: Any, join_key: str, row_keys: Any, kind: str) -> tuple[Any, int] | None:
    """Join per-identity variables onto spectral rows by the owner join key.

    Returns the aligned value columns (one row per spectrum, owner column order)
    and the number of spectral rows that found a variables row.
    """
    import pandas as pd

    if frame is None:
        return None
    values = frame.drop(columns=[column for column in _IDENTITY_COLUMNS if column in frame.columns])
    if values.columns.empty:
        return None
    if join_key not in frame.columns:
        raise ValueError(f"Public dataset {kind} lack the declared {join_key} join key")
    keys = frame[join_key].astype(str).to_numpy()
    if len(set(keys)) != len(keys):
        raise ValueError(f"Public dataset {kind} are not unique per {join_key}; refusing an ambiguous join")
    # Integers and booleans stay exact when some spectra have no variables row.
    nullable = {column: "Int64" if values[column].dtype.kind in "iu" else "boolean"
                for column in values.columns if values[column].dtype.kind in "iub"}
    values = values.astype(nullable)
    values.index = pd.Index(keys)
    aligned = values.reindex(pd.Index(row_keys)).reset_index(drop=True)
    return aligned, int(pd.Index(row_keys).isin(keys).sum())


def _target_task(column: Any, declared_type: str | None) -> str:
    from pandas.api.types import is_numeric_dtype

    if declared_type not in _CLASS_TYPES and is_numeric_dtype(column) and column.dtype.kind != "b":
        return "regression"
    return "binary_classification" if column.dropna().nunique() <= 2 else "multiclass_classification"


def _dataset_name(entry: dict[str, Any], source: str) -> str:
    name = entry["name"] if len(entry["source_ids"]) == 1 else f"{entry['name']} ({source})"
    if len(name) > _MAX_NAME_LENGTH or any(not character.isprintable() for character in name):
        name = entry["id"] if len(entry["source_ids"]) == 1 else f"{entry['id']} ({source})"
    return name[:_MAX_NAME_LENGTH]


def _export(dataset: Any, source: str, output_dir: Path) -> dict[str, Any]:
    """Serialize one source with its targets/metadata into ``output_dir``."""
    import numpy as np
    import pandas as pd

    spec = dataset.to_io_spec(source=source, split=None)
    source_spec = next(item for item in spec["sources"] if item.get("id") == source)
    features = [str(name) for role in source_spec.get("columns", []) if role.get("role") == "features" for name in role["select"]]
    variables_spec = next((item for item in spec["sources"] if item.get("id") == "variables"), None)
    join_key = str(variables_spec["key"]) if variables_spec else _SAMPLE_KEY
    if join_key not in _IDENTITY_COLUMNS:
        raise ValueError(f"Unsupported public dataset join key {join_key!r}")

    spectra = np.asarray(dataset.x(source))
    observations = np.asarray(dataset.observation_ids(source)).astype(str)
    samples = np.asarray(dataset.sample_ids(source)).astype(str)
    rows = len(observations)
    if spectra.ndim != 2 or spectra.shape != (rows, len(features)) or len(samples) != rows or rows == 0:
        raise ValueError("Public dataset source identities, axis and spectra disagree")
    if len(set(observations)) != rows:
        raise ValueError("Public dataset source has duplicate observation identifiers")
    row_keys = observations if join_key == _OBSERVATION_KEY else samples

    declared = {variable.name: str(getattr(variable.type, "value", variable.type)) for variable in dataset.descriptor.variables}
    units = {variable.name: variable.unit for variable in dataset.descriptor.variables if variable.unit}
    targets = _aligned(dataset.y(), join_key, row_keys, "targets")
    metadata = _aligned(dataset.metadata(), join_key, row_keys, "metadata")

    files = [("X", "X.parquet", pd.DataFrame(spectra, columns=features))]
    target_config: list[dict[str, Any]] = []
    if targets is not None:
        files.append(("Y", "Y.parquet", targets[0]))
        for index, column in enumerate(targets[0].columns):
            target = {"column": str(column), "type": _target_task(targets[0][column], declared.get(column)), "is_default": index == 0}
            if column in units:
                target["unit"] = units[column]
            target_config.append(target)
    identity = pd.DataFrame({_SAMPLE_KEY: samples, _OBSERVATION_KEY: observations})
    metadata_frame = identity if metadata is None else pd.concat([identity, metadata[0]], axis=1)
    files.append(("metadata", "M.parquet", metadata_frame))
    references = []
    for role, filename, frame in files:
        path = output_dir / filename
        _write_parquet(path, frame)
        references.append({"path": str(path), "type": role, "split": "train", "source": None})

    warnings = []
    for kind, joined in (("targets", targets), ("metadata", metadata)):
        if joined is not None and joined[1] < rows:
            warnings.append(f"{rows - joined[1]} of {rows} spectra have no {kind} row for their {join_key}; values left missing")
    if len({target["type"] == "regression" for target in target_config}) > 1:
        warnings.append("Targets mix regression and classification; choose one target per run")
    unique_samples = len(set(samples))
    return {
        "files": references, "features": len(features), "rows": rows, "unique_samples": unique_samples,
        "repeated": unique_samples < rows, "join_key": join_key, "targets": target_config,
        "metadata_columns": [] if metadata is None else [str(column) for column in metadata[0].columns],
        "header_unit": str((source_spec.get("params") or {}).get("header_unit") or _source_axis_unit(dataset, source)),
        "signal_type": str((source_spec.get("params") or {}).get("signal_type") or "auto"),
        "warnings": warnings,
    }


def _source_axis_unit(dataset: Any, source: str) -> str:
    for item in dataset.descriptor.sources:
        if item.source_id == source:
            return str(getattr(item.axis_unit, "value", item.axis_unit))
    return "none"


def _config(name: str, export: dict[str, Any]) -> dict[str, Any]:
    """Build the ordinary Studio file-import (wizard) configuration.

    Missing values are kept as they are (``ignore``): native IO's ``auto`` policy
    aborts on source NaNs, and the import never imputes, drops or filters rows.
    """
    parsing = {"delimiter": _DELIMITER, "decimal_separator": ".", "has_header": True,
               "header_unit": export["header_unit"], "signal_type": export["signal_type"], "na_policy": "ignore"}
    targets = export["targets"]
    kinds = {target["type"] == "regression" for target in targets}
    if kinds == {True}:
        task_type = "regression"
    elif len(targets) == 1:
        task_type = targets[0]["type"]
    else:
        # Mixed or several classification targets: the library infers per load.
        task_type = "auto"
    classification = bool(targets) and targets[0]["type"] != "regression"
    config: dict[str, Any] = {
        "name": name, **parsing, "files": export["files"], "global_params": dict(parsing),
        "targets": targets, "task_type": task_type, "folds": None,
        # Repeated spectra of one physical sample must stay grouped; the files
        # config declares the library repetition column through aggregation.
        "aggregation": {"enabled": True, "column": _SAMPLE_KEY, "method": "vote" if classification else "mean"}
        if export["repeated"] else {"enabled": False, "method": "vote" if classification else "mean"},
    }
    if targets:
        config["default_target"] = targets[0]["column"]
        config["target_selection"] = {"selected_targets": [target["column"] for target in targets],
                                      "default_target": targets[0]["column"],
                                      "task_by_target": {target["column"]: target["type"] for target in targets}}
    return config


def _inspect(output_dir: Path, name: str, config: dict[str, Any], export: dict[str, Any]) -> dict[str, Any]:
    """Inspect the written files through the same library path as a Studio upload."""
    from nirs4all.api.dataset_inspection import preview_dataset

    from .library_documents import configure_dataset

    configured = configure_dataset({"record": {"path": str(output_dir), "name": name, "config": config}})
    preview = preview_dataset(configured, max_samples=5, max_input_bytes=_MAX_INPUT_BYTES)
    summary = preview.get("summary") or {}
    if preview.get("success") is not True or summary.get("num_samples") != export["rows"] or summary.get("num_features") != export["features"]:
        raise ValueError("Exported public dataset does not read back with its source rows and features")
    return {field: preview[field] for field in _INSPECTION_FIELDS if field in preview}


def import_dataset(document: dict[str, Any]) -> dict[str, Any]:
    """Download one public dataset through its owner and stage it as Studio files.

    Args:
        document: Trusted host request ``{dataset_id, source_id?, output_dir, cache_dir}``.
            ``output_dir`` is an existing private stage directory and ``cache_dir`` the
            workspace-owned owner cache, both absolute.

    Returns:
        ``{name, config, inspection, provenance}``. ``config`` references only files
        inside ``output_dir``. No spectra or variable values are returned.
    """
    if (not isinstance(document, dict) or set(document) - _IMPORT_FIELDS
            or not set(document) >= _REQUIRED_IMPORT_FIELDS):
        raise ValueError("Public dataset import requires dataset_id, output_dir and cache_dir only")
    dataset_id, source_id = document["dataset_id"], document.get("source_id")
    if not isinstance(dataset_id, str) or not dataset_id:
        raise ValueError("Public dataset import requires a dataset_id")
    if source_id is not None and (not isinstance(source_id, str) or not source_id):
        raise ValueError("Public dataset source_id must be a non-empty string")
    output_dir, cache_dir = _absolute_path(document, "output_dir"), _absolute_path(document, "cache_dir")
    if output_dir.is_symlink() or not output_dir.is_dir():
        raise ValueError("Public dataset import requires an existing output directory")

    bank = _bank()
    with _isolated_root() as root:
        entry = next((item for item in _public_entries(bank, root) if item["id"] == dataset_id), None)
        if entry is None:
            raise ValueError(f"Dataset {dataset_id!r} is not in the public catalogue")
        source = _select_source(entry["source_ids"], source_id)
        dataset = bank.get(dataset_id, root=root, cache_dir=str(cache_dir))
        if (str(getattr(dataset.tier, "value", dataset.tier)) != PUBLIC_TIER or dataset.id != dataset_id
                or source not in dataset.sources()):
            raise ValueError("Owner returned a dataset that does not match the public catalogue entry")
        export = _export(dataset, source, output_dir)
        native_splits = [str(split.name) for split in getattr(dataset.descriptor, "splits", [])]

    name = _dataset_name(entry, source)
    config = _config(name, export)
    provenance = {
        "provider": "nirs4all-datasets", "provider_version": str(bank.__version__), "tier": PUBLIC_TIER,
        "dataset_id": dataset_id, "dataset_name": entry["name"], "license": entry["license"],
        "source_id": source, "available_sources": entry["source_ids"], "join_key": export["join_key"],
        "rows": export["rows"], "unique_samples": export["unique_samples"],
        "repeated_observations": export["repeated"], "identity_columns": list(_IDENTITY_COLUMNS),
        "declared_metadata_columns": export["metadata_columns"],
        "declared_targets": [target["column"] for target in export["targets"]],
        "native_splits": native_splits, "native_splits_applied": False, "warnings": export["warnings"],
    }
    with (output_dir / "provenance.json").open("x", encoding="utf-8") as handle:
        json.dump(provenance, handle, indent=2, sort_keys=True)
    inspection = _inspect(output_dir, name, config, export)
    return {"name": name, "config": config, "inspection": inspection, "provenance": provenance}
