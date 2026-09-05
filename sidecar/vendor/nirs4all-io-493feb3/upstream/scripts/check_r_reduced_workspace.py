#!/usr/bin/env python3
# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Validate the reduced Cargo workspace embedded in the R configure script."""

from __future__ import annotations

import argparse
import re
import sys
import tomllib
from pathlib import Path
from typing import Any

R_CRATES = ("nirs4all-io-core", "nirs4all-io", "nirs4all-io-capi")
TEMPLATE_RE = re.compile(
    r"cat > \"\$RUST/Cargo\.toml\" <<'TOML'\n(?P<toml>.*?)\nTOML",
    re.DOTALL,
)


def _load_toml(path: Path) -> dict[str, Any]:
    with path.open("rb") as stream:
        return tomllib.load(stream)


def _dependency_contract(value: object) -> object:
    """Return dependency resolution data, excluding deliberately relocated paths."""
    if isinstance(value, str):
        return {"version": value}
    if not isinstance(value, dict):
        return value
    return {key: item for key, item in value.items() if key != "path"}


def _package_identity(package: dict[str, Any]) -> tuple[object, ...]:
    return (
        package.get("name"),
        package.get("version"),
        package.get("source"),
        package.get("checksum"),
    )


def _resolve_lock_dependency(dependency: str, by_name: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    parts = dependency.split(" ", 2)
    candidates = by_name.get(parts[0], [])
    if len(parts) >= 2:
        candidates = [item for item in candidates if item.get("version") == parts[1]]
    if len(parts) == 3:
        source = parts[2].removeprefix("(").removesuffix(")")
        candidates = [item for item in candidates if item.get("source") == source]
    return candidates


def _reachable_lock_packages(packages: list[dict[str, Any]]) -> tuple[set[tuple[object, ...]], list[str]]:
    """Resolve the exact lock closure rooted at local workspace packages."""
    errors: list[str] = []
    by_name: dict[str, list[dict[str, Any]]] = {}
    for package in packages:
        by_name.setdefault(str(package.get("name")), []).append(package)

    pending = [package for package in packages if package.get("source") is None]
    reachable: set[tuple[object, ...]] = set()
    while pending:
        package = pending.pop()
        identity = _package_identity(package)
        if identity in reachable:
            continue
        reachable.add(identity)
        for dependency in package.get("dependencies", []):
            candidates = _resolve_lock_dependency(dependency, by_name)
            if len(candidates) != 1:
                errors.append(f"bindings/r/Cargo.lock.rust: dependency {dependency!r} from {package.get('name')!r} resolves to {len(candidates)} packages")
                continue
            pending.append(candidates[0])
    return reachable, errors


def check_repository(root: Path) -> list[str]:
    """Return fail-closed drift messages for the R workspace and dedicated lock."""
    errors: list[str] = []
    root_manifest = _load_toml(root / "Cargo.toml")

    configure_text = (root / "bindings/r/configure").read_text(encoding="utf-8")
    match = TEMPLATE_RE.search(configure_text)
    if match is None:
        return ["bindings/r/configure: reduced Cargo workspace template not found"]
    reduced = tomllib.loads(match.group("toml"))

    expected_members = [f"vendored/{name}" for name in R_CRATES]
    workspace = reduced.get("workspace", {})
    if workspace.get("members") != expected_members:
        errors.append("bindings/r/configure: reduced workspace members differ from the R C ABI closure")
    if workspace.get("resolver") != root_manifest.get("workspace", {}).get("resolver"):
        errors.append("bindings/r/configure: Cargo resolver differs from the root workspace")

    required_package_keys: set[str] = set()
    required_dependencies: set[str] = set()
    for crate in R_CRATES:
        manifest = _load_toml(root / "crates" / crate / "Cargo.toml")
        for key, value in manifest.get("package", {}).items():
            if isinstance(value, dict) and value.get("workspace") is True:
                required_package_keys.add(key)
        for name, value in manifest.get("dependencies", {}).items():
            if isinstance(value, dict) and value.get("workspace") is True:
                required_dependencies.add(name)

    root_package = root_manifest.get("workspace", {}).get("package", {})
    reduced_package = workspace.get("package", {})
    for key in sorted(required_package_keys):
        if reduced_package.get(key) != root_package.get(key):
            errors.append(f"bindings/r/configure: workspace.package.{key} differs from Cargo.toml")

    root_dependencies = root_manifest.get("workspace", {}).get("dependencies", {})
    reduced_dependencies = workspace.get("dependencies", {})
    if set(reduced_dependencies) != required_dependencies:
        missing = sorted(required_dependencies - set(reduced_dependencies))
        extra = sorted(set(reduced_dependencies) - required_dependencies)
        errors.append(f"bindings/r/configure: workspace dependency closure differs (missing={missing}, extra={extra})")
    for name in sorted(required_dependencies & set(reduced_dependencies)):
        if _dependency_contract(reduced_dependencies[name]) != _dependency_contract(root_dependencies.get(name)):
            errors.append(f"bindings/r/configure: workspace dependency {name!r} version/features differ from Cargo.toml")
        if name in R_CRATES:
            expected_path = f"vendored/{name}"
            value = reduced_dependencies[name]
            if not isinstance(value, dict) or value.get("path") != expected_path:
                errors.append(f"bindings/r/configure: workspace dependency {name!r} must use path {expected_path!r}")

    root_lock = _load_toml(root / "Cargo.lock")
    r_lock_path = root / "bindings/r/Cargo.lock.rust"
    if not r_lock_path.is_file():
        errors.append("bindings/r/Cargo.lock.rust: dedicated lock file is missing")
        return errors
    r_lock = _load_toml(r_lock_path)
    if r_lock.get("version") != root_lock.get("version"):
        errors.append("bindings/r/Cargo.lock.rust: lock format differs from Cargo.lock")

    root_records = root_lock.get("package", [])
    root_package_records = {_package_identity(package): package for package in root_records}
    root_packages = set(root_package_records)
    root_by_name: dict[str, list[dict[str, Any]]] = {}
    for package in root_records:
        root_by_name.setdefault(str(package.get("name")), []).append(package)
    r_packages = r_lock.get("package", [])
    r_by_name: dict[str, list[dict[str, Any]]] = {}
    for package in r_packages:
        r_by_name.setdefault(str(package.get("name")), []).append(package)
    local_packages = {package.get("name") for package in r_packages if package.get("source") is None}
    if local_packages != set(R_CRATES):
        errors.append(f"bindings/r/Cargo.lock.rust: local package closure differs (expected={list(R_CRATES)}, found={sorted(local_packages)})")
    for package in r_packages:
        identity = _package_identity(package)
        if identity not in root_packages:
            errors.append(f"bindings/r/Cargo.lock.rust: package pin is absent from Cargo.lock: {package.get('name')} {package.get('version')}")
        elif package.get("source") is not None:
            root_children = {_package_identity(candidate) for dependency in root_package_records[identity].get("dependencies", []) for candidate in _resolve_lock_dependency(dependency, root_by_name)}
            r_children = {_package_identity(candidate) for dependency in package.get("dependencies", []) for candidate in _resolve_lock_dependency(dependency, r_by_name)}
            if not r_children <= root_children:
                errors.append(f"bindings/r/Cargo.lock.rust: dependency edges differ from Cargo.lock for {package.get('name')} {package.get('version')}")

    reachable, reachability_errors = _reachable_lock_packages(r_packages)
    errors.extend(reachability_errors)
    all_r_packages = {_package_identity(package) for package in r_packages}
    unreachable = sorted(all_r_packages - reachable, key=lambda item: str(item))
    if unreachable:
        errors.append("bindings/r/Cargo.lock.rust: contains packages outside the reduced R closure: " + ", ".join(f"{item[0]} {item[1]}" for item in unreachable))

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="repository root (defaults to the script parent)",
    )
    args = parser.parse_args()
    errors = check_repository(args.root.resolve())
    if errors:
        for error in errors:
            print(f"  DRIFT: {error}", file=sys.stderr)
        return 1
    print("  OK: R reduced Cargo workspace and dedicated lock match the root closure")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
