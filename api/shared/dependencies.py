"""
Shared FastAPI dependencies for nirs4all Studio API.

These dependencies factor out request-time preconditions that recur across
routers, so handlers can declare them as parameters instead of repeating the
same fetch-and-guard boilerplate.
"""
from __future__ import annotations

from fastapi import HTTPException

from ..workspace_manager import WorkspaceConfig, workspace_manager


def require_workspace() -> WorkspaceConfig:
    """Return the active workspace, or fail with 409 if none is selected.

    Use as a FastAPI dependency on handlers that operate on the current
    workspace::

        async def handler(..., workspace: WorkspaceConfig = Depends(require_workspace)):
            ...

    Returns:
        The active :class:`WorkspaceConfig`.

    Raises:
        HTTPException: 409 when no workspace is currently selected.
    """
    workspace = workspace_manager.get_current_workspace()
    if not workspace:
        raise HTTPException(status_code=409, detail="No workspace selected")
    return workspace
