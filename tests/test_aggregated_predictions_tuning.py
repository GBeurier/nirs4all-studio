from __future__ import annotations

import api.aggregated_predictions as aggregated_api


def tuning_summary() -> dict:
    return {
        "best_params": {"model.n_components": 2},
        "best_value": 0.1234,
        "direction": "minimize",
        "engine": "optuna",
        "fingerprint": "tuning:chain",
        "format": "nirs4all.tuning.summary",
        "metric": "rmse",
        "n_trials": 2,
        "optimizer": "optuna",
        "schema_version": 1,
        "trial_states": {"COMPLETE": 1, "PRUNED": 1},
        "trials": [
            {"number": 0, "state": "PRUNED", "value": None},
            {"number": 1, "state": "COMPLETE", "value": 0.1234},
        ],
        "version": 1,
    }


def test_chain_summary_enrichment_attaches_verified_tuning_summary_artifact():
    class FakeResult:
        def summary_artifact(self):
            return tuning_summary()

    class FakeStore:
        def list_tuning_results(self, *, limit: int, offset: int):
            assert limit == 200
            assert offset == 0
            return [{
                "tuning_id": "tune-chain",
                "name": "Chain tuning",
                "run_id": "run-1",
                "pipeline_id": "pipe-a",
                "chain_id": "chain-a",
                "result_fingerprint": "tuning:chain",
                "tuning_fingerprint": "tuning-spec:chain",
                "engine": "optuna",
                "metric": "rmse",
                "direction": "minimize",
                "best_value": 0.1234,
                "n_trials": 2,
                "created_at": "2026-07-13T00:00:00",
                "metadata": '{"source":"native"}',
            }]

        def load_tuning_result(self, tuning_id: str):
            assert tuning_id == "tune-chain"
            return FakeResult()

    summary = {
        "run_id": "run-1",
        "pipeline_id": "pipe-a",
        "chain_id": "chain-a",
    }

    aggregated_api._enrich_with_tuning_summary_artifacts(summary, FakeStore())

    assert summary["artifact_refs"] == [{
        "id": "tuning-summary:chain-a:tune-chain",
        "kind": "repository_entry",
        "role": "tuning-summary",
        "label": "Chain tuning",
        "source": "result-repository",
        "scope": "chain",
        "status": "available",
        "artifactId": "tune-chain",
        "runId": "run-1",
        "pipelineId": "pipe-a",
        "chainId": "chain-a",
        "format": "nirs4all.tuning.summary",
        "contentAddress": "tuning:chain",
        "metadata": {
            "source": "workspace_tuning_results",
            "tuning_id": "tune-chain",
            "tuning_fingerprint": "tuning-spec:chain",
            "engine": "optuna",
            "metric": "rmse",
            "direction": "minimize",
            "best_value": 0.1234,
            "n_trials": 2,
            "created_at": "2026-07-13T00:00:00",
            "tuning_summary_artifact": tuning_summary(),
            "tuning_metadata": {"source": "native"},
        },
    }]

    response = aggregated_api.ChainSummary(
        run_id="run-1",
        pipeline_id="pipe-a",
        chain_id="chain-a",
        model_class="PLS",
        model_step_idx=0,
        cv_fold_count=0,
        **{
            "artifact_refs": summary["artifact_refs"],
        },
    ).model_dump()
    assert response["artifact_refs"][0]["metadata"]["tuning_summary_artifact"] == tuning_summary()


def test_bulk_chain_summary_enrichment_lists_tuning_results_once():
    class FakeResult:
        def summary_artifact(self):
            return tuning_summary()

    class FakeStore:
        def __init__(self):
            self.list_calls = 0
            self.load_calls = 0

        def list_tuning_results(self, *, limit: int, offset: int):
            self.list_calls += 1
            assert limit == 200
            assert offset == 0
            return [{
                "tuning_id": "tune-chain",
                "name": "Chain tuning",
                "run_id": "run-1",
                "pipeline_id": "pipe-a",
                "chain_id": "chain-a",
                "result_fingerprint": "tuning:chain",
                "tuning_fingerprint": "tuning-spec:chain",
                "engine": "optuna",
                "metric": "rmse",
                "direction": "minimize",
                "best_value": 0.1234,
                "n_trials": 2,
            }]

        def load_tuning_result(self, tuning_id: str):
            self.load_calls += 1
            assert tuning_id == "tune-chain"
            return FakeResult()

    summaries = [
        {"run_id": "run-1", "pipeline_id": "pipe-a", "chain_id": "chain-a"},
        {"run_id": "run-1", "pipeline_id": "pipe-a", "chain_id": "chain-b"},
    ]
    store = FakeStore()

    aggregated_api._enrich_many_with_tuning_summary_artifacts(summaries, store)

    assert store.list_calls == 1
    assert store.load_calls == 1
    assert summaries[0]["artifact_refs"][0]["metadata"]["tuning_summary_artifact"] == tuning_summary()
    assert "artifact_refs" not in summaries[1]
