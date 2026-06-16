"""
Update download and extraction module.

Provides functionality to:
- Download update archives with progress tracking
- Verify checksums
- Extract tar.gz (Linux/macOS) or zip (Windows) archives
- Stage updates for the apply step

Uses only stdlib (urllib) for HTTP — no third-party dependencies — so that
the update path works in any deployment mode (PyInstaller, Electron, dev).
"""

import asyncio
import os
import shutil
import ssl
import stat
import subprocess
import sys
import tarfile
import urllib.error
import urllib.request
import zipfile
from collections.abc import Callable
from pathlib import Path

from api.shared.logger import get_logger
from updater import calculate_sha256, get_executable_name, get_staging_dir, get_update_cache_dir

logger = get_logger("api.update_downloader")


class UpdateDownloader:
    """Handles downloading and extracting webapp updates."""

    CHUNK_SIZE = 65536  # 64 KB chunks for progress updates
    CONNECT_TIMEOUT = 30  # seconds

    def __init__(
        self,
        download_url: str,
        expected_size: int,
        expected_checksum: str | None = None,
        progress_callback: Callable[[float, str], bool] | None = None,
    ):
        """
        Initialize the update downloader.

        Args:
            download_url: URL to download the update archive from
            expected_size: Expected file size in bytes
            expected_checksum: Expected SHA256 checksum (optional)
            progress_callback: Callback for progress updates (progress%, message) -> continue?
                               Return False to cancel the operation.
        """
        self.download_url = download_url
        self.expected_size = expected_size
        self.expected_checksum = expected_checksum
        self.progress_callback = progress_callback
        self._cancelled = False

    def cancel(self) -> None:
        """Cancel the download."""
        self._cancelled = True

    def _report_progress(self, progress: float, message: str) -> bool:
        """
        Report progress and check for cancellation.

        Returns:
            True to continue, False to cancel
        """
        if self._cancelled:
            return False
        if self.progress_callback:
            return self.progress_callback(progress, message)
        return True

    async def download(self) -> tuple[bool, str, Path | None]:
        """
        Download the update archive with resume support.

        If a partial file exists from a previous attempt, the download resumes
        from where it left off using an HTTP Range header. On cancellation or
        network failure the partial file is kept so the next attempt can resume.

        Returns:
            Tuple of (success, message, downloaded_file_path)
        """
        cache_dir = get_update_cache_dir()
        filename = self.download_url.split("/")[-1]
        download_path = cache_dir / filename

        # Check for partial download to resume
        resume_offset = 0
        if download_path.exists():
            resume_offset = download_path.stat().st_size
            if self.expected_size:
                # Accept a cached file only when its size EXACTLY matches the
                # expected size — checksum verification still runs downstream.
                # A file larger than expected is corrupt/wrong (e.g. a
                # captive-portal HTML body or a stale mismatched asset appended
                # past the end), so discard it and restart rather than resume
                # from a poisoned tail or accept it outright.
                if resume_offset == self.expected_size:
                    self._report_progress(50, "Download already complete")
                    return True, "Download complete", download_path
                if resume_offset > self.expected_size:
                    download_path.unlink(missing_ok=True)
                    resume_offset = 0

        try:
            if resume_offset > 0:
                self._report_progress(0, f"Resuming download from {resume_offset / 1024 / 1024:.1f} MB...")
            else:
                self._report_progress(0, "Connecting to server...")

            # Build request with optional Range header for resume
            req = urllib.request.Request(self.download_url)
            if resume_offset > 0:
                req.add_header("Range", f"bytes={resume_offset}-")

            # Allow default SSL context (handles GitHub redirects)
            ctx = ssl.create_default_context()
            response = urllib.request.urlopen(req, timeout=self.CONNECT_TIMEOUT, context=ctx)
            status_code = response.status

            # 206 = Partial Content (resume worked), 200 = full response
            if status_code == 200:
                # Server doesn't support Range — restart from scratch
                resume_offset = 0
            elif status_code not in (200, 206):
                return (
                    False,
                    f"Download failed with status {status_code}",
                    None,
                )

            content_length = int(response.headers.get("Content-Length", 0))
            total_size = resume_offset + content_length if status_code == 206 else content_length
            if total_size == 0:
                total_size = self.expected_size or 1
            downloaded = resume_offset

            file_mode = "ab" if resume_offset > 0 and status_code == 206 else "wb"
            with open(download_path, file_mode) as f:
                while True:
                    if self._cancelled:
                        # Keep partial file for future resume
                        return False, "Download cancelled", None

                    chunk = response.read(self.CHUNK_SIZE)
                    if not chunk:
                        break

                    f.write(chunk)
                    downloaded += len(chunk)

                    # Download is 0-50% of total progress
                    progress = (downloaded / total_size) * 50
                    mb_downloaded = downloaded / 1024 / 1024
                    mb_total = total_size / 1024 / 1024
                    message = f"Downloading: {mb_downloaded:.1f} MB / {mb_total:.1f} MB"

                    if not self._report_progress(progress, message):
                        # Keep partial file for future resume
                        return False, "Download cancelled", None

            self._report_progress(50, "Download complete")
            return True, "Download complete", download_path

        except urllib.error.HTTPError as e:
            if e.code == 416:
                # Range not satisfiable — file might already be complete
                self._report_progress(50, "Download complete")
                return True, "Download complete", download_path
            return False, f"Download failed with status {e.code}. Partial download saved for resume.", None
        except (urllib.error.URLError, TimeoutError) as e:
            # Keep partial file for resume on next attempt
            reason = str(e.reason) if hasattr(e, "reason") else str(e)
            return False, f"Download error: {reason}. Partial download saved for resume.", None
        except Exception as e:
            # Keep partial file for resume on next attempt
            return False, f"Download error: {str(e)}. Partial download saved for resume.", None

    def verify_checksum(self, file_path: Path) -> tuple[bool, str]:
        """
        Verify the downloaded file's checksum.

        Returns:
            Tuple of (success, message)
        """
        if not self.expected_checksum:
            return True, "No checksum to verify"

        self._report_progress(52, "Verifying checksum...")

        actual_checksum = calculate_sha256(file_path)
        if actual_checksum.lower() == self.expected_checksum.lower():
            self._report_progress(54, "Checksum verified")
            return True, "Checksum verified"
        else:
            return (
                False,
                f"Checksum mismatch: expected {self.expected_checksum[:16]}..., "
                f"got {actual_checksum[:16]}...",
            )

    async def extract(self, archive_path: Path) -> tuple[bool, str, Path | None]:
        """
        Extract the downloaded archive to staging directory.

        Returns:
            Tuple of (success, message, staging_path)
        """
        staging_dir = get_staging_dir()

        # Clean staging directory
        if staging_dir.exists():
            shutil.rmtree(staging_dir)
        staging_dir.mkdir(parents=True, exist_ok=True)

        self._report_progress(55, "Extracting update...")

        try:
            archive_name = archive_path.name.lower()

            if archive_name.endswith(".tar.gz") or archive_name.endswith(".tgz"):
                await self._extract_tarball(archive_path, staging_dir)
            elif archive_name.endswith(".zip"):
                # On macOS, prefer `ditto` (the inverse of the `ditto -c -k` used
                # to build the .app archive) so symlinks, xattrs, and the code
                # signature survive. Fall back to the symlink-aware Python path.
                if not (sys.platform == "darwin" and self._extract_zip_via_ditto(archive_path, staging_dir)):
                    await self._extract_zip(archive_path, staging_dir)
            elif archive_name.endswith(".exe"):
                # Portable executable — no extraction needed, stage with the expected name
                self._report_progress(70, "Staging executable...")
                dest = staging_dir / get_executable_name()
                shutil.copy2(archive_path, dest)
            else:
                return (
                    False,
                    f"Unsupported archive format: {archive_path.suffix}",
                    None,
                )

            content_dir = resolve_extracted_content_dir(staging_dir)
            if content_dir is None:
                return False, "Extraction error: staged archive is empty", None

            self._report_progress(95, "Finalizing...")

            self._report_progress(98, "Extraction complete")
            return True, "Extraction complete", content_dir

        except Exception as e:
            shutil.rmtree(staging_dir, ignore_errors=True)
            return False, f"Extraction error: {str(e)}", None

    async def _extract_tarball(self, archive_path: Path, target_dir: Path) -> None:
        """Extract a tar.gz archive."""
        loop = asyncio.get_event_loop()

        def _extract():
            with tarfile.open(archive_path, "r:gz") as tar:
                members = tar.getmembers()
                total = len(members)
                for i, member in enumerate(members):
                    if self._cancelled:
                        raise asyncio.CancelledError("Extraction cancelled")
                    tar.extract(member, target_dir, filter="data")
                    if i % 100 == 0:  # Update every 100 files
                        progress = 55 + (i / total) * 40  # 55-95%
                        self._report_progress(progress, f"Extracting: {i}/{total} files")

        await loop.run_in_executor(None, _extract)

    async def _extract_zip(self, archive_path: Path, target_dir: Path) -> None:
        """Extract a zip archive, recreating POSIX symlinks and permission bits.

        ``zipfile.extract`` materializes a symlink entry as a *regular file*
        whose contents are the link target. On macOS that corrupts the Electron
        ``.app`` framework symlinks (``Versions/Current`` etc.), so the
        relaunched app fails to load its frameworks and reports "is damaged".
        We therefore recreate symlink entries explicitly.
        """
        loop = asyncio.get_event_loop()

        def _extract():
            with zipfile.ZipFile(archive_path, "r") as zf:
                members = zf.infolist()
                total = len(members)
                for i, member in enumerate(members):
                    if self._cancelled:
                        raise asyncio.CancelledError("Extraction cancelled")
                    self._extract_zip_member(zf, member, target_dir)
                    if i % 100 == 0:
                        progress = 55 + (i / total) * 40
                        self._report_progress(progress, f"Extracting: {i}/{total} files")

        await loop.run_in_executor(None, _extract)

    def _extract_zip_member(self, zf: zipfile.ZipFile, member: zipfile.ZipInfo, target_dir: Path) -> None:
        """Extract one ZIP member, recreating symlinks instead of writing them
        as regular files (which is what ``zipfile.extract`` would do).

        Symlinks whose target escapes the staging dir are refused: otherwise a
        later regular entry could be written *through* an escaping parent
        symlink (symlink-based Zip-Slip).
        """
        mode = (member.external_attr >> 16) & 0xFFFF
        base = Path(target_dir).resolve()

        if os.name != "nt" and stat.S_ISLNK(mode):
            # Sanitize the entry name (drop leading slashes / ``..`` segments)
            # and verify the destination stays inside the staging dir.
            parts = [p for p in member.filename.split("/") if p not in ("", os.curdir, os.pardir)]
            if not parts:
                return
            dest = base.joinpath(*parts)
            if not self._is_within(base, dest):
                return
            link_target = zf.read(member).decode("utf-8", "surrogateescape")
            # Refuse links whose (lexical) target leaves the staging dir, so a
            # later regular entry can't be written through an escaping parent.
            if os.path.isabs(link_target):
                resolved_target = Path(link_target)
            else:
                resolved_target = Path(os.path.normpath(dest.parent / link_target))
            if not self._is_within(base, resolved_target):
                logger.warning(
                    "Skipping update symlink escaping staging: %s -> %s",
                    member.filename,
                    link_target,
                )
                return
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.is_symlink() or dest.exists():
                dest.unlink()
            os.symlink(link_target, dest)
            return

        extracted_path = Path(zf.extract(member, target_dir))
        self._restore_zip_permissions(member, extracted_path)

    @staticmethod
    def _is_within(base: Path, candidate: Path) -> bool:
        """Return whether ``candidate`` is lexically inside ``base``."""
        try:
            Path(os.path.normpath(candidate)).relative_to(base)
            return True
        except ValueError:
            return False

    def _restore_zip_permissions(self, member: zipfile.ZipInfo, extracted_path: Path) -> None:
        """Restore POSIX permissions recorded in a ZIP entry when available."""
        if os.name == "nt" or not extracted_path.exists():
            return

        mode = (member.external_attr >> 16) & 0xFFFF
        if mode == 0:
            return

        extracted_path.chmod(stat.S_IMODE(mode))

    def _extract_zip_via_ditto(self, archive_path: Path, target_dir: Path) -> bool:
        """Extract a zip with macOS ``ditto`` (the inverse of the ``ditto -c -k``
        used to build the .app archive).

        ``ditto`` preserves symlinks, extended attributes, and the code signature
        more faithfully than Python's ``zipfile``. Returns ``False`` if ``ditto``
        is unavailable or fails, so the caller falls back to the Python path.
        """
        ditto = shutil.which("ditto")
        if not ditto:
            return False

        self._report_progress(60, "Extracting update (ditto)...")
        try:
            # `--rsrc` mirrors the build's `ditto -c -k --sequesterRsrc`, restoring
            # resource forks / xattrs from the archive's AppleDouble sidecar.
            subprocess.run(
                [ditto, "-x", "-k", "--rsrc", str(archive_path), str(target_dir)],
                check=True,
                capture_output=True,
            )
            return True
        except Exception as e:
            logger.warning("ditto extraction failed, falling back to zipfile: %s", e)
            # Remove any partial output so the zipfile fallback starts from a
            # clean staging dir (ditto may have extracted some entries already).
            shutil.rmtree(target_dir, ignore_errors=True)
            target_dir.mkdir(parents=True, exist_ok=True)
            return False


def _looks_like_macos_bundle_root(candidate: Path) -> bool:
    """Return whether a path looks like a staged macOS app bundle."""
    return (
        candidate.is_dir()
        and candidate.suffix == ".app"
        and (candidate / "Contents" / "MacOS").exists()
    )


def _looks_like_directory_app_root(candidate: Path, expected_executable: str) -> bool:
    """Return whether a path looks like an unpacked desktop app root."""
    return (
        candidate.is_dir()
        and (candidate / expected_executable).is_file()
        and (candidate / "resources").is_dir()
    )


def _find_unique_directory_match(
    roots: list[Path],
    predicate: Callable[[Path], bool],
    max_depth: int = 2,
) -> Path | None:
    """Search breadth-first for a unique matching directory near the extraction root."""
    frontier = [root for root in roots if root.is_dir()]
    seen: set[Path] = set()

    for _depth in range(max_depth + 1):
        matches = [candidate for candidate in frontier if predicate(candidate)]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            return None

        next_frontier: list[Path] = []
        for candidate in frontier:
            if candidate in seen:
                continue
            seen.add(candidate)
            try:
                next_frontier.extend(child for child in candidate.iterdir() if child.is_dir())
            except OSError:
                continue
        frontier = next_frontier
        if not frontier:
            break

    return None


def resolve_extracted_content_dir(staging_dir: Path, ignored_names: set[str] | None = None) -> Path | None:
    """Resolve the actual app content root from a staging directory."""
    if not staging_dir.exists():
        return None

    ignored = ignored_names or set()
    entries = [entry for entry in staging_dir.iterdir() if entry.name not in ignored]
    if not entries:
        return None

    expected_executable = os.environ.get("NIRS4ALL_APP_EXE") or get_executable_name()
    top_level_dirs = [entry for entry in entries if entry.is_dir()]

    mac_bundle = _find_unique_directory_match(top_level_dirs, _looks_like_macos_bundle_root)
    if mac_bundle is not None:
        return mac_bundle

    nested_app_root = _find_unique_directory_match(
        top_level_dirs,
        lambda candidate: _looks_like_directory_app_root(candidate, expected_executable),
    )
    if nested_app_root is not None:
        return nested_app_root

    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]

    return staging_dir


async def download_and_stage_update(
    download_url: str,
    expected_size: int,
    expected_checksum: str | None = None,
    progress_callback: Callable[[float, str], bool] | None = None,
) -> tuple[bool, str, Path | None]:
    """
    Convenience function to download, verify, and extract an update.

    Args:
        download_url: URL to download from
        expected_size: Expected file size in bytes
        expected_checksum: Expected SHA256 checksum
        progress_callback: Callback for progress updates

    Returns:
        Tuple of (success, message, staging_path)
    """
    downloader = UpdateDownloader(
        download_url=download_url,
        expected_size=expected_size,
        expected_checksum=expected_checksum,
        progress_callback=progress_callback,
    )

    # Download
    success, message, download_path = await downloader.download()
    if not success:
        return False, message, None

    # Verify checksum
    if download_path and expected_checksum:
        success, message = downloader.verify_checksum(download_path)
        if not success:
            download_path.unlink(missing_ok=True)
            return False, message, None

    # Extract
    if download_path:
        success, message, staging_path = await downloader.extract(download_path)
        if not success:
            download_path.unlink(missing_ok=True)
            return False, message, None

        # Clean up download file after successful extraction
        download_path.unlink(missing_ok=True)

        return True, "Update staged successfully", staging_path

    return False, "No download path", None
