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
from pathlib import Path
from typing import Callable, Optional, Tuple

import aiofiles
import httpx

from updater import get_staging_dir, get_update_cache_dir, calculate_sha256


class UpdateDownloader:
    """Handles downloading and extracting webapp updates."""

    CHUNK_SIZE = 65536  # 64 KB chunks for progress updates

    def __init__(
        self,
        download_url: str,
        expected_size: int,
        expected_checksum: Optional[str] = None,
        progress_callback: Optional[Callable[[float, str], bool]] = None,
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

    async def download(self) -> Tuple[bool, str, Optional[Path]]:
        """
        Download the update archive.

        Returns:
            Tuple of (success, message, downloaded_file_path)
        """
        cache_dir = get_update_cache_dir()
        filename = self.download_url.split("/")[-1]
        download_path = cache_dir / filename

        # Remove old download if exists
        if download_path.exists():
            download_path.unlink()

        try:
            self._report_progress(0, "Connecting to server...")

            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=httpx.Timeout(30.0, read=300.0),
            ) as client:
                async with client.stream("GET", self.download_url) as response:
                    if response.status_code != 200:
                        return (
                            False,
                            f"Download failed with status {response.status_code}",
                            None,
                        )

                    total_size = int(
                        response.headers.get("content-length", self.expected_size)
                    )
                    downloaded = 0

                    async with aiofiles.open(download_path, "wb") as f:
                        async for chunk in response.aiter_bytes(
                            chunk_size=self.CHUNK_SIZE
                        ):
                            if self._cancelled:
                                await f.close()
                                download_path.unlink(missing_ok=True)
                                return False, "Download cancelled", None

                            await f.write(chunk)
                            downloaded += len(chunk)

                            # Download is 0-50% of total progress
                            progress = (downloaded / total_size) * 50
                            mb_downloaded = downloaded / 1024 / 1024
                            mb_total = total_size / 1024 / 1024
                            message = f"Downloading: {mb_downloaded:.1f} MB / {mb_total:.1f} MB"

                            if not self._report_progress(progress, message):
                                await f.close()
                                download_path.unlink(missing_ok=True)
                                return False, "Download cancelled", None

            self._report_progress(50, "Download complete")
            return True, "Download complete", download_path

        except httpx.TimeoutException:
            download_path.unlink(missing_ok=True)
            return False, "Download timed out", None
        except httpx.ConnectError as e:
            download_path.unlink(missing_ok=True)
            return False, f"Connection error: {str(e)}", None
        except Exception as e:
            download_path.unlink(missing_ok=True)
            return False, f"Download error: {str(e)}", None

    def verify_checksum(self, file_path: Path) -> Tuple[bool, str]:
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

    async def extract(self, archive_path: Path) -> Tuple[bool, str, Optional[Path]]:
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
    expected_checksum: Optional[str] = None,
    progress_callback: Optional[Callable[[float, str], bool]] = None,
) -> Tuple[bool, str, Optional[Path]]:
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
