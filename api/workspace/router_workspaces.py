"""Core workspace CRUD routes: current workspace, create/list/recent,
export/import, remove, and the by-ID lookup/update routes.
"""

import asyncio
import json
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from ..shared.logger import get_logger
from ..workspace_manager import workspace_manager
from ._shared import _invalidate_results_caches
from .models import (
    CreateWorkspaceRequest,
    ExportWorkspaceRequest,
    ImportWorkspaceRequest,
    SetWorkspaceRequest,
    WorkspaceInfo,
    WorkspaceListResponse,
    WorkspaceResponse,
)

logger = get_logger(__name__)

router = APIRouter()


@router.get("/workspace", response_model=WorkspaceResponse)
async def get_workspace():
    """Get the current workspace and its datasets."""
    try:
        workspace_config = workspace_manager.get_current_workspace()

        if not workspace_config:
            return WorkspaceResponse(workspace=None, datasets=[])

        return WorkspaceResponse(
            workspace=workspace_config.to_dict(), datasets=workspace_config.datasets
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get workspace: {str(e)}")


@router.post("/workspace/select")
async def select_workspace(request: SetWorkspaceRequest):
    """Set the current workspace."""
    try:
        workspace_config = await asyncio.to_thread(workspace_manager.set_workspace, request.path)
        return {
            "success": True,
            "message": f"Workspace set to {request.path}",
            "workspace": workspace_config.to_dict(),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to set workspace: {str(e)}"
        )


@router.post("/workspace/reload")
async def reload_workspace():
    """Reload the workspace configuration from disk.

    This is useful when the workspace.json file may have been modified
    externally or to ensure the in-memory state matches the disk state.
    """
    try:
        workspace_config = workspace_manager.reload_workspace()

        if not workspace_config:
            return {
                "success": False,
                "message": "No workspace is currently selected",
                "workspace": None,
            }

        return {
            "success": True,
            "message": "Workspace configuration reloaded from disk",
            "workspace": workspace_config.to_dict(),
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to reload workspace: {str(e)}"
        )


@router.get("/workspace/paths")
async def get_workspace_paths():
    """Get workspace-related paths."""
    try:
        results_path = workspace_manager.get_results_path()
        pipelines_path = workspace_manager.get_pipelines_path()

        return {"results_path": results_path, "pipelines_path": pipelines_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get paths: {str(e)}")


@router.post("/workspace/create", response_model=WorkspaceInfo)
async def create_workspace(request: CreateWorkspaceRequest):
    """
    Create a new workspace.

    Creates a workspace directory with the standard folder structure:
    - results/
    - pipelines/
    - models/
    - predictions/
    - workspace.json (configuration file)
    """
    try:
        workspace_path = Path(request.path)

        # Create directory if requested and it doesn't exist
        if request.create_dir:
            workspace_path.mkdir(parents=True, exist_ok=True)
        elif not workspace_path.exists():
            raise HTTPException(
                status_code=400,
                detail=f"Workspace path does not exist: {request.path}",
            )

        if not workspace_path.is_dir():
            raise HTTPException(
                status_code=400,
                detail=f"Workspace path is not a directory: {request.path}",
            )

        # Check if workspace already exists
        config_file = workspace_path / "workspace.json"
        if config_file.exists():
            raise HTTPException(
                status_code=409,
                detail="Workspace already exists at this path",
            )

        # Create workspace structure (both modern and legacy dirs)
        (workspace_path / "runs").mkdir(exist_ok=True)
        (workspace_path / "exports").mkdir(exist_ok=True)
        (workspace_path / "library").mkdir(exist_ok=True)
        (workspace_path / "library" / "templates").mkdir(exist_ok=True)
        (workspace_path / "library" / "trained").mkdir(exist_ok=True)
        (workspace_path / "results").mkdir(exist_ok=True)
        (workspace_path / "pipelines").mkdir(exist_ok=True)
        (workspace_path / "models").mkdir(exist_ok=True)
        (workspace_path / "predictions").mkdir(exist_ok=True)

        # Create workspace config
        now = datetime.now().isoformat()
        workspace_config = {
            "path": str(workspace_path.resolve()),
            "name": request.name,
            "description": request.description,
            "created_at": now,
            "last_accessed": now,
            "datasets": [],
            "pipelines": [],
            "groups": [],
        }

        # Save workspace config
        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(workspace_config, f, indent=2)

        # Link workspace internally (bypasses validation since we just created it)
        workspace_manager.link_workspace_internal(str(workspace_path.resolve()), request.name, is_new=True)

        return WorkspaceInfo(
            path=str(workspace_path.resolve()),
            name=request.name,
            created_at=now,
            last_accessed=now,
            num_datasets=0,
            num_pipelines=0,
            description=request.description,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to create workspace: {str(e)}"
        )


@router.get("/workspace/list", response_model=WorkspaceListResponse)
async def list_workspaces():
    """
    List all known workspaces.

    Returns all workspaces that have been accessed recently or are
    registered in the global configuration.
    """
    try:
        workspaces = workspace_manager.list_workspaces()

        return WorkspaceListResponse(
            workspaces=[
                WorkspaceInfo(
                    path=ws.get("path", ""),
                    name=ws.get("name", Path(ws.get("path", "")).name),
                    created_at=ws.get("created_at", ""),
                    last_accessed=ws.get("last_accessed", ""),
                    num_datasets=ws.get("num_datasets", 0),
                    num_pipelines=ws.get("num_pipelines", 0),
                    description=ws.get("description"),
                )
                for ws in workspaces
            ],
            total=len(workspaces),
        )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to list workspaces: {str(e)}"
        )


@router.get("/workspace/recent", response_model=WorkspaceListResponse)
async def get_recent_workspaces(limit: int = 10):
    """
    Get recently accessed workspaces.

    Returns the most recently accessed workspaces, sorted by access time.
    """
    try:
        recent = workspace_manager.get_recent_workspaces(limit=limit)

        return WorkspaceListResponse(
            workspaces=[
                WorkspaceInfo(
                    path=ws.get("path", ""),
                    name=ws.get("name", Path(ws.get("path", "")).name),
                    created_at=ws.get("created_at", ""),
                    last_accessed=ws.get("last_accessed", ""),
                    num_datasets=ws.get("num_datasets", 0),
                    num_pipelines=ws.get("num_pipelines", 0),
                    description=ws.get("description"),
                )
                for ws in recent
            ],
            total=len(recent),
        )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get recent workspaces: {str(e)}"
        )


def _build_workspace_archive(workspace: Any, request: ExportWorkspaceRequest) -> dict[str, Any]:
    """Build the export zip archive (blocking; runs in a worker thread)."""
    workspace_path = Path(workspace.path)
    output_path = Path(request.output_path)

    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Create the archive
    exported_items = []
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        # Always include workspace.json
        config_file = workspace_path / "workspace.json"
        if config_file.exists():
            zf.write(config_file, "workspace.json")
            exported_items.append("workspace.json")

        # Include pipelines directory
        pipelines_dir = workspace_path / "pipelines"
        if pipelines_dir.exists():
            for file in pipelines_dir.glob("**/*"):
                if file.is_file():
                    arcname = str(file.relative_to(workspace_path))
                    zf.write(file, arcname)
                    exported_items.append(arcname)

        # Include results if requested
        if request.include_results:
            results_dir = workspace_path / "results"
            if results_dir.exists():
                for file in results_dir.glob("**/*"):
                    if file.is_file():
                        arcname = str(file.relative_to(workspace_path))
                        zf.write(file, arcname)
                        exported_items.append(arcname)

            predictions_dir = workspace_path / "predictions"
            if predictions_dir.exists():
                for file in predictions_dir.glob("**/*"):
                    if file.is_file():
                        arcname = str(file.relative_to(workspace_path))
                        zf.write(file, arcname)
                        exported_items.append(arcname)

        # Include models if requested
        if request.include_models:
            models_dir = workspace_path / "models"
            if models_dir.exists():
                for file in models_dir.glob("**/*"):
                    if file.is_file():
                        arcname = str(file.relative_to(workspace_path))
                        zf.write(file, arcname)
                        exported_items.append(arcname)

        # Include datasets if requested (may be large!)
        if request.include_datasets:
            for dataset_info in workspace.datasets:
                dataset_path = Path(dataset_info.get("path", ""))
                if dataset_path.exists() and dataset_path.is_dir():
                    for file in dataset_path.glob("**/*"):
                        if file.is_file():
                            arcname = f"datasets/{dataset_path.name}/{file.name}"
                            zf.write(file, arcname)
                            exported_items.append(arcname)

    # Get archive size
    archive_size = output_path.stat().st_size

    return {
        "success": True,
        "output_path": str(output_path),
        "archive_size_bytes": archive_size,
        "items_exported": len(exported_items),
        "message": f"Exported {len(exported_items)} items to {output_path}",
    }


@router.post("/workspace/export")
async def export_workspace(request: ExportWorkspaceRequest):
    """
    Export the current workspace to a zip archive.

    Creates a portable archive containing the workspace configuration,
    pipelines, and optionally models and datasets.
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        return await asyncio.to_thread(_build_workspace_archive, workspace, request)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to export workspace: {str(e)}"
        )


@router.delete("/workspace/remove")
async def remove_workspace_from_list(path: str):
    """
    Remove a workspace from the known workspaces list.

    This does not delete the workspace files, only removes it from tracking.
    """
    try:
        success = workspace_manager.remove_from_recent(path)
        return {
            "success": success,
            "message": "Workspace removed from list" if success else "Workspace not found in list",
        }

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to remove workspace: {str(e)}"
        )


def _extract_workspace_archive(request: ImportWorkspaceRequest) -> dict[str, Any]:
    """Extract an imported workspace archive (blocking; runs in a worker thread)."""
    destination_path = Path(request.destination_path)
    destination_path.mkdir(parents=True, exist_ok=True)

    # Extract archive
    items_imported = 0
    with zipfile.ZipFile(Path(request.archive_path), "r") as zf:
        for item in zf.namelist():
            zf.extract(item, destination_path)
            items_imported += 1

    # Load workspace config if exists, or create one
    config_file = destination_path / "workspace.json"
    workspace_name = request.workspace_name or destination_path.name
    now = datetime.now().isoformat()

    if config_file.exists():
        with open(config_file, encoding="utf-8") as f:
            config = json.load(f)
            workspace_name = config.get("name", workspace_name)
            # Update path to new location
            config["path"] = str(destination_path.resolve())
            config["last_accessed"] = now
        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
    else:
        # Create a new workspace config
        config = {
            "path": str(destination_path.resolve()),
            "name": workspace_name,
            "created_at": now,
            "last_accessed": now,
            "datasets": [],
            "pipelines": [],
            "groups": [],
        }
        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)

    # Add to recent workspaces
    workspace_manager.add_to_recent(str(destination_path.resolve()), workspace_name)

    return {
        "success": True,
        "workspace_path": str(destination_path.resolve()),
        "workspace_name": workspace_name,
        "items_imported": items_imported,
        "message": f"Imported {items_imported} items to {destination_path}",
    }


@router.post("/workspace/import")
async def import_workspace(request: ImportWorkspaceRequest):
    """
    Import a workspace from a zip archive.

    Extracts the archive to the specified destination and registers
    the workspace.
    """
    try:
        archive_path = Path(request.archive_path)
        if not archive_path.exists():
            raise HTTPException(
                status_code=400,
                detail=f"Archive file not found: {request.archive_path}",
            )

        if not zipfile.is_zipfile(archive_path):
            raise HTTPException(
                status_code=400,
                detail="Invalid archive file format",
            )

        result = await asyncio.to_thread(_extract_workspace_archive, request)

        # Importing a workspace can introduce new store contents under any
        # registered workspace_id. Drop all results caches to avoid serving
        # stale data; the file-signature backstop would also catch this.
        _invalidate_results_caches(None)

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to import workspace: {str(e)}"
        )


# ----------------------- Workspace by ID routes (must be last due to path parameter) -----------------------


@router.get("/workspace/{workspace_id}", response_model=WorkspaceInfo)
async def get_workspace_info(workspace_id: str):
    """
    Get workspace information by ID.

    The workspace_id can be the base64-encoded path or the workspace name.
    """
    try:
        import base64

        # Try to decode workspace_id as base64 path
        try:
            workspace_path = base64.urlsafe_b64decode(workspace_id.encode()).decode()
        except Exception:
            # Not base64 - try to find by name
            workspace_path = workspace_manager.find_workspace_by_name(workspace_id)

        if not workspace_path:
            raise HTTPException(status_code=404, detail="Workspace not found")

        config = workspace_manager.load_workspace_config(workspace_path)
        if not config:
            raise HTTPException(status_code=404, detail="Workspace configuration not found")

        return WorkspaceInfo(
            path=config.get("path", workspace_path),
            name=config.get("name", Path(workspace_path).name),
            created_at=config.get("created_at", ""),
            last_accessed=config.get("last_accessed", ""),
            num_datasets=len(config.get("datasets", [])),
            num_pipelines=len(config.get("pipelines", [])),
            description=config.get("description"),
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get workspace info: {str(e)}"
        )


@router.put("/workspace/{workspace_id}")
async def update_workspace(workspace_id: str, updates: dict[str, Any]):
    """
    Update workspace configuration.

    Allows updating the name, description, and other metadata.
    """
    try:
        import base64

        # Try to decode workspace_id as base64 path
        try:
            workspace_path = base64.urlsafe_b64decode(workspace_id.encode()).decode()
        except Exception:
            workspace_path = workspace_manager.find_workspace_by_name(workspace_id)

        if not workspace_path:
            raise HTTPException(status_code=404, detail="Workspace not found")

        success = workspace_manager.update_workspace_config(workspace_path, updates)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to update workspace")

        return {"success": True, "message": "Workspace updated"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update workspace: {str(e)}"
        )
