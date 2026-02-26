"""
Tests for the run preflight endpoint (POST /api/runs/preflight).

Verifies that:
- Ready=True when environment is coherent and all pipeline imports resolve
- env_mismatch issue reported when coherence check fails
- Coherence check exceptions are non-fatal (swallowed gracefully)
- missing_module issues reported when operator classes can't be imported
- not_found issues reported for nonexistent pipeline_ids
- Multiple pipelines are checked and issues aggregated
- Inline pipelines are validated the same as saved pipelines
"""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app

client = TestClient(app)


# The run_preflight handler uses local imports:
#   from .system import check_env_coherence
#   from .pipelines import _load_pipeline
#   from .nirs4all_adapter import check_pipeline_imports
# So we must patch at the SOURCE module, not on api.runs.
PATCH_COHERENCE = "api.system.check_env_coherence"
PATCH_LOAD_PIPELINE = "api.pipelines._load_pipeline"
PATCH_CHECK_IMPORTS = "api.nirs4all_adapter.check_pipeline_imports"


# ============= Helpers =============


def _coherent_response() -> dict:
    """Return a mock coherent response from check_env_coherence."""
    return {
        "coherent": True,
        "python_match": True,
        "prefix_match": True,
        "runtime": {"python": sys.executable, "prefix": sys.prefix, "version": "3.11.0"},
        "venv_manager": {
            "python": sys.executable,
            "prefix": sys.prefix,
            "is_custom": False,
            "custom_path": None,
            "has_pending_change": False,
        },
    }


def _incoherent_response() -> dict:
    """Return a mock incoherent response."""
    return {**_coherent_response(), "coherent": False, "prefix_match": False}


def _pipeline_config(name: str = "Test Pipeline", steps: list | None = None) -> dict:
    """Build a minimal pipeline config dict."""
    return {
        "name": name,
        "steps": steps or [
            {"id": "1", "type": "preprocessing", "name": "StandardNormalVariate", "params": {}},
            {"id": "2", "type": "model", "name": "PLSRegression", "params": {"n_components": 5}},
        ],
    }


# ============= Ready (Happy Path) =============


class TestPreflightReady:
    """Tests where preflight should return ready=True."""

    @patch(PATCH_CHECK_IMPORTS, return_value=[])
    @patch(PATCH_LOAD_PIPELINE, return_value=_pipeline_config())
    @patch(PATCH_COHERENCE, new_callable=AsyncMock, return_value=_coherent_response())
    def test_ready_when_coherent_and_imports_pass(self, mock_coherence, mock_load, mock_imports):
        """Coherent env + all imports resolve → ready=True, no issues."""
        response = client.post("/api/runs/preflight", json={"pipeline_ids": ["test_pls"]})
        assert response.status_code == 200
        data = response.json()

        assert data["ready"] is True
        assert data["issues"] == []
        mock_coherence.assert_awaited_once()
        mock_load.assert_called_once_with("test_pls")
        mock_imports.assert_called_once()

    @patch(PATCH_COHERENCE, new_callable=AsyncMock, return_value=_coherent_response())
    def test_ready_with_empty_pipeline_ids(self, mock_coherence):
        """Empty pipeline_ids and no inline pipeline → ready=True (nothing to check)."""
        response = client.post("/api/runs/preflight", json={"pipeline_ids": []})
        assert response.status_code == 200
        data = response.json()

        assert data["ready"] is True
        assert data["issues"] == []

    @patch(PATCH_CHECK_IMPORTS, return_value=[])
    @patch(PATCH_COHERENCE, new_callable=AsyncMock, return_value=_coherent_response())
    def test_ready_with_inline_pipeline(self, mock_coherence, mock_imports):
        """Inline pipeline steps are also checked for imports."""
        response = client.post("/api/runs/preflight", json={
            "pipeline_ids": [],
            "inline_pipeline": {
                "name": "Inline Test",
                "steps": [
                    {"id": "1", "type": "preprocessing", "name": "SNV", "params": {}},
                ],
            },
        })
        assert response.status_code == 200
        data = response.json()

        assert data["ready"] is True
        mock_imports.assert_called_once()


# ============= Environment Mismatch =============


class TestPreflightEnvMismatch:
    """Tests when environment coherence check fails."""

    @patch(PATCH_CHECK_IMPORTS, return_value=[])
    @patch(PATCH_LOAD_PIPELINE, return_value=_pipeline_config())
    @patch(PATCH_COHERENCE, new_callable=AsyncMock, return_value=_incoherent_response())
    def test_env_mismatch_reported(self, mock_coherence, mock_load, mock_imports):
        """Incoherent env → env_mismatch issue, ready=False."""
        response = client.post("/api/runs/preflight", json={"pipeline_ids": ["test_pls"]})
        data = response.json()

        assert data["ready"] is False
        env_issues = [i for i in data["issues"] if i["type"] == "env_mismatch"]
        assert len(env_issues) == 1
        assert "Restart" in env_issues[0]["message"]

    @patch(PATCH_CHECK_IMPORTS, return_value=[])
    @patch(PATCH_LOAD_PIPELINE, return_value=_pipeline_config())
    @patch(PATCH_COHERENCE, new_callable=AsyncMock, side_effect=Exception("DB error"))
    def test_coherence_exception_is_non_fatal(self, mock_coherence, mock_load, mock_imports):
        """If check_env_coherence raises, preflight should still succeed."""
        response = client.post("/api/runs/preflight", json={"pipeline_ids": ["test_pls"]})
        data = response.json()

        # Pipeline imports passed → ready despite coherence failure
        assert data["ready"] is True
        assert data["issues"] == []


# ============= Missing Modules =============


class TestPreflightMissingModules:
    """Tests for missing operator module detection."""

    @patch(PATCH_CHECK_IMPORTS, return_value=[
        {"step_name": "PyTorchModel", "step_type": "model", "error": "No module named 'torch'"},
    ])
    @patch(PATCH_LOAD_PIPELINE, return_value=_pipeline_config())
    @patch(PATCH_COHERENCE, new_callable=AsyncMock, return_value=_coherent_response())
    def test_missing_module_reported(self, mock_coherence, mock_load, mock_imports):
        """Missing import → missing_module issue with details."""
        response = client.post("/api/runs/preflight", json={"pipeline_ids": ["test_dl"]})
        data = response.json()

        assert data["ready"] is False
        missing = [i for i in data["issues"] if i["type"] == "missing_module"]
        assert len(missing) == 1
        assert "details" in missing[0]
        assert missing[0]["details"]["step_name"] == "PyTorchModel"
        assert "Install it via Settings" in missing[0]["message"]

    @patch(PATCH_CHECK_IMPORTS)
    @patch(PATCH_LOAD_PIPELINE)
    @patch(PATCH_COHERENCE, new_callable=AsyncMock, return_value=_coherent_response())
    def test_multiple_pipelines_aggregated(self, mock_coherence, mock_load, mock_imports):
        """Issues from multiple pipelines are aggregated."""
        # First pipeline succeeds, second has a missing module
        mock_load.side_effect = [
            _pipeline_config("Pipeline A"),
            _pipeline_config("Pipeline B"),
        ]
        mock_imports.side_effect = [
            [],  # Pipeline A: all imports OK
            [{"step_name": "SHAP", "step_type": "model", "error": "No module named 'shap'"}],
        ]

        response = client.post("/api/runs/preflight", json={
            "pipeline_ids": ["pipeline_a", "pipeline_b"],
        })
        data = response.json()

        assert data["ready"] is False
        missing = [i for i in data["issues"] if i["type"] == "missing_module"]
        assert len(missing) == 1
        assert "Pipeline B" in missing[0]["message"]


# ============= Pipeline Not Found =============


class TestPreflightNotFound:
    """Tests for nonexistent pipeline IDs."""

    @patch(PATCH_LOAD_PIPELINE, side_effect=HTTPException(status_code=404, detail="Pipeline not found"))
    @patch(PATCH_COHERENCE, new_callable=AsyncMock, return_value=_coherent_response())
    def test_missing_pipeline_returns_not_found(self, mock_coherence, mock_load):
        """Non-existent pipeline_id → not_found issue."""
        response = client.post("/api/runs/preflight", json={"pipeline_ids": ["nonexistent"]})
        data = response.json()

        assert data["ready"] is False
        not_found = [i for i in data["issues"] if i["type"] == "not_found"]
        assert len(not_found) == 1
        assert "nonexistent" in not_found[0]["message"]

    @patch(PATCH_CHECK_IMPORTS, return_value=[])
    @patch(PATCH_LOAD_PIPELINE)
    @patch(PATCH_COHERENCE, new_callable=AsyncMock, return_value=_coherent_response())
    def test_not_found_does_not_block_other_pipelines(self, mock_coherence, mock_load, mock_imports):
        """Other pipelines should still be checked even if one is not found."""
        mock_load.side_effect = [
            HTTPException(status_code=404, detail="Not found"),
            _pipeline_config("Good Pipeline"),
        ]

        response = client.post("/api/runs/preflight", json={
            "pipeline_ids": ["missing", "good_one"],
        })
        data = response.json()

        assert data["ready"] is False
        not_found = [i for i in data["issues"] if i["type"] == "not_found"]
        assert len(not_found) == 1
        # The second pipeline was still loaded and checked
        mock_imports.assert_called_once()
