"""Transition-release workspace conversion API tests."""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("SENTRY_DSN", "")
sys.path.insert(0, str(Path(__file__).parent.parent))


def _client_with_workspace(monkeypatch, workspace_path: Path):
    from fastapi.testclient import TestClient

    from api.workspace import router_maintenance
    from main import app

    monkeypatch.setattr(
        router_maintenance.workspace_manager,
        "get_current_workspace",
        lambda: SimpleNamespace(path=str(workspace_path), name="Workspace"),
    )
    return TestClient(app)


def test_transition_status_detects_legacy_duckdb(monkeypatch, tmp_path):
    workspace = tmp_path / "legacy"
    workspace.mkdir()
    (workspace / "store.duckdb").touch()

    with _client_with_workspace(monkeypatch, workspace) as client:
        response = client.get("/api/workspace/transition-status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["format"] == "duckdb-workspace"
    assert payload["conversion_required"] is True
    assert "nirs4all_tools" in payload["conversion_command"]
    assert payload["default_output_path"].endswith("legacy-workspace-v2")


def test_transition_status_detects_legacy_sqlite_prediction_arrays(monkeypatch, tmp_path):
    workspace = tmp_path / "legacy-sqlite"
    workspace.mkdir()
    sqlite_path = workspace / "store.sqlite"
    with sqlite3.connect(sqlite_path) as conn:
        conn.execute("CREATE TABLE prediction_arrays (prediction_id TEXT PRIMARY KEY, payload TEXT)")

    with _client_with_workspace(monkeypatch, workspace) as client:
        response = client.get("/api/workspace/transition-status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["format"] == "sqlite-workspace-legacy-arrays"
    assert payload["conversion_required"] is True
    assert "prediction_arrays" in payload["message"]
    assert "nirs4all_tools" in payload["conversion_command"]


def test_transition_status_detects_legacy_filesystem_runs(monkeypatch, tmp_path):
    workspace = tmp_path / "legacy-runs"
    manifest = workspace / "runs" / "diesel" / "0001_pls" / "manifest.yaml"
    manifest.parent.mkdir(parents=True)
    manifest.write_text("run_id: 0001_pls\n", encoding="utf-8")

    with _client_with_workspace(monkeypatch, workspace) as client:
        response = client.get("/api/workspace/transition-status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["format"] == "fs-runs-legacy"
    assert payload["conversion_required"] is True
    assert "filesystem run manifests" in payload["message"]
    assert "nirs4all_tools" in payload["conversion_command"]


def test_legacy_conversion_dry_run_omits_verify(monkeypatch, tmp_path):
    workspace = tmp_path / "legacy"
    workspace.mkdir()
    (workspace / "store.duckdb").touch()
    seen: dict[str, list[str]] = {}

    from api.workspace import router_maintenance

    def fake_converter(command: list[str]) -> dict:
        seen["command"] = command
        return {"return_code": 0, "stdout": "ok", "stderr": "", "success": True}

    monkeypatch.setattr(router_maintenance, "_run_legacy_workspace_converter", fake_converter)

    with _client_with_workspace(monkeypatch, workspace) as client:
        response = client.post("/api/workspace/legacy-convert", json={"dry_run": True, "verify": True})

    assert response.status_code == 200
    payload = response.json()
    assert payload["dry_run"] is True
    assert payload["success"] is True
    assert "--dry-run" in seen["command"]
    assert "--verify" not in seen["command"]


def test_legacy_conversion_links_converted_workspace_after_success(monkeypatch, tmp_path):
    workspace = tmp_path / "legacy"
    workspace.mkdir()
    (workspace / "store.duckdb").touch()
    output = tmp_path / "legacy-workspace-v2"
    completed: dict[str, object] = {}
    linked_paths: list[Path] = []

    from api.workspace import router_maintenance

    class InlineJobManager:
        def create_job(self, job_type, config, job_id=None):
            return SimpleNamespace(id=job_id or "maintenance_1", type=job_type, config=config, result=None)

        def submit_job(self, job, task_fn):
            job.result = task_fn(job, lambda _progress, _message="": True)
            return job

    def fake_converter(command: list[str]) -> dict:
        assert "--verify" in command
        return {"return_code": 0, "stdout": "ok", "stderr": "", "success": True}

    def fake_link(path: Path) -> dict[str, str | None]:
        linked_paths.append(path)
        return {
            "linked_workspace_id": "ws-converted",
            "active_workspace_path": str(path),
            "link_error": None,
        }

    monkeypatch.setattr(router_maintenance, "job_manager", InlineJobManager())
    monkeypatch.setattr(router_maintenance, "_has_active_non_maintenance_jobs", lambda: False)
    monkeypatch.setattr(router_maintenance, "_run_legacy_workspace_converter", fake_converter)
    monkeypatch.setattr(router_maintenance, "_link_converted_workspace", fake_link)
    monkeypatch.setattr(router_maintenance, "_emit_maintenance_started", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(router_maintenance, "_emit_maintenance_progress", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(router_maintenance, "_emit_maintenance_failed", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        router_maintenance,
        "_emit_maintenance_completed",
        lambda _job_id, _operation, payload: completed.update(payload),
    )

    with _client_with_workspace(monkeypatch, workspace) as client:
        response = client.post(
            "/api/workspace/legacy-convert",
            json={"output_path": str(output), "verify": True},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["job_id"] == "maintenance_1"
    assert payload["link_converted_workspace"] is True
    assert linked_paths == [output]
    assert completed["linked_workspace_id"] == "ws-converted"
    assert completed["active_workspace_path"] == str(output)
    assert completed["link_error"] is None


def test_legacy_conversion_refuses_v1_workspace(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "store.sqlite").touch()

    with _client_with_workspace(monkeypatch, workspace) as client:
        response = client.post("/api/workspace/legacy-convert", json={"dry_run": True})

    assert response.status_code == 409
    assert "does not require legacy conversion" in response.json()["detail"]
