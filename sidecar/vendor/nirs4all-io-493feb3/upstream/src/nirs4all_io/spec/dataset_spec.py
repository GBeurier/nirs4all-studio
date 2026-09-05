# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""The canonical, serializable ``DatasetSpec`` IR (Appendix E).

A ``DatasetSpec`` is the single source of truth the materializers consume. It is
JSON/YAML-authorable; on input an alias normalizer (:mod:`nirs4all_io.spec.normalize`)
maps legacy/synonym keys onto these canonical fields, and :mod:`nirs4all_io.spec.validate`
checks structural invariants. Identity (``sample_index``) is kept distinct from
per-source alignment keys (``SourceSpec.key``) and relational join keys (``JoinSpec``).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .enums import (
    AggregateMethod,
    Cardinality,
    CategoricalMode,
    Coverage,
    FillMethod,
    FoldFormat,
    HeaderUnit,
    MergeMode,
    Modality,
    NaPolicy,
    Partition,
    PartitionBy,
    Role,
    SampleIndexBy,
    SignalType,
    SourceKind,
    SpecError,
    TaskType,
    UnknownPolicy,
)
from .selectors import Selector, parse_selector

SCHEMA_VERSION = 1


def _get(d: dict, *keys: str, default: Any = None) -> Any:
    for k in keys:
        if k in d:
            return d[k]
    return default


def _drop_none(d: dict) -> dict:
    return {k: v for k, v in d.items() if v is not None and v != [] and v != {}}


# --------------------------------------------------------------------------- #
# Loading params (A.12 — precedence file > partition > global)                #
# --------------------------------------------------------------------------- #
@dataclass
class NaConfig:
    policy: NaPolicy = NaPolicy.AUTO
    fill_method: FillMethod | None = None
    fill_value: Any = None
    fill_per_column: bool = True  # matches nirs4all NAFillConfig.per_column default

    @classmethod
    def from_dict(cls, d: dict | None) -> NaConfig:
        if not d:
            return cls()
        fill = d.get("fill") or {}
        return cls(
            policy=NaPolicy.coerce(d.get("policy", "auto"), field="na.policy"),
            fill_method=FillMethod.coerce(fill["method"], field="na.fill.method") if fill.get("method") else None,
            fill_value=fill.get("fill_value"),
            fill_per_column=bool(fill.get("per_column", True)),
        )

    def to_dict(self) -> dict:
        out: dict = {"policy": self.policy.value}
        fill = _drop_none({"method": self.fill_method.value if self.fill_method else None, "fill_value": self.fill_value, "per_column": self.fill_per_column or None})
        if fill:
            out["fill"] = fill
        return out


@dataclass
class FormatParams:
    """Format-specific knobs (sheet, usecols, npz key, archive member, ...)."""

    values: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict | None) -> FormatParams:
        return cls(values=dict(d or {}))

    def to_dict(self) -> dict:
        return dict(self.values)


@dataclass
class LoadingParams:
    delimiter: str | None = None
    decimal_separator: str | None = None
    has_header: bool | None = None
    header_unit: HeaderUnit | None = None
    signal_type: SignalType | None = None
    encoding: str | None = None
    na: NaConfig = field(default_factory=NaConfig)
    categorical: CategoricalMode | None = None
    format: FormatParams = field(default_factory=FormatParams)

    @classmethod
    def from_dict(cls, d: dict | None) -> LoadingParams:
        if not d:
            return cls()
        return cls(
            delimiter=d.get("delimiter"),
            decimal_separator=_get(d, "decimal_separator", "decimal"),
            has_header=_get(d, "has_header", "header"),
            header_unit=HeaderUnit.coerce(d["header_unit"], field="params.header_unit") if d.get("header_unit") is not None else None,
            signal_type=SignalType.coerce(d["signal_type"], field="params.signal_type") if d.get("signal_type") is not None else None,
            encoding=d.get("encoding"),
            na=NaConfig.from_dict(d.get("na")),
            categorical=CategoricalMode.coerce(d["categorical"], field="params.categorical") if d.get("categorical") is not None else None,
            format=FormatParams.from_dict(d.get("format")),
        )

    def to_dict(self) -> dict:
        out = _drop_none(
            {
                "delimiter": self.delimiter,
                "decimal_separator": self.decimal_separator,
                "has_header": self.has_header,
                "header_unit": self.header_unit.value if self.header_unit else None,
                "signal_type": self.signal_type.value if self.signal_type else None,
                "encoding": self.encoding,
                "categorical": self.categorical.value if self.categorical else None,
            }
        )
        na = self.na.to_dict()
        if na.get("policy") != "auto" or na.get("fill"):
            out["na"] = na
        fmt = self.format.to_dict()
        if fmt:
            out["format"] = fmt
        return out


# --------------------------------------------------------------------------- #
# Column roles (E.1) and joins (E.2)                                          #
# --------------------------------------------------------------------------- #
def _coerce_column_role(value: Any, *, field: str) -> Role:
    """Coerce a *column* role; ``mixed`` is a source-level role only (Codex)."""
    role = Role.coerce(value, field=field)
    if role is Role.MIXED:
        raise SpecError(f"{field}: 'mixed' is a source-level role, not a column role")
    return role


@dataclass
class ColumnRole:
    role: Role
    select: Selector

    @classmethod
    def from_dict(cls, d: dict) -> ColumnRole:
        if "role" not in d or "select" not in d:
            raise SpecError(f"column-role entry needs 'role' and 'select': {d!r}")
        return cls(role=_coerce_column_role(d["role"], field="columns[].role"), select=parse_selector(d["select"]))

    def to_dict(self) -> dict:
        return {"role": self.role.value, "select": self.select.to_spec()}


def parse_columns(value: Any) -> tuple[list[ColumnRole], bool]:
    """Parse the ``columns`` field. Returns (ordered roles, came_from_map)."""
    if value is None:
        return [], False
    if isinstance(value, list):
        return [ColumnRole.from_dict(item) for item in value], False
    if isinstance(value, dict):
        # map shorthand {role: selector, ...}; only valid when disjoint (validated later)
        roles = [ColumnRole(role=_coerce_column_role(role, field="columns key"), select=parse_selector(sel)) for role, sel in value.items()]
        return roles, True
    raise SpecError(f"'columns' must be a list or a map, got {type(value).__name__}")


@dataclass
class JoinSpec:
    left: str | None
    right: str
    left_on: str | list[str] | None
    right_on: str | list[str] | None
    cardinality: Cardinality = Cardinality.ONE_TO_ONE
    coverage: Coverage = Coverage.COMPLETE

    @classmethod
    def from_dict(cls, d: dict, *, this_source: str | None = None) -> JoinSpec:
        # `how` is an accepted alias for `cardinality` in both forms; the shorthand
        # is detected by `to` only (`{to, on, how}` == {right:to, left_on/right_on:on}).
        cardinality = Cardinality.coerce(d.get("cardinality", d.get("how", "1:1")), field="join.cardinality")
        coverage = Coverage.coerce(d.get("coverage", "complete"), field="join.coverage")
        if "to" in d:
            on = d.get("on")
            return cls(left=d.get("left", this_source), right=d["to"], left_on=d.get("left_on", on), right_on=d.get("right_on", on), cardinality=cardinality, coverage=coverage)
        if "right" not in d:
            raise SpecError(f"join needs 'right' (or shorthand 'to'): {d!r}")
        return cls(left=d.get("left", this_source), right=d["right"], left_on=d.get("left_on"), right_on=d.get("right_on"), cardinality=cardinality, coverage=coverage)

    def to_dict(self) -> dict:
        return _drop_none(
            {
                "left": self.left,
                "right": self.right,
                "left_on": self.left_on,
                "right_on": self.right_on,
                "cardinality": self.cardinality.value,
                "coverage": self.coverage.value,
            }
        )


# --------------------------------------------------------------------------- #
# Source (A.6 multi-source)                                                   #
# --------------------------------------------------------------------------- #
@dataclass
class VariationSpec:
    """A pre-computed preprocessing variant of a feature source.

    The file(s) hold the same samples (in the same row order) as the parent
    source, transformed by an external preprocessing (e.g. SNV, MSC pre-applied
    in a vendor tool). At load time, each variation becomes a named *processing*
    on the parent SpectroDataset source -- i.e. ``ds.add_features(variation_array,
    ["<name>"], source=<src_idx>)``. Variations are not augmentations and not
    repetitions: they are alternative views of the same samples.

    Same column count as the parent feature block (the variation's role-selected
    columns); same row count as the parent source. Joins that reorder the
    parent's rows propagate to variations automatically (rows are tracked by a
    per-source positional index).
    """

    name: str
    input: Any = None  # path | glob | [paths]
    params: LoadingParams = field(default_factory=LoadingParams)

    @classmethod
    def from_dict(cls, d: dict) -> VariationSpec:
        if "name" not in d:
            raise SpecError(f"variation needs a 'name': {d!r}")
        if d.get("input") is None:
            raise SpecError(f"variation '{d['name']}': 'input' is required")
        return cls(name=str(d["name"]), input=d.get("input"), params=LoadingParams.from_dict(d.get("params")))

    def to_dict(self) -> dict:
        out: dict = {"name": self.name, "input": self.input}
        params = self.params.to_dict()
        if params:
            out["params"] = params
        return out


@dataclass
class SourceSpec:
    id: str
    role: Role = Role.FEATURES
    kind: SourceKind = SourceKind.TABLE
    modality: Modality | None = None
    input: Any = None  # path | glob | [paths] | {"array": ...} | {"record_set": ...} | {"spectrodataset": ...}
    merge: MergeMode = MergeMode.NONE
    partition: Partition | None = None
    key: str | list[str] | None = None  # alignment key(s); virtual key e.g. "filename_stem"
    columns: list[ColumnRole] = field(default_factory=list)
    strict_columns: bool = True
    columns_from_map: bool = False
    join: JoinSpec | None = None
    params: LoadingParams = field(default_factory=LoadingParams)
    # Pre-computed preprocessing variants attached to this (feature) source --
    # one named *processing* per variation in the resulting SpectroDataset.
    variations: list[VariationSpec] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: dict) -> SourceSpec:
        if "id" not in d:
            raise SpecError(f"each source needs an 'id': {d!r}")
        columns, from_map = parse_columns(d.get("columns"))
        join = JoinSpec.from_dict(d["join"], this_source=d["id"]) if d.get("join") else None
        # When per-column roles are declared but no source role is given, the
        # source role is 'mixed' (roles come from columns) -- so a metadata
        # lookup with `columns:[{role:metadata,...}]` does not silently become
        # `features` on round-trip (Codex foundation review).
        default_role = "mixed" if (columns and "role" not in d) else "features"
        return cls(
            id=str(d["id"]),
            role=Role.coerce(d.get("role", default_role), field=f"source[{d['id']}].role"),
            kind=SourceKind.coerce(d.get("kind", "table"), field=f"source[{d['id']}].kind"),
            modality=Modality.coerce(d["modality"], field="modality") if d.get("modality") else None,
            input=d.get("input"),
            merge=MergeMode.coerce(d.get("merge", "none"), field="merge"),
            partition=Partition.coerce(d["partition"], field="partition") if d.get("partition") else None,
            key=d.get("key"),
            columns=columns,
            strict_columns=bool(d.get("strict_columns", True)),
            columns_from_map=from_map,
            join=join,
            params=LoadingParams.from_dict(d.get("params")),
            variations=[VariationSpec.from_dict(v) for v in d.get("variations", [])],
        )

    def to_dict(self) -> dict:
        out: dict = {"id": self.id, "role": self.role.value}
        if self.kind != SourceKind.TABLE:
            out["kind"] = self.kind.value
        if self.modality:
            out["modality"] = self.modality.value
        if self.input is not None:
            out["input"] = self.input
        if self.merge != MergeMode.NONE:
            out["merge"] = self.merge.value
        if self.partition:
            out["partition"] = self.partition.value
        if self.key is not None:
            out["key"] = self.key
        if self.columns:
            if self.columns_from_map:
                out["columns"] = {c.role.value: c.select.to_spec() for c in self.columns}
            else:
                out["columns"] = [c.to_dict() for c in self.columns]
        if not self.strict_columns:
            out["strict_columns"] = False
        if self.join:
            out["join"] = self.join.to_dict()
        params = self.params.to_dict()
        if params:
            out["params"] = params
        if self.variations:
            out["variations"] = [v.to_dict() for v in self.variations]
        return out


# --------------------------------------------------------------------------- #
# Identity, partitions, folds, aggregation, validation                        #
# --------------------------------------------------------------------------- #
@dataclass
class SampleIndex:
    by: SampleIndexBy = SampleIndexBy.ROW
    key: str | list[str] | None = None
    observation_id: str | None = None
    repetition_id: str | None = None
    group_id: str | None = None
    # derive `key` by stripping a replicate-suffix regex from another column
    # (e.g. from "filename_stem": mango_001_a -> mango_001) -- vendor replicates.
    derive_from: str | None = None
    derive_pattern: str | None = None

    @classmethod
    def from_dict(cls, d: dict | None) -> SampleIndex:
        if not d:
            return cls()
        derive = d.get("derive") or {}
        return cls(
            by=SampleIndexBy.coerce(d.get("by", "row"), field="sample_index.by"),
            key=d.get("key"),
            observation_id=d.get("observation_id"),
            repetition_id=d.get("repetition_id"),
            group_id=d.get("group_id"),
            derive_from=derive.get("from"),
            derive_pattern=derive.get("strip_suffix"),
        )

    def to_dict(self) -> dict:
        out = _drop_none(
            {
                "by": self.by.value,
                "key": self.key,
                "observation_id": self.observation_id,
                "repetition_id": self.repetition_id,
                "group_id": self.group_id,
            }
        )
        if self.derive_from:
            out["derive"] = {"from": self.derive_from, "strip_suffix": self.derive_pattern}
        return out


@dataclass
class PartitionsSpec:
    by: PartitionBy | None = None
    column: str | None = None
    train_values: list[Any] = field(default_factory=list)
    test_values: list[Any] = field(default_factory=list)
    predict_values: list[Any] = field(default_factory=list)
    unknown_policy: UnknownPolicy = UnknownPolicy.TRAIN
    # For `by: index`: row-index lists per partition (deterministic by construction).
    train: Any = None
    test: Any = None
    predict: Any = None
    # For `by: index_file`: paths to files containing one row-index per line (CSV/TXT/JSON).
    train_file: str | None = None
    test_file: str | None = None
    predict_file: str | None = None

    @classmethod
    def from_dict(cls, d: dict | None) -> PartitionsSpec | None:
        if not d:
            return None
        return cls(
            by=PartitionBy.coerce(d["by"], field="partitions.by") if d.get("by") else None,
            column=d.get("column"),
            train_values=list(d.get("train_values", [])),
            test_values=list(d.get("test_values", [])),
            predict_values=list(d.get("predict_values", [])),
            unknown_policy=UnknownPolicy.coerce(d.get("unknown_policy", "train"), field="partitions.unknown_policy"),
            train=d.get("train"),
            test=d.get("test"),
            predict=d.get("predict"),
            train_file=d.get("train_file"),
            test_file=d.get("test_file"),
            predict_file=d.get("predict_file"),
        )

    def to_dict(self) -> dict:
        return _drop_none(
            {
                "by": self.by.value if self.by else None,
                "column": self.column,
                "train_values": self.train_values,
                "test_values": self.test_values,
                "predict_values": self.predict_values,
                "unknown_policy": self.unknown_policy.value if self.unknown_policy != UnknownPolicy.TRAIN else None,
                "train": self.train,
                "test": self.test,
                "predict": self.predict,
                "train_file": self.train_file,
                "test_file": self.test_file,
                "predict_file": self.predict_file,
            }
        )


@dataclass
class FoldsSpec:
    inline: list[dict[str, Any]] = field(default_factory=list)
    file: str | None = None
    format: FoldFormat = FoldFormat.AUTO
    column: str | None = None

    @classmethod
    def from_dict(cls, d: dict | None) -> FoldsSpec | None:
        if not d:
            return None
        return cls(
            inline=list(d.get("inline", [])),
            file=d.get("file"),
            format=FoldFormat.coerce(d.get("format", "auto"), field="folds.format"),
            column=d.get("column"),
        )

    def to_dict(self) -> dict:
        out = _drop_none({"inline": self.inline, "file": self.file, "column": self.column})
        if self.file and self.format != FoldFormat.AUTO:
            out["format"] = self.format.value
        return out


@dataclass
class AggregateSpec:
    by: str | None = None
    method: AggregateMethod = AggregateMethod.MEAN
    exclude_outliers: bool = False
    outlier_threshold: float = 0.95

    @classmethod
    def from_dict(cls, d: dict | None) -> AggregateSpec | None:
        if not d:
            return None
        return cls(
            by=str(d["by"]) if d.get("by") is not None else None,
            method=AggregateMethod.coerce(d.get("method", "mean"), field="aggregate.method"),
            exclude_outliers=bool(d.get("exclude_outliers", False)),
            outlier_threshold=float(d.get("outlier_threshold", 0.95)),
        )

    def to_dict(self) -> dict:
        out: dict = {"by": self.by, "method": self.method.value}
        if self.exclude_outliers:
            out["exclude_outliers"] = True
            out["outlier_threshold"] = self.outlier_threshold
        return _drop_none(out)


@dataclass
class ValidationSpec:
    check_file_existence: bool = True
    allow_train_only: bool = True
    allow_test_only: bool = True

    @classmethod
    def from_dict(cls, d: dict | None) -> ValidationSpec:
        if not d:
            return cls()
        return cls(
            check_file_existence=bool(d.get("check_file_existence", True)),
            allow_train_only=bool(d.get("allow_train_only", True)),
            allow_test_only=bool(d.get("allow_test_only", True)),
        )

    def to_dict(self) -> dict:
        out: dict = {}
        if not self.check_file_existence:
            out["check_file_existence"] = False
        if not self.allow_train_only:
            out["allow_train_only"] = False
        if not self.allow_test_only:
            out["allow_test_only"] = False
        return out


# --------------------------------------------------------------------------- #
# Top-level spec                                                              #
# --------------------------------------------------------------------------- #
@dataclass
class DatasetSpec:
    schema_version: int = SCHEMA_VERSION
    name: str | None = None
    description: str | None = None
    task_type: TaskType = TaskType.AUTO
    sample_index: SampleIndex = field(default_factory=SampleIndex)
    signal_type: SignalType = SignalType.AUTO
    conventions: list[str] = field(default_factory=list)
    sources: list[SourceSpec] = field(default_factory=list)
    partitions: PartitionsSpec | None = None
    folds: FoldsSpec | None = None
    aggregate: AggregateSpec | None = None
    repetition: str | None = None
    params: LoadingParams = field(default_factory=LoadingParams)
    validation: ValidationSpec = field(default_factory=ValidationSpec)

    # -- construction ------------------------------------------------------- #
    @classmethod
    def from_dict(cls, d: dict) -> DatasetSpec:
        if not isinstance(d, dict):
            raise SpecError(f"DatasetSpec must be a mapping, got {type(d).__name__}")
        return cls(
            schema_version=int(d.get("schema_version", SCHEMA_VERSION)),
            name=d.get("name"),
            description=d.get("description"),
            task_type=TaskType.coerce(d.get("task_type", "auto"), field="task_type"),
            sample_index=SampleIndex.from_dict(d.get("sample_index")),
            signal_type=SignalType.coerce(d.get("signal_type", "auto"), field="signal_type"),
            conventions=list(d.get("conventions", [])),
            sources=[SourceSpec.from_dict(s) for s in d.get("sources", [])],
            partitions=PartitionsSpec.from_dict(d.get("partitions")),
            folds=FoldsSpec.from_dict(d.get("folds")),
            aggregate=AggregateSpec.from_dict(d.get("aggregate")),
            repetition=d.get("repetition"),
            params=LoadingParams.from_dict(d.get("params")),
            validation=ValidationSpec.from_dict(d.get("validation")),
        )

    @classmethod
    def from_yaml(cls, source: str | Path) -> DatasetSpec:
        text = Path(source).read_text(encoding="utf-8") if _looks_like_path(source) else str(source)
        return cls.from_dict(yaml.safe_load(text))

    @classmethod
    def from_json(cls, source: str | Path) -> DatasetSpec:
        text = Path(source).read_text(encoding="utf-8") if _looks_like_path(source) else str(source)
        return cls.from_dict(json.loads(text))

    # -- serialization ------------------------------------------------------ #
    def to_dict(self) -> dict:
        out: dict = {"schema_version": self.schema_version}
        if self.name:
            out["name"] = self.name
        if self.description:
            out["description"] = self.description
        if self.task_type != TaskType.AUTO:
            out["task_type"] = self.task_type.value
        si = self.sample_index.to_dict()
        if si != {"by": "row"}:
            out["sample_index"] = si
        if self.signal_type != SignalType.AUTO:
            out["signal_type"] = self.signal_type.value
        if self.conventions:
            out["conventions"] = list(self.conventions)
        out["sources"] = [s.to_dict() for s in self.sources]
        if self.partitions:
            out["partitions"] = self.partitions.to_dict()
        if self.folds:
            out["folds"] = self.folds.to_dict()
        if self.aggregate:
            out["aggregate"] = self.aggregate.to_dict()
        if self.repetition:
            out["repetition"] = self.repetition
        params = self.params.to_dict()
        if params:
            out["params"] = params
        validation = self.validation.to_dict()
        if validation:
            out["validation"] = validation
        return out

    def to_yaml(self) -> str:
        return yaml.safe_dump(self.to_dict(), sort_keys=False, allow_unicode=True)

    def to_json(self, *, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)

    def validate(self) -> DatasetSpec:
        from .validate import validate_spec

        validate_spec(self)
        return self


def _looks_like_path(source: str | Path) -> bool:
    if isinstance(source, Path):
        return True
    return "\n" not in source and len(source) < 4096 and Path(source).exists()
