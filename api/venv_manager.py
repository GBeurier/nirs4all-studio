"""
Managed virtual environment manager for nirs4all webapp.

This module handles creation and management of a dedicated Python virtual environment
for nirs4all and its ML dependencies. This allows the library to be updated
independently of the bundled webapp.
"""

import json
import os
import subprocess
import sys
import venv
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import platformdirs

from .shared.logger import get_logger

logger = get_logger(__name__)


# App identification for platformdirs
APP_NAME = "nirs4all-webapp"
APP_AUTHOR = "nirs4all"


@dataclass
class VenvInfo:
    """Information about the managed virtual environment."""
    path: str
    exists: bool
    is_valid: bool
    is_custom: bool = False
    python_version: Optional[str] = None
    pip_version: Optional[str] = None
    created_at: Optional[str] = None
    last_updated: Optional[str] = None
    size_bytes: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PackageInfo:
    """Information about an installed package."""
    name: str
    version: str
    location: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class VenvManager:
    """
    Manages the Python environment for nirs4all dependencies.

    By default, uses the CURRENT Python environment (the one running the webapp).
    This means:
    - In dev mode: uses your activated venv (e.g., .venv in project root)
    - In production/bundled mode: uses the shipped Python environment

    A custom path can be configured via set_custom_venv_path() for special cases.
    """

    METADATA_FILE = "venv_metadata.json"
    SETTINGS_FILE = "venv_settings.json"

    def __init__(self):
        """Initialize the venv manager."""
        self._app_data_dir = Path(platformdirs.user_data_dir(APP_NAME, APP_AUTHOR))
        self._settings_path = self._app_data_dir / self.SETTINGS_FILE
        # Default: use the current Python environment
        self._default_venv_path = Path(sys.prefix)
        self._custom_venv_path: Optional[Path] = None
        self._settings_loaded = False

    def _ensure_settings_loaded(self) -> None:
        """Ensure settings are loaded (lazy initialization)."""
        if not self._settings_loaded:
            self._load_settings()
            self._settings_loaded = True

    def _load_settings(self) -> None:
        """Load venv settings from file."""
        if self._settings_path.exists():
            try:
                with open(self._settings_path, "r", encoding="utf-8") as f:
                    settings = json.load(f)
                    custom_path = settings.get("custom_venv_path")
                    if custom_path:
                        self._custom_venv_path = Path(custom_path)
            except Exception as e:
                logger.warning("Could not load venv settings: %s", e)

    def _save_settings(self) -> None:
        """Save venv settings to file."""
        self._app_data_dir.mkdir(parents=True, exist_ok=True)
        try:
            settings = {
                "custom_venv_path": str(self._custom_venv_path) if self._custom_venv_path else None,
            }
            with open(self._settings_path, "w", encoding="utf-8") as f:
                json.dump(settings, f, indent=2)
        except Exception as e:
            logger.warning("Could not save venv settings: %s", e)

    @property
    def _venv_path(self) -> Path:
        """Get the current venv path (custom or default)."""
        self._ensure_settings_loaded()
        return self._custom_venv_path if self._custom_venv_path else self._default_venv_path

    @property
    def _metadata_path(self) -> Path:
        """Get the metadata file path."""
        return self._venv_path / self.METADATA_FILE

    @property
    def is_custom_path(self) -> bool:
        """Check if a custom venv path is configured."""
        return self._custom_venv_path is not None

    @property
    def default_path(self) -> Path:
        """Get the default venv path."""
        return self._default_venv_path

    def get_custom_path(self) -> Optional[str]:
        """Get the custom venv path if configured."""
        return str(self._custom_venv_path) if self._custom_venv_path else None

    def set_custom_venv_path(self, path: Optional[str]) -> Tuple[bool, str]:
        """
        Set a custom virtual environment path.

        Args:
            path: The custom path, or None to reset to default

        Returns:
            Tuple of (success, message)
        """
        if path is None:
            # Reset to default
            self._custom_venv_path = None
            self._save_settings()
            return True, "Reset to default virtual environment path"

        custom_path = Path(path)

        # Validate path
        if not custom_path.exists():
            return False, f"Path does not exist: {path}"

        # Check if it looks like a valid venv
        python_exec = custom_path / ("Scripts" if sys.platform == "win32" else "bin") / ("python.exe" if sys.platform == "win32" else "python")

        if not python_exec.exists():
            return False, f"Not a valid Python virtual environment: {path}"

        # Test the Python executable
        try:
            result = subprocess.run(
                [str(python_exec), "-c", "print('ok')"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode != 0 or "ok" not in result.stdout:
                return False, f"Python executable is not working in: {path}"
        except Exception as e:
            return False, f"Failed to verify Python executable: {e}"

        self._custom_venv_path = custom_path
        self._save_settings()
        return True, f"Custom virtual environment path set to: {path}"

    @property
    def venv_path(self) -> Path:
        """Get the path to the managed virtual environment."""
        return self._venv_path

    @property
    def python_executable(self) -> Path:
        """Get the path to the Python executable."""
        # If using current environment (no custom path), use sys.executable directly
        if not self._custom_venv_path:
            return Path(sys.executable)
        # Custom venv path
        if sys.platform == "win32":
            return self._venv_path / "Scripts" / "python.exe"
        return self._venv_path / "bin" / "python"

    @property
    def pip_executable(self) -> Path:
        """Get the path to pip."""
        # If using current environment, find pip relative to sys.executable
        if not self._custom_venv_path:
            python_dir = Path(sys.executable).parent
            if sys.platform == "win32":
                return python_dir / "pip.exe"
            return python_dir / "pip"
        # Custom venv path
        if sys.platform == "win32":
            return self._venv_path / "Scripts" / "pip.exe"
        return self._venv_path / "bin" / "pip"

    def get_venv_info(self) -> VenvInfo:
        """Get information about the managed venv."""
        info = VenvInfo(
            path=str(self._venv_path),
            exists=self._venv_path.exists(),
            is_valid=self._is_valid_venv(),
            is_custom=self.is_custom_path,
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

    def _load_metadata(self) -> Optional[Dict[str, Any]]:
        """Load venv metadata from file."""
        if not self._metadata_path.exists():
            return None
        try:
            with open(self._metadata_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def _save_metadata(self, metadata: Dict[str, Any]) -> None:
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
        progress_callback: Optional[Callable[[float, str], None]] = None,
        force: bool = False,
    ) -> Tuple[bool, str]:
        """
        Create the managed virtual environment.

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
        version: Optional[str] = None,
        extras: Optional[List[str]] = None,
        upgrade: bool = False,
        progress_callback: Optional[Callable[[float, str], None]] = None,
    ) -> Tuple[bool, str, List[str]]:
        """
        Install a package in the managed venv.

        Args:
            package: Package name (e.g., "nirs4all")
            version: Optional version specifier (e.g., "0.7.0")
            extras: Optional list of extras (e.g., ["tensorflow", "torch"])
            upgrade: If True, upgrade to latest version
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

        # Build pip command
        cmd = [str(self.pip_executable), "install"]
        if upgrade:
            cmd.append("--upgrade")
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

            process.wait()

            if process.returncode != 0:
                return False, f"pip install failed with code {process.returncode}", output_lines

        except Exception as e:
            return False, f"Installation failed: {e}", output_lines

        # Update metadata
        metadata = self._load_metadata() or {}
        metadata["last_updated"] = datetime.now().isoformat()
        self._save_metadata(metadata)

        if progress_callback:
            progress_callback(100, f"Successfully installed {package}")

        return True, f"Successfully installed {pkg_spec}", output_lines

    def get_installed_packages(self) -> List[PackageInfo]:
        """Get list of installed packages in the venv."""
        if not self._is_valid_venv():
            return []

        packages = []
        try:
            result = subprocess.run(
                [str(self.pip_executable), "list", "--format=json"],
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

    def run_pip_command(self, args: List[str], timeout: int = 120) -> Optional[str]:
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
                [str(self.pip_executable)] + args,
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

    def get_package_version(self, package: str) -> Optional[str]:
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
        progress_callback: Optional[Callable[[float, str], None]] = None,
    ) -> Tuple[bool, str]:
        """
        Uninstall a package from the managed venv.

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
                [str(self.pip_executable), "uninstall", "-y", package],
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

        return True, f"Successfully uninstalled {package}"

    def get_outdated_packages(self) -> List[Dict[str, str]]:
        """Get list of outdated packages in the venv."""
        if not self._is_valid_venv():
            return []

        outdated = []
        try:
            result = subprocess.run(
                [str(self.pip_executable), "list", "--outdated", "--format=json"],
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
    ) -> Tuple[int, str, str]:
        """
        Run a Python script in the managed venv.

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

    def get_nirs4all_version(self) -> Optional[str]:
        """Get the installed version of nirs4all in the managed venv."""
        if not self._is_valid_venv():
            return None

        code, stdout, stderr = self.run_in_venv(
            "import nirs4all; print(nirs4all.__version__)"
        )
        if code == 0 and stdout.strip():
            return stdout.strip()
        return None


# Lazy-initialized global venv manager instance
_venv_manager: Optional[VenvManager] = None


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
