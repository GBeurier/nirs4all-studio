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


# App identification for platformdirs
APP_NAME = "nirs4all-webapp"
APP_AUTHOR = "nirs4all"


@dataclass
class VenvInfo:
    """Information about the managed virtual environment."""
    path: str
    exists: bool
    is_valid: bool
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
    Manages a dedicated Python virtual environment for nirs4all.

    The venv is stored in the user's app data directory:
    - Windows: %LOCALAPPDATA%/nirs4all-webapp/managed_venv/
    - macOS: ~/Library/Application Support/nirs4all-webapp/managed_venv/
    - Linux: ~/.local/share/nirs4all-webapp/managed_venv/
    """

    VENV_DIRNAME = "managed_venv"
    METADATA_FILE = "venv_metadata.json"

    def __init__(self):
        """Initialize the venv manager."""
        self._app_data_dir = Path(platformdirs.user_data_dir(APP_NAME, APP_AUTHOR))
        self._venv_path = self._app_data_dir / self.VENV_DIRNAME
        self._metadata_path = self._venv_path / self.METADATA_FILE

    @property
    def venv_path(self) -> Path:
        """Get the path to the managed virtual environment."""
        return self._venv_path

    @property
    def python_executable(self) -> Path:
        """Get the path to the Python executable in the venv."""
        if sys.platform == "win32":
            return self._venv_path / "Scripts" / "python.exe"
        return self._venv_path / "bin" / "python"

    @property
    def pip_executable(self) -> Path:
        """Get the path to pip in the venv."""
        if sys.platform == "win32":
            return self._venv_path / "Scripts" / "pip.exe"
        return self._venv_path / "bin" / "pip"

    def get_venv_info(self) -> VenvInfo:
        """Get information about the managed venv."""
        info = VenvInfo(
            path=str(self._venv_path),
            exists=self._venv_path.exists(),
            is_valid=self._is_valid_venv(),
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
            print(f"Warning: Could not save venv metadata: {e}")

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
                print(f"Warning: pip upgrade failed: {result.stderr}")
        except Exception as e:
            print(f"Warning: pip upgrade failed: {e}")

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
            print(f"Error getting installed packages: {e}")

        return packages

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
            print(f"Error checking outdated packages: {e}")

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


# Global venv manager instance
venv_manager = VenvManager()
