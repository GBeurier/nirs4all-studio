"""
Tests for environment coherence endpoint (GET /api/system/env-coherence)
and VenvManager deferred activation / reset_to_runtime.

Verifies that:
- Coherence endpoint correctly detects matching and mismatched environments
- reset_to_runtime() clears custom path and restores runtime targeting
- Deferred custom path activation: set_custom_venv_path() does not change active path
- has_pending_path_change is True after setting a custom path
- Stale custom path is auto-cleaned on settings load
- POST /api/updates/venv/reset works correctly
- venv_settings_path is exposed in /api/system/paths
- Path normalization handles trailing slashes, mixed separators, case (cross-platform)
- Standalone/frozen mode detection works correctly
- Web-only mode (no Electron) coherence works without NIRS4ALL_EXPECTED_PYTHON
- Standalone mode gates package mutation endpoints

Manual test matrix (not all automatable in CI):
- [ ] Windows: path with spaces, case differences, mixed slashes
- [ ] macOS Intel: Homebrew /usr/local/bin Python detected
- [ ] macOS ARM: Homebrew /opt/homebrew/bin Python detected
- [ ] macOS: python-build-standalone quarantine removed successfully
- [ ] Linux: symlinked Python paths resolve correctly
- [ ] Standalone (PyInstaller): is_frozen=True, package install blocked
- [ ] Web mode: coherence works without NIRS4ALL_EXPECTED_PYTHON
- [ ] Portable mode: wizard shows on each launch unless skipped
"""

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app

client = TestClient(app)


# ============= Coherence Endpoint Tests =============


class TestCoherenceEndpoint:
    """Tests for GET /api/system/env-coherence."""

    @patch("api.system.venv_manager")
    def test_coherent_when_default(self, mock_vm):
        """Default state (no custom path) should be coherent."""
        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(sys.prefix)
        mock_vm.is_custom_path = False
        mock_vm.get_custom_path.return_value = None
        mock_vm.has_pending_path_change = False

        response = client.get("/api/system/env-coherence")
        assert response.status_code == 200
        data = response.json()

        assert data["coherent"] is True
        assert data["python_match"] is True
        assert data["prefix_match"] is True
        assert data["runtime"]["python"] == sys.executable
        assert data["runtime"]["prefix"] == sys.prefix
        assert data["venv_manager"]["is_custom"] is False
        assert data["venv_manager"]["has_pending_change"] is False

    @patch("api.system.venv_manager")
    def test_incoherent_when_custom_path_differs(self, mock_vm):
        """Custom path different from sys.prefix should be incoherent."""
        mock_vm.python_executable = Path("/other/venv/bin/python")
        mock_vm.venv_path = Path("/other/venv")
        mock_vm.is_custom_path = True
        mock_vm.get_custom_path.return_value = "/other/venv"
        mock_vm.has_pending_path_change = False

        response = client.get("/api/system/env-coherence")
        assert response.status_code == 200
        data = response.json()

        assert data["coherent"] is False
        assert data["venv_manager"]["is_custom"] is True
        assert data["venv_manager"]["custom_path"] == "/other/venv"

    @patch("api.system.venv_manager")
    def test_pending_change_reported(self, mock_vm):
        """Pending path change should be visible in coherence response."""
        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(sys.prefix)
        mock_vm.is_custom_path = False
        mock_vm.get_custom_path.return_value = None
        mock_vm.has_pending_path_change = True

        response = client.get("/api/system/env-coherence")
        data = response.json()

        assert data["coherent"] is True  # Still coherent (pending, not active)
        assert data["venv_manager"]["has_pending_change"] is True

    @patch.dict(os.environ, {"NIRS4ALL_EXPECTED_PYTHON": "/expected/python"})
    @patch("api.system.venv_manager")
    def test_electron_expected_python_mismatch(self, mock_vm):
        """When NIRS4ALL_EXPECTED_PYTHON doesn't match, report it."""
        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(sys.prefix)
        mock_vm.is_custom_path = False
        mock_vm.get_custom_path.return_value = None
        mock_vm.has_pending_path_change = False

        response = client.get("/api/system/env-coherence")
        data = response.json()

        assert "electron_expected_python" in data
        assert data["electron_expected_python"] == "/expected/python"
        assert data["electron_match"] is False

    @patch("api.system.venv_manager")
    def test_response_contains_runtime_version(self, mock_vm):
        """Runtime Python version should be included."""
        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(sys.prefix)
        mock_vm.is_custom_path = False
        mock_vm.get_custom_path.return_value = None
        mock_vm.has_pending_path_change = False

        response = client.get("/api/system/env-coherence")
        data = response.json()

        expected_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        assert data["runtime"]["version"] == expected_version


# ============= Venv Reset Endpoint Tests =============


class TestVenvResetEndpoint:
    """Tests for POST /api/updates/venv/reset."""

    @patch("api.updates._dependencies_cache")
    @patch("api.updates.venv_manager")
    def test_reset_clears_custom_path(self, mock_vm, mock_cache):
        """Reset should clear custom path and return runtime prefix."""
        mock_vm.reset_to_runtime.return_value = (True, f"Reset to runtime environment: {sys.prefix}")
        mock_vm.venv_path = Path(sys.prefix)

        response = client.post("/api/updates/venv/reset")
        assert response.status_code == 200
        data = response.json()

        assert data["success"] is True
        assert "Reset to runtime" in data["message"]
        mock_vm.reset_to_runtime.assert_called_once()
        mock_cache.invalidate.assert_called_once()


# ============= Venv Path Set Endpoint Tests =============


class TestVenvPathSetEndpoint:
    """Tests for POST /api/updates/venv/path (deferred activation)."""

    @patch("api.updates._dependencies_cache")
    @patch("api.updates.venv_manager")
    def test_set_path_returns_requires_restart(self, mock_vm, mock_cache):
        """Setting a custom path should indicate restart is required."""
        mock_vm.set_custom_venv_path.return_value = (True, "Custom path saved. Restart backend to apply: /new/venv")
        mock_vm.venv_path = Path(sys.prefix)  # Still runtime (deferred)
        mock_vm.is_custom_path = False  # Still not active
        mock_vm.get_venv_info.return_value = MagicMock(is_valid=True)

        response = client.post("/api/updates/venv/path", json={"path": "/new/venv"})
        assert response.status_code == 200
        data = response.json()

        assert data["requires_restart"] is True

    @patch("api.updates._dependencies_cache")
    @patch("api.updates.venv_manager")
    def test_reset_path_no_restart_required(self, mock_vm, mock_cache):
        """Resetting to default (null) should not require restart."""
        mock_vm.set_custom_venv_path.return_value = (True, "Reset to default virtual environment path")
        mock_vm.venv_path = Path(sys.prefix)
        mock_vm.is_custom_path = False
        mock_vm.get_venv_info.return_value = MagicMock(is_valid=True)

        response = client.post("/api/updates/venv/path", json={"path": None})
        assert response.status_code == 200
        data = response.json()

        assert data["requires_restart"] is False


# ============= System Paths Endpoint Tests =============


class TestSystemPathsEndpoint:
    """Tests for venv_settings_path in GET /api/system/paths."""

    @patch("api.system.venv_manager")
    @patch("api.system.workspace_manager")
    def test_venv_settings_path_included(self, mock_ws, mock_vm):
        """venv_settings_path should be present in /system/paths response."""
        mock_vm.settings_path = Path("/fake/settings/venv_settings.json")
        mock_ws.get_current_workspace.return_value = None

        response = client.get("/api/system/paths")
        assert response.status_code == 200
        data = response.json()

        assert "venv_settings_path" in data["paths"]


# ============= VenvManager Unit Tests =============


class TestVenvManagerDeferredActivation:
    """Tests for VenvManager deferred custom path activation."""

    def test_set_custom_path_does_not_change_active_path(self, tmp_path):
        """set_custom_venv_path should save but NOT activate the custom path."""
        from api.venv_manager import VenvManager

        vm = VenvManager()
        original_path = vm.venv_path

        # Create a fake valid venv directory
        if sys.platform == "win32":
            scripts = tmp_path / "Scripts"
            scripts.mkdir()
            python_exec = scripts / "python.exe"
        else:
            bin_dir = tmp_path / "bin"
            bin_dir.mkdir()
            python_exec = bin_dir / "python"
        # Create a fake python that we won't actually call (mock the subprocess)
        python_exec.write_text("")

        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="ok")
            success, message = vm.set_custom_venv_path(str(tmp_path))

        assert success is True
        assert "Restart backend to apply" in message
        # Active path should NOT have changed
        assert vm.venv_path == original_path
        assert vm.has_pending_path_change is True

    def test_reset_clears_pending_and_custom(self):
        """reset_to_runtime should clear both active and pending paths."""
        from api.venv_manager import VenvManager

        vm = VenvManager()
        vm._custom_venv_path = Path("/some/custom")
        vm._pending_custom_path = "/some/pending"

        with patch.object(vm, "_save_settings"):
            success, message = vm.reset_to_runtime()

        assert success is True
        assert vm._custom_venv_path is None
        assert vm._pending_custom_path is None
        assert vm.has_pending_path_change is False

    def test_set_null_resets_immediately(self):
        """Setting path=None should reset immediately (no deferred)."""
        from api.venv_manager import VenvManager

        vm = VenvManager()
        vm._custom_venv_path = Path("/some/custom")

        with patch.object(vm, "_save_settings"):
            success, message = vm.set_custom_venv_path(None)

        assert success is True
        assert vm._custom_venv_path is None
        assert vm._pending_custom_path is None


class TestVenvManagerStalePathCleanup:
    """Tests for stale custom path auto-cleanup on settings load."""

    def test_stale_path_is_ignored_on_load(self, tmp_path):
        """If saved custom path doesn't exist, it should be cleared on load."""
        from api.venv_manager import VenvManager

        # Create a settings file pointing to a nonexistent path
        settings_dir = tmp_path / "settings"
        settings_dir.mkdir()
        settings_file = settings_dir / "venv_settings.json"
        settings_file.write_text(json.dumps({
            "custom_venv_path": "/nonexistent/venv/path",
            "updated_at": "2026-01-01T00:00:00+00:00",
        }))

        vm = VenvManager()
        vm._settings_path = settings_file
        vm._settings_loaded = False

        vm._load_settings()

        assert vm._custom_venv_path is None

    def test_valid_path_is_loaded(self, tmp_path):
        """If saved custom path exists and has valid Python, it should be loaded."""
        from api.venv_manager import VenvManager

        # Create a fake venv structure
        venv_dir = tmp_path / "myvenv"
        if sys.platform == "win32":
            scripts = venv_dir / "Scripts"
            scripts.mkdir(parents=True)
            (scripts / "python.exe").write_text("")
        else:
            bin_dir = venv_dir / "bin"
            bin_dir.mkdir(parents=True)
            (bin_dir / "python").write_text("")

        settings_dir = tmp_path / "settings"
        settings_dir.mkdir()
        settings_file = settings_dir / "venv_settings.json"
        settings_file.write_text(json.dumps({
            "custom_venv_path": str(venv_dir),
        }))

        vm = VenvManager()
        vm._settings_path = settings_file
        vm._settings_loaded = False

        with patch.object(vm, "_check_valid_python", return_value=True):
            vm._load_settings()

        assert vm._custom_venv_path == venv_dir


class TestVenvManagerSaveSettings:
    """Tests for updated_at timestamp and pending path in save."""

    def test_save_settings_includes_updated_at(self, tmp_path):
        """Saved settings should include an updated_at timestamp."""
        from api.venv_manager import VenvManager

        vm = VenvManager()
        vm._app_data_dir = tmp_path
        vm._settings_path = tmp_path / "venv_settings.json"

        vm._save_settings()

        with open(vm._settings_path) as f:
            settings = json.load(f)

        assert "updated_at" in settings
        assert settings["custom_venv_path"] is None

    def test_save_settings_uses_pending_path(self, tmp_path):
        """When a pending path is set, it should be saved instead of the active custom path."""
        from api.venv_manager import VenvManager

        vm = VenvManager()
        vm._app_data_dir = tmp_path
        vm._settings_path = tmp_path / "venv_settings.json"
        vm._custom_venv_path = Path("/active/path")
        vm._pending_custom_path = "/pending/path"

        vm._save_settings()

        with open(vm._settings_path) as f:
            settings = json.load(f)

        assert settings["custom_venv_path"] == "/pending/path"


# ============= Cross-Platform Path Normalization Tests =============


class TestCoherencePathNormalization:
    """Tests for path normalization edge cases in coherence check."""

    @patch("api.system.venv_manager")
    def test_trailing_slash_ignored(self, mock_vm):
        """Paths with/without trailing slashes should still match."""
        mock_vm.python_executable = Path(sys.executable)
        # Add a trailing separator to prefix
        prefix_with_slash = sys.prefix.rstrip("/\\") + os.sep
        mock_vm.venv_path = Path(prefix_with_slash)
        mock_vm.is_custom_path = False
        mock_vm.get_custom_path.return_value = None
        mock_vm.has_pending_path_change = False

        response = client.get("/api/system/env-coherence")
        data = response.json()
        assert data["prefix_match"] is True
        assert data["coherent"] is True

    @pytest.mark.skipif(sys.platform != "win32", reason="Windows-only: mixed separators")
    @patch("api.system.venv_manager")
    def test_mixed_separators_on_windows(self, mock_vm):
        """On Windows, forward and back slashes should be equivalent."""
        mock_vm.python_executable = Path(sys.executable.replace("\\", "/"))
        mock_vm.venv_path = Path(sys.prefix.replace("\\", "/"))
        mock_vm.is_custom_path = False
        mock_vm.get_custom_path.return_value = None
        mock_vm.has_pending_path_change = False

        response = client.get("/api/system/env-coherence")
        data = response.json()
        assert data["coherent"] is True

    @pytest.mark.skipif(sys.platform != "win32", reason="Windows-only: case insensitivity")
    @patch("api.system.venv_manager")
    def test_case_insensitive_on_windows(self, mock_vm):
        """On Windows, path comparison should be case-insensitive."""
        mock_vm.python_executable = Path(sys.executable.upper())
        mock_vm.venv_path = Path(sys.prefix.upper())
        mock_vm.is_custom_path = False
        mock_vm.get_custom_path.return_value = None
        mock_vm.has_pending_path_change = False

        response = client.get("/api/system/env-coherence")
        data = response.json()
        assert data["coherent"] is True

    @patch("api.system.venv_manager")
    def test_normpath_removes_double_slashes(self, mock_vm):
        """Double slashes in paths should be normalized away."""
        # Inject a double separator in the path
        if sys.platform == "win32":
            doubled = sys.prefix.replace("\\", "\\\\", 1)
        else:
            doubled = sys.prefix.replace("/", "//", 1)
        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(doubled)
        mock_vm.is_custom_path = False
        mock_vm.get_custom_path.return_value = None
        mock_vm.has_pending_path_change = False

        response = client.get("/api/system/env-coherence")
        data = response.json()
        assert data["prefix_match"] is True


# ============= Standalone Mode Detection Tests =============


class TestStandaloneModeDetection:
    """Tests for standalone/frozen mode detection in /api/system/build."""

    def test_not_frozen_in_normal_mode(self):
        """In normal (non-PyInstaller) mode, is_frozen should be False."""
        response = client.get("/api/system/build")
        assert response.status_code == 200
        data = response.json()
        assert data["is_frozen"] is False

    @patch.object(sys, "_MEIPASS", "/fake/meipass", create=True)
    def test_frozen_when_meipass_set(self):
        """When sys._MEIPASS exists, is_frozen should be True."""
        response = client.get("/api/system/build")
        assert response.status_code == 200
        data = response.json()
        assert data["is_frozen"] is True


# ============= Web-Only Mode Coherence Tests =============


class TestWebModeCoherence:
    """Tests for coherence endpoint in web-only mode (no Electron)."""

    @patch("api.system.venv_manager")
    def test_no_electron_fields_without_env_var(self, mock_vm):
        """Without NIRS4ALL_EXPECTED_PYTHON, electron fields should be absent."""
        # Ensure env var is not set
        os.environ.pop("NIRS4ALL_EXPECTED_PYTHON", None)

        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(sys.prefix)
        mock_vm.is_custom_path = False
        mock_vm.get_custom_path.return_value = None
        mock_vm.has_pending_path_change = False

        response = client.get("/api/system/env-coherence")
        data = response.json()

        assert data["coherent"] is True
        assert "electron_expected_python" not in data
        assert "electron_match" not in data

    @patch.dict(os.environ, {"NIRS4ALL_EXPECTED_PYTHON": ""})
    @patch("api.system.venv_manager")
    def test_empty_expected_python_treated_as_absent(self, mock_vm):
        """Empty string NIRS4ALL_EXPECTED_PYTHON should be treated as absent."""
        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(sys.prefix)
        mock_vm.is_custom_path = False
        mock_vm.get_custom_path.return_value = None
        mock_vm.has_pending_path_change = False

        response = client.get("/api/system/env-coherence")
        data = response.json()

        # Empty string is falsy, so electron block should not appear
        assert "electron_expected_python" not in data
        assert "electron_match" not in data

    @patch.dict(os.environ, {"NIRS4ALL_EXPECTED_PYTHON": "/matching/python"})
    @patch("api.system.venv_manager")
    def test_electron_match_true_when_paths_equal(self, mock_vm):
        """When expected Python matches runtime, electron_match should be True."""
        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(sys.prefix)
        mock_vm.is_custom_path = False
        mock_vm.get_custom_path.return_value = None
        mock_vm.has_pending_path_change = False

        # Patch to return a path that resolves to itself
        with patch("os.path.realpath", side_effect=lambda p: p):
            with patch.dict(os.environ, {"NIRS4ALL_EXPECTED_PYTHON": sys.executable}):
                response = client.get("/api/system/env-coherence")
                data = response.json()

        assert "electron_expected_python" in data
        assert data["electron_match"] is True


# ============= Standalone Mode Gating Tests =============


class TestStandaloneGating:
    """Tests that standalone mode blocks package mutation endpoints."""

    @patch.object(sys, "_MEIPASS", "/fake/meipass", create=True)
    def test_install_blocked_in_standalone(self):
        """Package install should return 400 in standalone mode."""
        response = client.post(
            "/api/updates/dependencies/install",
            json={"package": "numpy"},
        )
        assert response.status_code == 400
        assert "standalone" in response.json()["detail"].lower()

    def test_install_allowed_in_normal_mode(self):
        """Package install should not be blocked by _check_not_standalone in normal mode."""
        # This test just verifies the guard doesn't fire in normal mode.
        # The actual install will fail for other reasons (no valid package spec, etc.)
        # but should NOT return 400 with "standalone" message.
        response = client.post(
            "/api/updates/dependencies/install",
            json={"package": "this-package-does-not-exist-12345"},
        )
        # Should not be 400 with standalone message
        if response.status_code == 400:
            assert "standalone" not in response.json().get("detail", "").lower()
