from __future__ import annotations

import asyncio
from types import SimpleNamespace

import api.automl as automl_api
from api.analysis_results_repository import AnalysisResultsRepository
from api.jobs import JobStatus, JobType


def _automl_payload(job_id: str) -> dict:
    return {
        "job_id": job_id,
        "status": JobStatus.COMPLETED.value,
        "best_score": 0.91,
        "best_model": "PLSRegression",
        "best_params": {"n_components": 8},
        "trials": [
            {
                "trial_id": 7,
                "model_name": "PLSRegression",
                "params": {"n_components": 8},
                "score": 0.91,
                "std": None,
                "duration_seconds": 1.25,
                "status": "completed",
                "error": None,
            }
        ],
        "model_path": "/workspace/models/best.n4a",
        "search_duration_seconds": 12.5,
    }


def test_persist_automl_result_writes_response_payload(tmp_path):
    job_id = "automl_persisted_payload"

    storage = automl_api._persist_automl_result(
        job_id,
        _automl_payload(job_id),
        str(tmp_path),
        status=JobStatus.COMPLETED.value,
    )

    assert storage == "workspace_repository"
    assert AnalysisResultsRepository(tmp_path).load("automl", job_id) == _automl_payload(job_id)


def test_get_automl_results_loads_durable_payload_when_job_is_missing(tmp_path, monkeypatch):
    job_id = "automl_missing_job"
    AnalysisResultsRepository(tmp_path).save("automl", job_id, _automl_payload(job_id))

    monkeypatch.setattr(automl_api.job_manager, "get_job", lambda requested: None)
    monkeypatch.setattr(automl_api.workspace_manager, "get_active_workspace", lambda: SimpleNamespace(path=str(tmp_path)))

    response = asyncio.run(automl_api.get_automl_results(job_id))

    assert response.model_dump() == {
        "job_id": job_id,
        "status": "completed",
        "best_score": 0.91,
        "best_model": "PLSRegression",
        "best_params": {"n_components": 8},
        "all_trials": _automl_payload(job_id)["trials"],
        "model_path": "/workspace/models/best.n4a",
        "search_duration_seconds": 12.5,
    }


def test_get_automl_results_uses_durable_payload_when_completed_job_lost_result(tmp_path, monkeypatch):
    job_id = "automl_missing_result"
    AnalysisResultsRepository(tmp_path).save("automl", job_id, _automl_payload(job_id))

    job = SimpleNamespace(
        id=job_id,
        type=JobType.AUTOML,
        status=JobStatus.COMPLETED,
        result=None,
        config={"workspace_path": str(tmp_path)},
    )
    job._get_duration = lambda: 99.0

    monkeypatch.setattr(automl_api.job_manager, "get_job", lambda requested: job)
    monkeypatch.setattr(automl_api.workspace_manager, "get_active_workspace", lambda: None)

    response = asyncio.run(automl_api.get_automl_results(job_id))

    assert response.search_duration_seconds == 12.5
    assert response.best_model == "PLSRegression"
    assert response.all_trials[0].trial_id == 7
