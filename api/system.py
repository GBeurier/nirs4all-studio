"""
System API routes for nirs4all webapp.

This module provides FastAPI routes for system health and information.
"""

import json
import os
import platform
import sys
import traceback
import uuid
from collections import deque
from datetime import datetime
from importlib import metadata as importlib_metadata
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .node_registry_loader import load_editor_registry_reference
from .recommended_config import (
    _get_filtered_optional_config,
    _load_active_raw_config,
    _normalize_pkg_name,
)
from .shared.gpu_detection import detect_gpu_hardware
from .venv_manager import venv_manager
from .workspace_manager import workspace_manager

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


def _load_operator_reference() -> dict[str, Any]:
    """Load the backend's authoritative editor operator registry reference."""
    reference = load_editor_registry_reference()
    if not reference.get("nodes"):
        raise HTTPException(
            status_code=500,
            detail="Operator registry reference could not be loaded from node definitions",
        )
    return reference


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


def _get_runtime_mode() -> str:
    """Return the runtime mode reported by Electron/backend startup."""
    runtime_mode = os.environ.get("NIRS4ALL_RUNTIME_MODE")
    if runtime_mode:
        return runtime_mode
    if hasattr(sys, "_MEIPASS"):
        return "pyinstaller"
    return "development"


CORE_RUNTIME_PACKAGES = ("fastapi", "uvicorn", "nirs4all")


def _norm_path(path_value: str) -> str:
    """Normalize a path for reliable cross-platform equality checks."""
    return os.path.normcase(os.path.normpath(os.path.realpath(path_value)))


def _load_desktop_env_settings() -> dict[str, Any] | None:
    """Load Electron's persisted env-settings.json when available."""
    settings_path = os.environ.get("NIRS4ALL_ENV_SETTINGS_PATH")
    if not settings_path:
        return None

    try:
        with open(settings_path, encoding="utf-8") as f:
            loaded = json.load(f)
    except Exception:
        return None

    return loaded if isinstance(loaded, dict) else None


def _get_configured_python() -> str | None:
    """Resolve the Python executable Electron is currently configured to use."""
    settings = _load_desktop_env_settings()
    configured = settings.get("pythonPath") if settings else None
    if isinstance(configured, str) and configured.strip():
        return configured.strip()

    expected = os.environ.get("NIRS4ALL_EXPECTED_PYTHON", "").strip()
    return expected or None


def _get_runtime_kind() -> str:
    """Return the backend runtime kind reported by Electron startup."""
    runtime_kind = os.environ.get("NIRS4ALL_RUNTIME_KIND")
    if runtime_kind:
        return runtime_kind
    return _get_runtime_mode()


def _is_bundled_default_runtime() -> bool:
    """Return whether the backend is still using the bundled default runtime."""
    return os.environ.get("NIRS4ALL_IS_BUNDLED_DEFAULT", "").strip().lower() == "true"


def _is_bundled_runtime_available() -> bool:
    """Return whether Electron reported an embedded bundled runtime."""
    return os.environ.get("NIRS4ALL_BUNDLED_RUNTIME_AVAILABLE", "").strip().lower() == "true"


def _get_installed_distribution_names() -> set[str]:
    """Return normalized distribution names installed in the running interpreter."""
    installed: set[str] = set()

    try:
        for dist in importlib_metadata.distributions():
            name = dist.metadata.get("Name")
            if name:
                installed.add(_normalize_pkg_name(name))
    except Exception:
        pass

    if _get_nirs4all_version() not in {"not installed", "unknown"}:
        installed.add("nirs4all")

    return installed


def _get_missing_core_packages(installed_packages: set[str]) -> list[str]:
    """Return backend-core package names missing from the running interpreter."""
    return [
        package_name
        for package_name in CORE_RUNTIME_PACKAGES
        if _normalize_pkg_name(package_name) not in installed_packages
    ]


def _get_missing_optional_packages(installed_packages: set[str]) -> list[str]:
    """Return optional runtime packages missing from the running interpreter."""
    try:
        raw_config = _load_active_raw_config()
        optional_config = _get_filtered_optional_config(raw_config)
    except Exception:
        return []

    return [
        package_name
        for package_name in optional_config
        if _normalize_pkg_name(package_name) not in installed_packages
    ]


def _get_gpu_info() -> dict[str, Any]:
    """Get detailed GPU information."""
    detected = detect_gpu_hardware()
    gpu_info: dict[str, Any] = {
        "cuda_available": detected.has_cuda,
        "mps_available": detected.has_metal,
        "metal_available": detected.has_metal,
        "device_name": detected.gpu_name,
        "device_count": 1 if detected.gpu_name else 0,
        "cuda_version": detected.cuda_version,
        "driver_version": detected.driver_version,
        "torch_cuda_available": detected.torch_cuda_available,
        "torch_version": detected.torch_version,
        "detection_source": detected.detection_source,
        "backends": {},
    }

    if detected.has_cuda:
        gpu_info["backends"]["cuda_hardware"] = {
            "available": True,
            "device_name": detected.gpu_name,
            "driver_version": detected.driver_version,
        }

    if detected.torch_cuda_available:
        gpu_info["backends"]["pytorch_cuda"] = {
            "available": True,
            "device_name": detected.gpu_name,
            "cuda_version": detected.cuda_version,
        }

    if detected.has_metal:
        gpu_info["backends"]["pytorch_mps"] = {"available": True}

    return gpu_info


@router.get("/system/build")
async def system_build():
    """Get build information including flavor (CPU/GPU) and GPU availability."""
    build_info = _get_build_info()
    gpu_info = _get_gpu_info()
    runtime_mode = _get_runtime_mode()

    gpu_available = (
        gpu_info["cuda_available"] or
        gpu_info["mps_available"] or
        gpu_info["metal_available"]
    )

    return {
        "build": build_info,
        "gpu": gpu_info,
        "runtime_mode": runtime_mode,
        "is_frozen": hasattr(sys, "_MEIPASS"),
        "summary": {
            "flavor": build_info.get("flavor", "unknown"),
            "gpu_build": build_info.get("gpu_enabled", False),
            "gpu_available": gpu_available,
            "gpu_type": "metal" if gpu_info["metal_available"] else ("cuda" if gpu_info["cuda_available"] else None),
            "gpu_device": gpu_info.get("device_name"),
            "runtime_mode": runtime_mode,
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


@router.get("/system/operator-availability")
async def system_operator_availability():
    """Get backend-authoritative availability for executable editor operators."""
    from .nirs4all_adapter import check_pipeline_imports

    reference = _load_operator_reference()
    executable_types = {"preprocessing", "y_processing", "splitting", "model", "filter", "augmentation"}
    unavailable: list[dict[str, str | None]] = []
    checked_count = 0

    for node in reference.get("nodes", []):
        node_type = str(node.get("type", "") or "")
        if node_type not in executable_types:
            continue

        checked_count += 1
        issues = check_pipeline_imports([{
            "id": node.get("id"),
            "name": node.get("name"),
            "type": node_type,
            "classPath": node.get("classPath"),
            "functionPath": node.get("functionPath"),
        }])
        if not issues:
            continue

        issue = issues[0]
        unavailable.append({
            "id": str(node.get("id", "") or ""),
            "name": str(node.get("name", "") or ""),
            "type": node_type,
            "class_path": str(node.get("classPath", "") or "") or None,
            "function_path": str(node.get("functionPath", "") or "") or None,
            "error": issue.get("error"),
        })

    return {
        "registry_version": reference.get("version"),
        "generated_at": reference.get("generatedAt"),
        "computed_at": datetime.now().isoformat(),
        "checked_count": checked_count,
        "unavailable": unavailable,
    }


@router.get("/system/paths")
async def system_paths():
    """Get important paths in the system."""
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


# ============= Environment Coherence =============


@router.get("/system/env-coherence")
async def check_env_coherence() -> dict[str, Any]:
    """Return the runtime summary used by desktop environment diagnostics."""
    vm_python = str(venv_manager.python_executable)
    runtime_python = sys.executable
    vm_prefix = str(venv_manager.venv_path)
    runtime_prefix = sys.prefix
    configured_python = _get_configured_python()
    configured_matches_running = (
        True if not configured_python else _norm_path(configured_python) == _norm_path(runtime_python)
    )
    python_match = _norm_path(vm_python) == _norm_path(runtime_python)
    prefix_match = _norm_path(vm_prefix) == _norm_path(runtime_prefix)
    installed_packages = _get_installed_distribution_names()
    missing_core_packages = _get_missing_core_packages(installed_packages)
    missing_optional_packages = _get_missing_optional_packages(installed_packages)

    import main as _main_module

    coherent = configured_matches_running

    result: dict[str, Any] = {
        "coherent": coherent,
        "configured_python": configured_python,
        "running_python": runtime_python,
        "running_prefix": runtime_prefix,
        "runtime_kind": _get_runtime_kind(),
        "is_bundled_default": _is_bundled_default_runtime(),
        "bundled_runtime_available": _is_bundled_runtime_available(),
        "configured_matches_running": configured_matches_running,
        "core_ready": _main_module.startup_complete and not missing_core_packages,
        "missing_core_packages": missing_core_packages,
        "missing_optional_packages": missing_optional_packages,
        "python_match": python_match,
        "prefix_match": prefix_match,
        "runtime": {
            "python": runtime_python,
            "prefix": runtime_prefix,
            "version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        },
        "venv_manager": {
            "python": vm_python,
            "prefix": vm_prefix,
        },
    }

    if configured_python:
        result["electron_expected_python"] = configured_python
        result["electron_match"] = configured_matches_running

    return result


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
