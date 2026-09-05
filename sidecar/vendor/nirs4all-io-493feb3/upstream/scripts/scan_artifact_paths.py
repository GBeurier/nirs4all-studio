#!/usr/bin/env python3
# SPDX-License-Identifier: CECILL-2.1 OR AGPL-3.0-or-later
"""Refuse release binaries that expose personal checkout/build paths."""

from __future__ import annotations

import argparse
import io
import os
import re
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GENERIC_PATTERNS = (
    re.compile(rb"/(?:home|Users)/[^/\x00\r\n]+/"),
    re.compile(rb"[A-Za-z]:[\\/]Users[\\/][^\\/\x00\r\n]+[\\/]", re.IGNORECASE),
    re.compile(rb"/(?:tmp|private/tmp)/(?:tmp\.|n4io[-_/])"),
)


def forbidden_paths(extra: list[str] | None = None) -> tuple[bytes, ...]:
    values = {
        str(ROOT.resolve()),
        str(Path.home().resolve()),
        str(Path(os.environ.get("CARGO_HOME", str(Path.home() / ".cargo"))).resolve()),
        *(extra or []),
    }
    expanded = {variant for value in values if value for variant in (value, value.replace("/", "\\"), value.replace("\\", "/"))}
    return tuple(item.encode("utf-8") for item in sorted(expanded, key=len, reverse=True))


def leaks(data: bytes, forbidden: tuple[bytes, ...]) -> list[str]:
    found: list[str] = []
    for value in forbidden:
        if value and (value in data or value.decode("utf-8").encode("utf-16-le") in data):
            found.append(value.decode("utf-8", errors="replace"))
    for pattern in GENERIC_PATTERNS:
        match = pattern.search(data)
        if match:
            found.append(match.group(0).decode("utf-8", errors="replace"))
    return sorted(set(found))


def scan_bytes(data: bytes, label: str, forbidden: tuple[bytes, ...]) -> list[str]:
    failures = [f"{label}: {value}" for value in leaks(data, forbidden)]
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for name in archive.namelist():
                failures.extend(scan_bytes(archive.read(name), f"{label}!{name}", forbidden))
            return failures
    except (zipfile.BadZipFile, OSError):
        pass
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as archive:
            for member in archive.getmembers():
                stream = archive.extractfile(member) if member.isfile() else None
                if stream is not None:
                    failures.extend(scan_bytes(stream.read(), f"{label}!{member.name}", forbidden))
    except (tarfile.TarError, OSError):
        pass
    return failures


def scan_paths(paths: list[Path], extra: list[str] | None = None) -> None:
    forbidden = forbidden_paths(extra)
    failures: list[str] = []
    for path in paths:
        failures.extend(scan_bytes(path.read_bytes(), str(path), forbidden))
    if failures:
        raise ValueError("release artifact path leak(s):\n" + "\n".join(failures))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifacts", nargs="+", type=Path)
    parser.add_argument("--forbid", action="append", default=[])
    args = parser.parse_args()
    scan_paths([path.resolve() for path in args.artifacts], args.forbid)
    print(f"path-leak scan passed: {len(args.artifacts)} artifact(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
