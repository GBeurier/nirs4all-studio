"""Extraction-fidelity tests for the update downloader.

These lock the structural integrity of a staged update: symlinks must stay
symlinks (not become regular files), and executable bits must survive. This is
the regression guard for the macOS self-update bug where ``zipfile.extract``
flattened ``.app`` framework symlinks into text files and broke the relaunch.
"""

import asyncio
import os
import stat
import tarfile
import zipfile

import pytest

import api.update_downloader as update_downloader

pytestmark = pytest.mark.skipif(os.name == "nt", reason="POSIX symlinks are not exercised on Windows archives")


def _downloader(archive_path):
    return update_downloader.UpdateDownloader(
        download_url=f"https://example.invalid/{archive_path.name}",
        expected_size=archive_path.stat().st_size,
    )


def test_extract_zip_recreates_symlinks(monkeypatch, tmp_path):
    """A ZIP symlink entry must be extracted as a symlink pointing at its target,
    mirroring the framework symlinks inside a macOS .app bundle."""
    staging_dir = tmp_path / "staging"
    archive_path = tmp_path / "app-update.zip"

    real = zipfile.ZipInfo("App/Versions/A/Electron Framework")
    real.create_system = 3
    real.external_attr = 0o755 << 16

    link = zipfile.ZipInfo("App/Versions/Current")
    link.create_system = 3
    link.external_attr = (stat.S_IFLNK | 0o777) << 16

    top_link = zipfile.ZipInfo("App/Electron Framework")
    top_link.create_system = 3
    top_link.external_attr = (stat.S_IFLNK | 0o777) << 16

    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(real, "#!/bin/sh\nexit 0\n")
        archive.writestr(link, "A")  # relative symlink target
        archive.writestr(top_link, "Versions/Current/Electron Framework")

    monkeypatch.setattr(update_downloader, "get_staging_dir", lambda: staging_dir)

    success, _msg, content_dir = asyncio.run(_downloader(archive_path).extract(archive_path))

    assert success is True
    current = content_dir / "Versions" / "Current"
    top = content_dir / "Electron Framework"
    assert current.is_symlink(), "symlink entry was flattened into a regular file"
    assert os.readlink(current) == "A"
    assert top.is_symlink()
    assert os.readlink(top) == "Versions/Current/Electron Framework"
    # The symlink chain resolves to the real, still-executable file.
    resolved = top.resolve()
    assert resolved.is_file()
    assert resolved.stat().st_mode & 0o111 == 0o111


def test_extract_zip_preserves_executable_bit_for_regular_files(monkeypatch, tmp_path):
    """Regression guard: the symlink-aware path must not drop exec bits."""
    staging_dir = tmp_path / "staging"
    archive_path = tmp_path / "app-update.zip"

    exe = zipfile.ZipInfo("App/bin/tool")
    exe.create_system = 3
    exe.external_attr = 0o755 << 16

    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(exe, "#!/bin/sh\nexit 0\n")

    monkeypatch.setattr(update_downloader, "get_staging_dir", lambda: staging_dir)

    success, _msg, content_dir = asyncio.run(_downloader(archive_path).extract(archive_path))

    assert success is True
    tool = content_dir / "bin" / "tool"
    assert not tool.is_symlink()
    assert tool.stat().st_mode & 0o111 == 0o111


def test_extract_zip_refuses_symlink_with_escaping_target(monkeypatch, tmp_path):
    """Symlinks pointing outside the staging dir (absolute or via ``..``) must be
    refused entirely, not just kept from landing outside."""
    staging_dir = tmp_path / "staging"
    archive_path = tmp_path / "evil.zip"

    abs_link = zipfile.ZipInfo("App/abs")
    abs_link.create_system = 3
    abs_link.external_attr = (stat.S_IFLNK | 0o777) << 16

    rel_link = zipfile.ZipInfo("App/rel")
    rel_link.create_system = 3
    rel_link.external_attr = (stat.S_IFLNK | 0o777) << 16

    keep = zipfile.ZipInfo("App/keep")
    keep.create_system = 3
    keep.external_attr = 0o644 << 16

    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(abs_link, "/etc/passwd")
        archive.writestr(rel_link, "../../../../../../etc/passwd")
        archive.writestr(keep, "ok\n")

    monkeypatch.setattr(update_downloader, "get_staging_dir", lambda: staging_dir)

    success, _msg, content_dir = asyncio.run(_downloader(archive_path).extract(archive_path))

    assert success is True  # extraction succeeds; the unsafe links are dropped
    assert (content_dir / "keep").is_file()
    assert not (content_dir / "abs").exists() and not (content_dir / "abs").is_symlink()
    assert not (content_dir / "rel").exists() and not (content_dir / "rel").is_symlink()


def test_extract_zip_blocks_symlink_parent_zip_slip(monkeypatch, tmp_path):
    """The exact Zip-Slip vector: an escaping parent symlink followed by a
    regular child entry written *through* it must not escape staging."""
    staging_dir = tmp_path / "staging"
    outside = tmp_path / "outside"
    outside.mkdir()
    archive_path = tmp_path / "slip.zip"

    parent_link = zipfile.ZipInfo("App/out")
    parent_link.create_system = 3
    parent_link.external_attr = (stat.S_IFLNK | 0o777) << 16

    child = zipfile.ZipInfo("App/out/pwned")
    child.create_system = 3
    child.external_attr = 0o644 << 16

    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(parent_link, str(outside))  # absolute escaping target
        archive.writestr(child, "pwned\n")

    monkeypatch.setattr(update_downloader, "get_staging_dir", lambda: staging_dir)

    asyncio.run(_downloader(archive_path).extract(archive_path))

    assert not (outside / "pwned").exists(), "Zip-Slip: file written outside staging"


def test_extract_zip_blocks_relative_parent_symlink_slip(monkeypatch, tmp_path):
    """Same Zip-Slip vector but with a RELATIVE escaping parent symlink target —
    the lexical containment check must refuse it too (no realpath-chain escape)."""
    staging_dir = tmp_path / "staging"
    archive_path = tmp_path / "slip_rel.zip"

    parent_link = zipfile.ZipInfo("App/out")
    parent_link.create_system = 3
    parent_link.external_attr = (stat.S_IFLNK | 0o777) << 16

    child = zipfile.ZipInfo("App/out/pwned")
    child.create_system = 3
    child.external_attr = 0o644 << 16

    with zipfile.ZipFile(archive_path, "w") as archive:
        # From <tmp>/staging/App, "../../outside" normalizes to <tmp>/outside,
        # which is outside the staging dir.
        archive.writestr(parent_link, "../../outside")
        archive.writestr(child, "pwned\n")

    monkeypatch.setattr(update_downloader, "get_staging_dir", lambda: staging_dir)

    asyncio.run(_downloader(archive_path).extract(archive_path))

    assert not (tmp_path / "outside").exists(), "Zip-Slip via relative parent symlink escaped staging"


def test_extract_zip_allows_contained_climbing_symlink(monkeypatch, tmp_path):
    """A relative symlink that climbs but stays inside the staging tree (typical
    of bundle layouts) must be preserved, not over-refused."""
    staging_dir = tmp_path / "staging"
    archive_path = tmp_path / "app.zip"

    top = zipfile.ZipInfo("App/top")
    top.create_system = 3
    top.external_attr = 0o644 << 16

    deep = zipfile.ZipInfo("App/a/b/link")
    deep.create_system = 3
    deep.external_attr = (stat.S_IFLNK | 0o777) << 16

    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr(top, "top\n")
        archive.writestr(deep, "../../top")  # resolves to App/top, inside staging

    monkeypatch.setattr(update_downloader, "get_staging_dir", lambda: staging_dir)

    success, _msg, content_dir = asyncio.run(_downloader(archive_path).extract(archive_path))

    assert success is True
    link = content_dir / "a" / "b" / "link"
    assert link.is_symlink()
    assert link.resolve() == (content_dir / "top").resolve()


def test_extract_tarball_preserves_symlinks(monkeypatch, tmp_path):
    """The Linux tar.gz path (filter='data') must keep safe relative symlinks."""
    staging_dir = tmp_path / "staging"
    archive_path = tmp_path / "app-update.tar.gz"

    real_file = tmp_path / "src_tool"
    real_file.write_text("#!/bin/sh\nexit 0\n")
    real_file.chmod(0o755)

    with tarfile.open(archive_path, "w:gz") as tar:
        tar.add(real_file, arcname="App/bin/tool")
        link_info = tarfile.TarInfo("App/bin/current")
        link_info.type = tarfile.SYMTYPE
        link_info.linkname = "tool"
        tar.addfile(link_info)

    monkeypatch.setattr(update_downloader, "get_staging_dir", lambda: staging_dir)

    success, _msg, content_dir = asyncio.run(_downloader(archive_path).extract(archive_path))

    assert success is True
    current = content_dir / "bin" / "current"
    assert current.is_symlink()
    assert os.readlink(current) == "tool"
