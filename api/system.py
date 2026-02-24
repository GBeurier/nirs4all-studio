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
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
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
    details: str | None = None
    traceback: str | None = None


# In-memory storage for error logs (thread-safe deque)
_error_log: deque[dict] = deque(maxlen=100)


def log_error(
    endpoint: str,
    message: str,
    level: str = "error",
    details: str | None = None,
    exc: Exception | None = None,
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


def get_error_log_entries(limit: int = 50) -> list[dict]:
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
        return nirs4all.__version__
    except ImportError:
        return "not installed"
    except AttributeError:
        return "unknown"


def _get_package_versions() -> dict[str, str]:
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
    """Health check endpoint with two-phase readiness reporting.

    Phase 1 (core_ready / ready): FastAPI running, basic endpoints work.
    Phase 2 (ml_ready): nirs4all/sklearn loaded, heavy pages functional.
    Electron waits for core_ready to show the window.
    """
    import main as _main_module
    from .lazy_imports import get_ml_status
    ml = get_ml_status()
    return {
        "status": "healthy",
        "ready": _main_module.startup_complete,
        "core_ready": _main_module.startup_complete,
        "ml_ready": ml["ml_ready"],
        "ml_loading": ml["ml_loading"],
        "message": "nirs4all webapp is running",
    }


@router.get("/system/readiness")
async def system_readiness():
    """Detailed readiness status for frontend polling."""
    import main as _main_module
    from .lazy_imports import get_ml_status
    ml = get_ml_status()
    return {
        "core_ready": _main_module.startup_complete,
        **ml,
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
            "datasets_count": len(workspace.datasets),
            "last_accessed": workspace.last_accessed if hasattr(workspace, 'last_accessed') else None,
        }

    try:
        import nirs4all
        status["nirs4all_available"] = True
    except ImportError:
        pass

    return {"status": status}


def _get_build_info() -> dict[str, Any]:
    """Get build flavor information from bundled build_info.json."""
    import json

    # Default values for development mode
    build_info = {
        "flavor": "development",
        "gpu_enabled": False,
    }

    # Check for bundled build_info.json (present in PyInstaller builds)
    try:
        # In PyInstaller builds, files are extracted to sys._MEIPASS
        if hasattr(sys, "_MEIPASS"):
            build_info_path = Path(sys._MEIPASS) / "build_info.json"
            if build_info_path.exists():
                with open(build_info_path) as f:
                    build_info = json.load(f)
    except Exception:
        pass

    return build_info


def _get_gpu_info() -> dict[str, Any]:
    """Get detailed GPU information."""
    is_macos = platform.system() == "Darwin"

    gpu_info: dict[str, Any] = {
        "cuda_available": False,
        "mps_available": False,
        "metal_available": False,
        "device_name": None,
        "device_count": 0,
        "backends": {},
    }

    # Check PyTorch CUDA
    try:
        import torch
        if torch.cuda.is_available():
            gpu_info["cuda_available"] = True
            gpu_info["device_count"] = torch.cuda.device_count()
            if gpu_info["device_count"] > 0:
                gpu_info["device_name"] = torch.cuda.get_device_name(0)
            gpu_info["backends"]["pytorch_cuda"] = {
                "available": True,
                "device_name": gpu_info["device_name"],
                "device_count": gpu_info["device_count"],
            }
        # Check MPS (Apple Silicon)
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            gpu_info["mps_available"] = True
            gpu_info["metal_available"] = is_macos
            gpu_info["backends"]["pytorch_mps"] = {"available": True}
    except ImportError:
        pass

    # Check TensorFlow GPU
    try:
        import tensorflow as tf
        gpus = tf.config.list_physical_devices("GPU")
        if gpus:
            gpu_info["backends"]["tensorflow_gpu"] = {
                "available": True,
                "device_count": len(gpus),
            }
            if not gpu_info["cuda_available"]:
                gpu_info["cuda_available"] = True
                gpu_info["device_count"] = len(gpus)
    except ImportError:
        pass

    return gpu_info


@router.get("/system/build")
async def system_build():
    """Get build information including flavor (CPU/GPU) and GPU availability."""
    build_info = _get_build_info()
    gpu_info = _get_gpu_info()

    gpu_available = (
        gpu_info["cuda_available"] or
        gpu_info["mps_available"] or
        gpu_info["metal_available"]
    )

    return {
        "build": build_info,
        "gpu": gpu_info,
        "summary": {
            "flavor": build_info.get("flavor", "unknown"),
            "gpu_build": build_info.get("gpu_enabled", False),
            "gpu_available": gpu_available,
            "gpu_type": "metal" if gpu_info["metal_available"] else ("cuda" if gpu_info["cuda_available"] else None),
            "gpu_device": gpu_info.get("device_name"),
        },
    }


@router.get("/system/capabilities")
async def system_capabilities():
    """Get available capabilities based on installed packages."""
    capabilities = {
        "nirs4all": False,
        "tensorflow": False,
        "torch": False,
        "jax": False,
        "shap": False,
        "umap": False,
        "autogluon": False,
    }

    # Check each package
    try:
        import nirs4all
        capabilities["nirs4all"] = True
    except ImportError:
        pass

    try:
        import tensorflow
        capabilities["tensorflow"] = True
    except ImportError:
        pass

    try:
        import torch
        capabilities["torch"] = True
    except ImportError:
        pass

    try:
        import jax
        capabilities["jax"] = True
    except ImportError:
        pass

    try:
        import shap
        capabilities["shap"] = True
    except ImportError:
        pass

    try:
        import umap
        capabilities["umap"] = True
    except ImportError:
        pass

    try:
        import autogluon
        capabilities["autogluon"] = True
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


class OpenFolderRequest(BaseModel):
    """Request to open a folder in the system file explorer."""
    path: str


@router.post("/system/open-folder")
async def open_folder(request: OpenFolderRequest):
    """Open a folder in the system file explorer."""
    import subprocess

    folder_path = Path(request.path)
    if not folder_path.exists():
        raise HTTPException(status_code=404, detail="Path not found")

    # If path is a file, open its parent directory
    if folder_path.is_file():
        folder_path = folder_path.parent

    try:
        if sys.platform == "win32":
            subprocess.Popen(["explorer", str(folder_path)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(folder_path)])
        else:
            subprocess.Popen(["xdg-open", str(folder_path)])
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open folder: {e}")
