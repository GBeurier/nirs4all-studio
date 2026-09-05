# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Lazy SpectroDataset adapter (EPIC 11.1 / 12.1).

Consumes the full-precision dict from the native ``assembled_full`` and rebuilds a
nirs4all ``SpectroDataset``. The build flow mirrors the Python MVP's
``materialize/spectrodataset.py`` (which mirrors ``DatasetConfigs._load_dataset``)
so the binding's output equals nirs4all's own ``DatasetConfigs`` (parity oracle,
``tests/test_parity.py``). ``nirs4all`` is imported lazily INSIDE
``to_spectrodataset`` — never at module import — so importing ``nirs4all_io``
never imports ``nirs4all`` (import-boundary test). numpy/pandas are not nirs4all.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from ._assembled import require_assembled_dataset_v2

_PARTITION_ORDER = ("train", "test", "val", "predict")
_WEIGHT_COL = "__sample_weight__"


def _matrix(d: dict) -> np.ndarray:
    return np.asarray(d["data"], dtype=np.float32).reshape(d["n_rows"], d["n_cols"])


def _frame(meta: dict) -> pd.DataFrame:
    return pd.DataFrame({c["name"]: c["values"] for c in meta["columns"]})


def _decode_targets(y: np.ndarray, headers: list[str], categorical: dict) -> np.ndarray:
    """Restore categorical labels from the assembled wire's explicit codebooks."""
    if not categorical:
        return y
    restored = y.astype(object)
    for index, header in enumerate(headers):
        if header not in categorical:
            continue
        categories = categorical[header].get("categories")
        codes = y[:, index]
        if (
            not isinstance(categories, list)
            or not all(isinstance(label, str) for label in categories)
            or not np.all(np.isfinite(codes))
            or not np.all(codes == np.floor(codes))
            or np.any(codes < 0)
            or np.any(codes >= len(categories))
        ):
            raise ValueError(f"Invalid categorical target codebook for {header!r}")
        restored[:, index] = np.asarray(categories, dtype=object)[codes.astype(np.intp)]
    return restored


def _one_or_list(values: list[Any]) -> Any:
    return values[0] if len(values) == 1 else values


def to_spectrodataset(full: dict, *, spectro_dataset_cls: type | None = None) -> Any:
    """Build a SpectroDataset from the full-precision assembled dict."""
    require_assembled_dataset_v2(full)
    if spectro_dataset_cls is None:
        from nirs4all.data import SpectroDataset  # lazy: the only nirs4all touch-point

        spectro_dataset_cls = SpectroDataset

    ds = spectro_dataset_cls(name=full["name"])
    blocks = full["blocks"]
    order = [p for p in _PARTITION_ORDER if p in blocks]
    first = True
    accumulated: list[dict[str, list[np.ndarray]]] = []
    for part in order:
        block = blocks[part]
        xs = [_matrix(m) for m in block["x"]]
        if not xs:
            continue
        nirs_partition = "test" if part == "val" else part  # nirs4all build has no 'val'
        ds.add_samples(
            _one_or_list(xs),
            {"partition": nirs_partition},
            headers=_one_or_list(block["feature_headers"]),
            header_unit=_one_or_list(block["header_units"]),
        )
        if first:
            for src_idx, sig in enumerate(block["signal_types"]):
                if sig:
                    ds.set_signal_type(sig, src=src_idx, forced=False)
            accumulated = [{} for _ in xs]
        for src_idx, procs in enumerate(block["processings"]):
            for proc in procs:
                accumulated[src_idx].setdefault(proc["name"], []).append(_matrix(proc["matrix"]))
        if block["y"] is not None:
            ds.add_targets(_decode_targets(_matrix(block["y"]), block["y_headers"], block["y_categorical"]))
        meta_df = _frame(block["metadata"]) if block["metadata"] is not None else None
        if block["weights"] is not None:
            if meta_df is None:
                meta_df = pd.DataFrame({_WEIGHT_COL: block["weights"]})
            else:
                meta_df[_WEIGHT_COL] = block["weights"]
        if meta_df is not None:
            ds.add_metadata(meta_df)
        first = False

    for src_idx, procs in enumerate(accumulated):
        for name, parts in procs.items():
            arr = np.concatenate(parts, axis=0) if len(parts) > 1 else parts[0]
            ds.add_features([arr], [name], source=src_idx)

    if full["task_type"] and full["task_type"] != "auto":
        ds.set_task_type(full["task_type"], forced=True)
    if full["folds"]:
        ds.set_folds([tuple(f) for f in full["folds"]])
    if full["repetition"]:
        ds.set_repetition(full["repetition"])
    agg = full["aggregate"]
    if agg is not None:
        ds.set_aggregate(agg["by"] if agg["by"] else True)
        ds.set_aggregate_method(agg["method"])
        if agg["exclude_outliers"]:
            ds.set_aggregate_exclude_outliers(True, agg["outlier_threshold"])
    return ds


__all__ = ["to_spectrodataset"]
