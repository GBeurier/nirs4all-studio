"""Tests for platform-specific release asset selection."""

import platform

from api.updates import UpdateManager


def _asset(name: str) -> dict[str, str]:
    return {"name": name, "browser_download_url": f"https://example.com/{name}"}


def test_windows_installed_prefers_zip_asset(monkeypatch):
    monkeypatch.delenv("NIRS4ALL_PORTABLE_EXE", raising=False)
    monkeypatch.delenv("NIRS4ALL_PORTABLE_ROOT", raising=False)
    monkeypatch.setattr(platform, "system", lambda: "Windows")
    monkeypatch.setattr(platform, "machine", lambda: "AMD64")

    manager = UpdateManager()
    asset = manager._find_platform_asset(
        [
            _asset("nirs4all Studio-0.3.1-win-x64.exe"),
            _asset("nirs4all Studio-0.3.1-win-x64-portable.exe"),
            _asset("nirs4all Studio-0.3.1-win-x64.zip"),
        ]
    )

    assert asset is not None
    assert asset["name"].endswith(".zip")


def test_windows_portable_prefers_portable_executable(monkeypatch):
    monkeypatch.setenv("NIRS4ALL_PORTABLE_EXE", r"C:\portable\nirs4all Studio.exe")
    monkeypatch.setattr(platform, "system", lambda: "Windows")
    monkeypatch.setattr(platform, "machine", lambda: "AMD64")

    manager = UpdateManager()
    asset = manager._find_platform_asset(
        [
            _asset("nirs4all Studio-0.3.1-win-x64.exe"),
            _asset("nirs4all Studio-0.3.1-win-x64.zip"),
            _asset("nirs4all Studio-0.3.1-win-x64-portable.exe"),
        ]
    )

    assert asset is not None
    assert asset["name"].endswith("-portable.exe")


def test_windows_installed_rejects_installer_only_assets(monkeypatch):
    monkeypatch.delenv("NIRS4ALL_PORTABLE_EXE", raising=False)
    monkeypatch.delenv("NIRS4ALL_PORTABLE_ROOT", raising=False)
    monkeypatch.setattr(platform, "system", lambda: "Windows")
    monkeypatch.setattr(platform, "machine", lambda: "AMD64")

    manager = UpdateManager()
    asset = manager._find_platform_asset(
        [
            _asset("nirs4all Studio-0.3.1-win-x64.exe"),
            _asset("nirs4all Studio-0.3.1-win-x64-portable.exe"),
        ]
    )

    assert asset is None
