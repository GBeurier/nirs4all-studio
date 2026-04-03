"""Tests for staged update layout validation before apply."""

from pathlib import Path

from fastapi.testclient import TestClient

import api.updates as updates_module
import updater
from main import app

client = TestClient(app)


def test_apply_update_rejects_installer_like_stage_for_installed_windows(monkeypatch, tmp_path):
    staging_dir = tmp_path / "staging"
    staging_dir.mkdir()
    (staging_dir / "nirs4all Studio.exe").write_bytes(b"stub")

    monkeypatch.delenv("NIRS4ALL_PORTABLE_EXE", raising=False)
    monkeypatch.delenv("NIRS4ALL_PORTABLE_ROOT", raising=False)
    monkeypatch.setenv("NIRS4ALL_APP_EXE", "nirs4all Studio.exe")
    monkeypatch.setattr(updates_module.platform, "system", lambda: "Windows")
    monkeypatch.setattr(updater, "get_staging_dir", lambda: staging_dir)

    response = client.post("/api/updates/webapp/apply", json={"confirm": True})

    assert response.status_code == 400
    assert "installed desktop app layout" in response.json()["detail"]


def test_apply_update_accepts_portable_stage_for_portable_windows(monkeypatch, tmp_path):
    staging_dir = tmp_path / "staging"
    staging_dir.mkdir()
    (staging_dir / "nirs4all Studio.exe").write_bytes(b"stub")

    called: dict[str, Path] = {}

    def _fake_create_updater_script(content_dir: Path):
        called["content_dir"] = content_dir
        return tmp_path / "updater.bat", "echo test"

    monkeypatch.setenv("NIRS4ALL_PORTABLE_EXE", str(tmp_path / "nirs4all Studio.exe"))
    monkeypatch.setenv("NIRS4ALL_APP_EXE", "nirs4all Studio.exe")
    monkeypatch.setattr(updates_module.platform, "system", lambda: "Windows")
    monkeypatch.setattr(updater, "get_staging_dir", lambda: staging_dir)
    monkeypatch.setattr(updater, "create_updater_script", _fake_create_updater_script)
    monkeypatch.setattr(updater, "launch_updater", lambda script_path: True)

    response = client.post("/api/updates/webapp/apply", json={"confirm": True})

    assert response.status_code == 200
    assert called["content_dir"] == staging_dir
