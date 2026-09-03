#!/usr/bin/env python3
"""Publish workspace crates to crates.io in dependency order."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import time
import tomllib
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ALREADY_UPLOADED = re.compile(
    r"already (exists|uploaded)|is already being published|crate version .* is already",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Crate:
    name: str
    manifest: Path
    internal_deps: tuple[str, ...]


def fail(message: str) -> None:
    raise SystemExit(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def load_toml(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def dependency_names(table: dict[str, Any]) -> set[str]:
    names: set[str] = set()
    for section in ("dependencies", "build-dependencies", "dev-dependencies"):
        values = table.get(section, {})
        if isinstance(values, dict):
            names.update(values)
    for target in table.get("target", {}).values():
        if not isinstance(target, dict):
            continue
        for section in ("dependencies", "build-dependencies", "dev-dependencies"):
            values = target.get(section, {})
            if isinstance(values, dict):
                names.update(values)
    return names


def package_version(
    package: dict[str, Any], workspace_version: str, manifest_path: Path
) -> str:
    value = package.get("version")
    if isinstance(value, dict):
        require(
            value.get("workspace") is True,
            f"{manifest_path}: package.version table must inherit from workspace",
        )
        return workspace_version
    require(isinstance(value, str), f"{manifest_path}: package.version is missing")
    return value


def topo_sort(crates: list[Crate]) -> list[Crate]:
    remaining = {crate.name: crate for crate in crates}
    ordered: list[Crate] = []
    published: set[str] = set()

    while remaining:
        ready = sorted(
            [
                crate
                for crate in remaining.values()
                if set(crate.internal_deps).issubset(published)
            ],
            key=lambda crate: crate.name,
        )
        require(
            bool(ready),
            "publish plan contains an internal dependency cycle: "
            + ", ".join(sorted(remaining)),
        )
        for crate in ready:
            ordered.append(crate)
            published.add(crate.name)
            del remaining[crate.name]

    return ordered


def workspace_crates(repo: Path) -> tuple[str, list[Crate]]:
    root = load_toml(repo / "Cargo.toml")
    workspace = root["workspace"]
    workspace_version = workspace["package"]["version"]
    workspace_deps = workspace.get("dependencies", {})

    manifests: dict[str, dict[str, Any]] = {}
    manifest_paths: dict[str, Path] = {}

    for member in workspace["members"]:
        manifest_path = repo / member / "Cargo.toml"
        manifest = load_toml(manifest_path)
        package = manifest["package"]
        if package.get("publish") is False:
            continue
        name = package["name"]
        version = package_version(package, workspace_version, manifest_path)
        require(
            version == workspace_version,
            f"{manifest_path}: package.version must equal workspace version {workspace_version}",
        )
        manifests[name] = manifest
        manifest_paths[name] = manifest_path

    crates: list[Crate] = []
    package_names = set(manifests)
    for name, manifest in manifests.items():
        internal = sorted(dependency_names(manifest).intersection(package_names))
        for dep_name in internal:
            dep = workspace_deps.get(dep_name)
            require(isinstance(dep, dict), f"workspace dependency {dep_name} must be a table")
            require(dep.get("path"), f"workspace dependency {dep_name} must declare path")
            require(
                dep.get("version") == workspace_version,
                f"workspace dependency {dep_name} must pin version {workspace_version}",
            )
        crates.append(
            Crate(
                name=name,
                manifest=manifest_paths[name],
                internal_deps=tuple(internal),
            )
        )

    require(crates, "publish plan has no publishable workspace crates")
    return workspace_version, topo_sort(crates)


def validate_tag(tag: str, version: str) -> None:
    require(tag.startswith("v"), f"release tag must start with v: {tag}")
    tag_version = tag.removeprefix("v")
    require(
        tag_version == version,
        f"release tag {tag} does not match workspace version {version}",
    )


def cargo_publish(crate: Crate, dry_run: bool, no_verify: bool) -> str:
    cmd = ["cargo", "publish", "-p", crate.name]
    if dry_run:
        cmd.extend(["--dry-run", "--allow-dirty"])
    if no_verify:
        cmd.append("--no-verify")

    print(f"::group::publish {crate.name} (dry_run={int(dry_run)})", flush=True)
    proc = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if proc.stdout:
        print(proc.stdout, end="" if proc.stdout.endswith("\n") else "\n")
    print("::endgroup::", flush=True)

    if proc.returncode == 0:
        return "published"
    if not dry_run and ALREADY_UPLOADED.search(proc.stdout or ""):
        print(f"::notice::{crate.name} version already exists on crates.io; continuing")
        return "already"
    raise SystemExit(proc.returncode)


def crate_version_exists(name: str, version: str) -> bool:
    request = urllib.request.Request(
        f"https://crates.io/api/v1/crates/{name}/{version}",
        headers={"User-Agent": "dag-ml-release-script"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30):
            return True
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return False
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--tag", help="release tag to validate, for example v0.2.0")
    parser.add_argument("--no-verify", action="store_true", help="pass --no-verify to cargo publish")
    parser.add_argument("--plan-only", action="store_true", help="print the publish order and exit")
    parser.add_argument(
        "--sleep-seconds",
        type=int,
        default=120,
        help="delay after each successful upload so the crates.io sparse index catches up",
    )
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[2]
    version, crates = workspace_crates(repo)
    if args.tag:
        validate_tag(args.tag, version)

    print(
        f"publish plan for {len(crates)} crate(s) at {version}: "
        + " -> ".join(crate.name for crate in crates)
    )
    if args.plan_only:
        return

    if not args.dry_run and "CARGO_REGISTRY_TOKEN" not in os.environ:
        fail("CARGO_REGISTRY_TOKEN is required for cargo publish authentication")

    for index, crate in enumerate(crates):
        if not args.dry_run and crate_version_exists(crate.name, version):
            print(f"::notice::{crate.name} {version} already exists on crates.io; skipping")
            continue
        result = cargo_publish(crate, dry_run=args.dry_run, no_verify=args.no_verify)
        if (
            not args.dry_run
            and result == "published"
            and args.sleep_seconds > 0
            and index < len(crates) - 1
        ):
            time.sleep(args.sleep_seconds)


if __name__ == "__main__":
    main()
