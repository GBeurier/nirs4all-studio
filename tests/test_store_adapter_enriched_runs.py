from __future__ import annotations

import sys
from datetime import UTC, datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))


class _FakeFrame:
    def __init__(self, rows):
        self._rows = rows

    def __len__(self):
        return len(self._rows)

    def iter_rows(self, named=False):
        if named:
            return iter(self._rows)
        return iter(tuple(row.values()) for row in self._rows)

    def row(self, idx, named=False):
        row = self._rows[idx]
        if named:
            return row
        return tuple(row.values())


def _frame(rows):
    return _FakeFrame(rows)


def test_get_enriched_runs_recovers_from_missing_aggregated_metric():
    from api.store_adapter import StoreAdapter

    mock_store = MagicMock()
    mock_store.list_runs.return_value = _frame(
        [
            {
                "run_id": "run-001",
                "name": "Legacy Run",
                "status": "completed",
                "project_id": None,
                "created_at": datetime(2026, 4, 1, 8, 0, tzinfo=UTC),
                "completed_at": datetime(2026, 4, 1, 8, 5, tzinfo=UTC),
                "datasets": '[{"name":"dataset_a","n_samples":12,"n_features":4}]',
                "config": '{"n_pipelines": 1}',
                "error": None,
            }
        ]
    )
    mock_store.list_pipelines.return_value = _frame([{"pipeline_id": "pipe-001"}])
    mock_store.query_aggregated_predictions.return_value = _frame(
        [
            {
                "dataset_name": "dataset_a",
                "metric": None,
                "cv_val_score": 0.12,
                "cv_test_score": 0.14,
                "cv_train_score": 0.1,
                "chain_id": "chain-001",
                "pipeline_id": "pipe-001",
                "model_name": "PLS(10)",
                "model_class": "PLSRegression",
                "preprocessings": "SNV",
                "cv_fold_count": 5,
                "best_params": None,
            }
        ]
    )
    mock_store.query_predictions.return_value = _frame(
        [
            {
                "task_type": "regression",
                "n_samples": 12,
                "n_features": 4,
                "metric": "rmse",
            }
        ]
    )

    def _fetch_pl(query, params):
        if "SELECT p.chain_id, p.model_name, p.model_class, p.test_score, p.train_score" in query:
            return _frame([])
        if "FROM v_chain_summary WHERE chain_id IN" in query:
            return _frame([])
        if "COUNT(DISTINCT chain_id) as cnt" in query:
            return _frame([{"cnt": 0}])
        if "COUNT(DISTINCT fold_id) as cnt" in query:
            return _frame([{"cnt": 5}])
        if "COUNT(*) as cnt FROM predictions" in query:
            return _frame([{"cnt": 1}])
        if "COUNT(DISTINCT fold_id) as fold_count" in query:
            return _frame([{"fold_count": 5, "metric": None}])
        if "GROUP BY c.model_class ORDER BY count DESC" in query:
            return _frame([{"model_class": "PLSRegression", "count": 1}])
        return _frame([])

    mock_store._fetch_pl.side_effect = _fetch_pl

    adapter = StoreAdapter.__new__(StoreAdapter)
    adapter._store = mock_store
    adapter._get_run_artifact_size = MagicMock(return_value=0)
    adapter._get_dataset_historical_best = MagicMock(return_value=None)

    result = adapter.get_enriched_runs()

    assert result["total"] == 1
    run = result["runs"][0]
    dataset = run["datasets"][0]

    assert dataset["metric"] == "rmse"
    assert dataset["task_type"] == "regression"
    assert run["config"]["metric"] == "rmse"


def test_get_enriched_runs_falls_back_to_pipeline_name_and_keeps_final_agg_scores():
    from api.store_adapter import StoreAdapter

    mock_store = MagicMock()
    mock_store.list_runs.return_value = _frame(
        [
            {
                "run_id": "run-agg-001",
                "name": "run",
                "status": "completed",
                "project_id": None,
                "created_at": datetime(2026, 4, 2, 9, 0, tzinfo=UTC),
                "completed_at": datetime(2026, 4, 2, 9, 5, tzinfo=UTC),
                "datasets": '[{"name":"dataset_a","n_samples":20,"n_features":6}]',
                "config": '{"n_pipelines": 1}',
                "error": None,
            }
        ]
    )
    mock_store.list_pipelines.return_value = _frame(
        [
            {
                "pipeline_id": "pipe-agg-001",
                "name": "wizard-run-name",
                "expanded_config": None,
            }
        ]
    )
    mock_store.query_aggregated_predictions.return_value = _frame(
        [
            {
                "dataset_name": "dataset_a",
                "metric": "rmse",
                "task_type": "regression",
                "cv_val_score": 0.12,
                "cv_test_score": 0.14,
                "cv_train_score": 0.1,
                "cv_scores": {"val": {"rmse": 0.12}, "test": {"rmse": 0.14}},
                "chain_id": "chain-agg-001",
                "pipeline_id": "pipe-agg-001",
                "model_name": "PLS(10)",
                "model_class": "PLSRegression",
                "preprocessings": "SNV",
                "cv_fold_count": 5,
                "best_params": None,
                "final_test_score": 0.11,
                "final_train_score": 0.09,
                "final_scores": {"test": {"rmse": 0.11}},
                "final_agg_test_score": 0.08,
                "final_agg_train_score": 0.07,
                "final_agg_scores": {"test": {"rmse": 0.08}, "train": {"rmse": 0.07}},
            }
        ]
    )
    mock_store.query_predictions.return_value = _frame(
        [
            {
                "task_type": "regression",
                "n_samples": 20,
                "n_features": 6,
                "metric": "rmse",
            }
        ]
    )

    def _fetch_pl(query, params):
        if "SELECT p.chain_id, p.model_name, p.model_class, p.test_score, p.train_score" in query:
            return _frame([])
        if "COUNT(DISTINCT chain_id) as cnt" in query:
            return _frame([{"cnt": 1}])
        if "COUNT(DISTINCT fold_id) as cnt" in query:
            return _frame([{"cnt": 5}])
        if "COUNT(*) as cnt FROM predictions" in query:
            return _frame([{"cnt": 5}])
        if "COUNT(DISTINCT fold_id) as fold_count" in query:
            return _frame([{"fold_count": 5, "metric": "rmse"}])
        if "GROUP BY c.model_class ORDER BY count DESC" in query:
            return _frame([{"model_class": "PLSRegression", "count": 1}])
        return _frame([])

    mock_store._fetch_pl.side_effect = _fetch_pl

    adapter = StoreAdapter.__new__(StoreAdapter)
    adapter._store = mock_store
    adapter._get_run_artifact_size = MagicMock(return_value=0)
    adapter._get_dataset_historical_best = MagicMock(return_value=None)

    result = adapter.get_enriched_runs()

    assert result["total"] == 1
    run = result["runs"][0]
    dataset = run["datasets"][0]
    top_chain = dataset["top_5"][0]

    assert run["name"] == "wizard-run-name"
    assert top_chain["final_agg_test_score"] == 0.08
    assert top_chain["final_agg_train_score"] == 0.07
    assert top_chain["final_agg_scores"] == {"test": {"rmse": 0.08}, "train": {"rmse": 0.07}}


def test_get_enriched_runs_synthesizes_refit_from_cv_when_final_is_missing():
    from api.store_adapter import StoreAdapter

    mock_store = MagicMock()
    mock_store.list_runs.return_value = _frame(
        [
            {
                "run_id": "run-synth-001",
                "name": "Synthetic Refit Run",
                "status": "completed",
                "project_id": None,
                "created_at": datetime(2026, 4, 15, 9, 0, tzinfo=UTC),
                "completed_at": datetime(2026, 4, 15, 9, 5, tzinfo=UTC),
                "datasets": '[{"name":"dataset_a","n_samples":20,"n_features":6}]',
                "config": '{"n_pipelines": 1}',
                "error": None,
            }
        ]
    )
    mock_store.list_pipelines.return_value = _frame(
        [
            {
                "pipeline_id": "pipe-synth-001",
                "name": "Basic PLS Pipeline",
                "expanded_config": None,
            }
        ]
    )
    mock_store.query_aggregated_predictions.return_value = _frame(
        [
            {
                "dataset_name": "dataset_a",
                "metric": "rmse",
                "task_type": "regression",
                "cv_val_score": 19.94,
                "cv_test_score": 13.12,
                "cv_train_score": 4.06,
                "cv_scores": {"val": {"rmse": 19.94}, "test": {"rmse": 13.12}, "train": {"rmse": 4.06}},
                "chain_id": "chain-synth-001",
                "pipeline_id": "pipe-synth-001",
                "model_name": "PLSRegression",
                "model_class": "PLSRegression",
                "preprocessings": "SNV",
                "cv_fold_count": 5,
                "best_params": None,
                "final_test_score": None,
                "final_train_score": None,
                "final_scores": None,
            }
        ]
    )
    mock_store.query_predictions.return_value = _frame(
        [
            {
                "task_type": "regression",
                "n_samples": 20,
                "n_features": 6,
                "metric": "rmse",
            }
        ]
    )

    def _fetch_pl(query, _params):
        if "SELECT p.chain_id, p.model_name, p.model_class, p.test_score, p.train_score" in query:
            return _frame([])
        if "COUNT(DISTINCT chain_id) as cnt" in query:
            return _frame([{"cnt": 0}])
        if "COUNT(DISTINCT fold_id) as cnt" in query:
            return _frame([{"cnt": 5}])
        if "COUNT(*) as cnt FROM predictions" in query:
            return _frame([{"cnt": 5}])
        if "COUNT(DISTINCT fold_id) as fold_count" in query:
            return _frame([{"fold_count": 5, "metric": "rmse"}])
        if "GROUP BY c.model_class ORDER BY count DESC" in query:
            return _frame([{"model_class": "PLSRegression", "count": 1}])
        return _frame([])

    mock_store._fetch_pl.side_effect = _fetch_pl

    adapter = StoreAdapter.__new__(StoreAdapter)
    adapter._store = mock_store
    adapter._get_run_artifact_size = MagicMock(return_value=0)
    adapter._get_dataset_historical_best = MagicMock(return_value=None)

    result = adapter.get_enriched_runs()

    top_chain = result["runs"][0]["datasets"][0]["top_5"][0]
    assert top_chain["final_test_score"] == 13.12
    assert top_chain["final_train_score"] == 4.06
    assert top_chain["final_scores"] == {"val": {"rmse": 19.94}, "test": {"rmse": 13.12}, "train": {"rmse": 4.06}}
    assert top_chain["synthetic_refit"] is True


def test_get_enriched_runs_infers_runtime_config_from_expanded_pipeline():
    from api.store_adapter import StoreAdapter

    mock_store = MagicMock()
    mock_store.list_runs.return_value = _frame(
        [
            {
                "run_id": "run-runtime-001",
                "name": "Runtime Metadata Run",
                "status": "completed",
                "project_id": None,
                "created_at": datetime(2026, 4, 17, 10, 0, tzinfo=UTC),
                "completed_at": datetime(2026, 4, 17, 10, 5, tzinfo=UTC),
                "datasets": '[{"name":"dataset_a","n_samples":20,"n_features":6}]',
                "config": "{}",
                "error": None,
            }
        ]
    )
    mock_store.list_pipelines.return_value = _frame(
        [
            {
                "pipeline_id": "pipe-runtime-001",
                "name": "Runtime-aware pipeline",
                "expanded_config": [
                    {
                        "class": "sklearn.model_selection._split.KFold",
                        "params": {"n_splits": 4, "shuffle": True, "random_state": 42},
                    },
                    {
                        "class": "sklearn.cross_decomposition._pls.PLSRegression",
                        "params": {"n_components": 3},
                    },
                ],
            }
        ]
    )
    mock_store.query_aggregated_predictions.return_value = _frame(
        [
            {
                "dataset_name": "dataset_a",
                "metric": "rmse",
                "task_type": "regression",
                "cv_val_score": 0.12,
                "cv_test_score": 0.14,
                "cv_train_score": 0.1,
                "chain_id": "chain-runtime-001",
                "pipeline_id": "pipe-runtime-001",
                "model_name": "PLSRegression",
                "model_class": "PLSRegression",
                "preprocessings": "SNV",
                "cv_fold_count": 4,
                "best_params": None,
            }
        ]
    )
    mock_store.query_predictions.return_value = _frame(
        [
            {
                "task_type": "regression",
                "n_samples": 20,
                "n_features": 6,
                "metric": "rmse",
            }
        ]
    )

    def _fetch_pl(query, _params):
        if "SELECT p.chain_id, p.model_name, p.model_class, p.test_score, p.train_score" in query:
            return _frame([])
        if "COUNT(DISTINCT chain_id) as cnt" in query:
            return _frame([{"cnt": 0}])
        if "COUNT(DISTINCT fold_id) as cnt" in query:
            return _frame([{"cnt": 4}])
        if "COUNT(*) as cnt FROM predictions" in query:
            return _frame([{"cnt": 4}])
        if "COUNT(DISTINCT fold_id) as fold_count" in query:
            return _frame([{"fold_count": 4, "metric": "rmse"}])
        if "GROUP BY c.model_class ORDER BY count DESC" in query:
            return _frame([{"model_class": "PLSRegression", "count": 1}])
        return _frame([])

    mock_store._fetch_pl.side_effect = _fetch_pl

    adapter = StoreAdapter.__new__(StoreAdapter)
    adapter._store = mock_store
    adapter._get_run_artifact_size = MagicMock(return_value=0)
    adapter._get_dataset_historical_best = MagicMock(return_value=None)

    result = adapter.get_enriched_runs()

    run_config = result["runs"][0]["config"]
    assert run_config["cv_strategy"] == "kfold"
    assert run_config["splitter_class"] == "KFold"
    assert run_config["cv_folds"] == 4
    assert run_config["random_state"] == 42
    assert run_config["shuffle"] is True


def test_get_enriched_runs_ignores_repr_style_refit_splitter_when_inferring_cv_config():
    from api.store_adapter import StoreAdapter

    mock_store = MagicMock()
    mock_store.list_runs.return_value = _frame(
        [
            {
                "run_id": "run-refit-001",
                "name": "Refit Runtime Metadata Run",
                "status": "completed",
                "project_id": None,
                "created_at": datetime(2026, 4, 17, 11, 0, tzinfo=UTC),
                "completed_at": datetime(2026, 4, 17, 11, 5, tzinfo=UTC),
                "datasets": '[{"name":"dataset_a","n_samples":20,"n_features":6}]',
                "config": "{}",
                "error": None,
            }
        ]
    )
    mock_store.list_pipelines.return_value = _frame(
        [
            {
                "pipeline_id": "pipe-refit-001",
                "name": "Refit pipeline",
                "expanded_config": [
                    "<nirs4all.pipeline.execution.refit.executor._FullTrainFoldSplitter object at 0x000001EAEF3C4250>",
                    {
                        "model": {
                            "class": "sklearn.cross_decomposition._pls.PLSRegression",
                            "params": {"n_components": 3},
                        },
                    },
                ],
            },
            {
                "pipeline_id": "pipe-cv-001",
                "name": "CV pipeline",
                "expanded_config": [
                    {
                        "class": "sklearn.model_selection._split.KFold",
                        "params": {"n_splits": 5, "shuffle": True, "random_state": 7},
                    },
                    {
                        "model": {
                            "class": "sklearn.cross_decomposition._pls.PLSRegression",
                            "params": {"n_components": 3},
                        },
                    },
                ],
            },
        ]
    )
    mock_store.query_aggregated_predictions.return_value = _frame(
        [
            {
                "dataset_name": "dataset_a",
                "metric": "rmse",
                "task_type": "regression",
                "cv_val_score": 0.12,
                "cv_test_score": 0.14,
                "cv_train_score": 0.1,
                "chain_id": "chain-refit-001",
                "pipeline_id": "pipe-cv-001",
                "model_name": "PLSRegression",
                "model_class": "PLSRegression",
                "preprocessings": "SNV",
                "cv_fold_count": 5,
                "best_params": None,
            }
        ]
    )
    mock_store.query_predictions.return_value = _frame(
        [
            {
                "task_type": "regression",
                "n_samples": 20,
                "n_features": 6,
                "metric": "rmse",
            }
        ]
    )

    def _fetch_pl(query, _params):
        if "SELECT p.chain_id, p.model_name, p.model_class, p.test_score, p.train_score" in query:
            return _frame([])
        if "COUNT(DISTINCT chain_id) as cnt" in query:
            return _frame([{"cnt": 1}])
        if "COUNT(DISTINCT fold_id) as cnt" in query:
            return _frame([{"cnt": 5}])
        if "COUNT(*) as cnt FROM predictions" in query:
            return _frame([{"cnt": 5}])
        if "COUNT(DISTINCT fold_id) as fold_count" in query:
            return _frame([{"fold_count": 5, "metric": "rmse"}])
        if "GROUP BY c.model_class ORDER BY count DESC" in query:
            return _frame([{"model_class": "PLSRegression", "count": 1}])
        return _frame([])

    mock_store._fetch_pl.side_effect = _fetch_pl

    adapter = StoreAdapter.__new__(StoreAdapter)
    adapter._store = mock_store
    adapter._get_run_artifact_size = MagicMock(return_value=0)
    adapter._get_dataset_historical_best = MagicMock(return_value=None)

    result = adapter.get_enriched_runs()

    run_config = result["runs"][0]["config"]
    assert run_config["cv_strategy"] == "kfold"
    assert run_config["splitter_class"] == "KFold"
    assert run_config["cv_folds"] == 5
    assert run_config["random_state"] == 7
    assert run_config["shuffle"] is True
    assert run_config["has_refit"] is True
