"""End-to-end self-update test against a local fixture 'GitHub' server.

Exercises the whole desktop self-update chain in one go, with no network:
  check_github_release (force) -> download_and_stage_update -> create_updater_script
  -> run the REAL updater script -> assert the app tree is now N+1 and relaunched.

This is the test that reproduces the user-facing scenario ("update downloads,
then the app should come back on the new version") without a real GitHub
release or three physical OSes. The fixture server is reached via the
NIRS4ALL_UPDATE_API_BASE seam. Linux/macOS only (bash updater + posix tar).
"""

import asyncio
import hashlib
import http.server
import json
import platform
import subprocess
import sys
import tarfile
import threading
import time
from pathlib import Path

import pytest

import api.update_downloader as update_downloader  # noqa: F401  (ensures module import side effects)
import api.updates.manager as manager
import updater

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="bash updater + posix tar in this e2e")

NONEXISTENT_PID = 99_999_999
# Keep this at the user-reported boundary: semantic version comparison must
# correctly see 0.10.x as newer than 0.9.x (not compare the strings directly).
OLD_VERSION = "0.9.1"
NEW_VERSION = "0.10.1"

# Build a fixture asset name the selector accepts on the current platform
# (a .tar.gz with the right OS keyword + arch). tar.gz is accepted on both
# Linux and macOS by _find_platform_asset, so one extraction path covers both.
_OS_KEYWORD = {"linux": "linux", "darwin": "mac"}.get(platform.system().lower(), platform.system().lower())
_ARCH = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
ASSET_NAME = f"nirs4all-studio-{NEW_VERSION}-all-in-one-{_OS_KEYWORD}-{_ARCH}.tar.gz"


def test_github_api_base_honors_env(monkeypatch):
    monkeypatch.delenv("NIRS4ALL_UPDATE_API_BASE", raising=False)
    assert manager._github_api_base() == "https://api.github.com"
    monkeypatch.setenv("NIRS4ALL_UPDATE_API_BASE", "http://127.0.0.1:9/")
    assert manager._github_api_base() == "http://127.0.0.1:9"


def _build_asset_tarball(tmp: Path, marker: Path, exe_name: str) -> bytes:
    approot = tmp / "src" / "app-root"
    (approot / "resources").mkdir(parents=True)
    (approot / "resources" / "keep.txt").write_text("x", encoding="utf-8")
    stub = approot / exe_name
    stub.write_text(f"#!/bin/sh\necho NEW > '{marker}'\n", encoding="utf-8")
    stub.chmod(0o755)
    (approot / "version.json").write_text(json.dumps({"version": NEW_VERSION}), encoding="utf-8")
    tar_path = tmp / "asset.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tf:
        tf.add(approot, arcname="app-root")
    return tar_path.read_bytes()


def _make_handler(base_getter, asset_bytes: bytes, asset_sha: str):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_a):  # silence
            pass

        def _send(self, body: bytes, ctype: str = "application/octet-stream") -> None:
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            base = base_getter()
            if self.path.endswith("/releases/latest"):
                payload = {
                    "tag_name": NEW_VERSION,
                    "html_url": f"{base}/release",
                    "body": "release notes",
                    "published_at": "2026-06-15T00:00:00Z",
                    "prerelease": False,
                    "assets": [
                        {"name": ASSET_NAME, "browser_download_url": f"{base}/{ASSET_NAME}", "size": len(asset_bytes)},
                        {"name": f"{ASSET_NAME}.sha256", "browser_download_url": f"{base}/{ASSET_NAME}.sha256", "size": 80},
                    ],
                }
                self._send(json.dumps(payload).encode(), "application/json")
            elif self.path.endswith(".sha256"):
                self._send(f"{asset_sha}  {ASSET_NAME}\n".encode(), "text/plain")
            elif self.path.endswith(".tar.gz"):
                self._send(asset_bytes)
            else:
                self.send_response(404)
                self.end_headers()

    return Handler


def test_self_update_e2e_check_download_apply_relaunch(tmp_path, monkeypatch):
    exe_name = "nirs4all-studio-stub"
    marker = tmp_path / "relaunched.marker"
    asset_bytes = _build_asset_tarball(tmp_path, marker, exe_name)
    asset_sha = hashlib.sha256(asset_bytes).hexdigest()

    base_box = {"base": ""}
    handler = _make_handler(lambda: base_box["base"], asset_bytes, asset_sha)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    base_box["base"] = f"http://127.0.0.1:{srv.server_address[1]}"
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    try:
        # Isolate all on-disk state under tmp and force "online".
        appdata = tmp_path / "appdata"
        appdata.mkdir()
        state_dir = tmp_path / "state"
        state_dir.mkdir()
        monkeypatch.setattr(manager, "_resolve_user_data_dir", lambda *_a: str(appdata))
        monkeypatch.setattr(updater, "_get_update_state_dir", lambda: state_dir)

        async def _online() -> bool:
            return True

        monkeypatch.setattr(manager, "_is_online_cached", _online)
        monkeypatch.setenv("NIRS4ALL_UPDATE_API_BASE", base_box["base"])
        monkeypatch.setenv("NIRS4ALL_APP_VERSION", OLD_VERSION)
        monkeypatch.setenv("NIRS4ALL_APP_EXE", exe_name)
        monkeypatch.delenv("NIRS4ALL_ELECTRON", raising=False)
        monkeypatch.delenv("NIRS4ALL_PORTABLE_EXE", raising=False)
        monkeypatch.delenv("NIRS4ALL_PORTABLE_ROOT", raising=False)

        # 1. Check: the fixture release is seen as an available update.
        mgr = manager.UpdateManager()
        info = asyncio.run(mgr.check_github_release(force=True))
        assert info.update_available is True
        assert info.latest_version == NEW_VERSION
        assert info.asset_name == ASSET_NAME
        assert info.download_url == f"{base_box['base']}/{ASSET_NAME}"
        assert info.checksum_sha256 == asset_sha

        # 2. Download + verify checksum + extract to staging.
        from api.update_downloader import download_and_stage_update

        ok, msg, staging = asyncio.run(
            download_and_stage_update(info.download_url, info.download_size_bytes, info.checksum_sha256)
        )
        assert ok is True, msg
        assert staging is not None
        assert (staging / exe_name).exists()
        assert json.loads((staging / "version.json").read_text())["version"] == NEW_VERSION

        # 3. Apply via the REAL updater script, then verify relaunch.
        fake_app = tmp_path / "app"
        fake_app.mkdir()
        (fake_app / exe_name).write_text("#!/bin/sh\necho OLD\n", encoding="utf-8")
        (fake_app / exe_name).chmod(0o755)
        (tmp_path / "logs").mkdir()
        monkeypatch.setattr(updater, "get_backup_dir", lambda: tmp_path / "backup")
        monkeypatch.setattr(updater, "_get_update_log_dir", lambda: tmp_path / "logs")

        script_path, _content = updater.create_updater_script(staging, app_dir=fake_app, app_pid=NONEXISTENT_PID)
        subprocess.run(["bash", str(script_path)], check=True, timeout=60)

        assert (fake_app / exe_name).read_text().startswith("#!/bin/sh\necho NEW")
        assert json.loads((fake_app / "version.json").read_text())["version"] == NEW_VERSION

        deadline = time.time() + 10
        while time.time() < deadline and not marker.exists():
            time.sleep(0.1)
        assert marker.exists(), "the updated app was not relaunched"
    finally:
        srv.shutdown()
