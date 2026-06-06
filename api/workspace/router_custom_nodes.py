"""Custom nodes API routes (Phase 5): per-workspace custom node definitions."""

from datetime import datetime

from fastapi import APIRouter, HTTPException

from ..shared.logger import get_logger
from ..workspace_manager import workspace_manager
from .models import (
    CustomNodeDefinition,
    CustomNodeSettingsRequest,
    ImportCustomNodesRequest,
)

logger = get_logger(__name__)

router = APIRouter()


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
