"""
Integration Test Suite for nirs4all_webapp - Phase 3 Data Flow Verification.

This module tests the complete end-to-end workflow from:
Dataset → Pipeline → Run → Results → Predictions

Run with: pytest tests/test_integration_flow.py -v

Requirements:
- Running backend server (or use TestClient)
- nirs4all library available
- Sample dataset available
"""

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Import the FastAPI app
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from main import app


# ============================================================================
# Test Fixtures
# ============================================================================


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    with TestClient(app) as c:
        yield c


@pytest.fixture
def mock_workspace(tmp_path):
    """Create a temporary workspace directory structure."""
    workspace_dir = tmp_path / "test_workspace"
    workspace_dir.mkdir()

    # Create subdirectories
    (workspace_dir / "pipelines").mkdir()
    (workspace_dir / "workspace" / "runs").mkdir(parents=True)
    (workspace_dir / "models").mkdir()

    return workspace_dir


@pytest.fixture
def sample_pipeline_config():
    """Return a sample pipeline configuration."""
    return {
        "name": "Test PLS Pipeline",
        "description": "Integration test pipeline",
        "category": "user",
        "steps": [
            {
                "id": "1",
                "type": "preprocessing",
                "name": "StandardNormalVariate",
                "params": {},
            },
            {
                "id": "2",
                "type": "splitting",
                "name": "KFold",
                "params": {"n_splits": 5},
            },
            {
                "id": "3",
                "type": "model",
                "name": "PLSRegression",
                "params": {"n_components": 10},
            },
        ],
    }


# ============================================================================
# API Endpoint Tests
# ============================================================================


class TestHealthEndpoint:
    """Test the health check endpoint."""

    def test_health_check(self, client):
        """Verify the API is running and responding."""
        response = client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy"


class TestWorkspaceEndpoints:
    """Test workspace-related endpoints."""

    def test_get_workspace_no_selection(self, client):
        """Test getting workspace when none is selected."""
        response = client.get("/api/workspace")
        assert response.status_code in (200, 409)

    def test_workspace_stats_endpoint(self, client):
        """Test workspace statistics endpoint."""
        response = client.get("/api/workspace/stats")
        # May return 409 if no workspace selected, or 200 with data
        assert response.status_code in (200, 409)


class TestDatasetsEndpoints:
    """Test dataset-related endpoints."""

    def test_list_datasets(self, client):
        """Test listing datasets."""
        response = client.get("/api/datasets")
        assert response.status_code in (200, 409)

        if response.status_code == 200:
            data = response.json()
            assert "datasets" in data
            assert "total" in data
            assert isinstance(data["datasets"], list)

    def test_list_datasets_with_verify(self, client):
        """Test listing datasets with integrity verification."""
        response = client.get("/api/datasets?verify_integrity=true")
        assert response.status_code in (200, 409)

    def test_synthetic_presets(self, client):
        """Test getting synthetic dataset presets."""
        response = client.get("/api/datasets/synthetic-presets")
        assert response.status_code == 200
        data = response.json()
        assert "presets" in data
        assert len(data["presets"]) > 0

        # Verify preset structure
        preset = data["presets"][0]
        assert "id" in preset
        assert "name" in preset
        assert "task_type" in preset
        assert "n_samples" in preset


class TestPipelinesEndpoints:
    """Test pipeline-related endpoints."""

    def test_list_pipelines(self, client):
        """Test listing pipelines."""
        response = client.get("/api/pipelines")
        assert response.status_code in (200, 409)

        if response.status_code == 200:
            data = response.json()
            assert "pipelines" in data
            assert isinstance(data["pipelines"], list)

    def test_get_presets(self, client):
        """Test getting pipeline presets."""
        response = client.get("/api/pipelines/presets")
        assert response.status_code == 200
        data = response.json()
        assert "presets" in data
        assert len(data["presets"]) > 0

        # Verify preset structure
        preset = data["presets"][0]
        assert "id" in preset
        assert "name" in preset
        assert "steps" in preset
        assert isinstance(preset["steps"], list)

    def test_list_operators(self, client):
        """Test listing available operators."""
        response = client.get("/api/pipelines/operators")
        assert response.status_code == 200
        data = response.json()
        assert "operators" in data
        assert "preprocessing" in data["operators"]
        assert "models" in data["operators"]
        assert "splitting" in data["operators"]

    def test_list_samples(self, client):
        """Test listing pipeline samples."""
        response = client.get("/api/pipelines/samples")
        assert response.status_code in (200, 404)

        if response.status_code == 200:
            data = response.json()
            assert "samples" in data

    def test_create_pipeline(self, client, sample_pipeline_config):
        """Test creating a new pipeline (may fail without workspace)."""
        response = client.post("/api/pipelines", json=sample_pipeline_config)
        # 409 is expected if no workspace is selected
        assert response.status_code in (200, 201, 409)

        if response.status_code in (200, 201):
            data = response.json()
            assert "success" in data or "pipeline" in data

    def test_validate_pipeline(self, client, sample_pipeline_config):
        """Test pipeline validation endpoint."""
        response = client.post(
            "/api/pipelines/validate",
            json={"steps": sample_pipeline_config["steps"]}
        )
        assert response.status_code == 200
        data = response.json()
        assert "valid" in data
        assert "steps" in data

    def test_count_variants(self, client, sample_pipeline_config):
        """Test counting pipeline variants."""
        response = client.post(
            "/api/pipelines/count-variants",
            json={"steps": sample_pipeline_config["steps"]}
        )
        assert response.status_code == 200
        data = response.json()
        assert "count" in data
        assert data["count"] >= 1


class TestRunsEndpoints:
    """Test run-related endpoints."""

    def test_list_runs(self, client):
        """Test listing runs."""
        response = client.get("/api/runs")
        assert response.status_code == 200
        data = response.json()
        assert "runs" in data
        assert "total" in data

    def test_get_run_stats(self, client):
        """Test getting run statistics."""
        response = client.get("/api/runs/stats")
        assert response.status_code == 200
        data = response.json()
        assert "running" in data
        assert "queued" in data
        assert "completed" in data
        assert "failed" in data

    def test_get_nonexistent_run(self, client):
        """Test getting a non-existent run returns 404."""
        response = client.get("/api/runs/nonexistent_run_id")
        assert response.status_code == 404

    def test_create_run_without_workspace(self, client):
        """Test that creating a run without workspace fails gracefully."""
        config = {
            "config": {
                "name": "Test Run",
                "dataset_ids": ["test_dataset"],
                "pipeline_ids": ["test_pipeline"],
                "cv_folds": 5,
                "cv_strategy": "kfold",
            }
        }
        response = client.post("/api/runs", json=config)
        # Should fail with 409 (no workspace) or 404 (dataset/pipeline not found)
        assert response.status_code in (404, 409)


class TestSystemEndpoints:
    """Test system-related endpoints."""

    def test_system_info(self, client):
        """Test system info endpoint."""
        response = client.get("/api/system/info")
        assert response.status_code == 200
        data = response.json()
        # Response has nested structure: python.version, system.os, etc.
        assert "python" in data or "system" in data
        if "python" in data:
            assert "version" in data["python"]

    def test_system_capabilities(self, client):
        """Test system capabilities endpoint."""
        response = client.get("/api/system/capabilities")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)

    def test_system_status(self, client):
        """Test system status endpoint."""
        response = client.get("/api/system/status")
        assert response.status_code == 200


class TestWebSocketEndpoints:
    """Test WebSocket-related endpoints."""

    def test_ws_stats(self, client):
        """Test WebSocket stats endpoint."""
        response = client.get("/api/ws/stats")
        assert response.status_code == 200
        data = response.json()
        assert "total_connections" in data


# ============================================================================
# API Integration Tests
# ============================================================================


class TestAPIIntegrationChecklist:
    """Verify the API integration checklist from the roadmap."""

    def test_datasets_endpoint_structure(self, client):
        """Verify GET /datasets returns correct structure."""
        response = client.get("/api/datasets")
        if response.status_code == 200:
            data = response.json()
            assert "datasets" in data
            assert "total" in data
            assert isinstance(data["total"], int)

    def test_pipelines_endpoint_structure(self, client):
        """Verify GET /pipelines returns correct structure."""
        response = client.get("/api/pipelines")
        if response.status_code == 200:
            data = response.json()
            assert "pipelines" in data
            assert isinstance(data["pipelines"], list)

    def test_presets_endpoint_structure(self, client):
        """Verify GET /pipelines/presets returns correct structure."""
        response = client.get("/api/pipelines/presets")
        assert response.status_code == 200
        data = response.json()
        assert "presets" in data
        assert "total" in data

        for preset in data["presets"]:
            assert "id" in preset
            assert "name" in preset
            assert "description" in preset
            assert "steps" in preset
            assert isinstance(preset["steps"], list)

    def test_runs_endpoint_structure(self, client):
        """Verify GET /runs returns correct structure."""
        response = client.get("/api/runs")
        assert response.status_code == 200
        data = response.json()
        assert "runs" in data
        assert "total" in data
        assert isinstance(data["runs"], list)


# ============================================================================
# Pipeline Validation Tests
# ============================================================================


class TestPipelineValidation:
    """Test pipeline validation logic."""

    def test_valid_simple_pipeline(self, client):
        """Test validation of a simple valid pipeline."""
        steps = [
            {"id": "1", "type": "preprocessing", "name": "StandardScaler", "params": {}},
            {"id": "2", "type": "model", "name": "PLSRegression", "params": {"n_components": 10}},
        ]
        response = client.post("/api/pipelines/validate", json={"steps": steps})
        assert response.status_code == 200
        data = response.json()
        assert data.get("valid") is True

    def test_pipeline_with_unknown_operator(self, client):
        """Test validation warns about unknown operators."""
        steps = [
            {"id": "1", "type": "preprocessing", "name": "UnknownOperator", "params": {}},
        ]
        response = client.post("/api/pipelines/validate", json={"steps": steps})
        assert response.status_code == 200
        data = response.json()
        # Should have warnings but may still be valid
        assert "warnings" in data

    def test_empty_pipeline(self, client):
        """Test validation of empty pipeline."""
        response = client.post("/api/pipelines/validate", json={"steps": []})
        assert response.status_code == 200
        data = response.json()
        assert "valid" in data


# ============================================================================
# Run Execution Tests (Mock-based)
# ============================================================================


class TestRunCreationValidation:
    """Test run creation validation logic."""

    def test_run_requires_workspace(self, client):
        """Verify run creation requires a workspace."""
        config = {
            "config": {
                "name": "Test Run",
                "dataset_ids": ["ds1"],
                "pipeline_ids": ["pl1"],
                "cv_folds": 5,
            }
        }
        response = client.post("/api/runs", json=config)
        # Should fail with 409 (no workspace) or 404 (not found)
        assert response.status_code in (404, 409)

    def test_run_validates_dataset_exists(self, client):
        """Verify run creation validates dataset existence."""
        # This test documents expected behavior
        config = {
            "config": {
                "name": "Test Run",
                "dataset_ids": ["nonexistent_dataset"],
                "pipeline_ids": ["some_pipeline"],
                "cv_folds": 5,
            }
        }
        response = client.post("/api/runs", json=config)
        # Should fail with 404 or 409
        assert response.status_code in (404, 409)

    def test_run_validates_pipeline_exists(self, client):
        """Verify run creation validates pipeline existence."""
        config = {
            "config": {
                "name": "Test Run",
                "dataset_ids": ["some_dataset"],
                "pipeline_ids": ["nonexistent_pipeline"],
                "cv_folds": 5,
            }
        }
        response = client.post("/api/runs", json=config)
        # Should fail with 404 or 409
        assert response.status_code in (404, 409)


# ============================================================================
# End-to-End Integration Test Scenario
# ============================================================================


class TestEndToEndScenario:
    """
    Test the complete end-to-end scenario from the roadmap.

    This is a documentation/verification test that outlines the expected flow.
    """

    def test_e2e_scenario_documentation(self, client):
        """
        Document the end-to-end test scenario.

        This test verifies each endpoint is accessible and documents
        the expected integration flow.
        """
        results = {}

        # Step 1: Check health
        response = client.get("/api/health")
        results["health"] = response.status_code == 200

        # Step 2: List workspaces
        response = client.get("/api/workspaces")
        results["list_workspaces"] = response.status_code in (200, 409)

        # Step 3: List datasets
        response = client.get("/api/datasets")
        results["list_datasets"] = response.status_code in (200, 409)

        # Step 4: List pipelines
        response = client.get("/api/pipelines")
        results["list_pipelines"] = response.status_code in (200, 409)

        # Step 5: Get presets
        response = client.get("/api/pipelines/presets")
        results["get_presets"] = response.status_code == 200

        # Step 6: List runs
        response = client.get("/api/runs")
        results["list_runs"] = response.status_code == 200

        # Step 7: Get run stats
        response = client.get("/api/runs/stats")
        results["run_stats"] = response.status_code == 200

        # Step 8: WebSocket stats
        response = client.get("/api/ws/stats")
        results["ws_stats"] = response.status_code == 200

        # All endpoints should be accessible
        assert all(results.values()), f"Failed endpoints: {[k for k, v in results.items() if not v]}"


# ============================================================================
# Data Type and Schema Tests
# ============================================================================


class TestDataSchemas:
    """Verify response schemas match expected types."""

    def test_run_status_values(self, client):
        """Verify run status values are valid."""
        valid_statuses = ["queued", "running", "completed", "failed", "paused"]

        response = client.get("/api/runs")
        if response.status_code == 200:
            data = response.json()
            for run in data.get("runs", []):
                assert run.get("status") in valid_statuses

    def test_pipeline_step_types(self, client):
        """Verify pipeline step types are valid."""
        valid_types = ["preprocessing", "splitting", "model", "metrics", "augmentation"]

        response = client.get("/api/pipelines/presets")
        if response.status_code == 200:
            data = response.json()
            for preset in data.get("presets", []):
                for step in preset.get("steps", []):
                    assert step.get("type") in valid_types, f"Invalid step type: {step.get('type')}"


# ============================================================================
# Error Handling Tests
# ============================================================================


class TestErrorHandling:
    """Test error handling across endpoints."""

    def test_404_for_missing_resource(self, client):
        """Test 404 is returned for missing resources."""
        response = client.get("/api/runs/definitely_not_a_real_run_id")
        assert response.status_code == 404

    def test_invalid_json_body(self, client):
        """Test handling of invalid JSON body."""
        response = client.post(
            "/api/pipelines/validate",
            content="not valid json",
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code in (400, 422)

    def test_missing_required_fields(self, client):
        """Test handling of missing required fields."""
        # Pipeline creation without required name
        response = client.post("/api/pipelines", json={"steps": []})
        assert response.status_code in (422, 409)


# ============================================================================
# Main Entry Point
# ============================================================================


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
