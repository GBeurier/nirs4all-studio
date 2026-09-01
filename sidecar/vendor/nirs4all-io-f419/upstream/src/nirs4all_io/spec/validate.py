# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Structural validation of a :class:`DatasetSpec` (Appendix A.14, story 2.1).

Validation covers what can be checked *without* reading the data: schema
version, unique source ids, join references, identity/key requirements,
merge/columns invariants, and lookup wiring. Data-dependent checks (column
overlap for regex/dtype selectors, row-count alignment) happen at load time.
"""

from __future__ import annotations

from .dataset_spec import DatasetSpec, SourceSpec
from .enums import Cardinality, MergeMode, Role, SampleIndexBy, SourceKind, SpecError
from .selectors import AutoSelector, RestSelector

SUPPORTED_SCHEMA_VERSIONS = (1,)


def validate_spec(spec: DatasetSpec) -> None:
    """Raise :class:`SpecError` (with all problems) if ``spec`` is invalid."""
    errors: list[str] = []

    if spec.schema_version not in SUPPORTED_SCHEMA_VERSIONS:
        errors.append(f"schema_version {spec.schema_version} is not supported (supported: {SUPPORTED_SCHEMA_VERSIONS})")

    if not spec.sources:
        errors.append("a DatasetSpec needs at least one source")

    ids = [s.id for s in spec.sources]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        errors.append(f"duplicate source ids: {sorted(dupes)}")
    id_set = set(ids)

    if spec.sample_index.by == SampleIndexBy.ID and not spec.sample_index.key:
        errors.append("sample_index.by='id' requires a 'key'")

    has_features = False
    for src in spec.sources:
        _validate_source(src, id_set, errors)
        if src.kind != SourceKind.LOOKUP and src.role in (Role.FEATURES, Role.MIXED):
            has_features = True

    if not has_features:
        errors.append("no source produces features (need a source with role 'features' or 'mixed')")

    # lookup sources must be wired via a join (their own, or referenced by another)
    referenced = {s.join.right for s in spec.sources if s.join}
    for src in spec.sources:
        if src.kind == SourceKind.LOOKUP and src.join is None and src.id not in referenced:
            errors.append(f"lookup source '{src.id}' is never joined (give it a 'join' or reference it from another source's join)")

    _validate_partitions(spec, errors)
    _validate_folds(spec, errors)

    if errors:
        raise SpecError("invalid DatasetSpec:\n  - " + "\n  - ".join(errors))


def _validate_source(src: SourceSpec, id_set: set[str], errors: list[str]) -> None:
    where = f"source '{src.id}'"

    if isinstance(src.input, list) and len(src.input) > 1 and src.merge == MergeMode.NONE:
        errors.append(f"{where}: a multi-file input requires a 'merge' mode (concat_samples|concat_features|by_key)")

    if src.merge == MergeMode.BY_KEY and not src.key:
        errors.append(f"{where}: merge='by_key' requires a 'key'")
    if src.merge == MergeMode.CONCAT_FEATURES and not src.key:
        # falls back to row order, but warn-as-error only if ids differ is data-dependent; allow.
        pass

    # column-role invariants
    rest_count = sum(1 for c in src.columns if isinstance(c.select, RestSelector))
    if rest_count > 1:
        errors.append(f"{where}: at most one 'rest' selector allowed (found {rest_count})")
    if src.columns and src.role not in (Role.MIXED,) and not _all_same_role(src):
        # mixed roles inside a non-'mixed' source are contradictory
        errors.append(f"{where}: declares per-column roles but source role is '{src.role.value}' (use role 'mixed')")
    for c in src.columns:
        if isinstance(c.select, AutoSelector) and c.role != Role.FEATURES and not c.select.candidates:
            # an 'auto' selector should advertise candidate roles for the inference engine
            pass

    # join references
    if src.join is not None:
        j = src.join
        if j.right not in id_set:
            errors.append(f"{where}: join.right '{j.right}' is not a known source id")
        left = j.left or src.id
        if left not in id_set:
            errors.append(f"{where}: join.left '{left}' is not a known source id")
        if j.cardinality in (Cardinality.MANY_TO_ONE, Cardinality.ONE_TO_MANY) and (j.left_on is None or j.right_on is None):
            # broadcast joins need explicit join keys; the per-source 'key' is
            # sample-axis alignment, NOT a relational join key (kept distinct).
            errors.append(f"{where}: {j.cardinality.value} join needs explicit left_on/right_on (the shorthand 'on' sets both; a per-source 'key' is alignment, not a join key)")


def _all_same_role(src: SourceSpec) -> bool:
    roles = {c.role for c in src.columns}
    return len(roles) <= 1


def _validate_partitions(spec: DatasetSpec, errors: list[str]) -> None:
    p = spec.partitions
    if p is None:
        return
    from .enums import PartitionBy

    if p.by == PartitionBy.COLUMN and not p.column:
        errors.append("partitions.by='column' requires 'column'")
    if p.by == PartitionBy.INDEX and p.train is None and p.test is None and p.predict is None:
        errors.append("partitions.by='index' requires at least one of 'train' / 'test' / 'predict' (list of row indices)")
    if p.by == PartitionBy.INDEX_FILE and not (p.train_file or p.test_file or p.predict_file):
        errors.append("partitions.by='index_file' requires at least one of 'train_file' / 'test_file' / 'predict_file'")


def _validate_folds(spec: DatasetSpec, errors: list[str]) -> None:
    f = spec.folds
    if f is None:
        return
    set_count = sum(bool(x) for x in (f.inline, f.file, f.column))
    if set_count == 0:
        errors.append("folds is present but empty (set one of inline|file|column)")
    if set_count > 1:
        errors.append("folds must use exactly one of inline|file|column")


def validate_dict(d: dict) -> DatasetSpec:
    """Parse ``d`` into a :class:`DatasetSpec` and validate it."""
    spec = DatasetSpec.from_dict(d)
    validate_spec(spec)
    return spec
