# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Cross-language contract goldens (story 6.4 / 7.4) — Python side.

Freezes, byte-for-byte, what the *current Python* `to_spec` and `infer` emit for
a fixed deterministic corpus. The Rust facade (EPIC 8, SYNC #1) must reproduce
these exact canonical files; the day it does, the Python core can be relegated
to a dev-only oracle.

The corpus is static on-disk bytes under `goldens/contract/corpus/` so both
languages read identical input. Outputs embed absolute paths (infer absolutizes
source inputs and records the directory it scanned); those are normalized to a
`<CORPUS>` placeholder so goldens are machine-independent. Normalization is a
**prefix replacement only** — it never rewrites backslashes, so selector
regexes like ``^\\d+$`` survive intact. The Rust reproducer mirrors this rule.

Re-bless with ``NIRS4ALL_IO_ACCEPT_GOLDENS=1 pytest tests/test_contract_goldens.py``.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

import nirs4all_io as nio
from nirs4all_io.canonical_json import canonical_json

_CONTRACT_DIR = Path(__file__).parent / "goldens" / "contract"
_BASE_ABS = str(_CONTRACT_DIR.resolve())
_MANIFEST = json.loads((_CONTRACT_DIR / "manifest.json").read_text(encoding="utf-8"))
_CASES = {c["name"]: c for c in _MANIFEST["cases"]}
_ACCEPT = os.environ.get("NIRS4ALL_IO_ACCEPT_GOLDENS") == "1"


def _normalize_paths(obj: Any, base_abs: str) -> Any:
    """Replace the corpus absolute prefix with ``<CORPUS>`` (prefix-only)."""
    if isinstance(obj, str):
        return obj.replace(base_abs + os.sep, "<CORPUS>/").replace(base_abs, "<CORPUS>")
    if isinstance(obj, list):
        return [_normalize_paths(x, base_abs) for x in obj]
    if isinstance(obj, dict):
        return {k: _normalize_paths(v, base_abs) for k, v in obj.items()}
    return obj


def _build_input(case: dict) -> Any:
    spec = case["input"]
    if "spec" in spec:
        return spec["spec"]
    if "config_file" in spec:
        return str(_CONTRACT_DIR / spec["config_file"])
    if "dir" in spec:
        return str(_CONTRACT_DIR / spec["dir"])
    if "files" in spec:
        return [str(_CONTRACT_DIR / f) for f in spec["files"]]
    raise ValueError(f"unknown input form: {spec!r}")


def _run_case(case: dict) -> str:
    inp = _build_input(case)
    conventions = case.get("conventions")
    if case["op"] == "to_spec":
        out = nio.to_spec(inp, conventions=conventions)[0].to_dict()
    elif case["op"] == "infer":
        out = nio.infer(inp, conventions=conventions).to_dict()
    else:
        raise ValueError(f"unknown op: {case['op']!r}")
    return canonical_json(_normalize_paths(out, _BASE_ABS))


@pytest.mark.parametrize("name", sorted(_CASES))
def test_contract_golden(name: str) -> None:
    case = _CASES[name]
    produced = _run_case(case)
    golden = _CONTRACT_DIR / f"{name}.{case['op']}.canonical"
    if _ACCEPT:
        golden.write_text(produced, encoding="utf-8")
        return
    expected = golden.read_text(encoding="utf-8")
    assert produced == expected, f"contract drift for {name} ({case['op']})"


def test_contract_goldens_are_reproducible() -> None:
    """Running each case twice yields identical output (no nondeterminism)."""
    for name, case in _CASES.items():
        assert _run_case(case) == _run_case(case), f"nondeterministic output for {name}"
