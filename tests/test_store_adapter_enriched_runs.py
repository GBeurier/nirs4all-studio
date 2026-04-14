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
