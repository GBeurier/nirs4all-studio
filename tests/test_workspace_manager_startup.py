"""Tests for first-launch workspace bootstrap behavior."""

from __future__ import annotations

import copy
import importlib
from pathlib import Path

lazy_imports = importlib.import_module("api.lazy_imports")
workspace_manager_module = importlib.import_module("api.workspace_manager")


class _DummyAppConfig:
    def __init__(self, config_dir: Path):
        self.config_dir = config_dir
        self._settings = {"linked_workspaces": []}

    def get_app_settings(self) -> dict:
        return copy.deepcopy(self._settings)

    def save_app_settings(self, settings: dict) -> bool:
        self._settings = copy.deepcopy(settings)
        return True


def test_desktop_default_workspace_uses_documents_dir(monkeypatch, tmp_path):
    home_dir = tmp_path / "home"
    config_dir = tmp_path / "config"

    monkeypatch.setenv("HOME", str(home_dir))
    monkeypatch.setenv("USERPROFILE", str(home_dir))
    monkeypatch.setenv("NIRS4ALL_DESKTOP", "true")
    monkeypatch.delenv("NIRS4ALL_PORTABLE_ROOT", raising=False)
    monkeypatch.setattr(
        workspace_manager_module,
        "app_config",
        _DummyAppConfig(config_dir),
    )
    monkeypatch.setattr(lazy_imports, "get_cached", lambda *args, **kwargs: None)

    manager = workspace_manager_module.WorkspaceManager()
    active = manager.get_active_workspace()

    expected = home_dir / "Documents" / "nirs4all Studio" / "workspace"
    assert active is not None
    assert Path(active.path) == expected.resolve()
    assert expected.exists()
    assert (expected / "workspace.json").exists()


def test_portable_default_workspace_uses_portable_root(monkeypatch, tmp_path):
    portable_root = tmp_path / ".nirs4all"
    config_dir = tmp_path / "config"

    monkeypatch.delenv("NIRS4ALL_DESKTOP", raising=False)
    monkeypatch.setenv("NIRS4ALL_PORTABLE_ROOT", str(portable_root))
    monkeypatch.setattr(
        workspace_manager_module,
        "app_config",
        _DummyAppConfig(config_dir),
    )
    monkeypatch.setattr(lazy_imports, "get_cached", lambda *args, **kwargs: None)

    manager = workspace_manager_module.WorkspaceManager()
    active = manager.get_active_workspace()

    expected = portable_root / "workspace"
    assert active is not None
    assert Path(active.path) == expected.resolve()
    assert expected.exists()
    assert (expected / "workspace.json").exists()
