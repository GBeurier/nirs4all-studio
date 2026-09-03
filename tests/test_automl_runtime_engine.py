from __future__ import annotations

import sys
from datetime import datetime
from types import SimpleNamespace

import api.automl as automl_api
from api.jobs import Job, JobStatus, JobType


def test_run_automl_task_forwards_runtime_engine_to_nirs4all(monkeypatch):
    calls: list[dict] = []

    class FakePredictions:
        def top(self, n: int):
            assert n == 20
            return [
                {
                    "model_name": "PLSRegression",
                    "model_params": {"n_components": 2},
                    "test_score": 0.91,
                }
            ]

    class FakeResult:
        predictions = FakePredictions()
        best = {"model_name": "PLSRegression", "model_params": {"n_components": 2}}
        best_score = 0.91

    def fake_run(
        *,
        engine=None,
        allow_fallback=False,
        **kwargs,
    ):
        calls.append({"engine": engine, "allow_fallback": allow_fallback, **kwargs})
        return FakeResult()

    monkeypatch.setitem(sys.modules, "nirs4all", SimpleNamespace(run=fake_run))
    monkeypatch.setattr(
        automl_api,
        "get_cached",
        lambda name: SimpleNamespace(run=fake_run) if name == "nirs4all" else None,
    )
    monkeypatch.setattr(
        "api.spectra._load_dataset",
        lambda dataset_id: SimpleNamespace(name="Dataset A"),
    )
    monkeypatch.setattr(
        automl_api,
        "_build_model_generator_step",
        lambda models_config, n_trials: {"model": "generator", "n_trials": n_trials},
    )
    monkeypatch.setattr(automl_api.job_manager, "update_job_metrics", lambda *args, **kwargs: None)
    monkeypatch.setattr(automl_api, "_persist_automl_result", lambda *args, **kwargs: None)

    job = Job(
        id="automl_1",
        type=JobType.AUTOML,
        status=JobStatus.RUNNING,
        created_at=datetime(2026, 7, 11, 1, 0, 0),
        config={
            "dataset_id": "dataset-a",
            "n_trials": 2,
            "cv_folds": 2,
            "random_state": 42,
            "models": [{"model_name": "PLSRegression"}],
            "workspace_path": None,
            "engine": "dag-ml",
            "allow_fallback": True,
        },
    )

    result = automl_api._run_automl_task(job, lambda progress, message: True)

    assert calls[0]["engine"] == "dag-ml"
    assert calls[0]["allow_fallback"] is True
    assert result["engine_requested"] == "dag-ml"
    assert result["engine"] == "dag-ml"
    assert result["fallback_policy"] == {
        "source": "nirs4all.run.allow_fallback",
        "engine_requested": "dag-ml",
        "allow_fallback": True,
        "mode": "allow_fallback",
    }
