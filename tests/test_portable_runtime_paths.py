from pathlib import Path


def test_app_config_uses_portable_root(monkeypatch, tmp_path):
    portable_root = tmp_path / ".nirs4all"
    monkeypatch.delenv("NIRS4ALL_CONFIG", raising=False)
    monkeypatch.setenv("NIRS4ALL_PORTABLE_ROOT", str(portable_root))

    from api.app_config import AppConfigManager

    manager = AppConfigManager()

    assert manager.config_dir == portable_root / "config"


def test_updater_uses_portable_backend_dirs(monkeypatch, tmp_path):
    portable_root = tmp_path / ".nirs4all"
    monkeypatch.setenv("NIRS4ALL_PORTABLE_ROOT", str(portable_root))

    from updater import get_backup_dir, get_staging_dir, get_update_cache_dir

    cache_dir = get_update_cache_dir()
    staging_dir = get_staging_dir()
    backup_dir = get_backup_dir()

    expected_root = portable_root / "backend-data" / "nirs4all-webapp"
    assert cache_dir == expected_root / "update_cache"
    assert staging_dir == expected_root / "update_staging"
    assert backup_dir == expected_root / "update_backup"


def test_venv_manager_user_data_dir_uses_portable_root(monkeypatch, tmp_path):
    portable_root = tmp_path / ".nirs4all"
    monkeypatch.setenv("NIRS4ALL_PORTABLE_ROOT", str(portable_root))

    from api.venv_manager import _user_data_dir

    assert Path(_user_data_dir("nirs4all-webapp")) == portable_root / "backend-data" / "nirs4all-webapp"
