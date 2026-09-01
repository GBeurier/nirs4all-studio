# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Adapt an :class:`AssembledDataset` to a nirs4all ``SpectroDataset`` (Epic 4.1b).

This is the **sole** nirs4all touch-point: the ``SpectroDataset`` class is
imported lazily here (never at module import — see the import-boundary test).
The build flow mirrors ``DatasetConfigs._load_dataset``: construct empty, then
per partition ``add_samples({"partition": p})`` -> ``add_targets`` (appends) ->
``add_metadata``, then ``set_signal_type/task_type/folds/repetition/aggregate``.

``spectro_dataset_cls`` can be injected (a recording double) so the adapter is
testable without nirs4all installed.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from .assemble import AssembledDataset, PartitionBlock

_PARTITION_ORDER = ("train", "test", "val", "predict")
# Conventional metadata column name carrying per-sample training weights
# (`role: weights` columns). The SpectroDataset has no first-class weight slot,
# so we surface them as metadata; the user/pipeline can read them off as
# `dataset.metadata({...})[_WEIGHT_COL]` and pass to `sample_weight` at fit.
_WEIGHT_COL = "__sample_weight__"


def _one_or_list(values: list[Any]) -> Any:
    return values[0] if len(values) == 1 else values


def to_spectrodataset(assembled: AssembledDataset, *, spectro_dataset_cls: type | None = None) -> Any:
    """Materialize ``assembled`` into a SpectroDataset (lazy import unless injected)."""
    if spectro_dataset_cls is None:
        from nirs4all.data import SpectroDataset  # lazy: the only nirs4all runtime touch-point

        spectro_dataset_cls = SpectroDataset

    ds = spectro_dataset_cls(name=assembled.name)
    order = [p for p in _PARTITION_ORDER if p in assembled.blocks]
    first = True
    # Accumulate per-source variation arrays across partitions; once all
    # partitions are added (samples are flat across partitions in the
    # SpectroDataset), call add_features once per (source, processing_name).
    accumulated_processings: list[dict[str, list[np.ndarray]]] = []
    for part in order:
        block = assembled.blocks[part]
        if not block.X:
            continue
        nirs_partition = "test" if part == "val" else part  # nirs4all build has no 'val' partition
        ds.add_samples(
            _one_or_list(block.X),
            {"partition": nirs_partition},
            headers=_one_or_list(block.feature_headers),
            header_unit=_one_or_list(block.header_units),
        )
        if first:
            for src_idx, sig in enumerate(block.signal_types):
                if sig:
                    ds.set_signal_type(sig, src=src_idx, forced=False)
            accumulated_processings = [{} for _ in block.X]
        for src_idx, src_procs in enumerate(block.processings):
            for name, arr in src_procs:
                accumulated_processings[src_idx].setdefault(name, []).append(arr)
        if block.y is not None:
            ds.add_targets(block.y)
        # Augment metadata with the weights column if present; create an
        # otherwise-empty metadata frame just to carry the weights when no
        # other metadata was declared.
        meta_df = block.metadata.copy() if block.metadata is not None else None
        if block.weights is not None:
            if meta_df is None:
                meta_df = pd.DataFrame({_WEIGHT_COL: block.weights})
            else:
                meta_df[_WEIGHT_COL] = block.weights
        if meta_df is not None:
            ds.add_metadata(meta_df)
        first = False

    # Now that all partitions are added, attach the named preprocessing variants
    # as additional processings on each source (parallel to the raw features).
    # `add_features` is wrapped in a list so the inner `if not features:` check
    # in nirs4all's features.update_features stays well-defined for numpy input.
    for src_idx, procs in enumerate(accumulated_processings):
        for name, parts in procs.items():
            arr = np.concatenate(parts, axis=0) if len(parts) > 1 else parts[0]
            ds.add_features([arr], [name], source=src_idx)

    if assembled.task_type and assembled.task_type != "auto":
        ds.set_task_type(assembled.task_type, forced=True)
    if assembled.folds:
        ds.set_folds(assembled.folds)
    if assembled.repetition:
        ds.set_repetition(assembled.repetition)
    if assembled.aggregate is not None:
        ds.set_aggregate(assembled.aggregate.by if assembled.aggregate.by else True)
        ds.set_aggregate_method(assembled.aggregate.method.value)
        if assembled.aggregate.exclude_outliers:
            ds.set_aggregate_exclude_outliers(True, assembled.aggregate.outlier_threshold)
    return ds


__all__ = ["to_spectrodataset", "AssembledDataset", "PartitionBlock"]
