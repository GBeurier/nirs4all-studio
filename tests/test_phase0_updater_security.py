"""Phase 0 security hardening tests for the updater + pip install backend.

Covers:
- verify_checksum fails closed when no checksum is present (or blank).
- Zip-Slip members are rejected by the extraction guard.
- pip package-spec validation accepts legitimate, allowlisted requirements and
  rejects URLs/VCS specs, option flags, shell injection, paths, and
  non-allowlisted distribution names.
- install_package refuses a rejected spec without ever spawning pip.
"""

import os
import tempfile
from pathlib import Path

import pytest

from api.update_downloader import UpdateDownloader, _is_safe_zip_member
from api.venv_manager import (
    ALLOWED_PACKAGES,
    VenvManager,
    validate_package_spec,
)
import api.venv_manager as venv_manager_module


# ============= verify_checksum: fail closed =============


def test_verify_checksum_fails_when_checksum_absent(tmp_path):
    target = tmp_path / "update.tar.gz"
    target.write_bytes(b"payload")

    downloader = UpdateDownloader(
        download_url="https://example.invalid/update.tar.gz",
        expected_size=len(b"payload"),
        expected_checksum=None,
    )

    success, message = downloader.verify_checksum(target)

    assert success is False
    assert "checksum" in message.lower()


def test_verify_checksum_fails_when_checksum_blank(tmp_path):
    target = tmp_path / "update.tar.gz"
    target.write_bytes(b"payload")

    downloader = UpdateDownloader(
        download_url="https://example.invalid/update.tar.gz",
        expected_size=len(b"payload"),
        expected_checksum="   ",
    )

    success, _ = downloader.verify_checksum(target)

    assert success is False


def test_verify_checksum_accepts_matching_checksum(tmp_path):
    import hashlib

    payload = b"payload"
    target = tmp_path / "update.tar.gz"
    target.write_bytes(payload)
    digest = hashlib.sha256(payload).hexdigest()

    downloader = UpdateDownloader(
        download_url="https://example.invalid/update.tar.gz",
        expected_size=len(payload),
        expected_checksum=digest,
    )

    success, _ = downloader.verify_checksum(target)

    assert success is True


# ============= Zip-Slip extraction guard =============


def test_zip_slip_member_is_rejected():
    with tempfile.TemporaryDirectory() as d:
        root = Path(os.path.realpath(d))

        # Legitimate members extract inside the destination.
        assert _is_safe_zip_member("nirs4all-studio/version.json", root) is True

        # Path traversal escapes the destination -> rejected.
        assert _is_safe_zip_member("../../etc/passwd", root) is False
        # Absolute POSIX path -> rejected.
        assert _is_safe_zip_member("/etc/passwd", root) is False
        # Windows-style absolute / drive paths -> rejected.
        assert _is_safe_zip_member("\\Windows\\system32", root) is False
        assert _is_safe_zip_member("C:/Windows/system32", root) is False
        # Empty member -> rejected.
        assert _is_safe_zip_member("", root) is False


def test_extract_zip_raises_on_zip_slip(tmp_path):
    import asyncio
    import zipfile

    archive = tmp_path / "evil.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr("../../escape.txt", "owned")

    target = tmp_path / "staging"
    target.mkdir()

    downloader = UpdateDownloader(
        download_url="https://example.invalid/evil.zip",
        expected_size=0,
    )

    with pytest.raises(ValueError, match="Unsafe path"):
        asyncio.run(downloader._extract_zip(archive, target))

    # Nothing escaped the staging directory.
    assert not (tmp_path / "escape.txt").exists()


# ============= pip spec validation =============


@pytest.mark.parametrize(
    "package, version, extras",
    [
        ("nirs4all==0.9.0", None, None),
        ("nirs4all", "0.9.0", None),
        ("torch>=2.0", None, None),
        ("nirs4all", None, ["tensorflow", "torch"]),
        ("tensorflow-cpu==2.14.0", None, None),
    ],
)
def test_validate_package_spec_accepts_legitimate_requirements(package, version, extras):
    is_valid, message = validate_package_spec(package, version, extras)
    assert is_valid is True, message


@pytest.mark.parametrize(
    "package",
    [
        "git+https://evil",
        "--upgrade",
        "foo; rm -rf /",
        "/etc/passwd",
        "definitely-not-allowed-xyz",  # well-formed but not allowlisted
        "https://example.com/wheel.whl",
        "torch>=2.0 --index-url http://evil",  # whitespace-smuggled args
    ],
)
def test_validate_package_spec_rejects_dangerous_inputs(package):
    is_valid, _ = validate_package_spec(package, None, None)
    assert is_valid is False


def test_non_allowlisted_name_is_rejected_even_if_well_formed():
    is_valid, message = validate_package_spec("requests==2.0.0", None, None)
    assert is_valid is False
    assert "allowlist" in message.lower()


def test_allowlist_contains_core_distributions():
    # Guards against accidental regressions that would break legitimate installs.
    for name in ("nirs4all", "torch", "tensorflow", "tensorflow-cpu", "jax", "jaxlib"):
        assert name in ALLOWED_PACKAGES


def test_install_package_rejects_bad_spec_without_spawning_pip(monkeypatch):
    def _explode(*args, **kwargs):
        raise AssertionError("pip must not be invoked for a rejected spec")

    manager = VenvManager()
    monkeypatch.setattr(manager, "_is_valid_venv", lambda: True)
    monkeypatch.setattr(venv_manager_module.subprocess, "Popen", _explode)

    success, message, output = manager.install_package("git+https://evil")

    assert success is False
    assert output == []
    assert "rejected" in message.lower()


def test_install_package_allows_allowlisted_spec(monkeypatch):
    calls = []

    class _FakeProcess:
        def __init__(self, cmd, **kwargs):
            calls.append(cmd)
            self.returncode = 0

        def communicate(self, timeout=None):
            return "Successfully installed nirs4all-0.9.0\n", None

    manager = VenvManager()
    monkeypatch.setattr(manager, "_is_valid_venv", lambda: True)
    monkeypatch.setattr(manager, "_get_target_python_version", lambda: (3, 12))
    monkeypatch.setattr(manager, "_load_metadata", lambda: {})
    monkeypatch.setattr(manager, "_save_metadata", lambda metadata: None)
    monkeypatch.setattr(venv_manager_module.subprocess, "Popen", _FakeProcess)

    success, _, _ = manager.install_package("nirs4all", version="0.9.0")

    assert success is True
    assert calls[0][-1] == "nirs4all==0.9.0"
