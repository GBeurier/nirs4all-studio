#!/usr/bin/env python3
# SPDX-License-Identifier: CECILL-2.1 OR AGPL-3.0-or-later
"""Export deterministic Rust path remapping into a GitHub Actions environment."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    github_env = os.environ.get("GITHUB_ENV")
    if not github_env:
        raise SystemExit("GITHUB_ENV is required")
    cargo_home = Path(os.environ.get("CARGO_HOME", str(Path.home() / ".cargo"))).resolve()
    rustup_home = Path(os.environ.get("RUSTUP_HOME", str(Path.home() / ".rustup"))).resolve()
    if any(" " in path.as_posix() for path in (ROOT, cargo_home, rustup_home)):
        raise SystemExit("release checkout and Cargo home paths must not contain spaces")
    existing = os.environ.get("RUSTFLAGS", "").strip()
    flags = " ".join(
        value
        for value in (
            existing,
            f"--remap-path-prefix={ROOT.as_posix()}=/usr/src/nirs4all-io",
            f"--remap-path-prefix={cargo_home.as_posix()}=/usr/local/cargo",
            f"--remap-path-prefix={rustup_home.as_posix()}=/usr/local/rustup",
        )
        if value
    )
    epoch = subprocess.check_output(
        ["git", "-C", str(ROOT), "log", "-1", "--format=%ct", "HEAD"],
        text=True,
    ).strip()
    with Path(github_env).open("a", encoding="utf-8") as stream:
        stream.write(f"RUSTFLAGS={flags}\n")
        stream.write("CARGO_INCREMENTAL=0\n")
        stream.write(f"SOURCE_DATE_EPOCH={epoch}\n")
    print("configured canonical Rust source-path metadata")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
