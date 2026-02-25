"""
Tests for DuckDB WorkspaceStore integration in webapp endpoints.

Verifies that the webapp correctly routes through the StoreAdapter
and WorkspaceScanner when a DuckDB store is available.

Run with: pytest tests/test_store_integration.py -v
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# Ensure webapp root is importable
sys.path.insert(0, str(Path(__file__).parent.parent))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_polars_df():
    """Create a minimal mock that mimics a polars DataFrame."""

    def _make(rows: list[dict[str, Any]]):
        df = MagicMock()
        df.__len__ = lambda self: len(rows)
        df.iter_rows = MagicMock(return_value=iter(rows))
        df.columns = list(rows[0].keys()) if rows else []
        return df

    return _make


@pytest.fixture()
def sample_run_rows():
    """Sample run rows as returned by WorkspaceStore.list_runs()."""
    return [
        {
            "run_id": "run-001",
            "name": "Test Run 1",
            "status": "completed",
            "created_at": datetime(2025, 1, 15, 10, 0, 0, tzinfo=UTC),
            "completed_at": datetime(2025, 1, 15, 10, 5, 0, tzinfo=UTC),
            "datasets": '["dataset_a"]',
            "summary": '{"best_rmse": 0.12}',
            "error": None,
        },
        {
            "run_id": "run-002",
            "name": "Test Run 2",
            "status": "running",
            "created_at": datetime(2025, 1, 16, 8, 0, 0, tzinfo=UTC),
            "completed_at": None,
            "datasets": '["dataset_b"]',
            "summary": "{}",
            "error": None,
        },
    ]


@pytest.fixture()
def sample_prediction_rows():
    """Sample prediction rows as returned by WorkspaceStore.query_predictions()."""
    return [
        {
            "prediction_id": "pred-001",
            "dataset_name": "dataset_a",
            "model_class": "PLSRegression",
            "model_name": "PLS(10)",
            "partition": "val",
            "val_score": 0.95,
            "test_score": 0.92,
        },
        {
            "prediction_id": "pred-002",
            "dataset_name": "dataset_a",
            "model_class": "PLSRegression",
            "model_name": "PLS(5)",
            "partition": "val",
            "val_score": 0.88,
            "test_score": 0.85,
        },
        {
            "prediction_id": "pred-003",
            "dataset_name": "dataset_b",
            "model_class": "RandomForestRegressor",
            "model_name": "RF(100)",
            "partition": "test",
            "val_score": 0.80,
            "test_score": 0.78,
        },
    ]


# ---------------------------------------------------------------------------
# StoreAdapter unit tests
# ---------------------------------------------------------------------------


class TestStoreAdapter:
    """Tests for ``StoreAdapter`` with a mocked WorkspaceStore."""

    def _make_adapter(self, mock_store):
        """Create a StoreAdapter with the given mock store."""
        with patch("api.store_adapter.STORE_AVAILABLE", True):
            from api.store_adapter import StoreAdapter
            adapter = StoreAdapter.__new__(StoreAdapter)
            adapter._store = mock_store
            return adapter

    def test_get_runs_summary(self, mock_polars_df, sample_run_rows):
        mock_store = MagicMock()
        mock_store.list_runs.return_value = mock_polars_df(sample_run_rows)

        adapter = self._make_adapter(mock_store)
        result = adapter.get_runs_summary(limit=50, offset=0)

        assert "runs" in result
        assert result["count"] == 2
        assert result["has_more"] is False
        assert result["runs"][0]["run_id"] == "run-001"
        # Datetimes should be converted to ISO strings
        assert isinstance(result["runs"][0]["created_at"], str)

    def test_get_run_detail_found(self, mock_polars_df):
        mock_store = MagicMock()
        mock_store.get_run.return_value = {
            "run_id": "run-001",
            "name": "Test Run",
            "status": "completed",
            "created_at": datetime(2025, 1, 15, tzinfo=UTC),
            "completed_at": datetime(2025, 1, 15, tzinfo=UTC),
        }
        mock_store.list_pipelines.return_value = mock_polars_df([])

        adapter = self._make_adapter(mock_store)
        result = adapter.get_run_detail("run-001")

        assert result is not None
        assert result["run_id"] == "run-001"
        assert "pipelines" in result

    def test_get_run_detail_not_found(self):
        mock_store = MagicMock()
        mock_store.get_run.return_value = None

        adapter = self._make_adapter(mock_store)
        result = adapter.get_run_detail("nonexistent")

        assert result is None

    def test_get_predictions_summary(self, mock_polars_df, sample_prediction_rows):
        mock_store = MagicMock()
        mock_store.query_predictions.return_value = mock_polars_df(sample_prediction_rows)
        mock_store.top_predictions.return_value = mock_polars_df(sample_prediction_rows[:2])

        adapter = self._make_adapter(mock_store)
        result = adapter.get_predictions_summary()

        assert result["total_predictions"] == 3
        assert len(result["models"]) == 2  # PLSRegression and RandomForestRegressor
        assert "generated_at" in result

    def test_get_predictions_page(self, mock_polars_df, sample_prediction_rows):
        mock_store = MagicMock()
        # First call: paginated page (limit=2), second call: full count
        mock_store.query_predictions.side_effect = [
            mock_polars_df(sample_prediction_rows[:2]),
            mock_polars_df(sample_prediction_rows),
        ]

        adapter = self._make_adapter(mock_store)
        result = adapter.get_predictions_page(limit=2, offset=0)

        assert len(result["records"]) == 2
        assert result["total"] == 3
        assert result["has_more"] is True

    def test_get_prediction_scatter(self):
        import numpy as np

        mock_store = MagicMock()
        mock_store.get_prediction.return_value = {
            "prediction_id": "pred-001",
            "y_true": np.array([1.0, 2.0, 3.0]),
            "y_pred": np.array([1.1, 2.1, 2.9]),
            "partition": "val",
            "model_name": "PLS(10)",
            "dataset_name": "dataset_a",
        }

        adapter = self._make_adapter(mock_store)
        result = adapter.get_prediction_scatter("pred-001")

        assert result is not None
        assert result["n_samples"] == 3
        assert len(result["y_true"]) == 3
        assert len(result["y_pred"]) == 3

    def test_get_prediction_scatter_not_found(self):
        mock_store = MagicMock()
        mock_store.get_prediction.return_value = None

        adapter = self._make_adapter(mock_store)
        result = adapter.get_prediction_scatter("nonexistent")

        assert result is None

    def test_delete_run(self):
        mock_store = MagicMock()
        mock_store.delete_run.return_value = 5

        adapter = self._make_adapter(mock_store)
        result = adapter.delete_run("run-001")

        assert result["success"] is True
        assert result["deleted_rows"] == 5
        mock_store.delete_run.assert_called_once_with("run-001", delete_artifacts=True)

    def test_context_manager_calls_close(self):
        mock_store = MagicMock()
        adapter = self._make_adapter(mock_store)

        with adapter:
            pass

        mock_store.close.assert_called_once()


# ---------------------------------------------------------------------------
# WorkspaceScanner DuckDB path tests
# ---------------------------------------------------------------------------


class TestWorkspaceScannerStore:
    """Tests for WorkspaceScanner store-first discovery paths."""

    def test_discover_runs_from_store(self, tmp_path, mock_polars_df, sample_run_rows):
        """When store.duckdb exists, discover_runs() should use the store."""
        from api.workspace_manager import WorkspaceScanner

        # Create workspace structure with a fake store.duckdb
        workspace_dir = tmp_path / "workspace"
        workspace_dir.mkdir()
        (workspace_dir / "store.duckdb").touch()

        mock_adapter = MagicMock()
        mock_adapter.store.list_runs.return_value = mock_polars_df(sample_run_rows)

        scanner = WorkspaceScanner(tmp_path)
        scanner._store_adapter = mock_adapter

        runs = scanner.discover_runs()
        assert len(runs) == 2
        assert runs[0]["id"] == "run-001"
        assert runs[0]["format"] == "store"

    def test_discover_runs_fallback_filesystem(self, tmp_path):
        """When store.duckdb doesn't exist, discover_runs() should use filesystem."""
        from api.workspace_manager import WorkspaceScanner

        workspace_dir = tmp_path / "workspace"
        workspace_dir.mkdir()
        runs_dir = workspace_dir / "runs"
        runs_dir.mkdir()
        # No store.duckdb and no manifest files

        scanner = WorkspaceScanner(tmp_path)
        runs = scanner.discover_runs()
        assert runs == []

    def test_discover_predictions_from_store(self, tmp_path, mock_polars_df, sample_prediction_rows):
        """When store.duckdb exists, discover_predictions() should use the store."""
        from api.workspace_manager import WorkspaceScanner

        workspace_dir = tmp_path / "workspace"
        workspace_dir.mkdir()
        (workspace_dir / "store.duckdb").touch()

        mock_adapter = MagicMock()
        mock_adapter.store.query_predictions.return_value = mock_polars_df(sample_prediction_rows)

        scanner = WorkspaceScanner(tmp_path)
        scanner._store_adapter = mock_adapter

        predictions = scanner.discover_predictions()
        assert len(predictions) == 2  # grouped by dataset: dataset_a and dataset_b
        datasets = {p["dataset"] for p in predictions}
        assert datasets == {"dataset_a", "dataset_b"}

    def test_discover_results_from_store(self, tmp_path, mock_polars_df):
        """When store.duckdb exists, discover_results() should use the store."""
        from api.workspace_manager import WorkspaceScanner

        workspace_dir = tmp_path / "workspace"
        workspace_dir.mkdir()
        (workspace_dir / "store.duckdb").touch()

        pipeline_rows = [
            {
                "pipeline_id": "pipe-001",
                "run_id": "run-001",
                "name": "PLS_10",
                "dataset_name": "dataset_a",
                "dataset_hash": "abc123",
                "status": "completed",
                "created_at": datetime(2025, 1, 15, tzinfo=UTC),
                "completed_at": datetime(2025, 1, 15, tzinfo=UTC),
                "best_val": 0.95,
                "best_test": 0.90,
                "metric": "rmse",
                "duration_ms": 5000,
            }
        ]

        mock_adapter = MagicMock()
        mock_adapter.store.list_pipelines.return_value = mock_polars_df(pipeline_rows)

        scanner = WorkspaceScanner(tmp_path)
        scanner._store_adapter = mock_adapter

        results = scanner.discover_results(run_id="run-001")
        assert len(results) == 1
        assert results[0]["id"] == "pipe-001"
        assert results[0]["format"] == "store"

    def test_is_valid_workspace_with_store(self, tmp_path):
        """Workspace is valid if store.duckdb exists."""
        from api.workspace_manager import WorkspaceScanner

        workspace_dir = tmp_path / "workspace"
        workspace_dir.mkdir()
        (workspace_dir / "store.duckdb").touch()

        mock_adapter = MagicMock()

        scanner = WorkspaceScanner(tmp_path)
        scanner._store_adapter = mock_adapter

        is_valid, reason = scanner.is_valid_workspace()
        assert is_valid
        assert "DuckDB" in reason


# ---------------------------------------------------------------------------
# Sanitization helpers
# ---------------------------------------------------------------------------


class TestSanitization:
    """Tests for NaN/Inf sanitization helpers in store_adapter."""

    def test_sanitize_float_nan(self):
        from api.store_adapter import _sanitize_float
        assert _sanitize_float(float("nan")) is None

    def test_sanitize_float_inf(self):
        from api.store_adapter import _sanitize_float
        assert _sanitize_float(float("inf")) is None
        assert _sanitize_float(float("-inf")) is None

    def test_sanitize_float_normal(self):
        from api.store_adapter import _sanitize_float
        assert _sanitize_float(3.14) == 3.14

    def test_sanitize_dict_nested(self):
        from api.store_adapter import _sanitize_dict
        data = {
            "score": float("nan"),
            "nested": {"val": float("inf"), "ok": 1.0},
            "list_field": [1.0, float("nan"), 3.0],
        }
        result = _sanitize_dict(data)
        assert result["score"] is None
        assert result["nested"]["val"] is None
        assert result["nested"]["ok"] == 1.0
        assert result["list_field"] == [1.0, None, 3.0]


# ---------------------------------------------------------------------------
# Training workspace_path pass-through test
# ---------------------------------------------------------------------------


class TestTrainingWorkspacePath:
    """Verify that training.py passes workspace_path to nirs4all.run()."""

    def test_training_passes_workspace_path(self):
        """Check that workspace_path is included in the nirs4all.run() call in training.py."""
        training_path = Path(__file__).parent.parent / "api" / "training.py"
        source = training_path.read_text(encoding="utf-8")

        # workspace_path must appear in the run_kwargs dict or as a direct keyword
        assert "workspace_path" in source, (
            "nirs4all.run() in training.py must include workspace_path parameter "
            "to ensure results are written to the DuckDB store"
        )
