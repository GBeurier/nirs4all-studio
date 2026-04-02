"""Helpers for resolving runtime state directories across distribution modes."""

from __future__ import annotations

import os
from pathlib import Path


def get_portable_root() -> Path | None:
    """Return the portable state root when running from an Electron portable build."""
    portable_root = os.environ.get("NIRS4ALL_PORTABLE_ROOT", "").strip()
    if portable_root:
        return Path(portable_root)

    portable_exe = os.environ.get("NIRS4ALL_PORTABLE_EXE", "").strip()
    if portable_exe:
        return Path(portable_exe).resolve().parent / ".nirs4all"

    return None


def get_portable_config_dir() -> Path | None:
    root = get_portable_root()
    if root is None:
        return None
    return root / "config"


def get_portable_backend_data_dir(app_name: str) -> Path | None:
    root = get_portable_root()
    if root is None:
        return None
    return root / "backend-data" / app_name


def get_portable_backend_log_dir(app_name: str) -> Path | None:
    root = get_portable_root()
    if root is None:
        return None
    return root / "logs" / app_name
