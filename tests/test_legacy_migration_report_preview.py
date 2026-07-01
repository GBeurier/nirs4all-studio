"""Read-only preview of nirs4all-tools migration reports."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.workspace import router_maintenance

REPORT_ID = "nirs4all-tools/contracts/legacy_migration_report.v1.json"
MANIFEST_ID = "nirs4all-tools/contracts/legacy_migration_manifest.v1.json"
UNSUPPORTED_ID = "nirs4all-tools/contracts/legacy_unsupported_report.v1.json"


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router_maintenance.router, prefix="/api")
    return TestClient(app)


def _write_json(path: Path, payload: dict[str, Any]) -> Path:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def _report(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "$id": REPORT_ID,
        "schema_version": 1,
        "status": "migrated_with_warnings",
        "source_summary": {"kinds": ["native-results-v1"], "row_counts": {"native_prediction_rows": 1}},
        "target_summary": {"kind": "nirs4all-workspace-v2", "path": "/tmp/migrated"},
        "migrated_counts": {"runs": 1, "pipelines": 1, "chains": 1, "predictions": 1, "arrays": 1, "artifacts": 0},
        "preserved_counts": {"native_payloads": 1},
        "unsupported_counts": {"refused": 0, "preserved": 0},
        "verification_summary": {"ran": True, "passed": True, "checks": {}, "mismatches": 0},
        "errors": [],
        "warnings": ["opaque payload preserved"],
        "recommended_next_command": "nirs4all-tools legacy verify /tmp/migrated --manifest migration-manifest.json",
    }
    payload.update(overrides)
    return payload


def _manifest(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "$id": MANIFEST_ID,
        "schema_version": 1,
        "target": {"kind": "nirs4all-workspace-v2", "schema_version": 2},
        "source": {"path": "/private/source"},
        "input_inventory": [{"path": "private.db"}],
        "checksums": {"store.sqlite": "secret"},
    }
    payload.update(overrides)
    return payload


def _unsupported(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "$id": UNSUPPORTED_ID,
        "schema_version": 1,
        "target": {"kind": "nirs4all-workspace-v2", "schema_version": 2, "path": "/tmp/migrated"},
        "counts": {"unsupported": 1, "preserved": 1, "refused": 0, "opaque_payloads": 1},
        "unsupported": [{"path": "private-payload", "reason": "unsupported"}],
        "preserved_opaque": [{"path": "preserved/private-payload", "checksum": "secret"}],
    }
    payload.update(overrides)
    return payload


def _post_preview(client: TestClient, payload: dict[str, Any]):
    return client.post("/api/workspace/migrate/report-preview", json=payload)


def test_preview_report_returns_summary_only_and_keeps_recommended_command_as_string(tmp_path: Path) -> None:
    report_path = _write_json(tmp_path / "migration-report.json", _report())

    with _client() as client:
        response = _post_preview(client, {"report_path": str(report_path)})

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "status": "migrated_with_warnings",
        "source_summary": {
            "kinds": ["native-results-v1"],
            "row_counts": {"native_prediction_rows": 1},
            "bundles": 0,
            "artifacts": 0,
        },
        "target_summary": {"path": "/tmp/migrated"},
        "target_schema_version_validated": False,
        "migrated_counts": {"runs": 1, "pipelines": 1, "chains": 1, "predictions": 1, "arrays": 1, "artifacts": 0},
        "preserved_counts": {"native_payloads": 1},
        "unsupported_counts": {"refused": 0, "preserved": 0},
        "verification_summary": {"ran": True, "passed": True, "checks": {}, "mismatches": 0},
        "errors": [],
        "warnings": [
            "opaque payload preserved",
            "target schema version was not validated; provide migration-manifest.json or unsupported-report.json",
        ],
        "recommended_next_command": (
            "nirs4all-tools legacy verify /tmp/migrated --manifest migration-manifest.json"
        ),
    }
    assert "report_path" not in body
    assert "unsupported" not in body
    assert "checksums" not in body


def test_preview_report_sanitizes_nested_summary_fields(tmp_path: Path) -> None:
    report_path = _write_json(
        tmp_path / "migration-report.json",
        _report(
            source_summary={
                "kinds": ["native-results-v1", {"leak": "SECRET"}],
                "row_counts": {"native_prediction_rows": 1, "private": {"path": "SECRET"}},
                "bundles": 2,
                "artifacts": 3,
                "private_source_path": "SECRET",
            },
            migrated_counts={"runs": 1, "private": {"checksum": "SECRET"}},
            verification_summary={
                "ran": True,
                "passed": True,
                "checks": {
                    "array_checksum_coverage": {
                        "status": "passed",
                        "paths": ["SECRET"],
                        "checksum": "SECRET",
                    }
                },
                "private": "SECRET",
            },
            errors=[
                {
                    "code": "E001",
                    "cause": "unsupported_shape",
                    "message": "safe error",
                    "mitigation": "safe mitigation",
                    "private": "SECRET",
                },
                ["SECRET"],
            ],
            warnings=["safe warning", {"private": "SECRET"}],
        ),
    )

    with _client() as client:
        response = _post_preview(client, {"report_path": str(report_path)})

    assert response.status_code == 200
    body = response.json()
    assert body["source_summary"] == {
        "kinds": ["native-results-v1"],
        "row_counts": {"native_prediction_rows": 1},
        "bundles": 2,
        "artifacts": 3,
    }
    assert body["migrated_counts"] == {"runs": 1}
    assert body["verification_summary"] == {
        "ran": True,
        "passed": True,
        "checks": {"array_checksum_coverage": {"status": "passed"}},
        "mismatches": 0,
    }
    assert body["errors"] == [
        {
            "code": "E001",
            "cause": "unsupported_shape",
            "message": "safe error",
            "mitigation": "safe mitigation",
        }
    ]
    assert body["warnings"] == [
        "safe warning",
        "target schema version was not validated; provide migration-manifest.json or unsupported-report.json",
    ]
    assert "SECRET" not in json.dumps(body)


def test_preview_report_with_manifest_validates_target_schema(tmp_path: Path) -> None:
    report_path = _write_json(tmp_path / "migration-report.json", _report())
    manifest_path = _write_json(tmp_path / "migration-manifest.json", _manifest())

    with _client() as client:
        response = _post_preview(client, {"report_path": str(report_path), "manifest_path": str(manifest_path)})

    assert response.status_code == 200
    assert response.json()["target_schema_version_validated"] is True
    assert response.json()["warnings"] == ["opaque payload preserved"]


def test_preview_report_with_unsupported_report_validates_contract_and_target(tmp_path: Path) -> None:
    report_path = _write_json(tmp_path / "migration-report.json", _report())
    unsupported_path = _write_json(tmp_path / "unsupported-report.json", _unsupported())

    with _client() as client:
        response = _post_preview(
            client,
            {
                "report_path": str(report_path),
                "unsupported_report_path": str(unsupported_path),
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["target_schema_version_validated"] is True
    assert "unsupported" not in body
    assert "preserved_opaque" not in body


def test_preview_rejects_invalid_report_id(tmp_path: Path) -> None:
    report_path = _write_json(tmp_path / "migration-report.json", _report(**{"$id": "wrong"}))

    with _client() as client:
        response = _post_preview(client, {"report_path": str(report_path)})

    assert response.status_code == 400
    assert "unexpected $id" in response.json()["detail"]


def test_preview_rejects_invalid_report_schema_version(tmp_path: Path) -> None:
    report_path = _write_json(tmp_path / "migration-report.json", _report(schema_version=2))

    with _client() as client:
        response = _post_preview(client, {"report_path": str(report_path)})

    assert response.status_code == 400
    assert "unsupported schema_version" in response.json()["detail"]


def test_preview_rejects_invalid_target_kind(tmp_path: Path) -> None:
    report = _report(target_summary={"kind": "native-results-v1", "path": "/tmp/out"})
    report_path = _write_json(tmp_path / "migration-report.json", report)

    with _client() as client:
        response = _post_preview(client, {"report_path": str(report_path)})

    assert response.status_code == 400
    assert "target.kind" in response.json()["detail"]


def test_preview_rejects_invalid_report_target_schema_version_without_optional_files(tmp_path: Path) -> None:
    report = _report(target_summary={"kind": "nirs4all-workspace-v2", "path": "/tmp/out", "schema_version": 99})
    report_path = _write_json(tmp_path / "migration-report.json", report)

    with _client() as client:
        response = _post_preview(client, {"report_path": str(report_path)})

    assert response.status_code == 400
    assert "target_summary.schema_version" in response.json()["detail"]


def test_preview_rejects_invalid_manifest_target_schema_version(tmp_path: Path) -> None:
    report_path = _write_json(tmp_path / "migration-report.json", _report())
    manifest_path = _write_json(
        tmp_path / "migration-manifest.json",
        _manifest(target={"kind": "nirs4all-workspace-v2", "schema_version": 99}),
    )

    with _client() as client:
        response = _post_preview(client, {"report_path": str(report_path), "manifest_path": str(manifest_path)})

    assert response.status_code == 400
    assert "target.schema_version" in response.json()["detail"]


def test_preview_rejects_non_string_recommended_next_command(tmp_path: Path) -> None:
    report_path = _write_json(tmp_path / "migration-report.json", _report(recommended_next_command=["do", "not"]))

    with _client() as client:
        response = _post_preview(client, {"report_path": str(report_path)})

    assert response.status_code == 400
    assert "recommended_next_command" in response.json()["detail"]


def test_preview_missing_file_returns_404(tmp_path: Path) -> None:
    with _client() as client:
        response = _post_preview(client, {"report_path": str(tmp_path / "missing.json")})

    assert response.status_code == 404


def test_preview_malformed_json_returns_400(tmp_path: Path) -> None:
    report_path = tmp_path / "migration-report.json"
    report_path.write_text("{not-json", encoding="utf-8")

    with _client() as client:
        response = _post_preview(client, {"report_path": str(report_path)})

    assert response.status_code == 400
    assert "not valid JSON" in response.json()["detail"]


def test_preview_does_not_mutate_input_files(tmp_path: Path) -> None:
    report_path = _write_json(tmp_path / "migration-report.json", _report())
    before = (report_path.read_bytes(), report_path.stat().st_mtime_ns)

    with _client() as client:
        response = _post_preview(client, {"report_path": str(report_path)})

    assert response.status_code == 200
    assert (report_path.read_bytes(), report_path.stat().st_mtime_ns) == before


def test_preview_does_not_spawn_subprocesses(tmp_path: Path, monkeypatch) -> None:
    report_path = _write_json(tmp_path / "migration-report.json", _report())

    def fail(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("subprocess must not be used")

    monkeypatch.setattr(subprocess, "run", fail)
    monkeypatch.setattr(subprocess, "Popen", fail)

    with _client() as client:
        response = _post_preview(client, {"report_path": str(report_path)})

    assert response.status_code == 200
