# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("qualification.py")
SPEC = importlib.util.spec_from_file_location("io_xlg_qualification", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
qualification = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = qualification
SPEC.loader.exec_module(qualification)


def _rows(disposition: str = "passed") -> list[dict[str, object]]:
    return [
        {"surface": surface, "disposition": disposition, "reason": "test", "artifacts": []}
        for surface in qualification.SURFACES
    ]


def test_complete_requires_every_surface_passed() -> None:
    assert qualification.finalize_report(_rows())["overall_complete"] is True
    rows = _rows()
    rows[3]["disposition"] = "unavailable"
    assert qualification.finalize_report(rows)["overall_complete"] is False
    rows = _rows()
    rows[2]["disposition"] = "refused"
    assert qualification.finalize_report(rows)["overall_complete"] is False


def test_frozen_summary_carries_every_identity_axis() -> None:
    summary = json.loads(qualification.GOLDEN.read_text(encoding="utf-8"))
    qualification.validate_identity(summary)
    assert summary["assembled_schema_version"] == 2
    assert summary["blocks"]["train"]["source_ids"] == ["data"]
    assert summary["folds"] == [[[0, 2], [1]]]


def test_strict_runner_never_installs_r_dependencies() -> None:
    source = MODULE_PATH.read_text(encoding="utf-8")
    assert "install.packages" not in source
    assert "requireNamespace('jsonlite',quietly=TRUE)" in source
