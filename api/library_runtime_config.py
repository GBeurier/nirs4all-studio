"""Package configuration and explicit package actions for the selected host.

Rust supplies its bundled configuration and owns setup state. This module
inspects the selected interpreter without importing HTTP routers. Only explicit
package actions may invoke pip, and only for a writable external interpreter.
"""

from __future__ import annotations

import importlib.metadata
import importlib.util
import os
import sys
import sysconfig
from datetime import UTC, datetime
from typing import Any

from packaging.specifiers import SpecifierSet
from packaging.utils import canonicalize_name
from packaging.version import Version


def _installed_versions() -> dict[str, str]:
    """Use the interpreter's selected distribution when paths overlap."""
    installed = {}
    for distribution in importlib.metadata.distributions():
        name = distribution.metadata.get("Name")
        if name:
            installed.setdefault(canonicalize_name(name), distribution.version)
    return installed


def compare_configuration(document: dict[str, Any]) -> dict[str, Any]:
    """Compare installed versions against minimum requirements using PEP 440."""
    if set(document) - {"config", "profile", "include_optional", "include_latest"}:
        raise ValueError("Unexpected runtime configuration fields")
    config = document["config"]
    profile_id = document.get("profile") or "cpu"
    profile = config.get("profiles", {}).get(profile_id)
    if not isinstance(profile, dict) or (profile.get("platforms") and sys.platform not in profile["platforms"]):
        raise ValueError(f"Unknown or incompatible profile: {profile_id}")
    installed = _installed_versions()
    # Lite distribution names provide the same capabilities under different
    # published package identities; profile renames remain explicit.
    renames = profile.get("package_renames", {})
    optional = config.get("optional", {})
    visible_managed = {canonicalize_name(name) for name, spec in optional.items() if spec.get("show_when_profile_managed")}
    required = {name: raw for name, raw in profile.get("packages", {}).items() if canonicalize_name(name) not in visible_managed}
    entries = [(name, raw, True) for name, raw in required.items()]
    required_names = {canonicalize_name(name) for name in required}
    if document.get("include_optional", False):
        entries.extend((name, spec, False) for name, spec in optional.items()
                       if canonicalize_name(name) not in required_names
                       and canonicalize_name(renames.get(name, name)) in installed)
    differences = []
    for name, raw, is_required in entries:
        spec = raw if isinstance(raw, dict) else {"min": str(raw)}
        minimum = spec.get("min", spec.get("version", ""))
        if not isinstance(minimum, str):
            raise ValueError(f"Invalid version requirement for {name}")
        recommended = spec.get("recommended")
        actual = installed.get(canonicalize_name(renames.get(name, name)))
        aligned = actual is not None and SpecifierSet(minimum).contains(actual, prereleases=True)
        status = "missing" if actual is None else "aligned" if aligned else "outdated"
        description = (f"{name}=={recommended}" if recommended else f"{name}{minimum}") if is_required else minimum or actual
        differences.append({"name": name, "installed_version": actual, "recommended_version": description,
                            "latest_version": None, "status": status,
                            "action": {"missing": "install", "outdated": "upgrade", "aligned": "none"}[status]})
    counts = {status: sum(row["status"] == status for row in differences) for status in ("aligned", "outdated", "missing")}
    return {"profile": profile_id, "profile_label": profile.get("label", profile_id), "packages": differences,
            "aligned_count": counts["aligned"], "misaligned_count": counts["outdated"], "missing_count": counts["missing"],
            "is_aligned": not counts["outdated"] and not counts["missing"], "checked_at": datetime.now(UTC).isoformat(),
            "package_management_available": False,
            "version_source": "installed_runtime_and_bundled_requirements", "latest_lookup_performed": False}


def dependency_inventory(document: dict[str, Any]) -> dict[str, Any]:
    """Project the actual bundled interpreter inventory without invoking pip."""
    if "config" not in document or set(document) - {"config", "read_only", "profile"}:
        raise ValueError("Unexpected dependency inventory fields")
    read_only = document.get("read_only", True) is not False or not package_management_available()
    config = document["config"]
    profile = config.get("profiles", {}).get(document.get("profile") or "cpu", {})
    renames = profile.get("package_renames", {}) if sys.platform != "darwin" else {}
    installed = _installed_versions()
    categories = []
    for category_id, category in config.get("categories", {}).items():
        packages = []
        for name, spec in config.get("optional", {}).items():
            if spec.get("category") != category_id:
                continue
            actual = installed.get(canonicalize_name(renames.get(name, name)))
            minimum = spec.get("min", "")
            below = actual is not None and not SpecifierSet(minimum).contains(actual, prereleases=True)
            recommended = spec.get("recommended")
            below_recommended = actual is not None and recommended is not None and Version(actual) < Version(recommended)
            above_recommended = actual is not None and recommended is not None and Version(actual) > Version(recommended)
            packages.append({"name": name, "category": category_id, "category_name": category["name"],
                             "description": spec.get("description", ""), "min_version": minimum,
                             "recommended_version": spec.get("recommended"), "installed_version": actual,
                             "latest_version": None, "is_installed": actual is not None,
                             "is_outdated": below, "is_below_recommended": below_recommended, "is_above_recommended": above_recommended,
                             "can_update": not read_only and below_recommended, "default_install": spec.get("default_install", False),
                             "managed_by_profile": name == "torch"})
        categories.append({"id": category_id, "name": category["name"], "description": category.get("description", ""),
                           "packages": packages, "installed_count": sum(p["is_installed"] for p in packages),
                           "total_count": len(packages)})
    version = installed.get("nirs4all")
    return {"categories": categories, "read_only": read_only, "runtime_valid": version == config.get("nirs4all"),
            "runtime_path": sys.executable, "venv_valid": version is not None, "venv_path": sys.prefix,
            "nirs4all_installed": version is not None, "nirs4all_version": version,
            "total_installed": sum(c["installed_count"] for c in categories),
            "total_packages": sum(c["total_count"] for c in categories), "cached_at": None}


def package_management_available() -> bool:
    """Check the selected interpreter's installer and installation directory."""
    return importlib.util.find_spec("pip") is not None and os.access(sysconfig.get_path("purelib"), os.W_OK)


def package_action(document: dict[str, Any]) -> dict[str, Any]:
    """Run an explicit optional-package action without starting a Python server."""
    import contextlib
    import runpy
    import tempfile

    if document.get("read_only", True) is not False:
        return {"status": 409, "detail": "The bundled Python runtime is read-only. Select an external Python environment in Settings first."}
    try:
        name, distribution, arguments = _package_action_arguments(document)
    except (ValueError, TypeError) as error:
        return {"status": 400, "detail": str(error)}
    if not package_management_available():
        return {"status": 409, "detail": "The selected Python environment needs pip and writable site-packages. Select or prepare an external environment in Settings."}

    # Execute pip's module entrypoint in this bounded process. Do not spawn a
    # second interpreter that could survive the Rust host's action timeout.
    previous_argv = sys.argv
    code = 0
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as output:
        try:
            sys.argv = ["pip", *arguments]
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                try:
                    runpy.run_module("pip", run_name="__main__", alter_sys=True)
                except SystemExit as error:
                    code = error.code or 0
        finally:
            sys.argv = previous_argv
        output.flush()
        # Keep diagnostics bounded even when an installer is very verbose.
        output.seek(0, os.SEEK_END)
        start = max(0, output.tell() - 65536)
        output.seek(start)
        lines = output.buffer.read().decode("utf-8", errors="replace").splitlines()[-30:]
    importlib.invalidate_caches()
    try:
        version = importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        version = None
    success = code == 0
    message = f"{name}: package action {'completed' if success else 'failed'}."
    if not success:
        message += "\n" + "\n".join(lines)
    return {"success": success, "message": message,
            "package": name, "version": version, "output": lines,
            "requires_restart": success}


def _package_action_arguments(document: dict[str, Any]) -> tuple[str, str, list[str]]:
    """Resolve catalogue names and profile variants before invoking pip."""
    config = document["config"]
    request = document["request"]
    if not isinstance(request, dict) or set(request) - {"package", "target", "version", "upgrade"}:
        raise ValueError("Invalid package action fields")
    requested = request.get("package")
    if not isinstance(requested, str):
        raise ValueError("A package name is required")
    name = next((name for name in config.get("optional", {}) if canonicalize_name(name) == canonicalize_name(requested)), None)
    if name is None:
        raise ValueError(f"Unknown optional package: {requested}")
    profile_id = document.get("profile") or "cpu"
    profile = config.get("profiles", {}).get(profile_id)
    if not isinstance(profile, dict) or (profile.get("platforms") and sys.platform not in profile["platforms"]):
        raise ValueError(f"Unknown or incompatible profile: {profile_id}")
    distribution = profile.get("package_renames", {}).get(name, name) if sys.platform != "darwin" else name
    action = document["action"]
    if action == "uninstall":
        return name, distribution, ["uninstall", "--yes", distribution]
    if action not in {"install", "revert", "update"}:
        raise ValueError("Unknown package action")
    if request.get("target") not in {None, "recommended", "latest"} or not isinstance(request.get("upgrade", False), bool):
        raise ValueError("Invalid package target or upgrade flag")
    latest = action == "update" or request.get("target") == "latest" or request.get("upgrade", False)
    spec = config["optional"][name]
    arguments = ["install", "--disable-pip-version-check", "--no-input"]
    if name == "torch":
        if latest or request.get("version") or name not in profile.get("packages", {}):
            raise ValueError("PyTorch follows the active compute profile. Select a profile with PyTorch before installing its recommended version.")
        spec = profile["packages"][name]
        if profile_id == "gpu-cuda-torch":
            arguments.extend(["--index-url", "https://download.pytorch.org/whl/cu124"])
        elif profile_id == "cpu" and sys.platform != "darwin":
            arguments.extend(["--index-url", "https://download.pytorch.org/whl/cpu"])
    version = request.get("version") if action == "install" else None
    if version is not None:
        if not isinstance(version, str):
            raise ValueError("Invalid package version")
        version = str(Version(version))
    if action == "revert" or not latest:
        version = version or spec.get("recommended")
        if action == "revert" and not version:
            raise ValueError(f"No recommended version for {name}")
        requirement = f"{distribution}=={Version(version)}" if version else f"{distribution}{SpecifierSet(spec.get('min', ''))}"
    else:
        arguments.append("--upgrade")
        requirement = distribution
    arguments.append(requirement)
    return name, distribution, arguments
