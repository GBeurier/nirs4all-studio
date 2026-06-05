"""Pure, non-route helpers for the workspace API.

This module holds the leaf helper functions extracted from
:mod:`api.workspace`: the workspace-discovery TTL cache, the directory-size
utility, and the workspace-id resolution helper. It depends only on the
workspace registry and shared path utilities, so :mod:`api.workspace` imports
from here (never the reverse).
"""

from pathlib import Path
import time
from typing import Dict, Any, Optional, Tuple

from .workspace_manager import workspace_manager
from .shared.paths import is_within_directory


# Simple TTL cache for workspace discovery operations
# Key: (workspace_path, source) -> (timestamp, result)
_workspace_runs_cache: Dict[Tuple[str, str], Tuple[float, Any]] = {}
_CACHE_TTL_SECONDS = 5  # Cache results for 5 seconds


def _get_cached_runs(workspace_path: str, source: str) -> Optional[Any]:
    """Get cached runs if still valid."""
    key = (workspace_path, source)
    if key in _workspace_runs_cache:
        timestamp, result = _workspace_runs_cache[key]
        if time.time() - timestamp < _CACHE_TTL_SECONDS:
            return result
        # Expired, remove from cache
        del _workspace_runs_cache[key]
    return None


def _set_cached_runs(workspace_path: str, source: str, result: Any) -> None:
    """Cache runs result with current timestamp."""
    key = (workspace_path, source)
    _workspace_runs_cache[key] = (time.time(), result)


def invalidate_workspace_cache(workspace_path: str = None) -> None:
    """Invalidate cache for a workspace or all workspaces."""
    if workspace_path is None:
        _workspace_runs_cache.clear()
    else:
        keys_to_delete = [k for k in _workspace_runs_cache if k[0] == workspace_path]
        for k in keys_to_delete:
            del _workspace_runs_cache[k]


def _compute_directory_size(directory: Path) -> tuple[int, int]:
    """Compute total size and file count for a directory."""
    total_size = 0
    file_count = 0
    if directory.exists() and directory.is_dir():
        for file in directory.rglob("*"):
            if file.is_file():
                try:
                    total_size += file.stat().st_size
                    file_count += 1
                except (OSError, PermissionError):
                    pass
    return total_size, file_count


def _resolve_workspace_id_path(workspace_id: str) -> Optional[str]:
    """Resolve a workspace_id to a trusted workspace path.

    The id is either a base64-encoded path or a workspace name. A decoded path
    is honored only when it matches (or is contained within) a registered
    linked workspace, so an attacker cannot smuggle an arbitrary filesystem
    path in through the base64 channel. Names are resolved via the registry.

    Args:
        workspace_id: The base64-encoded path or workspace name from the URL.

    Returns:
        The trusted workspace path, or None if it cannot be validated.
    """
    import base64

    linked_paths = [ws.path for ws in workspace_manager.get_linked_workspaces()]

    try:
        decoded = base64.urlsafe_b64decode(workspace_id.encode()).decode()
    except Exception:
        decoded = None

    if decoded:
        for linked in linked_paths:
            if is_within_directory(linked, decoded):
                return decoded

    # Fall back to name lookup against the registry.
    return workspace_manager.find_workspace_by_name(workspace_id)
