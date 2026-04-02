"""Tests for update-version source selection."""


def test_get_webapp_version_prefers_electron_env_var(monkeypatch):
    from api.updates import UpdateManager

    monkeypatch.setenv("NIRS4ALL_APP_VERSION", "0.2.5")

    manager = UpdateManager()

    assert manager.get_webapp_version() == "0.2.5"
