"""
Update management API for nirs4all webapp.

This module provides API endpoints for:
- Checking for updates (webapp via GitHub, nirs4all via PyPI)
- Managing the managed virtual environment
- Downloading and applying webapp updates
- Installing/upgrading nirs4all in the managed venv
"""

import asyncio
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

if TYPE_CHECKING:
    from .jobs.manager import Job

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from .shared.logger import get_logger
from .update_downloader import resolve_extracted_content_dir
from .venv_manager import VenvInfo, _user_data_dir, venv_manager

logger = get_logger(__name__)

# Try to import httpx for async HTTP requests, fall back to urllib
try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False
    import urllib.error
    import urllib.request


router = APIRouter(prefix="/updates", tags=["updates"])

# Packages that require a backend restart after install/update/uninstall
RESTART_REQUIRED_PACKAGES = {
    "nirs4all", "numpy", "scipy", "scikit-learn", "pandas",
    "pydantic", "fastapi", "uvicorn",
}
PROFILE_MANAGED_DEPENDENCIES = {"torch"}


def _describe_exception(exc: BaseException) -> str:
    """Render an exception with a non-empty, type-aware message."""
    detail = str(exc).strip()
    name = type(exc).__name__
    if not detail:
        return name
    if detail.startswith(f"{name}:"):
        return detail
    return f"{name}: {detail}"


def _is_offline_update_error(exc: Exception) -> bool:
    from .network_state import OfflineError

    return isinstance(exc, OfflineError)


def _is_expected_update_transport_error(exc: Exception) -> bool:
    if _is_offline_update_error(exc):
        return True
    if HTTPX_AVAILABLE and isinstance(exc, httpx.HTTPError):
        return True
    try:
        import urllib.error

        if isinstance(exc, urllib.error.URLError):
            return True
    except Exception:
        pass
    return isinstance(exc, TimeoutError)


# ============= nirs4all Optional Dependencies Definition =============


def _normalize_dependency_name(name: str) -> str:
    """Normalize dependency names for comparisons."""
    return name.replace("-", "_").lower()


def _is_profile_managed_dependency(name: str) -> bool:
    """Return whether a dependency is managed by the compute profile."""
    return _normalize_dependency_name(name) in PROFILE_MANAGED_DEPENDENCIES


def _show_optional_when_profile_managed(pkg_data: dict[str, Any]) -> bool:
    """Return whether a profile-managed optional package should stay visible."""
    return bool(pkg_data.get("show_when_profile_managed", False))


def _load_optional_deps_from_config() -> dict[str, Any]:
    """Load optional dependencies from recommended-config.json.

    This keeps the hardcoded definition in sync with the online manifest
    that the setup wizard and config-alignment system use.
    """
    candidates = [
        Path(__file__).parent.parent / "recommended-config.json",
        Path(__file__).parent / "recommended-config.json",
    ]
    for config_path in candidates:
        if not config_path.exists():
            continue
        try:
            with open(config_path, encoding="utf-8") as f:
                config = json.load(f)
        except Exception:
            continue

        categories_meta = config.get("categories", {})
        optional = config.get("optional", {})
        if not optional:
            continue

        profile_managed = {
            _normalize_dependency_name(pkg_name)
            for profile in config.get("profiles", {}).values()
            for pkg_name in profile.get("packages", {})
        }

        # Group packages by category
        groups: dict[str, Any] = {}
        for pkg_name, pkg_data in optional.items():
            if (
                _normalize_dependency_name(pkg_name) in profile_managed
                and not _show_optional_when_profile_managed(pkg_data)
            ):
                continue
            cat_id = pkg_data.get("category", "other")
            if cat_id not in groups:
                cat_meta = categories_meta.get(cat_id, {})
                groups[cat_id] = {
                    "name": cat_meta.get("name", cat_id.replace("_", " ").title()),
                    "description": cat_meta.get("description", ""),
                    "packages": [],
                }
            # Handle both old format ("version": ">=2.1.0") and new format ("min": ">=2.1.0", "recommended": "2.6.0")
            version_spec = pkg_data.get("min") or pkg_data.get("version", "")
            # Strip leading >= for min_version field
            min_version = version_spec.lstrip(">= ") if version_spec else ""
            recommended_version = pkg_data.get("recommended")
            groups[cat_id]["packages"].append({
                "name": pkg_name,
                "min_version": min_version,
                "recommended_version": recommended_version,
                "description": pkg_data.get("description", ""),
            })

        return groups

    return {}


# Load from recommended-config.json; this is the single source of truth
# shared with the setup wizard and config-alignment endpoints.
NIRS4ALL_OPTIONAL_DEPS: dict[str, Any] = _load_optional_deps_from_config() or {
    # Fallback if recommended-config.json is missing (shouldn't happen in practice)
    "deep_learning": {
        "name": "Deep Learning",
        "description": "Deep learning frameworks for neural network models",
        "packages": [
            {"name": "keras", "min_version": "3.0.0", "recommended_version": "3.8.0", "description": "High-level neural networks API"},
            {"name": "jax", "min_version": "0.4.20", "recommended_version": "0.4.38", "description": "JAX numerical computing library"},
            {"name": "jaxlib", "min_version": "0.4.20", "recommended_version": "0.4.38", "description": "JAX backend library"},
            {"name": "flax", "min_version": "0.8.0", "recommended_version": "0.10.4", "description": "Flax neural network library for JAX"},
            {"name": "tabpfn", "min_version": "2.0.0", "recommended_version": "2.0.3", "description": "TabPFN tabular data model"},
            {"name": "tabicl", "min_version": "2.0.0", "recommended_version": "2.0.3", "description": "TabICL in-context learning model for tabular data"},
        ],
    },
    "pls_variants": {
        "name": "PLS Variants",
        "description": "Advanced Partial Least Squares implementations",
        "packages": [
            {"name": "ikpls", "min_version": "1.1.0", "recommended_version": "1.3.0", "description": "Improved kernel PLS algorithms"},
            {"name": "pyopls", "min_version": "20.0", "recommended_version": "20.0", "description": "Orthogonal PLS (OPLS)"},
            {"name": "trendfitter", "min_version": "0.0.6", "recommended_version": "0.0.6", "description": "PLS with trend analysis"},
        ],
    },
    "automl": {
        "name": "AutoML",
        "description": "Automated machine learning frameworks",
        "packages": [
            {"name": "autogluon", "min_version": "1.0.0", "recommended_version": "1.2.0", "description": "AutoGluon AutoML toolkit"},
        ],
    },
    "explainability": {
        "name": "Explainability",
        "description": "Model interpretability and explanation tools",
        "packages": [
            {"name": "shap", "min_version": "0.44", "recommended_version": "0.47.1", "description": "SHAP explanations for model interpretability"},
        ],
    },
    "visualization": {
        "name": "Visualization",
        "description": "Plotting and visualization libraries",
        "packages": [
            {"name": "matplotlib", "min_version": "3.7.0", "recommended_version": "3.10.1", "description": "Core plotting library"},
            {"name": "seaborn", "min_version": "0.12.0", "recommended_version": "0.13.2", "description": "Statistical data visualization"},
            {"name": "plotly", "min_version": "5.0.0", "recommended_version": "6.0.1", "description": "Interactive plotting library"},
        ],
    },
    "dimensionality": {
        "name": "Dimensionality Reduction",
        "description": "Advanced dimensionality reduction methods",
        "packages": [
            {"name": "umap-learn", "min_version": "0.5.0", "recommended_version": "0.5.7", "description": "UMAP dimensionality reduction"},
        ],
    },
    "reports": {
        "name": "Reports",
        "description": "Document and report generation",
        "packages": [
            {"name": "pypandoc", "min_version": "1.12", "recommended_version": "1.12", "description": "Pandoc document conversion"},
            {"name": "PyPDF2", "min_version": "3.0.0", "recommended_version": "3.0.1", "description": "PDF manipulation"},
            {"name": "pdf2image", "min_version": "1.16.0", "recommended_version": "1.17.0", "description": "PDF to image conversion"},
        ],
    },
    "export": {
        "name": "Export",
        "description": "Data export capabilities",
        "packages": [
            {"name": "openpyxl", "min_version": "3.1.0", "recommended_version": "3.1.5", "description": "Excel file support"},
        ],
    },
}


class DependencyInfo(BaseModel):
    """Information about a single dependency."""
    name: str
    category: str
    category_name: str
    description: str
    min_version: str
    recommended_version: str | None = None
    installed_version: str | None = None
    latest_version: str | None = None
    is_installed: bool = False
    is_outdated: bool = False
    is_below_recommended: bool = False
    is_above_recommended: bool = False
    can_update: bool = False


class DependencyCategory(BaseModel):
    """A category of dependencies."""
    id: str
    name: str
    description: str
    packages: list[DependencyInfo]
    installed_count: int = 0
    total_count: int = 0


class DependenciesResponse(BaseModel):
    """Response with all dependencies information."""
    categories: list[DependencyCategory]
    venv_valid: bool
    venv_path: str
    nirs4all_installed: bool
    nirs4all_version: str | None = None
    total_installed: int = 0
    total_packages: int = 0
    cached_at: str | None = None


class PackageInstallRequest(BaseModel):
    """Request to install a package."""
    package: str
    version: str | None = None
    upgrade: bool = False
    target: str | None = None  # "recommended" | "latest" | None (defaults to recommended)


class PackageUninstallRequest(BaseModel):
    """Request to uninstall a package."""
    package: str



# App identification
APP_NAME = "nirs4all-webapp"
APP_AUTHOR = "nirs4all"

# Default configuration
DEFAULT_GITHUB_REPO = "GBeurier/nirs4all-webapp"
DEFAULT_PYPI_PACKAGE = "nirs4all"
DEFAULT_CHECK_INTERVAL_HOURS = 24
STAGED_UPDATE_METADATA_FILE = ".nirs4all-staged-update.json"


def _is_portable_runtime() -> bool:
    """Return True when running from the portable desktop build."""
    return bool(
        os.environ.get("NIRS4ALL_PORTABLE_EXE")
        or os.environ.get("NIRS4ALL_PORTABLE_ROOT")
    )


def _expected_update_mode() -> str:
    """Return the updater mode that matches the current runtime layout."""
    if _is_portable_runtime():
        return "portable"
    if platform.system().lower() == "darwin":
        return "bundle"
    return "directory"


def _staging_entries(staging_dir: Path) -> list[Path]:
    """List staged entries, excluding the internal metadata file."""
    return [
        entry
        for entry in staging_dir.iterdir()
        if entry.name != STAGED_UPDATE_METADATA_FILE
    ]


def _resolve_staged_content_dir(staging_dir: Path) -> Path | None:
    """Resolve the actual staged content root from the staging wrapper dir."""
    return resolve_extracted_content_dir(
        staging_dir,
        ignored_names={STAGED_UPDATE_METADATA_FILE},
    )


def _write_staged_update_metadata(staging_dir: Path, **metadata: Any) -> None:
    """Persist lightweight metadata for a staged update."""
    staging_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        **metadata,
        "staged_at": datetime.now().isoformat(),
    }
    with open(staging_dir / STAGED_UPDATE_METADATA_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def _read_staged_update_metadata(staging_dir: Path) -> dict[str, Any] | None:
    """Read staged update metadata if available."""
    metadata_path = staging_dir / STAGED_UPDATE_METADATA_FILE
    if not metadata_path.exists():
        return None

    try:
        with open(metadata_path, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception:
        pass

    return None


def _validate_staged_update_layout(staging_dir: Path) -> tuple[Path, str]:
    """Validate the staged update layout for the current runtime mode."""
    from updater import get_executable_name

    content_dir = _resolve_staged_content_dir(staging_dir)
    if content_dir is None:
        raise HTTPException(status_code=400, detail="No staged update found. Download an update first.")

    update_mode = _expected_update_mode()
    expected_executable = os.environ.get("NIRS4ALL_APP_EXE") or get_executable_name()

    if update_mode == "portable":
        executable_path = content_dir / expected_executable
        if not executable_path.is_file():
            raise HTTPException(
                status_code=400,
                detail="The staged update is not a portable executable for this installation.",
            )
        return content_dir, update_mode

    if update_mode == "bundle":
        if content_dir.suffix != ".app" or not (content_dir / "Contents" / "MacOS").exists():
            raise HTTPException(
                status_code=400,
                detail="The staged update is not a valid macOS app bundle.",
            )
        return content_dir, update_mode

    executable_path = content_dir / expected_executable
    resources_dir = content_dir / "resources"
    if not executable_path.is_file() or not resources_dir.is_dir():
        raise HTTPException(
            status_code=400,
            detail="The staged update does not match the installed desktop app layout.",
        )

    return content_dir, update_mode


# ============= Dependencies Cache =============

class DependenciesCache:
    """Cache for dependencies scan results."""

    CACHE_FILE = "dependencies_cache.json"
    CACHE_TTL_HOURS = 6

    def __init__(self):
        self._app_data_dir = Path(_user_data_dir(APP_NAME, APP_AUTHOR))
        self._cache_path = self._app_data_dir / self.CACHE_FILE
        self._cache: dict[str, Any] | None = None
        self._load_cache()

    def _load_cache(self) -> None:
        """Load cache from file."""
        if self._cache_path.exists():
            try:
                with open(self._cache_path, encoding="utf-8") as f:
                    self._cache = json.load(f)
            except Exception:
                self._cache = None

    def _save_cache(self) -> None:
        """Save cache to file."""
        self._app_data_dir.mkdir(parents=True, exist_ok=True)
        try:
            with open(self._cache_path, "w", encoding="utf-8") as f:
                json.dump(self._cache, f, indent=2)
        except Exception as e:
            logger.warning("Could not save dependencies cache: %s", e)

    def get(self, venv_path: str) -> dict[str, Any] | None:
        """Get cached dependencies for a venv path."""
        if not self._cache:
            return None
        if self._cache.get("venv_path") != venv_path:
            return None
        try:
            cached_at_raw = self._cache.get("cached_at")
            if not cached_at_raw:
                return None
            cached_at = datetime.fromisoformat(cached_at_raw)
            if datetime.now() - cached_at > timedelta(hours=self.CACHE_TTL_HOURS):
                return None
        except Exception:
            return None
        return self._cache

    def set(self, venv_path: str, data: dict[str, Any]) -> None:
        """Cache dependencies data for a venv path."""
        self._cache = {
            "venv_path": venv_path,
            "cached_at": datetime.now().isoformat(),
            **data,
        }
        self._save_cache()

    def invalidate(self) -> None:
        """Clear the cache."""
        self._cache = None
        if self._cache_path.exists():
            try:
                self._cache_path.unlink()
            except Exception:
                pass


# Global dependencies cache
_dependencies_cache = DependenciesCache()


# ============= Data Models =============


class UpdateSettings(BaseModel):
    """Update settings configuration."""
    auto_check: bool = True
    check_interval_hours: int = DEFAULT_CHECK_INTERVAL_HOURS
    prerelease_channel: bool = False
    github_repo: str = DEFAULT_GITHUB_REPO
    pypi_package: str = DEFAULT_PYPI_PACKAGE
    dismissed_versions: list[str] = []
    # "auto": probe network on startup; "on": force offline; "off": force online
    offline_mode: str = "auto"


class WebappUpdateInfo(BaseModel):
    """Information about a webapp update."""
    current_version: str
    latest_version: str | None = None
    update_available: bool = False
    release_url: str | None = None
    release_notes: str | None = None
    published_at: str | None = None
    download_size_bytes: int | None = None
    download_url: str | None = None
    asset_name: str | None = None
    checksum_sha256: str | None = None
    is_prerelease: bool = False


class Nirs4allUpdateInfo(BaseModel):
    """Information about a nirs4all library update."""
    current_version: str | None = None
    latest_version: str | None = None
    update_available: bool = False
    pypi_url: str | None = None
    release_notes: str | None = None
    requires_restart: bool = False


class UpdateStatus(BaseModel):
    """Combined update status for webapp and nirs4all."""
    webapp: WebappUpdateInfo
    nirs4all: Nirs4allUpdateInfo
    venv: dict[str, Any]
    last_check: str | None = None
    check_interval_hours: int = DEFAULT_CHECK_INTERVAL_HOURS


class InstallRequest(BaseModel):
    """Request to install/upgrade a package."""
    version: str | None = None
    extras: list[str] | None = None


class VenvCreateRequest(BaseModel):
    """Request to create managed venv."""
    force: bool = False
    install_nirs4all: bool = True
    extras: list[str] | None = None


# ============= Update Manager =============


class UpdateManager:
    """
    Manages update checking and installation.

    Handles:
    - Querying GitHub API for webapp releases
    - Querying PyPI API for nirs4all versions
    - Caching results to reduce API calls
    - Managing update settings
    """

    SETTINGS_FILE = "update_settings.yaml"
    CACHE_FILE = "update_cache.json"
    VERSION_FILE = "version.json"

    def __init__(self):
        """Initialize the update manager with lazy loading."""
        self._app_data_dir = Path(_user_data_dir(APP_NAME, APP_AUTHOR))
        self._settings_path = self._app_data_dir / self.SETTINGS_FILE
        self._cache_path = self._app_data_dir / self.CACHE_FILE
        self._settings: UpdateSettings | None = None
        self._cache: dict[str, Any] | None = None
        # Defer disk I/O until first access for faster startup

    def _load_settings(self) -> None:
        """Load settings from file."""
        if self._settings_path.exists():
            try:
                import yaml
                with open(self._settings_path, encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                self._settings = UpdateSettings(**data)
            except Exception as e:
                logger.warning("Could not load update settings: %s", e)
                self._settings = UpdateSettings()
        else:
            self._settings = UpdateSettings()

    def _save_settings(self) -> None:
        """Save settings to file."""
        self._app_data_dir.mkdir(parents=True, exist_ok=True)
        try:
            import yaml
            with open(self._settings_path, "w", encoding="utf-8") as f:
                yaml.dump(self._settings.model_dump(), f)
        except Exception as e:
            logger.warning("Could not save update settings: %s", e)

    def _load_cache(self) -> None:
        """Load cache from file."""
        if self._cache_path.exists():
            try:
                with open(self._cache_path, encoding="utf-8") as f:
                    self._cache = json.load(f)
            except Exception:
                self._cache = {}
        else:
            self._cache = {}

    def _ensure_cache_loaded(self) -> dict[str, Any]:
        """Ensure cache is loaded and return it."""
        if self._cache is None:
            self._load_cache()
        return self._cache

    def _save_cache(self) -> None:
        """Save cache to file."""
        self._app_data_dir.mkdir(parents=True, exist_ok=True)
        try:
            with open(self._cache_path, "w", encoding="utf-8") as f:
                json.dump(self._cache, f, indent=2)
        except Exception as e:
            logger.warning("Could not save update cache: %s", e)

    @property
    def settings(self) -> UpdateSettings:
        """Get current settings."""
        if self._settings is None:
            self._load_settings()
        return self._settings

    def update_settings(self, new_settings: UpdateSettings) -> None:
        """Update settings."""
        old_prerelease = self._settings.prerelease_channel if self._settings else False
        self._settings = new_settings
        self._save_settings()
        # Invalidate release cache if prerelease channel setting changed
        if new_settings.prerelease_channel != old_prerelease:
            cache = self._ensure_cache_loaded()
            cache.pop("github_release", None)
            self._save_cache()

    def get_webapp_version(self) -> str:
        """Get the current webapp version."""
        env_version = os.environ.get("NIRS4ALL_APP_VERSION")
        if env_version:
            return env_version

        package_json = Path(__file__).parent.parent / "package.json"
        if not getattr(sys, "_MEIPASS", None) and package_json.exists():
            try:
                with open(package_json, encoding="utf-8") as f:
                    data = json.load(f)
                    return data.get("version", "unknown")
            except Exception:
                pass

        # Try to find version.json in app directory
        version_paths = [
            Path(__file__).parent.parent / self.VERSION_FILE,
            Path(getattr(sys, "_MEIPASS", ".")) / self.VERSION_FILE,
            Path(".") / self.VERSION_FILE,
        ]

        for path in version_paths:
            if path.exists():
                try:
                    with open(path, encoding="utf-8") as f:
                        data = json.load(f)
                        return data.get("version", "unknown")
                except Exception:
                    continue

        # Fallback to package.json if available
        if package_json.exists():
            try:
                with open(package_json, encoding="utf-8") as f:
                    data = json.load(f)
                    return data.get("version", "unknown")
            except Exception:
                pass

        return "unknown"

    def get_nirs4all_version(self) -> str | None:
        """Get the installed nirs4all version from managed venv."""
        return venv_manager.get_nirs4all_version()

    def _apply_cached_github_release(
        self,
        info: WebappUpdateInfo,
        cached: dict[str, Any],
    ) -> None:
        """Populate GitHub release info from cached metadata."""
        info.latest_version = cached.get("latest_version")
        info.release_url = cached.get("release_url")
        info.release_notes = cached.get("release_notes")
        info.published_at = cached.get("published_at")
        info.download_url = cached.get("download_url")
        info.asset_name = cached.get("asset_name")
        info.download_size_bytes = cached.get("download_size_bytes")
        info.checksum_sha256 = cached.get("checksum_sha256")
        info.is_prerelease = cached.get("is_prerelease", False)
        info.update_available = self._compare_versions(
            info.current_version,
            info.latest_version,
        )

    def _apply_cached_pypi_release(
        self,
        info: Nirs4allUpdateInfo,
        cached: dict[str, Any],
    ) -> None:
        """Populate PyPI release info from cached metadata."""
        info.latest_version = cached.get("latest_version")
        info.pypi_url = cached.get("pypi_url")
        info.release_notes = cached.get("release_notes")
        if info.current_version and info.latest_version:
            info.update_available = self._compare_versions(
                info.current_version,
                info.latest_version,
            )

    async def _fetch_url(self, url: str, headers: dict[str, str] | None = None) -> tuple[int, str]:
        """Fetch a URL and return (status_code, content).

        Raises ``OfflineError`` if the app is offline — callers must treat this
        as a non-fatal condition and fall back to cached/bundled data.
        """
        from .network_state import OfflineError, is_online
        if not await is_online():
            raise OfflineError(f"Skipping fetch (offline): {url}")

        if HTTPX_AVAILABLE:
            async with httpx.AsyncClient(follow_redirects=True) as client:
                response = await client.get(url, headers=headers, timeout=3.0)
                return response.status_code, response.text
        else:
            # Fallback to synchronous urllib
            req = urllib.request.Request(url, headers=headers or {})
            try:
                with urllib.request.urlopen(req, timeout=3) as response:
                    return response.status, response.read().decode("utf-8")
            except urllib.error.HTTPError as e:
                return e.code, ""

    async def check_github_release(self, force: bool = False) -> WebappUpdateInfo:
        """
        Check GitHub for the latest webapp release.

        Args:
            force: If True, bypass cache

        Returns:
            WebappUpdateInfo with latest release details
        """
        current_version = self.get_webapp_version()
        info = WebappUpdateInfo(current_version=current_version)

        # Check cache (lazy load on first access)
        cache_key = "github_release"
        cache = self._ensure_cache_loaded()
        cached = cache.get(cache_key)
        if not force and cache_key in cache:
            cached_at = datetime.fromisoformat(cached.get("cached_at", "2000-01-01"))
            if datetime.now() - cached_at < timedelta(hours=self.settings.check_interval_hours):
                self._apply_cached_github_release(info, cached)
                return info

        # Fetch from GitHub API
        repo = self.settings.github_repo
        include_prereleases = self.settings.prerelease_channel

        if include_prereleases:
            # List all releases (includes pre-releases), take the newest
            api_url = f"https://api.github.com/repos/{repo}/releases?per_page=1"
        else:
            # Only get the latest stable release
            api_url = f"https://api.github.com/repos/{repo}/releases/latest"

        headers = {
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": f"{APP_NAME}/{current_version}",
        }

        try:
            status, content = await self._fetch_url(api_url, headers)

            if status == 404:
                # No releases yet
                return info

            if status != 200:
                logger.warning("GitHub API returned status %s", status)
                return info

            data = json.loads(content)

            # If we requested all releases, data is a list — take the first one
            if include_prereleases and isinstance(data, list):
                if not data:
                    return info
                data = data[0]

            # Parse release info
            info.latest_version = data.get("tag_name", "").lstrip("v")
            info.release_url = data.get("html_url")
            info.release_notes = data.get("body", "")
            info.published_at = data.get("published_at")
            info.is_prerelease = data.get("prerelease", False)

            # Find appropriate asset for this platform
            assets = data.get("assets", [])
            platform_asset = self._find_platform_asset(assets)
            if platform_asset:
                info.download_url = platform_asset.get("browser_download_url")
                info.asset_name = platform_asset.get("name")
                info.download_size_bytes = platform_asset.get("size")

                # Look for .sha256 sidecar file for checksum verification
                info.checksum_sha256 = await self._fetch_sidecar_checksum(
                    assets, info.asset_name
                )

            # Check if update available
            info.update_available = self._compare_versions(
                current_version, info.latest_version
            )

            # Cache results
            cache[cache_key] = {
                "cached_at": datetime.now().isoformat(),
                "latest_version": info.latest_version,
                "release_url": info.release_url,
                "release_notes": info.release_notes,
                "published_at": info.published_at,
                "download_url": info.download_url,
                "asset_name": info.asset_name,
                "download_size_bytes": info.download_size_bytes,
                "checksum_sha256": info.checksum_sha256,
                "is_prerelease": info.is_prerelease,
            }
            self._save_cache()

        except Exception as e:
            if _is_offline_update_error(e):
                logger.debug("Skipping GitHub release check while offline: %s", api_url)
            elif _is_expected_update_transport_error(e):
                logger.warning(
                    "GitHub release check failed for %s: %s",
                    api_url,
                    _describe_exception(e),
                )
            else:
                logger.error(
                    "GitHub release check failed for %s: %s",
                    api_url,
                    _describe_exception(e),
                    exc_info=True,
                )
            if cached:
                self._apply_cached_github_release(info, cached)
                logger.debug("Using cached GitHub release info after failed refresh: %s", api_url)

        return info

    async def _fetch_sidecar_checksum(
        self, assets: list[dict[str, Any]], asset_name: str | None
    ) -> str | None:
        """
        Look for a .sha256 sidecar file in the release assets and extract the checksum.

        The CI generates files like `nirs4all-Studio-1.0.0-win-x64.exe.sha256` containing:
        `<hex_checksum>  <filename>`
        """
        if not asset_name:
            return None

        sidecar_name = f"{asset_name}.sha256"
        sidecar_asset = None
        for asset in assets:
            if asset.get("name", "").lower() == sidecar_name.lower():
                sidecar_asset = asset
                break

        if not sidecar_asset:
            return None

        sidecar_url = sidecar_asset.get("browser_download_url")
        if not sidecar_url:
            return None

        try:
            status_code, content = await self._fetch_url(sidecar_url)
            if status_code == 200 and content.strip():
                # Format: "<hex_checksum>  <filename>" or just "<hex_checksum>"
                checksum = content.strip().split()[0]
                # Validate it looks like a hex SHA256 (64 chars)
                if len(checksum) == 64 and all(c in "0123456789abcdefABCDEF" for c in checksum):
                    return checksum
        except Exception as e:
            logger.warning("Could not fetch checksum sidecar: %s", e)

        return None

    def _find_platform_asset(self, assets: list[dict[str, Any]]) -> dict[str, Any] | None:
        """Find the release asset matching the current platform.

        Only matches formats that the downloader can actually extract:
        .exe (Windows portable), .zip (Windows/macOS), .tar.gz/.tgz (Linux).
        Installer-only formats (.dmg, .deb, .AppImage, .msi) are excluded
        because the updater cannot apply them in-place.
        """
        system = platform.system().lower()
        machine = platform.machine().lower()
        portable_runtime = _is_portable_runtime()

        # Supported extensions per platform (ordered by preference).
        # Only formats that update_downloader can extract.
        platform_extensions: dict[str, list[str]] = {
            "windows": [".exe"] if portable_runtime else [".zip"],
            "darwin": [".zip", ".tar.gz", ".tgz"],
            "linux": [".tar.gz", ".tgz", ".zip"],
        }

        # Platform keywords to identify the OS in asset names
        platform_keywords: dict[str, list[str]] = {
            "windows": ["win", "windows"],
            "darwin": ["mac", "macos", "darwin", "osx"],
            "linux": ["linux"],
        }

        extensions = platform_extensions.get(system, [])
        os_keywords = platform_keywords.get(system, [])

        arch_keywords = []
        if machine in ("x86_64", "amd64"):
            arch_keywords = ["x64", "x86_64", "amd64"]
        elif machine in ("aarch64", "arm64"):
            arch_keywords = ["arm64", "aarch64"]

        preferred_markers = ["all-in-one", "all_in_one", "allinone"]

        def _matches_asset(asset: dict[str, Any], extension: str, require_arch: bool) -> bool:
            name = asset.get("name", "").lower()
            if not name.endswith(extension):
                return False
            if not any(kw in name for kw in os_keywords):
                return False
            if require_arch and arch_keywords and not any(ak in name for ak in arch_keywords):
                return False
            if system == "windows":
                has_portable_marker = "portable" in name
                if portable_runtime and extension == ".exe":
                    return has_portable_marker
                if not portable_runtime and extension == ".exe":
                    return False
            return True

        def _rank_asset(asset: dict[str, Any]) -> tuple[int, str]:
            name = asset.get("name", "").lower()
            preferred = any(marker in name for marker in preferred_markers)
            return (0 if preferred else 1, name)

        # First pass: match platform + architecture
        for ext in extensions:
            for asset in sorted(assets, key=_rank_asset):
                if _matches_asset(asset, ext, require_arch=True):
                    return asset

        # Second pass: match platform without arch constraint
        for ext in extensions:
            for asset in sorted(assets, key=_rank_asset):
                if _matches_asset(asset, ext, require_arch=False):
                    return asset

        return None

    async def check_pypi_release(self, force: bool = False) -> Nirs4allUpdateInfo:
        """
        Check PyPI for the latest nirs4all release.

        Args:
            force: If True, bypass cache

        Returns:
            Nirs4allUpdateInfo with latest release details
        """
        current_version = self.get_nirs4all_version()
        info = Nirs4allUpdateInfo(current_version=current_version)

        # Check cache (lazy load on first access)
        cache_key = "pypi_release"
        cache = self._ensure_cache_loaded()
        cached = cache.get(cache_key)
        if not force and cache_key in cache:
            cached_at = datetime.fromisoformat(cached.get("cached_at", "2000-01-01"))
            if datetime.now() - cached_at < timedelta(hours=self.settings.check_interval_hours):
                self._apply_cached_pypi_release(info, cached)
                return info

        # Fetch from PyPI API
        package = self.settings.pypi_package
        api_url = f"https://pypi.org/pypi/{package}/json"

        try:
            status, content = await self._fetch_url(api_url)

            if status == 404:
                # Package not found
                return info

            if status != 200:
                logger.warning("PyPI API returned status %s", status)
                return info

            data = json.loads(content)
            pkg_info = data.get("info", {})

            info.latest_version = pkg_info.get("version")
            info.pypi_url = pkg_info.get("project_url") or f"https://pypi.org/project/{package}/"
            info.release_notes = pkg_info.get("description", "")[:2000]  # Truncate

            if current_version and info.latest_version:
                info.update_available = self._compare_versions(
                    current_version, info.latest_version
                )

            # Cache results
            cache[cache_key] = {
                "cached_at": datetime.now().isoformat(),
                "latest_version": info.latest_version,
                "pypi_url": info.pypi_url,
                "release_notes": info.release_notes,
            }
            self._save_cache()

        except Exception as e:
            if _is_offline_update_error(e):
                logger.debug("Skipping PyPI release check while offline: %s", api_url)
            elif _is_expected_update_transport_error(e):
                logger.warning(
                    "PyPI release check failed for %s: %s",
                    api_url,
                    _describe_exception(e),
                )
            else:
                logger.error(
                    "PyPI release check failed for %s: %s",
                    api_url,
                    _describe_exception(e),
                    exc_info=True,
                )
            if cached:
                self._apply_cached_pypi_release(info, cached)
                logger.debug("Using cached PyPI release info after failed refresh: %s", api_url)

        return info

    def _compare_versions(self, current: str, latest: str | None) -> bool:
        """
        Compare version strings to determine if an update is available.

        Returns True if latest > current.
        """
        if not latest or not current or current == "unknown":
            return False

        try:
            from packaging import version
            return version.parse(latest) > version.parse(current)
        except ImportError:
            # Fallback: simple string comparison
            return latest != current and latest > current

    async def get_update_status(self, force: bool = False) -> UpdateStatus:
        """
        Get combined update status for webapp and nirs4all.

        Args:
            force: If True, bypass cache and fetch fresh data

        Returns:
            UpdateStatus with all update information
        """
        # Check both in parallel
        webapp_task = asyncio.create_task(self.check_github_release(force))
        nirs4all_task = asyncio.create_task(self.check_pypi_release(force))

        webapp_info = await webapp_task
        nirs4all_info = await nirs4all_task

        # Get venv info
        venv_info = venv_manager.get_venv_info()

        return UpdateStatus(
            webapp=webapp_info,
            nirs4all=nirs4all_info,
            venv=venv_info.to_dict(),
            last_check=datetime.now().isoformat(),
            check_interval_hours=self.settings.check_interval_hours,
        )


# Lazy-initialized global update manager instance
_update_manager: UpdateManager | None = None


def get_update_manager() -> UpdateManager:
    """Get the global update manager instance (lazy initialization)."""
    global _update_manager
    if _update_manager is None:
        _update_manager = UpdateManager()
    return _update_manager


# For backward compatibility - will be lazily initialized on first access
class _LazyUpdateManager:
    """Proxy class for lazy access to update_manager."""

    def __getattr__(self, name):
        return getattr(get_update_manager(), name)


update_manager = _LazyUpdateManager()


# ============= API Endpoints =============


@router.get("/status")
async def get_update_status() -> UpdateStatus:
    """
    Get current update status for webapp and nirs4all.

    Returns cached results if available and not expired.
    """
    return await update_manager.get_update_status()


@router.post("/check")
async def check_for_updates() -> UpdateStatus:
    """
    Force a fresh check for updates.

    Bypasses cache and queries GitHub/PyPI directly.
    """
    return await update_manager.get_update_status(force=True)


@router.get("/webapp/changelog")
async def get_webapp_changelog(current_version: str | None = None) -> dict[str, Any]:
    """
    Get changelog entries between the current and latest webapp version.

    Fetches all GitHub releases newer than current_version and returns
    their release notes combined.
    """
    mgr = get_update_manager()
    if not current_version:
        current_version = mgr.get_webapp_version()

    repo = mgr.settings.github_repo
    api_url = f"https://api.github.com/repos/{repo}/releases"
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": f"{APP_NAME}/{current_version}",
    }

    try:
        status_code, content = await mgr._fetch_url(f"{api_url}?per_page=20", headers)
        if status_code != 200:
            return {"entries": [], "error": f"GitHub API returned {status_code}"}

        releases = json.loads(content)
        entries = []

        try:
            from packaging import version as pkg_version
            current_parsed = pkg_version.parse(current_version)
            use_packaging = True
        except ImportError:
            current_parsed = current_version
            use_packaging = False

        for release in releases:
            tag = release.get("tag_name", "").lstrip("v")
            if not tag:
                continue

            if use_packaging:
                try:
                    if pkg_version.parse(tag) <= current_parsed:
                        continue
                except Exception:
                    continue
            elif tag <= current_version:
                continue

            entries.append({
                "version": tag,
                "date": release.get("published_at"),
                "body": release.get("body", ""),
                "prerelease": release.get("prerelease", False),
            })

        # Sort newest first
        entries.sort(key=lambda e: e["version"], reverse=True)

        return {"entries": entries, "current_version": current_version}

    except Exception as e:
        return {"entries": [], "error": str(e)}


@router.get("/settings")
async def get_update_settings() -> UpdateSettings:
    """Get current update settings."""
    return update_manager.settings


@router.put("/settings")
async def update_settings(settings: dict[str, Any]) -> UpdateSettings:
    """Update settings (PATCH semantics — merge with existing)."""
    current = update_manager.settings.model_dump()
    current.update(settings)
    merged = UpdateSettings(**current)
    update_manager.update_settings(merged)
    return update_manager.settings


@router.get("/venv/status")
async def get_venv_status() -> dict[str, Any]:
    """
    Get managed venv status and installed packages.
    """
    venv_info = venv_manager.get_venv_info()
    packages = venv_manager.get_installed_packages()

    return {
        "venv": venv_info.to_dict(),
        "packages": [p.to_dict() for p in packages],
        "nirs4all_version": venv_manager.get_nirs4all_version(),
    }


@router.post("/venv/create")
async def create_venv(
    request: VenvCreateRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    """
    Create the managed virtual environment.

    This is an async operation. Poll /venv/status to check progress.
    """
    _check_not_standalone()

    # Check if already exists and valid
    if not request.force and venv_manager.get_venv_info().is_valid:
        return {
            "success": True,
            "message": "Virtual environment already exists",
            "already_existed": True,
        }

    # Create venv synchronously for now (could be made async with job system)
    success, message = venv_manager.create_venv(force=request.force)

    if not success:
        raise HTTPException(status_code=500, detail=message)

    result = {
        "success": True,
        "message": message,
        "already_existed": False,
    }

    # Install nirs4all if requested
    if request.install_nirs4all and success:
        install_success, install_msg, _ = venv_manager.install_package(
            "nirs4all",
            extras=request.extras,
        )
        result["nirs4all_installed"] = install_success
        result["install_message"] = install_msg

    return result


@router.post("/nirs4all/install")
async def install_nirs4all(request: InstallRequest) -> dict[str, Any]:
    """
    Install or upgrade nirs4all in the managed venv.

    Args:
        request: Installation parameters (version, extras)

    Returns:
        Installation result with status and output
    """
    _check_not_standalone()

    # Ensure venv exists
    if not venv_manager.get_venv_info().is_valid:
        # Try to create it
        success, message = venv_manager.create_venv()
        if not success:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to create virtual environment: {message}"
            )

    # Install nirs4all
    success, message, output = venv_manager.install_package(
        "nirs4all",
        version=request.version,
        extras=request.extras,
        upgrade=True,
    )

    if not success:
        raise HTTPException(status_code=500, detail=message)

    return {
        "success": True,
        "message": message,
        "version": venv_manager.get_nirs4all_version(),
        "output": output[-50:],  # Last 50 lines
        "requires_restart": True,  # nirs4all always requires restart
    }


@router.get("/webapp/download-info")
async def get_webapp_download_info() -> dict[str, Any]:
    """
    Get information needed to download a webapp update.
    """
    webapp_info = await update_manager.check_github_release()

    if not webapp_info.update_available:
        return {
            "update_available": False,
            "current_version": webapp_info.current_version,
            "latest_version": webapp_info.latest_version,
        }

    return {
        "update_available": True,
        "current_version": webapp_info.current_version,
        "latest_version": webapp_info.latest_version,
        "download_url": webapp_info.download_url,
        "asset_name": webapp_info.asset_name,
        "download_size_bytes": webapp_info.download_size_bytes,
        "release_notes": webapp_info.release_notes,
        "release_url": webapp_info.release_url,
    }


@router.post("/webapp/download-start")
async def start_webapp_download() -> dict[str, Any]:
    """
    Start downloading the webapp update in the background.

    Returns a job ID for tracking progress via WebSocket or polling.
    """
    from api.jobs.manager import JobType, job_manager

    webapp_info = await update_manager.check_github_release()

    if not webapp_info.update_available:
        raise HTTPException(status_code=400, detail="No update available")

    if not webapp_info.download_url:
        raise HTTPException(status_code=400, detail="No download URL available for this platform")

    # Create download job
    job = job_manager.create_job(
        JobType.UPDATE_DOWNLOAD,
        config={
            "version": webapp_info.latest_version,
            "download_url": webapp_info.download_url,
            "asset_name": webapp_info.asset_name,
            "expected_size": webapp_info.download_size_bytes or 0,
            "checksum": webapp_info.checksum_sha256,
        },
    )

    # Submit job for execution
    job_manager.submit_job(job, _execute_download_job)

    return {
        "job_id": job.id,
        "status": "started",
        "version": webapp_info.latest_version,
        "asset_name": webapp_info.asset_name,
        "message": f"Downloading {webapp_info.asset_name}...",
    }


def _execute_download_job(job: "Job", progress_callback: Callable[[float, str], None]) -> dict[str, Any]:
    """Execute the download job (runs in thread pool)."""
    from api.update_downloader import download_and_stage_update
    from updater import get_staging_dir

    def _progress_wrapper(progress: float, message: str) -> bool:
        """Wrap progress callback to check for cancellation."""
        if job.cancellation_requested:
            return False
        progress_callback(progress, message)
        return True

    # Run the async download in a new event loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        success, message, staging_path = loop.run_until_complete(
            download_and_stage_update(
                download_url=job.config["download_url"],
                expected_size=job.config.get("expected_size", 0),
                expected_checksum=job.config.get("checksum"),
                progress_callback=_progress_wrapper,
            )
        )
    finally:
        loop.close()

    if not success:
        # If the job was cancelled, return normally so the job manager
        # can detect cancellation_requested and set CANCELLED status
        # instead of the exception path which maps to FAILED.
        if job.cancellation_requested:
            return {"cancelled": True, "message": message}
        raise Exception(message)

    _write_staged_update_metadata(
        get_staging_dir(),
        version=job.config["version"],
        asset_name=job.config.get("asset_name"),
        update_mode=_expected_update_mode(),
    )

    return {
        "staging_path": str(staging_path) if staging_path else None,
        "version": job.config["version"],
        "ready_to_apply": True,
    }


@router.get("/webapp/download-status/{job_id}")
async def get_download_status(job_id: str) -> dict[str, Any]:
    """Get the status of an update download job."""
    from api.jobs.manager import job_manager

    job = job_manager.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return {
        "job_id": job.id,
        "status": job.status.value,
        "progress": job.progress,
        "message": job.progress_message,
        "result": job.result,
        "error": job.error,
    }


@router.post("/webapp/download-cancel/{job_id}")
async def cancel_download(job_id: str) -> dict[str, Any]:
    """Cancel an in-progress download."""
    from api.jobs.manager import job_manager

    job = job_manager.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    cancelled = job_manager.cancel_job(job_id)

    if not cancelled:
        return {
            "success": False,
            "message": "Job is already completed or cannot be cancelled",
        }

    return {
        "success": True,
        "message": "Cancellation requested",
    }


class ApplyUpdateRequest(BaseModel):
    """Request to apply a staged update."""
    confirm: bool = True


@router.post("/webapp/apply")
async def apply_webapp_update(request: ApplyUpdateRequest) -> dict[str, Any]:
    """
    Apply the staged webapp update.

    This will:
    1. Create an updater script
    2. Launch the updater script
    3. Signal the app to exit

    The updater script will:
    1. Wait for this app to exit
    2. Backup the current installation
    3. Copy new files from staging
    4. Launch the new version
    """
    from updater import create_updater_script, get_staging_dir, launch_updater

    if not request.confirm:
        raise HTTPException(status_code=400, detail="Update not confirmed")

    staging_dir = get_staging_dir()
    content_dir, update_mode = _validate_staged_update_layout(staging_dir)

    try:
        # Create the updater script
        script_path, _ = create_updater_script(content_dir)

        # Launch the updater (it will wait for us to exit)
        success = launch_updater(script_path)

        if not success:
            raise HTTPException(
                status_code=500,
                detail="Failed to launch updater script",
            )

        return {
            "success": True,
            "message": f"Update will be applied after app restart ({update_mode} mode). Please close the application.",
            "restart_required": True,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to apply update: {str(e)}",
        )


@router.get("/webapp/staged-update")
async def get_staged_update_info() -> dict[str, Any]:
    """Get information about any staged update."""
    from updater import get_staging_dir

    staging_dir = get_staging_dir()

    if not staging_dir.exists() or not _staging_entries(staging_dir):
        return {
            "has_staged_update": False,
        }

    metadata = _read_staged_update_metadata(staging_dir) or {}

    # Try to find version info in staged update
    version_file = None
    content_dir = _resolve_staged_content_dir(staging_dir)
    if content_dir is not None:
        if content_dir.is_dir():
            for candidate in [
                content_dir / "version.json",
                content_dir / "resources" / "version.json",
                content_dir / "Contents" / "Resources" / "version.json",
            ]:
                if candidate.exists():
                    version_file = candidate
                    break

    version = metadata.get("version")
    if version_file and version_file.exists():
        try:
            with open(version_file, encoding="utf-8") as f:
                data = json.load(f)
                version = data.get("version") or version
        except Exception:
            pass

    return {
        "has_staged_update": True,
        "staging_path": str(staging_dir),
        "version": version,
        "asset_name": metadata.get("asset_name"),
        "update_mode": metadata.get("update_mode"),
    }


@router.delete("/webapp/staged-update")
async def cancel_staged_update() -> dict[str, Any]:
    """Cancel/remove a staged update."""
    from updater import get_staging_dir

    staging_dir = get_staging_dir()

    if staging_dir.exists():
        shutil.rmtree(staging_dir, ignore_errors=True)
        return {"success": True, "message": "Staged update removed"}

    return {"success": True, "message": "No staged update to remove"}


@router.post("/webapp/cleanup")
async def cleanup_updates() -> dict[str, Any]:
    """Clean up old update artifacts."""
    from updater import cleanup_old_updates

    cleanup_old_updates()
    return {"success": True, "message": "Cleanup complete"}


@router.post("/webapp/download")
async def download_webapp_update(background_tasks: BackgroundTasks) -> dict[str, Any]:
    """
    Download the latest webapp update (legacy endpoint).

    Use /webapp/download-start for the new job-based download.
    """
    webapp_info = await update_manager.check_github_release()

    if not webapp_info.update_available:
        raise HTTPException(status_code=400, detail="No update available")

    if not webapp_info.download_url:
        raise HTTPException(status_code=400, detail="No download URL available for this platform")

    return {
        "status": "ready",
        "download_url": webapp_info.download_url,
        "asset_name": webapp_info.asset_name,
        "version": webapp_info.latest_version,
        "message": "Use /webapp/download-start for automatic download.",
    }


@router.post("/webapp/restart")
async def restart_webapp() -> dict[str, Any]:
    """
    Request webapp restart.

    In Electron mode: the frontend should call window.electronApi.restartBackend().
    In web mode: signals graceful shutdown so the process manager can restart.
    """
    is_electron = os.environ.get("NIRS4ALL_ELECTRON") == "true"

    if not is_electron:
        # In web mode, schedule a graceful shutdown after response is sent.
        # A process manager (systemd, Docker) should restart the process.
        import signal

        async def _shutdown():
            await asyncio.sleep(1)
            os.kill(os.getpid(), signal.SIGTERM)

        asyncio.create_task(_shutdown())

    return {
        "success": True,
        "message": "Restart requested.",
        "restart_required": True,
        "is_electron": is_electron,
    }


@router.get("/version")
async def get_versions() -> dict[str, Any]:
    """
    Get current version information.
    """
    return {
        "webapp_version": update_manager.get_webapp_version(),
        "nirs4all_version": update_manager.get_nirs4all_version(),
        "python_version": sys.version,
        "platform": platform.system(),
        "machine": platform.machine(),
    }


# ============= Dependency Management Endpoints =============


async def _get_pypi_version(package: str) -> str | None:
    """Get the latest version of a package from PyPI."""
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


def _filter_profile_managed_categories(categories: list[DependencyCategory]) -> list[DependencyCategory]:
    """Remove profile-managed packages from dependency category payloads."""
    filtered_categories: list[DependencyCategory] = []
    for category in categories:
        filtered_packages = [
            pkg for pkg in category.packages
            if not _is_profile_managed_dependency(pkg.name)
        ]
        filtered_categories.append(DependencyCategory(
            id=category.id,
            name=category.name,
            description=category.description,
            packages=filtered_packages,
            installed_count=sum(1 for pkg in filtered_packages if pkg.is_installed),
            total_count=len(filtered_packages),
        ))
    return filtered_categories


@router.get("/dependencies")
async def get_dependencies(force_refresh: bool = False) -> DependenciesResponse:
    """
    Get all nirs4all optional dependencies with their installation status.

    Returns cached results if available. Use force_refresh=true to bypass cache.
    """
    venv_info = venv_manager.get_venv_info()
    venv_path = str(venv_info.path)

    # Check cache first (unless force refresh)
    if not force_refresh:
        cached = _dependencies_cache.get(venv_path)
        if cached:
            current_nirs4all_version = venv_manager.get_nirs4all_version()
            if not isinstance(current_nirs4all_version, str):
                current_nirs4all_version = cached.get("nirs4all_version")
            current_nirs4all_installed = current_nirs4all_version is not None
            cached_categories = _filter_profile_managed_categories(
                [DependencyCategory(**cat) for cat in cached.get("categories", [])]
            )
            total_installed = sum(cat.installed_count for cat in cached_categories)
            total_packages = sum(cat.total_count for cat in cached_categories)
            # Return cached data
            return DependenciesResponse(
                categories=cached_categories,
                venv_valid=venv_info.is_valid,
                venv_path=venv_path,
                nirs4all_installed=current_nirs4all_installed,
                nirs4all_version=current_nirs4all_version,
                total_installed=total_installed,
                total_packages=total_packages,
                cached_at=cached.get("cached_at"),
            )

    installed_packages = {}

    # Get installed packages from venv
    if venv_info.is_valid:
        for pkg in venv_manager.get_installed_packages():
            installed_packages[pkg.name.lower()] = pkg.version

    # Get outdated packages for update detection
    outdated_packages = {}
    if venv_info.is_valid:
        for pkg in venv_manager.get_outdated_packages():
            outdated_packages[pkg["name"].lower()] = pkg["latest_version"]

    categories = []
    total_installed = 0
    total_packages = 0

    for cat_id, cat_data in NIRS4ALL_OPTIONAL_DEPS.items():
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
    nirs4all_version = venv_manager.get_nirs4all_version()
    nirs4all_installed = nirs4all_version is not None

    # Cache the results
    cache_data = {
        "categories": [cat.model_dump() for cat in categories],
        "venv_valid": venv_info.is_valid,
        "nirs4all_installed": nirs4all_installed,
        "nirs4all_version": nirs4all_version,
        "total_installed": total_installed,
        "total_packages": total_packages,
    }
    _dependencies_cache.set(venv_path, cache_data)

    return DependenciesResponse(
        categories=categories,
        venv_valid=venv_info.is_valid,
        venv_path=venv_path,
        nirs4all_installed=nirs4all_installed,
        nirs4all_version=nirs4all_version,
        total_installed=total_installed,
        total_packages=total_packages,
        cached_at=datetime.now().isoformat(),
    )


def _check_not_standalone() -> None:
    """Raise if running in a read-only bundled runtime."""
    runtime_mode = str(os.environ.get("NIRS4ALL_RUNTIME_MODE", "")).strip().lower()
    if getattr(sys, "_MEIPASS", None) or runtime_mode == "bundled":
        raise HTTPException(
            status_code=400,
            detail="Package management is not available in the all-in-one bundle.",
        )


@router.post("/dependencies/install")
async def install_dependency(request: PackageInstallRequest) -> dict[str, Any]:
    """
    Install a package in the managed virtual environment.

    Args:
        request: Package name and optional version

    Returns:
        Installation result with status and output
    """
    _check_not_standalone()

    if _is_profile_managed_dependency(request.package):
        raise HTTPException(
            status_code=400,
            detail="torch is managed by the active compute profile. Use Config Alignment or rerun setup to switch CPU/GPU variants.",
        )

    # Ensure venv exists
    if not venv_manager.get_venv_info().is_valid:
        success, message = venv_manager.create_venv()
        if not success:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to create virtual environment: {message}"
            )

    # Determine version to install based on target
    install_version = request.version
    install_upgrade = request.upgrade
    if not install_version:
        if request.target == "latest" or install_upgrade:
            install_upgrade = True
        elif request.target == "recommended" or request.target is None:
            # Look up recommended version from NIRS4ALL_OPTIONAL_DEPS
            for _cat_id, cat_data in NIRS4ALL_OPTIONAL_DEPS.items():
                for pkg_def in cat_data.get("packages", []):
                    if pkg_def["name"].lower() == request.package.lower():
                        recommended = pkg_def.get("recommended_version")
                        if recommended:
                            install_version = recommended
                        break

    # Install the package
    success, message, output = venv_manager.install_package(
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
    _dependencies_cache.invalidate()

    # Get the installed version
    installed_version = venv_manager.get_package_version(request.package)

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
    Uninstall a package from the managed virtual environment.

    Args:
        request: Package name

    Returns:
        Uninstallation result
    """
    _check_not_standalone()

    if not venv_manager.get_venv_info().is_valid:
        raise HTTPException(
            status_code=400,
            detail="Virtual environment is not valid"
        )

    success, message = venv_manager.uninstall_package(request.package)

    if not success:
        raise HTTPException(status_code=500, detail=message)

    # Invalidate cache after uninstall
    _dependencies_cache.invalidate()

    return {
        "success": True,
        "message": message,
        "package": request.package,
        "requires_restart": request.package.lower() in RESTART_REQUIRED_PACKAGES,
    }


@router.post("/dependencies/revert")
async def revert_dependency(request: PackageUninstallRequest) -> dict[str, Any]:
    """Revert a package to its recommended version."""
    _check_not_standalone()

    if _is_profile_managed_dependency(request.package):
        raise HTTPException(
            status_code=400,
            detail="torch is managed by the active compute profile. Use Config Alignment or rerun setup to switch CPU/GPU variants.",
        )

    pkg_info = None
    for _cat_id, cat_data in NIRS4ALL_OPTIONAL_DEPS.items():
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

    success, message, output = venv_manager.install_package(request.package, version=recommended)
    _dependencies_cache.invalidate()

    new_version = venv_manager.get_package_version(request.package)
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
    _check_not_standalone()

    if _is_profile_managed_dependency(request.package):
        raise HTTPException(
            status_code=400,
            detail="torch is managed by the active compute profile. Use Config Alignment or rerun setup to switch CPU/GPU variants.",
        )

    # Ensure venv exists
    if not venv_manager.get_venv_info().is_valid:
        raise HTTPException(
            status_code=400,
            detail="Virtual environment is not valid"
        )

    # Update the package
    success, message, output = venv_manager.install_package(
        request.package,
        upgrade=True,
    )

    if not success:
        raise HTTPException(status_code=500, detail=message)

    # Invalidate cache after update
    _dependencies_cache.invalidate()

    # Get the new version
    installed_version = venv_manager.get_package_version(request.package)

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
    _dependencies_cache.invalidate()

    # Return success - the next get_dependencies call will do a fresh scan
    return {
        "success": True,
        "message": "Dependencies cache cleared. Next request will do a fresh scan.",
    }


# ============= Venv Path Management =============


@router.get("/venv/path")
async def get_venv_path() -> dict[str, Any]:
    """
    Get the current virtual environment path configuration.
    """
    venv_info = venv_manager.get_venv_info()

    return {
        "current_path": str(venv_manager.venv_path),
        "is_valid": venv_info.is_valid,
        "exists": venv_info.exists,
    }



# ============= Working Config Snapshot =============

SNAPSHOTS_DIR_NAME = "config_snapshots"


def _get_snapshots_dir() -> Path:
    """Get the directory for storing config snapshots."""
    app_data = Path(_user_data_dir(APP_NAME, APP_AUTHOR))
    snapshots_dir = app_data / SNAPSHOTS_DIR_NAME
    snapshots_dir.mkdir(parents=True, exist_ok=True)
    return snapshots_dir


@router.get("/venv/snapshots")
async def list_snapshots() -> dict[str, Any]:
    """List all saved config snapshots."""
    snapshots_dir = _get_snapshots_dir()
    snapshots = []

    for f in sorted(snapshots_dir.glob("*.txt"), key=lambda p: p.stat().st_mtime, reverse=True):
        stat = f.stat()
        # Read first line for metadata (comment with label)
        label = f.stem
        try:
            first_line = f.read_text(encoding="utf-8").split("\n", 1)[0]
            if first_line.startswith("# "):
                label = first_line[2:].strip()
        except Exception:
            pass

        snapshots.append({
            "name": f.stem,
            "label": label,
            "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "size_bytes": stat.st_size,
        })

    return {"snapshots": snapshots}


class SnapshotCreateRequest(BaseModel):
    """Request to create a config snapshot."""
    label: str | None = None


@router.post("/venv/snapshots")
async def create_snapshot(request: SnapshotCreateRequest) -> dict[str, Any]:
    """
    Save the current pip freeze output as a config snapshot.

    This captures all installed packages and versions in the managed venv.
    """
    if not venv_manager.get_venv_info().is_valid:
        raise HTTPException(status_code=400, detail="Virtual environment is not valid")

    # Run pip freeze
    freeze_output = venv_manager.run_pip_command(["freeze"])
    if freeze_output is None:
        raise HTTPException(status_code=500, detail="Failed to run pip freeze")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    label = request.label or f"Snapshot {timestamp}"
    filename = f"snapshot_{timestamp}.txt"

    snapshots_dir = _get_snapshots_dir()
    snapshot_path = snapshots_dir / filename

    content = f"# {label}\n{freeze_output}"
    snapshot_path.write_text(content, encoding="utf-8")

    return {
        "success": True,
        "name": snapshot_path.stem,
        "label": label,
        "created_at": datetime.now().isoformat(),
    }


@router.post("/venv/snapshots/{name}/restore")
async def restore_snapshot(name: str) -> dict[str, Any]:
    """
    Restore a config snapshot by running pip install -r on the snapshot file.

    This will install all packages at the exact versions captured in the snapshot.
    """
    _check_not_standalone()

    if not venv_manager.get_venv_info().is_valid:
        raise HTTPException(status_code=400, detail="Virtual environment is not valid")

    snapshots_dir = _get_snapshots_dir()
    snapshot_path = snapshots_dir / f"{name}.txt"

    if not snapshot_path.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found")

    # Filter out comment lines for pip install
    lines = snapshot_path.read_text(encoding="utf-8").strip().split("\n")
    requirements = [line for line in lines if line.strip() and not line.startswith("#")]
    if not requirements:
        raise HTTPException(status_code=400, detail="Snapshot is empty")

    # Write a temp requirements file without comments
    temp_req = snapshots_dir / f"_restore_{name}.txt"
    temp_req.write_text("\n".join(requirements), encoding="utf-8")

    try:
        output = venv_manager.run_pip_command(["install", "-r", str(temp_req)])
        if output is None:
            raise HTTPException(status_code=500, detail="pip install failed")
    finally:
        temp_req.unlink(missing_ok=True)

    # Invalidate caches
    _dependencies_cache.invalidate()

    return {
        "success": True,
        "message": f"Restored snapshot '{name}' successfully",
    }


@router.delete("/venv/snapshots/{name}")
async def delete_snapshot(name: str) -> dict[str, Any]:
    """Delete a config snapshot."""
    snapshots_dir = _get_snapshots_dir()
    snapshot_path = snapshots_dir / f"{name}.txt"

    if not snapshot_path.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found")

    snapshot_path.unlink()
    return {"success": True, "message": f"Snapshot '{name}' deleted"}
