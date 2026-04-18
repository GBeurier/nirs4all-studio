"""Tests for the runtime summary exposed by GET /api/system/env-coherence."""

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app

client = TestClient(app)


# ============= Coherence Endpoint Tests =============


class TestCoherenceEndpoint:
    """Tests for GET /api/system/env-coherence."""

    @patch.dict(os.environ, {"NIRS4ALL_EXPECTED_PYTHON": "/expected/python"})
    @patch("api.system.venv_manager")
    def test_electron_expected_python_mismatch(self, mock_vm):
        """When configured Python doesn't match, report the mismatch."""
        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(sys.prefix)

        response = client.get("/api/system/env-coherence")
        data = response.json()

        assert data["configured_python"] == "/expected/python"
        assert data["configured_matches_running"] is False
        assert data["coherent"] is False
        assert "electron_expected_python" in data
        assert data["electron_expected_python"] == "/expected/python"
        assert data["electron_match"] is False

    @patch("api.system.venv_manager")
    def test_response_contains_runtime_version(self, mock_vm):
        """Runtime Python version should be included."""
        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(sys.prefix)

        response = client.get("/api/system/env-coherence")
        data = response.json()

        expected_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        assert data["runtime"]["version"] == expected_version
        assert data["running_python"] == sys.executable
        assert data["running_prefix"] == sys.prefix
        assert "runtime_kind" in data
        assert "bundled_runtime_available" in data
        assert isinstance(data["missing_core_packages"], list)
        assert isinstance(data["missing_optional_packages"], list)

    @patch("api.system.venv_manager")
    def test_runtime_summary_reads_live_electron_settings(self, mock_vm):
        """Configured Python should come from env-settings.json when provided."""
        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(sys.prefix)

        with tempfile.TemporaryDirectory() as tmpdir:
            settings_path = Path(tmpdir) / "env-settings.json"
            settings_path.write_text(json.dumps({"pythonPath": "/configured/from/settings"}), encoding="utf-8")

            with patch.dict(
                os.environ,
                {
                    "NIRS4ALL_ENV_SETTINGS_PATH": str(settings_path),
                    "NIRS4ALL_EXPECTED_PYTHON": "/stale/from/backend-env",
                },
            ):
                response = client.get("/api/system/env-coherence")
                data = response.json()

        assert data["configured_python"] == "/configured/from/settings"
        assert data["electron_expected_python"] == "/configured/from/settings"


class TestRuntimeStatusEndpoint:
    """Tests for GET /api/updates/runtime/status."""

    @patch("api.updates.venv_manager")
    def test_runtime_status_exposes_python_executable(self, mock_vm):
        mock_vm.get_venv_info.return_value = type(
            "FakeInfo",
            (),
            {
                "to_dict": lambda self: {
                    "path": sys.prefix,
                    "exists": True,
                    "is_valid": True,
                    "python_executable": sys.executable,
                    "python_version": "3.13.9",
                    "pip_version": "25.1",
                    "created_at": None,
                    "last_updated": None,
                    "size_bytes": 123,
                },
            },
        )()
        mock_vm.get_installed_packages.return_value = []
        mock_vm.get_nirs4all_version.return_value = "0.9.1"

        response = client.get("/api/updates/runtime/status")
        data = response.json()

        assert response.status_code == 200
        assert data["runtime"]["python_executable"] == sys.executable


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

        response = client.get("/api/system/env-coherence")
        data = response.json()
        assert data["prefix_match"] is True
        assert data["configured_matches_running"] is True
        assert data["coherent"] is True

    @pytest.mark.skipif(sys.platform != "win32", reason="Windows-only: mixed separators")
    @patch("api.system.venv_manager")
    def test_mixed_separators_on_windows(self, mock_vm):
        """On Windows, forward and back slashes should be equivalent."""
        mock_vm.python_executable = Path(sys.executable.replace("\\", "/"))
        mock_vm.venv_path = Path(sys.prefix.replace("\\", "/"))

        response = client.get("/api/system/env-coherence")
        data = response.json()
        assert data["coherent"] is True

    @pytest.mark.skipif(sys.platform != "win32", reason="Windows-only: case insensitivity")
    @patch("api.system.venv_manager")
    def test_case_insensitive_on_windows(self, mock_vm):
        """On Windows, path comparison should be case-insensitive."""
        mock_vm.python_executable = Path(sys.executable.upper())
        mock_vm.venv_path = Path(sys.prefix.upper())

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

        response = client.get("/api/system/env-coherence")
        data = response.json()
        assert data["prefix_match"] is True
        assert data["coherent"] is True


# ============= Standalone Mode Detection Tests =============


class TestStandaloneModeDetection:
    """Tests for standalone/frozen mode detection in /api/system/build."""

    def test_not_frozen_in_normal_mode(self):
        """In normal (non-PyInstaller) mode, is_frozen should be False."""
        response = client.get("/api/system/build")
        assert response.status_code == 200
        data = response.json()
        assert data["is_frozen"] is False
        assert data["runtime_mode"] == "development"

    @patch.object(sys, "_MEIPASS", "/fake/meipass", create=True)
    def test_frozen_when_meipass_set(self):
        """When sys._MEIPASS exists, is_frozen should be True."""
        response = client.get("/api/system/build")
        assert response.status_code == 200
        data = response.json()
        assert data["is_frozen"] is True
        assert data["runtime_mode"] == "pyinstaller"

    @patch.dict(os.environ, {"NIRS4ALL_RUNTIME_MODE": "bundled"})
    def test_runtime_mode_reports_bundled_when_electron_sets_it(self):
        """Bundled runtime mode should come from Electron's explicit env flag."""
        response = client.get("/api/system/build")
        assert response.status_code == 200
        data = response.json()

        assert data["runtime_mode"] == "bundled"
        assert data["summary"]["runtime_mode"] == "bundled"
        assert data["is_frozen"] is False

    @patch.dict(os.environ, {"NIRS4ALL_BUNDLED_RUNTIME_AVAILABLE": "true"})
    @patch("api.system.venv_manager")
    def test_runtime_summary_reports_bundled_runtime_availability(self, mock_vm):
        """Runtime summary should expose when a bundled runtime exists."""
        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(sys.prefix)

        response = client.get("/api/system/env-coherence")
        data = response.json()

        assert data["bundled_runtime_available"] is True


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

        response = client.get("/api/system/env-coherence")
        data = response.json()

        assert data["coherent"] is True
        assert data["configured_python"] is None
        assert data["configured_matches_running"] is True
        assert "electron_expected_python" not in data
        assert "electron_match" not in data

    @patch.dict(os.environ, {"NIRS4ALL_EXPECTED_PYTHON": ""})
    @patch("api.system.venv_manager")
    def test_empty_expected_python_treated_as_absent(self, mock_vm):
        """Empty string NIRS4ALL_EXPECTED_PYTHON should be treated as absent."""
        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(sys.prefix)

        response = client.get("/api/system/env-coherence")
        data = response.json()

        # Empty string is falsy, so electron block should not appear
        assert data["configured_python"] is None
        assert data["configured_matches_running"] is True
        assert "electron_expected_python" not in data
        assert "electron_match" not in data

    @patch.dict(os.environ, {"NIRS4ALL_EXPECTED_PYTHON": "/matching/python"})
    @patch("api.system.venv_manager")
    def test_electron_match_true_when_paths_equal(self, mock_vm):
        """When expected Python matches runtime, electron_match should be True."""
        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(sys.prefix)

        # Patch to return a path that resolves to itself
        with patch("os.path.realpath", side_effect=lambda p: p):
            with patch.dict(os.environ, {"NIRS4ALL_EXPECTED_PYTHON": sys.executable}):
                response = client.get("/api/system/env-coherence")
                data = response.json()

        assert "electron_expected_python" in data
        assert data["configured_python"] == sys.executable
        assert data["configured_matches_running"] is True
        assert data["coherent"] is True
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
        assert "packaged backend mode" in response.json()["detail"].lower()

    @patch.dict(os.environ, {"NIRS4ALL_RUNTIME_MODE": "bundled"})
    def test_install_blocked_in_bundled_runtime_mode(self):
        """Package install should also be blocked in bundled runtime mode."""
        response = client.post(
            "/api/updates/dependencies/install",
            json={"package": "numpy"},
        )
        assert response.status_code == 400
        assert "embedded bundled python runtime" in response.json()["detail"].lower()

    @patch.dict(os.environ, {"NIRS4ALL_RUNTIME_MODE": "bundled"})
    def test_nirs4all_install_blocked_in_bundled_runtime_mode(self):
        """Base library installation should also be blocked in bundled runtime mode."""
        response = client.post(
            "/api/updates/nirs4all/install",
            json={},
        )
        assert response.status_code == 400
        assert "embedded bundled python runtime" in response.json()["detail"].lower()

    @patch.dict(os.environ, {"NIRS4ALL_RUNTIME_MODE": "bundled"})
    def test_create_venv_blocked_in_bundled_runtime_mode(self):
        """Backend-side runtime creation should be routed back to desktop settings."""
        response = client.post(
            "/api/updates/venv/create",
            json={"force": False, "install_nirs4all": True},
        )
        assert response.status_code == 400
        assert "desktop-managed action" in response.json()["detail"].lower()

    def test_create_venv_blocked_in_normal_mode(self):
        """The backend should no longer create a second runtime on its own."""
        response = client.post(
            "/api/updates/runtime/create",
            json={"force": False, "install_nirs4all": True},
        )
        assert response.status_code == 400
        assert "desktop-managed action" in response.json()["detail"].lower()

    @patch.dict(os.environ, {"NIRS4ALL_RUNTIME_MODE": "bundled"})
    def test_restore_snapshot_blocked_in_bundled_runtime_mode(self):
        """Snapshot restore must not mutate the read-only bundled runtime."""
        response = client.post("/api/updates/venv/snapshots/example/restore")
        assert response.status_code == 400
        assert "embedded bundled python runtime" in response.json()["detail"].lower()

    @patch.dict(os.environ, {"NIRS4ALL_RUNTIME_MODE": "bundled"})
    def test_config_align_blocked_in_bundled_runtime_mode(self):
        """Recommended-config alignment must not mutate a bundled runtime."""
        response = client.post(
            "/api/config/align",
            json={"profile": "cpu", "optional_packages": [], "dry_run": False},
        )
        assert response.status_code == 400
        assert "all-in-one bundle" in response.json()["detail"].lower()

    def test_install_allowed_in_normal_mode(self):
        """Package install should not be blocked by _check_not_standalone in normal mode."""
        # This test just verifies the guard doesn't fire in normal mode.
        # The actual install will fail for other reasons (no valid package spec, etc.)
        # but should NOT return 400 with the all-in-one bundle message.
        response = client.post(
            "/api/updates/dependencies/install",
            json={"package": "this-package-does-not-exist-12345"},
        )
        # Should not be 400 with the all-in-one bundle message
        if response.status_code == 400:
            assert "all-in-one bundle" not in response.json().get("detail", "").lower()
