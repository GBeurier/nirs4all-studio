"""Tests for the GET /api/operators/manifests endpoint (W8, B-017 V1).

The endpoint is a thin, guarded proxy over nirs4all's public
``runtime.list_controller_manifests()`` accessor (W7 soft-dependency). It must:
- degrade gracefully (available=false, empty manifests) when the accessor is
  absent (W7 not landed);
- pass the accessor output through verbatim (no drift);
- when the accessor + the dag-ml schema are both present, validate against the
  controller_manifest contract.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from api import operators


def _runtime_accessor_available() -> bool:
    try:
        import nirs4all.runtime  # noqa: F401
    except Exception:
        return False
    return operators.list_controller_manifests() is not None


def test_list_manifests_none_when_accessor_unavailable():
    if _runtime_accessor_available():
        pytest.skip("nirs4all.runtime accessor present (W7 landed); see no-drift test")
    assert operators.list_controller_manifests() is None


def test_endpoint_degrades_when_accessor_absent():
    if _runtime_accessor_available():
        pytest.skip("nirs4all.runtime accessor present (W7 landed)")
    response = asyncio.run(operators.get_operator_manifests())
    assert response.available is False
    assert response.manifests == []
    # nirs4all itself is installed in this env, so its version is reported.
    assert response.runtime.nirs4all_version is not None


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
    """When W7 + the dag-ml contract are both present, manifests match the schema."""
    manifests = operators.list_controller_manifests()
    if manifests is None:
        pytest.skip("nirs4all.runtime accessor unavailable (W7 not landed)")

    schema_path = (
        Path(__file__).resolve().parents[3]
        / "dag-ml"
        / "docs"
        / "contracts"
        / "controller_manifest.schema.json"
    )
    if not schema_path.exists():
        pytest.skip("dag-ml controller_manifest schema not available")

    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads(schema_path.read_text())
    for manifest in manifests:
        jsonschema.validate(manifest, schema)
