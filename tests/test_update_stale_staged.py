"""Tests for the stale/downgrade staged-update guard (audit finding #5a).

A leftover or yanked staged payload must never be applied over a newer running
app. ``apply_webapp_update`` reads the staged version from the staged metadata
and the current version from the update manager, and refuses (HTTP 400) unless
the staged version is strictly newer — BEFORE the app is asked to quit.
"""

import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import api.updates as updates_module
import updater
from api.updates.app_updates import _guard_staged_version_is_newer
from api.updates.staging import STAGED_UPDATE_METADATA_FILE
from main import app

client = TestClient(app)


# ---- unit: the guard in isolation -----------------------------------------


def test_guard_refuses_older_staged_version():
    with pytest.raises(HTTPException) as exc:
        _guard_staged_version_is_newer("0.7.0", "0.8.0")
    assert exc.value.status_code == 400
    assert "not newer" in exc.value.detail


def test_guard_refuses_equal_staged_version():
    with pytest.raises(HTTPException) as exc:
        _guard_staged_version_is_newer("0.8.0", "0.8.0")
    assert exc.value.status_code == 400


def test_guard_allows_newer_staged_version():
    # Must not raise.
    _guard_staged_version_is_newer("0.8.1", "0.8.0")


def test_guard_defers_when_version_unknown():
    # No staged version recorded → cannot prove stale, defer to layout checks.
    _guard_staged_version_is_newer(None, "0.8.0")
    _guard_staged_version_is_newer("0.8.0", None)


# ---- integration: through the apply endpoint -------------------------------


def _stage_portable_windows(monkeypatch, tmp_path, staged_version: str):
    """Stage a valid portable-Windows update with the given recorded version."""
    staging_dir = tmp_path / "staging"
    staging_dir.mkdir()
    (staging_dir / "nirs4all Studio.exe").write_bytes(b"stub")
    (staging_dir / STAGED_UPDATE_METADATA_FILE).write_text(
        json.dumps({"version": staged_version}), encoding="utf-8"
    )

    # Portable runtime rooted in the writable tmp dir → passes the install-kind
    # and writability capability gate.
    monkeypatch.setenv("NIRS4ALL_PORTABLE_EXE", str(tmp_path / "nirs4all Studio.exe"))
    monkeypatch.setenv("NIRS4ALL_APP_EXE", "nirs4all Studio.exe")
    monkeypatch.delenv("APPIMAGE", raising=False)
    monkeypatch.setattr(updates_module.platform, "system", lambda: "Windows")
    monkeypatch.setattr(updater, "get_staging_dir", lambda: staging_dir)
    return staging_dir


def test_apply_refuses_stale_staged_before_launch(monkeypatch, tmp_path):
    """An older staged payload is refused and the updater is never launched."""
    _stage_portable_windows(monkeypatch, tmp_path, staged_version="0.7.0")
    monkeypatch.setenv("NIRS4ALL_APP_VERSION", "0.8.0")

    launched: dict[str, bool] = {"called": False}
    monkeypatch.setattr(updater, "launch_updater", lambda script_path: launched.__setitem__("called", True) or True)

    response = client.post("/api/updates/webapp/apply", json={"confirm": True})

    assert response.status_code == 400
    assert "not newer" in response.json()["detail"]
    assert launched["called"] is False  # never asked the app to quit


def test_apply_refuses_equal_staged_version(monkeypatch, tmp_path):
    """Re-applying the already-running version is refused (no-op downgrade)."""
    _stage_portable_windows(monkeypatch, tmp_path, staged_version="0.8.0")
    monkeypatch.setenv("NIRS4ALL_APP_VERSION", "0.8.0")
    monkeypatch.setattr(updater, "launch_updater", lambda script_path: True)

    response = client.post("/api/updates/webapp/apply", json={"confirm": True})

    assert response.status_code == 400


def test_apply_accepts_newer_staged_version(monkeypatch, tmp_path):
    """A strictly newer staged payload passes the guard and launches the updater."""
    staging_dir = _stage_portable_windows(monkeypatch, tmp_path, staged_version="0.9.0")
    monkeypatch.setenv("NIRS4ALL_APP_VERSION", "0.8.0")

    launched: dict[str, bool] = {"called": False}

    def _fake_create_updater_script(content_dir, staged_executable=None):
        return tmp_path / "updater.bat", "echo test"

    monkeypatch.setattr(updater, "create_updater_script", _fake_create_updater_script)
    monkeypatch.setattr(updater, "launch_updater", lambda script_path: launched.__setitem__("called", True) or True)

    response = client.post("/api/updates/webapp/apply", json={"confirm": True})

    assert response.status_code == 200
    assert response.json()["restart_required"] is True
    assert launched["called"] is True
    assert (staging_dir / "nirs4all Studio.exe").exists()
