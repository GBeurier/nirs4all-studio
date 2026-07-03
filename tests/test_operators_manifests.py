"""Tests for the GET /api/operators/manifests endpoint (W8, B-017 V1).

The endpoint is a thin, guarded proxy over nirs4all's public
``runtime.list_controller_manifests()`` accessor (W7 soft-dependency). It must:
- degrade gracefully (available=false, empty manifests) when the accessor is
  absent (W7 not landed);
- pass the accessor output through verbatim (no drift);
- in Studio gates, require the accessor + dag-ml schema and validate against the
  controller_manifest contract.
"""

from __future__ import annotations

import asyncio
import builtins
import json
from pathlib import Path

import pytest

from api import operators


def _dagml_controller_manifest_schema_path() -> Path:
    test_path = Path(__file__).resolve()
    candidates = [
        test_path.parents[1] / "dag-ml",
        test_path.parents[2] / "dag-ml",
        test_path.parents[3] / "dag-ml",
        test_path.parents[1] / "../RC-v1-dagml",
    ]
    for dagml_root in candidates:
        schema_path = dagml_root.resolve() / "docs" / "contracts" / "controller_manifest.schema.json"
        if schema_path.exists():
            return schema_path
    checked = ", ".join(str(path.resolve()) for path in candidates)
    raise AssertionError(f"Studio gate requires dag-ml controller_manifest schema; checked: {checked}")


def test_list_manifests_none_when_accessor_unavailable(monkeypatch):
    real_import = builtins.__import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "nirs4all.runtime" and "list_controller_manifests" in fromlist:
            raise ImportError("simulated missing runtime accessor")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert operators.list_controller_manifests() is None


def test_endpoint_degrades_when_accessor_absent(monkeypatch):
    monkeypatch.setattr(operators, "list_controller_manifests", lambda: None)
    monkeypatch.setattr(
        operators,
        "_module_version",
        lambda name: "0.9.1" if name == "nirs4all" else None,
    )
    response = asyncio.run(operators.get_operator_manifests())
    assert response.available is False
    assert response.manifests == []
    # nirs4all itself is installed in this env, so its version is reported.
    assert response.runtime.nirs4all_version == "0.9.1"


def test_endpoint_passthrough_has_no_drift(monkeypatch):
    """The endpoint returns the accessor output verbatim (no transformation)."""
    fake_manifests = [
        {"controller_id": "transform", "kind": "transform"},
        {"controller_id": "model", "kind": "model"},
    ]
    monkeypatch.setattr(operators, "list_controller_manifests", lambda: list(fake_manifests))
    response = asyncio.run(operators.get_operator_manifests())
    assert response.available is True
    assert response.manifests == fake_manifests


def test_endpoint_reports_unavailable_on_accessor_failure(monkeypatch):
    monkeypatch.setattr(operators, "list_controller_manifests", lambda: None)
    response = asyncio.run(operators.get_operator_manifests())
    assert response.available is False
    assert response.manifests == []


def test_manifests_validate_against_dagml_schema():
    """Studio gates require W7 + the dag-ml contract and validate manifests."""
    manifests = operators.list_controller_manifests()
    assert manifests is not None, "Studio gate requires nirs4all.runtime.list_controller_manifests()"

    schema_path = _dagml_controller_manifest_schema_path()

    import jsonschema

    schema = json.loads(schema_path.read_text())
    for manifest in manifests:
        jsonschema.validate(manifest, schema)
