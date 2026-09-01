# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Turn a convention match into a DatasetSpec dict (Epic 2.3 / 3.2).

Feature files become feature sources (one per multi-source index, per partition);
target/metadata files join 1:1 onto the first feature source of their partition;
fold files become ``folds.file``; a vendor-corpus match becomes a glob feature
source plus an ``m:1`` reference lookup keyed by ``filename_stem``.
"""

from __future__ import annotations

from collections import defaultdict

from ..spec.enums import Role
from .engine import ConventionResult


def assignments_to_spec_dict(result: ConventionResult, *, name: str = "dataset") -> dict:
    spec: dict = {"name": name, "sources": []}
    sources: list[dict] = spec["sources"]

    if result.vendor is not None and result.vendor.spectra:
        return _vendor_spec(result, name)

    by_role_part: dict[tuple, list] = defaultdict(list)
    for a in result.assignments:
        by_role_part[(a.role, a.partition)].append(a)

    feature_anchor: dict[object, str] = {}
    # features first -> establish per-partition anchor ids
    for (role, partition), items in by_role_part.items():
        if role is not Role.FEATURES:
            continue
        items = sorted(items, key=lambda a: a.source_index)
        multi = len(items) > 1
        for a in items:
            sid = f"{partition.value if partition else 'x'}_x" + (f"_{a.source_index}" if multi else "")
            src: dict = {"id": sid, "role": "features", "input": a.name}
            if partition is not None:
                src["partition"] = partition.value
            sources.append(src)
            feature_anchor.setdefault(partition, sid)
            if multi and a.source_index > 0:
                src["join"] = {"to": feature_anchor[partition], "how": "1:1"}

    # targets + metadata join 1:1 onto the partition anchor
    for (role, partition), items in by_role_part.items():
        if role is Role.FEATURES:
            continue
        anchor = feature_anchor.get(partition)
        for a in sorted(items, key=lambda a: a.source_index):
            sid = f"{partition.value if partition else 'm'}_{'y' if role is Role.TARGETS else 'm'}"
            if a.source_index:
                sid += f"_{a.source_index}"
            src = {"id": sid, "role": role.value, "input": a.name}
            if partition is not None:
                src["partition"] = partition.value
            if anchor:
                src["join"] = {"to": anchor, "how": "1:1"}
            sources.append(src)

    if result.fold_files:
        spec["folds"] = {"file": result.fold_files[0], "format": "auto"}
    return spec


def _vendor_spec(result: ConventionResult, name: str) -> dict:
    vendor = result.vendor
    assert vendor is not None
    spec: dict = {"name": name, "conventions": ["vendor-corpus"], "sources": []}
    # spectra: one feature source per file is impractical; keep as a multi-file source
    spec["sources"].append({"id": "spectra", "role": "features", "input": sorted(vendor.spectra), "merge": "concat_samples"})
    if vendor.reference:
        on = vendor.join.get("sample_key", "filename_stem")
        coverage = {"warn": "warn", "drop": "drop", "error": "error"}.get(vendor.join.get("on_missing", "warn"), "warn")
        spec["sources"].append(
            {
                "id": "ref",
                "kind": "lookup",
                "input": vendor.reference[0],
                "columns": [{"role": "targets", "select": "rest"}],
                "join": {"to": "spectra", "on": on, "how": "m:1", "coverage": coverage},
            }
        )
    return spec
