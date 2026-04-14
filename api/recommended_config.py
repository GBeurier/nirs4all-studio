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
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .shared.gpu_detection import detect_gpu_hardware
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
TORCH_PACKAGE = "torch"
TORCH_CPU_INDEX_URL = "https://download.pytorch.org/whl/cpu"
TORCH_CUDA_INDEX_URL = "https://download.pytorch.org/whl/cu124"
TORCH_CUDA_PROFILE = "gpu-cuda-torch"
TORCH_MPS_PROFILE = "gpu-mps"
DEFAULT_PROFILE = "cpu"


# ============= Data Models =============


class ProfilePackageSpec(BaseModel):
    """Version spec for a profile package (schema v1.2)."""
    min: str  # e.g., ">=0.7.1"
    recommended: str | None = None  # e.g., "0.7.1"


class ProfileInfo(BaseModel):
    """A compute profile (e.g., cpu, gpu-cuda-torch)."""
    id: str
    label: str
    description: str
    packages: dict[str, ProfilePackageSpec]
    platforms: list[str] = []


class OptionalPackageInfo(BaseModel):
    """An optional package from the recommended config."""
    name: str
    min: str
    recommended: str | None = None
    description: str
    category: str
    note: str | None = None


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
    driver_version: str | None = None
    torch_cuda_available: bool = False
    torch_version: str | None = None
    detection_source: str | None = None
    recommended_profiles: list[str]


class CompleteSetupRequest(BaseModel):
    """Mark setup as completed."""
    profile: str
    optional_packages: list[str] = []


@dataclass
class ResolvedInstallSpec:
    """Concrete pip install instruction derived from a profile package spec."""

    package: str
    version: str | None
    display_spec: str
    extra_pip_args: list[str]
    force_reinstall: bool = False


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


def _load_active_raw_config() -> dict[str, Any]:
    """Load the active config source used for comparisons and alignment."""
    cached = _config_cache.get_cached_config()
    return cached if cached else _load_bundled_config()


def _is_profile_platform_compatible(raw: dict[str, Any], profile_id: str) -> bool:
    """Return whether a profile exists and supports the current platform."""
    profile = raw.get("profiles", {}).get(profile_id)
    if not profile:
        return False
    platforms = profile.get("platforms", [])
    return not platforms or sys.platform in platforms


def _get_available_profile_ids(raw: dict[str, Any]) -> list[str]:
    """List supported profile ids for the current platform."""
    return [
        profile_id
        for profile_id in raw.get("profiles", {})
        if _is_profile_platform_compatible(raw, profile_id)
    ]


def _get_profile_managed_packages(raw: dict[str, Any]) -> set[str]:
    """Return normalized package names managed by compute profiles."""
    managed: set[str] = set()
    for profile_data in raw.get("profiles", {}).values():
        for pkg_name in profile_data.get("packages", {}):
            managed.add(_normalize_pkg_name(pkg_name))
    return managed


def _get_filtered_optional_config(raw: dict[str, Any]) -> dict[str, Any]:
    """Return optional packages excluding anything managed by profiles."""
    managed = _get_profile_managed_packages(raw)
    return {
        name: data
        for name, data in raw.get("optional", {}).items()
        if _normalize_pkg_name(name) not in managed
    }


def _parse_config(raw: dict[str, Any], source: str) -> RecommendedConfigResponse:
    """Parse raw config dict into response model.

    Handles both schema v1.1 (string package specs) and v1.2 (dict with min/recommended).
    """
    profiles = []
    for pid, pdata in raw.get("profiles", {}).items():
        # Parse packages: v1.2 uses {"min": ">=0.7.1", "recommended": "0.7.1"},
        # v1.1 uses plain strings like ">=0.7.1"
        raw_packages = pdata.get("packages", {})
        parsed_packages: dict[str, ProfilePackageSpec] = {}
        for pkg_name, pkg_val in raw_packages.items():
            if isinstance(pkg_val, dict):
                parsed_packages[pkg_name] = ProfilePackageSpec(
                    min=pkg_val.get("min", ""),
                    recommended=pkg_val.get("recommended"),
                )
            else:
                # v1.1 string format — treat as min spec with no recommended
                parsed_packages[pkg_name] = ProfilePackageSpec(min=str(pkg_val), recommended=None)
        profiles.append(ProfileInfo(
            id=pid,
            label=pdata.get("label", pid),
            description=pdata.get("description", ""),
            packages=parsed_packages,
            platforms=pdata.get("platforms", []),
        ))

    optional = []
    for name, odata in _get_filtered_optional_config(raw).items():
        # v1.2 uses "min" field; v1.1 uses "version" field
        min_spec = odata.get("min", odata.get("version", ""))
        optional.append(OptionalPackageInfo(
            name=name,
            min=min_spec,
            recommended=odata.get("recommended"),
            description=odata.get("description", ""),
            category=odata.get("category", "other"),
            note=odata.get("note"),
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
        packages = {pkg.name.lower().replace("-", "_"): pkg.version for pkg in venv_manager.get_installed_packages()}
        runtime_nirs4all = venv_manager.get_nirs4all_version()
        if runtime_nirs4all:
            packages["nirs4all"] = runtime_nirs4all
        return packages
    except Exception as e:
        logger.warning("Could not list installed packages: %s", e)
        return {}


def _normalize_pkg_name(name: str) -> str:
    """Normalize package name for comparison (PEP 503)."""
    return re.sub(r"[-_.]+", "_", name).lower()


def _parse_package_spec(pkg_raw: Any) -> tuple[str, str | None]:
    """Return (min_spec, recommended_version) from a raw package entry."""
    if isinstance(pkg_raw, dict):
        return pkg_raw.get("min", ""), pkg_raw.get("recommended")
    return str(pkg_raw), None


def _torch_variant_tag(profile_id: str) -> str:
    """Human-readable torch variant label for the active profile."""
    if profile_id == TORCH_CUDA_PROFILE:
        return "cu124"
    if profile_id == TORCH_MPS_PROFILE:
        return "mps"
    return "cpu"


def _describe_required_package(profile_id: str, pkg_name: str, pkg_raw: Any) -> str:
    """Render a package spec string for UI/debug output."""
    min_spec, recommended_ver = _parse_package_spec(pkg_raw)
    base = f"{pkg_name}=={recommended_ver}" if recommended_ver else f"{pkg_name}{min_spec}"
    if _normalize_pkg_name(pkg_name) != TORCH_PACKAGE:
        return base
    return f"{base} ({_torch_variant_tag(profile_id)})"


def _torch_variant_matches(profile_id: str, installed_version: str | None, gpu_info: GPUDetectionResponse) -> bool:
    """Return whether the installed torch build matches the requested profile."""
    if installed_version is None:
        return False

    installed_lower = installed_version.lower()
    has_cuda_suffix = "+cu" in installed_lower

    if profile_id == TORCH_CUDA_PROFILE:
        return has_cuda_suffix or gpu_info.torch_cuda_available
    if profile_id == TORCH_MPS_PROFILE:
        return sys.platform == "darwin" and gpu_info.has_metal
    if sys.platform == "darwin":
        return not gpu_info.torch_cuda_available
    return not has_cuda_suffix and not gpu_info.torch_cuda_available


def _resolve_profile_from_environment(
    raw: dict[str, Any],
    installed: dict[str, str] | None = None,
    gpu_info: GPUDetectionResponse | None = None,
) -> str:
    """Infer the most likely profile from the installed runtime."""
    available_profiles = _get_available_profile_ids(raw)
    if not available_profiles:
        return DEFAULT_PROFILE

    installed_packages = installed if installed is not None else _get_installed_packages()
    detected_gpu = gpu_info if gpu_info is not None else _detect_gpu()
    torch_version = installed_packages.get(TORCH_PACKAGE)

    if torch_version:
        torch_lower = torch_version.lower()
        if TORCH_CUDA_PROFILE in available_profiles and ("+cu" in torch_lower or detected_gpu.torch_cuda_available):
            return TORCH_CUDA_PROFILE
        if TORCH_MPS_PROFILE in available_profiles and detected_gpu.has_metal:
            return TORCH_MPS_PROFILE

    if DEFAULT_PROFILE in available_profiles:
        return DEFAULT_PROFILE

    return available_profiles[0]


def _resolve_effective_setup_status(raw: dict[str, Any]) -> dict[str, Any]:
    """Resolve and persist the active compute profile if setup state is missing."""
    stored = _config_cache.get_setup_status()
    selected_profile = stored.get("selected_profile")
    if (
        stored.get("setup_completed")
        and isinstance(selected_profile, str)
        and _is_profile_platform_compatible(raw, selected_profile)
    ):
        return stored

    inferred_profile = _resolve_profile_from_environment(raw)
    _config_cache.set_setup_status(inferred_profile)
    repaired = _config_cache.get_setup_status()
    if repaired.get("setup_completed") and repaired.get("selected_profile") == inferred_profile:
        return repaired
    return {
        "setup_completed": True,
        "selected_profile": inferred_profile,
        "completed_at": datetime.now().isoformat(),
    }


def _resolve_effective_profile(raw: dict[str, Any]) -> str:
    """Return the active profile, recovering it if persisted state is missing."""
    setup = _resolve_effective_setup_status(raw)
    return str(setup.get("selected_profile") or DEFAULT_PROFILE)


def _resolve_torch_install_spec(
    profile_id: str,
    pkg_raw: Any,
    installed_version: str | None,
    gpu_info: GPUDetectionResponse,
) -> ResolvedInstallSpec | None:
    """Build the concrete install plan for torch for a given profile."""
    min_spec, recommended_ver = _parse_package_spec(pkg_raw)
    if installed_version is not None and _version_satisfies(installed_version, min_spec):
        if _torch_variant_matches(profile_id, installed_version, gpu_info):
            return None

    version = recommended_ver
    if version is None:
        raise ValueError("Torch profile packages must pin a recommended version")

    extra_pip_args: list[str] = []
    force_reinstall = False
    if profile_id == TORCH_CUDA_PROFILE:
        extra_pip_args = ["--index-url", TORCH_CUDA_INDEX_URL]
        force_reinstall = installed_version is not None
    elif profile_id == DEFAULT_PROFILE and sys.platform != "darwin":
        extra_pip_args = ["--index-url", TORCH_CPU_INDEX_URL]
        force_reinstall = installed_version is not None and not _torch_variant_matches(profile_id, installed_version, gpu_info)

    return ResolvedInstallSpec(
        package=TORCH_PACKAGE,
        version=version,
        display_spec=_describe_required_package(profile_id, TORCH_PACKAGE, pkg_raw),
        extra_pip_args=extra_pip_args,
        force_reinstall=force_reinstall,
    )


def _resolve_required_install_spec(
    profile_id: str,
    pkg_name: str,
    pkg_raw: Any,
    installed_version: str | None,
    gpu_info: GPUDetectionResponse,
) -> ResolvedInstallSpec | None:
    """Resolve whether a profile package needs installation or upgrade."""
    if _normalize_pkg_name(pkg_name) == TORCH_PACKAGE:
        return _resolve_torch_install_spec(profile_id, pkg_raw, installed_version, gpu_info)

    min_spec, recommended_ver = _parse_package_spec(pkg_raw)
    if installed_version is not None and _version_satisfies(installed_version, min_spec):
        return None

    return ResolvedInstallSpec(
        package=pkg_name,
        version=recommended_ver,
        display_spec=_describe_required_package(profile_id, pkg_name, pkg_raw),
        extra_pip_args=[],
        force_reinstall=False,
    )


def _resolve_optional_install_spec(
    pkg_name: str,
    pkg_raw: Any,
    installed_version: str | None,
) -> ResolvedInstallSpec | None:
    """Resolve whether an optional package needs installation or upgrade."""
    min_spec = pkg_raw.get("min", pkg_raw.get("version", ""))
    recommended_ver = pkg_raw.get("recommended")
    if installed_version is not None and (not min_spec or _version_satisfies(installed_version, min_spec)):
        return None

    display_spec = f"{pkg_name}=={recommended_ver}" if recommended_ver else f"{pkg_name}{min_spec}"
    return ResolvedInstallSpec(
        package=pkg_name,
        version=recommended_ver,
        display_spec=display_spec,
        extra_pip_args=[],
        force_reinstall=False,
    )


def _version_satisfies(installed: str, spec: str) -> bool:
    """Check if installed version satisfies a version spec like '>=0.7.1'."""
    try:
        from packaging.specifiers import SpecifierSet
        from packaging.version import Version
        return Version(installed) in SpecifierSet(spec)
    except ImportError:
        # Fallback for when packaging is not available
        if spec.startswith(">="):
            return _compare_versions(installed, spec[2:]) >= 0
        if spec.startswith("=="):
            return _compare_versions(installed, spec[2:]) == 0
        if spec.startswith(">"):
            return _compare_versions(installed, spec[1:]) > 0
        # Unknown spec format — consider misaligned (safe default: triggers upgrade)
        return False
    except Exception:
        # Parse error — consider misaligned (safe default: triggers upgrade check)
        return False


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
    """Detect available GPU hardware and recommend platform-compatible profiles."""
    gpu_info = detect_gpu_hardware()

    # Build candidate list based on detected hardware
    if gpu_info.has_cuda:
        candidates = ["gpu-cuda-torch", "cpu"]
    elif gpu_info.has_metal:
        candidates = ["gpu-mps", "cpu"]
    else:
        candidates = ["cpu"]

    # Filter candidates by platform compatibility using the config
    current_platform = sys.platform
    try:
        raw_config = _load_bundled_config()
        profiles = raw_config.get("profiles", {})
        recommended = [
            pid for pid in candidates
            if pid in profiles and (
                not profiles[pid].get("platforms")
                or current_platform in profiles[pid]["platforms"]
            )
        ]
        if not recommended:
            recommended = ["cpu"]
    except Exception:
        recommended = candidates  # Fallback to unfiltered if config unavailable

    return GPUDetectionResponse(
        has_cuda=gpu_info.has_cuda,
        has_metal=gpu_info.has_metal,
        cuda_version=gpu_info.cuda_version,
        gpu_name=gpu_info.gpu_name,
        driver_version=gpu_info.driver_version,
        torch_cuda_available=gpu_info.torch_cuda_available,
        torch_version=gpu_info.torch_version,
        detection_source=gpu_info.detection_source,
        recommended_profiles=recommended,
    )


# ============= API Endpoints =============


@router.get("/recommended", response_model=RecommendedConfigResponse)
async def get_recommended_config(force_refresh: bool = False):
    """Get the recommended configuration.

    Normal startup should return immediately from local state:
    cached remote config if available, otherwise the bundled config shipped with
    the app. Remote refresh is only attempted for explicit force-refresh calls
    or by the background cache task at startup.
    """
    if not force_refresh:
        cached = _config_cache.get_cached_config()
        if cached:
            return _parse_config(cached, "remote")
        try:
            bundled = _load_bundled_config()
            return _parse_config(bundled, "bundled")
        except FileNotFoundError:
            pass

    # Explicit refresh path: try remote first, then fall back to any local data.
    remote = await _fetch_remote_config()
    if remote:
        _config_cache.set_cached_config(remote)
        return _parse_config(remote, "remote")

    cached = _config_cache.get_cached_config()
    if cached:
        return _parse_config(cached, "remote")

    # Final fallback: bundled config packaged with the app
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
        raw_config = _load_active_raw_config()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No recommended config available")

    # Determine profile
    if not profile:
        profile = _resolve_effective_profile(raw_config)

    if not _is_profile_platform_compatible(raw_config, profile):
        raise HTTPException(status_code=400, detail=f"Unknown profile: {profile}")

    profile_data = raw_config.get("profiles", {}).get(profile)
    profile_label = profile_data.get("label", profile)
    required_packages = profile_data.get("packages", {})
    optional_config = _get_filtered_optional_config(raw_config)

    # Get installed packages
    installed = _get_installed_packages()
    gpu_info = _detect_gpu()

    # Build diff
    diffs: list[PackageDiff] = []
    aligned_count = 0
    misaligned_count = 0
    missing_count = 0

    # Parse profile packages from raw config (may be v1.1 string or v1.2 dict)
    for pkg_name, pkg_raw in required_packages.items():
        min_spec, recommended_ver = _parse_package_spec(pkg_raw)
        version_spec = _describe_required_package(profile, pkg_name, pkg_raw)
        norm_name = _normalize_pkg_name(pkg_name)
        installed_ver = installed.get(norm_name)
        is_variant_misaligned = (
            norm_name == TORCH_PACKAGE
            and installed_ver is not None
            and not _torch_variant_matches(profile, installed_ver, gpu_info)
        )

        if installed_ver is None:
            diffs.append(PackageDiff(
                name=pkg_name,
                installed_version=None,
                recommended_version=version_spec,
                status="missing",
                action="install",
            ))
            missing_count += 1
        elif _version_satisfies(installed_ver, min_spec) and not is_variant_misaligned:
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
        for opt_name, opt_data in optional_config.items():
            norm_name = _normalize_pkg_name(opt_name)
            installed_ver = installed.get(norm_name)
            if installed_ver is None:
                continue  # Skip uninstalled optional packages
            # v1.2 uses "min", v1.1 uses "version"
            version_spec = opt_data.get("min", opt_data.get("version", ""))
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
        raw_config = _load_active_raw_config()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No recommended config available")

    if not _is_profile_platform_compatible(raw_config, request.profile):
        raise HTTPException(status_code=400, detail=f"Unknown profile: {request.profile}")

    profile_data = raw_config.get("profiles", {}).get(request.profile)
    required_packages = profile_data.get("packages", {})
    optional_config = _get_filtered_optional_config(raw_config)
    managed_optional_names = _get_profile_managed_packages(raw_config)

    # Build list of packages to install/upgrade
    to_install: list[ResolvedInstallSpec] = []
    installed = _get_installed_packages()
    gpu_info = _detect_gpu()

    for pkg_name, pkg_raw in required_packages.items():
        norm_name = _normalize_pkg_name(pkg_name)
        installed_ver = installed.get(norm_name)
        install_spec = _resolve_required_install_spec(
            request.profile,
            pkg_name,
            pkg_raw,
            installed_ver,
            gpu_info,
        )
        if install_spec is not None:
            to_install.append(install_spec)

    for opt_name in request.optional_packages:
        if _normalize_pkg_name(opt_name) in managed_optional_names:
            logger.info("Ignoring profile-managed optional package request for %s", opt_name)
            continue
        opt_data = optional_config.get(opt_name)
        if opt_data:
            norm_name = _normalize_pkg_name(opt_name)
            installed_ver = installed.get(norm_name)
            install_spec = _resolve_optional_install_spec(opt_name, opt_data, installed_ver)
            if install_spec is not None:
                to_install.append(install_spec)

    if request.dry_run:
        return AlignConfigResponse(
            success=True,
            message=f"Dry run: would install/upgrade {len(to_install)} packages",
            installed=[spec.display_spec for spec in to_install],
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

    for install_spec in to_install:
        try:
            success, message, output = venv_manager.install_package(
                install_spec.package,
                version=install_spec.version,
                upgrade=True,
                extra_pip_args=install_spec.extra_pip_args,
                force_reinstall=install_spec.force_reinstall,
            )
            if not success:
                logger.error("Failed to install %s: %s", install_spec.display_spec, message)
                failed_pkgs.append(install_spec.display_spec)
                continue
            # Determine if it was install or upgrade
            norm_name = _normalize_pkg_name(install_spec.package)
            if norm_name in installed:
                upgraded_pkgs.append(install_spec.display_spec)
            else:
                installed_pkgs.append(install_spec.display_spec)
        except Exception as e:
            logger.error("Failed to install %s: %s", install_spec.display_spec, e)
            failed_pkgs.append(install_spec.display_spec)

    success = len(failed_pkgs) == 0
    parts = []
    if installed_pkgs:
        parts.append(f"Installed {len(installed_pkgs)} packages")
    if upgraded_pkgs:
        parts.append(f"Upgraded {len(upgraded_pkgs)} packages")
    if failed_pkgs:
        parts.append(f"{len(failed_pkgs)} failed")

    if success:
        _config_cache.set_setup_status(request.profile)

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
    try:
        raw_config = _load_active_raw_config()
    except FileNotFoundError:
        data = _config_cache.get_setup_status()
        return SetupStatusResponse(**data)

    data = _resolve_effective_setup_status(raw_config)
    return SetupStatusResponse(**data)


@router.post("/complete-setup", response_model=SetupStatusResponse)
async def complete_setup(request: CompleteSetupRequest):
    """Mark the first-launch setup as completed.

    Stores the selected profile. Optionally triggers package alignment.
    """
    try:
        raw_config = _load_active_raw_config()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No recommended config available")

    if not _is_profile_platform_compatible(raw_config, request.profile):
        raise HTTPException(status_code=400, detail=f"Unknown profile: {request.profile}")

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
