"""Shared state and helpers for the workspace API package.

Holds the module-level caches, store/links signatures, cache invalidation,
and the small cross-router utilities that several workspace routers depend on.
Keeping these in one module guarantees the caches are singletons shared by
every router and by ``_invalidate_results_caches``.
"""

import time
from pathlib import Path
from typing import Any

from ..jobs import JobStatus, JobType, job_manager
from ..shared.logger import get_logger
from ..store_adapter import StoreAdapter
from ..workspace_manager import workspace_manager

logger = get_logger(__name__)

STORE_AVAILABLE = True
PREDICTIONS_AVAILABLE = True
MIGRATION_AVAILABLE = True


# Simple TTL cache for workspace discovery operations
# Key: (workspace_path, source) -> (timestamp, result)
_workspace_runs_cache: dict[tuple[str, str], tuple[float, Any]] = {}
_CACHE_TTL_SECONDS = 5  # Cache results for 5 seconds


def _get_cached_runs(workspace_path: str, source: str) -> Any | None:
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
    # Phase 3/4: also drop derived results caches for this workspace.
    _invalidate_results_caches(workspace_path)


# ---------------------------------------------------------------------------
# Phase 3/4: results-summary and dataset-scores caches
#
# These caches are keyed on (workspace_id, store_signature, dataset_links_signature,
# shape_params). The store signature is the (mtime_ns, size) of store.sqlite
# (and store.duckdb, if present). The dataset-links signature is a stable hash
# of the (id, name, path) tuples returned by app_config.get_datasets() — that
# input is the only piece of app config that influences the resolved
# `linked_dataset_id` mapping. Both caches use the same key shape but live in
# separate dicts to allow independent eviction.
#
# Cache entries are validated against the current store signature on every
# read; an entry whose signature no longer matches is treated as a miss. This
# is the correctness backstop in case some mutation site forgets to call
# `_invalidate_results_caches`.
# ---------------------------------------------------------------------------

# key: (workspace_id, store_sig, links_sig, shape_key) -> payload
_RESULTS_SUMMARY_CACHE: dict[tuple, Any] = {}
_DATASET_SCORES_CACHE: dict[tuple, Any] = {}


def _store_signature(workspace_path: Path) -> tuple | None:
    """Return a cheap signature for the workspace store files.

    Combines (mtime_ns, size) for store.sqlite and store.duckdb when present.
    Returns None if neither file exists.
    """
    parts: list[tuple[str, int, int]] = []
    for name in ("store.sqlite", "store.duckdb"):
        p = workspace_path / name
        try:
            st = p.stat()
        except (FileNotFoundError, OSError):
            continue
        parts.append((name, st.st_mtime_ns, st.st_size))
    if not parts:
        return None
    return tuple(parts)


def _dataset_links_signature(linked_datasets: list) -> tuple:
    """Stable, cheap fingerprint of the dataset-links mapping used to resolve
    `linked_dataset_id`. Only the fields read by `_resolve_dataset_mapping`
    matter (id, name, path)."""
    parts: list[tuple[str, str, str]] = []
    for ld in linked_datasets:
        ld_id = getattr(ld, "id", None) if not isinstance(ld, dict) else ld.get("id")
        ld_name = getattr(ld, "name", None) if not isinstance(ld, dict) else ld.get("name")
        ld_path = getattr(ld, "path", None) if not isinstance(ld, dict) else ld.get("path")
        parts.append((str(ld_id or ""), str(ld_name or ""), str(ld_path or "")))
    parts.sort()
    return tuple(parts)


def _invalidate_results_caches(workspace_path_or_id: str | None = None) -> None:
    """Drop cached results-summary and dataset-scores entries.

    Pass None to clear everything. Pass a workspace path or workspace id to
    clear all entries whose first key component matches.
    """
    if workspace_path_or_id is None:
        _RESULTS_SUMMARY_CACHE.clear()
        _DATASET_SCORES_CACHE.clear()
        return

    target = str(workspace_path_or_id)
    cache_targets = {target}
    try:
        target_path = Path(target).resolve()
    except (OSError, RuntimeError):
        target_path = None

    try:
        for ws in workspace_manager.get_linked_workspaces():
            ws_id = str(ws.id)
            ws_path = str(ws.path)
            if ws_id == target or ws_path == target:
                cache_targets.update({ws_id, ws_path})
                continue
            if target_path is None:
                continue
            try:
                if Path(ws.path).resolve() == target_path:
                    cache_targets.update({ws_id, ws_path})
            except (OSError, RuntimeError):
                continue
    except Exception:
        # Cache invalidation must stay best-effort.
        pass

    for cache in (_RESULTS_SUMMARY_CACHE, _DATASET_SCORES_CACHE):
        stale = [k for k in cache if k and k[0] in cache_targets]
        for k in stale:
            del cache[k]


def _get_storage_status_for_workspace(workspace_path: Path) -> dict[str, Any]:
    """Resolve storage mode/status for a workspace."""
    has_arrays_directory = (workspace_path / "arrays").exists()
    db_path = workspace_path / "store.sqlite"
    if not db_path.exists():
        db_path = workspace_path / "store.duckdb"

    status = {
        "storage_mode": "new",
        "has_prediction_arrays_table": False,
        "has_arrays_directory": has_arrays_directory,
        "migration_needed": False,
    }

    # Avoid opening WorkspaceStore when no DB exists (it can create one).
    if not db_path.exists():
        if has_arrays_directory:
            status["storage_mode"] = "migrated"
        return status

    if not STORE_AVAILABLE:
        status["storage_mode"] = "unknown"
        return status

    try:
        with StoreAdapter(workspace_path) as adapter:
            return adapter.get_store_status()
    except Exception:
        status["storage_mode"] = "unknown"
        return status


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


def _resolve_store_backed_scanner(workspace_id: str, detail: str):
    """Resolve a linked workspace and ensure it has a store database.

    Returns ``(linked_workspace, workspace_path, scanner)``. Raises
    ``HTTPException`` (404/501) when the workspace or store is missing.
    Imported lazily by callers to avoid a hard dependency on the scanner
    helpers at module import time.
    """
    from fastapi import HTTPException

    from ..workspace_manager import WorkspaceScanner

    ws = workspace_manager._find_linked_workspace(workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    workspace_path = Path(ws.path)
    scanner = WorkspaceScanner(workspace_path)
    if not scanner._has_store():
        raise HTTPException(status_code=501, detail=detail)

    return ws, workspace_path, scanner


def _has_active_non_maintenance_jobs() -> bool:
    """Return True if a non-maintenance job is pending/running."""
    try:
        jobs = job_manager.list_jobs(limit=500)
    except Exception:
        return False

    for job in jobs:
        if job.status not in (JobStatus.PENDING, JobStatus.RUNNING):
            continue
        if job.type != JobType.MAINTENANCE:
            return True
    return False
