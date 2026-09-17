"""Exercise actual ZIP files at the producer/updater boundary."""

import runpy
import zipfile
from pathlib import Path

import pytest

_HELPER = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts" / "create-windows-update-archive.py"))
create_archive = _HELPER["create_archive"]
verify_archive = _HELPER["verify_archive"]


def test_rejects_electron_builder_flat_zip(tmp_path):
    archive_path = tmp_path / "flat.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("nirs4all Studio.exe", b"executable")
        archive.writestr("resources/app.asar", b"app")
    with pytest.raises(ValueError, match="one application directory"):
        verify_archive(archive_path)


def test_failed_build_preserves_previous_archive_and_cleans_partial(tmp_path):
    app_path = tmp_path / "win-unpacked"
    app_path.mkdir()
    (app_path / "nirs4all Studio.exe").write_bytes(b"executable")
    archive_path = tmp_path / "release.zip"
    archive_path.write_bytes(b"previous qualified archive")
    with pytest.raises(ValueError, match="missing.*resources/app.asar"):
        create_archive(app_path, archive_path)
    assert archive_path.read_bytes() == b"previous qualified archive"
    assert not list(tmp_path.glob(".release.zip.*.tmp"))


def test_rejects_real_zip_payload_corruption(tmp_path):
    archive_path = tmp_path / "corrupt.zip"
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("nirs4all Studio/nirs4all Studio.exe", b"unique executable bytes")
        archive.writestr("nirs4all Studio/resources/app.asar", b"app")
    contents = archive_path.read_bytes()
    assert b"unique executable bytes" in contents
    archive_path.write_bytes(contents.replace(b"unique executable bytes", b"broken executable bytes"))
    with pytest.raises(ValueError, match="CRC failed"):
        verify_archive(archive_path)
