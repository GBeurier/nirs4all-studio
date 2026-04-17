"""Tests for non-fatal update-check failures and logging."""

from __future__ import annotations

import asyncio
import logging

import httpx

from api import updates as updates_module
from api.network_state import OfflineError


def _make_manager(monkeypatch, tmp_path):
    monkeypatch.setattr(updates_module, "_user_data_dir", lambda *_args: str(tmp_path))
    manager = updates_module.UpdateManager()
    manager._settings = updates_module.UpdateSettings()
    manager._cache = {}
    return manager


def test_check_github_release_offline_does_not_log_error(monkeypatch, tmp_path, caplog):
    manager = _make_manager(monkeypatch, tmp_path)

    async def fake_fetch(url, headers=None):
        raise OfflineError(f"Skipping fetch (offline): {url}")

    monkeypatch.setattr(manager, "_fetch_url", fake_fetch)

    with caplog.at_level(logging.DEBUG, logger="api.updates"):
        info = asyncio.run(manager.check_github_release(force=True))

    assert info.latest_version is None
    assert not any(record.levelno >= logging.ERROR for record in caplog.records)
    assert any(
        "Skipping GitHub release check while offline" in record.getMessage()
        for record in caplog.records
    )


def test_check_pypi_release_offline_does_not_log_error(monkeypatch, tmp_path, caplog):
    manager = _make_manager(monkeypatch, tmp_path)

    async def fake_fetch(url, headers=None):
        raise OfflineError(f"Skipping fetch (offline): {url}")

    monkeypatch.setattr(manager, "_fetch_url", fake_fetch)

    with caplog.at_level(logging.DEBUG, logger="api.updates"):
        info = asyncio.run(manager.check_pypi_release(force=True))

    assert info.latest_version is None
    assert not any(record.levelno >= logging.ERROR for record in caplog.records)
    assert any(
        "Skipping PyPI release check while offline" in record.getMessage()
        for record in caplog.records
    )


def test_check_github_release_logs_blank_transport_errors_with_type(
    monkeypatch,
    tmp_path,
    caplog,
):
    manager = _make_manager(monkeypatch, tmp_path)

    class BlankHttpError(httpx.HTTPError):
        def __init__(self):
            super().__init__("")

        def __str__(self) -> str:
            return ""

    async def fake_fetch(url, headers=None):
        raise BlankHttpError()

    monkeypatch.setattr(manager, "_fetch_url", fake_fetch)

    with caplog.at_level(logging.WARNING, logger="api.updates"):
        asyncio.run(manager.check_github_release(force=True))

    assert not any(record.levelno >= logging.ERROR for record in caplog.records)
    assert any("BlankHttpError" in record.getMessage() for record in caplog.records)


def test_check_github_release_uses_stale_cache_after_failed_refresh(
    monkeypatch,
    tmp_path,
):
    manager = _make_manager(monkeypatch, tmp_path)
    manager._cache = {
        "github_release": {
            "cached_at": "2000-01-01T00:00:00",
            "latest_version": "9.9.9",
            "release_url": "https://example.com/release",
            "release_notes": "cached notes",
            "published_at": "2026-04-01T00:00:00Z",
            "download_url": "https://example.com/download",
            "asset_name": "nirs4all.zip",
            "download_size_bytes": 123,
            "checksum_sha256": "a" * 64,
            "is_prerelease": False,
        }
    }

    class TransportError(httpx.HTTPError):
        pass

    async def fake_fetch(url, headers=None):
        raise TransportError("offline")

    monkeypatch.setattr(manager, "_fetch_url", fake_fetch)

    info = asyncio.run(manager.check_github_release(force=True))

    assert info.latest_version == "9.9.9"
    assert info.release_url == "https://example.com/release"
    assert info.download_url == "https://example.com/download"
