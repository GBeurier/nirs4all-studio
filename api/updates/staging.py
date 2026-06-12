"""
Webapp staged-update helpers.

Runtime-mode detection plus staging-directory layout/metadata helpers used by
the download/apply lifecycle. Independent of the update-check polling.
"""

import json
import os
import platform
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from ..update_downloader import resolve_extracted_content_dir

STAGED_UPDATE_METADATA_FILE = ".nirs4all-staged-update.json"


@dataclass(frozen=True)
class StagedUpdateLayout:
    """Validated staged update layout for the updater script."""

    content_dir: Path
    mode: str
    staged_executable: str | None = None


def _is_portable_runtime() -> bool:
    """Return True when running from the portable desktop build."""
    return bool(
        os.environ.get("NIRS4ALL_PORTABLE_EXE")
        or os.environ.get("NIRS4ALL_PORTABLE_ROOT")
    )


def _expected_update_mode() -> str:
    """Return the updater mode that matches the current runtime layout."""
    if _is_portable_runtime():
        return "portable"
    if platform.system().lower() == "darwin":
        return "bundle"
    return "directory"


def _staging_entries(staging_dir: Path) -> list[Path]:
    """List staged entries, excluding the internal metadata file."""
    return [
        entry
        for entry in staging_dir.iterdir()
        if entry.name != STAGED_UPDATE_METADATA_FILE
    ]


def _resolve_staged_content_dir(staging_dir: Path) -> Path | None:
    """Resolve the actual staged content root from the staging wrapper dir."""
    return resolve_extracted_content_dir(
        staging_dir,
        ignored_names={STAGED_UPDATE_METADATA_FILE},
    )


def _find_portable_executable(content_dir: Path, expected_executable: str) -> Path | None:
    """Resolve the staged portable executable for the current installation."""
    expected_path = content_dir / expected_executable
    if expected_path.is_file():
        return expected_path

    if platform.system().lower() != "windows" or not expected_executable.lower().endswith(".exe"):
        return None

    candidates = [
        entry
        for entry in content_dir.iterdir()
        if entry.is_file() and entry.suffix.lower() == ".exe"
    ]
    if not candidates:
        return None
    if len(candidates) > 1:
        raise HTTPException(
            status_code=400,
            detail="The staged portable update contains multiple executables; cannot choose the app executable.",
        )

    return candidates[0]


def _write_staged_update_metadata(staging_dir: Path, **metadata: Any) -> None:
    """Persist lightweight metadata for a staged update."""
    staging_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        **metadata,
        "staged_at": datetime.now().isoformat(),
    }
    with open(staging_dir / STAGED_UPDATE_METADATA_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def _read_staged_update_metadata(staging_dir: Path) -> dict[str, Any] | None:
    """Read staged update metadata if available."""
    metadata_path = staging_dir / STAGED_UPDATE_METADATA_FILE
    if not metadata_path.exists():
        return None

    try:
        with open(metadata_path, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception:
        pass

    return None


def _validate_staged_update_layout(staging_dir: Path) -> StagedUpdateLayout:
    """Validate the staged update layout for the current runtime mode."""
    from updater import get_executable_name

    content_dir = _resolve_staged_content_dir(staging_dir)
    if content_dir is None:
        raise HTTPException(status_code=400, detail="No staged update found. Download an update first.")

    update_mode = _expected_update_mode()
    expected_executable = os.environ.get("NIRS4ALL_APP_EXE") or get_executable_name()

    if update_mode == "portable":
        executable_path = _find_portable_executable(content_dir, expected_executable)
        if executable_path is None or not executable_path.is_file():
            raise HTTPException(
                status_code=400,
                detail="The staged update is not a portable executable for this installation.",
            )
        return StagedUpdateLayout(
            content_dir=content_dir,
            mode=update_mode,
            staged_executable=executable_path.name,
        )

    if update_mode == "bundle":
        if content_dir.suffix != ".app" or not (content_dir / "Contents" / "MacOS").exists():
            raise HTTPException(
                status_code=400,
                detail="The staged update is not a valid macOS app bundle.",
            )
        return StagedUpdateLayout(content_dir=content_dir, mode=update_mode)

    executable_path = content_dir / expected_executable
    resources_dir = content_dir / "resources"
    if not executable_path.is_file() or not resources_dir.is_dir():
        raise HTTPException(
            status_code=400,
            detail="The staged update does not match the installed desktop app layout.",
        )

    return StagedUpdateLayout(content_dir=content_dir, mode=update_mode)
