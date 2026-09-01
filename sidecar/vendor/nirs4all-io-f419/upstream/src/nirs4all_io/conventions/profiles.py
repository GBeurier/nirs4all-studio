# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Convention profiles (Appendix G).

A profile is a declarative ruleset that maps filenames to dataset roles and
partitions. Built-ins ship as TOML (the human-authoring form, D3) under
``conventions/builtin/``; the canonical machine form is the equivalent JSON
object. Profiles are composable and user-extensible (a TOML/JSON file path or an
inline dict).

The ``roles`` keys are the legacy role buckets (``train_x``/``test_x``/
``train_y``/``test_y``/``train_group``/``test_group``/``folds``); :data:`ROLE_KEY_MAP`
translates them to ``(Role, Partition | None)`` pairs.
"""

from __future__ import annotations

import json
import tomllib
from collections.abc import Sequence
from dataclasses import dataclass, field
from importlib import resources
from pathlib import Path
from typing import Any

from ..spec.enums import Partition, Role, SpecError

# legacy role-bucket -> (Role, Partition | None). "folds" is handled separately
# (it is not a sample role) under FOLDS_ROLE_KEY.
ROLE_KEY_MAP: dict[str, tuple[Role, Partition | None]] = {
    "train_x": (Role.FEATURES, Partition.TRAIN),
    "test_x": (Role.FEATURES, Partition.TEST),
    "train_y": (Role.TARGETS, Partition.TRAIN),
    "test_y": (Role.TARGETS, Partition.TEST),
    "train_group": (Role.METADATA, Partition.TRAIN),
    "test_group": (Role.METADATA, Partition.TEST),
}
FOLDS_ROLE_KEY = "folds"

# Fallback extension set when no formats registry is supplied (CSV family).
DEFAULT_EXTENSIONS = {".csv", ".csv.gz", ".csv.zip", ".tsv", ".txt", ".gz", ".zip"}


@dataclass
class MatchConfig:
    short_pattern_word_boundary: bool = True
    case_insensitive: bool = True
    recursive: bool = False
    extensions: list[str] = field(default_factory=lambda: ["from-formats-registry"])

    @classmethod
    def from_dict(cls, d: dict | None) -> MatchConfig:
        if not d:
            return cls()
        return cls(
            short_pattern_word_boundary=bool(d.get("short_pattern_word_boundary", True)),
            case_insensitive=bool(d.get("case_insensitive", True)),
            recursive=bool(d.get("recursive", False)),
            extensions=list(d.get("extensions", ["from-formats-registry"])),
        )


@dataclass
class Profile:
    name: str
    version: int = 1
    roles: dict[str, list[str]] = field(default_factory=dict)
    bare: dict[str, list[str]] = field(default_factory=dict)
    match: MatchConfig = field(default_factory=MatchConfig)
    spectra: dict[str, Any] | None = None
    reference: dict[str, Any] | None = None
    join: dict[str, Any] | None = None

    @property
    def is_vendor_corpus(self) -> bool:
        return self.spectra is not None

    @classmethod
    def from_dict(cls, d: dict) -> Profile:
        name = d.get("profile") or d.get("name")
        if not name:
            raise SpecError(f"convention profile needs a 'profile'/'name': {d!r}")
        return cls(
            name=str(name),
            version=int(d.get("version", 1)),
            roles={k: list(v) for k, v in d.get("roles", {}).items()},
            bare={k: list(v) for k, v in d.get("bare", {}).items()},
            match=MatchConfig.from_dict(d.get("match")),
            spectra=d.get("spectra"),
            reference=d.get("reference"),
            join=d.get("join"),
        )


def load_profile(source: str | Path | dict) -> Profile:
    """Load a profile from a built-in name, a TOML/JSON file path, or an inline dict."""
    if isinstance(source, dict):
        return Profile.from_dict(source)
    text_source = str(source)
    if text_source in _builtin_names():
        return _load_builtin(text_source)
    path = Path(text_source)
    if not path.exists():
        raise SpecError(f"convention profile not found: {source!r} (known built-ins: {sorted(_builtin_names())})")
    raw = path.read_text(encoding="utf-8")
    data = tomllib.loads(raw) if path.suffix.lower() == ".toml" else json.loads(raw)
    return Profile.from_dict(data)


def resolve_profiles(profiles: Sequence[str | Path | dict] | None) -> list[Profile]:
    """Resolve a list of profile references to :class:`Profile` objects."""
    if not profiles:
        return []
    return [load_profile(p) for p in profiles]


def _builtin_dir():
    return resources.files(__package__).joinpath("builtin")


def _builtin_names() -> set[str]:
    return {p.name[:-5] for p in _builtin_dir().iterdir() if p.name.endswith(".toml")}


def _load_builtin(name: str) -> Profile:
    data = tomllib.loads(_builtin_dir().joinpath(f"{name}.toml").read_text(encoding="utf-8"))
    return Profile.from_dict(data)


def builtin_profiles() -> dict[str, Profile]:
    """All shipped built-in profiles, keyed by name."""
    return {name: _load_builtin(name) for name in sorted(_builtin_names())}
