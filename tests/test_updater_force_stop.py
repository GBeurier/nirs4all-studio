"""Tests for updater script force-stop fallbacks."""

from pathlib import Path

import updater


def test_create_windows_updater_script_includes_force_stop_fallback(monkeypatch, tmp_path):
    staged_dir = tmp_path / "staging"
    staged_dir.mkdir()

    monkeypatch.setattr(updater.sys, "platform", "win32")
    monkeypatch.setenv("NIRS4ALL_PID_FILE", str(tmp_path / "backend.pid"))

    script_path, script_content = updater.create_updater_script(
        staged_dir,
        app_dir=Path(r"C:\Program Files\nirs4all Studio"),
    )

    assert script_path.name.endswith(".bat")
    assert 'set "BACKEND_PID_FILE=' in script_content
    assert "goto :force_stop" in script_content
    assert 'taskkill /pid %APP_PID% /f' in script_content
    assert 'set /p BACKEND_PID=<"%BACKEND_PID_FILE%"' in script_content
    assert 'taskkill /pid !BACKEND_PID! /f' in script_content


def test_windows_directory_updater_uses_robocopy_status_and_validates_rollback(monkeypatch, tmp_path):
    staged_dir = tmp_path / "staging"
    app_dir = tmp_path / "app"
    backup_dir = tmp_path / "backup"
    staged_dir.mkdir()
    app_dir.mkdir()

    monkeypatch.setattr(updater.sys, "platform", "win32")
    monkeypatch.setattr(updater, "get_backup_dir", lambda: backup_dir)
    monkeypatch.setenv("NIRS4ALL_APP_EXE", "nirs4all Studio.exe")
    monkeypatch.delenv("NIRS4ALL_PORTABLE_EXE", raising=False)
    monkeypatch.delenv("NIRS4ALL_PORTABLE_ROOT", raising=False)

    _, script_content = updater.create_updater_script(staged_dir, app_dir=app_dir)

    assert 'robocopy "%APP_DIR%" "%BACKUP_DIR%"' in script_content
    assert "/XJ" in script_content
    assert "if !BACKUP_EXIT! GEQ 8" in script_content
    assert 'if not exist "%BACKUP_DIR%\\%EXECUTABLE%"' in script_content
    assert "if !INSTALL_EXIT! GEQ 8" in script_content
    assert 'if not exist "%APP_DIR%\\%EXECUTABLE%"' in script_content
    assert "if !RESTORE_EXIT! GEQ 8" in script_content


def test_create_windows_updater_script_uses_staged_portable_executable(monkeypatch, tmp_path):
    staged_dir = tmp_path / "staging"
    app_dir = tmp_path / "app"
    staged_dir.mkdir()
    app_dir.mkdir()

    monkeypatch.setattr(updater.sys, "platform", "win32")
    monkeypatch.setenv("NIRS4ALL_PORTABLE_EXE", str(app_dir / "nirs4all Studio.exe"))

    script_path, script_content = updater.create_updater_script(
        staged_dir,
        app_dir=app_dir,
        staged_executable="nirs4all.Studio-0.7.0-win-x64-portable.exe",
    )

    assert script_path.name.endswith(".bat")
    assert 'set "EXECUTABLE=nirs4all Studio.exe"' in script_content
    assert 'set "STAGED_EXECUTABLE=nirs4all.Studio-0.7.0-win-x64-portable.exe"' in script_content
    assert 'copy /y "%STAGING_DIR%\\%STAGED_EXECUTABLE%" "%APP_DIR%\\%EXECUTABLE%"' in script_content


def test_create_unix_updater_script_includes_force_stop_fallback(monkeypatch, tmp_path):
    staged_dir = tmp_path / "staging"
    staged_dir.mkdir()

    monkeypatch.setattr(updater.sys, "platform", "linux")
    monkeypatch.setenv("NIRS4ALL_PID_FILE", str(tmp_path / "backend.pid"))

    script_path, script_content = updater.create_updater_script(
        staged_dir,
        app_dir=Path("/opt/nirs4all Studio"),
    )

    assert script_path.name.endswith(".sh")
    assert 'BACKEND_PID_FILE="' in script_content
    assert 'kill -9 "$APP_PID"' in script_content
    assert 'kill -9 "$BACKEND_PID"' in script_content
