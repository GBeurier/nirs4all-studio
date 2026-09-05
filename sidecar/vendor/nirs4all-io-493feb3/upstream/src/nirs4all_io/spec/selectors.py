# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Column selectors (Appendix E.1).

A selector picks a set of columns within a tabular source. The canonical forms:

==========================  ==========================================  ==================================
form                        meaning                                     example
==========================  ==========================================  ==================================
``int`` / ``[int, ...]``    column(s) by position                       ``-1``, ``[0, 1]``
``"a:b"``                   positional slice (Python semantics)          ``"2:-1"``
``["name", ...]``           by header name                              ``["protein", "moisture"]``
``{"name_range": [a, b]}``  contiguous header range by name             ``{"name_range": ["400", "2500"]}``
``{"regex": "..."}``        header regex                                ``{"regex": "^\\d+(\\.\\d+)?$"}``
``{"dtype": "..."}``        by inferred dtype                           ``{"dtype": "string"}``
``"rest"``                  every column not yet assigned (<=1 / spec)   ``"rest"``
``"auto"`` / ``{"auto": …}``inference decides (carries ``candidates``)  ``{"auto": {"candidates": [...]}}``
==========================  ==========================================  ==================================

``resolve`` returns the selected **0-based column indices in order**; selectors
never mutate. ``RestSelector`` consumes whatever the earlier selectors left;
``AutoSelector`` cannot be resolved deterministically — the inference engine must
replace it with concrete roles before load.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .enums import SpecError

ColumnDtype = str  # one of: "numeric" | "string" | "datetime" | "bool"


class Selector:
    """Base class for column selectors."""

    kind: str = "selector"

    def to_spec(self) -> Any:  # pragma: no cover - overridden
        raise NotImplementedError

    def resolve(self, columns: list[str], dtypes: list[ColumnDtype], assigned: set[int]) -> list[int]:  # pragma: no cover - overridden
        raise NotImplementedError

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self.to_spec()!r})"

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Selector) and type(self) is type(other) and self.to_spec() == other.to_spec()


@dataclass(eq=False)
class PositionalSelector(Selector):
    kind = "positional"
    indices: tuple[int, ...]

    def to_spec(self) -> Any:
        return self.indices[0] if len(self.indices) == 1 else list(self.indices)

    def resolve(self, columns: list[str], dtypes: list[ColumnDtype], assigned: set[int]) -> list[int]:
        n = len(columns)
        out: list[int] = []
        for idx in self.indices:
            real = idx if idx >= 0 else n + idx
            if not 0 <= real < n:
                raise SpecError(f"column index {idx} out of range for {n} columns")
            out.append(real)
        return out


@dataclass(eq=False)
class SliceSelector(Selector):
    kind = "slice"
    raw: str

    def to_spec(self) -> Any:
        return self.raw

    def resolve(self, columns: list[str], dtypes: list[ColumnDtype], assigned: set[int]) -> list[int]:
        n = len(columns)
        parts = self.raw.split(":")
        if len(parts) not in (2, 3):
            raise SpecError(f"slice {self.raw!r} must be 'start:stop' or 'start:stop:step'")
        try:
            bounds = [int(p) if p.strip() != "" else None for p in parts]
        except ValueError as exc:
            raise SpecError(f"slice {self.raw!r} has non-integer bounds") from exc
        sl = slice(*bounds)
        return list(range(n))[sl]


@dataclass(eq=False)
class NameSelector(Selector):
    kind = "names"
    names: tuple[str, ...]

    def to_spec(self) -> Any:
        return list(self.names)

    def resolve(self, columns: list[str], dtypes: list[ColumnDtype], assigned: set[int]) -> list[int]:
        pos = {name: i for i, name in enumerate(columns)}
        out: list[int] = []
        for name in self.names:
            if name not in pos:
                raise SpecError(f"column name {name!r} not found; available: {columns}")
            out.append(pos[name])
        return out


@dataclass(eq=False)
class NameRangeSelector(Selector):
    kind = "name_range"
    start: str
    end: str

    def to_spec(self) -> Any:
        return {"name_range": [self.start, self.end]}

    def resolve(self, columns: list[str], dtypes: list[ColumnDtype], assigned: set[int]) -> list[int]:
        try:
            lo = columns.index(self.start)
            hi = columns.index(self.end)
        except ValueError as exc:
            raise SpecError(f"name_range endpoints {self.start!r}/{self.end!r} not both present") from exc
        if lo > hi:
            lo, hi = hi, lo
        return list(range(lo, hi + 1))


@dataclass(eq=False)
class RegexSelector(Selector):
    kind = "regex"
    pattern: str

    def to_spec(self) -> Any:
        return {"regex": self.pattern}

    def resolve(self, columns: list[str], dtypes: list[ColumnDtype], assigned: set[int]) -> list[int]:
        rx = re.compile(self.pattern)
        return [i for i, name in enumerate(columns) if rx.search(name)]


@dataclass(eq=False)
class DtypeSelector(Selector):
    kind = "dtype"
    dtype: ColumnDtype

    _ALLOWED = ("numeric", "string", "datetime", "bool")

    def to_spec(self) -> Any:
        return {"dtype": self.dtype}

    def resolve(self, columns: list[str], dtypes: list[ColumnDtype], assigned: set[int]) -> list[int]:
        return [i for i, dt in enumerate(dtypes) if dt == self.dtype]


@dataclass(eq=False)
class RestSelector(Selector):
    kind = "rest"

    def to_spec(self) -> Any:
        return "rest"

    def resolve(self, columns: list[str], dtypes: list[ColumnDtype], assigned: set[int]) -> list[int]:
        return [i for i in range(len(columns)) if i not in assigned]


@dataclass(eq=False)
class AutoSelector(Selector):
    kind = "auto"
    candidates: tuple[str, ...] = field(default_factory=tuple)

    def to_spec(self) -> Any:
        if self.candidates:
            return {"auto": {"candidates": list(self.candidates)}}
        return "auto"

    def resolve(self, columns: list[str], dtypes: list[ColumnDtype], assigned: set[int]) -> list[int]:
        raise SpecError("an 'auto' selector must be resolved by the inference engine before load")


def parse_selector(value: Any) -> Selector:
    """Parse any selector form into a :class:`Selector`."""
    if isinstance(value, bool):  # guard: bool is an int subclass
        raise SpecError(f"selector cannot be a bool: {value!r}")
    if isinstance(value, int):
        return PositionalSelector((value,))
    if isinstance(value, str):
        low = value.strip().lower()
        if low == "rest":
            return RestSelector()
        if low == "auto":
            return AutoSelector()
        if ":" in value:
            return SliceSelector(value)
        # a bare string name is a single-name selector
        return NameSelector((value,))
    if isinstance(value, (list, tuple)):
        if all(isinstance(v, int) and not isinstance(v, bool) for v in value):
            return PositionalSelector(tuple(int(v) for v in value))
        if all(isinstance(v, str) for v in value):
            return NameSelector(tuple(value))
        raise SpecError(f"list selector must be all ints or all strings: {value!r}")
    if isinstance(value, dict):
        if len(value) != 1:
            raise SpecError(f"dict selector must have exactly one key: {value!r}")
        key, payload = next(iter(value.items()))
        key = key.lower()
        if key == "regex":
            return RegexSelector(str(payload))
        if key == "dtype":
            dt = str(payload).lower()
            if dt not in DtypeSelector._ALLOWED:
                raise SpecError(f"dtype selector {dt!r} must be one of {DtypeSelector._ALLOWED}")
            return DtypeSelector(dt)
        if key == "name_range":
            if not (isinstance(payload, (list, tuple)) and len(payload) == 2):
                raise SpecError(f"name_range must be a 2-element list: {payload!r}")
            return NameRangeSelector(str(payload[0]), str(payload[1]))
        if key == "auto":
            cands: tuple[str, ...] = ()
            if isinstance(payload, dict) and "candidates" in payload:
                cands = tuple(str(c) for c in payload["candidates"])
            return AutoSelector(cands)
        raise SpecError(f"unknown selector key {key!r}; expected regex|dtype|name_range|auto")
    raise SpecError(f"cannot parse selector from {type(value).__name__}: {value!r}")
