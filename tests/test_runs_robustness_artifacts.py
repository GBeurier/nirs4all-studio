from __future__ import annotations

import api.runs as runs_api
from api.store_adapter import StoreAdapter


def robustness_summary() -> dict:
    return {
        "format": "nirs4all.robustness.summary",
        "schema_version": 1,
        "fingerprint": "robustness:abc123",
        "mode": "clean_frozen",
        "report_version": 1,
        "slice_by": ["batch"],
        "summary": [{
            "bias": 0.01,
            "conformal_max_abs_coverage_gap": 0.02,
            "conformal_mean_width_mean": 0.31,
            "conformal_min_observed_coverage": 0.95,
            "delta_bias": 0.0,
            "delta_mae": 0.0,
            "delta_max_abs_error": 0.0,
            "delta_rmse": 0.0,
            "mae": 0.12,
            "mae_ratio": 1.0,
            "max_abs_error": 0.42,
            "n_samples": 24,
            "rmse": 0.18,
            "rmse_ratio": 1.0,
            "scenario": {"kind": "observed"},
            "scenario_index": 0,
            "scenario_label": "observed",
            "severity": 0.0,
            "worst_slice_key": {"batch": "A"},
            "worst_slice_label": "batch=A",
            "worst_slice_metric": "rmse",
            "worst_slice_value": 0.18,
        }],
    }


def test_store_adapter_lists_verified_robustness_summary_artifacts():
    class FakeReport:
        def summary_artifact(self):
            return robustness_summary()

    class FakeStore:
        def list_robustness_results(self, *, limit: int, offset: int):
            assert limit == 200
            assert offset == 0
            return [{
                "robustness_id": "rob-1",
                "name": "Drift audit",
                "run_id": "run-1",
                "pipeline_id": "pipe-a",
                "chain_id": "chain-a",
                "result_fingerprint": "robustness:abc123",
                "mode": "clean_frozen",
                "scenario_count": 1,
                "slice_by": '["batch"]',
            }]

        def load_robustness_result(self, robustness_id: str):
            assert robustness_id == "rob-1"
            return FakeReport()

    adapter = StoreAdapter.__new__(StoreAdapter)
    adapter._store = FakeStore()

    artifacts = adapter.list_robustness_summary_artifacts(
        run_ids={"run-1"},
        pipeline_ids={"pipe-a"},
    )

    assert artifacts == [{
        "robustness_id": "rob-1",
        "name": "Drift audit",
        "run_id": "run-1",
        "pipeline_id": "pipe-a",
        "chain_id": "chain-a",
        "conformal_id": None,
        "prediction_id": None,
        "result_fingerprint": "robustness:abc123",
        "mode": "clean_frozen",
        "scenario_count": 1,
        "slice_by": ["batch"],
        "created_at": None,
        "summary_artifact": robustness_summary(),
    }]


def test_run_response_attaches_workspace_robustness_summary_artifact(monkeypatch, tmp_path):
    class FakeAdapter:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return None

        def list_robustness_summary_artifacts(self, *, run_ids, pipeline_ids, limit=200):
            assert run_ids == {"run-1", "store-run-1"}
            assert {"pipeline-run-1", "pipe-a", "PLS baseline"}.issubset(pipeline_ids)
            return [{
                "robustness_id": "rob-1",
                "name": "Drift audit",
                "run_id": "run-1",
                "pipeline_id": "pipe-a",
                "chain_id": "chain-a",
                "conformal_id": None,
                "prediction_id": None,
                "result_fingerprint": "robustness:abc123",
                "mode": "clean_frozen",
                "scenario_count": 1,
                "slice_by": ["batch"],
                "created_at": "2026-07-13T00:00:00",
                "summary_artifact": robustness_summary(),
            }]

    monkeypatch.setattr(
        runs_api,
        "_open_store_adapter_for_robustness",
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
        robustness={
            "mode": "clean_frozen",
            "scenarios": [
                {"kind": "observed", "severity": 0.0},
            ],
            "slice_by": ["batch"],
        },
        datasets=[
            runs_api.DatasetRun(dataset_id="dataset-a", dataset_name="Dataset A", pipelines=[pipeline]),
        ],
        status="completed",
        created_at="2026-07-13T00:00:00",
        workspace_path=str(tmp_path),
        store_run_id="store-run-1",
    )

    runs_api._attach_workspace_robustness_artifacts(run)
    runs_api._attach_workspace_robustness_artifacts(run)

    assert pipeline.robustness_summary == robustness_summary()
    assert pipeline.artifact_refs is not None
    assert len(pipeline.artifact_refs) == 1
    assert pipeline.artifact_refs[0] == {
        "id": "robustness-summary:pipeline-run-1:rob-1",
        "kind": "repository_entry",
        "role": "robustness-summary",
        "label": "Drift audit",
        "source": "result-repository",
        "scope": "pipeline",
        "status": "available",
        "artifactId": "rob-1",
        "runId": "run-1",
        "pipelineId": "pipe-a",
        "chainId": "chain-a",
        "format": "json",
        "contentAddress": "robustness:abc123",
        "metadata": {
            "source": "workspace_robustness_results",
            "robustness_id": "rob-1",
            "conformal_id": None,
            "prediction_id": None,
            "mode": "clean_frozen",
            "scenario_count": 1,
            "slice_by": ["batch"],
            "created_at": "2026-07-13T00:00:00",
            "robustness_summary_artifact": robustness_summary(),
        },
    }
    response_payload = runs_api.RunListResponse(runs=[run], total=1).model_dump()
    response_pipeline = response_payload["runs"][0]["datasets"][0]["pipelines"][0]
    assert response_pipeline["artifact_refs"][0]["metadata"]["robustness_summary_artifact"] == robustness_summary()
    assert response_pipeline["robustness_summary"] == robustness_summary()
    assert response_pipeline["robustness_execution"] == {
        "status": "reported",
        "message": "A nirs4all RobustnessReport artifact is attached.",
        "scenario_kinds": ["observed"],
        "requires_y_true": True,
        "requires_predictions": True,
        "requires_X": False,
        "requires_predictor": False,
        "spectral_evidence_publication_requested": False,
        "blockers": [],
    }
