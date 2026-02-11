"""
Tests for aggregated predictions API endpoints.

Verifies endpoint routing, response schemas, filter combinations,
drill-down flow (aggregated → chain → partition → arrays), and error
handling for the ``/api/aggregated-predictions`` router.

Run with: pytest tests/test_aggregated_predictions_api.py -v
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch, PropertyMock

import numpy as np
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
        df.row = MagicMock(side_effect=lambda idx, named=False: rows[idx] if named else tuple(rows[idx].values()))
        df.columns = list(rows[0].keys()) if rows else []
        return df

    return _make


@pytest.fixture()
def sample_aggregated_rows():
    """Sample chain summary rows (v_chain_summary schema)."""
    return [
        {
            "run_id": "run-001",
            "pipeline_id": "pipe-001",
            "chain_id": "chain-001",
            "model_name": "PLS(10)",
            "model_class": "PLSRegression",
            "preprocessings": "SNV+SG",
            "branch_path": None,
            "source_index": None,
            "model_step_idx": 0,
            "metric": "rmse",
            "task_type": "regression",
            "dataset_name": "dataset_a",
            "best_params": None,
            "cv_val_score": 0.12,
            "cv_test_score": 0.13,
            "cv_train_score": None,
            "cv_fold_count": 5,
            "cv_scores": None,
            "final_test_score": None,
            "final_train_score": None,
            "final_scores": None,
            "pipeline_status": "completed",
        },
        {
            "run_id": "run-001",
            "pipeline_id": "pipe-001",
            "chain_id": "chain-002",
            "model_name": "RF(100)",
            "model_class": "RandomForestRegressor",
            "preprocessings": "SNV",
            "branch_path": None,
            "source_index": None,
            "model_step_idx": 0,
            "metric": "rmse",
            "task_type": "regression",
            "dataset_name": "dataset_a",
            "best_params": None,
            "cv_val_score": 0.24,
            "cv_test_score": 0.26,
            "cv_train_score": None,
            "cv_fold_count": 5,
            "cv_scores": None,
            "final_test_score": None,
            "final_train_score": None,
            "final_scores": None,
            "pipeline_status": "completed",
        },
    ]


@pytest.fixture()
def sample_chain_prediction_rows():
    """Sample individual prediction rows for a chain drill-down."""
    return [
        {
            "prediction_id": "pred-001",
            "pipeline_id": "pipe-001",
            "chain_id": "chain-001",
            "dataset_name": "dataset_a",
            "model_name": "PLS(10)",
            "model_class": "PLSRegression",
            "fold_id": "fold-0",
            "partition": "val",
            "val_score": 0.12,
            "test_score": 0.13,
            "train_score": None,
            "metric": "rmse",
            "task_type": "regression",
            "n_samples": 50,
            "n_features": 100,
            "preprocessings": "SNV+SG",
        },
        {
            "prediction_id": "pred-002",
            "pipeline_id": "pipe-001",
            "chain_id": "chain-001",
            "dataset_name": "dataset_a",
            "model_name": "PLS(10)",
            "model_class": "PLSRegression",
            "fold_id": "fold-1",
            "partition": "val",
            "val_score": 0.10,
            "test_score": 0.11,
            "train_score": None,
            "metric": "rmse",
            "task_type": "regression",
            "n_samples": 50,
            "n_features": 100,
            "preprocessings": "SNV+SG",
        },
        {
            "prediction_id": "pred-003",
            "pipeline_id": "pipe-001",
            "chain_id": "chain-001",
            "dataset_name": "dataset_a",
            "model_name": "PLS(10)",
            "model_class": "PLSRegression",
            "fold_id": "fold-0",
            "partition": "test",
            "val_score": 0.12,
            "test_score": 0.14,
            "train_score": None,
            "metric": "rmse",
            "task_type": "regression",
            "n_samples": 25,
            "n_features": 100,
            "preprocessings": "SNV+SG",
        },
    ]


@pytest.fixture()
def mock_workspace(tmp_path):
    """Create a mock workspace with a fake store.duckdb file."""
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()
    (workspace_dir / "store.duckdb").touch()

    ws = MagicMock()
    ws.path = str(workspace_dir)
    return ws


@pytest.fixture()
def mock_store(mock_polars_df, sample_aggregated_rows):
    """Create a fully mocked WorkspaceStore."""
    store = MagicMock()
    store.query_chain_summaries.return_value = mock_polars_df(sample_aggregated_rows)
    store.query_top_chains.return_value = mock_polars_df(sample_aggregated_rows[:1])
    store.get_chain_predictions.return_value = mock_polars_df([])
    store.get_prediction_arrays.return_value = None
    store.get_pipeline.return_value = None
    store.close = MagicMock()
    return store


@pytest.fixture()
def patched_endpoints(mock_workspace, mock_store):
    """Patch workspace_manager and WorkspaceStore for all endpoint tests."""
    # Ensure the module is imported before patching
    import api.aggregated_predictions  # noqa: F401

    with (
        patch.object(api.aggregated_predictions, "workspace_manager") as mock_wm,
        patch.object(api.aggregated_predictions, "WorkspaceStore", return_value=mock_store),
        patch.object(api.aggregated_predictions, "STORE_AVAILABLE", True),
    ):
        mock_wm.get_current_workspace.return_value = mock_workspace
        yield mock_store


@pytest.fixture()
def client(patched_endpoints):
    """Create a FastAPI TestClient with mocked dependencies."""
    from fastapi.testclient import TestClient
    from main import app

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# StoreAdapter aggregated prediction tests
# ---------------------------------------------------------------------------


class TestStoreAdapterAggregated:
    """Tests for aggregated prediction methods in StoreAdapter."""

    def _make_adapter(self, mock_store):
        with (
            patch("api.store_adapter.STORE_AVAILABLE", True),
            patch("api.store_adapter.WorkspaceStore", return_value=mock_store),
        ):
            from api.store_adapter import StoreAdapter

            adapter = StoreAdapter.__new__(StoreAdapter)
            adapter._store = mock_store
            return adapter

    def test_get_aggregated_predictions(self, mock_polars_df, sample_aggregated_rows):
        mock_store = MagicMock()
        mock_store.query_chain_summaries.return_value = mock_polars_df(sample_aggregated_rows)

        adapter = self._make_adapter(mock_store)
        result = adapter.get_aggregated_predictions()

        assert len(result) == 2
        assert result[0]["chain_id"] == "chain-001"
        assert result[1]["chain_id"] == "chain-002"
        mock_store.query_chain_summaries.assert_called_once()

    def test_get_aggregated_predictions_with_filters(self, mock_polars_df, sample_aggregated_rows):
        mock_store = MagicMock()
        mock_store.query_chain_summaries.return_value = mock_polars_df(sample_aggregated_rows[:1])

        adapter = self._make_adapter(mock_store)
        result = adapter.get_aggregated_predictions(
            run_id="run-001",
            model_class="PLSRegression",
            metric="rmse",
        )

        assert len(result) == 1
        mock_store.query_chain_summaries.assert_called_once_with(
            run_id="run-001",
            pipeline_id=None,
            chain_id=None,
            dataset_name=None,
            model_class="PLSRegression",
            metric="rmse",
        )

    def test_get_top_aggregated_predictions(self, mock_polars_df, sample_aggregated_rows):
        mock_store = MagicMock()
        mock_store.query_top_chains.return_value = mock_polars_df(sample_aggregated_rows[:1])

        adapter = self._make_adapter(mock_store)
        result = adapter.get_top_aggregated_predictions(metric="rmse", n=5)

        assert len(result) == 1
        assert result[0]["metric"] == "rmse"
        mock_store.query_top_chains.assert_called_once_with(
            metric="rmse",
            n=5,
            score_column="cv_val_score",
        )

    def test_get_chain_predictions(self, mock_polars_df, sample_chain_prediction_rows):
        mock_store = MagicMock()
        mock_store.get_chain_predictions.return_value = mock_polars_df(sample_chain_prediction_rows)

        adapter = self._make_adapter(mock_store)
        result = adapter.get_chain_predictions("chain-001")

        assert len(result) == 3
        assert all(r["chain_id"] == "chain-001" for r in result)
        mock_store.get_chain_predictions.assert_called_once_with(
            chain_id="chain-001",
            partition=None,
            fold_id=None,
        )

    def test_get_chain_predictions_with_partition(self, mock_polars_df, sample_chain_prediction_rows):
        val_rows = [r for r in sample_chain_prediction_rows if r["partition"] == "val"]
        mock_store = MagicMock()
        mock_store.get_chain_predictions.return_value = mock_polars_df(val_rows)

        adapter = self._make_adapter(mock_store)
        result = adapter.get_chain_predictions("chain-001", partition="val")

        assert len(result) == 2
        assert all(r["partition"] == "val" for r in result)

    def test_get_prediction_arrays(self):
        mock_store = MagicMock()
        mock_store.get_prediction_arrays.return_value = {
            "y_true": np.array([1.0, 2.0, 3.0]),
            "y_pred": np.array([1.1, 1.9, 3.1]),
            "y_proba": None,
            "weights": None,
            "sample_indices": np.array([0, 1, 2]),
        }

        adapter = self._make_adapter(mock_store)
        result = adapter.get_prediction_arrays("pred-001")

        assert result is not None
        assert result["prediction_id"] == "pred-001"
        assert result["y_true"] == [1.0, 2.0, 3.0]
        assert result["y_pred"] == [1.1, 1.9, 3.1]
        assert result["sample_indices"] == [0, 1, 2]
        assert result["y_proba"] is None

    def test_get_prediction_arrays_not_found(self):
        mock_store = MagicMock()
        mock_store.get_prediction_arrays.return_value = None

        adapter = self._make_adapter(mock_store)
        result = adapter.get_prediction_arrays("nonexistent")

        assert result is None

    def test_sanitize_nan_in_aggregated(self, mock_polars_df):
        """NaN scores should be sanitized to None in responses."""
        rows = [
            {
                "run_id": "run-001",
                "pipeline_id": "pipe-001",
                "chain_id": "chain-001",
                "model_name": "PLS(10)",
                "model_class": "PLSRegression",
                "preprocessings": None,
                "branch_path": None,
                "source_index": None,
                "model_step_idx": 0,
                "metric": "rmse",
                "task_type": "regression",
                "dataset_name": "dataset_a",
                "best_params": None,
                "cv_val_score": float("nan"),
                "cv_test_score": float("nan"),
                "cv_train_score": float("nan"),
                "cv_fold_count": 1,
                "cv_scores": None,
                "final_test_score": None,
                "final_train_score": None,
                "final_scores": None,
                "pipeline_status": "completed",
            }
        ]
        mock_store = MagicMock()
        mock_store.query_chain_summaries.return_value = mock_polars_df(rows)

        adapter = self._make_adapter(mock_store)
        result = adapter.get_aggregated_predictions()

        assert result[0]["cv_val_score"] is None
        assert result[0]["cv_test_score"] is None
        assert result[0]["cv_train_score"] is None


# ---------------------------------------------------------------------------
# Endpoint tests: GET /api/aggregated-predictions
# ---------------------------------------------------------------------------


class TestGetAggregatedPredictions:
    """Tests for GET /api/aggregated-predictions endpoint."""

    def test_basic_query(self, client, patched_endpoints):
        resp = client.get("/api/aggregated-predictions")
        assert resp.status_code == 200
        data = resp.json()
        assert "predictions" in data
        assert "total" in data
        assert "generated_at" in data
        assert data["total"] == 2

    def test_response_schema(self, client, patched_endpoints):
        resp = client.get("/api/aggregated-predictions")
        data = resp.json()
        pred = data["predictions"][0]

        # Required fields from ChainSummary model
        assert "run_id" in pred
        assert "pipeline_id" in pred
        assert "chain_id" in pred
        assert "model_name" in pred
        assert "model_class" in pred
        assert "metric" in pred
        assert "dataset_name" in pred
        assert "cv_fold_count" in pred
        assert "task_type" in pred
        assert "cv_val_score" in pred
        assert "cv_test_score" in pred
        assert "cv_train_score" in pred
        assert "pipeline_status" in pred

    def test_filter_by_run_id(self, client, patched_endpoints):
        resp = client.get("/api/aggregated-predictions?run_id=run-001")
        assert resp.status_code == 200
        patched_endpoints.query_chain_summaries.assert_called_with(
            run_id="run-001",
            pipeline_id=None,
            chain_id=None,
            dataset_name=None,
            model_class=None,
            metric=None,
        )

    def test_filter_by_model_class(self, client, patched_endpoints):
        resp = client.get("/api/aggregated-predictions?model_class=PLSRegression")
        assert resp.status_code == 200
        patched_endpoints.query_chain_summaries.assert_called_with(
            run_id=None,
            pipeline_id=None,
            chain_id=None,
            dataset_name=None,
            model_class="PLSRegression",
            metric=None,
        )

    def test_filter_by_metric(self, client, patched_endpoints):
        resp = client.get("/api/aggregated-predictions?metric=rmse")
        assert resp.status_code == 200
        patched_endpoints.query_chain_summaries.assert_called_with(
            run_id=None,
            pipeline_id=None,
            chain_id=None,
            dataset_name=None,
            model_class=None,
            metric="rmse",
        )

    def test_combined_filters(self, client, patched_endpoints):
        resp = client.get(
            "/api/aggregated-predictions"
            "?run_id=run-001&pipeline_id=pipe-001&dataset_name=dataset_a"
            "&model_class=PLSRegression&metric=rmse"
        )
        assert resp.status_code == 200
        patched_endpoints.query_chain_summaries.assert_called_with(
            run_id="run-001",
            pipeline_id="pipe-001",
            chain_id=None,
            dataset_name="dataset_a",
            model_class="PLSRegression",
            metric="rmse",
        )

    def test_empty_result(self, client, patched_endpoints, mock_polars_df):
        patched_endpoints.query_chain_summaries.return_value = mock_polars_df(
            [{"run_id": "x"}]  # dummy row used only for column extraction
        )
        # Use empty rows
        empty_df = MagicMock()
        empty_df.__len__ = lambda self: 0
        empty_df.iter_rows = MagicMock(return_value=iter([]))
        patched_endpoints.query_chain_summaries.return_value = empty_df

        resp = client.get("/api/aggregated-predictions?run_id=nonexistent")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["predictions"] == []


# ---------------------------------------------------------------------------
# Endpoint tests: GET /api/aggregated-predictions/top
# ---------------------------------------------------------------------------


class TestGetTopAggregatedPredictions:
    """Tests for GET /api/aggregated-predictions/top endpoint."""

    def test_basic_top_query(self, client, patched_endpoints):
        resp = client.get("/api/aggregated-predictions/top?metric=rmse")
        assert resp.status_code == 200
        data = resp.json()
        assert "predictions" in data
        assert "metric" in data
        assert data["metric"] == "rmse"

    def test_top_with_n(self, client, patched_endpoints):
        resp = client.get("/api/aggregated-predictions/top?metric=rmse&n=5")
        assert resp.status_code == 200
        patched_endpoints.query_top_chains.assert_called_once()

    def test_top_with_score_column(self, client, patched_endpoints):
        resp = client.get(
            "/api/aggregated-predictions/top?metric=rmse&score_column=cv_test_score"
        )
        assert resp.status_code == 200
        patched_endpoints.query_top_chains.assert_called_with(
            metric="rmse",
            n=10,
            score_column="cv_test_score",
            run_id=None,
            pipeline_id=None,
            dataset_name=None,
            model_class=None,
        )

    def test_top_requires_metric(self, client, patched_endpoints):
        resp = client.get("/api/aggregated-predictions/top")
        assert resp.status_code == 422  # FastAPI validation error

    def test_top_with_filters(self, client, patched_endpoints):
        resp = client.get(
            "/api/aggregated-predictions/top?metric=r2&run_id=run-001&model_class=PLSRegression"
        )
        assert resp.status_code == 200
        patched_endpoints.query_top_chains.assert_called_with(
            metric="r2",
            n=10,
            score_column="cv_val_score",
            run_id="run-001",
            pipeline_id=None,
            dataset_name=None,
            model_class="PLSRegression",
        )


# ---------------------------------------------------------------------------
# Endpoint tests: GET /api/aggregated-predictions/chain/{chain_id}
# ---------------------------------------------------------------------------


class TestGetChainDetail:
    """Tests for GET /api/aggregated-predictions/chain/{chain_id} endpoint."""

    def test_chain_detail(
        self, client, patched_endpoints, mock_polars_df,
        sample_aggregated_rows, sample_chain_prediction_rows,
    ):
        patched_endpoints.query_chain_summaries.return_value = mock_polars_df(
            sample_aggregated_rows[:1]
        )
        patched_endpoints.get_chain_predictions.return_value = mock_polars_df(
            sample_chain_prediction_rows
        )
        patched_endpoints.get_pipeline.return_value = {
            "pipeline_id": "pipe-001",
            "name": "PLS Pipeline",
            "dataset_name": "dataset_a",
            "generator_choices": '{"n_components": [5, 10]}',
            "status": "completed",
            "metric": "rmse",
            "best_val": 0.12,
            "best_test": 0.13,
        }

        resp = client.get("/api/aggregated-predictions/chain/chain-001")
        assert resp.status_code == 200
        data = resp.json()

        assert data["chain_id"] == "chain-001"
        assert data["summary"] is not None
        assert data["summary"]["chain_id"] == "chain-001"
        assert len(data["predictions"]) == 3
        assert data["pipeline"] is not None
        assert data["pipeline"]["pipeline_id"] == "pipe-001"

    def test_chain_detail_not_found(self, client, patched_endpoints, mock_polars_df):
        empty_df = MagicMock()
        empty_df.__len__ = lambda self: 0
        empty_df.iter_rows = MagicMock(return_value=iter([]))

        patched_endpoints.query_chain_summaries.return_value = empty_df
        patched_endpoints.get_chain_predictions.return_value = empty_df

        resp = client.get("/api/aggregated-predictions/chain/nonexistent")
        assert resp.status_code == 404

    def test_chain_detail_with_metric_filter(
        self, client, patched_endpoints, mock_polars_df,
        sample_aggregated_rows, sample_chain_prediction_rows,
    ):
        patched_endpoints.query_chain_summaries.return_value = mock_polars_df(
            sample_aggregated_rows[:1]
        )
        patched_endpoints.get_chain_predictions.return_value = mock_polars_df(
            sample_chain_prediction_rows
        )

        resp = client.get("/api/aggregated-predictions/chain/chain-001?metric=rmse")
        assert resp.status_code == 200
        patched_endpoints.query_chain_summaries.assert_called_with(
            chain_id="chain-001",
            metric="rmse",
            dataset_name=None,
        )


# ---------------------------------------------------------------------------
# Endpoint tests: GET /api/aggregated-predictions/chain/{chain_id}/detail
# ---------------------------------------------------------------------------


class TestGetChainPartitionDetail:
    """Tests for GET /api/aggregated-predictions/chain/{chain_id}/detail endpoint."""

    def test_partition_detail(
        self, client, patched_endpoints, mock_polars_df, sample_chain_prediction_rows,
    ):
        val_rows = [r for r in sample_chain_prediction_rows if r["partition"] == "val"]
        patched_endpoints.get_chain_predictions.return_value = mock_polars_df(val_rows)

        resp = client.get(
            "/api/aggregated-predictions/chain/chain-001/detail?partition=val"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["chain_id"] == "chain-001"
        assert data["partition"] == "val"
        assert data["total"] == 2

    def test_partition_and_fold_filter(
        self, client, patched_endpoints, mock_polars_df, sample_chain_prediction_rows,
    ):
        fold0_val = [
            r for r in sample_chain_prediction_rows
            if r["partition"] == "val" and r["fold_id"] == "fold-0"
        ]
        patched_endpoints.get_chain_predictions.return_value = mock_polars_df(fold0_val)

        resp = client.get(
            "/api/aggregated-predictions/chain/chain-001/detail"
            "?partition=val&fold_id=fold-0"
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["fold_id"] == "fold-0"

    def test_no_filter(self, client, patched_endpoints, mock_polars_df, sample_chain_prediction_rows):
        patched_endpoints.get_chain_predictions.return_value = mock_polars_df(
            sample_chain_prediction_rows
        )

        resp = client.get("/api/aggregated-predictions/chain/chain-001/detail")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 3
        assert data["partition"] is None
        assert data["fold_id"] is None


# ---------------------------------------------------------------------------
# Endpoint tests: GET /api/aggregated-predictions/{prediction_id}/arrays
# ---------------------------------------------------------------------------


class TestGetPredictionArrays:
    """Tests for GET /api/aggregated-predictions/{prediction_id}/arrays endpoint."""

    def test_arrays_found(self, client, patched_endpoints):
        patched_endpoints.get_prediction_arrays.return_value = {
            "y_true": np.array([1.0, 2.0, 3.0]),
            "y_pred": np.array([1.1, 1.9, 3.1]),
            "y_proba": None,
            "weights": None,
            "sample_indices": np.array([0, 1, 2]),
        }

        resp = client.get("/api/aggregated-predictions/pred-001/arrays")
        assert resp.status_code == 200
        data = resp.json()
        assert data["prediction_id"] == "pred-001"
        assert data["y_true"] == [1.0, 2.0, 3.0]
        assert data["y_pred"] == [1.1, 1.9, 3.1]
        assert data["n_samples"] == 3
        assert data["sample_indices"] == [0, 1, 2]
        assert data["y_proba"] is None
        assert data["weights"] is None

    def test_arrays_not_found(self, client, patched_endpoints):
        patched_endpoints.get_prediction_arrays.return_value = None

        resp = client.get("/api/aggregated-predictions/nonexistent/arrays")
        assert resp.status_code == 404

    def test_arrays_partial(self, client, patched_endpoints):
        """Arrays may be partially populated (e.g., no y_proba for regression)."""
        patched_endpoints.get_prediction_arrays.return_value = {
            "y_true": np.array([1.0, 2.0]),
            "y_pred": np.array([1.1, 2.1]),
            "y_proba": None,
            "weights": None,
            "sample_indices": None,
        }

        resp = client.get("/api/aggregated-predictions/pred-001/arrays")
        assert resp.status_code == 200
        data = resp.json()
        assert data["y_true"] == [1.0, 2.0]
        assert data["y_pred"] == [1.1, 2.1]
        assert data["y_proba"] is None
        assert data["sample_indices"] is None
        assert data["n_samples"] == 2


# ---------------------------------------------------------------------------
# Error handling tests
# ---------------------------------------------------------------------------


class TestErrorHandling:
    """Tests for error handling in aggregated prediction endpoints."""

    def test_no_workspace_selected(self, mock_polars_df):
        """409 when no workspace is selected."""
        import api.aggregated_predictions  # noqa: F401

        with (
            patch.object(api.aggregated_predictions, "workspace_manager") as mock_wm,
            patch.object(api.aggregated_predictions, "STORE_AVAILABLE", True),
        ):
            mock_wm.get_current_workspace.return_value = None

            from fastapi.testclient import TestClient
            from main import app

            with TestClient(app) as c:
                resp = c.get("/api/aggregated-predictions")
                assert resp.status_code == 409
                assert "No workspace" in resp.json()["detail"]

    def test_no_store_file(self, tmp_path, mock_polars_df):
        """404 when store.duckdb doesn't exist in workspace."""
        import api.aggregated_predictions  # noqa: F401

        workspace_dir = tmp_path / "workspace"
        workspace_dir.mkdir()
        # No store.duckdb file

        ws = MagicMock()
        ws.path = str(workspace_dir)

        with (
            patch.object(api.aggregated_predictions, "workspace_manager") as mock_wm,
            patch.object(api.aggregated_predictions, "STORE_AVAILABLE", True),
        ):
            mock_wm.get_current_workspace.return_value = ws

            from fastapi.testclient import TestClient
            from main import app

            with TestClient(app) as c:
                resp = c.get("/api/aggregated-predictions")
                assert resp.status_code == 404
                assert "No DuckDB store" in resp.json()["detail"]

    def test_store_not_available(self):
        """501 when nirs4all library is not installed."""
        import api.aggregated_predictions  # noqa: F401

        with (
            patch.object(api.aggregated_predictions, "workspace_manager") as mock_wm,
            patch.object(api.aggregated_predictions, "STORE_AVAILABLE", False),
        ):
            ws = MagicMock()
            ws.path = "/some/path"
            mock_wm.get_current_workspace.return_value = ws

            from fastapi.testclient import TestClient
            from main import app

            with TestClient(app) as c:
                resp = c.get("/api/aggregated-predictions")
                assert resp.status_code == 501


# ---------------------------------------------------------------------------
# Drill-down flow integration test
# ---------------------------------------------------------------------------


class TestDrillDownFlow:
    """Tests for the complete drill-down flow from aggregated → arrays."""

    def test_full_drill_down(
        self, client, patched_endpoints, mock_polars_df,
        sample_aggregated_rows, sample_chain_prediction_rows,
    ):
        """Test the complete flow: aggregated → chain detail → partition → arrays."""
        # Step 1: Get aggregated predictions
        resp = client.get("/api/aggregated-predictions")
        assert resp.status_code == 200
        predictions = resp.json()["predictions"]
        assert len(predictions) >= 1
        chain_id = predictions[0]["chain_id"]

        # Step 2: Drill down to chain detail
        patched_endpoints.query_chain_summaries.return_value = mock_polars_df(
            sample_aggregated_rows[:1]
        )
        patched_endpoints.get_chain_predictions.return_value = mock_polars_df(
            sample_chain_prediction_rows
        )

        resp = client.get(f"/api/aggregated-predictions/chain/{chain_id}")
        assert resp.status_code == 200
        chain_data = resp.json()
        assert chain_data["chain_id"] == chain_id
        assert len(chain_data["predictions"]) > 0

        # Step 3: Get partition detail
        val_rows = [r for r in sample_chain_prediction_rows if r["partition"] == "val"]
        patched_endpoints.get_chain_predictions.return_value = mock_polars_df(val_rows)

        resp = client.get(
            f"/api/aggregated-predictions/chain/{chain_id}/detail?partition=val"
        )
        assert resp.status_code == 200
        partition_data = resp.json()
        assert partition_data["total"] == len(val_rows)
        prediction_id = partition_data["predictions"][0]["prediction_id"]

        # Step 4: Get arrays for a specific prediction
        patched_endpoints.get_prediction_arrays.return_value = {
            "y_true": np.array([1.0, 2.0, 3.0]),
            "y_pred": np.array([1.1, 1.9, 3.1]),
            "y_proba": None,
            "weights": None,
            "sample_indices": np.array([0, 1, 2]),
        }

        resp = client.get(
            f"/api/aggregated-predictions/{prediction_id}/arrays"
        )
        assert resp.status_code == 200
        arrays_data = resp.json()
        assert arrays_data["prediction_id"] == prediction_id
        assert len(arrays_data["y_true"]) == 3
