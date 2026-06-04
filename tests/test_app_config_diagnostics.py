import json

from api.app_config import AppConfigManager


def test_installer_debug_consent_marker_is_promoted_to_app_settings(tmp_path, monkeypatch):
    monkeypatch.setenv("NIRS4ALL_CONFIG", str(tmp_path))
    marker = tmp_path / "installer_debug_data_sharing_consent"
    marker.write_text("true", encoding="utf-8")

    manager = AppConfigManager()
    settings = manager.get_app_settings()

    assert settings["ui_preferences"]["debug_data_sharing_enabled"] is True
    assert not marker.exists()

    persisted = json.loads((tmp_path / "app_settings.json").read_text(encoding="utf-8"))
    assert persisted["ui_preferences"]["debug_data_sharing_enabled"] is True
