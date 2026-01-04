"""
Workspace API routes for nirs4all webapp.

This module provides FastAPI routes for workspace management operations.

Phase 6 Implementation:
- Create workspace
- List workspaces (all and recent)
- Load/save workspace configuration
- Export workspace to archive
- Enhanced workspace management
"""

from datetime import datetime
from pathlib import Path
import json
import shutil
import zipfile
from typing import Dict, List, Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager, WorkspaceConfig


# ============= Request/Response Models =============


class CreateWorkspaceRequest(BaseModel):
    """Request model for creating a new workspace."""
    path: str = Field(..., description="Path to the workspace directory")
    name: str = Field(..., description="Display name for the workspace")
    description: Optional[str] = Field(None, description="Workspace description")
    create_dir: bool = Field(True, description="Create directory if it doesn't exist")


class SetWorkspaceRequest(BaseModel):
    """Request model for setting the current workspace."""
    path: str
    persist_global: bool = True


class LinkDatasetRequest(BaseModel):
    """Request model for linking a dataset."""
    path: str
    config: Optional[Dict[str, Any]] = None


class ExportWorkspaceRequest(BaseModel):
    """Request model for exporting a workspace."""
    output_path: str = Field(..., description="Path for the exported archive")
    include_datasets: bool = Field(False, description="Include dataset files (may be large)")
    include_models: bool = Field(True, description="Include trained models")
    include_results: bool = Field(True, description="Include results and predictions")


class WorkspaceResponse(BaseModel):
    """Response model for workspace details."""
    workspace: Optional[Dict[str, Any]]
    datasets: List[Dict[str, Any]]


class WorkspaceInfo(BaseModel):
    """Summary info for a workspace."""
    path: str
    name: str
    created_at: str
    last_accessed: str
    num_datasets: int = 0
    num_pipelines: int = 0
    description: Optional[str] = None


class WorkspaceListResponse(BaseModel):
    """Response model for listing workspaces."""
    workspaces: List[WorkspaceInfo]
    total: int


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
        workspace_config = workspace_manager.set_workspace(request.path)
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


@router.post("/datasets/link")
async def link_dataset(request: LinkDatasetRequest):
    """Link a dataset to the current workspace."""
    try:
        dataset_info = workspace_manager.link_dataset(request.path, config=request.config)
        return {
            "success": True,
            "message": "Dataset linked successfully",
            "dataset": dataset_info,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to link dataset: {str(e)}"
        )


@router.delete("/datasets/{dataset_id}")
async def unlink_dataset(dataset_id: str):
    """Unlink a dataset from the current workspace."""
    try:
        success = workspace_manager.unlink_dataset(dataset_id)
        if not success:
            raise HTTPException(status_code=404, detail="Dataset not found")

        return {"success": True, "message": "Dataset unlinked successfully"}
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to unlink dataset: {str(e)}"
        )


@router.post("/datasets/{dataset_id}/refresh")
async def refresh_dataset(dataset_id: str):
    """Refresh dataset information by reloading it."""
    try:
        dataset_info = workspace_manager.refresh_dataset(dataset_id)
        if not dataset_info:
            raise HTTPException(
                status_code=404, detail="Dataset not found or refresh failed"
            )

        return {
            "success": True,
            "message": "Dataset refreshed successfully",
            "dataset": dataset_info,
        }
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to refresh dataset: {str(e)}"
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


# ----------------------- Groups management -----------------------


class CreateGroupRequest(BaseModel):
    name: str


@router.get("/workspace/groups")
async def get_groups():
    try:
        groups = workspace_manager.get_groups()
        return {"groups": groups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list groups: {str(e)}")


@router.post("/workspace/groups")
async def create_group(req: CreateGroupRequest):
    try:
        grp = workspace_manager.create_group(req.name)
        return {"success": True, "group": grp}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to create group: {str(e)}"
        )


@router.put("/workspace/groups/{group_id}")
async def rename_group(group_id: str, req: CreateGroupRequest):
    try:
        ok = workspace_manager.rename_group(group_id, req.name)
        if not ok:
            raise HTTPException(status_code=404, detail="Group not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to rename group: {str(e)}"
        )


@router.delete("/workspace/groups/{group_id}")
async def delete_group(group_id: str):
    try:
        ok = workspace_manager.delete_group(group_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Group not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete group: {str(e)}"
        )


@router.post("/workspace/groups/{group_id}/datasets")
async def add_dataset_to_group(group_id: str, body: Dict[str, Any]):
    try:
        dataset_id = body.get("dataset_id")
        if not dataset_id:
            raise HTTPException(status_code=400, detail="dataset_id required")
        ok = workspace_manager.add_dataset_to_group(group_id, dataset_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Group not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to add dataset to group: {str(e)}"
        )


@router.delete("/workspace/groups/{group_id}/datasets/{dataset_id}")
async def remove_dataset_from_group(group_id: str, dataset_id: str):
    try:
        ok = workspace_manager.remove_dataset_from_group(group_id, dataset_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Group not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to remove dataset from group: {str(e)}"
        )


# ----------------------- Additional Workspace Management (Phase 6) -----------------------


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

        # Create workspace structure
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

        # Add to recent workspaces
        workspace_manager.add_to_recent(str(workspace_path.resolve()), request.name)

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
async def update_workspace(workspace_id: str, updates: Dict[str, Any]):
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


# ----------------------- Custom Nodes API (Phase 5) -----------------------


class CustomNodeDefinition(BaseModel):
    """Definition of a custom node."""
    id: str = Field(..., description="Unique identifier (e.g., 'custom.my_transform')")
    label: str = Field(..., description="Display name for the node")
    category: str = Field("custom", description="Category in the palette")
    description: Optional[str] = Field(None, description="Node description")
    classPath: str = Field(..., description="Python class path (e.g., 'mypackage.MyTransform')")
    stepType: str = Field("processing", description="Step type: preprocessing, processing, model, etc.")
    parameters: List[Dict[str, Any]] = Field(default_factory=list, description="Parameter definitions")
    icon: Optional[str] = Field(None, description="Icon name for the node")
    color: Optional[str] = Field(None, description="Node color")


class ImportCustomNodesRequest(BaseModel):
    """Request to import custom nodes."""
    nodes: List[Dict[str, Any]] = Field(..., description="Nodes to import")
    overwrite: bool = Field(False, description="Overwrite existing nodes with same ID")


class CustomNodeSettingsRequest(BaseModel):
    """Request to update custom node settings."""
    enabled: bool = Field(True, description="Whether custom nodes are enabled")
    allowedPackages: List[str] = Field(
        default_factory=lambda: ["nirs4all", "sklearn", "scipy", "numpy", "pandas"],
        description="Allowed Python packages for classPath"
    )
    requireApproval: bool = Field(False, description="Require admin approval for new nodes")
    allowUserNodes: bool = Field(True, description="Allow users to create custom nodes")


@router.get("/workspace/custom-nodes")
async def get_custom_nodes():
    """Get all custom nodes for the current workspace."""
    try:
        nodes = workspace_manager.get_custom_nodes()
        settings = workspace_manager.get_custom_node_settings()
        return {
            "nodes": nodes,
            "settings": settings,
            "count": len(nodes),
        }
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get custom nodes: {str(e)}"
        )


@router.post("/workspace/custom-nodes")
async def add_custom_node(node: CustomNodeDefinition):
    """Add a new custom node to the workspace."""
    try:
        result = workspace_manager.add_custom_node(node.model_dump())
        return {
            "success": True,
            "message": "Custom node added successfully",
            "node": result,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to add custom node: {str(e)}"
        )


@router.put("/workspace/custom-nodes/{node_id}")
async def update_custom_node(node_id: str, node: CustomNodeDefinition):
    """Update an existing custom node."""
    try:
        result = workspace_manager.update_custom_node(node_id, node.model_dump())
        if not result:
            raise HTTPException(status_code=404, detail="Custom node not found")
        return {
            "success": True,
            "message": "Custom node updated successfully",
            "node": result,
        }
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update custom node: {str(e)}"
        )


@router.delete("/workspace/custom-nodes/{node_id}")
async def delete_custom_node(node_id: str):
    """Delete a custom node from the workspace."""
    try:
        success = workspace_manager.delete_custom_node(node_id)
        if not success:
            raise HTTPException(status_code=404, detail="Custom node not found")
        return {
            "success": True,
            "message": "Custom node deleted successfully",
        }
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete custom node: {str(e)}"
        )


@router.post("/workspace/custom-nodes/import")
async def import_custom_nodes(request: ImportCustomNodesRequest):
    """Import custom nodes from an external source."""
    try:
        result = workspace_manager.import_custom_nodes(
            request.nodes,
            overwrite=request.overwrite
        )
        return {
            "success": True,
            "message": f"Imported {result['imported']} nodes",
            **result,
        }
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to import custom nodes: {str(e)}"
        )


@router.get("/workspace/custom-nodes/export")
async def export_custom_nodes():
    """Export all custom nodes for the workspace."""
    try:
        nodes = workspace_manager.get_custom_nodes()
        settings = workspace_manager.get_custom_node_settings()
        return {
            "success": True,
            "nodes": nodes,
            "settings": settings,
            "exportedAt": datetime.now().isoformat(),
            "version": "1.0",
        }
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to export custom nodes: {str(e)}"
        )


@router.get("/workspace/custom-nodes/settings")
async def get_custom_node_settings():
    """Get custom node settings for the workspace."""
    try:
        settings = workspace_manager.get_custom_node_settings()
        return {
            "success": True,
            "settings": settings,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get custom node settings: {str(e)}"
        )


@router.put("/workspace/custom-nodes/settings")
async def update_custom_node_settings(request: CustomNodeSettingsRequest):
    """Update custom node settings for the workspace."""
    try:
        success = workspace_manager.save_custom_node_settings(request.model_dump())
        if not success:
            raise HTTPException(status_code=400, detail="No workspace selected")
        return {
            "success": True,
            "message": "Settings updated successfully",
            "settings": request.model_dump(),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update custom node settings: {str(e)}"
        )
