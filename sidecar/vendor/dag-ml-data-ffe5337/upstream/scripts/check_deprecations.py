#!/usr/bin/env python3
"""Enforce ADR-14 managed-debt rules on production paths."""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path


SCAN_DIRS = ("crates", "scripts")
SCAN_SUFFIXES = {".c", ".h", ".py", ".rs"}
IGNORED_PATHS = {"scripts/check_deprecations.py"}
DEBT_MARKER_RE = re.compile(r"\b(TODO|FIXME)\b")
JUSTIFIED_DEBT_RE = re.compile(r"\b(?:TODO|FIXME)\([A-Za-z0-9_.:-]+\): .+\(#[1-9][0-9]*\)")
DEPRECATED_ATTR_RE = re.compile(r"#\s*\[\s*deprecated\b")
SINCE_RE = re.compile(r'since\s*=\s*"(?P<version>[^"]+)"')
REMOVAL_RE = re.compile(
    r"(?:remove|removed|removal)[^0-9]*(?P<version>[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)",
    re.IGNORECASE,
)
ISSUE_RE = re.compile(r"\(#[1-9][0-9]*\)")
SEMVER_RE = re.compile(
    r"^(?P<major>0|[1-9][0-9]*)\.(?P<minor>0|[1-9][0-9]*)\.(?P<patch>0|[1-9][0-9]*)(?:-(?P<pre>[0-9A-Za-z.-]+))?$"
)


@dataclass(frozen=True, order=True)
class VersionKey:
    major: int
    minor: int
    patch: int
    stable_rank: int
    pre: str


def fail(message: str) -> None:
    raise SystemExit(message)


def parse_version(version: str) -> VersionKey:
    match = SEMVER_RE.fullmatch(version)
    if match is None:
        fail(f"unsupported SemVer version: {version}")
    pre = match["pre"] or ""
    return VersionKey(
        int(match["major"]),
        int(match["minor"]),
        int(match["patch"]),
        1 if pre == "" else 0,
        pre,
    )


def workspace_version(repo: Path) -> VersionKey:
    with (repo / "Cargo.toml").open("rb") as handle:
        manifest = tomllib.load(handle)
    return parse_version(manifest["workspace"]["package"]["version"])


def iter_source_files(repo: Path) -> list[Path]:
    files: list[Path] = []
    for directory in SCAN_DIRS:
        root = repo / directory
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in SCAN_SUFFIXES:
                continue
            relative = path.relative_to(repo).as_posix()
            if relative in IGNORED_PATHS:
                continue
            if any(part in {"__pycache__", "target"} for part in path.parts):
                continue
            files.append(path)
    return sorted(files)


def validate_debt_markers(repo: Path, files: list[Path]) -> list[str]:
    errors: list[str] = []
    for path in files:
        relative = path.relative_to(repo)
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if DEBT_MARKER_RE.search(line) and JUSTIFIED_DEBT_RE.search(line) is None:
                errors.append(
                    f"{relative}:{line_number}: unexplained TODO/FIXME; use "
                    "TODO(owner): reason (#issue)"
                )
    return errors


def deprecated_attrs(text: str) -> list[tuple[int, str]]:
    attrs: list[tuple[int, str]] = []
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        if DEPRECATED_ATTR_RE.search(line) is None:
            index += 1
            continue
        start = index + 1
        attr_lines = [line]
        while "]" not in lines[index] and index + 1 < len(lines):
            index += 1
            attr_lines.append(lines[index])
        attrs.append((start, " ".join(attr_lines)))
        index += 1
    return attrs


def validate_deprecated_attrs(repo: Path, files: list[Path], current: VersionKey) -> list[str]:
    errors: list[str] = []
    for path in files:
        if path.suffix != ".rs":
            continue
        relative = path.relative_to(repo)
        for line_number, attr in deprecated_attrs(path.read_text(encoding="utf-8")):
            since = SINCE_RE.search(attr)
            if since is None:
                errors.append(f"{relative}:{line_number}: #[deprecated] must include since = \"X.Y.Z\"")
                continue
            parse_version(since["version"])
            removal = REMOVAL_RE.search(attr)
            if removal is None:
                errors.append(
                    f"{relative}:{line_number}: #[deprecated] note must name a target removal version"
                )
                continue
            removal_version = parse_version(removal["version"])
            if ISSUE_RE.search(attr) is None:
                errors.append(f"{relative}:{line_number}: #[deprecated] note must link a tracking issue")
            if current >= removal_version:
                errors.append(
                    f"{relative}:{line_number}: removal version {removal['version']} is due; "
                    "remove the symbol or supersede ADR-14"
                )
    return errors


def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    current = workspace_version(repo)
    files = iter_source_files(repo)
    errors = validate_debt_markers(repo, files)
    errors.extend(validate_deprecated_attrs(repo, files, current))
    if errors:
        fail("\n".join(errors))
    print(f"validated ADR-14 managed-debt rules across {len(files)} production source file(s)")


if __name__ == "__main__":
    main()
