"""
Recommended config management API for nirs4all webapp.

Provides endpoints for:
- Fetching the recommended config (bundled fallback + remote update)
- Comparing installed packages vs. recommended config
- Applying recommended config (align packages)
- First-launch detection and compute profile selection
"""

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .shared.logger import get_logger
from .venv_manager import _user_data_dir, venv_manager

logger = get_logger(__name__)

# Try to import httpx for async HTTP requests
try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False
    import urllib.error
    import urllib.request

router = APIRouter(prefix="/config", tags=["config"])

APP_NAME = "nirs4all-webapp"
APP_AUTHOR = "nirs4all"
GITHUB_RAW_URL = "https://raw.githubusercontent.com/GBeurier/nirs4all-webapp/main/recommended-config.json"


# ============= Data Models =============


class ProfileInfo(BaseModel):
    """A compute profile (e.g., cpu, gpu-cuda-torch)."""
    id: str
    label: str
    description: str
    packages: dict[str, str]
    platforms: list[str] = []


class OptionalPackageInfo(BaseModel):
    """An optional package from the recommended config."""
    name: str
    version: str
    description: str
    category: str


class RecommendedConfigResponse(BaseModel):
    """Full recommended config."""
    schema_version: str
    app_version: str
    nirs4all: str
    profiles: list[ProfileInfo]
    optional: list[OptionalPackageInfo]
    fetched_from: str  # "bundled" or "remote"
    fetched_at: str


class PackageDiff(BaseModel):
    """Difference between installed and recommended for a single package."""
    name: str
    installed_version: str | None = None
    recommended_version: str
    status: str  # "aligned", "outdated", "missing", "extra"
    action: str | None = None  # "install", "upgrade", "none"


class ConfigComparisonResponse(BaseModel):
    """Comparison of installed packages vs. recommended config."""
    profile: str | None = None
    profile_label: str | None = None
    packages: list[PackageDiff]
    aligned_count: int
    misaligned_count: int
    missing_count: int
    is_aligned: bool
    checked_at: str


class AlignConfigRequest(BaseModel):
    """Request to align packages with recommended config."""
    profile: str
    optional_packages: list[str] = []
    dry_run: bool = False


class AlignConfigResponse(BaseModel):
    """Result of aligning packages."""
    success: bool
    message: str
    installed: list[str] = []
    upgraded: list[str] = []
    failed: list[str] = []
    dry_run: bool = False


class SetupStatusResponse(BaseModel):
    """Whether first-launch setup has been completed."""
    setup_completed: bool
    selected_profile: str | None = None
    completed_at: str | None = None


class GPUDetectionResponse(BaseModel):
    """Detected GPU hardware."""
    has_cuda: bool = False
    has_metal: bool = False
    cuda_version: str | None = None
    gpu_name: str | None = None
    recommended_profiles: list[str]


class CompleteSetupRequest(BaseModel):
    """Mark setup as completed."""
    profile: str
    optional_packages: list[str] = []


# ============= Config Cache =============


class RecommendedConfigCache:
    """Caches the recommended config fetched from remote."""

    CACHE_FILE = "recommended_config_cache.json"
    SETUP_FILE = "setup_status.json"
    CACHE_TTL_HOURS = 24

    def __init__(self):
        self._app_data_dir = Path(_user_data_dir(APP_NAME, APP_AUTHOR))
        self._cache_path = self._app_data_dir / self.CACHE_FILE
        self._setup_path = self._app_data_dir / self.SETUP_FILE

    def get_cached_config(self) -> dict[str, Any] | None:
        """Get cached config if fresh enough."""
        if not self._cache_path.exists():
            return None
        try:
            with open(self._cache_path, encoding="utf-8") as f:
                data = json.load(f)
            cached_at = datetime.fromisoformat(data.get("cached_at", "2000-01-01"))
            if datetime.now() - cached_at > timedelta(hours=self.CACHE_TTL_HOURS):
                return None
            return data.get("config")
        except Exception:
            return None

    def set_cached_config(self, config: dict[str, Any]) -> None:
        """Cache a config."""
        self._app_data_dir.mkdir(parents=True, exist_ok=True)
        try:
            with open(self._cache_path, "w", encoding="utf-8") as f:
                json.dump({"cached_at": datetime.now().isoformat(), "config": config}, f, indent=2)
        except Exception as e:
            logger.warning("Could not save recommended config cache: %s", e)

    def get_setup_status(self) -> dict[str, Any]:
        """Get first-launch setup status."""
        if not self._setup_path.exists():
            return {"setup_completed": False, "selected_profile": None, "completed_at": None}
        try:
            with open(self._setup_path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"setup_completed": False, "selected_profile": None, "completed_at": None}

    def set_setup_status(self, profile: str) -> None:
        """Mark setup as completed."""
        self._app_data_dir.mkdir(parents=True, exist_ok=True)
        data = {
            "setup_completed": True,
            "selected_profile": profile,
            "completed_at": datetime.now().isoformat(),
        }
        try:
            with open(self._setup_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.warning("Could not save setup status: %s", e)


_config_cache = RecommendedConfigCache()


# ============= Helper Functions =============


def _load_bundled_config() -> dict[str, Any]:
    """Load the bundled recommended-config.json shipped with the app."""
    # Try multiple locations: dev (repo root), production (resources/backend/)
    candidates = [
        Path(__file__).parent.parent / "recommended-config.json",
        Path(__file__).parent / "recommended-config.json",
    ]
    for path in candidates:
        if path.exists():
            with open(path, encoding="utf-8") as f:
                return json.load(f)
    raise FileNotFoundError("Bundled recommended-config.json not found")


async def _fetch_remote_config() -> dict[str, Any] | None:
    """Fetch recommended config from GitHub."""
    try:
        if HTTPX_AVAILABLE:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(GITHUB_RAW_URL)
                if response.status_code == 200:
                    return response.json()
        else:
            req = urllib.request.Request(GITHUB_RAW_URL, headers={"User-Agent": "nirs4all-webapp"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode())
    except Exception as e:
        logger.debug("Could not fetch remote recommended config: %s", e)
    return None


def _parse_config(raw: dict[str, Any], source: str) -> RecommendedConfigResponse:
    """Parse raw config dict into response model."""
    profiles = []
    for pid, pdata in raw.get("profiles", {}).items():
        profiles.append(ProfileInfo(
            id=pid,
            label=pdata.get("label", pid),
            description=pdata.get("description", ""),
            packages=pdata.get("packages", {}),
            platforms=pdata.get("platforms", []),
        ))

    optional = []
    for name, odata in raw.get("optional", {}).items():
        optional.append(OptionalPackageInfo(
            name=name,
            version=odata.get("version", ""),
            description=odata.get("description", ""),
            category=odata.get("category", "other"),
        ))

    return RecommendedConfigResponse(
        schema_version=raw.get("schema_version", "1.0"),
        app_version=raw.get("app_version", ""),
        nirs4all=raw.get("nirs4all", ""),
        profiles=profiles,
        optional=optional,
        fetched_from=source,
        fetched_at=datetime.now().isoformat(),
    )


def _get_installed_packages() -> dict[str, str]:
    """Get dict of installed package names → versions from the venv."""
    try:
        packages = venv_manager.get_installed_packages()
        return {pkg.name.lower().replace("-", "_"): pkg.version for pkg in packages}
    except Exception as e:
        logger.warning("Could not list installed packages: %s", e)
        return {}


def _normalize_pkg_name(name: str) -> str:
    """Normalize package name for comparison (PEP 503)."""
    return re.sub(r"[-_.]+", "_", name).lower()


def _version_satisfies(installed: str, spec: str) -> bool:
    """Check if installed version satisfies a version spec like '>=0.7.1'."""
    try:
        from packaging.specifiers import SpecifierSet
        from packaging.version import Version
        return Version(installed) in SpecifierSet(spec)
    except ImportError:
        # Fallback: simple >= check
        if spec.startswith(">="):
            required = spec[2:]
            return _compare_versions(installed, required) >= 0
        return True
    except Exception:
        return True


def _compare_versions(v1: str, v2: str) -> int:
    """Simple version comparison. Returns -1, 0, or 1."""
    def parse(v):
        return [int(x) for x in re.sub(r"[^0-9.]", "", v).split(".") if x]
    p1, p2 = parse(v1), parse(v2)
    for a, b in zip(p1, p2):
        if a < b:
            return -1
        if a > b:
            return 1
    return len(p1) - len(p2)


def _detect_gpu() -> GPUDetectionResponse:
    """Detect available GPU hardware."""
    has_cuda = False
    has_metal = False
    cuda_version = None
    gpu_name = None
    recommended = ["cpu"]

    # Check CUDA via nvidia-smi
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            parts = result.stdout.strip().split(",")
            gpu_name = parts[0].strip()
            has_cuda = True
    except Exception:
        pass

    # Check CUDA version
    if has_cuda:
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                cuda_version = result.stdout.strip()
        except Exception:
            pass

    # Check Metal (macOS)
    if sys.platform == "darwin":
        import platform as plat
        if plat.machine() == "arm64":
            has_metal = True

    if has_cuda:
        recommended = ["gpu-cuda-torch", "gpu-cuda-tf", "cpu"]
    elif has_metal:
        recommended = ["gpu-metal", "cpu"]

    return GPUDetectionResponse(
        has_cuda=has_cuda,
        has_metal=has_metal,
        cuda_version=cuda_version,
        gpu_name=gpu_name,
        recommended_profiles=recommended,
    )


# ============= API Endpoints =============


@router.get("/recommended", response_model=RecommendedConfigResponse)
async def get_recommended_config(force_refresh: bool = False):
    """Get the recommended configuration.

    Returns bundled config, optionally refreshed from GitHub.
    """
    if not force_refresh:
        cached = _config_cache.get_cached_config()
        if cached:
            return _parse_config(cached, "remote")

    # Try remote first
    remote = await _fetch_remote_config()
    if remote:
        _config_cache.set_cached_config(remote)
        return _parse_config(remote, "remote")

    # Fall back to bundled
    try:
        bundled = _load_bundled_config()
        return _parse_config(bundled, "bundled")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No recommended config available")


@router.get("/diff", response_model=ConfigComparisonResponse)
async def compare_config(profile: str | None = None, include_optional: bool = False):
    """Compare installed packages against the recommended config.

    If no profile is specified, uses the profile from setup status
    (or defaults to 'cpu').

    If include_optional is True, also compares optional packages that
    are currently installed against their recommended versions.
    """
    # Load config
    try:
        cached = _config_cache.get_cached_config()
        raw_config = cached if cached else _load_bundled_config()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No recommended config available")

    # Determine profile
    if not profile:
        setup = _config_cache.get_setup_status()
        profile = setup.get("selected_profile", "cpu") or "cpu"

    profile_data = raw_config.get("profiles", {}).get(profile)
    if not profile_data:
        raise HTTPException(status_code=400, detail=f"Unknown profile: {profile}")

    profile_label = profile_data.get("label", profile)
    required_packages = profile_data.get("packages", {})

    # Get installed packages
    installed = _get_installed_packages()

    # Build diff
    diffs: list[PackageDiff] = []
    aligned_count = 0
    misaligned_count = 0
    missing_count = 0

    for pkg_name, version_spec in required_packages.items():
        norm_name = _normalize_pkg_name(pkg_name)
        installed_ver = installed.get(norm_name)

        if installed_ver is None:
            diffs.append(PackageDiff(
                name=pkg_name,
                installed_version=None,
                recommended_version=version_spec,
                status="missing",
                action="install",
            ))
            missing_count += 1
        elif _version_satisfies(installed_ver, version_spec):
            diffs.append(PackageDiff(
                name=pkg_name,
                installed_version=installed_ver,
                recommended_version=version_spec,
                status="aligned",
                action="none",
            ))
            aligned_count += 1
        else:
            diffs.append(PackageDiff(
                name=pkg_name,
                installed_version=installed_ver,
                recommended_version=version_spec,
                status="outdated",
                action="upgrade",
            ))
            misaligned_count += 1

    # Include optional packages that are installed
    if include_optional:
        optional_config = raw_config.get("optional", {})
        for opt_name, opt_data in optional_config.items():
            norm_name = _normalize_pkg_name(opt_name)
            installed_ver = installed.get(norm_name)
            if installed_ver is None:
                continue  # Skip uninstalled optional packages
            version_spec = opt_data.get("version", "")
            if version_spec and not _version_satisfies(installed_ver, version_spec):
                diffs.append(PackageDiff(
                    name=opt_name,
                    installed_version=installed_ver,
                    recommended_version=version_spec,
                    status="outdated",
                    action="upgrade",
                ))
                misaligned_count += 1
            else:
                diffs.append(PackageDiff(
                    name=opt_name,
                    installed_version=installed_ver,
                    recommended_version=version_spec or installed_ver,
                    status="aligned",
                    action="none",
                ))
                aligned_count += 1

    return ConfigComparisonResponse(
        profile=profile,
        profile_label=profile_label,
        packages=diffs,
        aligned_count=aligned_count,
        misaligned_count=misaligned_count,
        missing_count=missing_count,
        is_aligned=misaligned_count == 0 and missing_count == 0,
        checked_at=datetime.now().isoformat(),
    )


@router.post("/align", response_model=AlignConfigResponse)
async def align_config(request: AlignConfigRequest):
    """Install/upgrade packages to match recommended config for a profile.

    Optionally also installs selected optional packages.
    """
    # Load config
    try:
        cached = _config_cache.get_cached_config()
        raw_config = cached if cached else _load_bundled_config()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No recommended config available")

    profile_data = raw_config.get("profiles", {}).get(request.profile)
    if not profile_data:
        raise HTTPException(status_code=400, detail=f"Unknown profile: {request.profile}")

    required_packages = profile_data.get("packages", {})
    optional_config = raw_config.get("optional", {})

    # Build list of packages to install/upgrade
    to_install: list[str] = []
    installed = _get_installed_packages()

    for pkg_name, version_spec in required_packages.items():
        norm_name = _normalize_pkg_name(pkg_name)
        installed_ver = installed.get(norm_name)
        if installed_ver is None or not _version_satisfies(installed_ver, version_spec):
            to_install.append(f"{pkg_name}{version_spec}")

    for opt_name in request.optional_packages:
        opt_data = optional_config.get(opt_name)
        if opt_data:
            norm_name = _normalize_pkg_name(opt_name)
            installed_ver = installed.get(norm_name)
            version_spec = opt_data.get("version", "")
            if installed_ver is None or version_spec and not _version_satisfies(installed_ver, version_spec):
                to_install.append(f"{opt_name}{version_spec}")

    if request.dry_run:
        return AlignConfigResponse(
            success=True,
            message=f"Dry run: would install/upgrade {len(to_install)} packages",
            installed=to_install,
            dry_run=True,
        )

    if not to_install:
        return AlignConfigResponse(
            success=True,
            message="All packages are already aligned with recommended config",
        )

    # Actually install
    installed_pkgs = []
    upgraded_pkgs = []
    failed_pkgs = []

    for pkg_spec in to_install:
        try:
            venv_manager.install_package(pkg_spec, upgrade=True)
            # Determine if it was install or upgrade
            pkg_base = re.split(r"[><=!]", pkg_spec)[0]
            norm_name = _normalize_pkg_name(pkg_base)
            if norm_name in installed:
                upgraded_pkgs.append(pkg_spec)
            else:
                installed_pkgs.append(pkg_spec)
        except Exception as e:
            logger.error("Failed to install %s: %s", pkg_spec, e)
            failed_pkgs.append(pkg_spec)

    success = len(failed_pkgs) == 0
    parts = []
    if installed_pkgs:
        parts.append(f"Installed {len(installed_pkgs)} packages")
    if upgraded_pkgs:
        parts.append(f"Upgraded {len(upgraded_pkgs)} packages")
    if failed_pkgs:
        parts.append(f"{len(failed_pkgs)} failed")

    return AlignConfigResponse(
        success=success,
        message=". ".join(parts) if parts else "No changes needed",
        installed=installed_pkgs,
        upgraded=upgraded_pkgs,
        failed=failed_pkgs,
    )


@router.get("/setup-status", response_model=SetupStatusResponse)
async def get_setup_status():
    """Check if first-launch setup has been completed."""
    data = _config_cache.get_setup_status()
    return SetupStatusResponse(**data)


@router.post("/complete-setup", response_model=SetupStatusResponse)
async def complete_setup(request: CompleteSetupRequest):
    """Mark the first-launch setup as completed.

    Stores the selected profile. Optionally triggers package alignment.
    """
    _config_cache.set_setup_status(request.profile)

    return SetupStatusResponse(
        setup_completed=True,
        selected_profile=request.profile,
        completed_at=datetime.now().isoformat(),
    )


@router.get("/detect-gpu", response_model=GPUDetectionResponse)
async def detect_gpu():
    """Detect available GPU hardware and recommend profiles."""
    return _detect_gpu()


@router.post("/skip-setup", response_model=SetupStatusResponse)
async def skip_setup():
    """Skip the first-launch setup (defaults to CPU profile)."""
    _config_cache.set_setup_status("cpu")
    return SetupStatusResponse(
        setup_completed=True,
        selected_profile="cpu",
        completed_at=datetime.now().isoformat(),
    )
