"""
Update-check core for the nirs4all webapp.

Owns the GitHub/PyPI polling, caching, asset matching, the webapp staging
helpers, and the shared singletons that the endpoint submodules and the test
suite reach through ``api.updates``. The optional-dependency catalog, request
models, and dependency-scan cache live in the ``catalog`` submodule.
"""

import asyncio
import json
import os
import platform
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from ..venv_manager import venv_manager
from .catalog import (
    APP_AUTHOR,
    APP_NAME,
    _resolve_user_data_dir,
    logger,
)
from .staging import _is_portable_runtime

# Try to import httpx for async HTTP requests, fall back to urllib
try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False
    import urllib.error
    import urllib.request


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
    from ..network_state import OfflineError

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


# Default configuration
DEFAULT_GITHUB_REPO = "GBeurier/nirs4all-webapp"
DEFAULT_PYPI_PACKAGE = "nirs4all"
DEFAULT_CHECK_INTERVAL_HOURS = 24
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
    runtime: dict[str, Any]
    venv: dict[str, Any] | None = None
    last_check: str | None = None
    check_interval_hours: int = DEFAULT_CHECK_INTERVAL_HOURS


class InstallRequest(BaseModel):
    """Request to install/upgrade a package."""
    version: str | None = None
    extras: list[str] | None = None


# ============= Online-probe TTL cache =============

# Caching the online-probe result for a short window avoids hitting the network
# probe on every individual GitHub/PyPI fetch (the update-status view fans out
# to several fetches in quick succession).
_ONLINE_PROBE_TTL = timedelta(seconds=30)
_online_probe: tuple[datetime, bool] | None = None


async def _is_online_cached() -> bool:
    """Return the cached online-probe result, refreshing it past the TTL."""
    global _online_probe
    from ..network_state import is_online

    now = datetime.now()
    if _online_probe is not None:
        probed_at, value = _online_probe
        if now - probed_at < _ONLINE_PROBE_TTL:
            return value

    value = await is_online()
    _online_probe = (now, value)
    return value


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
        self._app_data_dir = Path(_resolve_user_data_dir(APP_NAME, APP_AUTHOR))
        self._settings_path = self._app_data_dir / self.SETTINGS_FILE
        self._cache_path = self._app_data_dir / self.CACHE_FILE
        self._settings: UpdateSettings | None = None
        self._cache: dict[str, Any] | None = None
        # nirs4all version is probed via a subprocess that imports the full ML
        # stack (~15-20s cold). It is immutable for a process lifetime barring
        # an in-session upgrade, so memoize it and refresh only on force.
        self._nirs4all_version_cached: str | None = None
        self._nirs4all_version_probed = False
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

        package_json = Path(__file__).parent.parent.parent / "package.json"
        if not getattr(sys, "_MEIPASS", None) and package_json.exists():
            try:
                with open(package_json, encoding="utf-8") as f:
                    data = json.load(f)
                    return data.get("version", "unknown")
            except Exception:
                pass

        # Try to find version.json in app directory
        version_paths = [
            Path(__file__).parent.parent.parent / self.VERSION_FILE,
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

    def get_nirs4all_version(self, force: bool = False) -> str | None:
        """Get the installed nirs4all version from the current runtime.

        Memoized: the underlying probe spawns a subprocess that imports the
        full ML stack. Pass ``force=True`` (the explicit "check for updates"
        path) to re-probe after an in-session upgrade.
        """
        if force or not self._nirs4all_version_probed:
            self._nirs4all_version_cached = venv_manager.get_nirs4all_version()
            self._nirs4all_version_probed = True
        return self._nirs4all_version_cached

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
        from ..network_state import OfflineError
        if not await _is_online_cached():
            raise OfflineError(f"Skipping fetch (offline): {url}")

        if HTTPX_AVAILABLE:
            timeout = httpx.Timeout(3.0, connect=3.0)
            async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
                response = await client.get(url, headers=headers)
                return response.status_code, response.text
        else:
            # Fallback to synchronous urllib, run off the event loop.
            def _blocking_fetch() -> tuple[int, str]:
                req = urllib.request.Request(url, headers=headers or {})
                try:
                    with urllib.request.urlopen(req, timeout=3) as response:
                        return response.status, response.read().decode("utf-8")
                except urllib.error.HTTPError as e:
                    return e.code, ""

            return await asyncio.to_thread(_blocking_fetch)

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
        # get_nirs4all_version() spawns a subprocess that imports nirs4all
        # (the full ML stack — up to ~20s cold). Off-load it so it cannot block
        # the event loop and stall every other in-flight request.
        current_version = await asyncio.to_thread(self.get_nirs4all_version, force)
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

        # Get venv info (sync; inspects the venv) — keep it off the loop too.
        venv_info = await asyncio.to_thread(venv_manager.get_venv_info)

        return UpdateStatus(
            webapp=webapp_info,
            nirs4all=nirs4all_info,
            runtime=venv_info.to_dict(),
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


# Lazy proxy: defers heavy UpdateManager construction until first access
class _LazyUpdateManager:
    """Proxy class for lazy access to update_manager."""

    def __getattr__(self, name):
        return getattr(get_update_manager(), name)


update_manager = _LazyUpdateManager()
