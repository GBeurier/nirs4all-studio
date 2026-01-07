"""
System API routes for nirs4all webapp.

This module provides FastAPI routes for system health and information.
"""

import platform
import sys
import traceback
import uuid
from collections import deque
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

router = APIRouter()

# ============= Error Log Storage =============

class ErrorLogEntry(BaseModel):
    """Single error log entry."""
    id: str
    timestamp: str
    level: str  # "error", "warning", "critical"
    endpoint: str
    message: str
    details: Optional[str] = None
    traceback: Optional[str] = None


# In-memory storage for error logs (thread-safe deque)
_error_log: deque[dict] = deque(maxlen=100)


def log_error(
    endpoint: str,
    message: str,
    level: str = "error",
    details: Optional[str] = None,
    exc: Optional[Exception] = None,
) -> None:
    """Log an error to the in-memory store."""
    entry = {
        "id": str(uuid.uuid4())[:8],
        "timestamp": datetime.now().isoformat(),
        "level": level,
        "endpoint": endpoint,
        "message": message,
        "details": details,
        "traceback": traceback.format_exc() if exc else None,
    }
    _error_log.appendleft(entry)


def get_error_log_entries(limit: int = 50) -> List[dict]:
    """Get recent error log entries."""
    return list(_error_log)[:limit]


def clear_error_log() -> int:
    """Clear all error log entries. Returns count of cleared entries."""
    count = len(_error_log)
    _error_log.clear()
    return count


def _get_nirs4all_version() -> str:
    """Try to get nirs4all library version."""
    try:
        import nirs4all
        return getattr(nirs4all, "__version__", "unknown")
    except ImportError:
        return "not installed"


def _get_package_versions() -> Dict[str, str]:
    """Get versions of key packages."""
    packages = {}

    # Try to get versions of key packages
    package_names = [
        "numpy",
        "pandas",
        "scikit-learn",
        "scipy",
        "matplotlib",
        "tensorflow",
        "torch",
        "fastapi",
        "uvicorn",
        "webview",
    ]

    for name in package_names:
        try:
            module = __import__(name)
            version = getattr(module, "__version__", "unknown")
            packages[name] = version
        except ImportError:
            pass

    return packages


@router.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "message": "nirs4all webapp is running",
    }


@router.get("/system/info")
async def system_info():
    """Get system and environment information."""
    return {
        "python": {
            "version": sys.version,
            "platform": sys.platform,
            "executable": sys.executable,
        },
        "system": {
            "os": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "processor": platform.processor(),
        },
        "nirs4all_version": _get_nirs4all_version(),
        "packages": _get_package_versions(),
    }


@router.get("/system/status")
async def system_status():
    """Get current system status including workspace info."""
    from .workspace_manager import workspace_manager

    workspace = workspace_manager.get_current_workspace()

    status = {
        "workspace_loaded": workspace is not None,
        "workspace": None,
        "nirs4all_available": False,
    }

    if workspace:
        status["workspace"] = {
            "name": workspace.name,
            "path": workspace.path,
            "datasets_count": len(workspace.linked_datasets),
            "last_modified": workspace.last_modified.isoformat() if workspace.last_modified else None,
        }

    try:
        import nirs4all
        status["nirs4all_available"] = True
    except ImportError:
        pass

    return {"status": status}


@router.get("/system/capabilities")
async def system_capabilities():
    """Get available capabilities based on installed packages."""
    capabilities = {
        "basic": True,  # Basic functionality always available
        "nirs4all": False,  # Core nirs4all library
        "tensorflow": False,  # Deep learning with TensorFlow
        "pytorch": False,  # Deep learning with PyTorch
        "gpu_cuda": False,  # CUDA GPU support
        "gpu_mps": False,  # Apple MPS support
        "visualization": False,  # matplotlib/plotly
        "export_excel": False,  # openpyxl for Excel export
    }

    # Check nirs4all
    try:
        import nirs4all
        capabilities["nirs4all"] = True
    except ImportError:
        pass

    # Check TensorFlow
    try:
        import tensorflow as tf
        capabilities["tensorflow"] = True
        if tf.config.list_physical_devices("GPU"):
            capabilities["gpu_cuda"] = True
    except ImportError:
        pass

    # Check PyTorch
    try:
        import torch
        capabilities["pytorch"] = True
        if torch.cuda.is_available():
            capabilities["gpu_cuda"] = True
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            capabilities["gpu_mps"] = True
    except ImportError:
        pass

    # Check visualization
    try:
        import matplotlib
        capabilities["visualization"] = True
    except ImportError:
        pass

    # Check Excel export
    try:
        import openpyxl
        capabilities["export_excel"] = True
    except ImportError:
        pass

    return {"capabilities": capabilities}


@router.get("/system/paths")
async def system_paths():
    """Get important paths in the system."""
    from .workspace_manager import workspace_manager

    paths = {
        "working_directory": str(Path.cwd()),
        "home_directory": str(Path.home()),
        "python_executable": sys.executable,
    }

    workspace = workspace_manager.get_current_workspace()
    if workspace:
        paths["workspace"] = workspace.path
        paths["pipelines"] = workspace_manager.get_pipelines_path()
        paths["predictions"] = workspace_manager.get_predictions_path()

    return {"paths": paths}


# ============= Error Log Endpoints =============

@router.get("/system/errors")
async def get_errors(limit: int = Query(default=50, ge=1, le=200)):
    """Get recent error logs for debugging."""
    errors = get_error_log_entries(limit)
    return {
        "errors": errors,
        "total": len(_error_log),
        "max_stored": _error_log.maxlen or 100,
    }


@router.delete("/system/errors")
async def delete_errors():
    """Clear all error logs."""
    count = clear_error_log()
    return {
        "success": True,
        "cleared": count,
    }
