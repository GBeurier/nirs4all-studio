# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Drift guard: the convention TOMLs embedded in the Rust core crate must stay
byte-identical to the Python package source (single logical source of truth).

The Rust crate keeps a crate-local copy (so a packaged crate compiles without the
workspace root); this test fails CI if the two copies diverge.
"""

from __future__ import annotations

from pathlib import Path

_PY = Path(__file__).parent.parent / "src" / "nirs4all_io" / "conventions" / "builtin"
_RS = Path(__file__).parent.parent / "crates" / "nirs4all-io-core" / "conventions" / "builtin"

_PROFILES = ["bare", "nirs4all-classic", "train-test", "vendor-corpus"]


def test_convention_tomls_byte_identical() -> None:
    for name in _PROFILES:
        py = (_PY / f"{name}.toml").read_bytes()
        rs = (_RS / f"{name}.toml").read_bytes()
        assert py == rs, f"convention profile {name}.toml drifted between Python and the Rust crate copy"
