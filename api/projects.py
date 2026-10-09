"""Project management API endpoints."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    color: str = "#14b8a6"


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None


def _get_store_adapter():
    """Get a StoreAdapter for the active workspace."""
    from api.workspace_manager import workspace_manager
    ws = workspace_manager.get_active_workspace()
    if ws is None:
        raise HTTPException(status_code=400, detail="No active workspace")
    try:
        from api.store_adapter import StoreAdapter
        return StoreAdapter(Path(ws.path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open workspace store: {e}")


@router.get("")
async def list_projects():
    """List all projects in the active workspace."""
    adapter = _get_store_adapter()
    try:
        df = adapter.store._fetch_pl("SELECT * FROM projects ORDER BY created_at DESC")
        projects = []
        for row in df.iter_rows(named=True):
            p = dict(row)
            for ts in ("created_at", "updated_at"):
                if isinstance(p.get(ts), datetime):
                    p[ts] = p[ts].isoformat()
            projects.append(p)
        return {"projects": projects, "total": len(projects)}
    finally:
        adapter.close()


@router.post("")
async def create_project(body: ProjectCreate):
    """Create a new project."""
    adapter = _get_store_adapter()
    try:
        # Check for duplicate name
        existing = adapter.store._fetch_one(
            "SELECT * FROM projects WHERE name = $1", [body.name]
        )
        if existing is not None:
            raise HTTPException(status_code=409, detail=f"Project '{body.name}' already exists")
        project_id = str(uuid4())
        adapter.store._fetch_pl(
            "INSERT INTO projects (project_id, name, description, color) VALUES ($1, $2, $3, $4)",
            [project_id, body.name, body.description, body.color],
        )
        return {"project_id": project_id, "name": body.name}
    finally:
        adapter.close()


@router.put("/{project_id}")
async def update_project(project_id: str, body: ProjectUpdate):
    """Update an existing project."""
    adapter = _get_store_adapter()
    try:
        existing = adapter.store._fetch_one(
            "SELECT * FROM projects WHERE project_id = $1", [project_id]
        )
        if existing is None:
            raise HTTPException(status_code=404, detail="Project not found")
        name = body.name if body.name is not None else existing.get("name", "")
        description = body.description if body.description is not None else existing.get("description", "")
        color = body.color if body.color is not None else existing.get("color", "#14b8a6")
        adapter.store._fetch_pl(
            "UPDATE projects SET name = $2, description = $3, color = $4, updated_at = current_timestamp WHERE project_id = $1",
            [project_id, name, description, color],
        )
        return {"success": True, "project_id": project_id}
    finally:
        adapter.close()


@router.delete("/{project_id}")
async def delete_project(project_id: str):
    """Delete a project."""
    adapter = _get_store_adapter()
    try:
        existing = adapter.store._fetch_one(
            "SELECT * FROM projects WHERE project_id = $1", [project_id]
        )
        if existing is None:
            raise HTTPException(status_code=404, detail="Project not found")
        adapter.store._fetch_pl(
            "DELETE FROM projects WHERE project_id = $1", [project_id]
        )
        return {"success": True, "project_id": project_id}
    finally:
        adapter.close()
