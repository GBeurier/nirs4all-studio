# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Assemble a DatasetSpec into a target-agnostic dataset (Epic 4.1b).

Flow per source: load (loaders) -> merge multi-file input (join engine) ->
split columns by role (selectors). Then, per partition: align feature sources
(multi-source X), join targets/metadata/lookup sources onto the sample rows, and
collect X / y / metadata. The result is an :class:`AssembledDataset` IR that
``to_spectrodataset`` and ``DatasetPackage`` adapt on the Python MVP side, while
the Rust bridge crate adapts the same IR to ``dag-ml-data``. Keeping the IR
target-agnostic lets the assembly logic be tested without nirs4all.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from ..conventions.engine import get_stem
from ..spec.dataset_spec import AggregateSpec, ColumnRole, DatasetSpec, SourceSpec, VariationSpec
from ..spec.enums import Cardinality, Coverage, MergeMode, PartitionBy, Role, SourceKind, SpecError
from ..spec.selectors import AutoSelector, RestSelector
from .join import concat_features, concat_samples, join_tables, merge_by_key
from .loaders import coerce_numeric, effective_params, encode_categorical, read_table

_FEATURE_PARTITION_DEFAULT = "train"
# Sentinel column carrying the source's original positional row index so that
# variations (loaded once per source, before any join) can be re-aligned to the
# combined frame after joins/reordering. Stripped before exposing to the user.
_ROW_IDX_PREFIX = "__src_row_idx__"

# Version of the JSON-compatible AssembledDataset summaries/full exports emitted
# by the Rust facade. Version 1 was unversioned and lacked scientific identity,
# source ids and stable fold provenance; consumers must not treat it as v2.
ASSEMBLED_DATASET_VERSION = 2


def _row_idx_col(source_id: str) -> str:
    return f"{_ROW_IDX_PREFIX}{source_id}__"


@dataclass
class SourceTable:
    source_id: str
    df: pd.DataFrame
    roles: dict[str, str]  # column -> role
    key: list[str] | None
    partition: str | None
    kind: str
    join: Any
    modality: str | None
    signal_type: str | None
    header_unit: str
    origins: list[str] | None = None
    # Pre-loaded variation matrices for this (feature) source: rows align with
    # df's original row order; columns are already aligned to the feature
    # columns (either by name or positionally).
    variations: list[tuple[str, np.ndarray]] = field(default_factory=list)


@dataclass
class PartitionBlock:
    n_samples: int
    source_ids: list[str] = field(default_factory=list)
    X: list[np.ndarray] = field(default_factory=list)
    feature_headers: list[list[str]] = field(default_factory=list)
    header_units: list[str] = field(default_factory=list)
    signal_types: list[str | None] = field(default_factory=list)
    # Per feature source, the list of named preprocessing variants (additional
    # processings on the SpectroDataset side, parallel to X[src_idx]). Empty
    # outer list when no source declares variations.
    processings: list[list[tuple[str, np.ndarray]]] = field(default_factory=list)
    y: np.ndarray | None = None
    y_headers: list[str] = field(default_factory=list)
    y_categorical: dict[str, dict] = field(default_factory=dict)
    metadata: pd.DataFrame | None = None
    # Per-sample training weights (sklearn-style `sample_weight`), surfaced on
    # the SpectroDataset side as a metadata column.
    weights: np.ndarray | None = None
    weights_header: str | None = None


@dataclass
class AssembledDataset:
    name: str
    task_type: str
    signal_type: str
    n_sources: int
    blocks: dict[str, PartitionBlock] = field(default_factory=dict)
    folds: list[tuple[list[int], list[int]]] = field(default_factory=list)
    fold_provenance: list[dict[str, list[str]]] = field(default_factory=list)
    repetition: str | None = None
    identity: dict[str, object] = field(default_factory=dict)
    aggregate: AggregateSpec | None = None
    warnings: list[str] = field(default_factory=list)
    audits: list[dict] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Per-source: load + merge + role-split                                       #
# --------------------------------------------------------------------------- #
def _resolve_inputs(source: SourceSpec, base_dir: Path) -> list[Path]:
    import glob as _glob

    raw = source.input
    paths: list[str] = []
    for item in raw if isinstance(raw, list) else [raw]:
        text = str(item)
        if any(c in text for c in "*?["):
            paths.extend(sorted(_glob.glob(str(base_dir / text)) or _glob.glob(text)))
        else:
            p = base_dir / text
            paths.append(str(p if p.exists() else Path(text)))
    return [Path(p) for p in paths]


def _load_source_frame(source: SourceSpec, spec: DatasetSpec, base_dir: Path, audits: list[dict]) -> tuple[pd.DataFrame, str, str | None, list[str] | None]:
    params = effective_params(spec.params, source.params)
    paths = _resolve_inputs(source, base_dir)
    if not paths:
        raise SpecError(f"source '{source.id}': no input files resolved from {source.input!r}")
    tables = [read_table(p, params) for p in paths]
    for t in tables:
        if t.na_report.get("na_detected"):
            audits.append({"source": source.id, "na": t.na_report})
    header_unit = tables[0].header_unit
    signal = params.signal_type.value if params.signal_type else None
    origins: list[str] | None = None
    if len(tables) == 1:
        return tables[0].df, header_unit, signal, None
    frames = [t.df for t in tables]
    # use the convention engine's compound-extension-aware stem so `filename_stem`
    # is consistent (s1.csv.gz -> "s1", matching a reference keyed by stem), not "s1.csv"
    names = [get_stem(p.name) for p in paths]
    if source.merge is MergeMode.CONCAT_SAMPLES:
        df, origins, audit = concat_samples(frames, names)
    elif source.merge is MergeMode.CONCAT_FEATURES:
        df, audit = concat_features(frames, names, key=source.key)
    elif source.merge is MergeMode.BY_KEY:
        if source.key is None:
            raise SpecError(f"source '{source.id}': merge='by_key' requires a 'key'")
        df, audit = merge_by_key(frames, names, key=source.key)
    else:
        raise SpecError(f"source '{source.id}': multi-file input requires a merge mode")
    audits.append({"source": source.id, "merge": audit.operation, "warnings": audit.warnings})
    return df, header_unit, signal, origins


def _join_key_columns(source: SourceSpec) -> set[str]:
    cols: set[str] = set()
    if source.join is not None:
        for k in (source.join.left_on, source.join.right_on):
            if isinstance(k, str):
                cols.add(k)
            elif isinstance(k, list):
                cols.update(k)
    return cols


def _split_roles(source: SourceSpec, df: pd.DataFrame, dtypes: list[str]) -> dict[str, str]:
    """Map each column to a role per E.1 (ordered selectors / whole-source role)."""
    headers = list(df.columns)
    key_cols = set(source.key if isinstance(source.key, list) else [source.key] if source.key else [])
    # join keys are identity, not a role -> exempt from role coverage
    key_cols |= _join_key_columns(source)
    key_cols.add("filename_stem")  # reserved virtual key (vendor-corpus); never a role
    key_cols.add(_row_idx_col(source.id))  # reserved virtual key (variation row tracking); never a role
    roles: dict[str, str] = {}
    if source.role is not Role.MIXED and not source.columns:
        for col in headers:
            if col not in key_cols:
                roles[col] = source.role.value
        return roles

    assigned: set[int] = set()
    has_rest = any(isinstance(cr.select, RestSelector) for cr in source.columns)
    for cr in source.columns:
        if isinstance(cr.select, AutoSelector):
            idxs = _resolve_auto_selector(source.id, cr, headers, dtypes, assigned, key_cols)
        else:
            idxs = cr.select.resolve(headers, dtypes, assigned)
        for i in idxs:
            if i in assigned:
                if source.strict_columns:
                    raise SpecError(f"source '{source.id}': column '{headers[i]}' matched by multiple selectors (set strict_columns:false for first-match-wins)")
                continue
            assigned.add(i)
            if headers[i] not in key_cols:
                roles[headers[i]] = cr.role.value
    unmatched = [headers[i] for i in range(len(headers)) if i not in assigned and headers[i] not in key_cols]
    if unmatched and not has_rest:
        raise SpecError(f"source '{source.id}': columns {unmatched} are unassigned and no 'rest' selector is present")
    return roles


def _resolve_auto_selector(
    source_id: str,
    cr: ColumnRole,
    headers: list[str],
    dtypes: list[str],
    assigned: set[int],
    key_cols: set[str],
) -> list[int]:
    """Resolve an `auto` selector at load time using deterministic, role-aware heuristics.

    - Explicit ``candidates`` always win when one of them is present in the
      headers (case-sensitive); the first matching candidate is used.
    - Otherwise the role decides:
        * ``features``        -> every unassigned numeric column.
        * ``targets``         -> the last unassigned numeric column (a single column).
        * ``metadata``        -> every unassigned non-numeric column.
        * ``ignore``          -> every unassigned column.
        * ``weights``         -> requires explicit ``candidates`` (no safe default).

    The resolution is **deterministic** (no shuffling, no model in the loop):
    it inspects only the loaded frame's column names and dtypes. A user who
    wants a more nuanced choice should run ``infer()`` and store its
    accepted plan as a concrete spec.
    """
    selector = cr.select
    assert isinstance(selector, AutoSelector)
    candidates = list(selector.candidates)
    if candidates:
        for name in candidates:
            if name in headers and name not in key_cols:
                idx = headers.index(name)
                if idx not in assigned:
                    return [idx]
        raise SpecError(f"source '{source_id}': auto selector with candidates {candidates} matched no available column (headers: {headers})")
    role = cr.role
    free = [i for i, h in enumerate(headers) if i not in assigned and h not in key_cols]
    numeric = [i for i in free if dtypes[i] == "numeric"]
    non_numeric = [i for i in free if dtypes[i] != "numeric"]
    if role is Role.FEATURES:
        if not numeric:
            raise SpecError(f"source '{source_id}': auto features selector found no unassigned numeric columns")
        return numeric
    if role is Role.TARGETS:
        if not numeric:
            raise SpecError(f"source '{source_id}': auto targets selector found no unassigned numeric columns (provide explicit candidates for a categorical target)")
        return [numeric[-1]]
    if role is Role.METADATA:
        if not non_numeric:
            raise SpecError(f"source '{source_id}': auto metadata selector found no unassigned non-numeric columns")
        return non_numeric
    if role is Role.IGNORE:
        return free
    raise SpecError(f"source '{source_id}': auto selector for role '{role.value}' requires explicit candidates")


def _build_source_table(source: SourceSpec, spec: DatasetSpec, base_dir: Path, audits: list[dict]) -> SourceTable:
    df, header_unit, signal, origins = _load_source_frame(source, spec, base_dir, audits)
    from .loaders import infer_dtypes

    # materialize the `filename_stem` virtual key from concat_samples origins so a
    # vendor-corpus lookup can join spectra to a reference by file stem (E.2).
    if origins is not None and "filename_stem" not in df.columns:
        df = df.copy()
        df["filename_stem"] = origins
    # derive the grouped sample id (e.g. mango_001_a -> mango_001) for vendor replicates
    si = spec.sample_index
    if si.derive_from and si.derive_from in df.columns and isinstance(si.key, str) and si.key not in df.columns:
        df = df.copy()
        derived = df[si.derive_from].astype(str)
        df[si.key] = derived.str.replace(si.derive_pattern, "", regex=True) if si.derive_pattern else derived
    roles = _split_roles(source, df, infer_dtypes(df))
    for identity_column in (si.key, si.observation_id, si.repetition_id, si.group_id):
        if isinstance(identity_column, str):
            roles.pop(identity_column, None)
            if identity_column in df.columns:
                # Preserve declared identity as sample-aligned metadata while
                # preventing it from becoming an X/y role.
                roles[identity_column] = "metadata"
    # stamp a per-source positional row index AFTER role-splitting so it does
    # not shift positional selectors (e.g. `-1` keeps pointing at the last user
    # column, not at the row-idx sentinel). The column survives joins as any
    # other column and is used to re-align variations to the combined frame.
    row_idx_name = _row_idx_col(source.id)
    if row_idx_name in df.columns:
        raise SpecError(f"source '{source.id}': reserved column name '{row_idx_name}' collides with a user-supplied column; rename it")
    df = df.copy()
    df[row_idx_name] = np.arange(len(df), dtype=np.int64)
    key = source.key if isinstance(source.key, list) else [source.key] if source.key else None
    partition = source.partition.value if source.partition else None
    variations = _load_variations(source, spec, base_dir, df, roles)
    return SourceTable(
        source_id=source.id,
        df=df,
        roles=roles,
        key=key,
        partition=partition,
        kind=source.kind.value,
        join=source.join,
        modality=source.modality.value if source.modality else None,
        signal_type=signal or (spec.signal_type.value if spec.signal_type.value != "auto" else None),
        header_unit=header_unit,
        origins=origins,
        variations=variations,
    )


def _resolve_variation_inputs(input_val: Any, base_dir: Path) -> list[Path]:
    """Resolve a variation's input (path/glob/list-of-paths) -- mirrors _resolve_inputs."""
    import glob as _glob

    paths: list[str] = []
    for item in input_val if isinstance(input_val, list) else [input_val]:
        text = str(item)
        if any(c in text for c in "*?["):
            paths.extend(sorted(_glob.glob(str(base_dir / text)) or _glob.glob(text)))
        else:
            p = base_dir / text
            paths.append(str(p if p.exists() else Path(text)))
    return [Path(p) for p in paths]


def _read_variation_frame(variation: VariationSpec, spec: DatasetSpec, source: SourceSpec, base_dir: Path) -> pd.DataFrame:
    """Load (and concatenate, if multi-file) a variation into a single frame.

    A variation file has the same row order as the parent source's loaded frame
    (post-merge). Multiple files concatenate by samples (rows) so the row count
    matches the parent's post-merge row count -- same semantics as the parent's
    own ``concat_samples`` flow.
    """
    params = effective_params(spec.params, source.params)
    if variation.params.to_dict():
        params = effective_params(params, variation.params)
    paths = _resolve_variation_inputs(variation.input, base_dir)
    if not paths:
        raise SpecError(f"source '{source.id}': variation '{variation.name}': no input files resolved from {variation.input!r}")
    frames = [read_table(p, params).df for p in paths]
    return pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]


def _load_variations(source: SourceSpec, spec: DatasetSpec, base_dir: Path, parent_df: pd.DataFrame, roles: dict[str, str]) -> list[tuple[str, np.ndarray]]:
    """Materialize a feature source's named preprocessing variants into arrays.

    Each variation must row-align with the parent source (post-merge) and provide
    one column per parent *feature* column. Two unambiguous modes are accepted:
    (a) *full name match* -- every parent feature column is present in the
    variation frame (vendor exports usually preserve wavelength headers); or
    (b) *full positional* -- no parent feature header appears in the variation
    frame and ``shape[1] == len(feature_cols)``. Anything between (partial name
    match) raises rather than silently realigning, because a renamed/missing
    column would otherwise be quietly swapped for an unrelated value column.

    The resulting (name, array) tuples are later re-indexed by ``__src_row_idx__``
    so joins/partitions on the parent propagate automatically to the variations.
    """
    if not source.variations:
        return []
    if source.role is not Role.FEATURES and not any(r == "features" for r in roles.values()):
        raise SpecError(f"source '{source.id}': variations are only meaningful on a feature source (role/columns must declare 'features')")
    feature_cols = [c for c, r in roles.items() if r == "features"]
    if not feature_cols:
        raise SpecError(f"source '{source.id}': has variations but no feature columns to attach them to")
    parent_n = len(parent_df)
    out: list[tuple[str, np.ndarray]] = []
    seen: set[str] = set()
    for variation in source.variations:
        if variation.name in seen:
            raise SpecError(f"source '{source.id}': duplicate variation name '{variation.name}'")
        seen.add(variation.name)
        vdf = _read_variation_frame(variation, spec, source, base_dir)
        if len(vdf) != parent_n:
            raise SpecError(f"source '{source.id}': variation '{variation.name}' has {len(vdf)} rows, expected {parent_n} (must row-align with the parent source)")
        named = sum(1 for c in feature_cols if c in vdf.columns)
        if named == len(feature_cols):
            arr = coerce_numeric(vdf[feature_cols])
        elif named == 0 and vdf.shape[1] == len(feature_cols):
            arr = coerce_numeric(vdf)
        else:
            raise SpecError(
                f"source '{source.id}': variation '{variation.name}' is ambiguous: "
                f"{named}/{len(feature_cols)} parent feature columns matched by name "
                f"and the frame has {vdf.shape[1]} columns. Either include all "
                f"parent feature headers or supply exactly {len(feature_cols)} unnamed (positional) columns."
            )
        out.append((variation.name, arr))
    return out


# --------------------------------------------------------------------------- #
# Partition splitting (PartitionAssigner subset: column / index / index_file) #
# --------------------------------------------------------------------------- #
def _split_partition_mask(df: pd.DataFrame, spec: DatasetSpec, base_dir: Path) -> dict[str, np.ndarray]:
    """Return a {partition -> boolean row mask} for a single combined frame.

    Only deterministic-by-construction modes are supported (no shuffling at load
    time): ``by: column`` (split on a column's values), ``by: index`` (explicit
    row-index lists), ``by: index_file`` (lists read from a file). A user who
    wants a stratified or percentage split should pre-compute the indices once
    and feed them as an index list / column, or do the split inside the
    pipeline's CV layer.
    """
    p = spec.partitions
    n = len(df)
    if p is None or p.by is None:
        return {"train": np.ones(n, dtype=bool)}
    if p.by is PartitionBy.COLUMN:
        if p.column not in df.columns:
            raise SpecError(f"partitions.column '{p.column}' not found in the assembled data (columns: {list(df.columns)})")
        col = df[p.column].astype(str).str.lower()
        train_vals = {str(v).lower() for v in p.train_values}
        test_vals = {str(v).lower() for v in p.test_values}
        predict_vals = {str(v).lower() for v in p.predict_values}
        known = train_vals | test_vals | predict_vals
        train_mask = col.isin(train_vals).to_numpy()
        test_mask = col.isin(test_vals).to_numpy()
        unknown_mask = (~col.isin(known)).to_numpy()
        if unknown_mask.any():
            from ..spec.enums import UnknownPolicy

            if p.unknown_policy is UnknownPolicy.ERROR:
                raise SpecError(f"partitions: unknown values in '{p.column}': {sorted(set(col[unknown_mask]))}")
            if p.unknown_policy is UnknownPolicy.TRAIN:
                train_mask = train_mask | unknown_mask
            elif p.unknown_policy is UnknownPolicy.TEST:
                test_mask = test_mask | unknown_mask
            # DROP: leave unknown rows out of every partition
        masks = {"train": train_mask, "test": test_mask}
        if predict_vals:
            masks["predict"] = col.isin(predict_vals).to_numpy()
        return {k: v for k, v in masks.items() if v.any()}
    if p.by is PartitionBy.INDEX:
        return _mask_from_index_lists({"train": p.train, "test": p.test, "predict": p.predict}, n, source="partitions")
    if p.by is PartitionBy.INDEX_FILE:
        loaded = {
            "train": _read_index_file(base_dir / p.train_file) if p.train_file else None,
            "test": _read_index_file(base_dir / p.test_file) if p.test_file else None,
            "predict": _read_index_file(base_dir / p.predict_file) if p.predict_file else None,
        }
        return _mask_from_index_lists(loaded, n, source="index file")
    raise SpecError(f"partitions.by={p.by.value} is not supported by the assembler")


def _mask_from_index_lists(by_part: dict[str, Any], n: int, *, source: str) -> dict[str, np.ndarray]:
    """Validate per-partition row-index lists and turn them into boolean masks.

    Indices must be in [0, n), unique within a partition, and disjoint across
    partitions; a row may belong to at most one partition (rows not listed
    anywhere are simply omitted).
    """
    masks: dict[str, np.ndarray] = {}
    seen: dict[int, str] = {}
    for part, raw in by_part.items():
        if raw is None:
            continue
        if not isinstance(raw, (list, tuple, np.ndarray)):
            raise SpecError(f"{source}: '{part}' must be a list of row indices, got {type(raw).__name__}")
        idx_list = [int(v) for v in raw]
        if any(i < 0 or i >= n for i in idx_list):
            raise SpecError(f"{source}: '{part}' contains out-of-range indices (n={n}): {[i for i in idx_list if i < 0 or i >= n]}")
        if len(set(idx_list)) != len(idx_list):
            raise SpecError(f"{source}: '{part}' contains duplicate indices")
        for i in idx_list:
            if i in seen and seen[i] != part:
                raise SpecError(f"{source}: row {i} listed in both '{seen[i]}' and '{part}' (partitions must be disjoint)")
            seen[i] = part
        m = np.zeros(n, dtype=bool)
        m[idx_list] = True
        masks[part] = m
    if not masks:
        raise SpecError(f"{source}: no partition lists provided")
    return masks


def _read_index_file(path: Path) -> list[int]:
    """Read a row-index list from a file. Accepts JSON arrays, CSV/TXT one-per-line, or comma-separated."""
    if not path.exists():
        raise SpecError(f"partitions.index_file: file not found: {path}")
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    if text.startswith("["):
        return [int(v) for v in json.loads(text)]
    # csv/txt: whitespace and/or comma separated; ignore blanks
    tokens = [t.strip() for t in text.replace(",", "\n").splitlines() if t.strip()]
    return [int(t) for t in tokens]


# --------------------------------------------------------------------------- #
# Assembly                                                                     #
# --------------------------------------------------------------------------- #
def assemble(spec: DatasetSpec, base_dir: str | Path = ".") -> AssembledDataset:
    """Load, role-split, join and partition ``spec`` into an AssembledDataset."""
    base_dir = Path(base_dir)
    audits: list[dict] = []
    tables = {s.id: _build_source_table(s, spec, base_dir, audits) for s in spec.sources}

    # group sources by partition; sources without a partition are single-partition ("train" unless split)
    partitions = sorted({t.partition for t in tables.values() if t.partition} - {None})
    assembled = AssembledDataset(
        name=spec.name or "dataset",
        task_type=spec.task_type.value,
        signal_type=spec.signal_type.value,
        n_sources=sum(1 for t in tables.values() if t.kind != SourceKind.LOOKUP.value and _has_role(t, "features")),
        repetition=spec.repetition or (spec.sample_index.repetition_id if spec.sample_index.repetition_id and spec.sample_index.repetition_id != "auto" else None),
        identity={
            "source_ids": [t.source_id for t in tables.values() if t.kind != SourceKind.LOOKUP.value and _has_role(t, "features")],
            "sample_id": spec.sample_index.key if spec.sample_index.by.value == "id" and isinstance(spec.sample_index.key, str) else None,
            "observation_id": spec.sample_index.observation_id,
            "repetition_id": spec.sample_index.repetition_id,
            "group_id": spec.sample_index.group_id,
        },
        aggregate=spec.aggregate,
    )

    combined_df: pd.DataFrame | None = None
    if partitions:
        for part in partitions:
            part_tables = {sid: t for sid, t in tables.items() if t.partition == part or t.kind == SourceKind.LOOKUP.value}
            assembled.blocks[part], _ = _assemble_block(part_tables, spec, audits, assembled.warnings)
    else:
        block, combined_df = _assemble_block(dict(tables), spec, audits, assembled.warnings)
        if spec.partitions is None:
            assembled.blocks["train"] = block
        else:
            # split on the FINAL (post-join) frame so masks line up with the assembled rows
            for part, mask in _split_partition_mask(combined_df, spec, base_dir).items():
                assembled.blocks[part] = _slice_block(block, mask)

    assembled.audits = audits
    _attach_folds(spec, base_dir, assembled, combined_df)
    return assembled


def _has_role(table: SourceTable, role: str) -> bool:
    return any(r == role for r in table.roles.values())


def _assemble_block(tables: dict[str, SourceTable], spec: DatasetSpec, audits: list[dict], warnings: list[str]) -> tuple[PartitionBlock, pd.DataFrame]:
    feature_tables = [t for t in tables.values() if t.kind != SourceKind.LOOKUP.value and _has_role(t, "features")]
    if not feature_tables:
        raise SpecError("partition has no feature source")
    primary = feature_tables[0]
    combined = primary.df.copy()

    # join every non-primary source (extra features, targets, metadata, lookups) onto the primary rows
    for t in tables.values():
        if t.source_id == primary.source_id:
            continue
        combined = _join_onto(combined, primary, t, audits, warnings)

    # role -> columns across all joined sources
    role_cols = _collect_roles(combined, tables)

    block = PartitionBlock(n_samples=len(combined))
    # multi-source X: each feature source contributes its own array (aligned to combined rows)
    for ft in feature_tables:
        cols, headers = _source_feature_columns(combined, role_cols, ft)
        if not cols:
            continue
        block.source_ids.append(ft.source_id)
        block.X.append(coerce_numeric(combined[cols]))
        block.feature_headers.append(headers)
        block.header_units.append(ft.header_unit)
        block.signal_types.append(ft.signal_type)
        # variations: re-align each pre-loaded array to the combined frame using
        # the parent source's positional row index (which survives joins as a
        # regular column).
        src_processings: list[tuple[str, np.ndarray]] = []
        if ft.variations:
            idx_col = _row_idx_col(ft.source_id)
            if idx_col not in combined.columns:
                raise SpecError(f"source '{ft.source_id}': row-index column '{idx_col}' lost during assembly; variations cannot be aligned")
            row_idx = combined[idx_col].to_numpy(dtype=np.int64)
            for name, arr in ft.variations:
                src_processings.append((name, arr[row_idx, :]))
        block.processings.append(src_processings)

    target_cols = [c for c, rs in role_cols.items() if rs[0] == "targets"]
    if target_cols:
        y_series, cats = [], {}
        for c in target_cols:
            mode = (spec.params.categorical.value if spec.params.categorical else "auto")
            enc, mapping = encode_categorical(combined[c], mode)
            y_series.append(enc.to_numpy())
            if mapping:
                cats[c] = mapping
        block.y = np.column_stack(y_series)
        block.y_headers = target_cols
        block.y_categorical = cats

    weight_cols = [c for c, rs in role_cols.items() if rs[0] == "weights"]
    if weight_cols:
        if len(weight_cols) > 1:
            raise SpecError(f"only one 'weights' column is supported, got {weight_cols} (combine them upstream before declaring)")
        block.weights = pd.to_numeric(combined[weight_cols[0]], errors="coerce").to_numpy(dtype=np.float32)
        block.weights_header = weight_cols[0]

    meta_cols = [c for c, rs in role_cols.items() if rs[0] == "metadata"]
    if meta_cols:
        block.metadata = combined[meta_cols].reset_index(drop=True)
    return block, combined.reset_index(drop=True)


def _row_align(combined: pd.DataFrame, t: SourceTable, primary: SourceTable) -> pd.DataFrame:
    if len(t.df) != len(combined):
        raise SpecError(f"source '{t.source_id}' ({len(t.df)} rows) is not row-aligned with '{primary.source_id}' ({len(combined)} rows); supply a join key")
    merged, _ = concat_features([combined.reset_index(drop=True), t.df.reset_index(drop=True)], [primary.source_id, t.source_id])
    return merged


def _as_key_list(on: str | list[str] | None) -> list[str] | None:
    if on is None:
        return None
    return [on] if isinstance(on, str) else list(on)


def _join_onto(combined: pd.DataFrame, primary: SourceTable, t: SourceTable, audits: list[dict], warnings: list[str]) -> pd.DataFrame:
    if t.join is not None:
        j = t.join
        left_on = _as_key_list(j.left_on)  # left keys reference the accumulating combined frame
        right_on = _as_key_list(j.right_on) or _as_key_list(t.key)
        if left_on is not None and right_on is not None:
            missing_l = [c for c in left_on if c not in combined.columns]
            missing_r = [c for c in right_on if c not in t.df.columns]
            if missing_l or missing_r:
                # keys were declared but are absent -> hard error, never a silent row-align (Codex)
                raise SpecError(f"source '{t.source_id}': join keys not found (left missing {missing_l} in assembled data, right missing {missing_r} in '{t.source_id}')")
            out, audit = join_tables(combined, t.df, left_on=left_on, right_on=right_on, cardinality=j.cardinality, coverage=j.coverage, left_name=j.left or primary.source_id, right_name=t.source_id)
            audits.append({"join": audit.operation, "dropped": len(audit.dropped_rows), "warnings": audit.warnings})
            warnings.extend(audit.warnings)
            return out
        if j.cardinality is Cardinality.ONE_TO_ONE:
            return _row_align(combined, t, primary)  # 1:1 with no declared keys -> row order
        raise SpecError(f"source '{t.source_id}': {j.cardinality.value} join needs explicit left_on/right_on")
    # no join spec: align by a shared key (1:1) if both declare one, else row order
    lkeys, rkeys = _as_key_list(primary.key), _as_key_list(t.key)
    if lkeys and rkeys and all(c in combined.columns for c in lkeys) and all(c in t.df.columns for c in rkeys):
        out, audit = join_tables(combined, t.df, left_on=lkeys, right_on=rkeys, cardinality=Cardinality.ONE_TO_ONE, coverage=Coverage.COMPLETE, left_name=primary.source_id, right_name=t.source_id)
        warnings.extend(audit.warnings)
        return out
    return _row_align(combined, t, primary)


def _collect_roles(combined: pd.DataFrame, tables: dict[str, SourceTable]) -> dict[str, tuple[str, str]]:
    """Map each combined column -> (role, owning_source_id)."""
    role_cols: dict[str, tuple[str, str]] = {}
    for t in tables.values():
        for col, role in t.roles.items():
            if col in combined.columns and col not in role_cols:
                role_cols[col] = (role, t.source_id)
            else:
                for ns in (f"{col}__{t.source_id}", f"{t.source_id}__{col}"):
                    if ns in combined.columns:
                        role_cols[ns] = (role, t.source_id)
                        break
    return role_cols


def _source_feature_columns(combined: pd.DataFrame, role_cols: dict[str, tuple[str, str]], source: SourceTable) -> tuple[list[str], list[str]]:
    """Return combined-frame columns plus source-native headers for one feature source.

    Relational joins namespace duplicate right-hand columns as ``<col>__<source>``;
    row-order feature concatenation namespaces them as ``<source>__<col>``. The
    package keeps feature sources separate, so headers should remain the source's
    native axis labels while ``cols`` points at the actual combined-frame columns.
    """
    cols: list[str] = []
    headers: list[str] = []
    for col in combined.columns:
        if role_cols.get(col) != ("features", source.source_id):
            continue
        cols.append(col)
        headers.append(_source_feature_header(col, source))
    return cols, headers


def _source_feature_header(combined_col: str, source: SourceTable) -> str:
    if source.roles.get(combined_col) == "features":
        return combined_col
    suffix = f"__{source.source_id}"
    if combined_col.endswith(suffix):
        bare = combined_col[: -len(suffix)]
        if source.roles.get(bare) == "features":
            return bare
    prefix = f"{source.source_id}__"
    if combined_col.startswith(prefix):
        bare = combined_col[len(prefix) :]
        if source.roles.get(bare) == "features":
            return bare
    return combined_col


def _slice_block(block: PartitionBlock, mask: np.ndarray) -> PartitionBlock:
    out = PartitionBlock(n_samples=int(mask.sum()))
    out.source_ids = list(block.source_ids)
    out.X = [x[mask] for x in block.X]
    out.feature_headers = list(block.feature_headers)
    out.header_units = list(block.header_units)
    out.signal_types = list(block.signal_types)
    out.processings = [[(name, arr[mask]) for name, arr in src] for src in block.processings]
    out.y = block.y[mask] if block.y is not None else None
    out.y_headers = list(block.y_headers)
    out.y_categorical = dict(block.y_categorical)
    out.metadata = block.metadata.iloc[mask].reset_index(drop=True) if block.metadata is not None else None
    out.weights = block.weights[mask] if block.weights is not None else None
    out.weights_header = block.weights_header
    return out


def _attach_folds(spec: DatasetSpec, base_dir: Path, assembled: AssembledDataset, combined_df: pd.DataFrame | None = None) -> None:
    if spec.folds is None:
        return
    if spec.folds.inline:
        assembled.folds = [(list(f.get("train", [])), list(f.get("val", f.get("test", [])))) for f in spec.folds.inline]
    elif spec.folds.column:
        # each distinct value of the fold column defines one fold: val = its rows, train = rest
        if combined_df is None:
            raise SpecError(f"folds.column='{spec.folds.column}' requires a single combined frame (it does not apply with explicit per-source partitions)")
        if spec.folds.column not in combined_df.columns:
            raise SpecError(f"folds.column='{spec.folds.column}' not found in the assembled data (columns: {list(combined_df.columns)})")
        col = combined_df[spec.folds.column]
        all_idx = list(range(len(col)))
        folds: list[tuple[list[int], list[int]]] = []
        for value in sorted(col.dropna().unique(), key=lambda v: str(v)):
            val_set = set(col.index[col == value].tolist())
            val_idx = sorted(val_set)
            train_idx = [i for i in all_idx if i not in val_set]
            folds.append((train_idx, val_idx))
        if not folds:
            raise SpecError(f"folds.column='{spec.folds.column}' has no non-NaN values")
        assembled.folds = folds
    elif spec.folds.file:
        from .folds import parse_fold_file

        assembled.folds = parse_fold_file(base_dir / spec.folds.file, spec.folds.format.value)

    identity_column = spec.sample_index.observation_id or (
        spec.sample_index.key if spec.sample_index.by.value == "id" and isinstance(spec.sample_index.key, str) else None
    )
    if combined_df is not None and identity_column in combined_df.columns:
        values = combined_df[identity_column]
        def translate(indices: list[int]) -> list[str] | None:
            out: list[str] = []
            for index in indices:
                if index < 0 or index >= len(values) or pd.isna(values.iloc[index]):
                    return None
                value = str(values.iloc[index])
                if not value.strip():
                    return None
                out.append(value)
            return out
        provenance = [
            {"train_observation_ids": train, "validation_observation_ids": validation}
            for train_idx, validation_idx in assembled.folds
            if (train := translate(train_idx)) is not None and (validation := translate(validation_idx)) is not None
        ]
        if len(provenance) == len(assembled.folds):
            assembled.fold_provenance = provenance
