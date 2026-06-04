"""
System API routes for nirs4all Studio.

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
from api.telemetry import capture_exception

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
    if exc:
        capture_exception(
            exc,
            tags={
                "endpoint": endpoint,
                "level": level,
                "surface": "backend_error_log",
            },
        )


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
        return nirs4all.__version__
    except ImportError:
        return "not installed"
    except AttributeError:
        return "unknown"


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
        "message": "nirs4all Studio is running",
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


def _get_build_info() -> Dict[str, Any]:
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
                with open(build_info_path, "r") as f:
                    build_info = json.load(f)
    except Exception:
        pass

    return build_info


def _get_gpu_info() -> Dict[str, Any]:
    """Get detailed GPU information."""
    is_macos = platform.system() == "Darwin"

    gpu_info: Dict[str, Any] = {
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


def _operator_node_summary(method: Dict[str, Any], operator_type: str) -> Dict[str, Any]:
    """Build a compact node-like summary from a live operator definition."""
    name = str(method.get("name") or "")
    display_name = method.get("display_name") or method.get("displayName") or name
    node_id = str(method.get("id") or f"{operator_type}:{name}")

    return {
        "id": node_id,
        "name": name,
        "displayName": display_name,
        "type": method.get("type") or operator_type,
        "category": method.get("category", "other"),
        "source": method.get("source", "unknown"),
        "available": bool(name),
    }


def _build_operator_availability_response(
    catalog: Dict[str, Any],
    *,
    error: Optional[str] = None,
) -> Dict[str, Any]:
    """Return a backwards-compatible operator availability payload.

    Older desktop builds used a generated node-definition reference for this
    endpoint and raised a 500 when that reference was empty. The current app
    uses live backend introspection, so this compatibility shape deliberately
    degrades to a 200 response even if no operators can be discovered.
    """
    operator_types = ("preprocessing", "augmentation", "splitting", "filter")
    counts: Dict[str, int] = {}
    nodes: List[Dict[str, Any]] = []
    operators: Dict[str, List[str]] = {}

    for operator_type in operator_types:
        methods = catalog.get(operator_type) or []
        if not isinstance(methods, list):
            methods = []

        typed_nodes = [
            _operator_node_summary(method, operator_type)
            for method in methods
            if isinstance(method, dict)
        ]
        nodes.extend(typed_nodes)
        counts[operator_type] = len(typed_nodes)
        operators[operator_type] = [
            node["name"]
            for node in typed_nodes
            if node.get("name")
        ]

    discovered_total = sum(counts.values())
    if discovered_total == 0:
        try:
            discovered_total = int(catalog.get("total") or 0)
        except (TypeError, ValueError):
            discovered_total = 0

    reason = error
    if reason is None and discovered_total == 0:
        reason = "No operators discovered from live backend introspection"

    status = "available" if discovered_total > 0 else "degraded"

    return {
        "available": discovered_total > 0,
        "status": status,
        "source": "playground-live-introspection",
        "reason": reason,
        "total": discovered_total,
        "counts": counts,
        "operators": operators,
        "reference": {
            "version": "playground-live-introspection",
            "generatedAt": datetime.now().isoformat(),
            "totalNodes": discovered_total,
            "nodes": nodes,
        },
    }


@router.get("/system/operator-availability")
async def system_operator_availability():
    """Compatibility endpoint for operator availability diagnostics.

    This route intentionally never raises when the operator registry is empty.
    It replaces the old generated node-definition reference with the live
    playground operator catalog used by the current UI.
    """
    try:
        from .playground import list_operators

        catalog = await list_operators()
    except Exception as exc:
        return _build_operator_availability_response(
            {},
            error=f"Operator catalog introspection failed: {exc.__class__.__name__}",
        )

    return _build_operator_availability_response(catalog)


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
