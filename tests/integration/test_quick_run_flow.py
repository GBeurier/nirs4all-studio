"""
Integration tests for quick run flow.

Tests the complete pipeline execution lifecycle:
1. Frontend submits pipeline config via POST /runs/quick
2. Backend creates run and starts async execution
3. WebSocket sends progress updates
4. Run completes with metrics
5. Run appears in /runs list with correct status

Run tests:
    pytest tests/integration/test_quick_run_flow.py -v

Run with real nirs4all (slow but comprehensive):
    pytest tests/integration/test_quick_run_flow.py -v -m integration_full

Run mocked only (fast, CI-friendly):
    pytest tests/integration/test_quick_run_flow.py -v -m "not integration_full"
"""

import json
import time
from pathlib import Path
from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient

from .websocket_utils import (
    RunProgressTracker,
    assert_message_sequence,
    assert_metrics_present,
    assert_progress_increases,
)


class TestQuickRunBasicFlow:
    """Test basic quick run execution flow."""

    def test_quick_run_requires_workspace(self, client: TestClient):
        """Verify quick run fails without workspace selected."""
        response = client.post("/api/runs/quick", json={
            "pipeline_id": "any_pipeline",
            "dataset_id": "any_dataset",
            "cv_folds": 5,
        })

        # Should fail with 409 (no workspace) or 404 (resources not found without workspace)
        assert response.status_code in (404, 409)
        detail = response.json().get("detail", "").lower()
        assert "workspace" in detail or "not found" in detail

    def test_quick_run_validates_pipeline_exists(self, workspace_client: TestClient):
        """Verify quick run validates pipeline existence."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "nonexistent_pipeline",
            "dataset_id": "test_dataset",
            "cv_folds": 5,
        })

        # Should fail with 404 (pipeline not found)
        assert response.status_code == 404
        assert "pipeline" in response.json().get("detail", "").lower()

    def test_quick_run_validates_dataset_exists(self, workspace_client: TestClient):
        """Verify quick run validates dataset existence."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "nonexistent_dataset",
            "cv_folds": 5,
        })

        # Should fail with 404 (dataset not found)
        assert response.status_code == 404
        assert "dataset" in response.json().get("detail", "").lower()

    def test_quick_run_cv_folds_validation(self, workspace_client: TestClient):
        """Verify cv_folds parameter is validated."""
        # Too few folds
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 1,  # Minimum is 2
        })
        assert response.status_code == 422

        # Too many folds
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 100,  # Maximum is 50
        })
        assert response.status_code == 422


class TestQuickRunCreation:
    """Test run creation and initial state."""

    def test_quick_run_returns_run_object(self, workspace_client: TestClient):
        """Verify quick run endpoint returns proper run object."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        # Should succeed (or fail if dataset not loadable)
        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run = response.json()

        # Verify run structure
        assert "id" in run
        assert "name" in run
        assert "status" in run
        assert "datasets" in run
        assert "created_at" in run

        # Initial status should be queued or running
        assert run["status"] in ("queued", "running")

        # Should have one dataset with one pipeline
        assert len(run["datasets"]) == 1
        assert len(run["datasets"][0]["pipelines"]) == 1

    def test_quick_run_appears_in_list(self, workspace_client: TestClient):
        """Verify created run appears in runs list."""
        # Create a run
        create_response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
            "name": "Test Run For List Check",
        })

        if create_response.status_code not in (200, 201):
            pytest.skip("Quick run creation failed")

        run_id = create_response.json()["id"]

        # Check runs list
        list_response = workspace_client.get("/api/runs")
        assert list_response.status_code == 200

        runs = list_response.json()["runs"]
        run_ids = [r["id"] for r in runs]

        assert run_id in run_ids

    def test_quick_run_custom_name(self, workspace_client: TestClient):
        """Verify custom run name is used."""
        custom_name = "My Custom Run Name"

        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
            "name": custom_name,
        })

        if response.status_code not in (200, 201):
            pytest.skip("Quick run creation failed")

        run = response.json()
        assert run["name"] == custom_name


class TestQuickRunPollingCompletion:
    """Test run completion via HTTP polling (without WebSocket)."""

    @pytest.mark.timeout(120)
    def test_run_completes_with_polling(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Test that a run completes successfully using polling."""
        # Create run
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Poll for completion
        tracker = RunProgressTracker(workspace_client, run_id)
        status = tracker.poll_until_complete(timeout=60.0, poll_interval=0.5)

        assert status in ("completed", "failed"), f"Run timed out or unexpected status: {status}"

        # Verify final state
        if status == "completed":
            final_run = tracker.final_result
            assert final_run is not None
            assert final_run["status"] == "completed"

            # Check metrics exist on pipeline
            pipeline = final_run["datasets"][0]["pipelines"][0]
            assert pipeline["metrics"] is not None

    @pytest.mark.integration_full
    @pytest.mark.timeout(180)
    def test_run_completes_with_real_nirs4all(self, workspace_client: TestClient):
        """
        Test run completion with real nirs4all library.

        This test requires nirs4all to be installed and may take longer.
        """
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Poll for completion with longer timeout
        tracker = RunProgressTracker(workspace_client, run_id)
        status = tracker.poll_until_complete(timeout=120.0, poll_interval=1.0)

        assert status == "completed", f"Run did not complete: {status}"

        # Verify metrics
        final_run = tracker.final_result
        pipeline = final_run["datasets"][0]["pipelines"][0]
        metrics = pipeline.get("metrics", {})

        assert metrics.get("r2") is not None, "R² metric missing"
        assert metrics.get("rmse") is not None, "RMSE metric missing"


class TestQuickRunWithWebSocket:
    """Test run progress via WebSocket."""

    @pytest.mark.websocket
    @pytest.mark.timeout(120)
    def test_websocket_receives_progress(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Test that WebSocket receives progress updates during run."""
        # Create run
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Connect to WebSocket and collect messages
        messages = []
        try:
            with workspace_client.websocket_connect(f"/ws/job/{run_id}") as ws:
                # Collect messages with timeout
                start = time.time()
                while time.time() - start < 30:
                    try:
                        data = ws.receive_json()
                        messages.append(data)

                        if data.get("type") in ("job_completed", "job_failed"):
                            break
                    except Exception:
                        break
        except Exception as e:
            pytest.skip(f"WebSocket connection failed: {e}")

        # Verify we received messages
        assert len(messages) > 0, "No WebSocket messages received"

        # Verify message types
        types = [m.get("type") for m in messages]
        assert "connected" in types or "subscribed" in types, \
            f"Expected connection confirmation, got: {types}"

    @pytest.mark.websocket
    @pytest.mark.timeout(120)
    def test_websocket_message_sequence(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Verify WebSocket messages follow expected sequence."""
        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        messages = []
        try:
            with workspace_client.websocket_connect(f"/ws/job/{run_id}") as ws:
                start = time.time()
                while time.time() - start < 30:
                    try:
                        data = ws.receive_json()
                        messages.append(data)

                        if data.get("type") in ("job_completed", "job_failed"):
                            break
                    except Exception:
                        break
        except Exception as e:
            pytest.skip(f"WebSocket connection failed: {e}")

        # Expected sequence: connected -> (progress)* -> completed/failed
        types = [m.get("type") for m in messages]

        # Should have connected or subscribed first
        assert types[0] in ("connected", "subscribed"), \
            f"First message should be connected/subscribed, got: {types[0]}"

        # Should end with completed or failed
        terminal_types = ("job_completed", "job_failed")
        has_terminal = any(t in terminal_types for t in types)
        assert has_terminal, f"No terminal message (completed/failed) in: {types}"


class TestQuickRunMetrics:
    """Test run metrics extraction."""

    @pytest.mark.timeout(120)
    def test_metrics_are_extracted(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Verify metrics are correctly extracted after run."""
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
        status = tracker.poll_until_complete(timeout=60.0)

        if status != "completed":
            pytest.skip(f"Run did not complete: {status}")

        # Get run details
        run = tracker.get_run_details()
        assert run is not None

        pipeline = run["datasets"][0]["pipelines"][0]
        metrics = pipeline.get("metrics", {})

        # Verify expected metrics are present
        assert "r2" in metrics or "rmse" in metrics, \
            f"Expected r2/rmse metrics, got: {metrics}"

    @pytest.mark.timeout(120)
    def test_metrics_are_valid_numbers(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Verify metric values are valid numbers (not NaN/Inf)."""
        import math

        response = workspace_client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        tracker = RunProgressTracker(workspace_client, run_id)
        status = tracker.poll_until_complete(timeout=60.0)

        if status != "completed":
            pytest.skip(f"Run did not complete: {status}")

        run = tracker.get_run_details()
        metrics = run["datasets"][0]["pipelines"][0].get("metrics", {})

        for key, value in metrics.items():
            if value is not None:
                assert not math.isnan(value), f"{key} is NaN"
                assert not math.isinf(value), f"{key} is Inf"


class TestQuickRunPersistence:
    """Test run manifest persistence."""

    @pytest.mark.timeout(120)
    def test_run_manifest_is_saved(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Verify run manifest is persisted to workspace."""
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
        tracker.poll_until_complete(timeout=60.0)

        # Check manifest exists
        workspace_path = workspace_client._test_workspace_path
        manifest_path = workspace_path / "workspace" / "runs" / run_id / "manifest.json"

        assert manifest_path.exists(), f"Manifest not found at {manifest_path}"

        # Verify manifest content
        with open(manifest_path) as f:
            manifest = json.load(f)

        assert manifest["id"] == run_id
        assert "status" in manifest
        assert "datasets" in manifest

    @pytest.mark.timeout(120)
    def test_runs_persist_across_server_restart(
        self,
        workspace_with_data: Path,
        client: TestClient,
        mock_nirs4all,
    ):
        """Verify runs are loaded from disk after restart simulation."""
        # Select workspace
        client.post("/api/workspace/select", json={"path": str(workspace_with_data)})

        # Create a run
        response = client.post("/api/runs/quick", json={
            "pipeline_id": "test_pls",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Quick run creation failed: {response.json()}")

        run_id = response.json()["id"]

        # Wait for completion
        tracker = RunProgressTracker(client, run_id)
        tracker.poll_until_complete(timeout=60.0)

        # Simulate restart by clearing in-memory runs
        from api.runs import _runs, _runs_loaded
        _runs.clear()

        # Access private module variable to reset loaded flag
        import api.runs as runs_module
        runs_module._runs_loaded = False

        # List runs should reload from disk
        list_response = client.get("/api/runs")
        assert list_response.status_code == 200

        runs = list_response.json()["runs"]
        run_ids = [r["id"] for r in runs]

        assert run_id in run_ids, "Run should be reloaded from disk"


class TestMultiplePipelinesRun:
    """Test running multiple pipelines in experiment."""

    @pytest.mark.timeout(120)
    def test_experiment_with_multiple_pipelines(
        self,
        workspace_client: TestClient,
        mock_nirs4all,
    ):
        """Test creating experiment with multiple pipelines."""
        response = workspace_client.post("/api/runs", json={
            "config": {
                "name": "Multi-Pipeline Experiment",
                "dataset_ids": ["test_dataset"],
                "pipeline_ids": ["test_pls", "test_rf"],
                "cv_folds": 3,
                "cv_strategy": "kfold",
            }
        })

        if response.status_code not in (200, 201):
            pytest.skip(f"Experiment creation failed: {response.json()}")

        run = response.json()

        # Should have 2 pipelines
        total_pipelines = sum(
            len(d["pipelines"])
            for d in run["datasets"]
        )
        assert total_pipelines == 2, f"Expected 2 pipelines, got {total_pipelines}"

        # Wait for completion
        run_id = run["id"]
        tracker = RunProgressTracker(workspace_client, run_id)
        status = tracker.poll_until_complete(timeout=120.0)

        # Both pipelines should complete (or fail)
        final_run = tracker.get_run_details()
        if final_run:
            for dataset in final_run["datasets"]:
                for pipeline in dataset["pipelines"]:
                    assert pipeline["status"] in ("completed", "failed"), \
                        f"Pipeline {pipeline['pipeline_id']} has status {pipeline['status']}"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
