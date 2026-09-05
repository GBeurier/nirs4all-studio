# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Relational merge/join engine (Epic 4.0).

``nirs4all-io`` performs every join/broadcast itself (dag-ml-data does not join,
Critique C13). This module operates on pandas ``DataFrame``s and is **role-
agnostic** — column roles are tracked by the builder; here we only align rows.

- ``concat_samples`` — vertically stack rows (schema-union), tracking origin.
- ``concat_features`` — horizontally stack column-blocks (by key or row order).
- ``merge_by_key`` — relational join of a list of frames on a shared key.
- ``join_tables`` — a single cross-source join with **cardinality** (1:1/m:1/1:m),
  **duplicate-key** rules, **coverage** (complete/warn/drop/error) and a
  **dropped-row audit** (Critique C8). Cardinality/duplicate violations are
  always errors, independent of ``coverage`` (E.2).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from ..spec.enums import Cardinality, Coverage, SpecError


class JoinError(SpecError):
    """A cardinality, duplicate-key, or coverage violation."""


@dataclass
class JoinAudit:
    operation: str
    n_left: int = 0
    n_right: int = 0
    n_result: int = 0
    n_matched: int = 0
    dropped_rows: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _keys(on: str | list[str]) -> list[str]:
    return [on] if isinstance(on, str) else list(on)


def _require_columns(df: pd.DataFrame, cols: list[str], where: str) -> None:
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise JoinError(f"{where}: key column(s) {missing} not found (have {list(df.columns)})")


def _key_tuples(df: pd.DataFrame, keys: list[str]) -> list[tuple]:
    if len(keys) == 1:
        return list(df[keys[0]])
    return [tuple(row) for row in df[keys].itertuples(index=False, name=None)]


def concat_samples(frames: list[pd.DataFrame], names: list[str]) -> tuple[pd.DataFrame, list[str], JoinAudit]:
    """Vertically stack rows with a schema-union of columns; track origin per row."""
    if not frames:
        return pd.DataFrame(), [], JoinAudit(operation="concat_samples")
    origins: list[str] = []
    for frame, name in zip(frames, names, strict=False):
        origins.extend([name] * len(frame))
    stacked = pd.concat(frames, axis=0, ignore_index=True, sort=False)
    audit = JoinAudit(operation="concat_samples", n_result=len(stacked))
    union_cols = set().union(*(set(f.columns) for f in frames))
    common = set(frames[0].columns)
    for f in frames[1:]:
        common &= set(f.columns)
    if union_cols != common:
        audit.warnings.append(f"concat_samples schema-union: {len(union_cols - common)} column(s) not shared across files were null-filled")
    return stacked, origins, audit


def concat_features(frames: list[pd.DataFrame], names: list[str], *, key: str | list[str] | None = None) -> tuple[pd.DataFrame, JoinAudit]:
    """Horizontally stack column-blocks for the same samples (by key or row order)."""
    if not frames:
        return pd.DataFrame(), JoinAudit(operation="concat_features")
    audit = JoinAudit(operation="concat_features")
    if key is not None:
        # same samples in each block -> validated 1:1 join (unique keys, complete coverage),
        # NOT a raw inner merge (which would silently multiply dup keys / drop missing keys).
        out = frames[0]
        for frame, name in zip(frames[1:], names[1:], strict=False):
            out, step = join_tables(out, frame, left_on=key, right_on=key, cardinality=Cardinality.ONE_TO_ONE, coverage=Coverage.COMPLETE, left_name=names[0], right_name=name)
            audit.warnings.extend(step.warnings)
        audit.n_result = len(out)
        return out, audit
    lengths = {len(f) for f in frames}
    if len(lengths) > 1:
        raise JoinError(f"concat_features by row order needs equal row counts, got {sorted(lengths)} (supply a 'key')")
    renamed = []
    seen: set[str] = set()
    for frame, name in zip(frames, names, strict=False):
        cols = {c: (c if c not in seen else f"{name}__{c}") for c in frame.columns}
        seen.update(cols.values())
        renamed.append(frame.rename(columns=cols).reset_index(drop=True))
    out = pd.concat(renamed, axis=1)
    audit.n_result = len(out)
    return out, audit


def join_tables(
    left: pd.DataFrame,
    right: pd.DataFrame,
    *,
    left_on: str | list[str],
    right_on: str | list[str],
    cardinality: Cardinality,
    coverage: Coverage,
    left_name: str = "left",
    right_name: str = "right",
) -> tuple[pd.DataFrame, JoinAudit]:
    """Join ``right`` onto ``left`` honoring cardinality, duplicate rules, coverage."""
    lkeys, rkeys = _keys(left_on), _keys(right_on)
    _require_columns(left, lkeys, left_name)
    _require_columns(right, rkeys, right_name)
    if len(lkeys) != len(rkeys):
        raise JoinError(f"join keys must have equal arity: {lkeys} vs {rkeys}")

    left_dup = bool(left.duplicated(subset=lkeys).any())
    right_dup = bool(right.duplicated(subset=rkeys).any())
    if cardinality is Cardinality.ONE_TO_ONE:
        if left_dup:
            raise JoinError(f"1:1 join: duplicate keys on left '{left_name}'")
        if right_dup:
            raise JoinError(f"1:1 join: duplicate keys on right '{right_name}'")
    elif cardinality is Cardinality.MANY_TO_ONE:
        if right_dup:
            raise JoinError(f"m:1 join: duplicate keys on the right (lookup) '{right_name}' — a dimension table must be unique on {rkeys}")
    elif cardinality is Cardinality.ONE_TO_MANY:
        if left_dup:
            raise JoinError(f"1:m join: duplicate keys on left '{left_name}' on {lkeys}")

    right_keyset = set(_key_tuples(right, rkeys))
    left_tuples = _key_tuples(left, lkeys)
    missing = [k for k in left_tuples if k not in right_keyset]
    missing_unique = list(dict.fromkeys(missing))

    if missing and coverage is Coverage.COMPLETE:
        preview = missing_unique[:10]
        raise JoinError(f"coverage 'complete': {len(missing_unique)} key(s) in '{left_name}' have no match in '{right_name}': {preview}{' ...' if len(missing_unique) > 10 else ''}")
    if missing and coverage is Coverage.ERROR:
        raise JoinError(f"coverage 'error': key {missing[0]!r} from '{left_name}' not found in '{right_name}'")

    how = "inner" if coverage is Coverage.DROP else "left"
    merged = left.merge(right, how=how, left_on=lkeys, right_on=rkeys, suffixes=("", f"__{right_name}"))
    # drop redundant right key columns when names differ (they duplicate the left keys)
    drop_cols = [rk for rk in rkeys if rk not in lkeys and rk in merged.columns]
    if drop_cols:
        merged = merged.drop(columns=drop_cols)

    audit = JoinAudit(
        operation=f"{cardinality.value} join '{left_name}' <- '{right_name}'",
        n_left=len(left),
        n_right=len(right),
        n_result=len(merged),
        n_matched=len(left_tuples) - len(missing),
    )
    if missing and coverage is Coverage.DROP:
        audit.dropped_rows = [{"key": k, "reason": "unmatched_left"} for k in missing_unique]
        audit.warnings.append(f"coverage 'drop': removed {len(missing)} unmatched row(s) from '{left_name}' ({len(missing_unique)} distinct key(s))")
    if missing and coverage is Coverage.WARN:
        audit.warnings.append(f"coverage 'warn': {len(missing_unique)} key(s) in '{left_name}' unmatched in '{right_name}'; right columns null-filled")
    return merged, audit


def merge_by_key(frames: list[pd.DataFrame], names: list[str], *, key: str | list[str], coverage: Coverage = Coverage.COMPLETE) -> tuple[pd.DataFrame, JoinAudit]:
    """Relational 1:1 join of several frames on a shared key (the ``by_key`` merge)."""
    if not frames:
        return pd.DataFrame(), JoinAudit(operation="by_key")
    out, audit = frames[0], JoinAudit(operation="by_key", n_result=len(frames[0]))
    for frame, name in zip(frames[1:], names[1:], strict=False):
        out, step = join_tables(out, frame, left_on=key, right_on=key, cardinality=Cardinality.ONE_TO_ONE, coverage=coverage, left_name=names[0], right_name=name)
        audit.warnings.extend(step.warnings)
        audit.dropped_rows.extend(step.dropped_rows)
        audit.n_result = step.n_result
    return out, audit
