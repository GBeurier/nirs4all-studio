"""Compatibility coverage for native update-settings persistence during R2."""

from pathlib import Path


def test_update_manager_refreshes_atomically_replaced_native_settings(tmp_path: Path) -> None:
    """A native sidecar write updates legacy update checks without a restart."""
    from api.updates import UpdateManager

    manager = UpdateManager()
    manager._settings_path = tmp_path / "update_settings.yaml"
    manager._cache_path = tmp_path / "update_cache.json"

    assert manager.settings.prerelease_channel is False
    cache = manager._ensure_cache_loaded()
    cache["github_release"] = {"cached_at": "2026-01-01T00:00:00"}

    replacement = tmp_path / ".update_settings.native.tmp"
    replacement.write_text(
        "prerelease_channel: true\ncheck_interval_hours: 12\n",
        encoding="utf-8",
    )
    replacement.replace(manager._settings_path)

    settings = manager.settings

    assert settings.prerelease_channel is True
    assert settings.check_interval_hours == 12
    assert "github_release" not in cache
