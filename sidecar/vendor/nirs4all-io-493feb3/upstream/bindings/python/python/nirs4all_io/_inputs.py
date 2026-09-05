# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Bounded host-language inputs; numerical assembly remains in Rust."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np

from ._native import resolved_load_limits


def yaml_config(inp: Any, limits: Any = None) -> tuple[Any, Path | None, Any]:
    """Decode YAML 1.1 using PyYAML, then hand its neutral mapping to Rust.

    Defaults: 2 MiB config, depth 64 and 100k expanded nodes. Explicit host
    max_file_bytes may raise the config byte admission; assembly budgets still
    include the bytes/file consumed here. Aliases are bounded, never expanded
    unchecked by a dict conversion. No nirs4all import occurs.
    """
    if not isinstance(inp, (str, Path)) or Path(inp).suffix.lower() not in {".yml", ".yaml"}:
        return inp, None, limits
    import yaml

    path = Path(inp)
    if not path.is_file():
        raise ValueError("YAML config must be a regular file")
    policy = resolved_load_limits(limits)
    cap = min(policy["max_file_bytes"], policy["max_total_bytes"], policy["max_decoded_file_bytes"], policy["max_decoded_total_bytes"])
    if limits is None or isinstance(limits, dict) and "max_file_bytes" not in limits:
        cap = min(cap, 2 * 1024 * 1024)
    with path.open("rb") as stream:
        raw = stream.read(min(cap, path.stat().st_size) + 1)
    if len(raw) > cap:
        raise ValueError("YAML config exceeds file byte budget")
    depth = nodes = 0
    for event in yaml.parse(raw):
        nodes += 1
        if isinstance(event, (yaml.events.MappingStartEvent, yaml.events.SequenceStartEvent)):
            depth += 1
        elif isinstance(event, (yaml.events.MappingEndEvent, yaml.events.SequenceEndEvent)):
            depth -= 1
        if depth > 64 or nodes > 100_000:
            raise ValueError("YAML config exceeds depth/node budget")
    value = yaml.safe_load(raw)
    if not isinstance(value, dict):
        raise ValueError("YAML dataset config must be a mapping")
    visited = expanded_bytes = 0

    def plain(value: Any, ancestors: frozenset[int] = frozenset(), depth: int = 0) -> Any:
        nonlocal visited, expanded_bytes
        visited += 1
        if visited > 100_000 or depth > 64:
            raise ValueError("YAML config exceeds expanded node/depth budget")
        if isinstance(value, (dict, list)):
            if id(value) in ancestors:
                raise ValueError("Cyclic YAML aliases are not dataset configs")
            ancestors = ancestors | {id(value)}
        if isinstance(value, dict):
            if not all(isinstance(key, str) for key in value):
                raise ValueError("Dataset config keys must be strings")
            return {key: plain(item, ancestors, depth + 1) for key, item in value.items()}
        if isinstance(value, list):
            return [plain(item, ancestors, depth + 1) for item in value]
        if isinstance(value, str):
            expanded_bytes += len(value.encode("utf-8"))
            if expanded_bytes > cap:
                raise ValueError("YAML aliases exceed expanded byte budget")
            return value
        if value is None or isinstance(value, (bool, int)):
            return value
        if isinstance(value, float) and math.isfinite(value):
            return value
        raise ValueError("YAML config must contain finite JSON-compatible values")

    value = plain(value)
    for key in ("max_total_bytes", "max_decoded_total_bytes"):
        policy[key] -= len(raw)
    policy["max_files"] -= 1
    if min(policy.values()) <= 0:
        raise ValueError("YAML config exhausted aggregate input budget")
    value.setdefault("name", path.stem)
    return value, path.resolve().parent, policy


def array_payload(inp: Any, name: str | None, limits: Any) -> tuple[dict, list[dict]] | None:
    """Transport supported NumPy inputs as typed frames, without partitioning."""
    if not (isinstance(inp, np.ndarray) or isinstance(inp, tuple) and inp and isinstance(inp[0], np.ndarray)
            or isinstance(inp, dict) and any(isinstance(value, np.ndarray) for value in inp.values())):
        return None
    x = y = split = metadata = None
    if isinstance(inp, np.ndarray):
        x = inp
    elif isinstance(inp, tuple):
        if len(inp) not in {1, 2, 3}:
            raise ValueError("Array tuple must be (X,), (X, y), or (X, y, split)")
        x = inp[0]
        y = inp[1] if len(inp) > 1 else None
        split = inp[2] if len(inp) > 2 else None
    else:
        x, y, metadata = inp.get("X", inp.get("x")), inp.get("y", inp.get("Y")), inp.get("metadata", inp.get("meta"))
    x = np.asarray(x)
    if x.ndim != 2 or not all(x.shape):
        raise ValueError("X must be a non-empty 2D array")
    policy = resolved_load_limits(limits)
    total_cells = total_bytes = 0
    frames: list[dict] = []
    sources: list[dict] = []

    def frame(array: Any, role: str, prefix: str) -> None:
        nonlocal total_cells, total_bytes
        names = [str(value) for value in array.columns] if hasattr(array, "columns") else None
        array = np.asarray(array)
        if array.ndim == 1:
            array = array.reshape(-1, 1)
        if array.ndim != 2 or len(array) != len(x):
            raise ValueError(f"{role} must have the same number of rows as X")
        total_cells += array.size
        total_bytes += array.nbytes
        if array.dtype.kind in {"O", "U", "S"}:
            for value in array.flat:
                if isinstance(value, str):
                    encoded_size = len(value.encode("utf-8"))
                    if encoded_size > policy["max_field_bytes"]:
                        raise ValueError("Array text field exceeds byte budget")
                    total_bytes += encoded_size
        if (array.shape[0] > policy["max_rows"] or array.shape[1] > policy["max_columns"]
                or total_cells > policy["max_cells"] or total_bytes > policy["max_decoded_total_bytes"]):
            raise ValueError("Array input exceeds shape/byte budget")
        columns = names or [f"{prefix}{i}" for i in range(array.shape[1])]
        identity = f"array_{role}"
        frames.append({"name": identity, "columns": columns, "rows": array})
        source: dict[str, Any] = {"id": identity, "role": role, "input": identity}
        if role != "features":
            source["join"] = {"to": "array_features", "how": "1:1"}
        sources.append(source)

    frame(x, "features", "")
    if y is not None:
        frame(y, "targets", "y")
    if metadata is not None:
        frame(metadata, "metadata", "")
    # Historical array inputs preserve missing values and row order; unlike
    # text parsing, there is no implicit NA-driven row or feature removal.
    spec: dict[str, Any] = {"name": name or "array_dataset", "sources": sources, "params": {"na": {"policy": "ignore"}}}
    if split is not None:
        split = np.asarray(split)
        if split.ndim != 1 or len(split) != len(x) or not np.isin(split, ["train", "test", "predict"]).all():
            raise ValueError("split must contain one train/test/predict label per row")
        spec["partitions"] = {"by": "index", **{part: np.flatnonzero(split == part).tolist() for part in ("train", "test", "predict")}}
    elif y is None:
        sources[0]["partition"] = "predict"
        for source in sources[1:]:
            source["partition"] = "predict"
    if len(frames) > policy["max_files"]:
        raise ValueError("Array input exceeds source count budget")
    # Admit all shapes/fields before duplicating any arrays into Python lists.
    for item in frames:
        rows = item["rows"].tolist()
        item["rows"] = [[None if isinstance(value, float) and math.isnan(value) else value for value in row] for row in rows]
    return spec, frames
