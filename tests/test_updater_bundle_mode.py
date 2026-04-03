"""Tests for updater path resolution and macOS bundle mode."""

from pathlib import Path

import updater


def test_get_app_directory_resolves_macos_bundle_root(monkeypatch):
    monkeypatch.delenv("NIRS4ALL_PORTABLE_EXE", raising=False)
    monkeypatch.setenv(
        "NIRS4ALL_APP_DIR",
        "/Applications/nirs4all Studio.app/Contents/MacOS",
    )

    bundle_root = updater.get_app_directory()
    assert bundle_root.name == "nirs4all Studio.app"
    assert bundle_root.parent.name == "Applications"


def test_create_updater_script_uses_bundle_mode_for_macos_apps(monkeypatch, tmp_path):
    staged_bundle = tmp_path / "nirs4all Studio.app"
    staged_bundle.mkdir()

    monkeypatch.setattr(updater.sys, "platform", "darwin")
    script_path, script_content = updater.create_updater_script(
        staged_bundle,
        app_dir=Path("/Applications/nirs4all Studio.app"),
    )

    assert script_path.name.endswith(".sh")
    assert 'UPDATE_MODE="bundle"' in script_content
    assert 'open -n "$APP_DIR"' in script_content
