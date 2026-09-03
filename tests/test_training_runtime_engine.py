from __future__ import annotations

import asyncio
import sys
from datetime import datetime
from types import SimpleNamespace

import pytest

import api.pipeline_canonical as pipeline_canonical
import api.pipelines as pipelines_api
import api.spectra as spectra_api
import api.training as training_api
from api.jobs import Job, JobStatus, JobType
from api.training import TrainingRequest


def test_training_request_accepts_runtime_engine_options() -> None:
    request = TrainingRequest(
        pipeline_id="pipeline-a",
        dataset_id="dataset-a",
        engine="dag-ml",
        allow_fallback=True,
    )

    assert request.engine == "dag-ml"
    assert request.allow_fallback is True


def test_start_training_persists_runtime_engine_in_job_config(monkeypatch: pytest.MonkeyPatch) -> None:
    created_configs: list[dict] = []
    submitted: list[tuple[Job, object]] = []

    job = Job(
        id="training_1",
        type=JobType.TRAINING,
        status=JobStatus.PENDING,
        created_at=datetime(2026, 7, 11, 1, 0, 0),
        config={},
    )

    def fake_create_job(job_type, config):
        assert job_type == JobType.TRAINING
        created_configs.append(config)
        job.config = config
        return job

    monkeypatch.setattr(training_api.workspace_manager, "get_current_workspace", lambda: SimpleNamespace(path="/tmp/ws"))
    monkeypatch.setattr(training_api, "require_nirs4all", lambda: None)
    monkeypatch.setattr(pipelines_api, "_load_pipeline", lambda pipeline_id: {"name": "Pipeline A", "steps": []})
    monkeypatch.setattr(spectra_api, "_load_dataset", lambda dataset_id: SimpleNamespace(name="Dataset A"))
    monkeypatch.setattr(training_api.job_manager, "create_job", fake_create_job)
    monkeypatch.setattr(training_api.job_manager, "submit_job", lambda job, task: submitted.append((job, task)))

    response = asyncio.run(
        training_api.start_training(
            TrainingRequest(
                pipeline_id="pipeline-a",
                dataset_id="dataset-a",
                engine="dag-ml",
                allow_fallback=True,
            )
        )
    )

    assert response.job_id == "training_1"
    assert created_configs[0]["engine"] == "dag-ml"
    assert created_configs[0]["allow_fallback"] is True
    assert submitted == [(job, training_api._run_training_task)]


def test_run_training_task_forwards_runtime_engine_to_nirs4all(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict] = []

    class FakeResult:
        def __len__(self) -> int:
            return 1

        def top(self, n: int):
            assert n == 1
            return [SimpleNamespace(model_name="PLSRegression")]

    def fake_run(
        pipeline,
        dataset,
        *,
        verbose=1,
        random_state=None,
        workspace_path=None,
        engine=None,
        allow_fallback=False,
        **kwargs,
    ):
        calls.append(
            {
                "pipeline": pipeline,
                "dataset": dataset,
                "verbose": verbose,
                "random_state": random_state,
                "workspace_path": workspace_path,
                "engine": engine,
                "allow_fallback": allow_fallback,
                **kwargs,
            }
        )
        return FakeResult()

    fake_adapter = SimpleNamespace(
        build_dataset_config=lambda dataset_id: {"dataset": dataset_id},
        extract_best_metrics=lambda result: {"r2": 0.91, "score": 0.91},
    )
    monkeypatch.setitem(sys.modules, "nirs4all", SimpleNamespace(run=fake_run))
    monkeypatch.setitem(sys.modules, "api.nirs4all_adapter", fake_adapter)
    monkeypatch.setattr(pipelines_api, "_load_pipeline", lambda pipeline_id: {"steps": [{"type": "pls"}]})
    monkeypatch.setattr(pipeline_canonical, "editor_steps_to_runtime_canonical", lambda steps: [{"model": "PLS"}])
    monkeypatch.setattr(training_api, "_send_refit_started", lambda *args, **kwargs: None)
    monkeypatch.setattr(training_api, "_send_refit_step", lambda *args, **kwargs: None)
    monkeypatch.setattr(training_api, "_send_refit_progress", lambda *args, **kwargs: None)
    monkeypatch.setattr(training_api, "_send_refit_completed", lambda *args, **kwargs: None)
    monkeypatch.setattr(training_api, "_send_training_completion_notification", lambda *args, **kwargs: None)

    job = Job(
        id="training_1",
        type=JobType.TRAINING,
        status=JobStatus.RUNNING,
        created_at=datetime(2026, 7, 11, 1, 0, 0),
        config={
            "pipeline_id": "pipeline-a",
            "dataset_id": "dataset-a",
            "verbose": 1,
            "random_state": 42,
            "workspace_path": "/tmp/ws",
            "save_best_model": False,
            "engine": "dag-ml",
            "allow_fallback": True,
        },
    )

    result = training_api._run_training_task(job, lambda progress, message: True)

    assert calls[0]["engine"] == "dag-ml"
    # R2 always makes the nominal attempt fail closed. The orchestration layer
    # performs the explicit legacy retry only after a structured refusal.
    assert calls[0]["allow_fallback"] is False
    assert result["engine_requested"] == "dag-ml"
    assert result["fallback_policy"] == {
        "source": "nirs4all.run.allow_fallback",
        "engine_requested": "dag-ml",
        "allow_fallback": True,
        "mode": "allow_fallback",
    }
