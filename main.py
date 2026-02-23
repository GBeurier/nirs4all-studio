"""
FastAPI backend for nirs4all webapp.

This module provides the web API for the nirs4all desktop application,
handling workspace management, dataset operations, pipeline execution,
training, model management, and prediction storage.

Phase 5: WebSocket support for real-time updates.
Phase 6: Workspace management and AutoML search.
"""

import os
import traceback
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, ORJSONResponse
from fastapi.staticfiles import StaticFiles

from api.shared.logger import get_logger, setup_logging

setup_logging()
logger = get_logger(__name__)

# Desktop mode detection - skip unnecessary middleware when running in pywebview
DESKTOP_MODE = os.environ.get("NIRS4ALL_DESKTOP", "false").lower() == "true"

from api.aggregated_predictions import router as aggregated_predictions_router
from api.analysis import router as analysis_router
from api.automl import router as automl_router
from api.datasets import router as datasets_router
from api.evaluation import router as evaluation_router
from api.inspector import router as inspector_router
from api.models import router as models_router
from api.pipelines import router as pipelines_router
from api.playground import router as playground_router
from api.predictions import router as predictions_router
from api.preprocessing import router as preprocessing_router
from api.projects import router as projects_router
from api.recommended_config import router as config_router
from api.runs import router as runs_router
from api.shap import router as shap_router
from api.spectra import router as spectra_router
from api.synthesis import router as synthesis_router
from api.system import log_error
from api.system import router as system_router
from api.training import router as training_router
from api.transfer import router as transfer_router
from api.updates import router as updates_router
from api.workspace import router as workspace_router
from websocket import ws_manager

# Create FastAPI app
app = FastAPI(
    title="nirs4all API",
    description="API for nirs4all unified NIRS analysis desktop application",
    version="1.0.0",
    default_response_class=ORJSONResponse,
)

# Startup readiness flag — set to True once the startup event has completed.
# Used by /api/health so Electron waits for full initialization before loading the UI.
startup_complete = False


# ============= Exception Handlers for Error Logging =============


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Log HTTP exceptions and return JSON response."""
    # Only log 5xx errors (server errors)
    if exc.status_code >= 500:
        log_error(
            endpoint=str(request.url.path),
            message=str(exc.detail),
            level="error",
            details=f"Status code: {exc.status_code}",
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Log unexpected exceptions and return JSON response."""
    log_error(
        endpoint=str(request.url.path),
        message=str(exc),
        level="critical",
        details=f"Unhandled exception: {type(exc).__name__}",
        exc=exc,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


# Add CORS middleware - always enabled to support:
# - Web dev mode (Vite on localhost:5173 -> backend on localhost:8000)
# - Desktop dev mode (Vite on localhost:5173 -> backend on random port)
# In production desktop mode, same-origin requests work regardless of CORS config
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for local development
    allow_credentials=False,  # Must be False when using allow_origins=["*"]
    allow_methods=["*"],
    allow_headers=["*"],
)


# Include API routes
app.include_router(workspace_router, prefix="/api", tags=["workspace"])
app.include_router(datasets_router, prefix="/api", tags=["datasets"])
app.include_router(pipelines_router, prefix="/api", tags=["pipelines"])
app.include_router(aggregated_predictions_router, prefix="/api", tags=["aggregated-predictions"])
app.include_router(predictions_router, prefix="/api", tags=["predictions"])
app.include_router(system_router, prefix="/api", tags=["system"])
app.include_router(spectra_router, prefix="/api", tags=["spectra"])
app.include_router(preprocessing_router, prefix="/api", tags=["preprocessing"])
app.include_router(training_router, prefix="/api", tags=["training"])
app.include_router(models_router, prefix="/api", tags=["models"])
app.include_router(analysis_router, prefix="/api", tags=["analysis"])
app.include_router(evaluation_router, prefix="/api", tags=["evaluation"])
app.include_router(automl_router, prefix="/api", tags=["automl"])
app.include_router(runs_router, prefix="/api", tags=["runs"])
app.include_router(playground_router, prefix="/api", tags=["playground"])
app.include_router(updates_router, prefix="/api", tags=["updates"])
app.include_router(synthesis_router, prefix="/api", tags=["synthesis"])
app.include_router(transfer_router, prefix="/api", tags=["transfer"])
app.include_router(shap_router, prefix="/api", tags=["shap"])
app.include_router(projects_router, prefix="/api", tags=["projects"])
app.include_router(inspector_router, prefix="/api", tags=["inspector"])
app.include_router(config_router, prefix="/api", tags=["config"])


# ============= Startup Events =============


@app.on_event("startup")
async def startup_event():
    """Initialize services on application startup."""
    # Import here to avoid circular imports
    from api.updates import update_manager
    from api.workspace_manager import workspace_manager

    # Log startup
    logger.info("nirs4all webapp starting...")
    logger.info("Webapp version: %s", update_manager.get_webapp_version())

    # Restore active workspace from persisted settings
    # This ensures nirs4all library uses the correct workspace path after restart
    try:
        active_ws = workspace_manager.get_active_workspace()
        if active_ws:
            try:
                import nirs4all.workspace as nirs4all_workspace
                nirs4all_workspace.set_active_workspace(active_ws.path)
                logger.info("Restored active workspace: %s", active_ws.path)
            except ImportError:
                os.environ["NIRS4ALL_WORKSPACE"] = active_ws.path
                logger.info("Set NIRS4ALL_WORKSPACE env var: %s", active_ws.path)
        else:
            logger.info("No active workspace found in settings")
    except Exception as e:
        logger.error("Failed to restore active workspace: %s", e)

    import asyncio

    # Check for updates in background if auto-check is enabled
    if update_manager.settings.auto_check:
        asyncio.create_task(check_updates_background())

    # Pre-cache recommended config in background
    asyncio.create_task(cache_recommended_config_background())

    # Mark startup as complete so /api/health reports ready=true
    global startup_complete
    startup_complete = True
    logger.info("Startup complete — backend ready")


async def check_updates_background():
    """Background task to check for updates."""
    try:
        from api.updates import update_manager
        status = await update_manager.get_update_status()
        if status.webapp.update_available:
            logger.info("Webapp update available: %s", status.webapp.latest_version)
        if status.nirs4all.update_available:
            logger.info("nirs4all update available: %s", status.nirs4all.latest_version)
    except Exception as e:
        logger.error("Background update check failed: %s", e)


async def cache_recommended_config_background():
    """Background task to pre-cache recommended config from GitHub."""
    try:
        from api.recommended_config import _config_cache, _fetch_remote_config
        remote = await _fetch_remote_config()
        if remote:
            _config_cache.set_cached_config(remote)
            logger.info("Recommended config cached from remote (app_version=%s)", remote.get("app_version"))
        else:
            logger.debug("Could not fetch remote recommended config, bundled fallback will be used")
    except Exception as e:
        logger.debug("Background recommended config fetch failed: %s", e)


# ============= WebSocket Endpoints =============


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, client_id: str = None):
    """
    Main WebSocket endpoint for real-time updates.

    Clients can subscribe to channels for specific updates:
    - job:{job_id} - Updates for a specific job
    - training:{job_id} - Training-specific updates
    - system - System-wide notifications

    Message format (JSON):
    {
        "type": "subscribe" | "unsubscribe" | "ping",
        "channel": "channel_name",
        "data": {}
    }
    """
    await ws_manager.connect(websocket, client_id)

    try:
        while True:
            # Receive and handle messages
            message_text = await websocket.receive_text()
            response = await ws_manager.handle_message(websocket, message_text)
            if response:
                await ws_manager.send_to_connection(websocket, response)

    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error("WebSocket error: %s", e)
        await ws_manager.disconnect(websocket)


@app.websocket("/ws/job/{job_id}")
async def job_websocket_endpoint(websocket: WebSocket, job_id: str):
    """
    WebSocket endpoint for job-specific updates.

    Automatically subscribes to the job channel on connection.
    Useful for monitoring training progress, evaluation results, etc.
    """
    await ws_manager.connect(websocket, f"job-{job_id}")
    await ws_manager.subscribe(websocket, f"job:{job_id}")

    try:
        while True:
            # Keep connection alive, handle ping/pong
            message_text = await websocket.receive_text()
            response = await ws_manager.handle_message(websocket, message_text)
            if response:
                await ws_manager.send_to_connection(websocket, response)

    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error("Job WebSocket error: %s", e)
        await ws_manager.disconnect(websocket)


@app.websocket("/ws/training/{job_id}")
async def training_websocket_endpoint(websocket: WebSocket, job_id: str):
    """
    WebSocket endpoint specifically for training job updates.

    Automatically subscribes to the job channel.
    Provides epoch-by-epoch progress and metrics updates.
    """
    await ws_manager.connect(websocket, f"training-{job_id}")
    await ws_manager.subscribe(websocket, f"job:{job_id}")

    try:
        while True:
            message_text = await websocket.receive_text()
            response = await ws_manager.handle_message(websocket, message_text)
            if response:
                await ws_manager.send_to_connection(websocket, response)

    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception as e:
        logger.error("Training WebSocket error: %s", e)
        await ws_manager.disconnect(websocket)


@app.get("/api/ws/stats")
async def get_websocket_stats():
    """Get WebSocket connection statistics."""
    return {
        "total_connections": ws_manager.get_connection_count(),
    }


# Serve static files from public and dist folders
public_path = Path(__file__).parent / "public"
dist_path = Path(__file__).parent / "dist"

# Serve built files in production
if dist_path.exists():
    # Serve static assets (JS, CSS, images)
    if (dist_path / "assets").exists():
        app.mount(
            "/assets", StaticFiles(directory=str(dist_path / "assets")), name="assets"
        )

# Mount public folder for static assets (always available)
if public_path.exists():
    app.mount("/public", StaticFiles(directory=str(public_path)), name="public")

    @app.get("/nirs4all_icon.svg")
    async def serve_app_icon_svg():
        """Serve the primary app icon (SVG) from the public folder"""
        icon_file = public_path / "nirs4all_icon.svg"
        if icon_file.exists():
            return FileResponse(str(icon_file))
        raise HTTPException(status_code=404, detail="App icon SVG not found")

    @app.get("/nirs4all.ico")
    async def serve_favicon_ico():
        """Serve .ico favicon from public folder"""
        ico_file = public_path / "nirs4all.ico"
        if ico_file.exists():
            return FileResponse(str(ico_file))
        raise HTTPException(status_code=404, detail="Favicon not found")


@app.get("/")
async def serve_spa():
    """Serve the main SPA HTML file"""
    index_file = dist_path / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {"message": "dist/index.html not found. Run: npm run build"}


# Catch-all route for SPA client-side routing
@app.get("/{full_path:path}")
async def serve_spa_routes(full_path: str):
    """Serve SPA for all non-API routes"""
    # Don't intercept API routes or static files
    if full_path.startswith("api/") or full_path.startswith("public/"):
        raise HTTPException(status_code=404, detail="Not found")

    # Serve index.html for all other routes (SPA routing)
    index_file = dist_path / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {"message": "dist/index.html not found. Run: npm run build"}


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="nirs4all backend server")
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("NIRS4ALL_PORT", 8000)),
        help="Port to run the server on (default: 8000 or NIRS4ALL_PORT env var)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Host to bind to (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--reload",
        action=argparse.BooleanOptionalAction,
        default=not DESKTOP_MODE,
        help="Enable auto-reload (default: on unless desktop mode)",
    )
    args = parser.parse_args()

    uvicorn.run(
        "main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )
