#!/usr/bin/env python3
"""Validate an ordinary qualification run or an explicitly pinned tag repair."""
from __future__ import annotations

import argparse
import re
import subprocess
import tomllib
from pathlib import Path


def validate_source(root: Path, repair_tag: str = "", methods_ref: str = "") -> None:
    if methods_ref and not re.fullmatch(r"[0-9a-f]{40}", methods_ref):
        raise ValueError("methods_ref must be an immutable lowercase Git commit SHA")
    if not repair_tag:
        return
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+(?:-rc[0-9]+)?", repair_tag):
        raise ValueError("repair_tag must name a version tag")
    manifest = tomllib.loads((root / "bindings/rust/nirs4all/Cargo.toml").read_text())
    if manifest["package"]["version"] != repair_tag[1:]:
        raise ValueError("repair tag and source package version do not match")
    subprocess.run(
        ["git", "merge-base", "--is-ancestor", f"refs/tags/{repair_tag}", "HEAD"],
        cwd=root, check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repair-tag", default="")
    parser.add_argument("--methods-ref", default="")
    args = parser.parse_args()
    validate_source(Path(__file__).resolve().parents[1], args.repair_tag, args.methods_ref)


if __name__ == "__main__":
    main()
