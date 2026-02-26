"""
Integration tests for environment coherence — end-to-end without mocking.

These tests exercise the real coherence endpoint and verify that the running
test environment reports consistent state across endpoints.

Requires: fastapi, uvicorn (test dependencies).
Does NOT require: nirs4all (tests use only system/env endpoints).
"""

import os
import sys

# ============= Coherence Endpoint Integration =============


class TestCoherenceIntegration:
    """End-to-end tests for GET /api/system/env-coherence with real VenvManager."""

    def test_default_env_is_coherent(self, client):
        """In a fresh test environment (no custom path), coherence should be True."""
        response = client.get("/api/system/env-coherence")
        assert response.status_code == 200
        data = response.json()

        assert data["coherent"] is True
        assert data["python_match"] is True
        assert data["prefix_match"] is True

    def test_runtime_python_matches_sys_executable(self, client):
        """Runtime Python path should match the interpreter running tests."""
        response = client.get("/api/system/env-coherence")
        data = response.json()

        # Normalize paths for comparison (Windows case-insensitivity, symlinks)
        reported = os.path.normcase(os.path.normpath(data["runtime"]["python"]))
        expected = os.path.normcase(os.path.normpath(sys.executable))
        assert reported == expected

    def test_runtime_prefix_matches_sys_prefix(self, client):
        """Runtime prefix should match sys.prefix."""
        response = client.get("/api/system/env-coherence")
        data = response.json()

        reported = os.path.normcase(os.path.normpath(data["runtime"]["prefix"]))
        expected = os.path.normcase(os.path.normpath(sys.prefix))
        assert reported == expected

    def test_runtime_version_is_valid(self, client):
        """Runtime version string should be a valid semver-like format."""
        response = client.get("/api/system/env-coherence")
        data = response.json()

        version = data["runtime"]["version"]
        parts = version.split(".")
        assert len(parts) == 3
        assert all(p.isdigit() for p in parts)

    def test_build_info_not_frozen(self, client):
        """In normal test env, is_frozen should be False."""
        response = client.get("/api/system/build")
        assert response.status_code == 200
        data = response.json()

        assert data["is_frozen"] is False


# ============= Preflight + Coherence Integration =============


class TestPreflightCoherenceIntegration:
    """Verify preflight endpoint uses coherence internally."""

    def test_preflight_with_empty_pipelines_passes(self, client):
        """Preflight with no pipelines should pass (coherence is the only check)."""
        response = client.post("/api/runs/preflight", json={"pipeline_ids": []})
        assert response.status_code == 200
        data = response.json()

        # Env is coherent in test → should be ready
        assert data["ready"] is True
        assert data["issues"] == []


# ============= Dependencies + Coherence Consistency =============


class TestDependenciesCoherenceConsistency:
    """Verify dependencies and coherence endpoints agree on env state."""

    def test_dependencies_endpoint_returns_valid_structure(self, client):
        """GET /api/updates/dependencies should return a valid response structure."""
        response = client.get("/api/updates/dependencies")
        assert response.status_code == 200
        data = response.json()

        # Structural assertions — these fields must always be present
        assert "categories" in data
        assert "total_installed" in data
        assert "total_packages" in data
        assert "venv_valid" in data
        assert isinstance(data["categories"], list)

    def test_coherence_and_dependencies_venv_state_consistent(self, client):
        """Both endpoints should agree on whether a custom venv is configured."""
        coherence = client.get("/api/system/env-coherence").json()
        deps = client.get("/api/updates/dependencies").json()

        # In the default test env, neither should report a custom path
        assert coherence["venv_manager"]["is_custom"] is False
        # Dependencies endpoint should report venv as valid (default = sys.prefix)
        assert deps["venv_valid"] is True
