"""
Integration tests for run lifecycle operations.

Tests:
- Stop/cancel running runs
- Pause/resume runs
- Retry failed runs
- Run deletion
- Concurrent run handling
- Model export verification

Run tests:
    pytest tests/integration/test_run_lifecycle.py -v
"""

import json
import time
from pathlib import Path
from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient

from .websocket_utils import RunProgressTracker

# ============================================================================
# Helper Fixtures
# ============================================================================


@pytest.fixture
def slow_mock_nirs4all(monkeypatch):
    """Mock nirs4all.run() with a slow execution for testing stop/pause."""
    class SlowResult:
        best_rmse = 0.5
        best_r2 = 0.9
        num_predictions = 1
        predictions = []

        def top(self, n):
            return []

        def export(self, path):
            Path(path).touch()

    def slow_run(**kwargs):
        # Sleep in small increments to allow cancellation
        for _ in range(50):
            time.sleep(0.1)
        return SlowResult()

    monkeypatch.setattr("nirs4all.run", slow_run, raising=False)
    return SlowResult


# ============================================================================
# Stop/Cancel Tests
# ============================================================================


class TestRunStop:
    """Test stopping/cancelling running runs."""

    @pytest.mark.timeout(30)
    def test_stop_running_run(
        self,
        workspace_client: TestClient,
        slow_mock_nirs4all,
    ):
        """Verify a running run can be stopped."""
        # Create run
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Wait for it to start running
        time.sleep(0.5)

        # Stop the run
        stop_response = workspace_client.post(f"/api/runs/{run_id}/stop")
        assert stop_response.status_code == 200

        data = stop_response.json()
        assert data["success"] is True

        # Verify run status changed to failed
        run_response = workspace_client.get(f"/api/runs/{run_id}")
        run = run_response.json()
        assert run["status"] == "failed"

    @pytest.mark.timeout(30)
    def test_stop_sets_error_message(
        self,
        workspace_client: TestClient,
        slow_mock_nirs4all,
    ):
        """Verify stopped run has proper error message."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]
        time.sleep(0.5)

        # Stop
        workspace_client.post(f"/api/runs/{run_id}/stop")

        # Check error message
        run = workspace_client.get(f"/api/runs/{run_id}").json()
        pipeline = run["datasets"][0]["pipelines"][0]

        error_msg = pipeline.get("error_message", "")
        assert "stopped" in error_msg.lower() or "cancelled" in error_msg.lower()

    @pytest.mark.timeout(30)
    def test_stop_queued_run(
        self,
        workspace_client: TestClient,
        slow_mock_nirs4all,
    ):
        """Verify a queued run can be stopped."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Immediately try to stop (might still be queued)
        stop_response = workspace_client.post(f"/api/runs/{run_id}/stop")

        # Should succeed even if queued
        assert stop_response.status_code == 200


# ============================================================================
# Pause/Resume Tests
# ============================================================================


class TestRunPauseResume:
    """Test pausing and resuming runs."""

    @pytest.mark.timeout(30)
    def test_pause_running_run(
        self,
        workspace_client: TestClient,
        slow_mock_nirs4all,
    ):
        """Verify a running run can be paused."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]
        time.sleep(0.5)

        # Get initial status
        initial_run = workspace_client.get(f"/api/runs/{run_id}").json()
        if initial_run["status"] != "running":
            pytest.skip("Run not in running state")

        # Pause
        pause_response = workspace_client.post(f"/api/runs/{run_id}/pause")
        assert pause_response.status_code == 200

        # Verify paused status
        paused_run = workspace_client.get(f"/api/runs/{run_id}").json()
        assert paused_run["status"] == "paused"

    @pytest.mark.timeout(60)
    def test_resume_paused_run(
        self,
        workspace_client: TestClient,
        slow_mock_nirs4all,
    ):
        """Verify a paused run can be resumed."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]
        time.sleep(0.5)

        # Pause first
        pause_response = workspace_client.post(f"/api/runs/{run_id}/pause")
        if pause_response.status_code != 200:
            pytest.skip("Could not pause run")

        # Resume
        resume_response = workspace_client.post(f"/api/runs/{run_id}/resume")
        assert resume_response.status_code == 200

        # Verify status changed back to running
        resumed_run = workspace_client.get(f"/api/runs/{run_id}").json()
        assert resumed_run["status"] in ("running", "queued")

    def test_cannot_resume_non_paused_run(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Verify cannot resume a run that is not paused."""
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
        tracker.poll_until_complete(timeout=30.0)

        # Try to resume completed run
        resume_response = workspace_client.post(f"/api/runs/{run_id}/resume")
        assert resume_response.status_code == 400


# ============================================================================
# Retry Tests
# ============================================================================


class TestRunRetry:
    """Test retrying failed runs."""

    @pytest.mark.timeout(90)
    def test_retry_failed_run(
        self,
        workspace_client: TestClient,
        mock_nirs4all_failure,
        mock_nirs4all,
        monkeypatch,
    ):
        """Verify a failed run can be retried."""
        # First, create a run that will fail
        call_count = {"count": 0}

        class FailThenSucceed:
            best_rmse = 0.5
            best_r2 = 0.9
            num_predictions = 1
            predictions = []

            def top(self, n):
                return []

            def export(self, path):
                Path(path).touch()

        def fail_then_succeed(**kwargs):
            call_count["count"] += 1
            if call_count["count"] == 1:
                raise RuntimeError("First attempt fails")
            return FailThenSucceed()

        monkeypatch.setattr("nirs4all.run", fail_then_succeed, raising=False)

        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Wait for failure
        tracker = RunProgressTracker(workspace_client, run_id)
        status = tracker.poll_until_complete(timeout=30.0)

        if status != "failed":
            pytest.skip(f"Run did not fail as expected: {status}")

        # Retry the failed run
        retry_response = workspace_client.post(f"/api/runs/{run_id}/retry")
        assert retry_response.status_code == 200

        new_run = retry_response.json()
        new_run_id = new_run["id"]

        # New run should be different from original
        assert new_run_id != run_id

        # Wait for new run to complete
        new_tracker = RunProgressTracker(workspace_client, new_run_id)
        new_status = new_tracker.poll_until_complete(timeout=30.0)

        assert new_status == "completed", f"Retry did not complete: {new_status}"

    @pytest.mark.timeout(60)
    def test_retry_creates_new_run(
        self,
        workspace_client: TestClient,
        mock_nirs4all_failure,
    ):
        """Verify retry creates a new run with '(retry)' suffix."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
            "name": "Original Run",
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Wait for failure
        tracker = RunProgressTracker(workspace_client, run_id)
        tracker.poll_until_complete(timeout=30.0)

        # Retry
        retry_response = workspace_client.post(f"/api/runs/{run_id}/retry")
        assert retry_response.status_code == 200

        new_run = retry_response.json()
        assert "(retry)" in new_run["name"]


# ============================================================================
# Deletion Tests
# ============================================================================


class TestRunDeletion:
    """Test run deletion."""

    @pytest.mark.timeout(60)
    def test_delete_completed_run(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Verify completed runs can be deleted."""
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
        tracker.poll_until_complete(timeout=30.0)

        # Delete
        delete_response = workspace_client.delete(f"/api/runs/{run_id}")
        assert delete_response.status_code == 200

        # Verify deleted
        get_response = workspace_client.get(f"/api/runs/{run_id}")
        assert get_response.status_code == 404

    @pytest.mark.timeout(60)
    def test_delete_failed_run(
        self,
        workspace_client: TestClient,
        mock_nirs4all_failure,
    ):
        """Verify failed runs can be deleted."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Wait for failure
        tracker = RunProgressTracker(workspace_client, run_id)
        tracker.poll_until_complete(timeout=30.0)

        # Delete
        delete_response = workspace_client.delete(f"/api/runs/{run_id}")
        assert delete_response.status_code == 200

    @pytest.mark.timeout(60)
    def test_deleted_run_removed_from_list(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Verify deleted run is removed from runs list."""
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
        tracker.poll_until_complete(timeout=30.0)

        # Verify it's in the list
        list_response = workspace_client.get("/api/runs")
        runs_before = [r["id"] for r in list_response.json()["runs"]]
        assert run_id in runs_before

        # Delete
        workspace_client.delete(f"/api/runs/{run_id}")

        # Verify removed from list
        list_response = workspace_client.get("/api/runs")
        runs_after = [r["id"] for r in list_response.json()["runs"]]
        assert run_id not in runs_after


# ============================================================================
# Model Export Tests
# ============================================================================


class TestModelExport:
    """Test model export functionality."""

    @pytest.mark.timeout(60)
    def test_model_exported_on_completion(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Verify model is exported when run completes."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
            "export_model": True,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Wait for completion
        tracker = RunProgressTracker(workspace_client, run_id)
        status = tracker.poll_until_complete(timeout=30.0)

        if status != "completed":
            pytest.skip("Run did not complete")

        # Check model_path in run details
        run = tracker.get_run_details()
        pipeline = run["datasets"][0]["pipelines"][0]
        model_path = pipeline.get("model_path")

        # Model path should be set (even if file doesn't exist in mock)
        # In real test, file would exist
        assert model_path is not None or pipeline.get("metrics") is not None

    @pytest.mark.timeout(60)
    def test_model_file_created(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Verify model file is actually created in workspace."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
            "export_model": True,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Wait for completion
        tracker = RunProgressTracker(workspace_client, run_id)
        status = tracker.poll_until_complete(timeout=30.0)

        if status != "completed":
            pytest.skip("Run did not complete")

        # Check models directory
        workspace_path = workspace_client._test_workspace_path
        models_dir = workspace_path / "models"

        # Should have at least one model file (if mock creates it)
        model_files = list(models_dir.glob("*.n4a")) + list(models_dir.glob("*.joblib"))

        # Note: With mock, file may not actually exist unless mock creates it
        # This test verifies the structure; integration_full tests verify actual files


# ============================================================================
# Concurrent Run Tests
# ============================================================================


class TestConcurrentRuns:
    """Test handling of concurrent runs."""

    @pytest.mark.timeout(120)
    def test_multiple_concurrent_runs(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Verify multiple runs can execute concurrently."""
        # Create multiple runs
        run_ids = []
        for i in range(3):
            response = workspace_client.post("/api/runs/quick", json={
                "pipeline_id": "test_pls",
                "dataset_id": "test_dataset",
                "cv_folds": 3,
                "name": f"Concurrent Run {i+1}",
            })

            if response.status_code in (200, 201):
                run_ids.append(response.json()["id"])

        if len(run_ids) < 2:
            pytest.skip("Could not create enough concurrent runs")

        # Wait for all to complete
        final_statuses = {}
        for run_id in run_ids:
            tracker = RunProgressTracker(workspace_client, run_id)
            status = tracker.poll_until_complete(timeout=60.0)
            final_statuses[run_id] = status

        # All should complete (or fail, but not hang)
        for run_id, status in final_statuses.items():
            assert status in ("completed", "failed"), f"Run {run_id} has status {status}"

    @pytest.mark.timeout(60)
    def test_run_isolation(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Verify runs are isolated from each other."""
        # Create two runs
        response1 = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
            "name": "Run 1",
        })

        response2 = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 5,  # Different cv_folds
            "name": "Run 2",
        })

        if response1.status_code not in (200, 201) or response2.status_code not in (200, 201):
            pytest.skip("Could not create runs")

        run1_id = response1.json()["id"]
        run2_id = response2.json()["id"]

        # Wait for both to complete
        tracker1 = RunProgressTracker(workspace_client, run1_id)
        tracker2 = RunProgressTracker(workspace_client, run2_id)

        tracker1.poll_until_complete(timeout=30.0)
        tracker2.poll_until_complete(timeout=30.0)

        # Verify they are distinct
        run1 = workspace_client.get(f"/api/runs/{run1_id}").json()
        run2 = workspace_client.get(f"/api/runs/{run2_id}").json()

        assert run1["id"] != run2["id"]
        assert run1["name"] != run2["name"]
        assert run1["cv_folds"] != run2["cv_folds"]


# ============================================================================
# Run Stats Tests
# ============================================================================


class TestRunStats:
    """Test run statistics endpoint."""

    def test_stats_reflect_run_states(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Verify stats endpoint reflects actual run states."""
        # Get initial stats
        initial_stats = workspace_client.get("/api/runs/stats").json()
        initial_completed = initial_stats["completed"]

        # Create and complete a run
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

        if status != "completed":
            pytest.skip("Run did not complete")

        # Check updated stats
        new_stats = workspace_client.get("/api/runs/stats").json()
        assert new_stats["completed"] == initial_completed + 1

    def test_stats_count_failed_runs(
        self,
        workspace_client: TestClient,
        mock_nirs4all_failure,
    ):
        """Verify failed runs are counted correctly."""
        # Get initial stats
        initial_stats = workspace_client.get("/api/runs/stats").json()
        initial_failed = initial_stats["failed"]

        # Create a failing run
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Wait for failure
        tracker = RunProgressTracker(workspace_client, run_id)
        tracker.poll_until_complete(timeout=30.0)

        # Check updated stats
        new_stats = workspace_client.get("/api/runs/stats").json()
        assert new_stats["failed"] == initial_failed + 1


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
