"""
Tests for DuckDB WorkspaceStore integration in webapp endpoints.

Verifies that the webapp correctly routes through the StoreAdapter
and WorkspaceScanner when a DuckDB store is available.

Run with: pytest tests/test_store_integration.py -v
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import UTC, datetime
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

    def test_get_run_detail_ignores_repr_style_refit_splitter(self, mock_polars_df):
        mock_store = MagicMock()
        mock_store.get_run.return_value = {
            "run_id": "run-001",
            "name": "Test Run",
            "status": "completed",
            "created_at": datetime(2025, 1, 15, tzinfo=UTC),
            "completed_at": datetime(2025, 1, 15, tzinfo=UTC),
            "config": {},
            "datasets": [],
            "summary": {},
        }
        mock_store.list_pipelines.return_value = mock_polars_df([
            {
                "pipeline_id": "pipe-refit",
                "name": "Refit pipeline",
                "expanded_config": [
                    "<nirs4all.pipeline.execution.refit.executor._FullTrainFoldSplitter object at 0x000001EAEF3C4250>",
                    {"model": {"class": "sklearn.cross_decomposition._pls.PLSRegression", "params": {"n_components": 3}}},
                ],
                "generator_choices": None,
                "created_at": datetime(2025, 1, 15, tzinfo=UTC),
                "completed_at": datetime(2025, 1, 15, tzinfo=UTC),
            },
            {
                "pipeline_id": "pipe-cv",
                "name": "CV pipeline",
                "expanded_config": [
                    {
                        "class": "sklearn.model_selection._split.KFold",
                        "params": {"n_splits": 5, "shuffle": True, "random_state": 11},
                    },
                    {"model": {"class": "sklearn.cross_decomposition._pls.PLSRegression", "params": {"n_components": 3}}},
                ],
                "generator_choices": None,
                "created_at": datetime(2025, 1, 15, tzinfo=UTC),
                "completed_at": datetime(2025, 1, 15, tzinfo=UTC),
            },
        ])

        # has_refit derives from chain summaries carrying native final scores
        mock_store.query_chain_summaries.return_value = mock_polars_df([
            {
                "chain_id": "chain-001",
                "final_test_score": 0.12,
                "final_train_score": 0.10,
            },
        ])

        adapter = self._make_adapter(mock_store)
        result = adapter.get_run_detail("run-001")

        assert result is not None
        # The repr-style internal splitter string must not pollute CV inference
        assert result["config"]["cv_strategy"] == "kfold"
        assert result["config"]["splitter_class"] == "KFold"
        assert result["config"]["cv_folds"] == 5
        assert result["config"]["random_state"] == 11
        assert result["config"]["shuffle"] is True
        assert result["config"]["has_refit"] is True

        pipelines = {pipeline["pipeline_id"]: pipeline for pipeline in result["pipelines"]}
        assert pipelines["pipe-refit"]["splitter_class"] is None
        assert pipelines["pipe-cv"]["splitter_class"] == "KFold"

    def test_get_run_detail_exposes_runtime_status_from_config_and_pipelines(self, mock_polars_df):
        diagnostic = {
            "verb": "run",
            "cause": "unsupported_shape",
            "message": "dag-ml does not support this pipeline shape",
            "mitigation": "Run on engine='legacy'.",
        }
        fallback_policy = {
            "source": "nirs4all.run.allow_fallback",
            "engine_requested": "dag-ml",
            "allow_fallback": True,
            "mode": "allow_fallback",
        }
        mock_store = MagicMock()
        mock_store.get_run.return_value = {
            "run_id": "run-runtime-001",
            "name": "Runtime Run",
            "status": "completed",
            "created_at": datetime(2025, 1, 15, tzinfo=UTC),
            "completed_at": datetime(2025, 1, 15, tzinfo=UTC),
            "config": json.dumps({
                "requested_engine": "dag-ml",
                "fallback_policy": fallback_policy,
            }),
            "datasets": [],
            "summary": {},
        }
        mock_store.list_pipelines.return_value = mock_polars_df([
            {
                "pipeline_id": "pipe-runtime-001",
                "name": "Runtime pipeline",
                "expanded_config": None,
                "generator_choices": None,
                "created_at": datetime(2025, 1, 15, tzinfo=UTC),
                "completed_at": datetime(2025, 1, 15, tzinfo=UTC),
                "engine": "legacy",
                "engine_requested": "dag-ml",
                "engine_diagnostics": json.dumps([diagnostic]),
                "fallback_policy": json.dumps(fallback_policy),
            },
        ])
        mock_store.query_chain_summaries.return_value = mock_polars_df([])

        adapter = self._make_adapter(mock_store)
        result = adapter.get_run_detail("run-runtime-001")

        assert result is not None
        assert result["engine"] == "legacy"
        assert result["engine_requested"] == "dag-ml"
        assert result["engine_diagnostics"] == [diagnostic]
        assert result["fallback_policy"] == fallback_policy
        assert result["allow_fallback"] is True
        assert result["config"]["fallback_policy"] == fallback_policy
        assert result["pipelines"][0]["engine"] == "legacy"
        assert result["pipelines"][0]["engine_requested"] == "dag-ml"
        assert result["pipelines"][0]["engine_diagnostics"] == [diagnostic]
        assert result["pipelines"][0]["fallback_policy"] == fallback_policy

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
        # Page query returns the limited slice; the total now comes from a
        # single COUNT(*) via _fetch_pl, not a full-table query_predictions().
        mock_store.query_predictions.return_value = mock_polars_df(sample_prediction_rows[:2])

        count_df = MagicMock()
        count_df.__len__ = lambda self: 1
        count_df.row = MagicMock(return_value={"cnt": 3})
        mock_store._fetch_pl.return_value = count_df

        adapter = self._make_adapter(mock_store)
        result = adapter.get_predictions_page(limit=2, offset=0)

        assert len(result["records"]) == 2
        assert result["total"] == 3
        assert result["has_more"] is True
        # Pagination must not re-query the full predictions table for the count.
        assert mock_store.query_predictions.call_count == 1
        count_query = mock_store._fetch_pl.call_args.args[0]
        assert "COUNT(*)" in count_query

    def test_get_dataset_top_chains_keeps_best_final_outside_top_cv(self, mock_polars_df):
        mock_store = MagicMock()
        mock_store.query_chain_summaries.return_value = mock_polars_df([
            {
                "chain_id": "chain-cv-best",
                "run_id": "run-001",
                "pipeline_id": "pipe-001",
                "dataset_name": "dataset_a",
                "metric": "rmse",
                "task_type": "regression",
                "model_name": "Model A",
                "model_class": "PLSRegression",
                "preprocessings": "SNV",
                "cv_val_score": 0.12,
                "cv_test_score": 0.15,
                "cv_train_score": 0.1,
                "cv_fold_count": 5,
                "cv_scores": {},
                "final_test_score": 0.35,
                "final_train_score": 0.09,
                "final_scores": {},
                "best_params": None,
                "model_step_idx": None,
            },
            {
                "chain_id": "chain-final-best",
                "run_id": "run-002",
                "pipeline_id": "pipe-002",
                "dataset_name": "dataset_a",
                "metric": "rmse",
                "task_type": "regression",
                "model_name": "Model B",
                "model_class": "PLSRegression",
                "preprocessings": "MSC",
                "cv_val_score": 0.2,
                "cv_test_score": 0.22,
                "cv_train_score": 0.18,
                "cv_fold_count": 5,
                "cv_scores": {},
                "final_test_score": 0.18,
                "final_train_score": 0.11,
                "final_scores": {},
                "best_params": None,
                "model_step_idx": None,
            },
        ])

        adapter = self._make_adapter(mock_store)
        adapter._get_pipeline_metadata_map = MagicMock(return_value={})

        result = adapter.get_dataset_top_chains(n=1)

        assert len(result["datasets"]) == 1
        top_chains = result["datasets"][0]["top_chains"]
        assert {chain["chain_id"] for chain in top_chains} == {"chain-cv-best", "chain-final-best"}
        best_final = next(chain for chain in top_chains if chain["chain_id"] == "chain-final-best")
        assert best_final["final_test_score"] == 0.18

    def test_get_dataset_top_chains_refit_only_flag_and_dedup(self, mock_polars_df):
        """Refit-only chains carry the flag, and dedup avoids double-emit
        when the best-final is also a top-CV winner."""
        mock_store = MagicMock()
        mock_store.query_chain_summaries.return_value = mock_polars_df([
            # CV winner that is ALSO the best final - must not be duplicated.
            {
                "chain_id": "chain-cv-final-winner",
                "run_id": "run-001",
                "pipeline_id": "pipe-001",
                "dataset_name": "dataset_a",
                "metric": "r2",
                "task_type": "regression",
                "model_name": "Model A",
                "model_class": "PLSRegression",
                "preprocessings": "SNV",
                "cv_val_score": 0.95,
                "cv_test_score": 0.93,
                "cv_train_score": 0.97,
                "cv_fold_count": 5,
                "cv_scores": {},
                "final_test_score": 0.94,
                "final_train_score": 0.96,
                "final_scores": {},
                "best_params": None,
                "model_step_idx": None,
            },
            # Refit-only chain (no CV folds) - should appear with the flag.
            {
                "chain_id": "chain-refit-only",
                "run_id": "run-002",
                "pipeline_id": "pipe-002",
                "dataset_name": "dataset_a",
                "metric": "r2",
                "task_type": "regression",
                "model_name": "Model B",
                "model_class": "PLSRegression",
                "preprocessings": "MSC",
                "cv_val_score": None,
                "cv_test_score": None,
                "cv_train_score": None,
                "cv_fold_count": 0,
                "cv_scores": {},
                "final_test_score": 0.80,
                "final_train_score": 0.82,
                "final_scores": {},
                "best_params": None,
                "model_step_idx": None,
            },
        ])

        adapter = self._make_adapter(mock_store)
        adapter._get_pipeline_metadata_map = MagicMock(return_value={})

        result = adapter.get_dataset_top_chains(n=5)

        assert len(result["datasets"]) == 1
        top_chains = result["datasets"][0]["top_chains"]
        ids = [chain["chain_id"] for chain in top_chains]
        # Each chain appears exactly once.
        assert ids.count("chain-cv-final-winner") == 1
        assert ids.count("chain-refit-only") == 1
        refit_chain = next(c for c in top_chains if c["chain_id"] == "chain-refit-only")
        assert refit_chain.get("is_refit_only") is True
        cv_chain = next(c for c in top_chains if c["chain_id"] == "chain-cv-final-winner")
        assert cv_chain.get("is_refit_only") is not True

    def test_get_dataset_top_chains_only_loads_metadata_for_selected(self, mock_polars_df):
        """``_get_pipeline_metadata_map`` must be called only with the
        pipeline ids of chains that survive ranking."""
        rows = []
        # Build n=1 selection: 5 CV chains, only one wins; 4 others must
        # not appear in the metadata fetch.
        for i in range(5):
            rows.append({
                "chain_id": f"chain-{i}",
                "run_id": "run-001",
                "pipeline_id": f"pipe-{i}",
                "dataset_name": "dataset_a",
                "metric": "rmse",
                "task_type": "regression",
                "model_name": f"Model {i}",
                "model_class": "PLSRegression",
                "preprocessings": "SNV",
                "cv_val_score": 0.10 + i * 0.05,  # rmse: lower is better -> i=0 wins
                "cv_test_score": 0.12,
                "cv_train_score": 0.09,
                "cv_fold_count": 5,
                "cv_scores": {},
                "final_test_score": None,
                "final_train_score": None,
                "final_scores": {},
                "best_params": None,
                "model_step_idx": None,
            })
        mock_store = MagicMock()
        mock_store.query_chain_summaries.return_value = mock_polars_df(rows)

        adapter = self._make_adapter(mock_store)
        meta_mock = MagicMock(return_value={})
        adapter._get_pipeline_metadata_map = meta_mock

        result = adapter.get_dataset_top_chains(n=1)

        assert len(result["datasets"][0]["top_chains"]) == 1
        assert result["datasets"][0]["top_chains"][0]["chain_id"] == "chain-0"
        # Only the surviving pipeline id should have been requested.
        meta_mock.assert_called_once()
        called_ids = meta_mock.call_args[0][0]
        assert set(called_ids) == {"pipe-0"}

    def test_build_dataset_scores_prefers_final_and_keeps_cv_context(self, mock_polars_df):
        mock_store = MagicMock()
        mock_store.query_chain_summaries.return_value = mock_polars_df([
            {
                "chain_id": "chain-final",
                "run_id": "run-001",
                "pipeline_id": "pipe-001",
                "dataset_name": "dataset_a",
                "metric": "rmse",
                "task_type": "regression",
                "model_name": "Model A",
                "model_class": "PLSRegression",
                "preprocessings": "SNV",
                "cv_val_score": 0.12,
                "cv_test_score": 0.14,
                "cv_train_score": 0.10,
                "cv_fold_count": 5,
                "cv_scores": {},
                "final_test_score": 0.18,
                "final_train_score": 0.11,
                "final_scores": {},
                "best_params": None,
                "model_step_idx": None,
            },
            {
                "chain_id": "chain-cv",
                "run_id": "run-002",
                "pipeline_id": "pipe-002",
                "dataset_name": "dataset_a",
                "metric": "rmse",
                "task_type": "regression",
                "model_name": "Model B",
                "model_class": "PLSRegression",
                "preprocessings": "MSC",
                "cv_val_score": 0.10,
                "cv_test_score": 0.12,
                "cv_train_score": 0.09,
                "cv_fold_count": 5,
                "cv_scores": {},
                "final_test_score": None,
                "final_train_score": None,
                "final_scores": {},
                "best_params": None,
                "model_step_idx": None,
            },
        ])

        adapter = self._make_adapter(mock_store)

        from api.workspace.services import _build_dataset_scores_payload

        payload = _build_dataset_scores_payload(
            adapter,
            workspace_id="ws_001",
            linked_datasets=[{"id": "ds_linked", "name": "dataset_a", "path": ""}],
        )

        assert payload["workspace_id"] == "ws_001"
        assert len(payload["datasets"]) == 1
        score_entry = payload["datasets"][0]
        assert score_entry["linked_dataset_id"] == "ds_linked"
        assert score_entry["score_kind"] == "final"
        assert score_entry["best_score"] == 0.18
        assert score_entry["cv_score"] == 0.12
        assert score_entry["model_name"] == "Model A"

    def test_build_dataset_scores_uses_separate_cv_row_for_refit_final(self, mock_polars_df):
        repository = MagicMock()
        repository.query_chain_summaries.return_value = mock_polars_df([
            {
                "chain_id": "chain-cv",
                "run_id": "run-001",
                "pipeline_id": "pipe-001",
                "dataset_name": "dataset_a",
                "metric": "rmse",
                "task_type": "regression",
                "model_name": "Model A",
                "model_class": "PLSRegression",
                "cv_val_score": 0.12,
                "final_test_score": None,
            },
            {
                "chain_id": "chain-refit",
                "run_id": "run-001",
                "pipeline_id": "pipe-001-refit",
                "dataset_name": "dataset_a",
                "metric": "rmse",
                "task_type": "regression",
                "model_name": "Model A",
                "model_class": "PLSRegression",
                "cv_val_score": None,
                "final_test_score": 0.18,
            },
        ])

        from api.workspace.services import _build_dataset_scores_payload

        payload = _build_dataset_scores_payload(
            repository,
            workspace_id="ws_001",
            linked_datasets=[{"id": "ds_linked", "name": "dataset_a", "path": ""}],
        )

        score_entry = payload["datasets"][0]
        assert score_entry["score_kind"] == "final"
        assert score_entry["best_score"] == 0.18
        assert score_entry["cv_score"] == 0.12

    def test_build_dataset_scores_accepts_results_repository(self, mock_polars_df):
        repository = MagicMock()
        repository.query_chain_summaries.return_value = mock_polars_df([
            {
                "chain_id": "chain-native",
                "run_id": "run-001",
                "pipeline_id": "pipe-001",
                "dataset_name": "native_dataset",
                "metric": "r2",
                "task_type": "regression",
                "model_name": "Native Model",
                "model_class": "PLSRegression",
                "cv_val_score": 0.72,
                "final_test_score": 0.81,
            },
        ])

        from api.workspace.services import _build_dataset_scores_payload

        payload = _build_dataset_scores_payload(
            repository,
            workspace_id="ws_native",
            linked_datasets=[{"id": "ds_native", "name": "native_dataset", "path": ""}],
        )

        repository.query_chain_summaries.assert_called_once_with()
        assert payload["workspace_id"] == "ws_native"
        assert payload["datasets"] == [
            {
                "dataset_name": "native_dataset",
                "linked_dataset_id": "ds_native",
                "metric": "r2",
                "best_score": 0.81,
                "cv_score": 0.72,
                "score_kind": "final",
                "model_name": "Native Model",
                "name": "native_dataset",
            }
        ]

    def test_normalize_run_dataset_entries_backfills_name_and_dataset_name(self):
        from api.workspace.services import _normalize_run_dataset_entries

        normalized = _normalize_run_dataset_entries([
            {"name": "regression"},
            {"dataset_name": "classification"},
            "synthetic_regression",
        ])

        assert normalized == [
            {"name": "regression", "dataset_name": "regression"},
            {"dataset_name": "classification", "name": "classification"},
            {"name": "synthetic_regression", "dataset_name": "synthetic_regression"},
        ]

    def test_resolve_dataset_mapping_matches_name_only_historical_run_entries(self):
        from api.workspace.services import _resolve_dataset_mapping

        datasets_result = [{"name": "regression"}]

        _resolve_dataset_mapping(
            datasets_result,
            linked_datasets=[{"id": "ds_reg", "name": "regression", "path": "D:/datasets/regression"}],
        )

        assert datasets_result[0]["linked_dataset_id"] == "ds_reg"
        assert datasets_result[0]["dataset_name"] == "regression"

    def test_resolve_dataset_mapping_keeps_prefix_matching_when_linked_id_is_null(self):
        from api.workspace.services import _resolve_dataset_mapping

        datasets_result = [{
            "name": "regression_Xcal.csv",
            "dataset_name": "regression_Xcal.csv",
            "linked_dataset_id": None,
        }]

        _resolve_dataset_mapping(
            datasets_result,
            linked_datasets=[{"id": "ds_reg", "name": "regression", "path": "D:/datasets/regression"}],
        )

        assert datasets_result[0]["linked_dataset_id"] == "ds_reg"

    def test_resolve_dataset_mapping_remaps_stale_linked_dataset_id(self):
        from api.workspace.services import _resolve_dataset_mapping

        datasets_result = [{"name": "regression", "linked_dataset_id": "old_reg"}]

        _resolve_dataset_mapping(
            datasets_result,
            linked_datasets=[{"id": "ds_reg", "name": "regression", "path": "D:/datasets/regression"}],
        )

        assert datasets_result[0]["linked_dataset_id"] == "ds_reg"

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
            "sample_ids": np.array(["sample-a", "sample-b", "sample-c"]),
            "sample_metadata": {"batch": ["A", "B", "A"]},
        }

        adapter = self._make_adapter(mock_store)
        result = adapter.get_prediction_scatter("pred-001")

        assert result is not None
        assert result["n_samples"] == 3
        assert len(result["y_true"]) == 3
        assert len(result["y_pred"]) == 3
        assert result["sample_ids"] == ["sample-a", "sample-b", "sample-c"]
        assert result["sample_metadata"] == {"batch": ["A", "B", "A"]}

    def test_get_prediction_scatter_refuses_positional_or_misaligned_sample_ids(self):
        import numpy as np

        mock_store = MagicMock()
        mock_store.get_prediction.return_value = {
            "prediction_id": "pred-001",
            "y_true": np.array([1.0, 2.0]),
            "y_pred": np.array([1.1, 2.1]),
            "sample_ids": np.array([0, 1]),
        }

        result = self._make_adapter(mock_store).get_prediction_scatter("pred-001")

        assert result is not None
        assert result["sample_ids"] is None

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

    def test_delete_chain_predictions_removes_matching_cv_refit_siblings(self, mock_polars_df):
        mock_store = MagicMock()
        selected_row = {
            "chain_id": "chain-cv",
            "run_id": "run-001",
            "pipeline_id": "pipe-cv",
            "dataset_name": "dataset_a",
            "model_class": "PLSRegression",
            "model_name": "PLSRegression",
            "preprocessings": "SNV",
            "best_params": {"n_components": 10},
            "model_step_idx": 1,
            "cv_val_score": 0.12,
            "cv_test_score": 0.15,
            "cv_train_score": 0.10,
            "cv_fold_count": 5,
            "cv_scores": {},
            "final_test_score": None,
            "final_train_score": None,
            "final_scores": {},
        }
        sibling_refit = {
            **selected_row,
            "chain_id": "chain-refit",
            "pipeline_id": "pipe-refit",
            "cv_val_score": None,
            "cv_test_score": None,
            "cv_train_score": None,
            "cv_fold_count": 0,
            "final_test_score": 0.09,
            "final_train_score": 0.07,
        }
        other_variant = {
            **selected_row,
            "chain_id": "chain-other",
            "pipeline_id": "pipe-other",
            "best_params": {"n_components": 5},
            "cv_val_score": 0.18,
        }

        mock_store.query_chain_summaries.side_effect = [
            mock_polars_df([selected_row]),
            mock_polars_df([selected_row, sibling_refit, other_variant]),
        ]
        mock_store._fetch_pl.return_value = mock_polars_df([
            {
                "pipeline_id": "pipe-cv",
                "name": "CV",
                "expanded_config": [{"model": {"params": {"n_components": 10}}}],
                "generator_choices": None,
            },
            {
                "pipeline_id": "pipe-refit",
                "name": "Refit",
                "expanded_config": [{"model": {"params": {"n_components": 10}}}],
                "generator_choices": None,
            },
            {
                "pipeline_id": "pipe-other",
                "name": "Other",
                "expanded_config": [{"model": {"params": {"n_components": 5}}}],
                "generator_choices": None,
            },
        ])
        mock_store.delete_predictions_matching.side_effect = [
            {
                "success": True,
                "deleted_predictions": 3,
                "deleted_arrays": 3,
                "deleted_chains": 1,
                "deleted_pipelines": 0,
                "deleted_artifacts": 0,
                "updated_chains": 0,
            },
            {
                "success": True,
                "deleted_predictions": 1,
                "deleted_arrays": 1,
                "deleted_chains": 1,
                "deleted_pipelines": 1,
                "deleted_artifacts": 1,
                "updated_chains": 0,
            },
        ]

        adapter = self._make_adapter(mock_store)
        result = adapter.delete_chain_predictions("chain-cv")

        assert result["success"] is True
        assert result["deleted_predictions"] == 4
        assert result["deleted_arrays"] == 4
        assert result["deleted_chains"] == 2
        assert result["deleted_pipelines"] == 1
        assert result["deleted_artifacts"] == 1
        assert mock_store.delete_predictions_matching.call_count == 2
        mock_store.delete_predictions_matching.assert_any_call(chain_id="chain-cv")
        mock_store.delete_predictions_matching.assert_any_call(chain_id="chain-refit")

    def test_delete_chain_predictions_does_not_cross_variant_boundaries(self, mock_polars_df):
        mock_store = MagicMock()
        selected_row = {
            "chain_id": "chain-cv",
            "run_id": "run-001",
            "pipeline_id": "pipe-cv",
            "dataset_name": "dataset_a",
            "model_class": "PLSRegression",
            "model_name": "PLSRegression",
            "preprocessings": "SNV",
            "best_params": {"n_components": 10},
            "model_step_idx": 1,
            "cv_val_score": 0.12,
            "cv_test_score": 0.15,
            "cv_train_score": 0.10,
            "cv_fold_count": 5,
            "cv_scores": {},
            "final_test_score": None,
            "final_train_score": None,
            "final_scores": {},
        }
        other_model = {
            **selected_row,
            "chain_id": "chain-rf",
            "pipeline_id": "pipe-rf",
            "model_class": "RandomForestRegressor",
            "model_name": "RandomForestRegressor",
            "best_params": {"n_estimators": 200},
        }

        mock_store.query_chain_summaries.side_effect = [
            mock_polars_df([selected_row]),
            mock_polars_df([selected_row, other_model]),
        ]
        mock_store._fetch_pl.return_value = mock_polars_df([
            {
                "pipeline_id": "pipe-cv",
                "name": "CV",
                "expanded_config": [{"model": {"params": {"n_components": 10}}}],
                "generator_choices": None,
            },
            {
                "pipeline_id": "pipe-rf",
                "name": "RF",
                "expanded_config": [{"model": {"params": {"n_estimators": 200}}}],
                "generator_choices": None,
            },
        ])
        mock_store.delete_predictions_matching.return_value = {
            "success": True,
            "deleted_predictions": 3,
            "deleted_arrays": 3,
            "deleted_chains": 1,
            "deleted_pipelines": 1,
            "deleted_artifacts": 0,
            "updated_chains": 0,
        }

        adapter = self._make_adapter(mock_store)
        result = adapter.delete_chain_predictions("chain-cv")

        assert result["deleted_predictions"] == 3
        mock_store.delete_predictions_matching.assert_called_once_with(chain_id="chain-cv")

    def test_delete_prediction_group_uses_private_matching_api_on_legacy_store(self):
        class LegacyStore:
            def __init__(self):
                self.calls = []

            def _delete_predictions_matching(self, **kwargs):
                self.calls.append(kwargs)
                return {
                    "success": True,
                    "deleted_predictions": 2,
                    "deleted_arrays": 2,
                    "deleted_chains": 1,
                    "deleted_pipelines": 0,
                    "deleted_artifacts": 0,
                    "updated_chains": 0,
                }

        legacy_store = LegacyStore()
        adapter = self._make_adapter(legacy_store)

        result = adapter.delete_prediction_group("chain-cv", "final")

        assert result["success"] is True
        assert result["deleted_predictions"] == 2
        assert legacy_store.calls == [{"chain_id": "chain-cv", "fold_id": "final"}]

    def test_delete_dataset_predictions_uses_legacy_dataset_delete_count(self):
        class LegacyStore:
            def __init__(self):
                self.deleted_dataset = None

            def delete_dataset_predictions(self, dataset_name):
                self.deleted_dataset = dataset_name
                return 4

        legacy_store = LegacyStore()
        adapter = self._make_adapter(legacy_store)

        result = adapter.delete_dataset_predictions("corn")

        assert result["success"] is True
        assert result["deleted_predictions"] == 4
        assert legacy_store.deleted_dataset == "corn"

    def test_context_manager_calls_close(self):
        mock_store = MagicMock()
        adapter = self._make_adapter(mock_store)

        with adapter:
            pass

        mock_store.close.assert_called_once()


class TestWorkspaceResultsCaches:
    def test_invalidate_results_caches_accepts_workspace_path(self, tmp_path):
        from api.workspace import _shared as workspace_module

        workspace_dir = tmp_path / "workspace"
        workspace_dir.mkdir()
        workspace_id = "ws_cache_test"
        summary_key = (workspace_id, (("store.duckdb", 1, 1),), (), ("summary", 5))
        scores_key = (workspace_id, (("store.duckdb", 1, 1),), (), ("dataset_scores",))

        workspace_module._RESULTS_SUMMARY_CACHE.clear()
        workspace_module._DATASET_SCORES_CACHE.clear()
        workspace_module._RESULTS_SUMMARY_CACHE[summary_key] = {"ok": True}
        workspace_module._DATASET_SCORES_CACHE[scores_key] = {"ok": True}

        linked_ws = MagicMock(id=workspace_id, path=str(workspace_dir))
        with patch.object(
            workspace_module.workspace_manager,
            "get_linked_workspaces",
            return_value=[linked_ws],
        ):
            workspace_module._invalidate_results_caches(str(workspace_dir))

        assert summary_key not in workspace_module._RESULTS_SUMMARY_CACHE
        assert scores_key not in workspace_module._DATASET_SCORES_CACHE

    def test_store_signature_uses_resolved_nested_store_root(self, tmp_path):
        from api.workspace import _shared as workspace_module

        workspace_dir = tmp_path / "project" / "workspace"
        workspace_dir.mkdir(parents=True)
        store_file = workspace_dir / "store.duckdb"
        store_file.write_bytes(b"store")

        stat = store_file.stat()
        assert workspace_module._store_signature(tmp_path / "project") == (
            ("store.duckdb", stat.st_mtime_ns, stat.st_size),
        )

    def test_store_signature_includes_wal_sidecars(self, tmp_path):
        from api.workspace import _shared as workspace_module

        workspace_dir = tmp_path / "workspace"
        workspace_dir.mkdir()
        store_file = workspace_dir / "store.duckdb"
        wal_file = workspace_dir / "store.duckdb.wal"
        store_file.write_bytes(b"store")
        wal_file.write_bytes(b"wal")

        first_signature = workspace_module._store_signature(workspace_dir)
        assert first_signature is not None
        assert any(part[0] == "store.duckdb.wal" for part in first_signature)

        wal_file.write_bytes(b"wal-updated")

        second_signature = workspace_module._store_signature(workspace_dir)
        assert second_signature != first_signature

    def test_storage_status_opens_adapter_at_resolved_store_root(self, tmp_path):
        from api.workspace import _shared as workspace_module

        workspace_dir = tmp_path / "project" / "workspace"
        workspace_dir.mkdir(parents=True)
        (workspace_dir / "store.duckdb").touch()
        expected_status = {
            "storage_mode": "legacy",
            "has_prediction_arrays_table": True,
            "has_arrays_directory": False,
            "migration_needed": True,
        }
        adapter_cm = MagicMock()
        adapter_cm.__enter__.return_value.get_store_status.return_value = expected_status

        with (
            patch.object(workspace_module, "STORE_AVAILABLE", True),
            patch.object(workspace_module, "StoreAdapter", return_value=adapter_cm) as adapter_cls,
        ):
            status = workspace_module._get_storage_status_for_workspace(tmp_path / "project")

        assert status == expected_status
        adapter_cls.assert_called_once_with(workspace_dir)


class TestWorkspaceResultsSummaryEndpoint:
    def test_results_summary_uses_results_repository_without_store(self, tmp_path, mock_polars_df):
        from api.workspace import router_discovery

        linked_ws = MagicMock()
        linked_ws.path = str(tmp_path)

        chain_rows = [
            {
                "chain_id": "chain-cv-best",
                "run_id": "run-001",
                "pipeline_id": "pipe-001",
                "dataset_name": "native_dataset",
                "metric": "r2",
                "task_type": "regression",
                "model_name": "Native CV",
                "model_class": "PLSRegression",
                "preprocessings": "SNV",
                "cv_val_score": 0.91,
                "cv_test_score": 0.88,
                "cv_train_score": 0.93,
                "cv_fold_count": 5,
                "cv_scores": {},
                "final_test_score": 0.89,
                "final_train_score": 0.94,
                "final_scores": {},
                "best_params": {"n_components": 4},
                "model_step_idx": 1,
            },
            {
                "chain_id": "chain-final-best",
                "run_id": "run-002",
                "pipeline_id": "pipe-002",
                "dataset_name": "native_dataset",
                "metric": "r2",
                "task_type": "regression",
                "model_name": "Native Final",
                "model_class": "PLSRegression",
                "preprocessings": "MSC",
                "cv_val_score": 0.72,
                "cv_test_score": 0.70,
                "cv_train_score": 0.75,
                "cv_fold_count": 5,
                "cv_scores": {},
                "final_test_score": 0.97,
                "final_train_score": 0.98,
                "final_scores": {},
                "best_params": None,
                "model_step_idx": 1,
            },
            {
                "chain_id": "chain-refit-only",
                "run_id": "run-003",
                "pipeline_id": "pipe-003",
                "dataset_name": "native_dataset",
                "metric": "r2",
                "task_type": "regression",
                "model_name": "Native Refit",
                "model_class": "PLSRegression",
                "preprocessings": "SNV",
                "cv_val_score": None,
                "cv_test_score": None,
                "cv_train_score": None,
                "cv_fold_count": 0,
                "cv_scores": {},
                "final_test_score": 0.80,
                "final_train_score": 0.82,
                "final_scores": {},
                "best_params": None,
                "model_step_idx": 1,
            },
        ]
        repository = MagicMock()
        repository.query_chain_summaries.return_value = mock_polars_df(chain_rows)
        repository.query_top_chains.return_value = mock_polars_df([chain_rows[0]])
        repository.get_pipeline.side_effect = lambda pipeline_id: {"pipeline_id": pipeline_id, "name": f"Pipeline {pipeline_id}"}

        with (
            patch.object(router_discovery.workspace_manager, "_find_linked_workspace", return_value=linked_ws),
            patch.object(router_discovery.app_config, "get_datasets", return_value=[{"id": "ds_native", "name": "native_dataset", "path": ""}]),
            patch.object(router_discovery, "resolve_results_repository", return_value=repository) as resolver,
        ):
            payload = asyncio.run(router_discovery.get_workspace_results_summary("ws_native", n=1))

        resolver.assert_called_once()
        assert resolver.call_args.args[0] == tmp_path
        assert "workspace_store_factory" in resolver.call_args.kwargs
        repository.query_chain_summaries.assert_called_once_with()
        repository.query_top_chains.assert_called_once_with(
            dataset_name="native_dataset",
            metric="r2",
            n=1,
            score_column="cv_val_score",
        )
        repository.close.assert_called_once_with()

        assert payload["workspace_id"] == "ws_native"
        assert payload["datasets"][0]["linked_dataset_id"] == "ds_native"
        top_chains = payload["datasets"][0]["top_chains"]
        assert [chain["chain_id"] for chain in top_chains] == ["chain-cv-best", "chain-refit-only", "chain-final-best"]
        assert top_chains[0]["avg_val_score"] == 0.91
        assert top_chains[0]["pipeline_name"] == "Pipeline pipe-001"
        assert top_chains[1]["is_refit_only"] is True
        assert top_chains[2]["final_test_score"] == 0.97

    def test_results_summary_returns_empty_when_repository_missing(self, tmp_path):
        from api.workspace import router_discovery

        linked_ws = MagicMock()
        linked_ws.path = str(tmp_path)

        with (
            patch.object(router_discovery.workspace_manager, "_find_linked_workspace", return_value=linked_ws),
            patch.object(router_discovery.app_config, "get_datasets", return_value=[]),
            patch.object(
                router_discovery,
                "resolve_results_repository",
                side_effect=router_discovery.ResultsRepositoryNotFound("missing"),
            ) as resolver,
        ):
            payload = asyncio.run(router_discovery.get_workspace_results_summary("ws_missing"))

        resolver.assert_called_once()
        assert payload == {"workspace_id": "ws_missing", "datasets": []}


class TestWorkspaceDatasetScoresEndpoint:
    def test_dataset_scores_uses_results_repository_without_store(self, tmp_path, mock_polars_df):
        from api.workspace import router_discovery

        linked_ws = MagicMock()
        linked_ws.path = str(tmp_path)

        repository = MagicMock()
        repository.query_chain_summaries.return_value = mock_polars_df([
            {
                "chain_id": "chain-native",
                "run_id": "run-001",
                "pipeline_id": "pipe-001",
                "dataset_name": "native_dataset",
                "metric": "r2",
                "task_type": "regression",
                "model_name": "Native Model",
                "model_class": "PLSRegression",
                "cv_val_score": 0.72,
                "final_test_score": 0.81,
            },
        ])

        with (
            patch.object(router_discovery.workspace_manager, "_find_linked_workspace", return_value=linked_ws),
            patch.object(router_discovery.app_config, "get_datasets", return_value=[{"id": "ds_native", "name": "native_dataset", "path": ""}]),
            patch.object(router_discovery, "resolve_results_repository", return_value=repository) as resolver,
        ):
            payload = asyncio.run(router_discovery.get_workspace_dataset_scores("ws_native"))

        resolver.assert_called_once()
        assert resolver.call_args.args[0] == tmp_path
        assert "workspace_store_factory" in resolver.call_args.kwargs
        repository.query_chain_summaries.assert_called_once_with()
        repository.close.assert_called_once_with()
        assert payload["workspace_id"] == "ws_native"
        assert payload["datasets"][0]["linked_dataset_id"] == "ds_native"
        assert payload["datasets"][0]["best_score"] == 0.81

    def test_dataset_scores_returns_empty_when_repository_missing(self, tmp_path):
        from api.workspace import router_discovery

        linked_ws = MagicMock()
        linked_ws.path = str(tmp_path)

        with (
            patch.object(router_discovery.workspace_manager, "_find_linked_workspace", return_value=linked_ws),
            patch.object(router_discovery.app_config, "get_datasets", return_value=[]),
            patch.object(
                router_discovery,
                "resolve_results_repository",
                side_effect=router_discovery.ResultsRepositoryNotFound("missing"),
            ) as resolver,
        ):
            payload = asyncio.run(router_discovery.get_workspace_dataset_scores("ws_missing"))

        resolver.assert_called_once()
        assert payload == {"workspace_id": "ws_missing", "datasets": []}


class TestWorkspaceServicesStoreResolution:
    def test_legacy_arrays_row_count_uses_resolved_store_root(self, tmp_path):
        from api.workspace import services as workspace_services

        class FakeFrame:
            def __init__(self, rows):
                self._rows = rows

            def __len__(self):
                return len(self._rows)

            def row(self, index, named=False):
                assert named is True
                return self._rows[index]

        store_paths = []

        class FakeWorkspaceStore:
            def __init__(self, path):
                store_paths.append(path)

            def _fetch_pl(self, sql, params=None):
                if "information_schema.tables" in sql:
                    return FakeFrame([{"cnt": 1}])
                return FakeFrame([{"cnt": 7}])

        workspace_dir = tmp_path / "project" / "workspace"
        workspace_dir.mkdir(parents=True)
        (workspace_dir / "store.duckdb").touch()

        with (
            patch.object(workspace_services, "STORE_AVAILABLE", True),
            patch.object(workspace_services, "get_cached", return_value=FakeWorkspaceStore),
        ):
            row_count = workspace_services._get_legacy_arrays_row_count(tmp_path / "project")

        assert row_count == 7
        assert store_paths == [workspace_dir]


# ---------------------------------------------------------------------------
# WorkspaceScanner DuckDB path tests
# ---------------------------------------------------------------------------


class TestWorkspaceScannerStore:
    """Tests for WorkspaceScanner store-first discovery paths."""

    def _make_native_repository(self, mock_polars_df):
        chain_rows = [
            {
                "chain_id": "run-native::variant-a",
                "run_id": "run-native",
                "pipeline_id": "run-native",
                "dataset_name": "dataset_a",
                "metric": "rmse",
                "task_type": "regression",
                "model_name": "PLS(3)",
                "model_class": "PLSRegression",
                "preprocessings": "variant-a",
                "cv_val_score": 0.12,
                "cv_test_score": 0.14,
                "final_test_score": 0.11,
                "pipeline_status": "completed",
            },
            {
                "chain_id": "run-native::variant-b",
                "run_id": "run-native",
                "pipeline_id": "run-native",
                "dataset_name": "dataset_b",
                "metric": "rmse",
                "task_type": "regression",
                "model_name": "PLS(5)",
                "model_class": "PLSRegression",
                "preprocessings": "variant-b",
                "cv_val_score": 0.20,
                "cv_test_score": 0.22,
                "final_test_score": 0.18,
                "pipeline_status": "completed",
            },
            {
                "chain_id": "run-other::variant-c",
                "run_id": "run-other",
                "pipeline_id": "run-other",
                "dataset_name": "dataset_c",
                "metric": "rmse",
                "task_type": "regression",
                "model_name": "SVR",
                "model_class": "SVR",
                "preprocessings": "variant-c",
                "cv_val_score": 0.30,
                "cv_test_score": 0.33,
                "final_test_score": 0.29,
                "pipeline_status": "completed",
            },
        ]
        prediction_rows_by_chain = {
            "run-native::variant-a": [
                {"prediction_id": "pred-a-val", "dataset_name": "dataset_a", "partition": "val"},
                {"prediction_id": "pred-a-test", "dataset_name": "dataset_a", "partition": "test"},
            ],
            "run-native::variant-b": [
                {"prediction_id": "pred-b-test", "dataset_name": "dataset_b", "partition": "test"},
            ],
            "run-other::variant-c": [
                {"prediction_id": "pred-c-test", "dataset_name": "dataset_c", "partition": "test"},
            ],
        }

        repository = MagicMock()

        def query_chain_summaries(**filters):
            run_id = filters.get("run_id")
            rows = [row for row in chain_rows if run_id is None or row["run_id"] == run_id]
            return mock_polars_df(rows)

        def get_chain_predictions(chain_id, partition=None, fold_id=None):
            rows = prediction_rows_by_chain.get(chain_id, [])
            if partition is not None:
                rows = [row for row in rows if row.get("partition") == partition]
            return mock_polars_df(rows)

        repository.query_chain_summaries.side_effect = query_chain_summaries
        repository.get_chain_predictions.side_effect = get_chain_predictions
        repository.get_pipeline.side_effect = lambda pipeline_id: {
            "pipeline_id": pipeline_id,
            "name": f"{pipeline_id} display",
            "status": "completed",
        }
        return repository

    def test_results_repository_uses_shared_resolver(self, tmp_path):
        """WorkspaceScanner should delegate store/native resolution to the shared resolver."""
        from api.workspace_manager import WorkspaceScanner

        repository = MagicMock()

        with patch("api.workspace_scanner.resolve_results_repository", return_value=repository) as resolver:
            scanner = WorkspaceScanner(tmp_path)

            assert scanner.results_repository is repository
            assert scanner.results_repository is repository

        resolver.assert_called_once()

    def test_discover_runs_from_native_results_repository(self, tmp_path, mock_polars_df):
        """When no store exists, discover_runs() should project native repository summaries."""
        from api.workspace_manager import WorkspaceScanner

        repository = self._make_native_repository(mock_polars_df)
        scanner = WorkspaceScanner(tmp_path)
        scanner._results_repository = repository

        runs = scanner.discover_runs()
        native_run = next(run for run in runs if run["id"] == "run-native")

        assert native_run["format"] == "native"
        assert native_run["name"] == "run-native display"
        assert native_run["results_count"] == 2
        assert native_run["predictions_count"] == 3
        assert native_run["datasets"] == [{"name": "dataset_a"}, {"name": "dataset_b"}]
        assert native_run["summary"]["models"] == ["PLS(3)", "PLS(5)"]
        assert native_run["summary"]["metrics"] == ["rmse"]

    def test_discover_predictions_from_native_results_repository(self, tmp_path, mock_polars_df):
        """When no store exists, discover_predictions() should group native predictions by dataset."""
        from api.workspace_manager import WorkspaceScanner

        repository = self._make_native_repository(mock_polars_df)
        scanner = WorkspaceScanner(tmp_path)
        scanner._results_repository = repository

        predictions = scanner.discover_predictions()
        by_dataset = {prediction["dataset"]: prediction for prediction in predictions}

        assert by_dataset["dataset_a"]["format"] == "native"
        assert by_dataset["dataset_a"]["prediction_count"] == 2
        assert by_dataset["dataset_a"]["chains_count"] == 1
        assert by_dataset["dataset_b"]["prediction_count"] == 1
        assert by_dataset["dataset_c"]["prediction_count"] == 1

    def test_discover_results_from_native_results_repository_filters_run(self, tmp_path, mock_polars_df):
        """When no store exists, discover_results(run_id) should project native chains as results."""
        from api.workspace_manager import WorkspaceScanner

        repository = self._make_native_repository(mock_polars_df)
        scanner = WorkspaceScanner(tmp_path)
        scanner._results_repository = repository

        results = scanner.discover_results(run_id="run-native")
        by_id = {result["id"]: result for result in results}

        assert set(by_id) == {"run-native::variant-a", "run-native::variant-b"}
        assert by_id["run-native::variant-a"]["format"] == "native"
        assert by_id["run-native::variant-a"]["dataset"] == "dataset_a"
        assert by_id["run-native::variant-a"]["pipeline_config"] == "variant-a"
        assert by_id["run-native::variant-a"]["best_score"] == 0.12
        assert by_id["run-native::variant-a"]["best_test_score"] == 0.11
        assert by_id["run-native::variant-a"]["predictions_count"] == 2
        repository.query_chain_summaries.assert_called_once_with(run_id="run-native")

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
        assert "store" in reason.lower()


# ---------------------------------------------------------------------------
# Sanitization helpers
# ---------------------------------------------------------------------------


class TestSanitization:
    """Tests for the shared NaN/Inf sanitization helpers (api.shared.json_safe)."""

    def test_sanitize_float_nan(self):
        from api.shared.json_safe import sanitize_float
        assert sanitize_float(float("nan")) is None

    def test_sanitize_float_inf(self):
        from api.shared.json_safe import sanitize_float
        assert sanitize_float(float("inf")) is None
        assert sanitize_float(float("-inf")) is None

    def test_sanitize_float_normal(self):
        from api.shared.json_safe import sanitize_float
        assert sanitize_float(3.14) == 3.14

    def test_sanitize_dict_nested(self):
        from api.shared.json_safe import sanitize_dict
        data = {
            "score": float("nan"),
            "nested": {"val": float("inf"), "ok": 1.0},
            "list_field": [1.0, float("nan"), 3.0],
        }
        result = sanitize_dict(data)
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
