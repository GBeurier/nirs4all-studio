from __future__ import annotations

import api.runs as runs_api
from api.store_adapter import StoreAdapter


def tuning_summary() -> dict:
    return {
        "best_params": {"model.n_components": 2},
        "best_value": 0.1234,
        "direction": "minimize",
        "engine": "optuna",
        "fingerprint": "tuning:abc123",
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


def test_store_adapter_lists_verified_tuning_summary_artifacts():
    class FakeResult:
        def summary_artifact(self):
            return tuning_summary()

    class FakeStore:
        def list_tuning_results(self, *, limit: int, offset: int):
            assert limit == 200
            assert offset == 0
            return [{
                "tuning_id": "tune-1",
                "name": "PLS tuning",
                "run_id": "run-1",
                "pipeline_id": "pipe-a",
                "chain_id": "chain-a",
                "result_fingerprint": "tuning:abc123",
                "tuning_fingerprint": "tuning-spec:abc123",
                "engine": "optuna",
                "metric": "rmse",
                "direction": "minimize",
                "best_value": 0.1234,
                "n_trials": 2,
                "metadata": '{"source":"native"}',
                "created_at": "2026-07-13T00:00:00",
            }]

        def load_tuning_result(self, tuning_id: str):
            assert tuning_id == "tune-1"
            return FakeResult()

    adapter = StoreAdapter.__new__(StoreAdapter)
    adapter._store = FakeStore()

    artifacts = adapter.list_tuning_summary_artifacts(
        run_ids={"run-1"},
        pipeline_ids={"pipe-a"},
    )

    assert artifacts == [{
        "tuning_id": "tune-1",
        "name": "PLS tuning",
        "run_id": "run-1",
        "pipeline_id": "pipe-a",
        "chain_id": "chain-a",
        "result_fingerprint": "tuning:abc123",
        "tuning_fingerprint": "tuning-spec:abc123",
        "engine": "optuna",
        "metric": "rmse",
        "direction": "minimize",
        "best_value": 0.1234,
        "n_trials": 2,
        "metadata": {"source": "native"},
        "created_at": "2026-07-13T00:00:00",
        "summary_artifact": tuning_summary(),
    }]


def test_run_response_attaches_workspace_tuning_summary_artifact(monkeypatch, tmp_path):
    class FakeAdapter:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return None

        def list_tuning_summary_artifacts(self, *, run_ids, pipeline_ids, limit=200):
            assert run_ids == {"run-1", "store-run-1"}
            assert {"pipeline-run-1", "pipe-a", "PLS baseline"}.issubset(pipeline_ids)
            return [{
                "tuning_id": "tune-1",
                "name": "PLS tuning",
                "run_id": "run-1",
                "pipeline_id": "pipe-a",
                "chain_id": "chain-a",
                "result_fingerprint": "tuning:abc123",
                "tuning_fingerprint": "tuning-spec:abc123",
                "engine": "optuna",
                "metric": "rmse",
                "direction": "minimize",
                "best_value": 0.1234,
                "n_trials": 2,
                "metadata": {"source": "native"},
                "created_at": "2026-07-13T00:00:00",
                "summary_artifact": tuning_summary(),
            }]

    monkeypatch.setattr(
        runs_api,
        "_open_store_adapter_for_tuning",
        lambda workspace_path: FakeAdapter(),
    )

    pipeline = runs_api.PipelineRun(
        id="pipeline-run-1",
        pipeline_id="pipe-a",
        pipeline_name="PLS baseline",
        model="PLS",
        preprocessing="SNV",
        split_strategy="KFold(5)",
        status="completed",
    )
    run = runs_api.Run(
        id="run-1",
        name="Run",
        datasets=[
            runs_api.DatasetRun(dataset_id="dataset-a", dataset_name="Dataset A", pipelines=[pipeline]),
        ],
        status="completed",
        created_at="2026-07-13T00:00:00",
        workspace_path=str(tmp_path),
        store_run_id="store-run-1",
    )

    runs_api._attach_workspace_tuning_artifacts(run)
    runs_api._attach_workspace_tuning_artifacts(run)

    assert pipeline.artifact_refs is not None
    assert len(pipeline.artifact_refs) == 1
    assert pipeline.artifact_refs[0] == {
        "id": "tuning-summary:pipeline-run-1:tune-1",
        "kind": "repository_entry",
        "role": "tuning-summary",
        "label": "PLS tuning",
        "source": "result-repository",
        "scope": "pipeline",
        "status": "available",
        "artifactId": "tune-1",
        "runId": "run-1",
        "pipelineId": "pipe-a",
        "chainId": "chain-a",
        "format": "nirs4all.tuning.summary",
        "contentAddress": "tuning:abc123",
        "metadata": {
            "source": "workspace_tuning_results",
            "tuning_id": "tune-1",
            "tuning_fingerprint": "tuning-spec:abc123",
            "engine": "optuna",
            "metric": "rmse",
            "direction": "minimize",
            "best_value": 0.1234,
            "n_trials": 2,
            "created_at": "2026-07-13T00:00:00",
            "tuning_summary_artifact": tuning_summary(),
            "tuning_metadata": {"source": "native"},
        },
    }
    response_payload = runs_api.RunListResponse(runs=[run], total=1).model_dump()
    response_pipeline = response_payload["runs"][0]["datasets"][0]["pipelines"][0]
    assert response_pipeline["artifact_refs"][0]["metadata"]["tuning_summary_artifact"] == tuning_summary()
