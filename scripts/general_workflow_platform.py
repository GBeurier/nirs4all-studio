"""Platform-specific paths for the packaged general-workflow witness."""

from __future__ import annotations

import os
from pathlib import Path


def packaged_python_layout(
    runtime_root: Path,
    platform_name: str | None = None,
) -> tuple[Path, Path]:
    """Return the packaged interpreter and site-packages for one target OS."""
    python_root = runtime_root / "python"
    selected_platform = platform_name or os.name
    if selected_platform in {"nt", "win32"}:
        return python_root / "python.exe", python_root / "Lib" / "site-packages"
    return python_root / "bin" / "python3", python_root / "lib" / "python3.11" / "site-packages"
