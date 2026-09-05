# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Closed vocabularies used by :mod:`nirs4all_io.spec`.

Every enum is a ``str`` enum so specs round-trip through JSON/YAML unchanged.
Parsing is case-insensitive and accepts a few common spellings; unknown values
raise :class:`SpecError` with the list of accepted values.
"""

from __future__ import annotations

from enum import StrEnum
from typing import TypeVar

_E = TypeVar("_E", bound="_StrEnum")


class SpecError(ValueError):
    """Raised when a ``DatasetSpec`` (or a fragment of one) is malformed."""


# Extra accepted spellings, keyed by enum class then normalized-input -> canonical value.
# Kept outside the enum bodies: a plain attribute inside a ``str, Enum`` would be
# turned into a (fake) member by ``EnumMeta``.
_ALIASES: dict[type, dict[str, str]] = {}


class _StrEnum(StrEnum):
    """Base for string enums with forgiving, case-insensitive parsing."""

    @classmethod
    def coerce(cls: type[_E], value: object, *, field: str) -> _E:
        if isinstance(value, cls):
            return value
        if isinstance(value, str):
            key = value.strip().lower().replace("-", "_")
            for member in cls:
                if member.value.lower().replace("-", "_") == key:
                    return member
            alias = _ALIASES.get(cls, {}).get(key)
            if alias is not None:
                return cls(alias)
        accepted = ", ".join(repr(m.value) for m in cls)
        raise SpecError(f"{field}: {value!r} is not valid; expected one of {accepted}")


class Role(_StrEnum):
    """Role of a source or a column within a source."""

    FEATURES = "features"
    TARGETS = "targets"
    METADATA = "metadata"
    WEIGHTS = "weights"
    IGNORE = "ignore"
    MIXED = "mixed"  # source-level only: column roles come from ``columns``


class SourceKind(_StrEnum):
    TABLE = "table"
    LOOKUP = "lookup"  # keyed dimension table (few rows), contributed via an m:1 join


class Modality(_StrEnum):
    SPECTROSCOPY = "spectroscopy"
    MARKERS = "markers"
    METADATA = "metadata"
    IMAGE = "image"


class Partition(_StrEnum):
    TRAIN = "train"
    TEST = "test"
    VAL = "val"
    PREDICT = "predict"
    AUTO = "auto"


class TaskType(_StrEnum):
    AUTO = "auto"
    REGRESSION = "regression"
    BINARY = "binary"
    MULTICLASS = "multiclass"


class SampleIndexBy(_StrEnum):
    ROW = "row"
    ID = "id"


class MergeMode(_StrEnum):
    """How a multi-file ``input`` on a single source is combined (E.2)."""

    CONCAT_SAMPLES = "concat_samples"  # vertically stack rows (schema-union)
    CONCAT_FEATURES = "concat_features"  # horizontally stack column-blocks (aligned by key/row)
    BY_KEY = "by_key"  # relational join of the listed files on their key
    NONE = "none"  # keep as a single file (default for one path)


class Cardinality(_StrEnum):
    ONE_TO_ONE = "1:1"
    MANY_TO_ONE = "m:1"  # lookup / dimension table: right broadcast to many left rows
    ONE_TO_MANY = "1:m"


class Coverage(_StrEnum):
    """Governs unmatched left keys in a join (E.2)."""

    COMPLETE = "complete"  # assert left ⊆ right; report the full missing set
    WARN = "warn"  # keep all, warn on misses, null-fill right columns
    DROP = "drop"  # drop unmatched left rows (dropped-row audit)
    ERROR = "error"  # hard error on the first miss


class HeaderUnit(_StrEnum):
    NM = "nm"
    CM_1 = "cm-1"
    NONE = "none"
    TEXT = "text"
    INDEX = "index"


class SignalType(_StrEnum):
    AUTO = "auto"
    ABSORBANCE = "absorbance"
    REFLECTANCE = "reflectance"
    REFLECTANCE_PCT = "reflectance%"
    TRANSMITTANCE = "transmittance"
    TRANSMITTANCE_PCT = "transmittance%"
    LOG_1_R = "log(1/R)"
    KUBELKA_MUNK = "kubelka-munk"


class NaPolicy(_StrEnum):
    AUTO = "auto"
    ABORT = "abort"
    REMOVE_SAMPLE = "remove_sample"
    REMOVE_FEATURE = "remove_feature"
    REPLACE = "replace"
    IGNORE = "ignore"


class FillMethod(_StrEnum):
    VALUE = "value"
    MEAN = "mean"
    MEDIAN = "median"
    FORWARD_FILL = "forward_fill"
    BACKWARD_FILL = "backward_fill"


class CategoricalMode(_StrEnum):
    AUTO = "auto"
    PRESERVE = "preserve"
    NONE = "none"


class PartitionBy(_StrEnum):
    FILES = "files"
    COLUMN = "column"
    INDEX = "index"
    INDEX_FILE = "index_file"


class UnknownPolicy(_StrEnum):
    TRAIN = "train"
    TEST = "test"
    DROP = "drop"
    ERROR = "error"


class FoldFormat(_StrEnum):
    AUTO = "auto"
    CSV = "csv"
    JSON = "json"
    YAML = "yaml"
    TXT = "txt"


class AggregateMethod(_StrEnum):
    MEAN = "mean"
    MEDIAN = "median"
    VOTE = "vote"
    ROBUST_MEAN = "robust_mean"


_ALIASES.update(
    {
        Role: {"x": "features", "y": "targets", "meta": "metadata", "m": "metadata", "weight": "weights"},
        Partition: {"calibration": "train", "cal": "train", "validation": "val", "holdout": "test", "inference": "predict"},
        HeaderUnit: {"wavenumber": "cm-1", "nanometer": "nm", "nanometers": "nm", "cm1": "cm-1", "cm_1": "cm-1"},
    }
)
