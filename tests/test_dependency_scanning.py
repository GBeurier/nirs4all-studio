"""
Tests for dependency scanning endpoint (GET /api/updates/dependencies).

Verifies that:
- Installed packages come only from VenvManager's pip scan (no importlib.metadata fallback)
- nirs4all version comes only from VenvManager (no in-process import fallback)
- Empty packages when venv is invalid
- Cache is keyed by venv path
- Package name normalization (hyphen vs underscore)
"""

import sys
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app

client = TestClient(app)


# ============= Test Helpers =============


@dataclass
class FakePackageInfo:
    name: str
    version: str
    location: str | None = None


@dataclass
class FakeVenvInfo:
    path: str
    exists: bool
    is_valid: bool
    is_custom: bool = False
    python_version: str | None = None
    pip_version: str | None = None
    created_at: str | None = None
    last_updated: str | None = None
    size_bytes: int = 0


# ============= Tests =============


class TestDependencyScanningNoImportlibFallback:
    """Verify that importlib.metadata is NOT used as a fallback source."""

    @patch("api.updates._dependencies_cache")
    @patch("api.updates.venv_manager")
    def test_dependencies_only_from_venv_pip(self, mock_vm, mock_cache):
        """Packages returned should come exclusively from VenvManager.get_installed_packages()."""
        mock_cache.get.return_value = None  # No cache

        mock_vm.get_venv_info.return_value = FakeVenvInfo(
            path="/fake/venv", exists=True, is_valid=True,
        )
        mock_vm.is_custom_path = False
        mock_vm.get_installed_packages.return_value = [
            FakePackageInfo(name="ikpls", version="1.2.0"),
        ]
        mock_vm.get_outdated_packages.return_value = []
        mock_vm.get_nirs4all_version.return_value = "0.7.1"

        response = client.get("/api/updates/dependencies?force_refresh=true")
        assert response.status_code == 200
        data = response.json()

        # Find the pls_variants category and check ikpls
        pls_cat = next((c for c in data["categories"] if c["id"] == "pls_variants"), None)
        assert pls_cat is not None

        ikpls_pkg = next((p for p in pls_cat["packages"] if p["name"] == "ikpls"), None)
        assert ikpls_pkg is not None
        assert ikpls_pkg["is_installed"] is True
        assert ikpls_pkg["installed_version"] == "1.2.0"

        # pyopls should NOT be installed (not in pip scan)
        pyopls_pkg = next((p for p in pls_cat["packages"] if p["name"] == "pyopls"), None)
        assert pyopls_pkg is not None
        assert pyopls_pkg["is_installed"] is False

    @patch("api.updates._dependencies_cache")
    @patch("api.updates.venv_manager")
    def test_no_importlib_metadata_packages_leak_in(self, mock_vm, mock_cache):
        """Even if importlib.metadata would find extra packages, they must not appear."""
        mock_cache.get.return_value = None

        # VenvManager returns empty list (venv valid but no packages installed)
        mock_vm.get_venv_info.return_value = FakeVenvInfo(
            path="/fake/venv", exists=True, is_valid=True,
        )
        mock_vm.is_custom_path = False
        mock_vm.get_installed_packages.return_value = []
        mock_vm.get_outdated_packages.return_value = []
        mock_vm.get_nirs4all_version.return_value = None

        response = client.get("/api/updates/dependencies?force_refresh=true")
        assert response.status_code == 200
        data = response.json()

        # All packages should show as not installed
        assert data["total_installed"] == 0
        # No package in any category should be installed
        for cat in data["categories"]:
            for pkg in cat["packages"]:
                assert pkg["is_installed"] is False, (
                    f"Package {pkg['name']} should not be installed "
                    f"(no importlib.metadata fallback allowed)"
                )


class TestDependencyScanningNirs4allVersion:
    """Verify that nirs4all version comes only from VenvManager."""

    @patch("api.updates._dependencies_cache")
    @patch("api.updates.venv_manager")
    def test_nirs4all_version_from_pip_only(self, mock_vm, mock_cache):
        """nirs4all version must come from VenvManager.get_nirs4all_version() only."""
        mock_cache.get.return_value = None

        mock_vm.get_venv_info.return_value = FakeVenvInfo(
            path="/fake/venv", exists=True, is_valid=True,
        )
        mock_vm.is_custom_path = False
        mock_vm.get_installed_packages.return_value = []
        mock_vm.get_outdated_packages.return_value = []
        mock_vm.get_nirs4all_version.return_value = "0.7.1"

        response = client.get("/api/updates/dependencies?force_refresh=true")
        data = response.json()

        assert data["nirs4all_installed"] is True
        assert data["nirs4all_version"] == "0.7.1"

    @patch("api.updates._dependencies_cache")
    @patch("api.updates.venv_manager")
    def test_nirs4all_not_installed_when_pip_says_no(self, mock_vm, mock_cache):
        """If VenvManager can't find nirs4all, it should show as not installed
        even if nirs4all is importable in the current process."""
        mock_cache.get.return_value = None

        mock_vm.get_venv_info.return_value = FakeVenvInfo(
            path="/fake/venv", exists=True, is_valid=True,
        )
        mock_vm.is_custom_path = False
        mock_vm.get_installed_packages.return_value = []
        mock_vm.get_outdated_packages.return_value = []
        mock_vm.get_nirs4all_version.return_value = None  # pip can't find it

        response = client.get("/api/updates/dependencies?force_refresh=true")
        data = response.json()

        # Must report not installed — no in-process import fallback
        assert data["nirs4all_installed"] is False
        assert data["nirs4all_version"] is None


class TestDependencyScanningInvalidVenv:
    """Verify behavior when venv is invalid."""

    @patch("api.updates._dependencies_cache")
    @patch("api.updates.venv_manager")
    def test_empty_packages_when_venv_invalid(self, mock_vm, mock_cache):
        """When venv is not valid, installed packages list should be empty."""
        mock_cache.get.return_value = None

        mock_vm.get_venv_info.return_value = FakeVenvInfo(
            path="/nonexistent/venv", exists=False, is_valid=False,
        )
        mock_vm.is_custom_path = False
        mock_vm.get_outdated_packages.return_value = []
        mock_vm.get_nirs4all_version.return_value = None

        response = client.get("/api/updates/dependencies?force_refresh=true")
        assert response.status_code == 200
        data = response.json()

        assert data["venv_valid"] is False
        assert data["total_installed"] == 0
        # get_installed_packages should NOT be called when venv is invalid
        mock_vm.get_installed_packages.assert_not_called()


class TestDependencyScanningCache:
    """Verify cache behavior."""

    @patch("api.updates._dependencies_cache")
    @patch("api.updates.venv_manager")
    def test_cache_keyed_by_venv_path(self, mock_vm, mock_cache):
        """Cache should be checked with the current venv path as key."""
        mock_vm.get_venv_info.return_value = FakeVenvInfo(
            path="/my/special/venv", exists=True, is_valid=True,
        )
        mock_vm.is_custom_path = False
        # Return cached data to avoid full scan
        mock_cache.get.return_value = {
            "categories": [],
            "venv_valid": True,
            "nirs4all_installed": True,
            "nirs4all_version": "0.7.0",
            "total_installed": 5,
            "total_packages": 20,
            "cached_at": "2026-01-01T00:00:00",
        }

        response = client.get("/api/updates/dependencies")
        assert response.status_code == 200

        # Verify cache was queried with the correct venv path
        mock_cache.get.assert_called_once_with("/my/special/venv")

    @patch("api.updates._dependencies_cache")
    @patch("api.updates.venv_manager")
    def test_cache_bypassed_on_force_refresh(self, mock_vm, mock_cache):
        """force_refresh=true should bypass cache and do a full scan."""
        mock_cache.get.return_value = None

        mock_vm.get_venv_info.return_value = FakeVenvInfo(
            path="/fake/venv", exists=True, is_valid=True,
        )
        mock_vm.is_custom_path = False
        mock_vm.get_installed_packages.return_value = []
        mock_vm.get_outdated_packages.return_value = []
        mock_vm.get_nirs4all_version.return_value = None

        response = client.get("/api/updates/dependencies?force_refresh=true")
        assert response.status_code == 200

        # Cache.get should not be called when force_refresh=true
        mock_cache.get.assert_not_called()
        # But cache.set should be called to store the fresh results
        mock_cache.set.assert_called_once()

    @patch("api.updates._dependencies_cache")
    @patch("api.updates.venv_manager")
    def test_cache_stores_fresh_scan_results(self, mock_vm, mock_cache):
        """After a fresh scan, results should be cached with the venv path."""
        mock_cache.get.return_value = None

        mock_vm.get_venv_info.return_value = FakeVenvInfo(
            path="/cached/venv", exists=True, is_valid=True,
        )
        mock_vm.is_custom_path = False
        mock_vm.get_installed_packages.return_value = [
            FakePackageInfo(name="shap", version="0.45.0"),
        ]
        mock_vm.get_outdated_packages.return_value = []
        mock_vm.get_nirs4all_version.return_value = "0.7.1"

        response = client.get("/api/updates/dependencies?force_refresh=true")
        assert response.status_code == 200

        # Verify cache was set with correct venv path
        call_args = mock_cache.set.call_args
        assert call_args[0][0] == "/cached/venv"  # First positional arg is venv_path


class TestDependencyScanningPackageNormalization:
    """Verify package name normalization (hyphen vs underscore)."""

    @patch("api.updates._dependencies_cache")
    @patch("api.updates.venv_manager")
    def test_hyphen_underscore_package_matching(self, mock_vm, mock_cache):
        """Packages with hyphens in their name should match underscore variants."""
        mock_cache.get.return_value = None

        mock_vm.get_venv_info.return_value = FakeVenvInfo(
            path="/fake/venv", exists=True, is_valid=True,
        )
        mock_vm.is_custom_path = False
        # pip reports umap-learn with underscore
        mock_vm.get_installed_packages.return_value = [
            FakePackageInfo(name="umap_learn", version="0.5.5"),
        ]
        mock_vm.get_outdated_packages.return_value = []
        mock_vm.get_nirs4all_version.return_value = None

        response = client.get("/api/updates/dependencies?force_refresh=true")
        data = response.json()

        # Find umap-learn in dimensionality category
        dim_cat = next((c for c in data["categories"] if c["id"] == "dimensionality"), None)
        assert dim_cat is not None

        umap_pkg = next((p for p in dim_cat["packages"] if p["name"] == "umap-learn"), None)
        assert umap_pkg is not None
        assert umap_pkg["is_installed"] is True
        assert umap_pkg["installed_version"] == "0.5.5"
