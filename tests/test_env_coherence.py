"""
Tests for environment coherence endpoint (GET /api/system/env-coherence)
and related system endpoints.

Verifies that:
- Coherence endpoint correctly detects matching and mismatched environments
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

import os
import sys
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
        """When NIRS4ALL_EXPECTED_PYTHON doesn't match, report it."""
        mock_vm.python_executable = Path(sys.executable)
        mock_vm.venv_path = Path(sys.prefix)

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

        response = client.get("/api/system/env-coherence")
        data = response.json()

        expected_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        assert data["runtime"]["version"] == expected_version


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
