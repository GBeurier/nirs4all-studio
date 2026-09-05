#!/usr/bin/env python3
"""Validate the checked-in public C ABI header snapshot."""

from __future__ import annotations

import hashlib
import json
import tomllib
from pathlib import Path
from typing import Any


def fail(message: str) -> None:
    raise SystemExit(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def load_toml(path: Path) -> dict[str, Any]:
    with path.open("rb") as handle:
        return tomllib.load(handle)


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    repo = Path(__file__).resolve().parents[1]
    cargo = load_toml(repo / "Cargo.toml")
    package = cargo["workspace"]["package"]
    repo_name = package["repository"].removesuffix("/").split("/")[-1]
    snapshot_path = repo / "docs" / "contracts" / "abi_snapshot.v1.json"
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))

    require(snapshot["schema_version"] == 1, "ABI snapshot schema_version must be 1")
    require(snapshot["crate"] == repo_name, "ABI snapshot crate name mismatch")
    require(
        snapshot["package_version"] == package["version"],
        "ABI snapshot package_version must match Cargo workspace version",
    )
    headers = snapshot.get("headers", [])
    require(headers, "ABI snapshot must list at least one public header")
    for header in headers:
        relative_path = header["path"]
        require(not Path(relative_path).is_absolute(), "ABI header path must be relative")
        header_path = repo / relative_path
        require(header_path.is_file(), f"ABI header path does not exist: {relative_path}")
        digest = sha256_file(header_path)
        require(
            digest == header["sha256"],
            f"ABI header snapshot drift for {relative_path}: expected {header['sha256']}, got {digest}",
        )
    print(f"validated ABI snapshot for {repo_name} {package['version']}")


if __name__ == "__main__":
    main()
