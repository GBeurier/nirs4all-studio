"""
Optional-dependency management endpoints.

Install / uninstall / revert / update / refresh of nirs4all optional packages,
plus the dependency-scan response. Shared state (``venv_manager``,
``_dependencies_cache``, ``NIRS4ALL_OPTIONAL_DEPS``) is reached through the
``api.updates`` package so the test suite can patch ``api.updates.venv_manager``
/ ``api.updates._dependencies_cache`` and have it take effect here.
"""

import os
import sys
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException

from api import updates as _u

from .catalog import (
    RESTART_REQUIRED_PACKAGES,
    DependenciesResponse,
    DependencyCategory,
    DependencyInfo,
    PackageInstallRequest,
    PackageUninstallRequest,
    _is_profile_managed_dependency,
    _normalize_dependency_name,
    logger,
)
from .manager import HTTPX_AVAILABLE

if HTTPX_AVAILABLE:
    import httpx
else:
    import urllib.error
    import urllib.request

router = APIRouter()


async def _get_pypi_version(package: str) -> str | None:
    """Get the latest version of a package from PyPI."""
    import json

    # Normalize package name for PyPI
    pypi_name = package.replace("_", "-")
    api_url = f"https://pypi.org/pypi/{pypi_name}/json"

    try:
        if HTTPX_AVAILABLE:
            async with httpx.AsyncClient() as client:
                response = await client.get(api_url, timeout=10.0)
                if response.status_code == 200:
                    data = response.json()
                    return data.get("info", {}).get("version")
        else:
            req = urllib.request.Request(api_url)
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read().decode("utf-8"))
                return data.get("info", {}).get("version")
    except Exception:
        pass
    return None


@router.get("/dependencies")
async def get_dependencies(force_refresh: bool = False) -> DependenciesResponse:
    """
    Get all nirs4all optional dependencies with their installation status.

    Returns cached results if available. Use force_refresh=true to bypass cache.
    """
    runtime_info = _u.venv_manager.get_venv_info()
    runtime_path = str(runtime_info.path)

    # Check cache first (unless force refresh)
    if not force_refresh:
        cached = _u._dependencies_cache.get(runtime_path)
        if cached:
            current_nirs4all_version = _u.venv_manager.get_nirs4all_version()
            if not isinstance(current_nirs4all_version, str):
                current_nirs4all_version = cached.get("nirs4all_version")
            current_nirs4all_installed = current_nirs4all_version is not None
            cached_categories = [DependencyCategory(**cat) for cat in cached.get("categories", [])]
            total_installed = sum(cat.installed_count for cat in cached_categories)
            total_packages = sum(cat.total_count for cat in cached_categories)
            # Return cached data
            return DependenciesResponse(
                categories=cached_categories,
                runtime_valid=runtime_info.is_valid,
                runtime_path=runtime_path,
                venv_valid=runtime_info.is_valid,
                venv_path=runtime_path,
                nirs4all_installed=current_nirs4all_installed,
                nirs4all_version=current_nirs4all_version,
                total_installed=total_installed,
                total_packages=total_packages,
                cached_at=cached.get("cached_at"),
            )

    installed_packages = {}

    # Get installed packages from venv
    if runtime_info.is_valid:
        for pkg in _u.venv_manager.get_installed_packages():
            installed_packages[pkg.name.lower()] = pkg.version

    # Get outdated packages for update detection
    outdated_packages = {}
    if runtime_info.is_valid:
        for pkg in _u.venv_manager.get_outdated_packages():
            outdated_packages[pkg["name"].lower()] = pkg["latest_version"]

    categories = []
    total_installed = 0
    total_packages = 0

    for cat_id, cat_data in _u.NIRS4ALL_OPTIONAL_DEPS.items():
        packages = []
        cat_installed = 0

        for pkg_def in cat_data["packages"]:
            pkg_name = pkg_def["name"]
            pkg_name_lower = pkg_name.lower()
            # Also check with underscore/hyphen variants
            pkg_name_alt = pkg_name.replace("-", "_").lower()

            installed_version = installed_packages.get(pkg_name_lower) or installed_packages.get(pkg_name_alt)
            is_installed = installed_version is not None
            latest_version = outdated_packages.get(pkg_name_lower) or outdated_packages.get(pkg_name_alt)
            is_outdated = latest_version is not None and is_installed

            recommended = pkg_def.get("recommended_version")
            is_below_recommended = False
            is_above_recommended = False
            if is_installed and recommended and installed_version:
                try:
                    from packaging import version as pkg_version
                    installed_parsed = pkg_version.parse(installed_version)
                    recommended_parsed = pkg_version.parse(recommended)
                    is_below_recommended = installed_parsed < recommended_parsed
                    is_above_recommended = installed_parsed > recommended_parsed
                except Exception:
                    pass

            dep_info = DependencyInfo(
                name=pkg_name,
                category=cat_id,
                category_name=cat_data["name"],
                description=pkg_def["description"],
                min_version=pkg_def["min_version"],
                recommended_version=recommended,
                installed_version=installed_version,
                latest_version=latest_version,
                is_installed=is_installed,
                is_outdated=is_outdated,
                is_below_recommended=is_below_recommended,
                is_above_recommended=is_above_recommended,
                can_update=is_outdated,
                default_install=bool(pkg_def.get("default_install", False)),
                managed_by_profile=bool(pkg_def.get("managed_by_profile", False)),
            )
            packages.append(dep_info)

            if is_installed:
                cat_installed += 1
                total_installed += 1
            total_packages += 1

        categories.append(DependencyCategory(
            id=cat_id,
            name=cat_data["name"],
            description=cat_data["description"],
            packages=packages,
            installed_count=cat_installed,
            total_count=len(packages),
        ))

    # Check nirs4all installation
    nirs4all_version = _u.venv_manager.get_nirs4all_version()
    nirs4all_installed = nirs4all_version is not None

    # Cache the results
    cache_data = {
        "categories": [cat.model_dump() for cat in categories],
        "runtime_valid": runtime_info.is_valid,
        "runtime_path": runtime_path,
        "venv_valid": runtime_info.is_valid,
        "nirs4all_installed": nirs4all_installed,
        "nirs4all_version": nirs4all_version,
        "total_installed": total_installed,
        "total_packages": total_packages,
    }
    _u._dependencies_cache.set(runtime_path, cache_data)

    return DependenciesResponse(
        categories=categories,
        runtime_valid=runtime_info.is_valid,
        runtime_path=runtime_path,
        venv_valid=runtime_info.is_valid,
        venv_path=runtime_path,
        nirs4all_installed=nirs4all_installed,
        nirs4all_version=nirs4all_version,
        total_installed=total_installed,
        total_packages=total_packages,
        cached_at=datetime.now().isoformat(),
    )


def _ensure_runtime_mutable() -> None:
    """Raise when the current runtime must not be mutated in place."""
    runtime_mode = str(os.environ.get("NIRS4ALL_RUNTIME_MODE", "")).strip().lower()
    if getattr(sys, "_MEIPASS", None):
        raise HTTPException(
            status_code=400,
            detail="Package management is not available in this packaged backend mode.",
        )
    if runtime_mode == "bundled":
        raise HTTPException(
            status_code=400,
            detail=(
                "This action would modify the embedded bundled Python runtime. "
                "Switch to an external Python runtime in Settings first."
            ),
        )


def _ensure_runtime_is_valid() -> None:
    """Raise when the current runtime cannot be managed safely."""
    if _u.venv_manager.get_venv_info().is_valid:
        return

    raise HTTPException(
        status_code=400,
        detail=(
            "The current Python runtime is not valid. Use the Python Runtime "
            "settings to select or create a runtime, then retry."
        ),
    )


@router.post("/dependencies/install")
async def install_dependency(request: PackageInstallRequest) -> dict[str, Any]:
    """
    Install a package in the current Python runtime.

    Args:
        request: Package name and optional version

    Returns:
        Installation result with status and output
    """
    _u._ensure_runtime_mutable()
    _u._ensure_runtime_is_valid()

    if _is_profile_managed_dependency(request.package):
        if request.target == "latest" or request.upgrade:
            raise HTTPException(
                status_code=400,
                detail="torch follows the active compute profile. Updating it to the latest PyPI build is not supported here.",
            )

        from .. import recommended_config as rc

        raw_config = rc._load_active_raw_config()
        profile = rc._resolve_effective_profile(raw_config)
        package_name = next(
            (
                name
                for name in raw_config.get("optional", {})
                if _normalize_dependency_name(name) == _normalize_dependency_name(request.package)
            ),
            request.package,
        )
        result = await rc.align_config(
            rc.AlignConfigRequest(profile=profile, optional_packages=[package_name]),
        )
        if not result.success:
            raise HTTPException(status_code=500, detail=result.message)

        _u._dependencies_cache.invalidate()
        installed_version = _u.venv_manager.get_package_version(request.package)
        return {
            "success": True,
            "message": result.message,
            "package": request.package,
            "version": installed_version,
            "output": [*result.installed, *result.upgraded],
            "requires_restart": request.package.lower() in RESTART_REQUIRED_PACKAGES,
        }

    # Determine version to install based on target
    install_version = request.version
    install_upgrade = request.upgrade
    if not install_version:
        if request.target == "latest" or install_upgrade:
            install_upgrade = True
        elif request.target == "recommended" or request.target is None:
            # Look up recommended version from NIRS4ALL_OPTIONAL_DEPS
            for _cat_id, cat_data in _u.NIRS4ALL_OPTIONAL_DEPS.items():
                for pkg_def in cat_data.get("packages", []):
                    if pkg_def["name"].lower() == request.package.lower():
                        recommended = pkg_def.get("recommended_version")
                        if recommended:
                            install_version = recommended
                        break

    # Install the package
    success, message, output = _u.venv_manager.install_package(
        request.package,
        version=install_version,
        upgrade=install_upgrade,
    )

    if not success:
        # Add an actionable hint when installing JAX-stack packages on Windows:
        # jaxlib has no official Windows wheels, so flax/jax/jaxlib installs
        # routinely fail at dependency resolution.
        detail = message
        if sys.platform == "win32" and request.package.lower() in {"jax", "jaxlib", "flax"}:
            joined = "\n".join(output).lower() if output else ""
            if "jaxlib" in joined or "could not find a version" in joined or "no matching distribution" in joined:
                detail = (
                    f"{message}\n\n"
                    "Hint: jaxlib has no official Windows wheels. Installing "
                    "jax/jaxlib/flax on native Windows is not supported by upstream. "
                    "Use WSL2, or skip the JAX backend (PyTorch and TensorFlow work natively)."
                )
        logger.error("Install of %s failed: %s", request.package, detail)
        raise HTTPException(status_code=500, detail=detail)

    # Invalidate cache after install
    _u._dependencies_cache.invalidate()

    # Get the installed version
    installed_version = _u.venv_manager.get_package_version(request.package)

    return {
        "success": True,
        "message": message,
        "package": request.package,
        "version": installed_version,
        "output": output[-30:],  # Last 30 lines
        "requires_restart": request.package.lower() in RESTART_REQUIRED_PACKAGES,
    }


@router.post("/dependencies/uninstall")
async def uninstall_dependency(request: PackageUninstallRequest) -> dict[str, Any]:
    """
    Uninstall a package from the current Python runtime.

    Args:
        request: Package name

    Returns:
        Uninstallation result
    """
    _u._ensure_runtime_mutable()
    _u._ensure_runtime_is_valid()

    success, message = _u.venv_manager.uninstall_package(request.package)

    if not success:
        raise HTTPException(status_code=500, detail=message)

    # Invalidate cache after uninstall
    _u._dependencies_cache.invalidate()

    return {
        "success": True,
        "message": message,
        "package": request.package,
        "requires_restart": request.package.lower() in RESTART_REQUIRED_PACKAGES,
    }


@router.post("/dependencies/revert")
async def revert_dependency(request: PackageUninstallRequest) -> dict[str, Any]:
    """Revert a package to its recommended version."""
    _u._ensure_runtime_mutable()
    _u._ensure_runtime_is_valid()

    if _is_profile_managed_dependency(request.package):
        from .. import recommended_config as rc

        raw_config = rc._load_active_raw_config()
        profile = rc._resolve_effective_profile(raw_config)
        package_name = next(
            (
                name
                for name in raw_config.get("optional", {})
                if _normalize_dependency_name(name) == _normalize_dependency_name(request.package)
            ),
            request.package,
        )
        result = await rc.align_config(
            rc.AlignConfigRequest(profile=profile, optional_packages=[package_name]),
        )
        if not result.success:
            raise HTTPException(status_code=500, detail=result.message)

        _u._dependencies_cache.invalidate()
        new_version = _u.venv_manager.get_package_version(request.package)
        return {
            "success": True,
            "message": result.message,
            "package": request.package,
            "version": new_version,
            "output": [*result.installed, *result.upgraded],
            "requires_restart": request.package.lower() in RESTART_REQUIRED_PACKAGES,
        }

    pkg_info = None
    for _cat_id, cat_data in _u.NIRS4ALL_OPTIONAL_DEPS.items():
        for pkg_def in cat_data.get("packages", []):
            if pkg_def["name"].lower() == request.package.lower():
                pkg_info = pkg_def
                break
        if pkg_info:
            break

    if not pkg_info:
        raise HTTPException(status_code=404, detail=f"Unknown package: {request.package}")

    recommended = pkg_info.get("recommended_version")
    if not recommended:
        raise HTTPException(status_code=400, detail=f"No recommended version for {request.package}")

    success, message, output = _u.venv_manager.install_package(request.package, version=recommended)
    _u._dependencies_cache.invalidate()

    new_version = _u.venv_manager.get_package_version(request.package)
    requires_restart = request.package.lower() in RESTART_REQUIRED_PACKAGES

    return {
        "success": success,
        "message": message,
        "package": request.package,
        "version": new_version,
        "output": output,
        "requires_restart": requires_restart,
    }


@router.post("/dependencies/update")
async def update_dependency(request: PackageInstallRequest) -> dict[str, Any]:
    """
    Update a package to the latest version.

    Args:
        request: Package name

    Returns:
        Update result with new version
    """
    _u._ensure_runtime_mutable()

    if _is_profile_managed_dependency(request.package):
        raise HTTPException(
            status_code=400,
            detail="torch is managed by the active compute profile. Use Config Alignment or rerun setup to switch CPU/GPU variants.",
        )

    _u._ensure_runtime_is_valid()

    # Update the package
    success, message, output = _u.venv_manager.install_package(
        request.package,
        upgrade=True,
    )

    if not success:
        raise HTTPException(status_code=500, detail=message)

    # Invalidate cache after update
    _u._dependencies_cache.invalidate()

    # Get the new version
    installed_version = _u.venv_manager.get_package_version(request.package)

    return {
        "success": True,
        "message": message,
        "package": request.package,
        "version": installed_version,
        "output": output[-30:],
        "requires_restart": request.package.lower() in RESTART_REQUIRED_PACKAGES,
    }


@router.post("/dependencies/refresh")
async def refresh_dependencies() -> dict[str, Any]:
    """
    Force refresh the dependencies cache.

    This invalidates the cache and forces a fresh scan.
    """
    # Invalidate cache
    _u._dependencies_cache.invalidate()

    # Return success - the next get_dependencies call will do a fresh scan
    return {
        "success": True,
        "message": "Dependencies cache cleared. Next request will do a fresh scan.",
    }
