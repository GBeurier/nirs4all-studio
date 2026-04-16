"""Tests for ZIP extraction behavior in the update downloader."""

import asyncio
import os
import zipfile

import pytest

import api.update_downloader as update_downloader


@pytest.mark.skipif(os.name == "nt", reason="POSIX permission bits are not meaningful on Windows")
def test_extract_zip_restores_executable_bits_from_archive(monkeypatch, tmp_path):
    staging_dir = tmp_path / "staging"
    archive_path = tmp_path / "app-update.zip"

    script_info = zipfile.ZipInfo("nirs4all Studio/resources/backend/python-runtime/python/bin/python3")
    script_info.create_system = 3
    script_info.external_attr = (0o755 << 16)

    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(script_info, "#!/bin/sh\nexit 0\n")

    monkeypatch.setattr(update_downloader, "get_staging_dir", lambda: staging_dir)

    downloader = update_downloader.UpdateDownloader(
        download_url="https://example.invalid/app-update.zip",
        expected_size=archive_path.stat().st_size,
    )

    success, _message, content_dir = asyncio.run(downloader.extract(archive_path))

    restored = content_dir / "resources" / "backend" / "python-runtime" / "python" / "bin" / "python3"

    assert success is True
    assert restored.exists()
    assert restored.stat().st_mode & 0o111 == 0o111


def test_extract_zip_resolves_nested_app_root_with_companion_top_level_files(monkeypatch, tmp_path):
    staging_dir = tmp_path / "staging"
    archive_path = tmp_path / "app-update.zip"

    monkeypatch.setenv("NIRS4ALL_APP_EXE", "nirs4all Studio")

    executable_info = zipfile.ZipInfo("nirs4all Studio/nirs4all Studio")
    executable_info.create_system = 3
    executable_info.external_attr = (0o755 << 16)

    runtime_info = zipfile.ZipInfo("nirs4all Studio/resources/backend/python-runtime/RUNTIME_READY.json")
    runtime_info.create_system = 3
    runtime_info.external_attr = (0o644 << 16)

    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(executable_info, "#!/bin/sh\nexit 0\n")
        archive.writestr(runtime_info, "{}\n")
        archive.writestr("LICENSE.electron.txt", "license\n")

    monkeypatch.setattr(update_downloader, "get_staging_dir", lambda: staging_dir)

    downloader = update_downloader.UpdateDownloader(
        download_url="https://example.invalid/app-update.zip",
        expected_size=archive_path.stat().st_size,
    )

    success, _message, content_dir = asyncio.run(downloader.extract(archive_path))

    assert success is True
    assert content_dir == staging_dir / "nirs4all Studio"
    assert (content_dir / "nirs4all Studio").exists()
    assert (content_dir / "resources" / "backend" / "python-runtime" / "RUNTIME_READY.json").exists()


def test_extract_zip_resolves_wrapped_nested_app_root(monkeypatch, tmp_path):
    staging_dir = tmp_path / "staging"
    archive_path = tmp_path / "app-update.zip"

    monkeypatch.setenv("NIRS4ALL_APP_EXE", "nirs4all Studio")

    executable_info = zipfile.ZipInfo("wrapper/nirs4all Studio/nirs4all Studio")
    executable_info.create_system = 3
    executable_info.external_attr = (0o755 << 16)

    runtime_info = zipfile.ZipInfo("wrapper/nirs4all Studio/resources/backend/python-runtime/RUNTIME_READY.json")
    runtime_info.create_system = 3
    runtime_info.external_attr = (0o644 << 16)

    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(executable_info, "#!/bin/sh\nexit 0\n")
        archive.writestr(runtime_info, "{}\n")
        archive.writestr("wrapper/LICENSE.electron.txt", "license\n")

    monkeypatch.setattr(update_downloader, "get_staging_dir", lambda: staging_dir)

    downloader = update_downloader.UpdateDownloader(
        download_url="https://example.invalid/app-update.zip",
        expected_size=archive_path.stat().st_size,
    )

    success, _message, content_dir = asyncio.run(downloader.extract(archive_path))

    assert success is True
    assert content_dir == staging_dir / "wrapper" / "nirs4all Studio"
    assert (content_dir / "nirs4all Studio").exists()
    assert (content_dir / "resources" / "backend" / "python-runtime" / "RUNTIME_READY.json").exists()
