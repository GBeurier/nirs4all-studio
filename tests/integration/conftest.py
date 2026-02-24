"""
Integration test fixtures for nirs4all webapp.

Provides fixtures for:
- Temporary workspace with proper directory structure
- Sample datasets (synthetic or copied)
- Sample pipeline configurations
- Pre-configured test client with workspace selected
- WebSocket testing utilities
- Mock nirs4all for fast CI testing
"""

import asyncio
import json
import shutil
import sys
import time
import uuid
from collections.abc import Generator
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from main import app

# ============================================================================
# Core Fixtures
# ============================================================================


@pytest.fixture
def client(tmp_path: Path) -> Generator[TestClient, None, None]:
    """Create a test client for the FastAPI app with isolated config."""
    import os
    config_dir = tmp_path / "app_config"
    config_dir.mkdir()
    old_env = os.environ.get("NIRS4ALL_CONFIG")
    os.environ["NIRS4ALL_CONFIG"] = str(config_dir)
    try:
        # Re-initialize singletons with temporary config dir
        from api.app_config import AppConfigManager, app_config
        app_config.__init__()
        from api.workspace_manager import workspace_manager
        workspace_manager.app_config = app_config
        workspace_manager.app_data_dir = app_config.config_dir
        with TestClient(app) as c:
            yield c
    finally:
        if old_env is None:
            os.environ.pop("NIRS4ALL_CONFIG", None)
        else:
            os.environ["NIRS4ALL_CONFIG"] = old_env


@pytest.fixture
def test_workspace(tmp_path: Path) -> Path:
    """
    Create a temporary workspace with proper directory structure.

    Structure:
        test_workspace/
        ├── pipelines/          # Saved pipelines
        ├── workspace/
        │   └── runs/           # Run manifests
        ├── models/             # Exported models
        └── datasets/           # Test datasets (CSV)
    """
    workspace_dir = tmp_path / "test_workspace"
    workspace_dir.mkdir()

    # Create required subdirectories
    (workspace_dir / "pipelines").mkdir()
    (workspace_dir / "workspace" / "runs").mkdir(parents=True)
    (workspace_dir / "models").mkdir()
    (workspace_dir / "datasets").mkdir()

    return workspace_dir


@pytest.fixture
def workspace_with_data(test_workspace: Path) -> Path:
    """
    Create a workspace with sample dataset and pipeline.

    Returns workspace path with:
    - test_dataset.csv: Simple regression dataset
    - test_pls.json: Basic PLS pipeline
    """
    # Create sample dataset (separate X and Y files)
    datasets_dir = test_workspace / "datasets"
    dataset_path = datasets_dir / "test_dataset.csv"
    _create_sample_dataset(dataset_path, n_samples=50, n_features=100)
    dataset_y_path = datasets_dir / "test_dataset_y.csv"

    # Create workspace.json with dataset configuration
    # This is how datasets are registered in the workspace
    workspace_config = {
        "name": "Test Workspace",
        "path": str(test_workspace),
        "createdAt": datetime.now().isoformat(),
        "datasets": [
            {
                "id": "test_dataset",
                "name": "Test Dataset",
                "path": str(dataset_path),
                "addedAt": datetime.now().isoformat(),
                "config": {
                    "delimiter": ",",
                    "decimal_separator": ".",
                    "has_header": True,
                    "header_unit": "nm",
                    "signal_type": "auto",
                    "files": [
                        {
                            "path": str(dataset_path),
                            "type": "X",
                            "split": "train",
                        },
                        {
                            "path": str(dataset_y_path),
                            "type": "Y",
                            "split": "train",
                        },
                    ],
                },
            }
        ],
        "pipelines": [],
    }
    (test_workspace / "workspace.json").write_text(json.dumps(workspace_config, indent=2))

    # Create sample pipeline
    pipeline_config = {
        "id": "test_pls",
        "name": "Test PLS Pipeline",
        "description": "Integration test pipeline",
        "category": "user",
        "createdAt": datetime.now().isoformat(),
        "steps": [
            {
                "id": "step_1",
                "type": "preprocessing",
                "name": "StandardNormalVariate",
                "params": {},
            },
            {
                "id": "step_2",
                "type": "splitting",
                "name": "KFold",
                "params": {"n_splits": 3},
            },
            {
                "id": "step_3",
                "type": "model",
                "name": "PLSRegression",
                "params": {"n_components": 5},
            },
        ],
    }
    pipeline_path = test_workspace / "pipelines" / "test_pls.json"
    pipeline_path.write_text(json.dumps(pipeline_config, indent=2))

    # Create a second pipeline for multi-pipeline tests
    pipeline_rf = {
        "id": "test_rf",
        "name": "Test Random Forest",
        "description": "RF pipeline for testing",
        "category": "user",
        "createdAt": datetime.now().isoformat(),
        "steps": [
            {
                "id": "step_1",
                "type": "preprocessing",
                "name": "StandardScaler",
                "params": {},
            },
            {
                "id": "step_2",
                "type": "model",
                "name": "RandomForestRegressor",
                "params": {"n_estimators": 10, "max_depth": 3},
            },
        ],
    }
    (test_workspace / "pipelines" / "test_rf.json").write_text(json.dumps(pipeline_rf, indent=2))

    return test_workspace


def _create_sample_dataset(path: Path, n_samples: int = 50, n_features: int = 100):
    """Create separate X and Y CSV files for testing.

    Creates:
    - path: X file with numeric wavelength column headers (e.g. 1000.0, 1002.0, ...)
    - path.parent / "test_dataset_y.csv": Y file with a single "y" column

    Args:
        path: Path for the X CSV file.
        n_samples: Number of samples.
        n_features: Number of spectral features.
    """
    import numpy as np

    np.random.seed(42)

    # Generate random spectra
    X = np.random.randn(n_samples, n_features)

    # Generate target with some correlation to features
    y = X[:, 0] * 2 + X[:, 1] * 0.5 + np.random.randn(n_samples) * 0.1

    # Build X CSV with numeric wavelength headers (simulating nm values)
    wavelengths = [f"{1000 + i * 2:.1f}" for i in range(n_features)]
    x_header = ",".join(wavelengths)
    x_lines = [x_header]
    for i in range(n_samples):
        row = ",".join(f"{X[i, j]:.6f}" for j in range(n_features))
        x_lines.append(row)
    path.write_text("\n".join(x_lines))

    # Build Y CSV
    y_path = path.parent / "test_dataset_y.csv"
    y_lines = ["y"]
    for i in range(n_samples):
        y_lines.append(f"{y[i]:.6f}")
    y_path.write_text("\n".join(y_lines))


@pytest.fixture
def workspace_client(workspace_with_data: Path, client: TestClient) -> TestClient:
    """
    Create a test client with workspace already selected.

    This fixture:
    1. Creates a temporary workspace with sample data
    2. Links datasets globally (via dataset_links.json)
    3. Selects the workspace via the API
    4. Returns the client ready for testing
    """
    # Link datasets globally so the API can discover them.
    # Datasets are stored in dataset_links.json under the app config dir,
    # NOT in workspace.json. The workspace_manager reads them from app_config.
    from api.app_config import app_config

    dataset_path = workspace_with_data / "datasets" / "test_dataset.csv"
    dataset_y_path = workspace_with_data / "datasets" / "test_dataset_y.csv"
    dataset_config = {
        "delimiter": ",",
        "decimal_separator": ".",
        "has_header": True,
        "header_unit": "nm",
        "signal_type": "auto",
        "files": [
            {"path": str(dataset_path), "type": "X", "split": "train"},
            {"path": str(dataset_y_path), "type": "Y", "split": "train"},
        ],
    }
    now = datetime.now().isoformat()
    dataset_links = {
        "version": "1.0",
        "datasets": [
            {
                "id": "test_dataset",
                "name": "Test Dataset",
                "path": str(dataset_path),
                "linked_at": now,
                "hash": "",
                "version": 1,
                "version_status": "current",
                "last_verified": now,
                "config": dataset_config,
                "stats": {},
            }
        ],
        "groups": [],
        "last_updated": now,
    }
    app_config._save_dataset_links(dataset_links)

    # Select the workspace
    response = client.post(
        "/api/workspace/select",
        json={"path": str(workspace_with_data)}
    )

    # If select doesn't exist, try link
    if response.status_code == 404:
        response = client.post(
            "/api/workspace/link",
            json={"path": str(workspace_with_data), "name": "Test Workspace"}
        )

    # Store workspace path on client for access in tests
    client._test_workspace_path = workspace_with_data

    return client


# ============================================================================
# Pipeline Configuration Fixtures
# ============================================================================


@pytest.fixture
def simple_pipeline_config() -> dict[str, Any]:
    """Return a simple PLS pipeline configuration."""
    return {
        "name": "Simple PLS",
        "description": "Minimal PLS pipeline",
        "steps": [
            {
                "id": "1",
                "type": "preprocessing",
                "name": "StandardNormalVariate",
                "params": {},
            },
            {
                "id": "2",
                "type": "model",
                "name": "PLSRegression",
                "params": {"n_components": 5},
            },
        ],
    }


@pytest.fixture
def sweep_pipeline_config() -> dict[str, Any]:
    """Return a pipeline with parameter sweeps (multiple variants)."""
    return {
        "name": "PLS Sweep",
        "description": "PLS with n_components sweep",
        "steps": [
            {
                "id": "1",
                "type": "preprocessing",
                "name": "StandardNormalVariate",
                "params": {},
            },
            {
                "id": "2",
                "type": "model",
                "name": "PLSRegression",
                "params": {"n_components": 5},
                "paramSweeps": {
                    "n_components": {
                        "enabled": True,
                        "type": "range",
                        "start": 2,
                        "end": 10,
                        "step": 2,
                    }
                },
            },
        ],
    }


@pytest.fixture
def branch_pipeline_config() -> dict[str, Any]:
    """Return a pipeline with branches (parallel paths)."""
    return {
        "name": "Branching Pipeline",
        "description": "Pipeline with parallel preprocessing",
        "steps": [
            {
                "id": "1",
                "type": "branch",
                "name": "Preprocessing Branch",
                "branches": [
                    [
                        {"id": "1a", "type": "preprocessing", "name": "SNV", "params": {}},
                    ],
                    [
                        {"id": "1b", "type": "preprocessing", "name": "MSC", "params": {}},
                    ],
                ],
            },
            {
                "id": "2",
                "type": "model",
                "name": "PLSRegression",
                "params": {"n_components": 5},
            },
        ],
    }


# ============================================================================
# Mock Fixtures for Fast CI Testing
# ============================================================================


class MockNirs4allResult:
    """Mock result object mimicking nirs4all.run() output."""

    def __init__(
        self,
        best_rmse: float = 0.5,
        best_r2: float = 0.95,
        num_variants: int = 1,
    ):
        self.best_rmse = best_rmse
        self.best_r2 = best_r2
        self.best_score = best_r2
        self.num_predictions = num_variants
        self._predictions = []

    @property
    def predictions(self):
        """Mock predictions list."""
        return self._predictions

    def top(self, n: int = 3):
        """Mock top() method."""
        return self._predictions[:n]

    def export(self, path: str):
        """Mock export that creates an empty file."""
        Path(path).touch()


@pytest.fixture
def mock_nirs4all(monkeypatch):
    """
    Mock nirs4all.run() for fast testing without actual training.

    Usage:
        def test_something(mock_nirs4all, workspace_client):
            # nirs4all.run() is now mocked
            response = workspace_client.post("/api/runs/quick", ...)
    """
    mock_result = MockNirs4allResult()

    def mock_run(**kwargs):
        # Simulate some delay
        time.sleep(0.1)
        return mock_result

    # Patch at the module level where it's imported in runs.py
    monkeypatch.setattr("nirs4all.run", mock_run, raising=False)

    return mock_result


@pytest.fixture
def mock_nirs4all_failure(monkeypatch):
    """Mock nirs4all.run() to raise an exception."""

    def mock_run(**kwargs):
        raise RuntimeError("Simulated training failure")

    monkeypatch.setattr("nirs4all.run", mock_run, raising=False)


# ============================================================================
# WebSocket Testing Fixtures
# ============================================================================


@pytest.fixture
def ws_message_collector():
    """
    Factory fixture for creating WebSocket message collectors.

    Usage:
        def test_ws(workspace_client, ws_message_collector):
            with workspace_client.websocket_connect("/ws/job/123") as ws:
                collector = ws_message_collector(ws, timeout=10)
                messages = collector.collect_until("job_completed")
    """
    def _create_collector(websocket, timeout: float = 30.0):
        return WebSocketMessageCollector(websocket, timeout)
    return _create_collector


class WebSocketMessageCollector:
    """
    Utility class to collect and analyze WebSocket messages.

    Collects messages until a terminal condition or timeout.
    """

    def __init__(self, websocket, timeout: float = 30.0):
        self.websocket = websocket
        self.timeout = timeout
        self.messages: list[dict[str, Any]] = []

    def collect_until(
        self,
        terminal_types: list[str] = None,
        max_messages: int = 100,
    ) -> list[dict[str, Any]]:
        """
        Collect messages until a terminal type is received or timeout.

        Args:
            terminal_types: Message types that stop collection
                           (default: ["job_completed", "job_failed"])
            max_messages: Maximum messages to collect

        Returns:
            List of collected messages
        """
        if terminal_types is None:
            terminal_types = ["job_completed", "job_failed"]

        start_time = time.time()

        while len(self.messages) < max_messages:
            elapsed = time.time() - start_time
            if elapsed >= self.timeout:
                break

            try:
                # Use remaining timeout
                remaining = self.timeout - elapsed
                data = self.websocket.receive_json(timeout=min(remaining, 5.0))
                self.messages.append(data)

                if data.get("type") in terminal_types:
                    break

            except Exception:
                # Timeout or connection closed
                break

        return self.messages

    def get_messages_of_type(self, msg_type: str) -> list[dict[str, Any]]:
        """Filter messages by type."""
        return [m for m in self.messages if m.get("type") == msg_type]

    def get_progress_values(self) -> list[float]:
        """Extract progress values from job_progress messages."""
        progress_msgs = self.get_messages_of_type("job_progress")
        return [m.get("data", {}).get("progress", 0) for m in progress_msgs]

    def assert_message_sequence(self, expected_types: list[str]) -> bool:
        """
        Verify that messages appear in expected order.

        Doesn't require exact match, just that expected types appear
        in the specified order.
        """
        actual_types = [m.get("type") for m in self.messages]
        idx = 0
        for expected in expected_types:
            try:
                idx = actual_types.index(expected, idx) + 1
            except ValueError:
                return False
        return True


# ============================================================================
# Async Test Support
# ============================================================================


@pytest.fixture
def event_loop():
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ============================================================================
# Test Data Generators
# ============================================================================


@pytest.fixture
def generate_synthetic_dataset(test_workspace: Path):
    """
    Factory fixture to generate synthetic datasets using nirs4all.generate().

    Falls back to numpy-based generation if nirs4all is not available.
    """
    def _generate(
        name: str = "synthetic",
        n_samples: int = 50,
        n_features: int = 100,
        task: str = "regression",
    ) -> Path:
        dataset_path = test_workspace / "datasets" / f"{name}.csv"

        try:
            import nirs4all
            # Use nirs4all.generate for realistic data
            if task == "regression":
                dataset = nirs4all.generate.regression(
                    n_samples=n_samples,
                    n_features=n_features,
                )
            else:
                dataset = nirs4all.generate.classification(
                    n_samples=n_samples,
                    n_features=n_features,
                    n_classes=3,
                )
            # Export to CSV
            dataset.to_csv(str(dataset_path))

        except ImportError:
            # Fallback to simple numpy generation
            _create_sample_dataset(dataset_path, n_samples, n_features)

        return dataset_path

    return _generate


# ============================================================================
# Pytest Configuration
# ============================================================================


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers",
        "integration_full: mark test as requiring real nirs4all (slow)",
    )
    config.addinivalue_line(
        "markers",
        "websocket: mark test as involving WebSocket communication",
    )
