"""Transition-release workspace conversion API tests."""

from __future__ import annotations

import os
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


def test_legacy_conversion_refuses_v1_workspace(monkeypatch, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "store.sqlite").touch()

    with _client_with_workspace(monkeypatch, workspace) as client:
        response = client.post("/api/workspace/legacy-convert", json={"dry_run": True})

    assert response.status_code == 409
    assert "does not require legacy conversion" in response.json()["detail"]
