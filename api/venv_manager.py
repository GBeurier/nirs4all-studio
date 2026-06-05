"""
Managed virtual environment manager for nirs4all Studio.

This module handles creation and management of a dedicated Python virtual environment
for nirs4all and its ML dependencies. This allows the library to be updated
independently of the bundled webapp.
"""

import functools
import json
import os
import re
import subprocess
import sys
import threading
import venv
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import platformdirs


# App identification for platformdirs
APP_NAME = "nirs4all-studio"
APP_AUTHOR = "nirs4all"
OUTDATED_PACKAGES_TIMEOUT_SECONDS = 15
PIP_INSTALL_TIMEOUT_SECONDS = 900


def _synchronized(method):
    """Serialize a mutating VenvManager method on the instance lock.

    Mutating venv operations (create/install/uninstall/path-change) now run in
    ``asyncio.to_thread`` worker threads (so they no longer freeze the event
    loop), which means they can run concurrently. Serializing them prevents a
    venv-path change or a second install from retargeting an in-flight one.
    Read-only methods are intentionally left lock-free so a long install does
    not block status/list queries. The lock is re-entrant in case a guarded
    method calls another.
    """

    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)

    return wrapper


# ============= pip install allowlist + injection guard =============
#
# Only distribution names the app legitimately (re)installs are accepted by
# install_package(). This blocks turning the pip subprocess into an arbitrary
# code-execution / supply-chain vector (URLs, VCS specs, local paths, extra pip
# options, shell metacharacters). Extend ALLOWED_PACKAGES when the app gains a
# new dependency it must install.
#
# Names are compared in PEP 503 normalized form (lowercase, runs of
# [-_.] collapsed to a single "-").
ALLOWED_PACKAGES = frozenset(
    {
        # Main library (with or without extras)
        "nirs4all",
        # Deep-learning backends
        "torch",
        "torchvision",
        "torchaudio",
        "tensorflow",
        "tensorflow-cpu",
        "tensorflow-macos",
        "keras",
        "jax",
        "jaxlib",
        "flax",
        "tabpfn",
        # PLS variants (nirs4all optional extras)
        "ikpls",
        "pyopls",
        "trendfitter",
        # AutoML
        "autogluon",
        # Visualization / dimensionality reduction
        "matplotlib",
        "seaborn",
        "plotly",
        "umap-learn",
        # Reports / export
        "pypandoc",
        "pypdf2",
        "pdf2image",
        "openpyxl",
        # Core scientific deps
        "numpy",
        "scipy",
        "pandas",
        "scikit-learn",
        "joblib",
    }
)

# A simple PEP 508 requirement: name, optional [extras], optional version spec.
# Deliberately strict — anything not matching (URLs, git+..., paths, options,
# whitespace, shell metacharacters) is rejected.
_PEP503_NAME = r"[A-Za-z0-9][A-Za-z0-9._-]*"
_EXTRAS = rf"(?:\[\s*{_PEP503_NAME}(?:\s*,\s*{_PEP503_NAME})*\s*\])?"
_VERSION_SPEC = r"(?:(?:==|>=|<=|~=|!=|>|<)\s*[A-Za-z0-9][A-Za-z0-9._*+!-]*)*"
_REQUIREMENT_RE = re.compile(rf"^{_PEP503_NAME}{_EXTRAS}\s*{_VERSION_SPEC}$")


def _normalize_dist_name(name: str) -> str:
    """Normalize a distribution name per PEP 503 (lowercase, [-_.] runs -> -)."""
    return re.sub(r"[-_.]+", "-", name).lower()


def validate_package_spec(package: str, version: Optional[str], extras: Optional[List[str]]) -> Tuple[bool, str]:
    """Validate a package install request before it reaches pip.

    Rejects URLs, VCS specs (``git+...``), local paths, shell metacharacters,
    leading option flags (``-``/``--``), whitespace-separated extra arguments,
    and any distribution name not on :data:`ALLOWED_PACKAGES`.

    Args:
        package: The package spec or bare name (e.g. ``"nirs4all"`` or ``"torch>=2.0"``).
        version: Optional version specifier supplied separately (e.g. ``"0.9.0"``).
        extras: Optional list of extras (e.g. ``["tensorflow", "torch"]``).

    Returns:
        Tuple of (is_valid, message). ``message`` describes the rejection reason
        when invalid.
    """
    if not package or not package.strip():
        return False, "Empty package specifier"

    # The reconstructed spec must be a single token. Any whitespace means the
    # caller smuggled in extra args (e.g. "--upgrade", "foo bar").
    if package != package.strip() or re.search(r"\s", package):
        return False, f"Whitespace not allowed in package spec: {package!r}"
    if package.startswith("-"):
        return False, f"Option-style argument not allowed as package: {package!r}"

    # Reject obvious non-PEP508 forms: URLs, VCS, local paths, shell metacharacters.
    forbidden = ("://", "git+", "hg+", "svn+", "bzr+", "/", "\\", "@")
    if any(token in package for token in forbidden):
        return False, f"URL/VCS/path-style specifiers are not allowed: {package!r}"
    # Note: '<' and '>' are valid PEP 508 version operators, so they are not
    # treated as shell metacharacters here. Redirection-style abuse ("foo > x")
    # is already rejected by the whitespace check above, and any leftover
    # malformed form is rejected by the requirement regex below.
    if re.search(r"[;&|`$(){}!*?'\"]", package):
        return False, f"Shell metacharacters are not allowed in package spec: {package!r}"

    if version is not None:
        version = version.strip()
        if re.search(r"\s", version) or re.search(r"[;&|`$(){}!?'\"/\\@]", version):
            return False, f"Invalid version specifier: {version!r}"

    if extras:
        for extra in extras:
            if not extra or not re.fullmatch(_PEP503_NAME, extra):
                return False, f"Invalid extra name: {extra!r}"

    if not _REQUIREMENT_RE.match(package):
        return False, f"Not a valid PEP 508 requirement: {package!r}"

    # Distribution name = everything before the first of '[' or a version operator.
    dist_name = re.split(r"[\[<>=!~]", package, 1)[0].strip()
    if _normalize_dist_name(dist_name) not in ALLOWED_PACKAGES:
        return False, f"Package not in allowlist: {dist_name!r}"

    return True, "ok"


def _split_exact_package_spec(package: str, version: Optional[str]) -> Tuple[str, Optional[str]]:
    """Accept both ("name", "1.2.3") and ("name==1.2.3", None)."""
    if version or "==" not in package:
        return package, version

    package_name, pinned_version = package.split("==", 1)
    return package_name.strip(), pinned_version.strip() or None


def _resolve_package_version_for_python(
    package: str,
    version: Optional[str],
    python_version: Tuple[int, int],
) -> Tuple[Optional[str], Optional[str]]:
    """Resolve known package pins that are incompatible with target Python."""
    if not version:
        return version, None

    package_name = package.split("[", 1)[0].replace("_", "-").lower()
    requested_version = version.strip().lstrip("=")

    if package_name == "tabpfn" and requested_version in {"2.0.2", "2.0.3"}:
        if python_version == (3, 12):
            return (
                "2.0.4",
                f"tabpfn {requested_version} requires Python <3.12; using tabpfn 2.0.4",
            )
        if python_version >= (3, 13):
            return (
                None,
                f"tabpfn {requested_version} requires Python <3.12; using latest compatible tabpfn",
            )

    return requested_version, None


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
        # Re-entrant lock serializing mutating operations across to_thread workers.
        self._lock = threading.RLock()
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
                print(f"Warning: Could not load venv settings: {e}")

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
            print(f"Warning: Could not save venv settings: {e}")

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

    @_synchronized
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

    def _get_target_python_version(self) -> Tuple[int, int]:
        """Return the managed Python major/minor version."""
        try:
            result = subprocess.run(
                [
                    str(self.python_executable),
                    "-c",
                    "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0:
                major, minor = result.stdout.strip().split(".", 1)
                return int(major), int(minor)
        except Exception:
            pass

        return sys.version_info.major, sys.version_info.minor

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

    @_synchronized
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

    @_synchronized
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

        package, version = _split_exact_package_spec(package, version)

        # SECURITY: validate the request before it can reach the pip subprocess.
        is_valid, validation_message = validate_package_spec(package, version, extras)
        if not is_valid:
            return False, f"Rejected package install: {validation_message}", []

        version, compatibility_note = _resolve_package_version_for_python(
            package,
            version,
            self._get_target_python_version(),
        )

        # Build package specifier
        pkg_spec = package
        if extras:
            pkg_spec = f"{package}[{','.join(extras)}]"
        if version:
            pkg_spec = f"{pkg_spec}=={version}"

        if progress_callback:
            progress_callback(0, f"Installing {pkg_spec}...")
            if compatibility_note:
                progress_callback(5, compatibility_note)

        # Build pip command
        cmd = [str(self.pip_executable), "install"]
        if upgrade:
            cmd.append("--upgrade")
        cmd.append(pkg_spec)

        output_lines = []

        def record_output(output: str) -> None:
            for line in output.splitlines():
                line = line.strip()
                if not line:
                    continue
                output_lines.append(line)
                if not progress_callback:
                    continue
                # Estimate progress based on output
                if "Collecting" in line:
                    progress_callback(20, line)
                elif "Downloading" in line:
                    progress_callback(40, line)
                elif "Installing" in line:
                    progress_callback(70, line)
                elif "Successfully" in line:
                    progress_callback(95, line)

        try:
            # Run pip install
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )

            output, _ = process.communicate(timeout=PIP_INSTALL_TIMEOUT_SECONDS)
            record_output(output or "")

            if process.returncode != 0:
                return False, f"pip install failed with code {process.returncode}", output_lines

        except subprocess.TimeoutExpired:
            process.kill()
            try:
                output, _ = process.communicate(timeout=5)
            except Exception:
                output = ""
            record_output(output or "")
            return (
                False,
                (
                    f"pip install timed out after {PIP_INSTALL_TIMEOUT_SECONDS}s while "
                    f"installing {pkg_spec}. Check the internet connection or retry later."
                ),
                output_lines,
            )
        except Exception as e:
            return False, f"Installation failed: {e}", output_lines

        # Update metadata
        metadata = self._load_metadata() or {}
        metadata["last_updated"] = datetime.now().isoformat()
        self._save_metadata(metadata)

        if progress_callback:
            progress_callback(100, f"Successfully installed {package}")

        message = f"Successfully installed {pkg_spec}"
        if compatibility_note:
            message = f"{message} ({compatibility_note})"

        return True, message, output_lines

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

    @_synchronized
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
                timeout=OUTDATED_PACKAGES_TIMEOUT_SECONDS,
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                for pkg in data:
                    outdated.append({
                        "name": pkg.get("name", ""),
                        "current_version": pkg.get("version", ""),
                        "latest_version": pkg.get("latest_version", ""),
                    })
        except subprocess.TimeoutExpired:
            print(
                "Skipping outdated package check: "
                f"pip list --outdated exceeded {OUTDATED_PACKAGES_TIMEOUT_SECONDS}s"
            )
        except Exception as e:
            print(f"Skipping outdated package check: {e}")

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
