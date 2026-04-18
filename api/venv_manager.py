"""
Current-runtime package manager for nirs4all webapp.

This module provides pip/package operations targeting the running Python
interpreter (sys.executable / sys.prefix).  No custom-path machinery —
the webapp always operates on the environment it was launched with.
"""

import json
import os
import subprocess
import sys
import time
import venv
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .shared.logger import get_logger
from .shared.runtime_paths import get_portable_backend_data_dir

logger = get_logger(__name__)

try:
    import platformdirs
except ImportError:
    platformdirs = None  # type: ignore[assignment]
    logger.info("platformdirs not available, using fallback paths")


# App identification for platformdirs
APP_NAME = "nirs4all-webapp"
APP_AUTHOR = "nirs4all"


def _user_data_dir(app_name: str, app_author: str | None = None) -> str:
    """Get user data directory, with fallback if platformdirs is missing."""
    portable_dir = get_portable_backend_data_dir(app_name)
    if portable_dir is not None:
        return str(portable_dir)

    if platformdirs is not None:
        return platformdirs.user_data_dir(app_name, app_author)
    # Minimal fallback
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA", os.path.expanduser("~\\AppData\\Local"))
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
    return os.path.join(base, app_name)


@dataclass
class VenvInfo:
    """Information about the current Python runtime."""
    path: str
    exists: bool
    is_valid: bool
    python_executable: str | None = None
    python_version: str | None = None
    pip_version: str | None = None
    created_at: str | None = None
    last_updated: str | None = None
    size_bytes: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PackageInfo:
    """Information about an installed package."""
    name: str
    version: str
    location: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# Short-TTL in-memory cache for get_installed_packages(). Keyed on a
# fingerprint derived from the active interpreter path (and its mtime, when
# cheaply available). If no reliable fingerprint can be built we skip caching
# on that call.
_INSTALLED_PACKAGES_CACHE_TTL_SECONDS = 30.0
_installed_packages_cache: dict[str, tuple[float, list["PackageInfo"]]] = {}


def _installed_packages_fingerprint(python_exe: Path) -> str | None:
    """Build a cheap fingerprint for the active interpreter.

    Returns None if no reliable signal can be established — callers MUST treat
    that as "do not cache".
    """
    try:
        exe_str = str(python_exe)
    except Exception:
        return None
    if not exe_str:
        return None
    parts: list[str] = [exe_str, sys.executable or ""]
    try:
        st = os.stat(exe_str)
        parts.append(f"{st.st_mtime_ns}:{st.st_size}")
    except OSError:
        # Interpreter path not stat-able — still cache on path identity alone,
        # since sys.executable is part of the key.
        pass
    return "|".join(parts)


def invalidate_installed_packages_cache() -> None:
    """Drop the cached installed-packages result.

    Other modules can call this after mutating the environment (install /
    uninstall / upgrade). Not wired to any callers in this phase — exposed so
    they can opt in later.
    """
    _installed_packages_cache.clear()


class VenvManager:
    """
    Manages the Python environment for nirs4all dependencies.

    Always uses the CURRENT Python environment (the one running the webapp):
    - In dev mode: uses your activated venv (e.g., .venv in project root)
    - In production/bundled mode: uses the shipped Python environment
    """

    METADATA_FILE = "venv_metadata.json"

    def __init__(self):
        """Initialize the venv manager."""
        self._app_data_dir = Path(_user_data_dir(APP_NAME, APP_AUTHOR))

    @property
    def _venv_path(self) -> Path:
        """Get the current venv path (always sys.prefix)."""
        return Path(sys.prefix)

    @property
    def _metadata_path(self) -> Path:
        """Get the metadata file path."""
        return self._venv_path / self.METADATA_FILE

    @property
    def venv_path(self) -> Path:
        """Get the root path of the current Python runtime."""
        return self._venv_path

    @property
    def python_executable(self) -> Path:
        """Get the path to the Python executable."""
        return Path(sys.executable)

    @property
    def pip_executable(self) -> Path:
        """Get the path to pip."""
        python_dir = Path(sys.executable).parent
        if sys.platform == "win32":
            # In a venv, pip.exe is next to python.exe in Scripts/
            direct = python_dir / "pip.exe"
            if direct.exists():
                return direct
            # For base Python installs where pip is in a Scripts subfolder
            # (python_dir might be the root, not Scripts/)
            parent_scripts = python_dir.parent / "Scripts" / "pip.exe"
            if parent_scripts.exists():
                return parent_scripts
            return direct  # Return expected path (better error than wrong path)
        return python_dir / "pip"

    def get_venv_info(self) -> VenvInfo:
        """Get information about the current Python runtime."""
        info = VenvInfo(
            path=str(self._venv_path),
            exists=self._venv_path.exists(),
            is_valid=self._is_valid_venv(),
            python_executable=str(self.python_executable),
        )

        if info.is_valid:
            # Get Python version
            try:
                result = subprocess.run(
                    [str(self.python_executable), "--version"],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if result.returncode == 0:
                    info.python_version = result.stdout.strip().replace("Python ", "")
            except Exception:
                pass

            # Get pip version
            try:
                result = subprocess.run(
                    [str(self.pip_executable), "--version"],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if result.returncode == 0:
                    # Output: "pip X.Y.Z from /path/to/pip (python X.Y)"
                    info.pip_version = result.stdout.split()[1]
            except Exception:
                pass

            # Load metadata
            metadata = self._load_metadata()
            if metadata:
                info.created_at = metadata.get("created_at")
                info.last_updated = metadata.get("last_updated")

            # Calculate size
            info.size_bytes = self._get_directory_size(self._venv_path)

        return info

    def _is_valid_venv(self) -> bool:
        """Check if the venv exists and has a valid Python executable."""
        if not self._venv_path.exists():
            return False
        if not self.python_executable.exists():
            return False

        # Try to run Python to verify it works
        try:
            result = subprocess.run(
                [str(self.python_executable), "-c", "print('ok')"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            return result.returncode == 0 and "ok" in result.stdout
        except Exception:
            return False

    def _load_metadata(self) -> dict[str, Any] | None:
        """Load venv metadata from file."""
        if not self._metadata_path.exists():
            return None
        try:
            with open(self._metadata_path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def _save_metadata(self, metadata: dict[str, Any]) -> None:
        """Save venv metadata to file."""
        try:
            with open(self._metadata_path, "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2)
        except Exception as e:
            logger.warning("Could not save venv metadata: %s", e)

    def _get_directory_size(self, path: Path) -> int:
        """Calculate total size of a directory in bytes."""
        total = 0
        try:
            for entry in path.rglob("*"):
                if entry.is_file():
                    total += entry.stat().st_size
        except Exception:
            pass
        return total

    def create_venv(
        self,
        progress_callback: Callable[[float, str], None] | None = None,
        force: bool = False,
    ) -> tuple[bool, str]:
        """
        Legacy helper that creates a Python environment in-place.

        Args:
            progress_callback: Optional callback for progress updates (percent, message)
            force: If True, recreate even if venv exists

        Returns:
            Tuple of (success, message)
        """
        if progress_callback:
            progress_callback(0, "Checking existing environment...")

        # Check if already exists
        if self._venv_path.exists() and not force:
            if self._is_valid_venv():
                return True, "Virtual environment already exists and is valid"
            # Exists but invalid - remove it
            if progress_callback:
                progress_callback(5, "Removing invalid environment...")
            import shutil
            shutil.rmtree(self._venv_path, ignore_errors=True)
        elif self._venv_path.exists() and force:
            if progress_callback:
                progress_callback(5, "Removing existing environment...")
            import shutil
            shutil.rmtree(self._venv_path, ignore_errors=True)

        # Ensure parent directory exists
        self._app_data_dir.mkdir(parents=True, exist_ok=True)

        if progress_callback:
            progress_callback(10, "Creating virtual environment...")

        # Create the venv
        try:
            builder = venv.EnvBuilder(
                system_site_packages=False,
                clear=False,
                symlinks=(sys.platform != "win32"),
                upgrade=False,
                with_pip=True,
            )
            builder.create(str(self._venv_path))
        except Exception as e:
            return False, f"Failed to create virtual environment: {e}"

        if not self._is_valid_venv():
            return False, "Created venv but it failed validation"

        if progress_callback:
            progress_callback(30, "Upgrading pip...")

        # Upgrade pip
        try:
            result = subprocess.run(
                [str(self.python_executable), "-m", "pip", "install", "--upgrade", "pip"],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode != 0:
                logger.warning("pip upgrade failed: %s", result.stderr)
        except Exception as e:
            logger.warning("pip upgrade failed: %s", e)

        if progress_callback:
            progress_callback(40, "Environment created successfully")

        # Save metadata
        self._save_metadata({
            "created_at": datetime.now().isoformat(),
            "last_updated": datetime.now().isoformat(),
            "python_version": sys.version,
        })

        return True, "Virtual environment created successfully"

    def install_package(
        self,
        package: str,
        version: str | None = None,
        extras: list[str] | None = None,
        upgrade: bool = False,
        extra_pip_args: list[str] | None = None,
        force_reinstall: bool = False,
        progress_callback: Callable[[float, str], None] | None = None,
    ) -> tuple[bool, str, list[str]]:
        """
        Install a package in the current Python runtime.

        Args:
            package: Package name (e.g., "nirs4all")
            version: Optional version specifier (e.g., "0.7.0")
            extras: Optional list of extras (e.g., ["tensorflow", "torch"])
            upgrade: If True, upgrade to latest version
            extra_pip_args: Optional extra pip flags (e.g., index URLs)
            force_reinstall: If True, force reinstall even when version matches
            progress_callback: Optional callback for progress updates

        Returns:
            Tuple of (success, message, output_lines)
        """
        if not self._is_valid_venv():
            return False, "Virtual environment is not valid", []

        # Build package specifier
        pkg_spec = package
        if extras:
            pkg_spec = f"{package}[{','.join(extras)}]"
        if version:
            pkg_spec = f"{pkg_spec}=={version}"

        if progress_callback:
            progress_callback(0, f"Installing {pkg_spec}...")

        # Build pip command — use python -m pip (more reliable than direct pip path)
        cmd = [str(self.python_executable), "-m", "pip", "install"]
        if upgrade:
            cmd.append("--upgrade")
        if force_reinstall:
            cmd.append("--force-reinstall")
        if extra_pip_args:
            cmd.extend(extra_pip_args)
        cmd.append(pkg_spec)

        output_lines = []
        try:
            # Run pip install
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )

            # Stream output
            for line in iter(process.stdout.readline, ""):
                line = line.strip()
                if line:
                    output_lines.append(line)
                    if progress_callback:
                        # Estimate progress based on output
                        if "Collecting" in line:
                            progress_callback(20, line)
                        elif "Downloading" in line:
                            progress_callback(40, line)
                        elif "Installing" in line:
                            progress_callback(70, line)
                        elif "Successfully" in line:
                            progress_callback(95, line)

            process.wait(timeout=600)

            if process.returncode != 0:
                # Surface the real pip error: log full output and include the
                # tail in the returned message so the caller can show it.
                logger.error(
                    "pip install %s failed with code %s. Output:\n%s",
                    pkg_spec,
                    process.returncode,
                    "\n".join(output_lines),
                )
                tail = "\n".join(output_lines[-15:]) if output_lines else "(no output captured)"
                return (
                    False,
                    f"pip install failed with code {process.returncode}:\n{tail}",
                    output_lines,
                )

        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=10)
            return False, "Installation timed out after 600 seconds", output_lines
        except Exception as e:
            return False, f"Installation failed: {e}", output_lines

        # Update metadata
        metadata = self._load_metadata() or {}
        metadata["last_updated"] = datetime.now().isoformat()
        self._save_metadata(metadata)
        invalidate_installed_packages_cache()

        if progress_callback:
            progress_callback(100, f"Successfully installed {package}")

        return True, f"Successfully installed {pkg_spec}", output_lines

    def get_installed_packages(self) -> list[PackageInfo]:
        """Get list of installed packages in the venv."""
        if not self._is_valid_venv():
            return []

        fingerprint = _installed_packages_fingerprint(self.python_executable)
        now = time.monotonic()
        if fingerprint is not None:
            cached = _installed_packages_cache.get(fingerprint)
            if cached is not None:
                cached_at, cached_pkgs = cached
                if now - cached_at < _INSTALLED_PACKAGES_CACHE_TTL_SECONDS:
                    return list(cached_pkgs)

        packages = []
        try:
            result = subprocess.run(
                [str(self.python_executable), "-m", "pip", "list", "--format=json"],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                for pkg in data:
                    packages.append(PackageInfo(
                        name=pkg.get("name", ""),
                        version=pkg.get("version", ""),
                    ))
        except Exception as e:
            logger.error("Error getting installed packages: %s", e)
            return packages

        if fingerprint is not None:
            _installed_packages_cache[fingerprint] = (now, list(packages))

        return packages

    def run_pip_command(self, args: list[str], timeout: int = 120) -> str | None:
        """
        Run an arbitrary pip command and return stdout.

        Args:
            args: Arguments to pass to pip (e.g. ["freeze"])
            timeout: Command timeout in seconds

        Returns:
            stdout as string, or None on failure
        """
        if not self._is_valid_venv():
            return None
        try:
            result = subprocess.run(
                [str(self.python_executable), "-m", "pip"] + args,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            if result.returncode == 0:
                return result.stdout
            logger.error("pip command failed: %s", result.stderr)
            return None
        except Exception as e:
            logger.error("Error running pip command: %s", e)
            return None

    def get_package_version(self, package: str) -> str | None:
        """Get the installed version of a specific package."""
        packages = self.get_installed_packages()
        for pkg in packages:
            if pkg.name.lower() == package.lower():
                return pkg.version
        return None

    def is_package_installed(self, package: str) -> bool:
        """Check if a package is installed in the venv."""
        return self.get_package_version(package) is not None

    def uninstall_package(
        self,
        package: str,
        progress_callback: Callable[[float, str], None] | None = None,
    ) -> tuple[bool, str]:
        """
        Uninstall a package from the current Python runtime.

        Args:
            package: Package name
            progress_callback: Optional callback for progress updates

        Returns:
            Tuple of (success, message)
        """
        if not self._is_valid_venv():
            return False, "Virtual environment is not valid"

        if progress_callback:
            progress_callback(0, f"Uninstalling {package}...")

        try:
            result = subprocess.run(
                [str(self.python_executable), "-m", "pip", "uninstall", "-y", package],
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode != 0:
                return False, f"Uninstall failed: {result.stderr}"
        except Exception as e:
            return False, f"Uninstall failed: {e}"

        if progress_callback:
            progress_callback(100, f"Successfully uninstalled {package}")

        invalidate_installed_packages_cache()
        return True, f"Successfully uninstalled {package}"

    def get_outdated_packages(self) -> list[dict[str, str]]:
        """Get list of outdated packages in the venv."""
        if not self._is_valid_venv():
            return []

        outdated = []
        try:
            result = subprocess.run(
                [str(self.python_executable), "-m", "pip", "list", "--outdated", "--format=json"],
                capture_output=True,
                text=True,
                timeout=60,
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                for pkg in data:
                    outdated.append({
                        "name": pkg.get("name", ""),
                        "current_version": pkg.get("version", ""),
                        "latest_version": pkg.get("latest_version", ""),
                    })
        except Exception as e:
            logger.error("Error checking outdated packages: %s", e)

        return outdated

    def run_in_venv(
        self,
        script: str,
        timeout: int = 300,
    ) -> tuple[int, str, str]:
        """
        Run a Python script in the current Python runtime.

        Args:
            script: Python code to execute
            timeout: Timeout in seconds

        Returns:
            Tuple of (return_code, stdout, stderr)
        """
        if not self._is_valid_venv():
            return -1, "", "Virtual environment is not valid"

        try:
            result = subprocess.run(
                [str(self.python_executable), "-c", script],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            return result.returncode, result.stdout, result.stderr
        except subprocess.TimeoutExpired:
            return -1, "", f"Script timed out after {timeout} seconds"
        except Exception as e:
            return -1, "", str(e)

    def get_nirs4all_version(self) -> str | None:
        """Get the installed version of nirs4all in the current runtime."""
        if not self._is_valid_venv():
            return None

        code, stdout, stderr = self.run_in_venv(
            """
import os
import sys

cwd = os.getcwd()
sys.path = [entry for entry in sys.path if entry not in ("", cwd)]

version = None

try:
    import nirs4all
    version = getattr(nirs4all, "__version__", None)
except Exception:
    version = None

if not version:
    try:
        from importlib import metadata
        version = metadata.version("nirs4all")
    except Exception:
        version = None

if version:
    print(version)
"""
        )
        if code == 0 and stdout.strip():
            return stdout.strip()
        return None


# Lazy-initialized global venv manager instance
_venv_manager: VenvManager | None = None


def get_venv_manager() -> VenvManager:
    """Get the global venv manager instance (lazy initialization)."""
    global _venv_manager
    if _venv_manager is None:
        _venv_manager = VenvManager()
    return _venv_manager


# For backward compatibility - will be lazily initialized on first access
class _LazyVenvManager:
    """Proxy class for lazy access to venv_manager."""

    def __getattr__(self, name):
        return getattr(get_venv_manager(), name)


venv_manager = _LazyVenvManager()
