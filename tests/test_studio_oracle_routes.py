"""Focused Studio-oracle coverage for legacy run wrappers.

These routes predate ``api.runs`` engine routing. The tests keep the altitude
small: stub the scientific library and assert Studio forwards the engine policy
and records the runtime outcome instead of silently calling the library default.
"""

from __future__ import annotations

import asyncio
import sys
from types import SimpleNamespace

import pytest

import api.automl as automl_api
import api.nirs4all_adapter as adapter_api
import api.pipeline_canonical as pipeline_canonical
import api.pipelines as pipelines_api
import api.spectra as spectra_api
import api.training as training_api


class _RuntimeResult:
    best = {"model_name": "PLSRegression", "model_params": {"n_components": 4}}
    best_score = 0.91

    def __init__(self, engine: str = "dag-ml") -> None:
        self.engine = engine
        self.predictions = SimpleNamespace(
            top=lambda n=None: [
                {
                    "model_name": "PLSRegression",
                    "model_params": {"n_components": 4},
                    "test_score": 0.91,
                    "scores": {"test": {"r2": 0.91}},
                }
            ]
        )
        self.exported_to: str | None = None

    def __len__(self) -> int:
        return 1

    def top(self, n: int = 1):  # noqa: ANN201
        return [SimpleNamespace(model_name="PLSRegression", rmse=0.1, r2=0.91)][:n]

    def export(self, path: str) -> None:
        self.exported_to = path

    def to_rt_result(self):  # noqa: ANN201
        return {
            "manifest": {"engine": self.engine, "fingerprints": {"score_set_hash": "sha256:test"}},
            "diagnostics": [],
        }


def _progress(_progress: float, _message: str = "") -> bool:
    return True


def _install_fake_nirs4all(monkeypatch, calls: list[dict]) -> None:
    def fake_run(**kwargs):  # noqa: ANN003
        calls.append(dict(kwargs))
        return _RuntimeResult(engine=kwargs.get("engine") or "legacy")

    monkeypatch.setitem(sys.modules, "nirs4all", SimpleNamespace(run=fake_run))


def _stub_pipeline_task_deps(monkeypatch) -> None:
    monkeypatch.setattr(spectra_api, "_load_dataset", lambda _dataset_id: SimpleNamespace(name="Dataset A"))
    monkeypatch.setattr(
        pipelines_api,
        "prepare_pipeline_steps_with_runtime_grouping",
        lambda steps, _dataset, _group_by: SimpleNamespace(warnings=[], steps=steps),
    )
    monkeypatch.setattr(pipelines_api, "editor_steps_to_runtime_canonical", lambda _steps: ["runtime-step"])
    monkeypatch.setattr(pipelines_api, "count_runtime_variants", lambda _steps: 1)
    monkeypatch.setattr(adapter_api, "extract_best_metrics", lambda _result: {"r2": 0.91, "score": 0.91})


def test_training_task_threads_engine_and_records_runtime(monkeypatch, tmp_path):
    calls: list[dict] = []
    _install_fake_nirs4all(monkeypatch, calls)

    monkeypatch.setattr(pipelines_api, "_load_pipeline", lambda _pipeline_id: {"name": "Pipe", "steps": [{"id": "m"}]})
    monkeypatch.setattr(adapter_api, "build_dataset_config", lambda _dataset_id: {"dataset": "dataset-a"})
    monkeypatch.setattr(adapter_api, "extract_best_metrics", lambda _result: {"r2": 0.91, "score": 0.91})
    monkeypatch.setattr(pipeline_canonical, "editor_steps_to_runtime_canonical", lambda _steps: ["runtime-step"])
    for name in (
        "_send_refit_started",
        "_send_refit_step",
        "_send_refit_progress",
        "_send_refit_completed",
        "_send_training_completion_notification",
    ):
        monkeypatch.setattr(training_api, name, lambda *args, **kwargs: None)
    monkeypatch.setattr(training_api.job_manager, "update_job_metrics", lambda *args, **kwargs: True)

    job = SimpleNamespace(
        id="training-job",
        config={
            "pipeline_id": "pipe-a",
            "dataset_id": "dataset-a",
            "workspace_path": str(tmp_path),
            "verbose": 0,
            "random_state": 7,
            "save_best_model": False,
            "engine": "dag-ml",
            "allow_fallback": False,
            "refit": True,
        },
    )

    payload = training_api._run_training_task(job, _progress)

    assert calls[0]["engine"] == "dag-ml"
    assert calls[0]["allow_fallback"] is False
    assert calls[0]["results_path"] == str(tmp_path / "nirs4all_results")
    assert "workspace_path" not in calls[0]
    assert payload["engine"] == "dag-ml"
    assert payload["engine_requested"] == "dag-ml"
    assert payload["fallback_policy"]["allow_fallback"] is False


def test_automl_task_threads_engine_and_persists_runtime(monkeypatch, tmp_path):
    calls: list[dict] = []

    def fake_run(**kwargs):  # noqa: ANN003
        calls.append(dict(kwargs))
        return _RuntimeResult()

    monkeypatch.setattr(automl_api, "get_cached", lambda _name: SimpleNamespace(run=fake_run))
    monkeypatch.setattr(spectra_api, "_load_dataset", lambda _dataset_id: SimpleNamespace(name="Dataset A"))
    monkeypatch.setattr(automl_api, "_build_model_generator_step", lambda _models, _n_trials: {"model": "generator"})
    monkeypatch.setattr(automl_api, "_persist_automl_result", lambda *args, **kwargs: "memory_cache")
    monkeypatch.setattr(automl_api.job_manager, "update_job_metrics", lambda *args, **kwargs: True)

    job = SimpleNamespace(
        id="automl-job",
        cancellation_requested=False,
        config={
            "dataset_id": "dataset-a",
            "models": [{"model_name": "PLSRegression", "enabled": True}],
            "n_trials": 5,
            "cv_folds": 2,
            "random_state": 7,
            "workspace_path": str(tmp_path),
            "engine": "dag-ml",
            "allow_fallback": False,
        },
    )

    payload = automl_api._run_automl_task(job, _progress)

    assert calls[0]["engine"] == "dag-ml"
    assert calls[0]["allow_fallback"] is False
    assert calls[0]["results_path"] == str(tmp_path / "nirs4all_results")
    assert "workspace_path" not in calls[0]
    assert payload["engine"] == "dag-ml"
    assert payload["engine_requested"] == "dag-ml"
    assert payload["fallback_policy"]["allow_fallback"] is False


def test_pipeline_execute_task_threads_engine_and_returns_runtime(monkeypatch, tmp_path):
    calls: list[dict] = []
    _install_fake_nirs4all(monkeypatch, calls)
    _stub_pipeline_task_deps(monkeypatch)

    job = SimpleNamespace(
        config={
            "pipeline_id": "pipe-a",
            "pipeline_name": "Pipe",
            "pipeline_steps": [{"id": "m"}],
            "dataset_id": "dataset-a",
            "dataset_path": "dataset-path",
            "workspace_path": str(tmp_path),
            "verbose": 0,
            "export_model": False,
            "engine": "dag-ml",
            "allow_fallback": False,
        }
    )

    payload = pipelines_api._run_pipeline_task(job, _progress)

    assert payload["success"] is True
    assert calls[0]["engine"] == "dag-ml"
    assert calls[0]["allow_fallback"] is False
    assert calls[0]["results_path"] == str(tmp_path / "nirs4all_results")
    assert "workspace_path" not in calls[0]
    assert payload["engine"] == "dag-ml"
    assert payload["engine_requested"] == "dag-ml"
    assert payload["fallback_policy"]["allow_fallback"] is False


@pytest.mark.parametrize("engine", [None, "legacy"])
def test_pipeline_execute_task_preserves_legacy_workspace_kwargs(monkeypatch, tmp_path, engine):
    calls: list[dict] = []
    _install_fake_nirs4all(monkeypatch, calls)
    _stub_pipeline_task_deps(monkeypatch)

    job = SimpleNamespace(
        config={
            "pipeline_id": "pipe-a",
            "pipeline_name": "Pipe",
            "pipeline_steps": [{"id": "m"}],
            "dataset_id": "dataset-a",
            "dataset_path": "dataset-path",
            "workspace_path": str(tmp_path),
            "verbose": 0,
            "export_model": False,
            "engine": engine,
            "allow_fallback": False,
        }
    )

    payload = pipelines_api._run_pipeline_task(job, _progress)

    assert payload["success"] is True
    assert "workspace_path" not in calls[0]
    assert "results_path" not in calls[0]
    if engine is None:
        assert "engine" not in calls[0]
    else:
        assert calls[0]["engine"] == "legacy"


def test_training_metrics_response_exposes_runtime_fields(monkeypatch):
    fallback_policy = {
        "source": "nirs4all.run.allow_fallback",
        "engine_requested": "dag-ml",
        "allow_fallback": False,
        "mode": "refuse_fallback",
    }
    job = SimpleNamespace(
        id="training-job",
        type=training_api.JobType.TRAINING,
        config={"total_variants": 1},
        history=[],
        metrics={
            "current_epoch": 1,
            "train": {"r2": 0.91},
            "best": {"r2": 0.91},
            "engine": "dag-ml",
            "engine_requested": "dag-ml",
            "runtime_source": "rt_result",
            "fallback_policy": fallback_policy,
        },
    )
    monkeypatch.setattr(training_api.job_manager, "get_job", lambda _job_id: job)

    response = asyncio.run(training_api.get_training_metrics("training-job"))

    assert response.engine == "dag-ml"
    assert response.engine_requested == "dag-ml"
    assert response.runtime_source == "rt_result"
    assert response.fallback_policy == fallback_policy
