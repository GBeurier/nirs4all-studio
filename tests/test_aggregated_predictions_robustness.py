from __future__ import annotations

import asyncio
import importlib

import pytest
from fastapi import HTTPException

import api.aggregated_predictions as aggregated_api


def robustness_summary() -> dict:
    return {
        "format": "nirs4all.robustness.summary",
        "schema_version": 1,
        "fingerprint": "robustness:chain",
        "mode": "clean_frozen",
        "report_version": 1,
        "slice_by": ["batch"],
        "summary": [{
            "bias": 0.0,
            "conformal_max_abs_coverage_gap": 0.03,
            "conformal_mean_width_mean": 0.2,
            "conformal_min_observed_coverage": 0.94,
            "delta_bias": 0.0,
            "delta_mae": 0.0,
            "delta_max_abs_error": 0.0,
            "delta_rmse": 0.0,
            "mae": 0.1,
            "mae_ratio": 1.0,
            "max_abs_error": 0.3,
            "n_samples": 12,
            "rmse": 0.14,
            "rmse_ratio": 1.0,
            "scenario": {"kind": "observed"},
            "scenario_index": 0,
            "scenario_label": "observed",
            "severity": 0.0,
            "worst_slice_key": None,
            "worst_slice_label": None,
            "worst_slice_metric": "rmse",
            "worst_slice_value": None,
        }],
    }


def test_chain_summary_enrichment_attaches_verified_robustness_summary_artifact():
    class FakeReport:
        def summary_artifact(self):
            return robustness_summary()

    class FakeStore:
        def list_robustness_results(self, *, limit: int, offset: int):
            assert limit == 200
            assert offset == 0
            return [{
                "robustness_id": "rob-chain",
                "name": "Chain robustness",
                "run_id": "run-1",
                "pipeline_id": "pipe-a",
                "chain_id": "chain-a",
                "result_fingerprint": "robustness:chain",
                "mode": "clean_frozen",
                "scenario_count": 1,
                "slice_by": '["batch"]',
                "created_at": "2026-07-13T00:00:00",
                "metadata": (
                    '{"source":"nirs4all-studio",'
                    '"requested_seed":0,'
                    '"requested_scenario_kinds":["observed"],'
                    '"stored_prediction_context":{"prediction_id":"pred-a","sample_metadata_present":true}}'
                ),
            }]

        def load_robustness_result(self, robustness_id: str):
            assert robustness_id == "rob-chain"
            return FakeReport()

    summary = {
        "run_id": "run-1",
        "pipeline_id": "pipe-a",
        "chain_id": "chain-a",
    }

    aggregated_api._enrich_with_robustness_summary_artifacts(summary, FakeStore())

    assert summary["robustness_summary"] == robustness_summary()
    assert summary["artifact_refs"] == [{
        "id": "robustness-summary:chain-a:rob-chain",
        "kind": "repository_entry",
        "role": "robustness-summary",
        "label": "Chain robustness",
        "source": "result-repository",
        "scope": "chain",
        "status": "available",
        "artifactId": "rob-chain",
        "runId": "run-1",
        "pipelineId": "pipe-a",
        "chainId": "chain-a",
        "format": "json",
        "contentAddress": "robustness:chain",
        "metadata": {
            "source": "workspace_robustness_results",
            "robustness_id": "rob-chain",
            "conformal_id": None,
            "prediction_id": None,
            "mode": "clean_frozen",
            "scenario_count": 1,
            "slice_by": ["batch"],
            "created_at": "2026-07-13T00:00:00",
            "robustness_summary_artifact": robustness_summary(),
            "audit_metadata": {
                "source": "nirs4all-studio",
                "requested_seed": 0,
                "requested_scenario_kinds": ["observed"],
                "stored_prediction_context": {
                    "prediction_id": "pred-a",
                    "sample_metadata_present": True,
                },
            },
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
            "robustness_summary": summary["robustness_summary"],
        },
    ).model_dump()
    assert response["artifact_refs"][0]["metadata"]["robustness_summary_artifact"] == robustness_summary()
    assert response["robustness_summary"] == robustness_summary()


def test_bulk_chain_summary_enrichment_lists_robustness_results_once():
    class FakeReport:
        def summary_artifact(self):
            return robustness_summary()

    class FakeStore:
        def __init__(self):
            self.list_calls = 0
            self.load_calls = 0

        def list_robustness_results(self, *, limit: int, offset: int):
            self.list_calls += 1
            assert limit == 200
            assert offset == 0
            return [{
                "robustness_id": "rob-chain",
                "name": "Chain robustness",
                "run_id": "run-1",
                "pipeline_id": "pipe-a",
                "chain_id": "chain-a",
                "result_fingerprint": "robustness:chain",
                "mode": "clean_frozen",
                "scenario_count": 1,
                "slice_by": '["batch"]',
                "created_at": "2026-07-13T00:00:00",
            }]

        def load_robustness_result(self, robustness_id: str):
            self.load_calls += 1
            assert robustness_id == "rob-chain"
            return FakeReport()

    summaries = [
        {"run_id": "run-1", "pipeline_id": "pipe-a", "chain_id": "chain-a"},
        {"run_id": "run-1", "pipeline_id": "pipe-a", "chain_id": "chain-b"},
    ]
    store = FakeStore()

    aggregated_api._enrich_many_with_robustness_summary_artifacts(summaries, store)

    assert store.list_calls == 1
    assert store.load_calls == 1
    assert summaries[0]["robustness_summary"] == robustness_summary()
    assert "robustness_summary" not in summaries[1]


def test_compute_prediction_robustness_report_persists_native_report(monkeypatch, tmp_path):
    class FakeStore:
        def __init__(self):
            self.closed = False

        def get_prediction_arrays(self, prediction_id: str):
            assert prediction_id == "pred-robust"
            return {
                "prediction_id": prediction_id,
                "run_id": "run-1",
                "pipeline_id": "pipe-a",
                "chain_id": "chain-a",
                "model_name": "PLS",
                "y_true": [1.0, 2.0, 3.0],
                "y_pred": [1.1, 1.9, 3.2],
                "sample_indices": [10, 11, 12],
                "sample_metadata": {"batch": ["A", "A", "B"]},
            }

        def close(self):
            self.closed = True

    saved: dict = {}

    def fake_save_workspace_robustness_report(*, workspace_path, report, request, robustness_plan, arrays, prediction_id):
        saved["workspace_path"] = workspace_path
        saved["request"] = request
        saved["robustness_plan"] = robustness_plan
        saved["arrays"] = arrays
        saved["prediction_id"] = prediction_id
        saved["summary"] = report.summary_artifact()
        return "robustness-pred-1"

    store = FakeStore()
    monkeypatch.setattr(aggregated_api, "_get_store", lambda: store)
    monkeypatch.setattr(aggregated_api, "_get_workspace_path", lambda: tmp_path)
    monkeypatch.setattr(aggregated_api, "_save_workspace_robustness_report", fake_save_workspace_robustness_report)

    request = aggregated_api.PredictionRobustnessReportRequest.model_validate({
        "robustness": {
            "mode": "clean_frozen",
            "scenarios": [
                {"kind": "observed"},
                {"kind": "prediction_bias", "severity": 0.1},
            ],
            "slice_by": ["batch"],
        },
        "name": "Prediction robustness",
        "seed": 0,
    })

    response = asyncio.run(
        aggregated_api.compute_prediction_robustness_report("pred-robust", request)
    )

    assert response.robustness_id == "robustness-pred-1"
    assert response.prediction_id == "pred-robust"
    assert response.run_id == "run-1"
    assert response.pipeline_id == "pipe-a"
    assert response.chain_id == "chain-a"
    assert response.summary_artifact["format"] == "nirs4all.robustness.summary"
    assert response.summary_artifact["slice_by"] == ["batch"]
    assert [row["scenario"]["kind"] for row in response.summary_artifact["summary"]] == [
        "observed",
        "prediction_bias",
    ]
    assert saved["workspace_path"] == tmp_path
    assert saved["robustness_plan"] == {
        "mode": "clean_frozen",
        "scenarios": [
            {"kind": "observed", "severity": 0.0},
            {"kind": "prediction_bias", "severity": 0.1},
        ],
        "slice_by": ["batch"],
    }
    assert saved["arrays"]["prediction_id"] == "pred-robust"
    assert saved["prediction_id"] == "pred-robust"
    assert store.closed is True


def test_prediction_robustness_evidence_marks_spectral_bundle_ready():
    evidence = aggregated_api._build_prediction_robustness_evidence(
        {
            "prediction_id": "pred-spectral",
            "y_true": [1.0, 2.0],
            "y_pred": [1.1, 1.9],
            "X": [[0.1, 0.2], [0.3, 0.4]],
            "predictor_bundle": "model.n4a",
        },
        prediction_id="pred-spectral",
    )

    assert evidence.can_compute_stored_prediction_report is True
    assert evidence.can_compute_spectral_report is True
    assert evidence.status == "ready_for_spectral_replay"
    assert evidence.blockers == []
    assert [requirement.id for requirement in evidence.requirements] == [
        "y_true",
        "y_pred",
        "spectra",
        "frozen_predictor",
    ]
    assert evidence.requirements[2].source == "prediction_arrays.X"
    assert evidence.requirements[3].source == "prediction_arrays.predictor_bundle"


def test_prediction_robustness_evidence_reads_published_pipeline_metadata():
    evidence = aggregated_api._build_prediction_robustness_evidence(
        {
            "prediction_id": "pred-spectral",
            "y_true": [1.0, 2.0],
            "y_pred": [1.1, 1.9],
            "result_metadata": {
                "source": "native_results",
                "robustness_evidence": {
                    "X": [[0.1, 0.2], [0.3, 0.4]],
                    "predictor_bundle": "model.n4a",
                },
            },
        },
        prediction_id="pred-spectral",
    )

    assert evidence.can_compute_stored_prediction_report is True
    assert evidence.can_compute_spectral_report is True
    assert evidence.status == "ready_for_spectral_replay"
    assert evidence.blockers == []
    assert evidence.requirements[2].source == "prediction_arrays.result_metadata.robustness_evidence.X"
    assert evidence.requirements[3].source == "prediction_arrays.result_metadata.robustness_evidence.predictor_bundle"


def test_compute_prediction_robustness_report_passes_spectral_bundle_evidence(monkeypatch, tmp_path):
    class FakeStore:
        def get_prediction_arrays(self, prediction_id: str):
            assert prediction_id == "pred-spectral"
            return {
                "prediction_id": prediction_id,
                "run_id": "run-1",
                "pipeline_id": "pipe-a",
                "chain_id": "chain-a",
                "model_name": "PLS",
                "y_true": [1.0, 2.0],
                "y_pred": [1.1, 1.9],
                "X": [[0.1, 0.2], [0.3, 0.4]],
                "predictor_bundle": "model.n4a",
                "sample_indices": [10, 11],
            }

        def close(self):
            pass

    class FakeReport:
        fingerprint = "robustness:spectral"

        def summary_artifact(self):
            return {
                "format": "nirs4all.robustness.summary",
                "fingerprint": self.fingerprint,
                "mode": "clean_frozen",
                "report_version": 1,
                "schema_version": 1,
                "slice_by": [],
                "summary": [{
                    "scenario": {"kind": "spectral_shift", "severity": 1.0},
                    "scenario_index": 0,
                    "scenario_label": "spectral_shift",
                    "severity": 1.0,
                }],
            }

    captured: dict = {}

    def fake_robustness(result, **kwargs):
        captured["result"] = result
        captured["kwargs"] = kwargs
        return FakeReport()

    def fake_save_workspace_robustness_report(*, workspace_path, report, request, robustness_plan, arrays, prediction_id):
        captured["save"] = {
            "workspace_path": workspace_path,
            "report": report,
            "robustness_plan": robustness_plan,
            "arrays": arrays,
            "prediction_id": prediction_id,
        }
        return "robustness-spectral"

    robustness_module = importlib.import_module("nirs4all.api.robustness")
    monkeypatch.setattr(robustness_module, "robustness", fake_robustness)
    monkeypatch.setattr(aggregated_api, "_get_store", lambda: FakeStore())
    monkeypatch.setattr(aggregated_api, "_get_workspace_path", lambda: tmp_path)
    monkeypatch.setattr(aggregated_api, "_save_workspace_robustness_report", fake_save_workspace_robustness_report)

    request = aggregated_api.PredictionRobustnessReportRequest.model_validate({
        "robustness": {
            "mode": "clean_frozen",
            "scenarios": [{"kind": "spectral_shift", "severity": 1.0}],
        },
        "name": "Spectral audit",
        "seed": 5,
    })

    response = asyncio.run(
        aggregated_api.compute_prediction_robustness_report("pred-spectral", request)
    )

    assert response.robustness_id == "robustness-spectral"
    assert response.report_fingerprint == "robustness:spectral"
    assert captured["kwargs"]["y_true"] == [1.0, 2.0]
    assert captured["kwargs"]["mode"] == "clean_frozen"
    assert captured["kwargs"]["scenarios"] == [{"kind": "spectral_shift", "severity": 1.0}]
    assert captured["kwargs"]["seed"] == 5
    assert captured["kwargs"]["predictor_bundle"] == "model.n4a"
    assert captured["kwargs"]["X"] == [[0.1, 0.2], [0.3, 0.4]]
    assert captured["result"].sample_indices.tolist() == [10, 11]
    assert captured["save"]["robustness_plan"]["scenarios"] == [{"kind": "spectral_shift", "severity": 1.0}]


def test_compute_prediction_robustness_report_uses_prediction_metadata_evidence(monkeypatch, tmp_path):
    class FakeStore:
        def get_prediction_arrays(self, prediction_id: str):
            assert prediction_id == "pred-spectral"
            return {
                "prediction_id": prediction_id,
                "run_id": "run-1",
                "pipeline_id": "pipe-a",
                "chain_id": "chain-a",
                "model_name": "PLS",
                "y_true": [1.0, 2.0],
                "y_pred": [1.1, 1.9],
                "sample_indices": [10, 11],
            }

        def get_prediction(self, prediction_id: str, load_arrays: bool = True):
            assert prediction_id == "pred-spectral"
            assert load_arrays is False
            return {
                "prediction_id": prediction_id,
                "result_metadata": {
                    "source": "native_results",
                    "robustness_evidence": {
                        "X": [[0.1, 0.2], [0.3, 0.4]],
                        "predictor_bundle": "model.n4a",
                    },
                },
            }

        def get_chain(self, chain_id: str):
            assert chain_id == "chain-a"
            return {}

        def get_pipeline(self, pipeline_id: str):
            assert pipeline_id == "pipe-a"
            return {}

        def close(self):
            pass

    class FakeReport:
        fingerprint = "robustness:spectral"

        def summary_artifact(self):
            return {
                "format": "nirs4all.robustness.summary",
                "fingerprint": self.fingerprint,
                "mode": "clean_frozen",
                "report_version": 1,
                "schema_version": 1,
                "slice_by": [],
                "summary": [{
                    "scenario": {"kind": "spectral_shift", "severity": 1.0},
                    "scenario_index": 0,
                    "scenario_label": "spectral_shift",
                    "severity": 1.0,
                }],
            }

    captured: dict = {}

    def fake_robustness(result, **kwargs):
        captured["result"] = result
        captured["kwargs"] = kwargs
        return FakeReport()

    def fake_save_workspace_robustness_report(*, workspace_path, report, request, robustness_plan, arrays, prediction_id):
        captured["save"] = {
            "arrays": arrays,
            "prediction_id": prediction_id,
        }
        return "robustness-spectral"

    robustness_module = importlib.import_module("nirs4all.api.robustness")
    monkeypatch.setattr(robustness_module, "robustness", fake_robustness)
    monkeypatch.setattr(aggregated_api, "_get_store", lambda: FakeStore())
    monkeypatch.setattr(aggregated_api, "_get_workspace_path", lambda: tmp_path)
    monkeypatch.setattr(aggregated_api, "_save_workspace_robustness_report", fake_save_workspace_robustness_report)

    request = aggregated_api.PredictionRobustnessReportRequest.model_validate({
        "robustness": {
            "mode": "clean_frozen",
            "scenarios": [{"kind": "spectral_shift", "severity": 1.0}],
        },
        "name": "Spectral audit",
        "seed": 5,
    })

    response = asyncio.run(
        aggregated_api.compute_prediction_robustness_report("pred-spectral", request)
    )

    assert response.robustness_id == "robustness-spectral"
    assert captured["kwargs"]["predictor_bundle"] == "model.n4a"
    assert captured["kwargs"]["X"] == [[0.1, 0.2], [0.3, 0.4]]
    assert captured["result"].sample_indices.tolist() == [10, 11]
    assert captured["save"]["arrays"]["result_metadata"]["robustness_evidence"]["predictor_bundle"] == "model.n4a"


def test_save_prediction_robustness_report_persists_audit_metadata(monkeypatch, tmp_path):
    captured: dict = {}

    class FakeReport:
        fingerprint = "robustness:metadata"

    def fake_save_workspace_robustness_report(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return "robustness-meta"

    robustness_module = importlib.import_module("nirs4all.api.robustness")
    monkeypatch.setattr(robustness_module, "save_workspace_robustness_report", fake_save_workspace_robustness_report)

    request = aggregated_api.PredictionRobustnessReportRequest.model_validate({
        "robustness": {
            "mode": "clean_frozen",
            "scenarios": [{"kind": "prediction_noise", "severity": 0.2, "distribution": "normal"}],
            "slice_by": ["batch"],
        },
        "name": "Prediction noise audit",
        "seed": 123,
        "robustness_id": "rob-custom",
    })
    robustness_plan = aggregated_api._normalize_prediction_robustness_request(request)

    robustness_id = aggregated_api._save_workspace_robustness_report(
        workspace_path=tmp_path,
        report=FakeReport(),
        request=request,
        robustness_plan=robustness_plan,
        arrays={
            "prediction_id": "pred-meta",
            "run_id": "run-1",
            "pipeline_id": "pipe-a",
            "chain_id": "chain-a",
            "dataset_name": "corn",
            "model_name": "PLS",
            "model_class": "PLSRegression",
            "partition": "test",
            "fold_id": "1",
            "n_samples": 3,
            "sample_indices": [10, 11, 12],
            "sample_metadata": {"batch": ["A", "A", "B"]},
        },
        prediction_id="pred-meta",
    )

    assert robustness_id == "robustness-meta"
    assert captured["args"][0] == tmp_path
    assert isinstance(captured["args"][1], FakeReport)
    assert captured["kwargs"]["name"] == "Prediction noise audit"
    assert captured["kwargs"]["robustness_id"] == "rob-custom"
    assert captured["kwargs"]["run_id"] == "run-1"
    assert captured["kwargs"]["pipeline_id"] == "pipe-a"
    assert captured["kwargs"]["chain_id"] == "chain-a"
    assert captured["kwargs"]["prediction_id"] == "pred-meta"
    assert captured["kwargs"]["metadata"] == {
        "source": "nirs4all-studio",
        "source_endpoint": "aggregated-predictions.robustness-report",
        "prediction_id": "pred-meta",
        "requested_robustness": {
            "mode": "clean_frozen",
            "scenarios": [{"kind": "prediction_noise", "severity": 0.2, "distribution": "normal"}],
            "slice_by": ["batch"],
        },
        "requested_seed": 123,
        "requested_scenario_kinds": ["prediction_noise"],
        "stored_prediction_context": {
            "run_id": "run-1",
            "pipeline_id": "pipe-a",
            "chain_id": "chain-a",
            "dataset_name": "corn",
            "model_name": "PLS",
            "model_class": "PLSRegression",
            "partition": "test",
            "fold_id": "1",
            "n_samples": 3,
            "sample_indices_present": True,
            "sample_metadata_present": True,
        },
    }


def test_compute_prediction_robustness_report_rejects_spectral_scenario_without_x(monkeypatch, tmp_path):
    class FakeStore:
        def get_prediction_arrays(self, prediction_id: str):
            return {
                "prediction_id": prediction_id,
                "y_true": [1.0, 2.0, 3.0],
                "y_pred": [1.1, 1.9, 3.2],
                "predictor_bundle": "model.n4a",
            }

        def close(self):
            pass

    monkeypatch.setattr(aggregated_api, "_get_store", lambda: FakeStore())
    monkeypatch.setattr(aggregated_api, "_get_workspace_path", lambda: tmp_path)

    request = aggregated_api.PredictionRobustnessReportRequest.model_validate({
        "robustness": {
            "mode": "clean_frozen",
            "scenarios": [{"kind": "spectral_shift", "severity": 1.0}],
        },
    })

    with pytest.raises(HTTPException) as exc:
        asyncio.run(aggregated_api.compute_prediction_robustness_report("pred-robust", request))

    assert exc.value.status_code == 400
    assert "Spectral scenarios require explicit X/spectra arrays" in exc.value.detail


def test_compute_prediction_robustness_report_requires_truth(monkeypatch, tmp_path):
    class FakeStore:
        def get_prediction_arrays(self, prediction_id: str):
            return {
                "prediction_id": prediction_id,
                "y_true": None,
                "y_pred": [1.1, 1.9, 3.2],
            }

        def close(self):
            pass

    monkeypatch.setattr(aggregated_api, "_get_store", lambda: FakeStore())
    monkeypatch.setattr(aggregated_api, "_get_workspace_path", lambda: tmp_path)

    request = aggregated_api.PredictionRobustnessReportRequest.model_validate({
        "robustness": {
            "mode": "clean_frozen",
            "scenarios": [{"kind": "observed"}],
        },
    })

    with pytest.raises(HTTPException) as exc:
        asyncio.run(aggregated_api.compute_prediction_robustness_report("pred-missing-truth", request))

    assert exc.value.status_code == 400
    assert "requires stored y_true and y_pred" in exc.value.detail


def test_get_prediction_robustness_evidence_is_fail_closed_for_spectral(monkeypatch):
    class FakeStore:
        def __init__(self):
            self.closed = False

        def get_prediction_arrays(self, prediction_id: str):
            assert prediction_id == "pred-evidence"
            return {
                "prediction_id": prediction_id,
                "run_id": "run-1",
                "pipeline_id": "pipe-a",
                "chain_id": "chain-a",
                "y_true": [1.0, 2.0],
                "y_pred": [1.1, 1.9],
            }

        def close(self):
            self.closed = True

    store = FakeStore()
    monkeypatch.setattr(aggregated_api, "_get_store", lambda: store)

    response = asyncio.run(
        aggregated_api.get_prediction_robustness_evidence("pred-evidence")
    )

    assert response.prediction_id == "pred-evidence"
    assert response.run_id == "run-1"
    assert response.pipeline_id == "pipe-a"
    assert response.chain_id == "chain-a"
    assert response.can_compute_stored_prediction_report is True
    assert response.stored_prediction_scenarios == ["observed", "prediction_bias", "prediction_noise"]
    assert response.can_compute_spectral_report is False
    assert response.status == "ready_for_prediction_space_only"
    assert {item.id: item.present for item in response.requirements} == {
        "y_true": True,
        "y_pred": True,
        "spectra": False,
        "frozen_predictor": False,
    }
    assert "row-aligned X/spectra matrix" in response.blockers[0]
    assert "frozen predictor replay surface" in response.blockers[1]
    assert store.closed is True


def test_get_prediction_robustness_evidence_reports_missing_prediction_arrays(monkeypatch):
    class FakeStore:
        def get_prediction_arrays(self, prediction_id: str):
            return {
                "prediction_id": prediction_id,
                "y_true": None,
                "y_pred": [],
                "spectra": [[1.0, 2.0]],
            }

        def close(self):
            pass

    monkeypatch.setattr(aggregated_api, "_get_store", lambda: FakeStore())

    response = asyncio.run(
        aggregated_api.get_prediction_robustness_evidence("pred-missing")
    )

    assert response.can_compute_stored_prediction_report is False
    assert response.stored_prediction_scenarios == []
    assert response.can_compute_spectral_report is False
    assert response.status == "missing_prediction_evidence"
    assert {item.id: item.present for item in response.requirements} == {
        "y_true": False,
        "y_pred": False,
        "spectra": True,
        "frozen_predictor": False,
    }
    assert any("Stored y_true is missing" in blocker for blocker in response.blockers)
    assert any("Stored y_pred is missing" in blocker for blocker in response.blockers)


@pytest.mark.parametrize(
    ("export_format", "expected_media_type", "expected_extension", "expected_body"),
    [
        ("json", "application/json", "json", '{"fingerprint":"rob"}\n'),
        ("markdown", "text/markdown; charset=utf-8", "md", "# Robustness\n"),
        ("html", "text/html; charset=utf-8", "html", "<h1>Robustness</h1>\n"),
    ],
)
def test_export_workspace_robustness_report_republishes_verified_report(
    monkeypatch,
    tmp_path,
    export_format,
    expected_media_type,
    expected_extension,
    expected_body,
):
    class FakeReport:
        def __init__(self):
            self.calls: list[tuple[str, object]] = []

        def to_json(self, *, indent=None):
            self.calls.append(("json", indent))
            return '{"fingerprint":"rob"}\n'

        def to_markdown(self):
            self.calls.append(("markdown", None))
            return "# Robustness\n"

        def to_html(self):
            self.calls.append(("html", None))
            return "<h1>Robustness</h1>\n"

    report = FakeReport()
    loaded: dict = {}

    def fake_load_workspace_robustness_report(workspace_path, robustness_id):
        loaded["workspace_path"] = workspace_path
        loaded["robustness_id"] = robustness_id
        return report

    monkeypatch.setattr(aggregated_api, "_get_workspace_path", lambda: tmp_path)
    monkeypatch.setattr(aggregated_api, "_load_workspace_robustness_report", fake_load_workspace_robustness_report)

    response = asyncio.run(
        aggregated_api.export_workspace_robustness_report(
            "rob report/1",
            format=export_format,
        )
    )

    assert loaded == {
        "workspace_path": tmp_path,
        "robustness_id": "rob report/1",
    }
    assert response.media_type == expected_media_type
    assert response.body.decode() == expected_body
    assert response.headers["content-disposition"] == f'attachment; filename="rob-report-1.{expected_extension}"'


def test_load_workspace_robustness_report_maps_missing_report_to_404(monkeypatch, tmp_path):
    robustness_module = importlib.import_module("nirs4all.api.robustness")

    def fake_load_workspace_robustness_report(workspace_path, robustness_id):
        raise KeyError(robustness_id)

    monkeypatch.setattr(robustness_module, "load_workspace_robustness_report", fake_load_workspace_robustness_report)

    with pytest.raises(HTTPException) as exc:
        aggregated_api._load_workspace_robustness_report(tmp_path, "missing")

    assert exc.value.status_code == 404
    assert "Robustness report not found: missing" in exc.value.detail
