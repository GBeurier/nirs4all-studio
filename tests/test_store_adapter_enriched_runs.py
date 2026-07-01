from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
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


def _build_mock_store(
    *,
    run_rows,
    pipelines_by_run,
    chain_rows_by_run,
    sample_rows=None,
    refit_rows=None,
    counts_by_run=None,
    fold_counts_by_run=None,
    model_counts_by_run=None,
    model_classes_by_run=None,
    cv_info_by_run=None,
):
    """Build a MagicMock store that answers the BATCHED enriched-runs queries.

    ``get_enriched_runs`` issues one chain-summary query (``run_id IN``), one
    pipelines fetch, and one batched ``_fetch_pl`` per aggregate -- never a
    per-run / per-dataset loop. The maps here are keyed by run_id and resolved
    in-memory inside the fake ``_fetch_pl``.
    """
    counts_by_run = counts_by_run or {}
    fold_counts_by_run = fold_counts_by_run or {}
    model_counts_by_run = model_counts_by_run or {}
    model_classes_by_run = model_classes_by_run or {}
    cv_info_by_run = cv_info_by_run or {}

    mock_store = MagicMock()
    mock_store.list_runs.return_value = _frame(run_rows)

    def _query_chain_summaries(run_id=None, **kwargs):
        ids = run_id if isinstance(run_id, list) else [run_id]
        rows = []
        for rid in ids:
            rows.extend(dict(r) for r in chain_rows_by_run.get(rid, []))
        return _frame(rows)

    mock_store.query_chain_summaries.side_effect = _query_chain_summaries

    def _fetch_pl(query, params):
        if query.startswith("SELECT * FROM pipelines WHERE run_id IN"):
            rows = []
            for rid in params:
                rows.extend(dict(r) for r in pipelines_by_run.get(rid, []))
            return _frame(rows)
        if "FROM predictions pr" in query and "pr.task_type" in query:
            return _frame(list(sample_rows or []))
        if "p.refit_context IS NOT NULL AND p.fold_id = 'final'" in query:
            return _frame(list(refit_rows or []))
        if "COUNT(DISTINCT p.chain_id) as cnt" in query:
            return _frame([{"run_id": rid, "cnt": c} for rid, c in counts_by_run.items()])
        if "COUNT(DISTINCT p.fold_id) as cnt" in query:
            return _frame([{"run_id": rid, "cnt": c} for rid, c in fold_counts_by_run.items()])
        if "COUNT(*) as cnt FROM predictions" in query:
            return _frame([{"run_id": rid, "cnt": c} for rid, c in model_counts_by_run.items()])
        if "COUNT(DISTINCT p.fold_id) as fold_count" in query:
            return _frame([
                {"run_id": rid, "fold_count": info.get("fold_count", 0), "metric": info.get("metric")}
                for rid, info in cv_info_by_run.items()
            ])
        if "GROUP BY pl.run_id, c.model_class" in query:
            rows = []
            for rid, classes in model_classes_by_run.items():
                for entry in classes:
                    rows.append({"run_id": rid, "model_class": entry["name"], "count": entry["count"]})
            return _frame(rows)
        return _frame([])

    mock_store._fetch_pl.side_effect = _fetch_pl
    return mock_store


def _make_adapter(mock_store):
    from api.store_adapter import StoreAdapter

    adapter = StoreAdapter.__new__(StoreAdapter)
    adapter._store = mock_store
    adapter._get_run_artifact_size = MagicMock(return_value=0)
    adapter._get_dataset_historical_best = MagicMock(return_value=None)
    return adapter


def test_get_enriched_runs_recovers_from_missing_aggregated_metric():
    mock_store = _build_mock_store(
        run_rows=[
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
        ],
        pipelines_by_run={"run-001": [{"run_id": "run-001", "pipeline_id": "pipe-001"}]},
        chain_rows_by_run={
            "run-001": [
                {
                    "run_id": "run-001",
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
        },
        sample_rows=[
            {"run_id": "run-001", "dataset_name": "dataset_a", "task_type": "regression",
             "n_samples": 12, "n_features": 4, "metric": "rmse"}
        ],
        counts_by_run={"run-001": 0},
        fold_counts_by_run={"run-001": 5},
        model_counts_by_run={"run-001": 1},
        cv_info_by_run={"run-001": {"fold_count": 5, "metric": None}},
        model_classes_by_run={"run-001": [{"name": "PLSRegression", "count": 1}]},
    )

    adapter = _make_adapter(mock_store)
    result = adapter.get_enriched_runs()

    assert result["total"] == 1
    run = result["runs"][0]
    dataset = run["datasets"][0]

    assert dataset["metric"] == "rmse"
    assert dataset["task_type"] == "regression"
    assert run["config"]["metric"] == "rmse"


def test_get_enriched_runs_falls_back_to_pipeline_name_and_keeps_final_agg_scores():
    mock_store = _build_mock_store(
        run_rows=[
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
        ],
        pipelines_by_run={
            "run-agg-001": [
                {"run_id": "run-agg-001", "pipeline_id": "pipe-agg-001",
                 "name": "wizard-run-name", "expanded_config": None}
            ]
        },
        chain_rows_by_run={
            "run-agg-001": [
                {
                    "run_id": "run-agg-001",
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
        },
        sample_rows=[
            {"run_id": "run-agg-001", "dataset_name": "dataset_a", "task_type": "regression",
             "n_samples": 20, "n_features": 6, "metric": "rmse"}
        ],
        counts_by_run={"run-agg-001": 1},
        fold_counts_by_run={"run-agg-001": 5},
        model_counts_by_run={"run-agg-001": 5},
        cv_info_by_run={"run-agg-001": {"fold_count": 5, "metric": "rmse"}},
        model_classes_by_run={"run-agg-001": [{"name": "PLSRegression", "count": 1}]},
    )

    adapter = _make_adapter(mock_store)
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
    mock_store = _build_mock_store(
        run_rows=[
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
        ],
        pipelines_by_run={
            "run-synth-001": [
                {"run_id": "run-synth-001", "pipeline_id": "pipe-synth-001",
                 "name": "Basic PLS Pipeline", "expanded_config": None}
            ]
        },
        chain_rows_by_run={
            "run-synth-001": [
                {
                    "run_id": "run-synth-001",
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
        },
        sample_rows=[
            {"run_id": "run-synth-001", "dataset_name": "dataset_a", "task_type": "regression",
             "n_samples": 20, "n_features": 6, "metric": "rmse"}
        ],
        counts_by_run={"run-synth-001": 0},
        fold_counts_by_run={"run-synth-001": 5},
        model_counts_by_run={"run-synth-001": 5},
        cv_info_by_run={"run-synth-001": {"fold_count": 5, "metric": "rmse"}},
        model_classes_by_run={"run-synth-001": [{"name": "PLSRegression", "count": 1}]},
    )

    adapter = _make_adapter(mock_store)
    result = adapter.get_enriched_runs()

    top_chain = result["runs"][0]["datasets"][0]["top_5"][0]
    assert top_chain["final_test_score"] == 13.12
    assert top_chain["final_train_score"] == 4.06
    assert top_chain["final_scores"] == {"val": {"rmse": 19.94}, "test": {"rmse": 13.12}, "train": {"rmse": 4.06}}
    assert top_chain["synthetic_refit"] is True


def test_get_enriched_runs_infers_runtime_config_from_expanded_pipeline():
    mock_store = _build_mock_store(
        run_rows=[
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
        ],
        pipelines_by_run={
            "run-runtime-001": [
                {
                    "run_id": "run-runtime-001",
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
        },
        chain_rows_by_run={
            "run-runtime-001": [
                {
                    "run_id": "run-runtime-001",
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
        },
        sample_rows=[
            {"run_id": "run-runtime-001", "dataset_name": "dataset_a", "task_type": "regression",
             "n_samples": 20, "n_features": 6, "metric": "rmse"}
        ],
        counts_by_run={"run-runtime-001": 0},
        fold_counts_by_run={"run-runtime-001": 4},
        model_counts_by_run={"run-runtime-001": 4},
        cv_info_by_run={"run-runtime-001": {"fold_count": 4, "metric": "rmse"}},
        model_classes_by_run={"run-runtime-001": [{"name": "PLSRegression", "count": 1}]},
    )

    adapter = _make_adapter(mock_store)
    result = adapter.get_enriched_runs()

    run_config = result["runs"][0]["config"]
    assert run_config["cv_strategy"] == "kfold"
    assert run_config["splitter_class"] == "KFold"
    assert run_config["cv_folds"] == 4
    assert run_config["random_state"] == 42
    assert run_config["shuffle"] is True


def test_get_enriched_runs_exposes_runtime_status_from_config_and_pipelines():
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
    mock_store = _build_mock_store(
        run_rows=[
            {
                "run_id": "run-runtime-status-001",
                "name": "Runtime Status Run",
                "status": "completed",
                "project_id": None,
                "created_at": datetime(2026, 4, 18, 10, 0, tzinfo=UTC),
                "completed_at": datetime(2026, 4, 18, 10, 5, tzinfo=UTC),
                "datasets": '[{"name":"dataset_a","n_samples":20,"n_features":6}]',
                "config": json.dumps({
                    "requested_engine": "dag-ml",
                    "fallback_policy": fallback_policy,
                }),
                "error": None,
            }
        ],
        pipelines_by_run={
            "run-runtime-status-001": [
                {
                    "run_id": "run-runtime-status-001",
                    "pipeline_id": "pipe-runtime-status-001",
                    "name": "Runtime fallback pipeline",
                    "expanded_config": None,
                    "engine": "legacy",
                    "engine_requested": "dag-ml",
                    "engine_diagnostics": json.dumps([diagnostic]),
                    "fallback_policy": json.dumps(fallback_policy),
                }
            ]
        },
        chain_rows_by_run={"run-runtime-status-001": []},
    )

    adapter = _make_adapter(mock_store)
    result = adapter.get_enriched_runs()

    run = result["runs"][0]
    assert run["engine"] == "legacy"
    assert run["engine_requested"] == "dag-ml"
    assert run["engine_diagnostics"] == [diagnostic]
    assert run["fallback_policy"] == fallback_policy
    assert run["allow_fallback"] is True
    assert run["config"]["requested_engine"] == "dag-ml"
    assert run["config"]["fallback_policy"] == fallback_policy


def test_get_enriched_runs_ignores_repr_style_refit_splitter_when_inferring_cv_config():
    mock_store = _build_mock_store(
        run_rows=[
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
        ],
        pipelines_by_run={
            "run-refit-001": [
                {
                    "run_id": "run-refit-001",
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
                    "run_id": "run-refit-001",
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
        },
        chain_rows_by_run={
            "run-refit-001": [
                {
                    "run_id": "run-refit-001",
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
                    "final_test_score": 0.13,
                    "final_train_score": 0.09,
                }
            ]
        },
        sample_rows=[
            {"run_id": "run-refit-001", "dataset_name": "dataset_a", "task_type": "regression",
             "n_samples": 20, "n_features": 6, "metric": "rmse"}
        ],
        counts_by_run={"run-refit-001": 1},
        fold_counts_by_run={"run-refit-001": 5},
        model_counts_by_run={"run-refit-001": 5},
        cv_info_by_run={"run-refit-001": {"fold_count": 5, "metric": "rmse"}},
        model_classes_by_run={"run-refit-001": [{"name": "PLSRegression", "count": 1}]},
    )

    adapter = _make_adapter(mock_store)
    result = adapter.get_enriched_runs()

    run_config = result["runs"][0]["config"]
    assert run_config["cv_strategy"] == "kfold"
    assert run_config["splitter_class"] == "KFold"
    assert run_config["cv_folds"] == 5
    assert run_config["random_state"] == 7
    assert run_config["shuffle"] is True
    assert run_config["has_refit"] is True


def test_get_enriched_runs_batches_queries_across_runs_no_n_plus_one():
    """The batched builder must not scale store round-trips with run count.

    Two runs with two datasets between them: the chain-summary query, the
    pipelines fetch, and every aggregate query each fire ONCE for the whole
    page (``run_id IN (...)``), never per-run or per-dataset.
    """
    chain_rows_by_run = {
        "run-A": [
            {
                "run_id": "run-A", "dataset_name": "ds1", "metric": "rmse", "task_type": "regression",
                "cv_val_score": 0.12, "cv_test_score": 0.14, "cv_train_score": 0.1,
                "chain_id": "c-A1", "pipeline_id": "pipe-A", "model_name": "PLS(10)",
                "model_class": "PLSRegression", "preprocessings": "SNV", "cv_fold_count": 5,
                "best_params": None, "final_test_score": 0.11, "final_train_score": 0.09,
                "final_scores": {"test": {"rmse": 0.11}},
            },
            {
                "run_id": "run-A", "dataset_name": "ds2", "metric": "rmse", "task_type": "regression",
                "cv_val_score": 0.30, "cv_test_score": 0.32, "cv_train_score": 0.28,
                "chain_id": "c-A2", "pipeline_id": "pipe-A", "model_name": "PLS(5)",
                "model_class": "PLSRegression", "preprocessings": "MSC", "cv_fold_count": 5,
                "best_params": None,
            },
        ],
        "run-B": [
            {
                "run_id": "run-B", "dataset_name": "ds1", "metric": "rmse", "task_type": "regression",
                "cv_val_score": 0.20, "cv_test_score": 0.22, "cv_train_score": 0.18,
                "chain_id": "c-B1", "pipeline_id": "pipe-B", "model_name": "PLS(8)",
                "model_class": "PLSRegression", "preprocessings": "SNV", "cv_fold_count": 5,
                "best_params": None, "final_test_score": 0.19, "final_train_score": 0.15,
                "final_scores": {"test": {"rmse": 0.19}},
                "cv_source_chain_id": "c-B1-cv",
            },
        ],
    }
    mock_store = _build_mock_store(
        run_rows=[
            {
                "run_id": "run-A", "name": "Run A", "status": "completed", "project_id": None,
                "created_at": datetime(2026, 4, 1, 8, 0, tzinfo=UTC),
                "completed_at": datetime(2026, 4, 1, 8, 5, tzinfo=UTC),
                "datasets": '[{"name":"ds1","n_samples":12,"n_features":4},{"name":"ds2","n_samples":20,"n_features":6}]',
                "config": '{"n_pipelines":1}', "error": None,
            },
            {
                "run_id": "run-B", "name": "Run B", "status": "completed", "project_id": None,
                "created_at": datetime(2026, 4, 2, 9, 0, tzinfo=UTC),
                "completed_at": datetime(2026, 4, 2, 9, 5, tzinfo=UTC),
                "datasets": '[{"name":"ds1","n_samples":15,"n_features":5}]',
                "config": "{}", "error": None,
            },
        ],
        pipelines_by_run={
            "run-A": [{"run_id": "run-A", "pipeline_id": "pipe-A", "name": "Pipe A", "expanded_config": None}],
            "run-B": [{"run_id": "run-B", "pipeline_id": "pipe-B", "name": "Pipe B", "expanded_config": None}],
        },
        chain_rows_by_run=chain_rows_by_run,
        counts_by_run={"run-A": 1, "run-B": 1},
        fold_counts_by_run={"run-A": 5, "run-B": 5},
        model_counts_by_run={"run-A": 5, "run-B": 5},
        cv_info_by_run={"run-A": {"fold_count": 5, "metric": "rmse"}, "run-B": {"fold_count": 5, "metric": "rmse"}},
        model_classes_by_run={
            "run-A": [{"name": "PLSRegression", "count": 1}],
            "run-B": [{"name": "PLSRegression", "count": 1}],
        },
    )

    adapter = _make_adapter(mock_store)
    result = adapter.get_enriched_runs()

    assert result["total"] == 2
    # One chain-summary query for the whole page (batched run_id IN).
    assert mock_store.query_chain_summaries.call_count == 1
    # Old per-run helpers are no longer called.
    assert mock_store.list_pipelines.call_count == 0
    assert mock_store.query_predictions.call_count == 0
    assert mock_store.query_aggregated_predictions.call_count == 0
    # The chain-summary call passed ALL run_ids in one shot.
    chain_call = mock_store.query_chain_summaries.call_args
    assert chain_call.kwargs.get("run_id") == ["run-A", "run-B"]
    # _fetch_pl count is a small constant (pipelines + 6 batched aggregates),
    # independent of the run/dataset count -- proves the N+1 fan-out is gone.
    assert mock_store._fetch_pl.call_count == 8
    run_b_ds1 = result["runs"][1]["datasets"][0]
    assert run_b_ds1["top_5"][0]["cv_source_chain_id"] == "c-B1-cv"
