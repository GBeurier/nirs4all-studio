"""
Update download and extraction module.

Provides functionality to:
- Download update archives with progress tracking
- Verify checksums
- Extract tar.gz (Linux/macOS) or zip (Windows) archives
- Stage updates for the apply step
"""

import asyncio
import hashlib
import shutil
import tarfile
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import Optional, Tuple

import aiofiles
import httpx

from updater import calculate_sha256, get_staging_dir, get_update_cache_dir


class UpdateDownloader:
    """Handles downloading and extracting webapp updates."""

    CHUNK_SIZE = 65536  # 64 KB chunks for progress updates

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
            # If size matches expected, treat as already complete
            if self.expected_size and resume_offset >= self.expected_size:
                self._report_progress(50, "Download already complete")
                return True, "Download complete", download_path

        try:
            if resume_offset > 0:
                self._report_progress(0, f"Resuming download from {resume_offset / 1024 / 1024:.1f} MB...")
            else:
                self._report_progress(0, "Connecting to server...")

            headers = {}
            if resume_offset > 0:
                headers["Range"] = f"bytes={resume_offset}-"

            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=httpx.Timeout(30.0, read=300.0),
            ) as client, client.stream("GET", self.download_url, headers=headers) as response:
                # 206 = Partial Content (resume worked), 200 = full response
                if response.status_code == 200:
                    # Server doesn't support Range — restart from scratch
                    resume_offset = 0
                elif response.status_code == 416:
                    # Range not satisfiable — file might already be complete
                    self._report_progress(50, "Download complete")
                    return True, "Download complete", download_path
                elif response.status_code != 206:
                    return (
                        False,
                        f"Download failed with status {response.status_code}",
                        None,
                    )

                content_length = int(response.headers.get("content-length", 0))
                total_size = resume_offset + content_length if response.status_code == 206 else content_length
                if total_size == 0:
                    total_size = self.expected_size or 1
                downloaded = resume_offset

                file_mode = "ab" if resume_offset > 0 and response.status_code == 206 else "wb"
                async with aiofiles.open(download_path, file_mode) as f:
                    async for chunk in response.aiter_bytes(
                        chunk_size=self.CHUNK_SIZE
                    ):
                        if self._cancelled:
                            # Keep partial file for future resume
                            return False, "Download cancelled", None

                        await f.write(chunk)
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

        except (httpx.TimeoutException, httpx.ConnectError) as e:
            # Keep partial file for resume on next attempt
            error_type = "timed out" if isinstance(e, httpx.TimeoutException) else f"connection error: {e}"
            return False, f"Download {error_type}. Partial download saved for resume.", None
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
                await self._extract_zip(archive_path, staging_dir)
            else:
                return (
                    False,
                    f"Unsupported archive format: {archive_path.suffix}",
                    None,
                )

            # Find the actual content directory
            # Archives typically have a root folder like "nirs4all-webapp/"
            contents = list(staging_dir.iterdir())
            if len(contents) == 1 and contents[0].is_dir():
                # Single directory - this is our content
                content_dir = contents[0]
                self._report_progress(95, "Finalizing...")
            else:
                content_dir = staging_dir

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
        """Extract a zip archive."""
        loop = asyncio.get_event_loop()

        def _extract():
            with zipfile.ZipFile(archive_path, "r") as zf:
                members = zf.namelist()
                total = len(members)
                for i, member in enumerate(members):
                    if self._cancelled:
                        raise asyncio.CancelledError("Extraction cancelled")
                    zf.extract(member, target_dir)
                    if i % 100 == 0:
                        progress = 55 + (i / total) * 40
                        self._report_progress(progress, f"Extracting: {i}/{total} files")

        await loop.run_in_executor(None, _extract)


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
