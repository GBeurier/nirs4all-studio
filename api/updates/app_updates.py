"""
Webapp self-update lifecycle endpoints.

Covers the GitHub/PyPI status surface, changelog, settings, runtime status,
nirs4all install, and the download / stage / apply lifecycle. Shared state
(``venv_manager``, ``update_manager``) is reached through the ``api.updates``
package so the test suite can patch ``api.updates.venv_manager`` and have it
take effect here.
"""

import asyncio
import json
import os
import platform
import shutil
import sys
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api import updates as _u

from .catalog import APP_NAME
from .manager import (
    InstallRequest,
    UpdateSettings,
    UpdateStatus,
    get_update_manager,
)
from .staging import (
    _expected_update_mode,
    _read_staged_update_metadata,
    _resolve_staged_content_dir,
    _staging_entries,
    _write_staged_update_metadata,
)

if TYPE_CHECKING:
    from api.jobs.manager import Job

router = APIRouter()


@router.get("/status")
async def get_update_status() -> UpdateStatus:
    """
    Get current update status for webapp and nirs4all.

    Returns cached results if available and not expired.
    """
    return await _u.update_manager.get_update_status()


@router.post("/check")
async def check_for_updates() -> UpdateStatus:
    """
    Force a fresh check for updates.

    Bypasses cache and queries GitHub/PyPI directly.
    """
    return await _u.update_manager.get_update_status(force=True)


@router.get("/webapp/changelog")
async def get_webapp_changelog(current_version: str | None = None) -> dict[str, Any]:
    """
    Get changelog entries between the current and latest webapp version.

    Fetches all GitHub releases newer than current_version and returns
    their release notes combined.
    """
    mgr = get_update_manager()
    if not current_version:
        current_version = mgr.get_webapp_version()

    repo = mgr.settings.github_repo
    api_url = f"https://api.github.com/repos/{repo}/releases"
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": f"{APP_NAME}/{current_version}",
    }

    try:
        status_code, content = await mgr._fetch_url(f"{api_url}?per_page=20", headers)
        if status_code != 200:
            return {"entries": [], "error": f"GitHub API returned {status_code}"}

        releases = json.loads(content)
        entries = []

        try:
            from packaging import version as pkg_version
            current_parsed = pkg_version.parse(current_version)
            use_packaging = True
        except ImportError:
            current_parsed = current_version
            use_packaging = False

        for release in releases:
            tag = release.get("tag_name", "").lstrip("v")
            if not tag:
                continue

            if use_packaging:
                try:
                    if pkg_version.parse(tag) <= current_parsed:
                        continue
                except Exception:
                    continue
            elif tag <= current_version:
                continue

            entries.append({
                "version": tag,
                "date": release.get("published_at"),
                "body": release.get("body", ""),
                "prerelease": release.get("prerelease", False),
            })

        # Sort newest first
        entries.sort(key=lambda e: e["version"], reverse=True)

        return {"entries": entries, "current_version": current_version}

    except Exception as e:
        return {"entries": [], "error": str(e)}


@router.get("/settings")
async def get_update_settings() -> UpdateSettings:
    """Get current update settings."""
    return _u.update_manager.settings


@router.put("/settings")
async def update_settings(settings: dict[str, Any]) -> UpdateSettings:
    """Update settings (PATCH semantics — merge with existing)."""
    current = _u.update_manager.settings.model_dump()
    current.update(settings)
    merged = UpdateSettings(**current)
    _u.update_manager.update_settings(merged)
    return _u.update_manager.settings


@router.get("/runtime/status")
@router.get("/venv/status")
async def get_runtime_status() -> dict[str, Any]:
    """
    Get the current Python runtime status and installed packages.
    """
    runtime_info = _u.venv_manager.get_venv_info()
    packages = _u.venv_manager.get_installed_packages()

    return {
        "runtime": runtime_info.to_dict(),
        "venv": runtime_info.to_dict(),
        "packages": [p.to_dict() for p in packages],
        "nirs4all_version": _u.venv_manager.get_nirs4all_version(),
    }


@router.post("/nirs4all/install")
async def install_nirs4all(request: InstallRequest) -> dict[str, Any]:
    """
    Install or upgrade nirs4all in the current Python runtime.

    Args:
        request: Installation parameters (version, extras)

    Returns:
        Installation result with status and output
    """
    _u._ensure_runtime_mutable()
    _u._ensure_runtime_is_valid()

    # Install nirs4all
    success, message, output = _u.venv_manager.install_package(
        "nirs4all",
        version=request.version,
        extras=request.extras,
        upgrade=True,
    )

    if not success:
        raise HTTPException(status_code=500, detail=message)

    return {
        "success": True,
        "message": message,
        "version": _u.venv_manager.get_nirs4all_version(),
        "output": output[-50:],  # Last 50 lines
        "requires_restart": True,  # nirs4all always requires restart
    }


@router.get("/webapp/download-info")
async def get_webapp_download_info() -> dict[str, Any]:
    """
    Get information needed to download a webapp update.
    """
    webapp_info = await _u.update_manager.check_github_release()

    if not webapp_info.update_available:
        return {
            "update_available": False,
            "current_version": webapp_info.current_version,
            "latest_version": webapp_info.latest_version,
        }

    return {
        "update_available": True,
        "current_version": webapp_info.current_version,
        "latest_version": webapp_info.latest_version,
        "download_url": webapp_info.download_url,
        "asset_name": webapp_info.asset_name,
        "download_size_bytes": webapp_info.download_size_bytes,
        "release_notes": webapp_info.release_notes,
        "release_url": webapp_info.release_url,
    }


@router.post("/webapp/download-start")
async def start_webapp_download() -> dict[str, Any]:
    """
    Start downloading the webapp update in the background.

    Returns a job ID for tracking progress via WebSocket or polling.
    """
    from api.jobs.manager import JobType, job_manager

    webapp_info = await _u.update_manager.check_github_release()

    if not webapp_info.update_available:
        raise HTTPException(status_code=400, detail="No update available")

    if not webapp_info.download_url:
        raise HTTPException(status_code=400, detail="No download URL available for this platform")

    # Create download job
    job = job_manager.create_job(
        JobType.UPDATE_DOWNLOAD,
        config={
            "version": webapp_info.latest_version,
            "download_url": webapp_info.download_url,
            "asset_name": webapp_info.asset_name,
            "expected_size": webapp_info.download_size_bytes or 0,
            "checksum": webapp_info.checksum_sha256,
        },
    )

    # Submit job for execution
    job_manager.submit_job(job, _execute_download_job)

    return {
        "job_id": job.id,
        "status": "started",
        "version": webapp_info.latest_version,
        "asset_name": webapp_info.asset_name,
        "message": f"Downloading {webapp_info.asset_name}...",
    }


def _execute_download_job(job: "Job", progress_callback: Callable[[float, str], None]) -> dict[str, Any]:
    """Execute the download job (runs in thread pool)."""
    from api.update_downloader import download_and_stage_update
    from updater import get_staging_dir

    def _progress_wrapper(progress: float, message: str) -> bool:
        """Wrap progress callback to check for cancellation."""
        if job.cancellation_requested:
            return False
        progress_callback(progress, message)
        return True

    success, message, staging_path = asyncio.run(
        download_and_stage_update(
            download_url=job.config["download_url"],
            expected_size=job.config.get("expected_size", 0),
            expected_checksum=job.config.get("checksum"),
            progress_callback=_progress_wrapper,
        )
    )

    if not success:
        # If the job was cancelled, return normally so the job manager
        # can detect cancellation_requested and set CANCELLED status
        # instead of the exception path which maps to FAILED.
        if job.cancellation_requested:
            return {"cancelled": True, "message": message}
        raise Exception(message)

    _write_staged_update_metadata(
        get_staging_dir(),
        version=job.config["version"],
        asset_name=job.config.get("asset_name"),
        update_mode=_expected_update_mode(),
    )

    return {
        "staging_path": str(staging_path) if staging_path else None,
        "version": job.config["version"],
        "ready_to_apply": True,
    }


@router.get("/webapp/download-status/{job_id}")
async def get_download_status(job_id: str) -> dict[str, Any]:
    """Get the status of an update download job."""
    from api.jobs.manager import job_manager

    job = job_manager.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return {
        "job_id": job.id,
        "status": job.status.value,
        "progress": job.progress,
        "message": job.progress_message,
        "result": job.result,
        "error": job.error,
    }


@router.post("/webapp/download-cancel/{job_id}")
async def cancel_download(job_id: str) -> dict[str, Any]:
    """Cancel an in-progress download."""
    from api.jobs.manager import job_manager

    job = job_manager.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    cancelled = job_manager.cancel_job(job_id)

    if not cancelled:
        return {
            "success": False,
            "message": "Job is already completed or cannot be cancelled",
        }

    return {
        "success": True,
        "message": "Cancellation requested",
    }


class ApplyUpdateRequest(BaseModel):
    """Request to apply a staged update."""
    confirm: bool = True


@router.post("/webapp/apply")
async def apply_webapp_update(request: ApplyUpdateRequest) -> dict[str, Any]:
    """
    Apply the staged webapp update.

    This will:
    1. Create an updater script
    2. Launch the updater script
    3. Signal the app to exit

    The updater script will:
    1. Wait for this app to exit
    2. Backup the current installation
    3. Copy new files from staging
    4. Launch the new version
    """
    from updater import create_updater_script, get_staging_dir, launch_updater

    if not request.confirm:
        raise HTTPException(status_code=400, detail="Update not confirmed")

    staging_dir = get_staging_dir()
    layout = _u._validate_staged_update_layout(staging_dir)

    try:
        # Create the updater script
        script_path, _ = create_updater_script(
            layout.content_dir,
            staged_executable=layout.staged_executable,
        )

        # Launch the updater (it will wait for us to exit)
        success = launch_updater(script_path)

        if not success:
            raise HTTPException(
                status_code=500,
                detail="Failed to launch updater script",
            )

        return {
            "success": True,
            "message": f"Update will be applied after app restart ({layout.mode} mode). Please close the application.",
            "restart_required": True,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to apply update: {str(e)}",
        )


@router.get("/webapp/staged-update")
async def get_staged_update_info() -> dict[str, Any]:
    """Get information about any staged update."""
    from updater import get_staging_dir

    staging_dir = get_staging_dir()

    if not staging_dir.exists() or not _staging_entries(staging_dir):
        return {
            "has_staged_update": False,
        }

    metadata = _read_staged_update_metadata(staging_dir) or {}

    # Try to find version info in staged update
    version_file = None
    content_dir = _resolve_staged_content_dir(staging_dir)
    if content_dir is not None:
        if content_dir.is_dir():
            for candidate in [
                content_dir / "version.json",
                content_dir / "resources" / "version.json",
                content_dir / "Contents" / "Resources" / "version.json",
            ]:
                if candidate.exists():
                    version_file = candidate
                    break

    version = metadata.get("version")
    if version_file and version_file.exists():
        try:
            with open(version_file, encoding="utf-8") as f:
                data = json.load(f)
                version = data.get("version") or version
        except Exception:
            pass

    return {
        "has_staged_update": True,
        "staging_path": str(staging_dir),
        "version": version,
        "asset_name": metadata.get("asset_name"),
        "update_mode": metadata.get("update_mode"),
    }


@router.delete("/webapp/staged-update")
async def cancel_staged_update() -> dict[str, Any]:
    """Cancel/remove a staged update."""
    from updater import get_staging_dir

    staging_dir = get_staging_dir()

    if staging_dir.exists():
        shutil.rmtree(staging_dir, ignore_errors=True)
        return {"success": True, "message": "Staged update removed"}

    return {"success": True, "message": "No staged update to remove"}


@router.post("/webapp/cleanup")
async def cleanup_updates() -> dict[str, Any]:
    """Clean up old update artifacts."""
    from updater import cleanup_old_updates

    cleanup_old_updates()
    return {"success": True, "message": "Cleanup complete"}


@router.post("/webapp/restart")
async def restart_webapp() -> dict[str, Any]:
    """
    Request webapp restart.

    In Electron mode: the frontend should call window.electronApi.restartBackend().
    In web mode: signals graceful shutdown so the process manager can restart.
    """
    is_electron = os.environ.get("NIRS4ALL_ELECTRON") == "true"

    if not is_electron:
        # In web mode, schedule a graceful shutdown after response is sent.
        # A process manager (systemd, Docker) should restart the process.
        import signal

        async def _shutdown():
            await asyncio.sleep(1)
            os.kill(os.getpid(), signal.SIGTERM)

        asyncio.create_task(_shutdown())

    return {
        "success": True,
        "message": "Restart requested.",
        "restart_required": True,
        "is_electron": is_electron,
    }


@router.get("/version")
async def get_versions() -> dict[str, Any]:
    """
    Get current version information.
    """
    return {
        "webapp_version": _u.update_manager.get_webapp_version(),
        "nirs4all_version": _u.update_manager.get_nirs4all_version(),
        "python_version": sys.version,
        "platform": platform.system(),
        "machine": platform.machine(),
    }
