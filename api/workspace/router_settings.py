"""App settings, favorite pipelines, and config-path management routes.

These are webapp-specific (``/app/*``) and separate from per-workspace settings.
"""

from fastapi import APIRouter, HTTPException

from ..app_config import app_config
from ..shared.logger import get_logger
from ..workspace_manager import workspace_manager
from .models import (
    AppSettingsResponse,
    FavoritePipelineRequest,
    SetConfigPathRequest,
    UpdateAppSettingsRequest,
)

logger = get_logger(__name__)

router = APIRouter()


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
