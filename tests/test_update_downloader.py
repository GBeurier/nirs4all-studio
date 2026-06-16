"""Tests for ZIP extraction behavior in the update downloader."""

import asyncio
import os
import zipfile

import pytest

import api.update_downloader as update_downloader


class _FakeResponse:
    """Minimal stand-in for ``urllib.request.urlopen``'s return value."""

    def __init__(self, body: bytes, status: int = 200):
        self._body = body
        self._offset = 0
        self.status = status
        self.headers = {"Content-Length": str(len(body))}

    def read(self, size: int = -1) -> bytes:
        if size is None or size < 0:
            chunk = self._body[self._offset:]
            self._offset = len(self._body)
            return chunk
        chunk = self._body[self._offset:self._offset + size]
        self._offset += len(chunk)
        return chunk


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


# ---- download cache hardening (audit LOW) ----------------------------------


def test_download_accepts_cached_file_of_exact_expected_size(monkeypatch, tmp_path):
    """A cached file whose size EXACTLY matches expected is treated as complete
    without re-downloading."""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    cached = cache_dir / "app-update.zip"
    cached.write_bytes(b"PAYLOAD")

    monkeypatch.setattr(update_downloader, "get_update_cache_dir", lambda: cache_dir)

    def _boom(*_args, **_kwargs):
        raise AssertionError("network must not be touched for an exact-size cache")

    monkeypatch.setattr(update_downloader.urllib.request, "urlopen", _boom)

    downloader = update_downloader.UpdateDownloader(
        download_url="https://example.invalid/app-update.zip",
        expected_size=len(b"PAYLOAD"),
    )

    success, message, path = asyncio.run(downloader.download())

    assert success is True
    assert "complete" in message.lower()
    assert path == cached
    assert cached.read_bytes() == b"PAYLOAD"


def test_download_discards_oversized_cached_file_and_redownloads(monkeypatch, tmp_path):
    """A cached file LARGER than expected is corrupt/wrong (e.g. captive-portal
    HTML appended past the end). It must be discarded and re-downloaded, not
    accepted or resumed from a poisoned tail."""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    cached = cache_dir / "app-update.zip"
    cached.write_bytes(b"OVERSIZED-GARBAGE-BODY")  # bigger than expected

    fresh_body = b"GOOD"
    monkeypatch.setattr(update_downloader, "get_update_cache_dir", lambda: cache_dir)

    captured: dict[str, object] = {}

    def _fake_urlopen(req, *_args, **_kwargs):
        captured["range"] = req.get_header("Range")
        return _FakeResponse(fresh_body, status=200)

    monkeypatch.setattr(update_downloader.urllib.request, "urlopen", _fake_urlopen)

    downloader = update_downloader.UpdateDownloader(
        download_url="https://example.invalid/app-update.zip",
        expected_size=len(fresh_body),
    )

    success, _message, path = asyncio.run(downloader.download())

    assert success is True
    assert path == cached
    # Restarted from scratch (no Range header) and rewrote the file fully.
    assert captured["range"] is None
    assert cached.read_bytes() == fresh_body


def test_download_resumes_smaller_cached_file(monkeypatch, tmp_path):
    """A cached file SMALLER than expected still resumes via a Range request —
    the hardening must not break legitimate resume."""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    cached = cache_dir / "app-update.zip"
    cached.write_bytes(b"GO")  # partial

    remainder = b"OD"
    monkeypatch.setattr(update_downloader, "get_update_cache_dir", lambda: cache_dir)

    captured: dict[str, object] = {}

    def _fake_urlopen(req, *_args, **_kwargs):
        captured["range"] = req.get_header("Range")
        return _FakeResponse(remainder, status=206)

    monkeypatch.setattr(update_downloader.urllib.request, "urlopen", _fake_urlopen)

    downloader = update_downloader.UpdateDownloader(
        download_url="https://example.invalid/app-update.zip",
        expected_size=len(b"GOOD"),
    )

    success, _message, path = asyncio.run(downloader.download())

    assert success is True
    assert path == cached
    assert captured["range"] == "bytes=2-"  # resumed from the partial offset
    assert cached.read_bytes() == b"GOOD"


def test_download_fails_when_completed_file_size_mismatches_expected(monkeypatch, tmp_path):
    """A transfer that ends short of the announced asset size (dropped
    connection, captive-portal HTML) must be reported as a failure, not silently
    accepted only to fail later during extraction/apply."""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()

    truncated = b"NOT-THE-WHOLE-FILE"
    monkeypatch.setattr(update_downloader, "get_update_cache_dir", lambda: cache_dir)
    monkeypatch.setattr(
        update_downloader.urllib.request,
        "urlopen",
        lambda *_a, **_k: _FakeResponse(truncated, status=200),
    )

    downloader = update_downloader.UpdateDownloader(
        download_url="https://example.invalid/app-update.zip",
        expected_size=len(truncated) + 100,  # server delivered fewer bytes than the asset
    )

    success, message, path = asyncio.run(downloader.download())

    assert success is False
    assert "size mismatch" in message.lower()
    assert path is None


def test_download_416_rejects_local_file_of_wrong_size(monkeypatch, tmp_path):
    """A 416 (range not satisfiable) only means 'complete' when the local file
    actually matches the expected size — a short/corrupt local file must fail
    rather than be reported complete."""
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    cached = cache_dir / "app-update.zip"
    cached.write_bytes(b"GO")  # smaller than expected -> triggers a resume Range request

    monkeypatch.setattr(update_downloader, "get_update_cache_dir", lambda: cache_dir)

    def _fake_urlopen(_req, *_a, **_k):
        raise update_downloader.urllib.error.HTTPError(
            "https://example.invalid/app-update.zip", 416, "Range Not Satisfiable", None, None
        )

    monkeypatch.setattr(update_downloader.urllib.request, "urlopen", _fake_urlopen)

    downloader = update_downloader.UpdateDownloader(
        download_url="https://example.invalid/app-update.zip",
        expected_size=4,  # cached file is only 2 bytes
    )

    success, message, path = asyncio.run(downloader.download())

    assert success is False
    assert "expected size" in message.lower()
    assert path is None
