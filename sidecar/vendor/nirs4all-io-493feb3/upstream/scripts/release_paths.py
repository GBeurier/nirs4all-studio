#!/usr/bin/env python3
# SPDX-License-Identifier: CECILL-2.1 OR AGPL-3.0-or-later
"""Canonical path handling shared by release artifact normalizers."""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

CANONICAL_SOURCE = "/usr/src/nirs4all-io"


def source_path_replacements(root: Path) -> tuple[tuple[str, str], ...]:
    """Return JSON-decoded native, slash, backslash, and URI root variants."""
    native = str(root.resolve())
    slash = native.replace("\\", "/")
    backslash = native.replace("/", "\\")
    variants = {
        native: CANONICAL_SOURCE,
        slash: CANONICAL_SOURCE,
        backslash: CANONICAL_SOURCE,
        root.resolve().as_uri(): f"file://{CANONICAL_SOURCE}",
    }
    return tuple(sorted(variants.items(), key=lambda item: len(item[0]), reverse=True))


def normalize_source_strings(value: Any, root: Path) -> Any:
    """Recursively canonicalize source-root strings after JSON decoding."""
    replacements = source_path_replacements(root)
    if isinstance(value, str):
        normalized = value
        for before, after in replacements:
            normalized = normalized.replace(before, after)
            if re.match(r"^[A-Za-z]:[\\/]", before):
                normalized = re.sub(re.escape(before), after, normalized, flags=re.IGNORECASE)
        return normalized
    if isinstance(value, list):
        return [normalize_source_strings(item, root) for item in value]
    if isinstance(value, dict):
        return {key: normalize_source_strings(item, root) for key, item in value.items()}
    return value


def iter_strings(value: Any) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from iter_strings(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            yield str(key)
            yield from iter_strings(item)


def refuse_source_path_leaks(value: Any, root: Path) -> None:
    """Fail if a canonicalized document still exposes a checkout path."""
    roots = tuple(before.casefold() for before, _ in source_path_replacements(root))
    sensitive = re.compile(
        r"(?i)(?:(?<![a-z])[a-z]:[\\/]|/(?:home|users)/|/github/workspace/|/home/runner/work/)[^\n\r]*nirs4all-io"
    )
    for candidate in iter_strings(value):
        folded = candidate.casefold()
        if any(root_value and root_value in folded for root_value in roots) or sensitive.search(candidate):
            raise ValueError(f"release metadata exposes a source checkout path: {candidate!r}")
