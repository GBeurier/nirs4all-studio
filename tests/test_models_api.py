"""
Tests for the models API endpoints used by the prediction workspace.

Run with: pytest tests/test_models_api.py -v
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

os.environ.setdefault("SENTRY_DSN", "")

# Ensure webapp root is importable
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture()
def mock_polars_df():
    """Create a minimal mock that mimics the subset of polars used by the endpoint."""

    def _make(rows: list[dict[str, Any]]):
        df = MagicMock()
        df.__len__ = lambda self: len(rows)
        df.iter_rows = MagicMock(side_effect=lambda named=False: iter(rows))
        df.columns = list(rows[0].keys()) if rows else []
        return df

    return _make


@pytest.fixture()
def mock_workspace(tmp_path):
    """Create a mock workspace with a fake store file."""
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()
    (workspace_dir / "store.duckdb").touch()

    ws = MagicMock()
    ws.path = str(workspace_dir)
    return ws


@pytest.fixture()
def sample_chain_rows():
    """Chain summary rows returned by WorkspaceStore.query_chain_summaries()."""
    return [
        {
            "chain_id": "chain-refit",
            "pipeline_id": "pipe-refit",
            "model_name": "PLS Refit",
            "model_class": "PLSRegression",
            "dataset_name": "dataset_a",
            "metric": "rmse",
            "cv_val_score": 0.50,
            "final_test_score": 8.7,
            "final_scores": '{"test": {"rmse": 8.5}}',
            "preprocessings": "SNV + SG",
        },
        {
            "chain_id": "chain-avg",
            "pipeline_id": "pipe-avg",
            "model_name": "RandomForestRegressor",
            "model_class": "RandomForestRegressor",
            "dataset_name": "dataset_a",
            "metric": "rmse",
            "cv_val_score": 0.10,
            "final_test_score": None,
            "final_scores": None,
            "preprocessings": "MSC",
        },
        {
            "chain_id": "chain-avg-duplicate",
            "pipeline_id": "pipe-avg-duplicate",
            "model_name": "RandomForestRegressor",
            "model_class": "RandomForestRegressor",
            "dataset_name": "dataset_a",
            "metric": "rmse",
            "cv_val_score": 0.10,
            "final_test_score": None,
            "final_scores": None,
            "preprocessings": "MSC",
        },
        {
            "chain_id": "chain-avg-variant",
            "pipeline_id": "pipe-avg-variant",
            "model_name": "RandomForestRegressor",
            "model_class": "RandomForestRegressor",
            "dataset_name": "dataset_a",
            "metric": "rmse",
            "cv_val_score": 0.20,
            "final_test_score": None,
            "final_scores": None,
            "preprocessings": "MSC",
        },
        {
            "chain_id": "chain-single",
            "pipeline_id": "pipe-single",
            "model_name": "PLS Single",
            "model_class": "PLSRegression",
            "dataset_name": "dataset_a",
            "metric": "rmse",
            "cv_val_score": 0.01,
            "final_test_score": None,
            "final_scores": None,
            "preprocessings": "Detrend",
        },
    ]


@pytest.fixture()
def mock_store(mock_polars_df, sample_chain_rows):
    """Mock WorkspaceStore with chain summaries, artifacts, and prediction scores."""
    store = MagicMock()
    store.query_chain_summaries.return_value = mock_polars_df(sample_chain_rows)

    fold_artifact_rows = [
        {
            "chain_id": "chain-refit",
            "fold_artifacts": '{"fold_0": "fold0.joblib", "fold_final": "final.joblib"}',
        },
        {
            "chain_id": "chain-avg",
            "fold_artifacts": '{"fold_0": "fold0.joblib", "fold_1": "fold1.joblib"}',
        },
        {
            "chain_id": "chain-avg-duplicate",
            "fold_artifacts": '{"fold_0": "fold0.joblib", "fold_1": "fold1.joblib"}',
        },
        {
            "chain_id": "chain-avg-variant",
            "fold_artifacts": '{"fold_0": "fold0.joblib", "fold_1": "fold1.joblib"}',
        },
        {
            "chain_id": "chain-single",
            "fold_artifacts": '{"fold_0": "fold0.joblib"}',
        },
    ]

    prediction_rows = [
        {
            "chain_id": "chain-avg",
            "fold_id": "avg",
            "test_score": 12.34,
            "scores": '{"test": {"rmse": 12.34}}',
        },
        {
            "chain_id": "chain-avg-duplicate",
            "fold_id": "avg",
            "test_score": 12.34,
            "scores": '{"test": {"rmse": 12.34}}',
        },
        {
            "chain_id": "chain-avg-variant",
            "fold_id": "avg",
            "test_score": 18.9,
            "scores": '{"test": {"rmse": 18.9}}',
        },
        {
            "chain_id": "chain-avg",
            "fold_id": "fold_0",
            "test_score": 11.11,
            "scores": '{"test": {"rmse": 11.11}}',
        },
        {
            "chain_id": "chain-single",
            "fold_id": "fold_0",
            "test_score": 15.67,
            "scores": '{"test": {"rmse": 15.67}}',
        },
    ]

    def _fetch_pl(sql: str, params: list[str]):
        assert params == [
            "chain-refit",
            "chain-avg",
            "chain-avg-duplicate",
            "chain-avg-variant",
            "chain-single",
        ]
        if "FROM chains" in sql:
            return mock_polars_df(fold_artifact_rows)
        if "FROM predictions" in sql:
            return mock_polars_df(prediction_rows)
        raise AssertionError(f"Unexpected SQL in test: {sql}")

    store._fetch_pl.side_effect = _fetch_pl
    store.close = MagicMock()
    return store


@pytest.fixture()
def patched_models_api(mock_workspace, mock_store):
    """Patch workspace access and lazy imports for the models endpoint."""
    import api.models  # noqa: F401

    def _patched_get_cached(name: str):
        if name == "WorkspaceStore":
            return MagicMock(return_value=mock_store)
        if name == "BundleLoader":
            return None
        return None

    with (
        patch.object(api.models, "workspace_manager") as mock_wm,
        patch.object(api.models, "get_cached", side_effect=_patched_get_cached),
    ):
        mock_wm.get_current_workspace.return_value = mock_workspace
        yield mock_store


@pytest.fixture()
def client(patched_models_api):
    """Create a FastAPI TestClient with the models endpoint dependencies mocked."""
    from fastapi.testclient import TestClient

    from main import app

    with TestClient(app) as c:
        yield c


class TestModelsAvailableEndpoint:
    """Regression tests for prediction-aligned model metadata."""

    def test_available_models_use_prediction_aligned_scores(self, client):
        resp = client.get("/api/models/available")

        assert resp.status_code == 200
        payload = resp.json()

        assert payload["total"] == 4
        assert [model["id"] for model in payload["models"]] == [
            "chain-refit",
            "chain-avg",
            "chain-single",
            "chain-avg-variant",
        ]

        models = {model["id"]: model for model in payload["models"]}
        assert "chain-avg-duplicate" not in models

        assert models["chain-refit"]["prediction_metric"] == "rmsep"
        assert models["chain-refit"]["prediction_score"] == pytest.approx(8.5)
        assert models["chain-refit"]["best_score"] == pytest.approx(0.50)

        assert models["chain-avg"]["prediction_metric"] == "rmsep"
        assert models["chain-avg"]["prediction_score"] == pytest.approx(12.34)
        assert models["chain-avg"]["best_score"] == pytest.approx(0.10)

        assert models["chain-single"]["prediction_metric"] == "rmsep"
        assert models["chain-single"]["prediction_score"] == pytest.approx(15.67)
        assert models["chain-single"]["best_score"] == pytest.approx(0.01)

        assert models["chain-avg-variant"]["prediction_metric"] == "rmsep"
        assert models["chain-avg-variant"]["prediction_score"] == pytest.approx(18.9)
        assert models["chain-avg-variant"]["best_score"] == pytest.approx(0.20)
