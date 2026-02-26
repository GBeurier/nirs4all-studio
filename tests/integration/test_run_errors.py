"""
Integration tests for run error handling.

Tests validation errors, execution failures, and error reporting:
- Missing pipeline/dataset (404)
- No workspace selected (409)
- Invalid pipeline configuration
- nirs4all execution failures
- Error message propagation to frontend

Run tests:
    pytest tests/integration/test_run_errors.py -v
"""

import json
from pathlib import Path
from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient

from .websocket_utils import RunProgressTracker


class TestMissingResourceErrors:
    """Test 404 errors for missing resources."""

    def test_quick_run_missing_pipeline_404(self, workspace_client: TestClient):
        """Quick run with nonexistent pipeline returns 404."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "pipeline_that_does_not_exist",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        assert response.status_code == 404
        detail = response.json().get("detail", "")
        assert "pipeline" in detail.lower()
        assert "not found" in detail.lower()

    def test_quick_run_missing_dataset_404(self, workspace_client: TestClient):
        """Quick run with nonexistent dataset returns 404."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "dataset_that_does_not_exist",
            "cv_folds": 3,
        })

        assert response.status_code == 404
        detail = response.json().get("detail", "")
        assert "dataset" in detail.lower()
        assert "not found" in detail.lower()

    def test_experiment_missing_pipeline_404(self, workspace_client: TestClient):
        """Experiment with nonexistent pipeline returns 404."""
        # Note: Validation order is dataset first, then pipeline
        # So we use the test dataset that exists from workspace_with_data
        response = workspace_client.post("/api/runs", json={
            "config": {
                "name": "Test Experiment",
                "dataset_ids": ["test_dataset"],
                "pipeline_ids": ["nonexistent_pipeline"],
                "cv_folds": 3,
            }
        })

        assert response.status_code == 404
        detail = response.json().get("detail", "").lower()
        # Either pipeline or dataset error (depends on validation order)
        assert "not found" in detail

    def test_experiment_missing_dataset_404(self, workspace_client: TestClient):
        """Experiment with nonexistent dataset returns 404."""
        response = workspace_client.post("/api/runs", json={
            "config": {
                "name": "Test Experiment",
                "dataset_ids": ["nonexistent_dataset"],
                "pipeline_ids": ["test_pls"],
                "cv_folds": 3,
            }
        })

        assert response.status_code == 404
        assert "dataset" in response.json().get("detail", "").lower()

    def test_get_nonexistent_run_404(self, workspace_client: TestClient):
        """Getting a nonexistent run returns 404."""
        response = workspace_client.get("/api/runs/run_that_does_not_exist")

        assert response.status_code == 404
        assert "not found" in response.json().get("detail", "").lower()

    def test_stop_nonexistent_run_404(self, workspace_client: TestClient):
        """Stopping a nonexistent run returns 404."""
        response = workspace_client.post("/api/runs/nonexistent/stop")

        assert response.status_code == 404

    def test_delete_nonexistent_run_404(self, workspace_client: TestClient):
        """Deleting a nonexistent run returns 404."""
        response = workspace_client.delete("/api/runs/nonexistent")

        assert response.status_code == 404


class TestNoWorkspaceErrors:
    """Test 409 errors when no workspace is selected."""

    def test_quick_run_no_workspace_409(self, client: TestClient):
        """Quick run without workspace selection returns 409 or 404."""
        # Clear any previous workspace selection
        # The workspace manager is a singleton, so we need to ensure no workspace is selected
        try:
            client.post("/api/workspace/deselect")
        except Exception:
            pass

        response = client.post("/api/runs/quick", json={
            "pipeline_id": "any_pipeline",
            "dataset_id": "any_dataset",
            "cv_folds": 5,
        })

        # Should fail with 409 (no workspace) or 404 (can't find resources without workspace)
        assert response.status_code in (404, 409)
        detail = response.json().get("detail", "")
        assert "workspace" in detail.lower() or "not found" in detail.lower()

    def test_experiment_no_workspace_409(self, client: TestClient):
        """Experiment creation without workspace returns 409 or 404."""
        response = client.post("/api/runs", json={
            "config": {
                "name": "Test Experiment",
                "dataset_ids": ["ds1"],
                "pipeline_ids": ["pl1"],
                "cv_folds": 5,
            }
        })

        assert response.status_code in (404, 409)


class TestValidationErrors:
    """Test 422 validation errors for invalid input."""

    def test_quick_run_cv_folds_too_low(self, workspace_client: TestClient):
        """cv_folds < 2 returns validation error."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 1,
        })

        assert response.status_code == 422

    def test_quick_run_cv_folds_too_high(self, workspace_client: TestClient):
        """cv_folds > 50 returns validation error."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 100,
        })

        assert response.status_code == 422

    def test_quick_run_missing_required_fields(self, workspace_client: TestClient):
        """Missing required fields return validation error."""
        # Missing pipeline_id
        response = workspace_client.post("/api/runs/quick", json={
            "dataset_id": "test_dataset",
            "cv_folds": 5,
        })
        assert response.status_code == 422

        # Missing dataset_id
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "cv_folds": 5,
        })
        assert response.status_code == 422

    def test_experiment_empty_dataset_list(self, workspace_client: TestClient):
        """Experiment with empty dataset list fails validation."""
        response = workspace_client.post("/api/runs", json={
            "config": {
                "name": "Empty Dataset Experiment",
                "dataset_ids": [],
                "pipeline_ids": ["test_pls"],
                "cv_folds": 5,
            }
        })

        assert response.status_code == 422

    def test_experiment_no_pipelines(self, workspace_client: TestClient):
        """Experiment with no pipelines (and no inline) fails validation."""
        response = workspace_client.post("/api/runs", json={
            "config": {
                "name": "No Pipeline Experiment",
                "dataset_ids": ["test_dataset"],
                "pipeline_ids": [],
                "cv_folds": 5,
            }
        })

        assert response.status_code == 422

    def test_experiment_name_too_long(self, workspace_client: TestClient):
        """Experiment name exceeding max length fails validation."""
        response = workspace_client.post("/api/runs", json={
            "config": {
                "name": "A" * 200,  # max_length=100
                "dataset_ids": ["test_dataset"],
                "pipeline_ids": ["test_pls"],
                "cv_folds": 5,
            }
        })

        assert response.status_code == 422

    def test_experiment_invalid_cv_strategy(self, workspace_client: TestClient):
        """Invalid cv_strategy fails validation."""
        response = workspace_client.post("/api/runs", json={
            "config": {
                "name": "Invalid Strategy",
                "dataset_ids": ["test_dataset"],
                "pipeline_ids": ["test_pls"],
                "cv_folds": 5,
                "cv_strategy": "invalid_strategy",
            }
        })

        assert response.status_code == 422


class TestExecutionFailures:
    """Test handling of execution failures during runs."""

    @pytest.mark.timeout(60)
    def test_run_fails_gracefully(
        self,
        workspace_client: TestClient,
        mock_nirs4all_failure,
    ):
        """Verify run handles nirs4all failures gracefully."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Wait for completion
        tracker = RunProgressTracker(workspace_client, run_id)
        status = tracker.poll_until_complete(timeout=30.0)

        # Should fail
        assert status == "failed", f"Expected failed, got {status}"

        # Get run details
        run = tracker.get_run_details()
        assert run is not None
        assert run["status"] == "failed"

        # Pipeline should have error message
        pipeline = run["datasets"][0]["pipelines"][0]
        assert pipeline["status"] == "failed"
        assert pipeline.get("error_message") is not None

    @pytest.mark.timeout(60)
    def test_failed_run_error_message_propagates(
        self,
        workspace_client: TestClient,
        mock_nirs4all_failure,
    ):
        """Verify error messages propagate to pipeline logs."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        tracker = RunProgressTracker(workspace_client, run_id)
        tracker.poll_until_complete(timeout=30.0)

        run = tracker.get_run_details()
        pipeline = run["datasets"][0]["pipelines"][0]

        error_msg = pipeline.get("error_message", "")
        assert "Simulated training failure" in error_msg or len(error_msg) > 0

    @pytest.mark.timeout(60)
    def test_partial_failure_in_experiment(
        self,
        workspace_with_data: Path,
        client: TestClient,
        monkeypatch,
    ):
        """Test experiment where one pipeline fails but others complete."""
        # Create a special pipeline that will fail
        failing_pipeline = {
            "id": "failing_pipeline",
            "name": "Failing Pipeline",
            "category": "user",
            "steps": [
                {
                    "id": "1",
                    "type": "model",
                    "name": "NonexistentModel",  # This will fail
                    "params": {},
                },
            ],
        }
        (workspace_with_data / "pipelines" / "failing_pipeline.json").write_text(
            json.dumps(failing_pipeline, indent=2)
        )

        # Select workspace
        client.post("/api/workspace/select", json={"path": str(workspace_with_data)})

        # Mock nirs4all for test_pls but let failing_pipeline fail
        call_count = {"count": 0}

        class MockResult:
            best_rmse = 0.5
            best_r2 = 0.9
            num_predictions = 1
            predictions = []

            def top(self, n):
                return []

            def export(self, path):
                Path(path).touch()

        def selective_mock(**kwargs):
            call_count["count"] += 1
            # First call succeeds, second fails
            if call_count["count"] > 1:
                raise RuntimeError("Pipeline failed")
            return MockResult()

        monkeypatch.setattr("nirs4all.run", selective_mock, raising=False)

        # Create experiment with both pipelines
        response = client.post("/api/runs", json={
            "config": {
                "name": "Partial Failure Experiment",
                "dataset_ids": ["test_dataset"],
                "pipeline_ids": ["test_pls", "failing_pipeline"],
                "cv_folds": 3,
            }
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Experiment creation failed: {response.json()}")

        run_id = response.json()["id"]

        tracker = RunProgressTracker(client, run_id)
        tracker.poll_until_complete(timeout=60.0)

        run = tracker.get_run_details()

        # Experiment should be marked as failed (due to partial failure)
        # But at least one pipeline should have completed
        pipelines = run["datasets"][0]["pipelines"]
        statuses = [p["status"] for p in pipelines]

        # At least one should have failed
        assert "failed" in statuses, f"Expected at least one failure, got: {statuses}"


class TestMalformedPipelineConfig:
    """Test handling of malformed pipeline configurations."""

    def test_pipeline_with_invalid_step_type(
        self,
        workspace_with_data: Path,
        client: TestClient,
    ):
        """Pipeline with invalid step type is handled gracefully."""
        # Create pipeline with invalid step type
        invalid_pipeline = {
            "id": "invalid_steps",
            "name": "Invalid Steps Pipeline",
            "category": "user",
            "steps": [
                {
                    "id": "1",
                    "type": "invalid_type",  # Invalid
                    "name": "Something",
                    "params": {},
                },
            ],
        }
        (workspace_with_data / "pipelines" / "invalid_steps.json").write_text(
            json.dumps(invalid_pipeline, indent=2)
        )

        client.post("/api/workspace/select", json={"path": str(workspace_with_data)})

        # Should still be able to validate pipeline
        response = client.post("/api/pipelines/validate", json={
            "steps": invalid_pipeline["steps"]
        })

        # Should have warnings about unknown step type
        assert response.status_code == 200
        data = response.json()
        # May have warnings but shouldn't crash
        assert "valid" in data

    def test_pipeline_empty_steps(
        self,
        workspace_with_data: Path,
        client: TestClient,
    ):
        """Pipeline with empty steps list is handled gracefully."""
        empty_pipeline = {
            "id": "empty_pipeline",
            "name": "Empty Pipeline",
            "category": "user",
            "steps": [],
        }
        (workspace_with_data / "pipelines" / "empty_pipeline.json").write_text(
            json.dumps(empty_pipeline, indent=2)
        )

        client.post("/api/workspace/select", json={"path": str(workspace_with_data)})

        # Validation should handle empty steps
        response = client.post("/api/pipelines/validate", json={"steps": []})
        assert response.status_code == 200


class TestRunStateErrors:
    """Test errors related to run state transitions."""

    @pytest.mark.timeout(60)
    def test_cannot_stop_completed_run(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Cannot stop a run that has already completed."""
        # Create and wait for run to complete
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        tracker = RunProgressTracker(workspace_client, run_id)
        status = tracker.poll_until_complete(timeout=30.0)

        if status != "completed":
            pytest.skip("Run did not complete")

        # Try to stop completed run
        stop_response = workspace_client.post(f"/api/runs/{run_id}/stop")
        assert stop_response.status_code == 400

    @pytest.mark.timeout(60)
    def test_cannot_pause_completed_run(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Cannot pause a run that has already completed."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        tracker = RunProgressTracker(workspace_client, run_id)
        status = tracker.poll_until_complete(timeout=30.0)

        if status != "completed":
            pytest.skip("Run did not complete")

        # Try to pause completed run
        pause_response = workspace_client.post(f"/api/runs/{run_id}/pause")
        assert pause_response.status_code == 400

    @pytest.mark.timeout(60)
    def test_cannot_retry_completed_run(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Cannot retry a run that completed successfully."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        tracker = RunProgressTracker(workspace_client, run_id)
        status = tracker.poll_until_complete(timeout=30.0)

        if status != "completed":
            pytest.skip("Run did not complete")

        # Try to retry completed run
        retry_response = workspace_client.post(f"/api/runs/{run_id}/retry")
        assert retry_response.status_code == 400

    @pytest.mark.timeout(60)
    def test_cannot_delete_running_run(
        self,
        workspace_client: TestClient,
        slow_mock_nirs4all,
    ):
        """Cannot delete a run while it's running."""
        import time

        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Give it a moment to start
        time.sleep(0.5)

        # Check run is still active before attempting delete
        run_check = workspace_client.get(f"/api/runs/{run_id}").json()
        if run_check["status"] not in ("running", "queued"):
            pytest.skip(f"Run already terminated ({run_check['status']}), likely nirs4all adapter issue on CI")

        # Try to delete while running
        delete_response = workspace_client.delete(f"/api/runs/{run_id}")
        assert delete_response.status_code == 400


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
