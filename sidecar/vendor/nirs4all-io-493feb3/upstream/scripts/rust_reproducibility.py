#!/usr/bin/env python3
# SPDX-License-Identifier: CECILL-2.1 OR AGPL-3.0-or-later
"""Environment helpers for release binaries without embedded host paths."""

from __future__ import annotations

import os
import shlex
from pathlib import Path


def reproducible_rust_env(
    root: Path,
    target_dir: Path,
    base: dict[str, str] | None = None,
    extra_roots: tuple[Path, ...] = (),
) -> dict[str, str]:
    env = dict(base or os.environ)
    encoded = env.pop("CARGO_ENCODED_RUSTFLAGS", "")
    flags = encoded.split("\x1f") if encoded else shlex.split(env.pop("RUSTFLAGS", ""))
    cargo_home = Path(env.get("CARGO_HOME", str(Path.home() / ".cargo"))).resolve()
    rustup_home = Path(env.get("RUSTUP_HOME", str(Path.home() / ".rustup"))).resolve()
    mappings = (
        (root.resolve(), Path("/usr/src/nirs4all-io")),
        (cargo_home, Path("/usr/local/cargo")),
        (rustup_home, Path("/usr/local/rustup")),
        (target_dir.resolve(), Path("/usr/src/nirs4all-io/target")),
        *(
            (source.resolve(), Path(f"/usr/src/nirs4all-io/build-{index}"))
            for index, source in enumerate(extra_roots)
        ),
    )
    flags.extend(f"--remap-path-prefix={source}={destination}" for source, destination in mappings)
    env["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join(flag for flag in flags if flag)
    env["CARGO_INCREMENTAL"] = "0"
    env["CARGO_TARGET_DIR"] = str(target_dir)
    return env
