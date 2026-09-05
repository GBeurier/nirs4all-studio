# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Canonical-JSON parity gate, Python side (story 7.3).

Both this test and the Rust test (`crates/nirs4all-io-core/tests/canonical_parity.rs`)
canonicalize the *same* input corpus and compare against the *same* blessed
expected files under `tests/goldens/canonical/`. Because the expected files are
blessed from this Python implementation, a green Rust test proves Python ≡ Rust
byte-for-byte. Re-bless with `NIRS4ALL_IO_ACCEPT_GOLDENS=1 pytest`.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from nirs4all_io.canonical_json import canonical_json

_GOLDEN_DIR = Path(__file__).parent / "goldens" / "canonical"
_CASES = json.loads((_GOLDEN_DIR / "cases.json").read_text(encoding="utf-8"))
_ACCEPT = os.environ.get("NIRS4ALL_IO_ACCEPT_GOLDENS") == "1"


@pytest.mark.parametrize("name", sorted(_CASES))
def test_canonical_json_matches_golden(name: str) -> None:
    produced = canonical_json(_CASES[name])
    golden = _GOLDEN_DIR / f"{name}.canonical"
    if _ACCEPT:
        golden.write_text(produced, encoding="utf-8")
        return
    expected = golden.read_text(encoding="utf-8")
    assert produced == expected, f"canonical-JSON drift for {name!r}"


def test_canonical_json_rejects_non_finite() -> None:
    with pytest.raises(ValueError):
        canonical_json({"x": float("nan")})
    with pytest.raises(ValueError):
        canonical_json({"x": float("inf")})


def test_canonical_json_is_idempotent() -> None:
    for name in _CASES:
        once = canonical_json(_CASES[name])
        twice = canonical_json(json.loads(once))
        assert once == twice
