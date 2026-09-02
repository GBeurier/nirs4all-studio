#!/usr/bin/env python3
"""Fail closed on incomplete or contaminated nirs4all-core wheels."""

from __future__ import annotations

import re
import stat
import sys
import zipfile
from collections import Counter
from email.parser import BytesParser
from email.policy import default
from pathlib import Path
from pathlib import PurePosixPath


def validate_wheel(path: Path) -> None:
    """Validate public package inventory without importing the wheel."""
    with zipfile.ZipFile(path) as archive:
        raw_names = archive.namelist()
        names = set(raw_names)
        duplicates = sorted(
            name for name, count in Counter(raw_names).items() if count > 1
        )
        unsafe = sorted(
            name
            for name in raw_names
            if PurePosixPath(name).is_absolute()
            or "\\" in name
            or ":" in name
            or not name.rstrip("/")
            or any(
                segment in {"", ".", ".."}
                for segment in name.rstrip("/").split("/")
            )
        )
        special = sorted(
            info.filename
            for info in archive.infolist()
            if info.create_system == 3
            and stat.S_IFMT(info.external_attr >> 16)
            not in {0, stat.S_IFREG, stat.S_IFDIR}
        )
        metadata_names = sorted(
            name for name in names if name.endswith(".dist-info/METADATA")
        )
        if len(metadata_names) != 1:
            raise ValueError(f"{path}: expected exactly one dist-info/METADATA")
        metadata = BytesParser(policy=default).parsebytes(
            archive.read(metadata_names[0])
        )
        init_source = (
            archive.read("nirs4all_core/__init__.py").decode("utf-8")
            if "nirs4all_core/__init__.py" in names
            else ""
        )

    required = {"nirs4all_core/__init__.py", "n4a/__init__.py"}
    missing = sorted(required - names)
    contaminated = sorted(
        name
        for name in names
        if "__pycache__/" in name or name.endswith((".pyc", ".pyo"))
    )
    version = metadata.get("Version", "")
    expected_dist_info = f"nirs4all_core-{version}.dist-info/"
    unexpected_roots = sorted(
        name
        for name in names
        if not name.startswith(("nirs4all_core/", "n4a/", expected_dist_info))
    )
    source_version = re.search(r'^__version__ = "([^"]+)"$', init_source, re.MULTILINE)
    version_errors = []
    if metadata.get("Name") != "nirs4all-core":
        version_errors.append(
            f"metadata Name is {metadata.get('Name')!r}, expected 'nirs4all-core'"
        )
    if metadata_names[0] != f"{expected_dist_info}METADATA":
        version_errors.append("dist-info directory does not match metadata version")
    if not path.name.startswith(f"nirs4all_core-{version}-"):
        version_errors.append(f"filename does not encode metadata version {version!r}")
    if source_version is None or source_version.group(1) != version:
        observed = source_version.group(1) if source_version else None
        version_errors.append(
            f"nirs4all_core.__version__ is {observed!r}, expected {version!r}"
        )
    if (
        missing
        or contaminated
        or duplicates
        or unsafe
        or special
        or unexpected_roots
        or version_errors
    ):
        details = []
        if missing:
            details.append(f"missing public packages: {', '.join(missing)}")
        if contaminated:
            details.append(f"Python cache entries: {', '.join(contaminated)}")
        if duplicates:
            details.append(f"duplicate ZIP entries: {', '.join(duplicates)}")
        if unsafe:
            details.append(f"unsafe ZIP paths: {', '.join(unsafe)}")
        if special:
            details.append(f"special ZIP entries: {', '.join(special)}")
        if unexpected_roots:
            details.append(f"unexpected wheel roots: {', '.join(unexpected_roots)}")
        details.extend(version_errors)
        raise ValueError(f"{path}: {'; '.join(details)}")


def main(arguments: list[str]) -> int:
    """Validate every wheel named on the command line."""
    if not arguments:
        print("usage: check_python_wheel.py WHEEL [WHEEL ...]", file=sys.stderr)
        return 2
    try:
        for argument in arguments:
            validate_wheel(Path(argument))
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
