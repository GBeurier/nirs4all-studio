"""Availability uses configured-runtime imports, without executing operators."""
import pytest

from api import library_operator_availability as catalogue


def test_availability_reports_real_import_failures_without_constructing(monkeypatch):
    reference = {"version": "2", "generatedAt": "now", "nodes": [
        {"id": "snv", "name": "SNV", "type": "preprocessing", "classPath": "owner.SNV"},
        {"id": "network", "name": "Network", "type": "model", "functionPath": "owner.network"},
        {"id": "missing", "name": "Missing", "type": "model", "classPath": "missing.Model"},
        {"id": "comment", "name": "Comment", "type": "utility"},
    ]}
    monkeypatch.setattr(catalogue, "load_editor_registry_reference", lambda: reference)
    references = []

    def resolve(path, *, allow_callable=False):
        references.append((path, allow_callable))
        if path.startswith("missing"):
            raise ImportError("Missing optional package")

        def operator():
            raise AssertionError("Availability must never execute the operator")

        return operator

    monkeypatch.setattr(catalogue, "import_operator_class", resolve)
    result = catalogue.operator_availability({})
    assert result["checked_count"] == 3
    assert references == [("owner.SNV", False), ("owner.network", True), ("missing.Model", False)]
    assert len(result["unavailable"]) == 1
    assert result["unavailable"][0]["id"] == "missing"
    assert result["unavailable"][0]["error"] == "Missing optional package"
    assert result["computed_at"]


def test_availability_accepts_no_user_import_requests():
    with pytest.raises(ValueError, match="no request fields"):
        catalogue.operator_availability({"classPath": "untrusted.run"})
