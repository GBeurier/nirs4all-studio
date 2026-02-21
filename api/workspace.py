"""
Workspace API routes for nirs4all webapp.

This module provides FastAPI routes for workspace management operations.

Phase 8 Implementation:
- Clear separation between App Config folder and Workspace folders
- Global dataset management (accessible across all workspaces)
- Linked workspace management for multiple nirs4all workspaces
- Default workspace auto-creation in current directory
- Workspace discovery for runs, exports, predictions, templates
"""

import asyncio
import inspect
import json
import shutil
import time
import zipfile
from dataclasses import asdict, is_dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple, Union

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .workspace_manager import workspace_manager, WorkspaceScanner
from .app_config import app_config
from .shared.logger import get_logger

logger = get_logger(__name__)
from .jobs import job_manager, JobType, JobStatus
from .store_adapter import StoreAdapter

# WebSocket notifications (optional)
try:
    from websocket import (
        notify_maintenance_started,
        notify_maintenance_progress,
        notify_maintenance_completed,
        notify_maintenance_failed,
    )
    WS_AVAILABLE = True
except Exception:
    notify_maintenance_started = None  # type: ignore[assignment]
    notify_maintenance_progress = None  # type: ignore[assignment]
    notify_maintenance_completed = None  # type: ignore[assignment]
    notify_maintenance_failed = None  # type: ignore[assignment]
    WS_AVAILABLE = False

# Optional nirs4all storage integrations
try:
    from nirs4all.pipeline.storage import WorkspaceStore
    STORE_AVAILABLE = True
except ImportError:
    WorkspaceStore = None  # type: ignore[assignment, misc]
    STORE_AVAILABLE = False

try:
    from nirs4all.data.predictions import Predictions
    PREDICTIONS_AVAILABLE = True
except ImportError:
    Predictions = None  # type: ignore[assignment, misc]
    PREDICTIONS_AVAILABLE = False

try:
    from nirs4all.pipeline.storage.migration import migrate_arrays_to_parquet
    MIGRATION_AVAILABLE = True
except ImportError:
    migrate_arrays_to_parquet = None  # type: ignore[assignment, misc]
    MIGRATION_AVAILABLE = False


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


# ============= Global Dataset Management =============


@router.get("/datasets")
async def list_datasets():
    """List all globally linked datasets.

    Datasets are stored globally and accessible across all workspaces.
    """
    try:
        datasets = app_config.get_datasets()
        groups = app_config.get_dataset_groups()
        return {
            "datasets": [d.to_dict() for d in datasets],
            "groups": [g.to_dict() for g in groups],
            "total": len(datasets),
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to list datasets: {str(e)}"
        )


@router.post("/datasets/link")
async def link_dataset(request: LinkDatasetRequest):
    """Link a dataset globally (accessible across all workspaces)."""
    try:
        dataset_info = workspace_manager.link_dataset(request.path, config=request.config)

        # Try to populate num_samples, num_features, and targets from the actual dataset
        try:
            from .spectra import _build_nirs4all_config_from_stored

            nirs4all_config = _build_nirs4all_config_from_stored(dataset_info)
            if "train_x" in nirs4all_config:
                from nirs4all.data import DatasetConfigs

                dataset_configs = DatasetConfigs(nirs4all_config)
                datasets = dataset_configs.get_datasets()

                if datasets:
                    ds = datasets[0]
                    dataset_info["num_samples"] = ds.num_samples
                    dataset_info["num_features"] = ds.num_features
                    dataset_info["n_sources"] = ds.n_sources

                    # Non-critical metadata — failures here must not prevent saving core stats
                    try:
                        task_type_str = None
                        if ds.task_type:
                            task_type_str = str(ds.task_type)
                            if "." in task_type_str:
                                task_type_str = task_type_str.split(".")[-1].lower()
                        dataset_info["task_type"] = task_type_str

                        if ds.signal_types:
                            dataset_info["signal_types"] = [st.value for st in ds.signal_types]

                        # Detect/set targets if not already configured
                        config = dataset_info.get("config", {})
                        if "targets" not in config and ds._targets is not None:
                            target_columns = ds.target_columns if hasattr(ds, 'target_columns') else None
                            if target_columns:
                                detected_targets = [{"column": col, "type": task_type_str or "regression"} for col in target_columns]
                            else:
                                detected_targets = [{"column": "target", "type": task_type_str or "regression"}]
                            dataset_info["targets"] = detected_targets
                            if "config" not in dataset_info:
                                dataset_info["config"] = {}
                            dataset_info["config"]["targets"] = detected_targets
                        elif "targets" in config:
                            dataset_info["targets"] = config["targets"]

                        if dataset_info.get("targets") and not dataset_info.get("default_target"):
                            dataset_info["default_target"] = dataset_info["targets"][0].get("column")
                    except Exception as meta_err:
                        dataset_info["load_warning"] = f"Metadata detection partial failure: {meta_err}"

                    # Always persist core stats (num_samples, num_features) even if metadata detection failed
                    update_data = {
                        "num_samples": dataset_info.get("num_samples"),
                        "num_features": dataset_info.get("num_features"),
                        "n_sources": dataset_info.get("n_sources", 1),
                        "task_type": dataset_info.get("task_type"),
                        "signal_types": dataset_info.get("signal_types", []),
                        "targets": dataset_info.get("targets", []),
                        "default_target": dataset_info.get("default_target"),
                    }
                    if "config" in dataset_info:
                        update_data["config"] = dataset_info["config"]
                    workspace_manager.update_dataset(dataset_info["id"], update_data)
        except ImportError:
            pass
        except Exception as e:
            # Don't fail link if we can't populate extra info
            dataset_info["load_warning"] = str(e)

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
    """Unlink a dataset globally (does not delete files)."""
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


# ----------------------- Workspace Import (Phase 3) -----------------------


class ImportWorkspaceRequest(BaseModel):
    """Request model for importing a workspace from archive."""
    archive_path: str = Field(..., description="Path to the archive file")
    destination_path: str = Field(..., description="Path where workspace will be extracted")
    workspace_name: Optional[str] = Field(None, description="Name for the imported workspace")


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

        destination_path = Path(request.destination_path)
        destination_path.mkdir(parents=True, exist_ok=True)

        # Extract archive
        items_imported = 0
        with zipfile.ZipFile(archive_path, "r") as zf:
            for item in zf.namelist():
                zf.extract(item, destination_path)
                items_imported += 1

        # Load workspace config if exists, or create one
        config_file = destination_path / "workspace.json"
        workspace_name = request.workspace_name or destination_path.name
        now = datetime.now().isoformat()

        if config_file.exists():
            with open(config_file, "r", encoding="utf-8") as f:
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

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to import workspace: {str(e)}"
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


# ----------------------- Workspace Statistics & Cache (Phase 5) -----------------------


class SpaceUsageItem(BaseModel):
    """Space usage for a category."""
    name: str = Field(..., description="Category name (results, models, etc.)")
    size_bytes: int = Field(0, description="Size in bytes")
    file_count: int = Field(0, description="Number of files")
    percentage: float = Field(0.0, description="Percentage of total workspace size")


class WorkspaceStatsResponse(BaseModel):
    """Response model for workspace statistics."""
    path: str = Field(..., description="Workspace path")
    name: str = Field(..., description="Workspace name")
    total_size_bytes: int = Field(0, description="Total workspace size in bytes")
    space_usage: List[SpaceUsageItem] = Field(default_factory=list, description="Breakdown by category")
    linked_datasets_count: int = Field(0, description="Number of linked datasets")
    linked_datasets_external_size: int = Field(0, description="Total size of external datasets")
    duckdb_size_bytes: int = Field(0, description="DuckDB metadata store size")
    parquet_arrays_size_bytes: int = Field(0, description="Total Parquet array files size")
    storage_mode: str = Field("unknown", description="Storage backend: migrated, legacy, new")
    created_at: str = Field(..., description="Workspace creation time")
    last_accessed: str = Field(..., description="Last access time")


class StorageStatusResponse(BaseModel):
    """Response model for workspace storage status."""
    storage_mode: str
    has_prediction_arrays_table: bool
    has_arrays_directory: bool
    migration_needed: bool


class MigrationRequest(BaseModel):
    """Request to migrate prediction arrays to Parquet."""
    dry_run: bool = Field(False, description="Run migration in dry-run mode")
    batch_size: Optional[int] = Field(None, description="Batch size for migration")


class MigrationJobResponse(BaseModel):
    """Response when a migration job is enqueued."""
    job_id: str


class MigrationStatusResponse(BaseModel):
    """Response for migration status."""
    migration_needed: bool
    storage_mode: str
    legacy_row_count: Optional[int] = None
    estimated_duration_seconds: Optional[int] = None


class MigrationReportResponse(BaseModel):
    """Migration report (dry run or completed)."""
    total_rows: int = 0
    rows_migrated: int = 0
    datasets_migrated: List[str] = Field(default_factory=list)
    verification_passed: bool = False
    verification_sample_size: int = 0
    verification_mismatches: int = 0
    duckdb_size_before: int = 0
    duckdb_size_after: int = 0
    parquet_total_size: int = 0
    duration_seconds: float = 0.0
    errors: List[str] = Field(default_factory=list)


class CompactRequest(BaseModel):
    dataset_name: Optional[str] = Field(None, description="Dataset name to compact (all if omitted)")


class CompactDatasetStats(BaseModel):
    rows_before: int = 0
    rows_after: int = 0
    rows_removed: int = 0
    bytes_before: int = 0
    bytes_after: int = 0


class CompactReport(BaseModel):
    datasets: Dict[str, CompactDatasetStats] = Field(default_factory=dict)


class CleanDeadLinksRequest(BaseModel):
    dry_run: bool = Field(False, description="Preview cleanup without deleting")


class CleanDeadLinksReport(BaseModel):
    metadata_orphans_removed: int = 0
    array_orphans_removed: int = 0


class RemoveBottomRequest(BaseModel):
    fraction: float = Field(..., ge=0.0, le=1.0)
    metric: Optional[str] = None
    partition: Optional[str] = None
    dataset_name: Optional[str] = None
    dry_run: bool = Field(False, description="Preview removal without deleting")


class RemoveBottomReport(BaseModel):
    removed: int = 0
    remaining: int = 0
    threshold_score: float = 0.0


class DatasetStorageInfo(BaseModel):
    name: str
    prediction_count: int = 0
    parquet_size_bytes: int = 0


class StorageHealthResponse(BaseModel):
    storage_mode: str
    migration_needed: bool
    duckdb_size_bytes: int = 0
    parquet_total_size_bytes: int = 0
    total_predictions: int = 0
    total_datasets: int = 0
    datasets: List[DatasetStorageInfo] = Field(default_factory=list)
    orphan_metadata_count: int = 0
    orphan_array_count: int = 0
    corrupt_files: List[str] = Field(default_factory=list)


class CleanCacheRequest(BaseModel):
    """Request model for cleaning cache."""
    clean_temp: bool = Field(True, description="Clean temporary files")
    clean_orphan_results: bool = Field(False, description="Clean results without associated runs")
    clean_old_predictions: bool = Field(False, description="Clean predictions older than threshold")
    days_threshold: int = Field(30, description="Age threshold for cleaning old files")


class CleanCacheResponse(BaseModel):
    """Response model for clean cache operation."""
    success: bool
    files_removed: int = Field(0, description="Number of files removed")
    bytes_freed: int = Field(0, description="Bytes freed")
    categories_cleaned: List[str] = Field(default_factory=list, description="Categories that were cleaned")


class DataLoadingDefaults(BaseModel):
    """Default settings for data loading."""
    delimiter: str = Field(";", description="Default CSV delimiter")
    decimal_separator: str = Field(".", description="Default decimal separator")
    has_header: bool = Field(True, description="Default header setting")
    header_unit: str = Field("nm", description="Default header unit (nm, cm-1, text, none, index)")
    signal_type: str = Field("auto", description="Default signal type")
    na_policy: str = Field("auto", description="Default NA handling policy")
    auto_detect: bool = Field(True, description="Enable auto-detection")


class GeneralSettings(BaseModel):
    """General UI settings."""
    theme: str = Field("system", description="Theme: light, dark, or system")
    ui_density: str = Field("comfortable", description="UI density: compact, comfortable, or spacious")
    reduce_animations: bool = Field(False, description="Reduce motion for accessibility")
    sidebar_collapsed: bool = Field(False, description="Whether sidebar is collapsed")
    language: str = Field("en", description="Interface language: en, fr, or de")


class WorkspaceSettingsResponse(BaseModel):
    """Response model for workspace settings."""
    data_loading_defaults: DataLoadingDefaults
    developer_mode: bool = Field(False, description="Developer mode enabled")
    cache_enabled: bool = Field(True, description="Cache enabled")
    general: Optional[GeneralSettings] = Field(None, description="General UI settings")


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


def _to_plain_dict(value: Any) -> Any:
    """Convert rich objects (dataclass/Pydantic) to plain JSON-serializable structures."""
    if is_dataclass(value):
        return {k: _to_plain_dict(v) for k, v in asdict(value).items()}
    if hasattr(value, "model_dump") and callable(getattr(value, "model_dump", None)):
        return _to_plain_dict(value.model_dump())  # type: ignore[no-any-return]
    if isinstance(value, dict):
        return {k: _to_plain_dict(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_plain_dict(v) for v in value]
    return value


def _get_storage_status_for_workspace(workspace_path: Path) -> dict[str, Any]:
    """Resolve storage mode/status for a workspace."""
    has_arrays_directory = (workspace_path / "arrays").exists()
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


def _get_legacy_arrays_row_count(workspace_path: Path) -> Optional[int]:
    """Count legacy rows in prediction_arrays if the table exists."""
    if not STORE_AVAILABLE:
        return None
    if not (workspace_path / "store.duckdb").exists():
        return None

    try:
        store = WorkspaceStore(workspace_path)
    except Exception:
        return None

    try:
        has_table = False
        try:
            table_df = store._fetch_pl(  # type: ignore[attr-defined]
                "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_name = 'prediction_arrays'"
            )
            if len(table_df) > 0:
                has_table = int(table_df.row(0, named=True).get("cnt", 0) or 0) > 0
        except Exception:
            has_table = False

        if not has_table:
            return None

        count_df = store._fetch_pl("SELECT COUNT(*) AS cnt FROM prediction_arrays")
        if len(count_df) == 0:
            return 0
        return int(count_df.row(0, named=True).get("cnt", 0) or 0)
    except Exception:
        return None
    finally:
        try:
            store.close()
        except Exception:
            pass


def _estimate_migration_duration_seconds(legacy_row_count: Optional[int]) -> Optional[int]:
    """Estimate migration time from row count using a conservative throughput heuristic."""
    if legacy_row_count is None:
        return None
    if legacy_row_count == 0:
        return 0
    rows_per_second = 10_000
    return max(1, int(legacy_row_count / rows_per_second))


def _run_async_notification(coro: Any) -> None:
    """Run an async notification from sync code safely."""
    if not coro:
        return
    try:
        asyncio.run(coro)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(coro)
        finally:
            loop.close()
    except Exception:
        pass


def _emit_maintenance_started(job_id: str, operation: str, details: dict[str, Any]) -> None:
    if WS_AVAILABLE and notify_maintenance_started is not None:
        _run_async_notification(notify_maintenance_started(job_id, operation, details))


def _emit_maintenance_progress(job_id: str, progress: float, message: str = "") -> None:
    if WS_AVAILABLE and notify_maintenance_progress is not None:
        _run_async_notification(notify_maintenance_progress(job_id, progress, message))


def _emit_maintenance_completed(job_id: str, operation: str, report: dict[str, Any]) -> None:
    if WS_AVAILABLE and notify_maintenance_completed is not None:
        _run_async_notification(notify_maintenance_completed(job_id, operation, report))


def _emit_maintenance_failed(job_id: str, operation: str, error: str) -> None:
    if WS_AVAILABLE and notify_maintenance_failed is not None:
        _run_async_notification(notify_maintenance_failed(job_id, operation, error))


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


def _prepare_predictions_instance(workspace_path: Path) -> tuple[Any, Any]:
    """Create a Predictions instance and optional store handle for maintenance operations."""
    if not PREDICTIONS_AVAILABLE:
        raise HTTPException(status_code=501, detail="nirs4all Predictions API is not available")

    store = None
    predictions_obj = None
    errors: list[str] = []

    if hasattr(Predictions, "from_workspace"):
        try:
            predictions_obj = Predictions.from_workspace(workspace_path)  # type: ignore[attr-defined]
            return predictions_obj, store
        except Exception as exc:
            errors.append(str(exc))

    if STORE_AVAILABLE:
        try:
            store = WorkspaceStore(workspace_path)
            predictions_obj = Predictions(store=store)
            return predictions_obj, store
        except Exception as exc:
            errors.append(str(exc))

    detail = (
        "Current nirs4all version does not expose a store-backed Predictions interface "
        "required for maintenance operations."
    )
    if errors:
        detail = f"{detail} Last error: {errors[-1]}"
    raise HTTPException(status_code=501, detail=detail)


def _invoke_predictions_method(workspace_path: Path, method_name: str, **kwargs: Any) -> dict[str, Any]:
    """Call a maintenance method on Predictions with compatibility fallbacks."""
    predictions_obj, store = _prepare_predictions_instance(workspace_path)
    try:
        method = getattr(predictions_obj, method_name, None)
        if method is None or not callable(method):
            raise HTTPException(
                status_code=501,
                detail=f"Current nirs4all version does not support '{method_name}'",
            )

        result = method(**kwargs)
        plain = _to_plain_dict(result)
        if isinstance(plain, dict):
            return plain
        return {"result": plain}
    finally:
        if store is not None:
            try:
                store.close()
            except Exception:
                pass


def _normalize_migration_report(report: Any) -> dict[str, Any]:
    """Map migration report object/dict to API response shape."""
    raw = _to_plain_dict(report)
    if not isinstance(raw, dict):
        raw = {}
    return {
        "total_rows": int(raw.get("total_rows", 0) or 0),
        "rows_migrated": int(raw.get("rows_migrated", 0) or 0),
        "datasets_migrated": list(raw.get("datasets_migrated", []) or []),
        "verification_passed": bool(raw.get("verification_passed", False)),
        "verification_sample_size": int(raw.get("verification_sample_size", 0) or 0),
        "verification_mismatches": int(raw.get("verification_mismatches", 0) or 0),
        "duckdb_size_before": int(raw.get("duckdb_size_before", 0) or 0),
        "duckdb_size_after": int(raw.get("duckdb_size_after", 0) or 0),
        "parquet_total_size": int(raw.get("parquet_total_size", 0) or 0),
        "duration_seconds": float(raw.get("duration_seconds", 0.0) or 0.0),
        "errors": [str(e) for e in (raw.get("errors", []) or [])],
    }


def _call_migrate_arrays_to_parquet(
    workspace_path: Path,
    *,
    dry_run: bool,
    batch_size: Optional[int] = None,
) -> dict[str, Any]:
    """Call migration function with backward-compatible signature handling."""
    if not MIGRATION_AVAILABLE or migrate_arrays_to_parquet is None:
        raise HTTPException(status_code=501, detail="Migration API is not available in current nirs4all version")

    kwargs: dict[str, Any] = {"dry_run": dry_run}
    if batch_size is not None:
        kwargs["batch_size"] = batch_size

    try:
        signature = inspect.signature(migrate_arrays_to_parquet)
        accepted = set(signature.parameters.keys())
        kwargs = {k: v for k, v in kwargs.items() if k in accepted}
    except Exception:
        pass

    report = migrate_arrays_to_parquet(workspace_path, **kwargs)  # type: ignore[misc]
    return _normalize_migration_report(report)


def _extract_orphan_counts(report: dict[str, Any]) -> tuple[int, int]:
    metadata_orphans = int(
        report.get("metadata_orphans_removed")
        or report.get("orphan_metadata_count")
        or report.get("metadata_orphans")
        or 0
    )
    array_orphans = int(
        report.get("array_orphans_removed")
        or report.get("orphan_array_count")
        or report.get("array_orphans")
        or 0
    )
    return metadata_orphans, array_orphans


def _extract_corrupt_files(report: dict[str, Any]) -> list[str]:
    candidates = [
        report.get("corrupt_files"),
        report.get("corrupted_files"),
        report.get("invalid_files"),
    ]
    for value in candidates:
        if isinstance(value, list):
            return [str(item) for item in value]
    return []


@router.get("/workspace/stats", response_model=WorkspaceStatsResponse)
async def get_workspace_stats():
    """
    Get workspace statistics including space usage breakdown.

    Returns detailed statistics about the workspace storage usage,
    broken down by category (results, models, predictions, pipelines).
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        workspace_path = Path(workspace.path)

        # Define categories and their directories
        categories = [
            ("results", workspace_path / "results"),
            ("models", workspace_path / "models"),
            ("predictions", workspace_path / "predictions"),
            ("Prediction arrays", workspace_path / "arrays"),
            ("pipelines", workspace_path / "pipelines"),
            ("cache", workspace_path / ".cache"),
            ("temp", workspace_path / ".tmp"),
        ]

        space_usage: List[SpaceUsageItem] = []
        total_workspace_size = 0
        duckdb_size_bytes = 0
        parquet_arrays_size_bytes = 0

        # Compute size for each category
        for name, directory in categories:
            size_bytes, file_count = _compute_directory_size(directory)
            space_usage.append(SpaceUsageItem(
                name=name,
                size_bytes=size_bytes,
                file_count=file_count,
                percentage=0.0,  # Will be calculated after total is known
            ))
            total_workspace_size += size_bytes
            if name == "Prediction arrays":
                parquet_arrays_size_bytes = size_bytes

        # Add workspace.json and other root files
        for file in workspace_path.iterdir():
            if file.is_file():
                try:
                    total_workspace_size += file.stat().st_size
                    if file.name == "store.duckdb":
                        duckdb_size_bytes = file.stat().st_size
                except (OSError, PermissionError):
                    pass

        # Calculate percentages
        if total_workspace_size > 0:
            for item in space_usage:
                item.percentage = round((item.size_bytes / total_workspace_size) * 100, 1)

        # Calculate external dataset sizes
        external_datasets_size = 0
        for dataset in workspace.datasets:
            dataset_path = Path(dataset.get("path", ""))
            if dataset_path.exists():
                size, _ = _compute_directory_size(dataset_path)
                external_datasets_size += size

        storage_status = _get_storage_status_for_workspace(workspace_path)

        return WorkspaceStatsResponse(
            path=str(workspace_path),
            name=workspace.name,
            total_size_bytes=total_workspace_size,
            space_usage=space_usage,
            linked_datasets_count=len(workspace.datasets),
            linked_datasets_external_size=external_datasets_size,
            duckdb_size_bytes=duckdb_size_bytes,
            parquet_arrays_size_bytes=parquet_arrays_size_bytes,
            storage_mode=str(storage_status.get("storage_mode", "unknown")),
            created_at=workspace.created_at,
            last_accessed=workspace.last_accessed,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get workspace stats: {str(e)}"
        )


@router.get("/workspace/storage-status", response_model=StorageStatusResponse)
async def get_workspace_storage_status():
    """Get current workspace storage backend status."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        status = _get_storage_status_for_workspace(Path(workspace.path))
        return StorageStatusResponse(**status)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get storage status: {str(e)}"
        )


@router.get("/workspace/migrate/status", response_model=MigrationStatusResponse)
async def get_workspace_migration_status():
    """Get migration status and rough migration estimate."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        workspace_path = Path(workspace.path)
        status = _get_storage_status_for_workspace(workspace_path)
        legacy_row_count = _get_legacy_arrays_row_count(workspace_path)
        estimated_duration_seconds = _estimate_migration_duration_seconds(legacy_row_count)

        return MigrationStatusResponse(
            migration_needed=bool(status.get("migration_needed", False)),
            storage_mode=str(status.get("storage_mode", "unknown")),
            legacy_row_count=legacy_row_count,
            estimated_duration_seconds=estimated_duration_seconds,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get migration status: {str(e)}"
        )


@router.post(
    "/workspace/migrate",
    response_model=Union[MigrationJobResponse, MigrationReportResponse],
)
async def migrate_workspace_arrays(request: MigrationRequest):
    """Migrate legacy prediction arrays to Parquet sidecar files."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        workspace_path = Path(workspace.path)

        if request.dry_run:
            report = _call_migrate_arrays_to_parquet(
                workspace_path,
                dry_run=True,
                batch_size=request.batch_size,
            )
            return MigrationReportResponse(**report)

        if _has_active_non_maintenance_jobs():
            raise HTTPException(
                status_code=409,
                detail="Another active job is running. Stop active jobs before migration.",
            )

        job_config = {
            "operation": "migration",
            "workspace_path": str(workspace_path),
            "dry_run": False,
            "batch_size": request.batch_size,
        }
        job = job_manager.create_job(JobType.MAINTENANCE, job_config)

        def _run_migration_task(job_obj: Any, progress_callback: Any) -> dict[str, Any]:
            operation = "migration"

            def _progress(value: float, message: str) -> None:
                try:
                    progress_callback(value, message)
                except Exception:
                    pass
                _emit_maintenance_progress(job_obj.id, value, message)

            _emit_maintenance_started(
                job_obj.id,
                operation,
                {
                    "workspace_path": str(workspace_path),
                    "batch_size": request.batch_size,
                },
            )
            _progress(2.0, "Preparing migration")
            try:
                report = _call_migrate_arrays_to_parquet(
                    workspace_path,
                    dry_run=False,
                    batch_size=request.batch_size,
                )
                _progress(100.0, "Migration completed")
                _emit_maintenance_completed(job_obj.id, operation, report)
                return {"operation": operation, "report": report}
            except Exception as exc:
                _emit_maintenance_failed(job_obj.id, operation, str(exc))
                raise

        job_manager.submit_job(job, _run_migration_task)
        return MigrationJobResponse(job_id=job.id)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to start migration: {str(e)}"
        )


@router.post("/workspace/compact", response_model=CompactReport)
async def compact_workspace_storage(request: CompactRequest):
    """Compact Parquet array files for one dataset or all datasets."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        if _has_active_non_maintenance_jobs():
            raise HTTPException(
                status_code=409,
                detail="Another active job is running. Stop active jobs before compaction.",
            )

        result = _invoke_predictions_method(
            Path(workspace.path),
            "compact",
            dataset_name=request.dataset_name,
        )

        if "datasets" not in result:
            dataset_key = request.dataset_name or "all"
            if all(k in result for k in ("rows_before", "rows_after", "rows_removed")):
                result = {"datasets": {dataset_key: result}}
            else:
                result = {"datasets": {}}

        return CompactReport(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compact storage: {str(e)}")


@router.post("/workspace/clean-dead-links", response_model=CleanDeadLinksReport)
async def clean_workspace_dead_links(request: CleanDeadLinksRequest):
    """Clean orphan metadata/array links in storage."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        if not request.dry_run and _has_active_non_maintenance_jobs():
            raise HTTPException(
                status_code=409,
                detail="Another active job is running. Stop active jobs before cleanup.",
            )

        result = _invoke_predictions_method(
            Path(workspace.path),
            "clean_dead_links",
            dry_run=request.dry_run,
        )
        return CleanDeadLinksReport(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clean dead links: {str(e)}")


@router.post("/workspace/remove-bottom", response_model=RemoveBottomReport)
async def remove_bottom_predictions(request: RemoveBottomRequest):
    """Remove the bottom fraction of predictions based on a ranking metric."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        if not request.dry_run and _has_active_non_maintenance_jobs():
            raise HTTPException(
                status_code=409,
                detail="Another active job is running. Stop active jobs before removal.",
            )

        result = _invoke_predictions_method(
            Path(workspace.path),
            "remove_bottom",
            fraction=request.fraction,
            metric=request.metric or "val_score",
            partition=request.partition or "val",
            dataset_name=request.dataset_name,
            dry_run=request.dry_run,
        )
        return RemoveBottomReport(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to remove bottom predictions: {str(e)}")


@router.get("/workspace/storage-health", response_model=StorageHealthResponse)
async def get_workspace_storage_health():
    """Combined storage health: integrity check + stats + migration status."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        workspace_path = Path(workspace.path)
        status = _get_storage_status_for_workspace(workspace_path)

        duckdb_size_bytes = 0
        duckdb_path = workspace_path / "store.duckdb"
        if duckdb_path.exists():
            try:
                duckdb_size_bytes = duckdb_path.stat().st_size
            except Exception:
                duckdb_size_bytes = 0

        arrays_path = workspace_path / "arrays"
        parquet_total_size_bytes, _ = _compute_directory_size(arrays_path)

        total_predictions = 0
        dataset_rows: list[dict[str, Any]] = []
        if STORE_AVAILABLE and duckdb_path.exists():
            try:
                store = WorkspaceStore(workspace_path)
                try:
                    total_df = store._fetch_pl("SELECT COUNT(*) AS cnt FROM predictions")
                    if len(total_df) > 0:
                        total_predictions = int(total_df.row(0, named=True).get("cnt", 0) or 0)

                    dataset_df = store._fetch_pl(
                        "SELECT dataset_name, COUNT(*) AS prediction_count "
                        "FROM predictions GROUP BY dataset_name ORDER BY dataset_name"
                    )
                    dataset_rows = list(dataset_df.iter_rows(named=True))
                finally:
                    store.close()
            except Exception:
                dataset_rows = []

        datasets: list[DatasetStorageInfo] = []
        parquet_by_dataset: dict[str, int] = {}
        if arrays_path.exists() and arrays_path.is_dir():
            for parquet_file in arrays_path.glob("*.parquet"):
                dataset_name = parquet_file.stem
                try:
                    parquet_by_dataset[dataset_name] = parquet_file.stat().st_size
                except Exception:
                    parquet_by_dataset[dataset_name] = 0

        seen_names: set[str] = set()
        for row in dataset_rows:
            ds_name = str(row.get("dataset_name") or "")
            if not ds_name:
                continue
            seen_names.add(ds_name)
            datasets.append(
                DatasetStorageInfo(
                    name=ds_name,
                    prediction_count=int(row.get("prediction_count", 0) or 0),
                    parquet_size_bytes=int(parquet_by_dataset.get(ds_name, 0)),
                )
            )

        for ds_name, ds_size in parquet_by_dataset.items():
            if ds_name in seen_names:
                continue
            datasets.append(
                DatasetStorageInfo(
                    name=ds_name,
                    prediction_count=0,
                    parquet_size_bytes=int(ds_size),
                )
            )

        datasets.sort(key=lambda d: d.name.lower())

        orphan_metadata_count = 0
        orphan_array_count = 0
        corrupt_files: list[str] = []

        # Best-effort integrity/orphan detection using predictions maintenance APIs.
        if PREDICTIONS_AVAILABLE:
            try:
                dry_result = _invoke_predictions_method(
                    workspace_path,
                    "clean_dead_links",
                    dry_run=True,
                )
                orphan_metadata_count, orphan_array_count = _extract_orphan_counts(dry_result)
            except Exception:
                pass

            try:
                integrity_result = _invoke_predictions_method(workspace_path, "integrity_check")
                corrupt_files = _extract_corrupt_files(integrity_result)
                if orphan_metadata_count == 0 and orphan_array_count == 0:
                    orphan_metadata_count, orphan_array_count = _extract_orphan_counts(integrity_result)
            except Exception:
                pass

        return StorageHealthResponse(
            storage_mode=str(status.get("storage_mode", "unknown")),
            migration_needed=bool(status.get("migration_needed", False)),
            duckdb_size_bytes=duckdb_size_bytes,
            parquet_total_size_bytes=parquet_total_size_bytes,
            total_predictions=total_predictions,
            total_datasets=len(datasets),
            datasets=datasets,
            orphan_metadata_count=orphan_metadata_count,
            orphan_array_count=orphan_array_count,
            corrupt_files=corrupt_files,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get storage health: {str(e)}"
        )


@router.post("/workspace/clean-cache", response_model=CleanCacheResponse)
async def clean_cache(request: CleanCacheRequest):
    """
    Clean workspace cache and temporary files.

    Options:
    - clean_temp: Remove temporary files from .tmp directory
    - clean_orphan_results: Remove result files without associated runs
    - clean_old_predictions: Remove predictions older than threshold
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        workspace_path = Path(workspace.path)
        files_removed = 0
        bytes_freed = 0
        categories_cleaned: List[str] = []

        # Clean temporary files
        if request.clean_temp:
            temp_dirs = [workspace_path / ".tmp", workspace_path / ".cache"]
            for temp_dir in temp_dirs:
                if temp_dir.exists():
                    for file in temp_dir.rglob("*"):
                        if file.is_file():
                            try:
                                bytes_freed += file.stat().st_size
                                file.unlink()
                                files_removed += 1
                            except (OSError, PermissionError):
                                pass
                    categories_cleaned.append(temp_dir.name)

        # Clean old predictions
        if request.clean_old_predictions:
            predictions_dir = workspace_path / "predictions"
            if predictions_dir.exists():
                threshold = datetime.now().timestamp() - (request.days_threshold * 24 * 60 * 60)
                for file in predictions_dir.rglob("*"):
                    if file.is_file():
                        try:
                            if file.stat().st_mtime < threshold:
                                bytes_freed += file.stat().st_size
                                file.unlink()
                                files_removed += 1
                        except (OSError, PermissionError):
                            pass
                if files_removed > 0:
                    categories_cleaned.append("old_predictions")

        # Clean orphan results (results without matching run in workspace.json)
        if request.clean_orphan_results:
            results_dir = workspace_path / "results"
            if results_dir.exists():
                # Get list of known run IDs from workspace
                known_runs = set()
                runs_file = workspace_path / "runs.json"
                if runs_file.exists():
                    try:
                        with open(runs_file, "r", encoding="utf-8") as f:
                            runs_data = json.load(f)
                            for run in runs_data.get("runs", []):
                                known_runs.add(run.get("id"))
                    except Exception:
                        pass

                # Remove results not in known runs
                for item in results_dir.iterdir():
                    if item.is_dir() and item.name not in known_runs:
                        try:
                            size, _ = _compute_directory_size(item)
                            bytes_freed += size
                            shutil.rmtree(item)
                            files_removed += 1
                        except (OSError, PermissionError):
                            pass

                if files_removed > 0:
                    categories_cleaned.append("orphan_results")

        return CleanCacheResponse(
            success=True,
            files_removed=files_removed,
            bytes_freed=bytes_freed,
            categories_cleaned=categories_cleaned,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to clean cache: {str(e)}"
        )


@router.get("/workspace/settings", response_model=WorkspaceSettingsResponse)
async def get_workspace_settings():
    """Get workspace settings including data loading defaults."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        settings = workspace_manager.get_workspace_settings()
        return WorkspaceSettingsResponse(**settings)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get workspace settings: {str(e)}"
        )


@router.put("/workspace/settings")
async def update_workspace_settings(settings: Dict[str, Any]):
    """Update workspace settings."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        success = workspace_manager.save_workspace_settings(settings)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to save settings")

        return {
            "success": True,
            "message": "Settings updated successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update workspace settings: {str(e)}"
        )


@router.get("/workspace/data-defaults", response_model=DataLoadingDefaults)
async def get_data_loading_defaults():
    """Get default settings for data loading in dataset wizard."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            # Return system defaults if no workspace
            return DataLoadingDefaults()

        settings = workspace_manager.get_workspace_settings()
        defaults = settings.get("data_loading_defaults", {})
        return DataLoadingDefaults(**defaults) if defaults else DataLoadingDefaults()

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get data loading defaults: {str(e)}"
        )


@router.put("/workspace/data-defaults")
async def update_data_loading_defaults(defaults: DataLoadingDefaults):
    """Update default settings for data loading."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        settings = workspace_manager.get_workspace_settings()
        settings["data_loading_defaults"] = defaults.model_dump()
        success = workspace_manager.save_workspace_settings(settings)

        if not success:
            raise HTTPException(status_code=500, detail="Failed to save defaults")

        return {
            "success": True,
            "message": "Data loading defaults updated",
            "defaults": defaults.model_dump(),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update data loading defaults: {str(e)}"
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


# ============================================================================
# Phase 7: Linked Workspaces and App Settings API
# ============================================================================

# ============= Request/Response Models for Linked Workspaces =============


class LinkWorkspaceRequest(BaseModel):
    """Request model for linking a nirs4all workspace."""
    path: str = Field(..., description="Path to the nirs4all workspace")
    name: Optional[str] = Field(None, description="Display name (defaults to directory name)")


class LinkedWorkspaceResponse(BaseModel):
    """Response model for a linked workspace."""
    id: str
    path: str
    name: str
    is_active: bool
    linked_at: str
    last_scanned: Optional[str]
    discovered: Dict[str, Any]


class LinkedWorkspacesListResponse(BaseModel):
    """Response model for listing linked workspaces."""
    workspaces: List[LinkedWorkspaceResponse]
    active_workspace_id: Optional[str]
    total: int


class WorkspaceScanResponse(BaseModel):
    """Response model for workspace scan results."""
    scanned_at: str
    summary: Dict[str, int]
    runs: List[Dict[str, Any]]
    predictions: List[Dict[str, Any]]
    exports: List[Dict[str, Any]]
    templates: List[Dict[str, Any]]
    datasets: List[Dict[str, Any]]


class AppSettingsResponse(BaseModel):
    """Response model for app settings."""
    version: str
    linked_workspaces_count: int
    favorite_pipelines: List[str]
    ui_preferences: Dict[str, Any]


class UpdateAppSettingsRequest(BaseModel):
    """Request model for updating app settings."""
    ui_preferences: Optional[Dict[str, Any]] = None


class FavoritePipelineRequest(BaseModel):
    """Request model for adding/removing favorite pipelines."""
    pipeline_id: str


# ============= Linked Workspaces Endpoints =============


@router.get("/workspaces", response_model=LinkedWorkspacesListResponse)
async def list_linked_workspaces():
    """List all linked nirs4all workspaces."""
    try:
        workspaces = workspace_manager.get_linked_workspaces()
        active = workspace_manager.get_active_workspace()

        return LinkedWorkspacesListResponse(
            workspaces=[
                LinkedWorkspaceResponse(
                    id=ws.id,
                    path=ws.path,
                    name=ws.name,
                    is_active=ws.is_active,
                    linked_at=ws.linked_at,
                    last_scanned=ws.last_scanned,
                    discovered=ws.discovered,
                )
                for ws in workspaces
            ],
            active_workspace_id=active.id if active else None,
            total=len(workspaces),
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to list workspaces: {str(e)}"
        )


@router.post("/workspaces/link", response_model=LinkedWorkspaceResponse)
async def link_workspace(request: LinkWorkspaceRequest):
    """Link a nirs4all workspace for discovery."""
    try:
        linked_ws = workspace_manager.link_workspace(request.path, request.name)
        return LinkedWorkspaceResponse(
            id=linked_ws.id,
            path=linked_ws.path,
            name=linked_ws.name,
            is_active=linked_ws.is_active,
            linked_at=linked_ws.linked_at,
            last_scanned=linked_ws.last_scanned,
            discovered=linked_ws.discovered,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to link workspace: {str(e)}"
        )


@router.delete("/workspaces/{workspace_id}")
async def unlink_workspace(workspace_id: str):
    """Unlink a nirs4all workspace (doesn't delete files)."""
    try:
        success = workspace_manager.unlink_workspace(workspace_id)
        if not success:
            raise HTTPException(status_code=404, detail="Workspace not found")
        return {"success": True, "message": "Workspace unlinked"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to unlink workspace: {str(e)}"
        )


@router.post("/workspaces/{workspace_id}/activate", response_model=LinkedWorkspaceResponse)
async def activate_workspace(workspace_id: str):
    """Set a linked workspace as active."""
    try:
        activated = workspace_manager.activate_workspace(workspace_id)
        if not activated:
            raise HTTPException(status_code=404, detail="Workspace not found")
        return LinkedWorkspaceResponse(
            id=activated.id,
            path=activated.path,
            name=activated.name,
            is_active=activated.is_active,
            linked_at=activated.linked_at,
            last_scanned=activated.last_scanned,
            discovered=activated.discovered,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to activate workspace: {str(e)}"
        )


@router.post("/workspaces/{workspace_id}/scan", response_model=WorkspaceScanResponse)
async def scan_workspace(workspace_id: str):
    """Trigger a scan of a linked workspace to discover runs, exports, etc."""
    try:
        scan_result = workspace_manager.scan_workspace(workspace_id)
        return WorkspaceScanResponse(
            scanned_at=scan_result["scanned_at"],
            summary=scan_result["summary"],
            runs=scan_result["runs"],
            predictions=scan_result["predictions"],
            exports=scan_result["exports"],
            templates=scan_result["templates"],
            datasets=scan_result["datasets"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to scan workspace: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/runs")
async def get_workspace_runs(workspace_id: str, source: str = "unified", refresh: bool = False):
    """Get discovered runs from a linked workspace.

    When a DuckDB store is available, runs come directly from the store
    (fast, authoritative).  Otherwise falls back to manifest + parquet
    discovery:

    - "unified" (default): Combines manifest-based and parquet-based discovery
    - "manifests": Only reads from run_manifest.yaml files (accurate but slower)
    - "parquet": Only extracts from prediction parquet files (faster but less complete)

    Use refresh=true to bypass the cache and force a fresh scan.
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        workspace_path = Path(ws.path)
        workspace_path_str = str(workspace_path)

        # Check cache first (unless refresh is requested)
        if not refresh:
            cached = _get_cached_runs(workspace_path_str, source)
            if cached is not None:
                return cached

        scanner = WorkspaceScanner(workspace_path)

        # ---- DuckDB store path (primary) ----
        # When a store exists, scanner.discover_runs() already reads
        # from it and the parquet-derived phase is unnecessary.
        if scanner._has_store():
            all_runs = scanner.discover_runs()
            all_runs.sort(key=lambda r: r.get("created_at", "") or "", reverse=True)
            result = {"workspace_id": workspace_id, "runs": all_runs, "total": len(all_runs)}
            _set_cached_runs(workspace_path_str, source, result)
            return result

        # ---- Legacy filesystem path ----
        import pandas as pd

        all_runs = []
        seen_run_ids = set()

        def normalize_run_id(run_id: str) -> str:
            """Strip numeric prefix (e.g., '0003_config_xxx' -> 'config_xxx') for deduplication."""
            import re
            return re.sub(r'^\d+_', '', run_id)

        # Phase 1: Discover runs from manifests (v2 format with templates)
        if source in ("unified", "manifests"):
            manifest_runs = scanner.discover_runs()

            for run in manifest_runs:
                run_id = run.get("id", "")
                if run_id:
                    seen_run_ids.add(normalize_run_id(run_id))
                all_runs.append(run)

        # Phase 2: Extract additional runs from parquet files (for legacy/ungrouped data)
        if source in ("unified", "parquet"):
            parquet_files = list(workspace_path.glob("*.meta.parquet"))

            for parquet_file in parquet_files:
                try:
                    df = pd.read_parquet(parquet_file, columns=[
                        "dataset_name", "config_name", "pipeline_uid",
                        "model_name", "preprocessings", "partition",
                        "val_score", "test_score", "n_samples"
                    ])

                    if "config_name" not in df.columns or df.empty:
                        continue

                    dataset_name = parquet_file.stem.replace(".meta", "")

                    grouped = df.groupby("config_name", dropna=True)

                    agg_dict = {"config_name": "size"}
                    if "pipeline_uid" in df.columns:
                        agg_dict["pipeline_uid"] = "nunique"
                    if "val_score" in df.columns:
                        agg_dict["val_score"] = "max"
                    if "test_score" in df.columns:
                        agg_dict["test_score"] = "max"

                    agg_df = grouped.agg(agg_dict)
                    agg_df.columns = ["predictions_count", "pipeline_count", "val_score", "test_score"][:len(agg_df.columns)]

                    if "model_name" in df.columns:
                        models_per_config = grouped["model_name"].apply(
                            lambda x: x.dropna().unique().tolist()[:5]
                        ).to_dict()
                    else:
                        models_per_config = {}

                    for config_name in agg_df.index:
                        config_id = str(config_name)
                        normalized_id = normalize_run_id(config_id)
                        if normalized_id in seen_run_ids:
                            continue
                        seen_run_ids.add(normalized_id)

                        row = agg_df.loc[config_name]
                        val_score = row.get("val_score") if "val_score" in row.index else None
                        test_score = row.get("test_score") if "test_score" in row.index else None

                        all_runs.append({
                            "id": config_id,
                            "pipeline_id": config_id,
                            "name": config_id,
                            "dataset": dataset_name,
                            "created_at": None,
                            "schema_version": "derived",
                            "format": "parquet_derived",
                            "artifact_count": 0,
                            "predictions_count": int(row.get("predictions_count", 0)),
                            "pipeline_count": int(row.get("pipeline_count", 1)) if "pipeline_count" in row.index else 1,
                            "models": models_per_config.get(config_name, []),
                            "best_val_score": float(val_score) if pd.notna(val_score) else None,
                            "best_test_score": float(test_score) if pd.notna(test_score) else None,
                            "templates": [],
                            "datasets": [{"name": dataset_name}],
                            "dataset_info": {},
                            "manifest_path": "",
                        })
                except Exception as e:
                    logger.error("Failed to read %s: %s", parquet_file, e)
                    continue

        # Sort by created_at (newest first) for runs that have timestamps
        all_runs.sort(key=lambda r: r.get("created_at", "") or "", reverse=True)

        result = {"workspace_id": workspace_id, "runs": all_runs, "total": len(all_runs)}

        # Cache the result for subsequent requests
        _set_cached_runs(workspace_path_str, source, result)

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get runs: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/runs/enriched")
async def get_enriched_workspace_runs(workspace_id: str, project_id: Optional[str] = None, limit: int = 50, offset: int = 0):
    """Get enriched runs with per-dataset scores, top chains, and stats."""
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        from api.store_adapter import StoreAdapter, STORE_AVAILABLE
        if not STORE_AVAILABLE:
            return {"runs": [], "total": 0}

        workspace_path = Path(ws.path)
        store_path = workspace_path / "store.duckdb"
        if not store_path.exists():
            return {"runs": [], "total": 0}

        adapter = StoreAdapter(workspace_path)
        try:
            return adapter.get_enriched_runs(limit=limit, offset=offset, project_id=project_id)
        finally:
            adapter.close()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workspaces/{workspace_id}/runs/{run_id}")
async def get_workspace_run_detail(workspace_id: str, run_id: str):
    """Get detailed information about a specific run.

    Returns the full run information including templates, datasets,
    configuration, and summary of results.
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        workspace_path = Path(ws.path)
        scanner = WorkspaceScanner(workspace_path)

        # ---- DuckDB store path (primary) ----
        if scanner._has_store():
            run = scanner.store_adapter.get_run_detail(run_id)
            if run is not None:
                results = scanner.discover_results(run_id)
                run["results"] = results
                run["results_count"] = len(results)
                return run
            raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

        # ---- Legacy filesystem path ----
        all_runs = scanner.discover_runs()
        for run in all_runs:
            if run.get("id") == run_id:
                results = scanner.discover_results(run_id)
                run["results"] = results
                run["results_count"] = len(results)
                return run

        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get run detail: {str(e)}"
        )


@router.delete("/workspaces/{workspace_id}/runs/{run_id}")
async def delete_workspace_run(workspace_id: str, run_id: str):
    """Delete a run from a workspace.

    When a DuckDB store is available, deletes the run with cascade
    (pipelines, chains, predictions, arrays, logs).  Returns 404
    if the workspace or store is not found.
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        workspace_path = Path(ws.path)
        scanner = WorkspaceScanner(workspace_path)

        if not scanner._has_store():
            raise HTTPException(status_code=501, detail="Run deletion requires a DuckDB store")

        result = scanner.store_adapter.delete_run(run_id)

        # Invalidate cached runs for this workspace
        invalidate_workspace_cache(str(workspace_path))

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete run: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/runs/{run_id}/datasets/{dataset_name}/scores")
async def get_score_distribution(workspace_id: str, run_id: str, dataset_name: str, n_bins: int = 20):
    """Get score distribution histogram data for a run+dataset."""
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        from api.store_adapter import StoreAdapter, STORE_AVAILABLE
        if not STORE_AVAILABLE:
            return {"dataset_name": dataset_name, "metric": None, "partitions": {}}

        workspace_path = Path(ws.path)
        adapter = StoreAdapter(workspace_path)
        try:
            return adapter.get_score_distribution(run_id, dataset_name, n_bins=n_bins)
        finally:
            adapter.close()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _resolve_dataset_mapping(datasets_result: list[dict], linked_datasets: list) -> None:
    """Resolve DuckDB dataset_name → linked dataset ID using smart matching.

    Matching strategies (in priority order):
    1. Exact name match (case-insensitive)
    2. folder_to_name(linked_path) is a prefix of DuckDB name (longest wins)
    3. Linked name is a prefix of DuckDB name (longest wins)

    Mutates each entry in datasets_result to add ``linked_dataset_id``.
    """
    if not linked_datasets:
        return

    # Build list of (id, name_lower, folder_name_lower) tuples
    linked_info: list[tuple[str, str, str]] = []
    for ld in linked_datasets:
        ld_id = ld.id if hasattr(ld, "id") else ld.get("id", "")
        ld_name = ld.name if hasattr(ld, "name") else ld.get("name", "")
        ld_path = ld.path if hasattr(ld, "path") else ld.get("path", "")
        name_lower = ld_name.lower() if ld_name else ""
        folder_lower = ""
        if ld_path:
            folder_lower = "".join(c if c.isalnum() else "_" for c in Path(ld_path).name).lower()
        linked_info.append((ld_id, name_lower, folder_lower))

    for ds_entry in datasets_result:
        duckdb_name = ds_entry.get("dataset_name", "")
        if not duckdb_name:
            continue

        duckdb_lower = duckdb_name.lower()

        # Strategy 1: exact name match (case-insensitive)
        for ld_id, name_lower, _ in linked_info:
            if duckdb_lower == name_lower:
                ds_entry["linked_dataset_id"] = ld_id
                break
        if "linked_dataset_id" in ds_entry:
            continue

        # Strategy 2: folder_to_name(path) is a prefix of DuckDB name (longest wins)
        best_id: str | None = None
        best_len = 0
        for ld_id, _, folder_lower in linked_info:
            if folder_lower and duckdb_lower.startswith(folder_lower) and len(folder_lower) > best_len:
                best_id = ld_id
                best_len = len(folder_lower)

        if best_id:
            ds_entry["linked_dataset_id"] = best_id
            continue

        # Strategy 3: linked name prefix (longest wins)
        for ld_id, name_lower, _ in linked_info:
            if name_lower and duckdb_lower.startswith(name_lower) and len(name_lower) > best_len:
                best_id = ld_id
                best_len = len(name_lower)

        if best_id:
            ds_entry["linked_dataset_id"] = best_id


@router.get("/workspaces/{workspace_id}/results/summary")
async def get_workspace_results_summary(workspace_id: str):
    """Get results summary: top 5 models per dataset across all runs."""
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        from api.store_adapter import StoreAdapter, STORE_AVAILABLE
        if not STORE_AVAILABLE:
            return {"workspace_id": workspace_id, "datasets": []}

        workspace_path = Path(ws.path)
        store_path = workspace_path / "store.duckdb"
        if not store_path.exists():
            return {"workspace_id": workspace_id, "datasets": []}

        adapter = StoreAdapter(workspace_path)
        try:
            result = adapter.get_dataset_top_chains()
            result["workspace_id"] = workspace_id

            # Resolve DuckDB dataset names to linked dataset IDs
            linked_datasets = app_config.get_datasets()
            _resolve_dataset_mapping(result.get("datasets", []), linked_datasets)

            return result
        finally:
            adapter.close()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workspaces/{workspace_id}/results")
async def get_workspace_results(
    workspace_id: str,
    run_id: Optional[str] = None,
    dataset: Optional[str] = None,
    template_id: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    """Get individual results (pipeline config × dataset combinations).

    Results represent the granular level below runs - each result is
    one specific pipeline configuration executed on one dataset.

    Filters:
    - run_id: Filter to results from a specific run
    - dataset: Filter to results for a specific dataset
    - template_id: Filter to results from a specific template
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        workspace_path = Path(ws.path)
        scanner = WorkspaceScanner(workspace_path)

        # Discover all results
        all_results = scanner.discover_results(run_id)

        # Apply filters
        if dataset:
            all_results = [r for r in all_results if r.get("dataset") == dataset]
        if template_id:
            all_results = [r for r in all_results if r.get("template_id") == template_id]

        # Sort by best_score descending (best first)
        all_results.sort(
            key=lambda r: r.get("best_score") if r.get("best_score") is not None else float("-inf"),
            reverse=True
        )

        # Paginate
        total = len(all_results)
        paginated = all_results[offset:offset + limit]

        return {
            "workspace_id": workspace_id,
            "results": paginated,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get results: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/datasets/discovered")
async def get_workspace_discovered_datasets(workspace_id: str):
    """Get datasets discovered from run manifests.

    This endpoint extracts unique datasets from all runs, including
    full metadata like n_samples, y_stats, and path status.
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        workspace_path = Path(ws.path)
        scanner = WorkspaceScanner(workspace_path)

        # Get runs and extract datasets
        runs = scanner.discover_runs()
        datasets = scanner.extract_datasets(runs)

        return {
            "workspace_id": workspace_id,
            "datasets": datasets,
            "total": len(datasets),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get discovered datasets: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/predictions")
async def get_workspace_predictions(workspace_id: str):
    """Get discovered predictions from a linked workspace."""
    try:
        predictions = workspace_manager.get_workspace_predictions(workspace_id)
        return {"predictions": predictions, "count": len(predictions)}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get predictions: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/predictions/data")
async def get_workspace_predictions_data(
    workspace_id: str,
    limit: int = 500,
    offset: int = 0,
    dataset: Optional[str] = None,
    model_class: Optional[str] = None,
    partition: Optional[str] = None,
):
    """Get prediction records with metadata.

    When a DuckDB store is available, reads directly from the store
    (fast, paginated at the DB level).  Otherwise falls back to reading
    ``.meta.parquet`` files with pandas.
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        workspace_path = Path(ws.path)
        scanner = WorkspaceScanner(workspace_path)

        # ---- DuckDB store path (primary) ----
        if scanner._has_store():
            page = scanner.store_adapter.get_predictions_page(
                dataset_name=dataset,
                model_class=model_class,
                partition=partition,
                limit=limit,
                offset=offset,
            )
            return page

        # ---- Legacy filesystem path (parquet files) ----
        import pandas as pd

        all_records = []

        parquet_files = list(workspace_path.glob("*.meta.parquet"))

        if dataset:
            parquet_files = [f for f in parquet_files if f.stem.replace(".meta", "") == dataset]

        for parquet_file in parquet_files:
            try:
                df = pd.read_parquet(parquet_file)
                dataset_name = parquet_file.stem.replace(".meta", "")

                columns_to_include = [
                    "id", "dataset_name", "config_name", "pipeline_uid",
                    "step_idx", "op_counter", "model_name", "model_classname",
                    "fold_id", "partition", "val_score", "test_score", "train_score",
                    "metric", "task_type", "n_samples", "n_features",
                    "preprocessings", "best_params", "scores",
                    "branch_id", "branch_name", "exclusion_count", "exclusion_rate",
                    "model_artifact_id", "trace_id"
                ]

                available_columns = [c for c in columns_to_include if c in df.columns]
                subset = df[available_columns].copy()
                records = subset.to_dict('records')

                source_file_str = str(parquet_file)

                def clean_nan(obj):
                    """Recursively clean NaN/Inf values from an object for JSON serialization."""
                    import math
                    import numpy as np
                    if isinstance(obj, dict):
                        return {k: clean_nan(v) for k, v in obj.items()}
                    elif isinstance(obj, list):
                        return [clean_nan(v) for v in obj]
                    elif isinstance(obj, (float, np.floating)):
                        try:
                            if math.isnan(obj) or math.isinf(obj):
                                return None
                        except (TypeError, ValueError):
                            pass
                        return float(obj)
                    elif isinstance(obj, np.integer):
                        return int(obj)
                    try:
                        if pd.isna(obj):
                            return None
                    except (TypeError, ValueError):
                        pass
                    return obj

                for record in records:
                    record["source_dataset"] = dataset_name
                    record["source_file"] = source_file_str

                    for json_field in ["best_params", "scores"]:
                        val = record.get(json_field)
                        if val is not None and isinstance(val, str):
                            try:
                                record[json_field] = json.loads(val)
                            except (json.JSONDecodeError, TypeError):
                                pass

                    for key in list(record.keys()):
                        record[key] = clean_nan(record[key])

                all_records.extend(records)
            except Exception as e:
                logger.error("Error reading %s: %s", parquet_file, e)
                continue

        total = len(all_records)
        paginated = all_records[offset:offset + limit]

        import math
        import numpy as np

        class NaNSafeEncoder(json.JSONEncoder):
            def default(self, obj):
                if isinstance(obj, (np.floating, float)):
                    if math.isnan(obj) or math.isinf(obj):
                        return None
                    return float(obj)
                if isinstance(obj, np.integer):
                    return int(obj)
                if isinstance(obj, np.ndarray):
                    return obj.tolist()
                return super().default(obj)

            def encode(self, obj):
                def sanitize(o):
                    if isinstance(o, dict):
                        return {k: sanitize(v) for k, v in o.items()}
                    elif isinstance(o, list):
                        return [sanitize(v) for v in o]
                    elif isinstance(o, (float, np.floating)):
                        if math.isnan(o) or math.isinf(o):
                            return None
                        return float(o)
                    elif isinstance(o, np.integer):
                        return int(o)
                    return o
                return super().encode(sanitize(obj))

        response_data = {
            "records": paginated,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        }

        json_str = json.dumps(response_data, cls=NaNSafeEncoder)
        return Response(content=json_str, media_type="application/json")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to read predictions data: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/predictions/{prediction_id}/scatter")
async def get_prediction_scatter_data(workspace_id: str, prediction_id: str):
    """Get scatter plot data (y_true vs y_pred) for a specific prediction.

    When a DuckDB store is available, loads arrays directly from the
    store.  Otherwise falls back to ``.arrays.parquet`` files.

    Returns:
        - y_true: Actual values array
        - y_pred: Predicted values array
        - n_samples: Number of data points
        - partition: Data partition (train/val/test)
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        workspace_path = Path(ws.path)
        scanner = WorkspaceScanner(workspace_path)

        # ---- DuckDB store path (primary) ----
        if scanner._has_store():
            scatter = scanner.store_adapter.get_prediction_scatter(prediction_id)
            if scatter is not None:
                return scatter
            raise HTTPException(
                status_code=404,
                detail=f"Prediction '{prediction_id}' not found or has no scatter data"
            )

        # ---- Legacy filesystem path ----
        from nirs4all.data.predictions import Predictions

        parquet_files = list(workspace_path.glob("*.meta.parquet"))

        if not parquet_files:
            raise HTTPException(status_code=404, detail="No predictions found in workspace")

        for meta_file in parquet_files:
            arrays_file = meta_file.with_name(
                meta_file.name.replace(".meta.parquet", ".arrays.parquet")
            )

            if not arrays_file.exists():
                continue

            try:
                pred_storage = Predictions()
                pred_storage.load_from_file(str(meta_file), merge=False)

                prediction = pred_storage.get_prediction_by_id(prediction_id, load_arrays=True)

                if prediction:
                    y_true = prediction.get('y_true')
                    y_pred = prediction.get('y_pred')

                    if y_true is None or y_pred is None:
                        continue

                    import numpy as np
                    y_true_list = y_true.tolist() if isinstance(y_true, np.ndarray) else list(y_true) if y_true is not None else []
                    y_pred_list = y_pred.tolist() if isinstance(y_pred, np.ndarray) else list(y_pred) if y_pred is not None else []

                    if not y_true_list or not y_pred_list:
                        continue

                    return {
                        "prediction_id": prediction_id,
                        "y_true": y_true_list,
                        "y_pred": y_pred_list,
                        "n_samples": len(y_true_list),
                        "partition": prediction.get('partition', 'unknown'),
                        "model_name": prediction.get('model_name', 'unknown'),
                        "dataset_name": prediction.get('dataset_name', 'unknown'),
                    }
            except Exception as e:
                logger.error("Error reading %s: %s", meta_file, e)
                continue

        raise HTTPException(
            status_code=404,
            detail=f"Prediction '{prediction_id}' not found or has no scatter data"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get scatter data: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/predictions/summary")
async def get_workspace_predictions_summary(workspace_id: str):
    """Get aggregated prediction summary.

    When a DuckDB store is available, the summary is computed directly
    from the store (fast).  Otherwise falls back to reading parquet
    file footers.

    Returns:
    - Total predictions across all datasets
    - Model breakdown with average scores
    - Top predictions by validation score
    """
    from datetime import timezone as _tz

    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        workspace_path = Path(ws.path)
        scanner = WorkspaceScanner(workspace_path)

        # ---- DuckDB store path (primary) ----
        if scanner._has_store():
            summary = scanner.store_adapter.get_predictions_summary()
            return summary

        # ---- Legacy filesystem path (parquet footers) ----
        import pyarrow.parquet as pq
        from concurrent.futures import ThreadPoolExecutor

        parquet_files = list(workspace_path.glob("*.meta.parquet"))

        if not parquet_files:
            return {
                "total_predictions": 0,
                "total_datasets": 0,
                "datasets": [],
                "models": [],
                "runs": [],
                "generated_at": datetime.now(_tz.utc).isoformat(),
            }

        def read_summary(parquet_file: Path) -> Optional[Dict[str, Any]]:
            """Read summary from a single parquet file."""
            try:
                pf = pq.ParquetFile(str(parquet_file))
                metadata = pf.schema_arrow.metadata

                if metadata and b"n4a_summary" in metadata:
                    summary = json.loads(metadata[b"n4a_summary"].decode("utf-8"))
                    summary["dataset"] = parquet_file.stem.replace(".meta", "")
                    summary["has_summary"] = True
                    return summary
                else:
                    return {
                        "dataset": parquet_file.stem.replace(".meta", ""),
                        "total_predictions": pf.metadata.num_rows,
                        "has_summary": False,
                    }
            except Exception as e:
                logger.error("Error reading %s: %s", parquet_file, e)
                return None

        summaries = []
        with ThreadPoolExecutor(max_workers=min(len(parquet_files), 8)) as executor:
            results = list(executor.map(read_summary, parquet_files))
            summaries = [s for s in results if s is not None]

        total_predictions = sum(s.get("total_predictions", 0) for s in summaries)

        all_models: Dict[str, Dict] = {}
        for s in summaries:
            for model in s.get("facets", {}).get("models", []):
                name = model["name"]
                if name not in all_models:
                    all_models[name] = {"name": name, "count": 0, "total_score": 0, "score_count": 0}
                all_models[name]["count"] += model["count"]
                if model.get("avg_val_score"):
                    all_models[name]["total_score"] += model["avg_val_score"] * model["count"]
                    all_models[name]["score_count"] += model["count"]

        models = []
        for m in all_models.values():
            models.append({
                "name": m["name"],
                "count": m["count"],
                "avg_val_score": round(m["total_score"] / m["score_count"], 4) if m["score_count"] > 0 else None,
            })
        models.sort(key=lambda x: x["count"], reverse=True)

        all_runs = []
        for s in summaries:
            all_runs.extend(s.get("runs", []))

        all_top = []
        for s in summaries:
            for pred in s.get("top_predictions", []):
                pred["dataset"] = s.get("dataset")
                all_top.append(pred)
        all_top.sort(key=lambda x: x.get("val_score") or 0, reverse=True)
        top_predictions = all_top[:10]

        aggregated_stats = {}
        for stat_key in ["val_score", "test_score", "train_score"]:
            all_values = []
            for s in summaries:
                stats = s.get("stats", {}).get(stat_key, {})
                if stats:
                    all_values.append({
                        "min": stats.get("min", 0),
                        "max": stats.get("max", 0),
                        "mean": stats.get("mean", 0),
                        "count": s.get("total_predictions", 0),
                    })
            if all_values:
                total_count = sum(v["count"] for v in all_values)
                aggregated_stats[stat_key] = {
                    "min": min(v["min"] for v in all_values),
                    "max": max(v["max"] for v in all_values),
                    "mean": sum(v["mean"] * v["count"] for v in all_values) / total_count if total_count > 0 else 0,
                }

        return {
            "total_predictions": total_predictions,
            "total_datasets": len(summaries),
            "datasets": summaries,
            "models": models,
            "runs": all_runs,
            "top_predictions": top_predictions,
            "stats": aggregated_stats,
            "generated_at": datetime.now(_tz.utc).isoformat(),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to read predictions summary: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/exports")
async def get_workspace_exports(workspace_id: str):
    """Get discovered exports from a linked workspace."""
    try:
        exports = workspace_manager.get_workspace_exports(workspace_id)
        return {"exports": exports, "count": len(exports)}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get exports: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/templates")
async def get_workspace_templates(workspace_id: str):
    """Get discovered library templates from a linked workspace."""
    try:
        templates = workspace_manager.get_workspace_templates(workspace_id)
        return {"templates": templates, "count": len(templates)}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get templates: {str(e)}"
        )


# ============= App Settings Endpoints =============


@router.get("/app/settings", response_model=AppSettingsResponse)
async def get_app_settings():
    """Get app settings (webapp-specific, separate from workspace settings)."""
    try:
        settings = workspace_manager.get_app_settings()
        linked_workspaces = workspace_manager.get_linked_workspaces()
        return AppSettingsResponse(
            version=settings.get("version", "1.0"),
            linked_workspaces_count=len(linked_workspaces),
            favorite_pipelines=settings.get("favorite_pipelines", []),
            ui_preferences=settings.get("ui_preferences", {}),
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get app settings: {str(e)}"
        )


@router.put("/app/settings")
async def update_app_settings(request: UpdateAppSettingsRequest):
    """Update app settings."""
    try:
        updates = {}
        if request.ui_preferences is not None:
            updates["ui_preferences"] = request.ui_preferences

        success = workspace_manager.save_app_settings(updates)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to save app settings")

        return {"success": True, "message": "App settings updated"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update app settings: {str(e)}"
        )


@router.get("/app/favorites")
async def get_favorite_pipelines():
    """Get list of favorite pipeline IDs."""
    try:
        favorites = workspace_manager.get_favorite_pipelines()
        return {"favorites": favorites, "count": len(favorites)}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get favorites: {str(e)}"
        )


@router.post("/app/favorites")
async def add_favorite_pipeline(request: FavoritePipelineRequest):
    """Add a pipeline to favorites."""
    try:
        added = workspace_manager.add_favorite_pipeline(request.pipeline_id)
        return {
            "success": True,
            "added": added,
            "message": "Added to favorites" if added else "Already in favorites",
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to add favorite: {str(e)}"
        )


@router.delete("/app/favorites/{pipeline_id}")
async def remove_favorite_pipeline(pipeline_id: str):
    """Remove a pipeline from favorites."""
    try:
        removed = workspace_manager.remove_favorite_pipeline(pipeline_id)
        return {
            "success": True,
            "removed": removed,
            "message": "Removed from favorites" if removed else "Not in favorites",
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to remove favorite: {str(e)}"
        )


# ============= Config Path Management Endpoints =============


class SetConfigPathRequest(BaseModel):
    """Request model for setting the app config folder path."""
    path: str = Field(..., description="Path to the new config folder")


@router.get("/app/config-path")
async def get_config_path():
    """Get the current and default app config folder paths.

    The app config folder stores:
    - app_settings.json: UI preferences, linked workspaces, favorites
    - dataset_links.json: Global dataset registry

    The config path can be customized via:
    1. NIRS4ALL_CONFIG environment variable
    2. Redirect file in the default location
    """
    try:
        return {
            "current_path": app_config.get_config_path(),
            "default_path": app_config.get_default_config_path(),
            "is_custom": app_config.is_using_custom_path(),
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get config path: {str(e)}"
        )


@router.post("/app/config-path")
async def set_config_path(request: SetConfigPathRequest):
    """Set a custom app config folder path.

    This creates a redirect file in the default config location pointing
    to the new path. The new path must exist.

    Note: The application may need to be restarted for changes to take
    full effect.
    """
    try:
        success = app_config.set_config_path(request.path)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to set config path")

        return {
            "success": True,
            "message": "Config path updated",
            "current_path": app_config.get_config_path(),
            "requires_restart": True,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to set config path: {str(e)}"
        )


@router.delete("/app/config-path")
async def reset_config_path():
    """Reset the app config folder to the default location.

    This removes the redirect file if it exists.

    Note: The application may need to be restarted for changes to take
    full effect.
    """
    try:
        success = app_config.reset_config_path()
        if not success:
            raise HTTPException(status_code=500, detail="Failed to reset config path")

        return {
            "success": True,
            "message": "Config path reset to default",
            "current_path": app_config.get_config_path(),
            "requires_restart": True,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to reset config path: {str(e)}"
        )
