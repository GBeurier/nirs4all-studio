"""
Runtime path lookup and pip-freeze config-snapshot CRUD.

Captures / lists / restores / deletes pip-freeze snapshots of the active
runtime. Shared state (``venv_manager``, ``_dependencies_cache``, the runtime
guards) is reached through the ``api.updates`` package so the test suite can
patch ``api.updates.venv_manager`` and have it take effect here.
"""

from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api import updates as _u

from .manager import APP_AUTHOR, APP_NAME

router = APIRouter()


@router.get("/runtime/path")
@router.get("/venv/path")
async def get_runtime_path() -> dict[str, Any]:
    """
    Get the current runtime root path.
    """
    runtime_info = _u.venv_manager.get_venv_info()

    return {
        "current_path": str(_u.venv_manager.venv_path),
        "is_valid": runtime_info.is_valid,
        "exists": runtime_info.exists,
    }


# ============= Working Config Snapshot =============

SNAPSHOTS_DIR_NAME = "config_snapshots"


def _get_snapshots_dir() -> Path:
    """Get the directory for storing config snapshots."""
    from api import updates as _updates_pkg

    app_data = Path(_updates_pkg._user_data_dir(APP_NAME, APP_AUTHOR))
    snapshots_dir = app_data / SNAPSHOTS_DIR_NAME
    snapshots_dir.mkdir(parents=True, exist_ok=True)
    return snapshots_dir


@router.get("/runtime/snapshots")
@router.get("/venv/snapshots")
async def list_snapshots() -> dict[str, Any]:
    """List all saved config snapshots."""
    snapshots_dir = _get_snapshots_dir()
    snapshots = []

    for f in sorted(snapshots_dir.glob("*.txt"), key=lambda p: p.stat().st_mtime, reverse=True):
        stat = f.stat()
        # Read first line for metadata (comment with label)
        label = f.stem
        try:
            first_line = f.read_text(encoding="utf-8").split("\n", 1)[0]
            if first_line.startswith("# "):
                label = first_line[2:].strip()
        except Exception:
            pass

        snapshots.append({
            "name": f.stem,
            "label": label,
            "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "size_bytes": stat.st_size,
        })

    return {"snapshots": snapshots}


class SnapshotCreateRequest(BaseModel):
    """Request to create a config snapshot."""
    label: str | None = None


@router.post("/runtime/snapshots")
@router.post("/venv/snapshots")
async def create_snapshot(request: SnapshotCreateRequest) -> dict[str, Any]:
    """
    Save the current pip freeze output as a config snapshot.

    This captures all installed packages and versions in the current runtime.
    """
    _u._ensure_runtime_is_valid()

    # Run pip freeze
    freeze_output = _u.venv_manager.run_pip_command(["freeze"])
    if freeze_output is None:
        raise HTTPException(status_code=500, detail="Failed to run pip freeze")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    label = request.label or f"Snapshot {timestamp}"
    filename = f"snapshot_{timestamp}.txt"

    snapshots_dir = _get_snapshots_dir()
    snapshot_path = snapshots_dir / filename

    content = f"# {label}\n{freeze_output}"
    snapshot_path.write_text(content, encoding="utf-8")

    return {
        "success": True,
        "name": snapshot_path.stem,
        "label": label,
        "created_at": datetime.now().isoformat(),
    }


@router.post("/runtime/snapshots/{name}/restore")
@router.post("/venv/snapshots/{name}/restore")
async def restore_snapshot(name: str) -> dict[str, Any]:
    """
    Restore a config snapshot by running pip install -r on the snapshot file.

    This will install all packages at the exact versions captured in the snapshot.
    """
    _u._ensure_runtime_mutable()
    _u._ensure_runtime_is_valid()

    snapshots_dir = _get_snapshots_dir()
    snapshot_path = snapshots_dir / f"{name}.txt"

    if not snapshot_path.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found")

    # Filter out comment lines for pip install
    lines = snapshot_path.read_text(encoding="utf-8").strip().split("\n")
    requirements = [line for line in lines if line.strip() and not line.startswith("#")]
    if not requirements:
        raise HTTPException(status_code=400, detail="Snapshot is empty")

    # Write a temp requirements file without comments
    temp_req = snapshots_dir / f"_restore_{name}.txt"
    temp_req.write_text("\n".join(requirements), encoding="utf-8")

    try:
        output = _u.venv_manager.run_pip_command(["install", "-r", str(temp_req)])
        if output is None:
            raise HTTPException(status_code=500, detail="pip install failed")
    finally:
        temp_req.unlink(missing_ok=True)

    # Invalidate caches
    _u._dependencies_cache.invalidate()

    return {
        "success": True,
        "message": f"Restored snapshot '{name}' successfully",
    }


@router.delete("/runtime/snapshots/{name}")
@router.delete("/venv/snapshots/{name}")
async def delete_snapshot(name: str) -> dict[str, Any]:
    """Delete a config snapshot."""
    snapshots_dir = _get_snapshots_dir()
    snapshot_path = snapshots_dir / f"{name}.txt"

    if not snapshot_path.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found")

    snapshot_path.unlink()
    return {"success": True, "message": f"Snapshot '{name}' deleted"}
