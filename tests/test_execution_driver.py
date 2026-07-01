from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from types import SimpleNamespace

import pytest

from api.execution_driver import ExecutionRequest, LocalPythonExecutionDriver, get_execution_driver, list_execution_driver_capabilities
from api.execution_job_records import InMemoryExecutionJobRecordRepository
from api.jobs.manager import Job, JobStatus, JobType


def _command_result_to_dict(result):
    if isinstance(result, Mapping):
        return dict(result)

    to_dict = getattr(result, "to_dict", None)
    if callable(to_dict):
        return to_dict()

    raise AssertionError("Execution driver command result must be dict-like")


def test_local_python_driver_builds_legacy_job_config_with_metadata():
    request = ExecutionRequest(
        run_id="run-1",
        run_name="Experiment",
        requested_backend="local-python",
        total_pipelines=3,
        dataset_count=2,
        workspace_path="/tmp/workspace",
        created_at="2026-06-30T10:00:00",
        metadata={"source": "test"},
    )

    config = LocalPythonExecutionDriver().build_job_config(request)

    assert config["run_id"] == "run-1"
    assert config["run_name"] == "Experiment"
    assert config["execution_backend"] == "local-python"
    assert config["execution_request"] == {
        "run_id": "run-1",
        "run_name": "Experiment",
        "requested_backend": "local-python",
        "total_pipelines": 3,
        "dataset_count": 2,
        "has_workspace": True,
        "fallback_policy": {
            "source": "nirs4all.run.allow_fallback",
            "engine_requested": None,
            "allow_fallback": False,
            "mode": "refuse_fallback",
        },
        "created_at": "2026-06-30T10:00:00",
        "metadata": {"source": "test"},
    }
    assert config["execution_driver"]["backend"] == "local-python"
    assert config["execution_driver"]["available"] is True
    assert config["execution_driver"]["metadata"]["runner"] == "nirs4all.run"


def test_local_python_driver_submits_training_job_with_run_id():
    class DummyJobManager:
        def __init__(self):
            self.created = None
            self.submitted = None

        def create_job(self, job_type, config, job_id=None):
            self.created = (job_type, config, job_id)
            return SimpleNamespace(id=job_id, config=config)

        def submit_job(self, job, task_fn):
            self.submitted = (job, task_fn)
            return job

    manager = DummyJobManager()
    request = ExecutionRequest(run_id="run-2", run_name="Local run")

    def task_fn(job, progress_callback):
        return {"run_id": job.id}

    job = LocalPythonExecutionDriver().submit(request, manager, task_fn)

    assert manager.created[0] == JobType.TRAINING
    assert manager.created[2] == "run-2"
    assert manager.submitted == (job, task_fn)
    assert job.config["run_id"] == "run-2"


def test_local_python_driver_cancel_job_returns_success_command_result():
    class DummyJobManager:
        def __init__(self):
            self.cancelled_job_ids = []
            self.submitted = False

        def cancel_job(self, job_id):
            self.cancelled_job_ids.append(job_id)
            return True

        def submit_job(self, job, task_fn):
            self.submitted = True
            raise AssertionError("cancel_job must not submit a new job")

    manager = DummyJobManager()

    result = LocalPythonExecutionDriver().cancel_job("run-cancel", manager)
    payload = _command_result_to_dict(result)

    assert manager.cancelled_job_ids == ["run-cancel"]
    assert manager.submitted is False
    assert payload["action"] == "cancel"
    assert payload["job_id"] == "run-cancel"
    assert payload["success"] is True


def test_local_python_driver_cancel_job_returns_not_found_command_result():
    class DummyJobManager:
        def __init__(self):
            self.cancelled_job_ids = []
            self.submitted = False

        def cancel_job(self, job_id):
            self.cancelled_job_ids.append(job_id)
            return False

        def submit_job(self, job, task_fn):
            self.submitted = True
            raise AssertionError("cancel_job must not submit a new job")

    manager = DummyJobManager()

    result = LocalPythonExecutionDriver().cancel_job("missing-run", manager)
    payload = _command_result_to_dict(result)

    assert manager.cancelled_job_ids == ["missing-run"]
    assert manager.submitted is False
    assert payload["action"] == "cancel"
    assert payload["job_id"] == "missing-run"
    assert payload["success"] is False
    assert "message" in payload
    assert "missing-run" in payload["message"]
    assert "not found" in payload["message"].lower()


def test_local_python_driver_emits_records_for_injected_repository():
    class DummyJobManager:
        def __init__(self):
            self.callbacks = {}

        def create_job(self, job_type, config, job_id=None):
            return Job(
                id=job_id,
                type=job_type,
                status=JobStatus.PENDING,
                created_at=datetime(2026, 6, 30, 10, 0, 0),
                config=config,
            )

        def register_callback(self, job_id, callback):
            self.callbacks.setdefault(job_id, []).append(callback)

        def submit_job(self, job, task_fn):
            job.status = JobStatus.RUNNING
            job.started_at = datetime(2026, 6, 30, 10, 0, 1)
            for callback in self.callbacks[job.id]:
                callback(job)

            job.progress = 50.0
            job.progress_message = "halfway"
            for callback in self.callbacks[job.id]:
                callback(job)

            job.status = JobStatus.COMPLETED
            job.progress = 100.0
            job.progress_message = "done"
            job.completed_at = datetime(2026, 6, 30, 10, 0, 2)
            for callback in self.callbacks[job.id]:
                callback(job)
            return job

    repository = InMemoryExecutionJobRecordRepository()
    manager = DummyJobManager()
    request = ExecutionRequest(
        run_id="run-3",
        run_name="Future backend",
        requested_backend="local-python",
        total_pipelines=5,
        dataset_count=1,
        metadata={"source": "unit-test"},
    )

    def task_fn(job, progress_callback):
        return {"run_id": job.id}

    LocalPythonExecutionDriver(job_record_repository=repository).submit(request, manager, task_fn)

    assert [record.status for record in repository.history] == [
        "pending",
        "running",
        "running",
        "completed",
    ]
    record = repository.get("run-3")
    assert record is not None
    assert record.to_dict() == {
        "job_id": "run-3",
        "job_type": "training",
        "requested_backend": "local-python",
        "execution_backend": "local-python",
        "execution_mode": "in-process",
        "status": "completed",
        "progress": 100.0,
        "progress_message": "done",
        "progress_unavailable": False,
        "created_at": "2026-06-30T10:00:00",
        "started_at": "2026-06-30T10:00:01",
        "completed_at": "2026-06-30T10:00:02",
        "request": {
            "run_id": "run-3",
            "run_name": "Future backend",
            "requested_backend": "local-python",
            "total_pipelines": 5,
            "dataset_count": 1,
            "has_workspace": False,
            "fallback_policy": {
                "source": "nirs4all.run.allow_fallback",
                "engine_requested": None,
                "allow_fallback": False,
                "mode": "refuse_fallback",
            },
            "metadata": {"source": "unit-test"},
        },
        "driver": {
            "backend": "local-python",
            "label": "Local Python",
            "available": True,
            "mode": "in-process",
            "supports_progress": True,
            "supports_cancellation": True,
            "metadata": {
                "job_type": "training",
                "scheduler": "job-manager-thread-pool",
                "runner": "nirs4all.run",
            },
        },
        "metrics": {},
        "error": None,
    }


@pytest.mark.parametrize("backend", ["cluster", "wasm-local"])
def test_non_local_requests_resolve_to_unavailable_driver_placeholders(backend):
    driver = get_execution_driver(backend)
    capability = driver.capability

    assert capability.backend == backend
    assert capability.available is False
    assert capability.supports_progress is False
    assert capability.supports_cancellation is False
    assert capability.metadata["reason"] == "driver_unavailable"

    request = ExecutionRequest(run_id="run-unavailable", run_name="Unavailable run", requested_backend=backend)
    config = driver.build_job_config(request)
    assert config["execution_backend"] == backend
    assert config["execution_driver"]["backend"] == backend
    assert config["execution_driver"]["available"] is False

    with pytest.raises(RuntimeError, match="no .* driver is configured"):
        driver.submit(request, SimpleNamespace(), lambda job, progress: None)

    result = _command_result_to_dict(driver.cancel_job("run-unavailable", SimpleNamespace()))
    assert result["action"] == "cancel"
    assert result["job_id"] == "run-unavailable"
    assert result["success"] is False
    assert result["backend"] == backend
    assert result["metadata"]["reason"] == "driver_unavailable"
    assert result["metadata"]["rt_error"]["cause"] == "unavailable_backend"
    assert result["metadata"]["rt_error"]["verb"] == "cancel"


def test_lists_execution_driver_capabilities_for_every_typed_backend():
    capabilities = list_execution_driver_capabilities()
    payloads = [capability.to_dict() for capability in capabilities]

    assert [payload["backend"] for payload in payloads] == [
        "local-python",
        "cluster",
        "wasm-local",
    ]
    assert payloads[0]["available"] is True
    assert payloads[0]["supports_progress"] is True
    assert payloads[0]["supports_cancellation"] is True
    assert payloads[1]["available"] is False
    assert payloads[1]["metadata"]["reason"] == "driver_unavailable"
    assert payloads[2]["available"] is False
    assert payloads[2]["metadata"]["reason"] == "driver_unavailable"
