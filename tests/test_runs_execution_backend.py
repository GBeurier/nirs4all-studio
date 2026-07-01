from __future__ import annotations

import json
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.pipelines as pipelines_api
import api.runs as runs_api
import api.spectra as spectra_api
from api.execution_driver import ExecutionJobCommandResult
from api.execution_job_records import ExecutionJobRecord, WorkspaceExecutionJobRecordRepository
from api.jobs.manager import Job, JobStatus, JobType
from api.run_execution_plan import build_legacy_run_execution_plan, build_retry_run_execution_plan


def test_create_run_from_config_defaults_to_local_python_backend(tmp_path):
    run = runs_api._create_run_from_config(
        runs_api.ExperimentConfig(
            name="Local experiment",
            dataset_ids=["dataset-a"],
            pipeline_ids=["pipe-a"],
        ),
        dataset_infos={"dataset-a": {"name": "Dataset A", "id": "dataset-a"}},
        pipeline_configs={"pipe-a": {"name": "Pipeline A", "steps": []}},
        workspace_path=str(tmp_path),
    )

    assert run.execution_backend == "local-python"


def test_create_run_from_config_copies_requested_execution_backend(tmp_path):
    run = runs_api._create_run_from_config(
        runs_api.ExperimentConfig(
            name="Cluster experiment",
            dataset_ids=["dataset-a"],
            pipeline_ids=["pipe-a"],
            execution_backend="cluster",
        ),
        dataset_infos={"dataset-a": {"name": "Dataset A", "id": "dataset-a"}},
        pipeline_configs={"pipe-a": {"name": "Pipeline A", "steps": []}},
        workspace_path=str(tmp_path),
    )

    assert run.execution_backend == "cluster"


def test_start_run_job_adds_execution_driver_metadata(monkeypatch):
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
    monkeypatch.setattr(runs_api, "job_manager", manager)
    run = runs_api.Run(
        id="run-1",
        name="Local request",
        execution_backend="local-python",
        datasets=[],
        status="queued",
        created_at="2026-06-30T10:00:00",
        total_pipelines=0,
        completed_pipelines=0,
    )

    job = runs_api._start_run_job(run)

    assert manager.created[2] == "run-1"
    assert manager.submitted[0] is job
    assert job.config["run_id"] == "run-1"
    assert job.config["run_name"] == "Local request"
    assert job.config["execution_backend"] == "local-python"
    assert job.config["execution_request"]["requested_backend"] == "local-python"
    assert job.config["execution_driver"]["backend"] == "local-python"


def test_start_run_job_adds_campaign_shaped_execution_metadata(monkeypatch):
    class DummyJobManager:
        def create_job(self, job_type, config, job_id=None):
            return SimpleNamespace(id=job_id, config=config)

        def submit_job(self, job, task_fn):
            return job

    monkeypatch.setattr(runs_api, "job_manager", DummyJobManager())
    run = runs_api.Run(
        id="run-1",
        name="Local campaign",
        execution_backend="local-python",
        datasets=[
            runs_api.DatasetRun(
                dataset_id="dataset-a",
                dataset_name="Dataset A",
                split_group_by="subject",
                pipelines=[
                    runs_api.PipelineRun(
                        id="run-1-dataset-a-pipe-a",
                        pipeline_id="pipe-a",
                        pipeline_name="Pipeline A",
                        model="PLS",
                        preprocessing="SNV",
                        split_strategy="KFold(5)",
                        status="queued",
                    ),
                    runs_api.PipelineRun(
                        id="run-1-dataset-a-pipe-b",
                        pipeline_id="pipe-b",
                        pipeline_name="Pipeline B",
                        model="Ridge",
                        preprocessing="None",
                        split_strategy="KFold(5)",
                        status="queued",
                    ),
                ],
            )
        ],
        status="queued",
        created_at="2026-06-30T10:00:00",
        total_pipelines=2,
        completed_pipelines=0,
        project_id="project-1",
    )

    job = runs_api._start_run_job(run)

    assert job.config["execution_request"]["metadata"] == {
        "kind": "campaign",
        "campaign_shape": "legacy-cartesian",
        "dataset_bindings": [
            {
                "dataset_id": "dataset-a",
                "dataset_name": "Dataset A",
                "split_group_by": "subject",
                "pipeline_count": 2,
                "pipeline_ids": ["pipe-a", "pipe-b"],
            }
        ],
        "planned_pipeline_runs": 2,
        "project_id": "project-1",
    }


def test_start_run_job_preserves_requested_engine_in_execution_request(monkeypatch):
    class DummyJobManager:
        def create_job(self, job_type, config, job_id=None):
            return SimpleNamespace(id=job_id, config=config)

        def submit_job(self, job, task_fn):
            return job

    monkeypatch.setattr(runs_api, "job_manager", DummyJobManager())
    run = runs_api.Run(
        id="run-1",
        name="DAG ML request",
        execution_backend="local-python",
        engine="dag-ml",
        datasets=[],
        status="queued",
        created_at="2026-06-30T10:00:00",
        total_pipelines=0,
        completed_pipelines=0,
    )

    job = runs_api._start_run_job(run)

    assert job.config["execution_request"]["requested_engine"] == "dag-ml"


def test_create_run_route_rejects_unavailable_backend_before_mutating_state(monkeypatch, tmp_path):
    saved_runs = []
    started_runs = []

    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {})
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: saved_runs.append(run) or True)
    monkeypatch.setattr(runs_api, "_start_run_job", lambda run: started_runs.append(run))
    monkeypatch.setattr(
        runs_api.workspace_manager,
        "get_current_workspace",
        lambda: SimpleNamespace(path=str(tmp_path)),
    )

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.post(
            "/api/runs",
            json={
                "config": {
                    "name": "Unavailable cluster run",
                    "dataset_ids": ["dataset-a"],
                    "pipeline_ids": ["pipe-a"],
                    "execution_backend": "cluster",
                    "cv_folds": 2,
                }
            },
        )

    assert response.status_code == 501
    assert response.json()["detail"] == {
        "verb": "run",
        "cause": "unavailable_backend",
        "message": "Cluster execution is typed but no cluster driver is configured.",
        "mitigation": "Run on an available execution backend, or configure a driver for this backend.",
    }
    assert runs_api._runs == {}
    assert saved_runs == []
    assert started_runs == []


def test_execution_backends_route_lists_capabilities_before_run_id_route():
    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")

    with TestClient(app) as client:
        response = client.get("/api/runs/execution-backends")

    assert response.status_code == 200
    assert response.json() == {
        "default_backend": "local-python",
        "backends": [
            {
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
            {
                "backend": "cluster",
                "label": "Cluster",
                "available": False,
                "mode": "in-process",
                "supports_progress": False,
                "supports_cancellation": False,
                "metadata": {
                    "reason": "driver_unavailable",
                    "message": "Cluster execution is typed but no cluster driver is configured.",
                },
            },
            {
                "backend": "wasm-local",
                "label": "WASM Local",
                "available": False,
                "mode": "in-process",
                "supports_progress": False,
                "supports_cancellation": False,
                "metadata": {
                    "reason": "driver_unavailable",
                    "message": "WASM local execution is typed but no WASM driver is configured.",
                },
            },
        ],
    }


def test_stop_run_cancels_through_execution_driver(monkeypatch):
    cancel_calls = []
    saved_runs = []

    class DummyDriver:
        def cancel_job(self, job_id, manager):
            cancel_calls.append((job_id, manager))
            return ExecutionJobCommandResult(
                action="cancel",
                job_id=job_id,
                success=True,
                message=f"cancelled {job_id}",
                backend="cluster",
                metadata={"driver": "dummy"},
            )

    dummy_job_manager = SimpleNamespace(name="job-manager")
    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "job_manager", dummy_job_manager)
    monkeypatch.setattr(runs_api, "get_execution_driver", lambda backend: DummyDriver())
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: saved_runs.append(run))

    run = runs_api.Run(
        id="run-1",
        name="Cluster run",
        execution_backend="cluster",
        datasets=[
            runs_api.DatasetRun(
                dataset_id="dataset-a",
                dataset_name="Dataset A",
                pipelines=[
                    runs_api.PipelineRun(
                        id="pipeline-run-1",
                        pipeline_id="pipeline-1",
                        pipeline_name="Pipeline 1",
                        model="PLS",
                        preprocessing="SNV",
                        split_strategy="KFold(5)",
                        status="running",
                    ),
                    runs_api.PipelineRun(
                        id="pipeline-run-2",
                        pipeline_id="pipeline-2",
                        pipeline_name="Pipeline 2",
                        model="Ridge",
                        preprocessing="None",
                        split_strategy="KFold(5)",
                        status="completed",
                    ),
                ],
            )
        ],
        status="running",
        created_at="2026-06-30T10:00:00",
        total_pipelines=2,
        completed_pipelines=1,
    )
    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.post("/api/runs/run-1/stop")

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "message": "Run run-1 stopped",
        "run_id": "run-1",
    }
    assert cancel_calls == [("run-1", dummy_job_manager)]
    assert run.status == "failed"
    assert run.datasets[0].pipelines[0].status == "failed"
    assert run.datasets[0].pipelines[0].error_message == "Stopped by user"
    assert run.datasets[0].pipelines[1].status == "completed"
    assert saved_runs == [run]


def test_start_run_job_persists_workspace_execution_job_record(monkeypatch, tmp_path):
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
            return job

    monkeypatch.setattr(runs_api, "job_manager", DummyJobManager())
    run = runs_api.Run(
        id="run-1",
        name="Workspace run",
        execution_backend="local-python",
        engine="dag-ml",
        datasets=[],
        status="queued",
        created_at="2026-06-30T10:00:00",
        total_pipelines=0,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
    )

    runs_api._start_run_job(run)

    record_path = tmp_path / "runs" / "run-1" / "execution_job_record.json"
    payload = json.loads(record_path.read_text(encoding="utf-8"))
    assert payload["job_id"] == "run-1"
    assert payload["job_type"] == JobType.TRAINING.value
    assert payload["requested_backend"] == "local-python"
    assert payload["execution_backend"] == "local-python"
    assert payload["status"] == "running"
    assert payload["request"]["run_id"] == "run-1"
    assert payload["request"]["has_workspace"] is True
    assert payload["request"]["requested_engine"] == "dag-ml"


def test_get_run_execution_job_record_reads_workspace_snapshot(monkeypatch, tmp_path):
    WorkspaceExecutionJobRecordRepository(tmp_path).save_job_record(
        ExecutionJobRecord(
            job_id="run-1",
            job_type=JobType.TRAINING.value,
            requested_backend="cluster",
            execution_backend="local-python",
            execution_mode="in-process",
            status="running",
            progress=25.0,
            progress_message="training",
            created_at="2026-06-30T10:00:00",
            started_at="2026-06-30T10:00:01",
            request={"run_id": "run-1", "has_workspace": True},
            driver={"backend": "local-python"},
        )
    )
    run = runs_api.Run(
        id="run-1",
        name="Workspace run",
        execution_backend="cluster",
        datasets=[],
        status="running",
        created_at="2026-06-30T10:00:00",
        total_pipelines=0,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
    )
    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.get("/api/runs/run-1/execution-job-record")

    assert response.status_code == 200
    payload = response.json()
    assert payload["job_id"] == "run-1"
    assert payload["requested_backend"] == "cluster"
    assert payload["execution_backend"] == "local-python"
    assert payload["status"] == "running"
    assert payload["progress"] == 25.0
    assert payload["request"] == {"run_id": "run-1", "has_workspace": True}
    assert payload["run_id"] == "run-1"
    assert payload["run_name"] == "Workspace run"
    assert payload["run_status"] == "running"
    assert payload["is_orphaned"] is False


def test_get_run_execution_job_record_returns_404_when_snapshot_missing(monkeypatch, tmp_path):
    run = runs_api.Run(
        id="run-1",
        name="Workspace run",
        execution_backend="cluster",
        datasets=[],
        status="running",
        created_at="2026-06-30T10:00:00",
        total_pipelines=0,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
    )
    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.get("/api/runs/run-1/execution-job-record")

    assert response.status_code == 404
    assert response.json()["detail"] == "Execution job record for run run-1 not found"


def test_list_run_execution_job_records_reads_and_filters_snapshots(monkeypatch, tmp_path):
    repository = WorkspaceExecutionJobRecordRepository(tmp_path)
    repository.save_job_record(
        ExecutionJobRecord(
            job_id="run-1",
            job_type=JobType.TRAINING.value,
            requested_backend="cluster",
            execution_backend="local-python",
            execution_mode="in-process",
            status="running",
            progress=25.0,
            progress_message="training",
            created_at="2026-06-30T10:00:00",
        )
    )
    repository.save_job_record(
        ExecutionJobRecord(
            job_id="run-2",
            job_type=JobType.TRAINING.value,
            requested_backend="wasm-local",
            execution_backend="local-python",
            execution_mode="in-process",
            status="completed",
            progress=100.0,
            progress_message="done",
            created_at="2026-06-30T11:00:00",
        )
    )
    runs = {
        "run-1": runs_api.Run(
            id="run-1",
            name="Cluster run",
            execution_backend="cluster",
            datasets=[],
            status="running",
            created_at="2026-06-30T10:00:00",
            total_pipelines=0,
            completed_pipelines=0,
            workspace_path=str(tmp_path),
        ),
        "run-2": runs_api.Run(
            id="run-2",
            name="WASM run",
            execution_backend="wasm-local",
            datasets=[],
            status="completed",
            created_at="2026-06-30T11:00:00",
            total_pipelines=0,
            completed_pipelines=0,
            workspace_path=str(tmp_path),
        ),
        "run-3": runs_api.Run(
            id="run-3",
            name="No snapshot",
            execution_backend="local-python",
            datasets=[],
            status="completed",
            created_at="2026-06-30T12:00:00",
            total_pipelines=0,
            completed_pipelines=0,
            workspace_path=str(tmp_path),
        ),
    }
    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", runs)

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.get("/api/runs/execution-job-records")
        filtered = client.get(
            "/api/runs/execution-job-records",
            params={"run_status": "completed", "requested_backend": "wasm-local"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert [record["job_id"] for record in payload["records"]] == ["run-2", "run-1"]
    assert payload["records"][0]["run_name"] == "WASM run"
    assert payload["records"][0]["run_status"] == "completed"

    assert filtered.status_code == 200
    filtered_payload = filtered.json()
    assert filtered_payload["total"] == 1
    assert filtered_payload["records"][0]["job_id"] == "run-2"


def test_list_run_execution_job_records_can_include_orphaned_workspace_snapshots(monkeypatch, tmp_path):
    repository = WorkspaceExecutionJobRecordRepository(tmp_path)
    repository.save_job_record(
        ExecutionJobRecord(
            job_id="run-1",
            job_type=JobType.TRAINING.value,
            requested_backend="cluster",
            execution_backend="local-python",
            execution_mode="in-process",
            status="running",
            progress=25.0,
            progress_message="training",
            created_at="2026-06-30T10:00:00",
            request={"run_name": "Cluster run"},
        )
    )
    repository.save_job_record(
        ExecutionJobRecord(
            job_id="orphan-job",
            job_type=JobType.TRAINING.value,
            requested_backend="cluster",
            execution_backend="cluster",
            execution_mode="remote",
            status="pending",
            progress=0.0,
            progress_message="waiting for worker",
            created_at="2026-06-30T12:00:00",
            request={"run_name": "Orphaned scheduler job"},
        )
    )
    run = runs_api.Run(
        id="run-1",
        name="Cluster run",
        execution_backend="cluster",
        datasets=[],
        status="running",
        created_at="2026-06-30T10:00:00",
        total_pipelines=0,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
    )
    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})
    monkeypatch.setattr(
        runs_api.workspace_manager,
        "get_current_workspace",
        lambda: SimpleNamespace(path=str(tmp_path)),
    )

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        default_response = client.get("/api/runs/execution-job-records")
        include_response = client.get(
            "/api/runs/execution-job-records",
            params={"include_orphaned": "true"},
        )
        filtered_response = client.get(
            "/api/runs/execution-job-records",
            params={"include_orphaned": "true", "run_status": "orphaned"},
        )

    assert default_response.status_code == 200
    assert [record["job_id"] for record in default_response.json()["records"]] == ["run-1"]

    assert include_response.status_code == 200
    included_payload = include_response.json()
    assert included_payload["total"] == 2
    assert [record["job_id"] for record in included_payload["records"]] == ["orphan-job", "run-1"]
    assert included_payload["records"][0]["run_id"] == "orphan-job"
    assert included_payload["records"][0]["run_name"] == "Orphaned scheduler job"
    assert included_payload["records"][0]["run_status"] == "orphaned"
    assert included_payload["records"][0]["is_orphaned"] is True
    assert included_payload["records"][1]["is_orphaned"] is False

    assert filtered_response.status_code == 200
    filtered_payload = filtered_response.json()
    assert filtered_payload["total"] == 1
    assert filtered_payload["records"][0]["job_id"] == "orphan-job"


def test_get_workspace_execution_job_record_reads_known_and_orphaned_snapshots(monkeypatch, tmp_path):
    repository = WorkspaceExecutionJobRecordRepository(tmp_path)
    repository.save_job_record(
        ExecutionJobRecord(
            job_id="run-1",
            job_type=JobType.TRAINING.value,
            requested_backend="cluster",
            execution_backend="local-python",
            execution_mode="in-process",
            status="running",
            progress=25.0,
            progress_message="training",
            created_at="2026-06-30T10:00:00",
            request={"run_name": "Known request name"},
        )
    )
    repository.save_job_record(
        ExecutionJobRecord(
            job_id="orphan-job",
            job_type=JobType.TRAINING.value,
            requested_backend="cluster",
            execution_backend="cluster",
            execution_mode="remote",
            status="pending",
            progress=0.0,
            progress_message="waiting for worker",
            created_at="2026-06-30T12:00:00",
            request={"run_name": "Orphaned scheduler job"},
        )
    )
    run = runs_api.Run(
        id="run-1",
        name="Known run",
        execution_backend="cluster",
        datasets=[],
        status="running",
        created_at="2026-06-30T10:00:00",
        total_pipelines=0,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
    )
    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})
    monkeypatch.setattr(
        runs_api.workspace_manager,
        "get_current_workspace",
        lambda: SimpleNamespace(path=str(tmp_path)),
    )

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        known_response = client.get("/api/runs/execution-job-records/run-1")
        orphan_response = client.get("/api/runs/execution-job-records/orphan-job")
        missing_response = client.get("/api/runs/execution-job-records/missing")

    assert known_response.status_code == 200
    known_payload = known_response.json()
    assert known_payload["job_id"] == "run-1"
    assert known_payload["run_name"] == "Known run"
    assert known_payload["run_status"] == "running"
    assert known_payload["is_orphaned"] is False

    assert orphan_response.status_code == 200
    orphan_payload = orphan_response.json()
    assert orphan_payload["job_id"] == "orphan-job"
    assert orphan_payload["run_name"] == "Orphaned scheduler job"
    assert orphan_payload["run_status"] == "orphaned"
    assert orphan_payload["is_orphaned"] is True

    assert missing_response.status_code == 404
    assert missing_response.json()["detail"] == "Execution job record missing not found"


def test_cancel_workspace_execution_job_record_delegates_to_driver_and_stops_linked_run(monkeypatch, tmp_path):
    repository = WorkspaceExecutionJobRecordRepository(tmp_path)
    repository.save_job_record(
        ExecutionJobRecord(
            job_id="job-1",
            job_type=JobType.TRAINING.value,
            requested_backend="cluster",
            execution_backend="local-python",
            execution_mode="in-process",
            status="running",
            progress=25.0,
            progress_message="training",
            created_at="2026-06-30T10:00:00",
            request={"run_id": "run-1", "run_name": "Linked run"},
        )
    )
    run = runs_api.Run(
        id="run-1",
        name="Linked run",
        execution_backend="cluster",
        datasets=[
            runs_api.DatasetRun(
                dataset_id="dataset-a",
                dataset_name="Dataset A",
                pipelines=[
                    runs_api.PipelineRun(
                        id="pipeline-run-1",
                        pipeline_id="pipeline-1",
                        pipeline_name="Pipeline 1",
                        model="PLS",
                        preprocessing="SNV",
                        split_strategy="KFold(5)",
                        status="running",
                    ),
                    runs_api.PipelineRun(
                        id="pipeline-run-2",
                        pipeline_id="pipeline-2",
                        pipeline_name="Pipeline 2",
                        model="Ridge",
                        preprocessing="None",
                        split_strategy="KFold(5)",
                        status="queued",
                    ),
                    runs_api.PipelineRun(
                        id="pipeline-run-3",
                        pipeline_id="pipeline-3",
                        pipeline_name="Pipeline 3",
                        model="Lasso",
                        preprocessing="MSC",
                        split_strategy="KFold(5)",
                        status="completed",
                    ),
                ],
            )
        ],
        status="running",
        created_at="2026-06-30T10:00:00",
        total_pipelines=3,
        completed_pipelines=1,
        workspace_path=str(tmp_path),
    )
    cancel_calls = []
    driver_backends = []
    saved_runs = []
    dummy_job_manager = SimpleNamespace(name="job-manager")

    class DummyDriver:
        def cancel_job(self, job_id, manager):
            cancel_calls.append((job_id, manager))
            return ExecutionJobCommandResult(
                action="cancel",
                job_id=job_id,
                success=True,
                message=f"cancelled {job_id}",
                backend="cluster",
                metadata={"driver": "dummy"},
            )

    def get_driver(backend):
        driver_backends.append(backend)
        return DummyDriver()

    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})
    monkeypatch.setattr(runs_api, "job_manager", dummy_job_manager)
    monkeypatch.setattr(runs_api, "get_execution_driver", get_driver)
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda saved_run: saved_runs.append(saved_run))
    monkeypatch.setattr(
        runs_api.workspace_manager,
        "get_current_workspace",
        lambda: SimpleNamespace(path=str(tmp_path)),
    )

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.post("/api/runs/execution-job-records/job-1/cancel")

    assert response.status_code == 200
    assert response.json() == {
        "action": "cancel",
        "job_id": "job-1",
        "success": True,
        "message": "cancelled job-1",
        "backend": "cluster",
        "run_id": "run-1",
        "metadata": {"driver": "dummy"},
    }
    assert driver_backends == ["cluster"]
    assert cancel_calls == [("job-1", dummy_job_manager)]
    assert run.status == "failed"
    assert run.datasets[0].pipelines[0].status == "failed"
    assert run.datasets[0].pipelines[0].error_message == "Stopped by user"
    assert run.datasets[0].pipelines[1].status == "failed"
    assert run.datasets[0].pipelines[1].error_message == "Stopped by user"
    assert run.datasets[0].pipelines[2].status == "completed"
    assert saved_runs == [run]


def test_cancel_workspace_execution_job_record_keeps_linked_run_running_when_driver_cancel_fails(monkeypatch, tmp_path):
    repository = WorkspaceExecutionJobRecordRepository(tmp_path)
    repository.save_job_record(
        ExecutionJobRecord(
            job_id="job-1",
            job_type=JobType.TRAINING.value,
            requested_backend="cluster",
            execution_backend="local-python",
            execution_mode="in-process",
            status="running",
            progress=25.0,
            progress_message="training",
            created_at="2026-06-30T10:00:00",
            request={"run_id": "run-1", "run_name": "Linked run"},
        )
    )
    run = runs_api.Run(
        id="run-1",
        name="Linked run",
        execution_backend="cluster",
        datasets=[
            runs_api.DatasetRun(
                dataset_id="dataset-a",
                dataset_name="Dataset A",
                pipelines=[
                    runs_api.PipelineRun(
                        id="pipeline-run-1",
                        pipeline_id="pipeline-1",
                        pipeline_name="Pipeline 1",
                        model="PLS",
                        preprocessing="SNV",
                        split_strategy="KFold(5)",
                        status="running",
                    ),
                    runs_api.PipelineRun(
                        id="pipeline-run-2",
                        pipeline_id="pipeline-2",
                        pipeline_name="Pipeline 2",
                        model="Ridge",
                        preprocessing="None",
                        split_strategy="KFold(5)",
                        status="queued",
                    ),
                ],
            )
        ],
        status="running",
        created_at="2026-06-30T10:00:00",
        total_pipelines=2,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
    )
    cancel_calls = []
    driver_backends = []
    saved_runs = []
    dummy_job_manager = SimpleNamespace(name="job-manager")

    class DummyDriver:
        def cancel_job(self, job_id, manager):
            cancel_calls.append((job_id, manager))
            return ExecutionJobCommandResult(
                action="cancel",
                job_id=job_id,
                success=False,
                message=f"driver refused {job_id}",
                backend="cluster",
                metadata={"driver": "dummy"},
            )

    def get_driver(backend):
        driver_backends.append(backend)
        return DummyDriver()

    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})
    monkeypatch.setattr(runs_api, "job_manager", dummy_job_manager)
    monkeypatch.setattr(runs_api, "get_execution_driver", get_driver)
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda saved_run: saved_runs.append(saved_run))
    monkeypatch.setattr(
        runs_api.workspace_manager,
        "get_current_workspace",
        lambda: SimpleNamespace(path=str(tmp_path)),
    )

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.post("/api/runs/execution-job-records/job-1/cancel")

    assert response.status_code == 200
    assert response.json() == {
        "action": "cancel",
        "job_id": "job-1",
        "success": False,
        "message": "driver refused job-1",
        "backend": "cluster",
        "run_id": "run-1",
        "metadata": {"driver": "dummy"},
    }
    assert driver_backends == ["cluster"]
    assert cancel_calls == [("job-1", dummy_job_manager)]
    assert run.status == "running"
    assert run.datasets[0].pipelines[0].status == "running"
    assert run.datasets[0].pipelines[0].error_message is None
    assert run.datasets[0].pipelines[1].status == "queued"
    assert run.datasets[0].pipelines[1].error_message is None
    assert saved_runs == []


def test_cancel_workspace_execution_job_record_cancels_orphaned_record_through_driver(monkeypatch, tmp_path):
    repository = WorkspaceExecutionJobRecordRepository(tmp_path)
    repository.save_job_record(
        ExecutionJobRecord(
            job_id="job-1",
            job_type=JobType.TRAINING.value,
            requested_backend="cluster",
            execution_backend="local-python",
            execution_mode="in-process",
            status="running",
            progress=25.0,
            progress_message="training",
            created_at="2026-06-30T10:00:00",
            request={"run_id": "missing-run", "run_name": "Orphaned run"},
        )
    )
    cancel_calls = []
    driver_backends = []
    dummy_job_manager = SimpleNamespace(name="job-manager")

    class DummyDriver:
        def cancel_job(self, job_id, manager):
            cancel_calls.append((job_id, manager))
            return ExecutionJobCommandResult(
                action="cancel",
                job_id=job_id,
                success=True,
                message=f"cancelled {job_id}",
                backend="cluster",
                metadata={"driver": "dummy"},
            )

    def get_driver(backend):
        driver_backends.append(backend)
        return DummyDriver()

    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {})
    monkeypatch.setattr(runs_api, "job_manager", dummy_job_manager)
    monkeypatch.setattr(runs_api, "get_execution_driver", get_driver)
    monkeypatch.setattr(
        runs_api.workspace_manager,
        "get_current_workspace",
        lambda: SimpleNamespace(path=str(tmp_path)),
    )

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.post("/api/runs/execution-job-records/job-1/cancel")

    assert response.status_code == 200
    assert response.json() == {
        "action": "cancel",
        "job_id": "job-1",
        "success": True,
        "message": "cancelled job-1",
        "backend": "cluster",
        "run_id": "missing-run",
        "metadata": {"driver": "dummy"},
    }
    assert driver_backends == ["cluster"]
    assert cancel_calls == [("job-1", dummy_job_manager)]


def test_cancel_workspace_execution_job_record_returns_404_when_record_missing(monkeypatch, tmp_path):
    driver_calls = []

    def get_driver(backend):
        driver_calls.append(backend)
        return SimpleNamespace(cancel_job=lambda job_id, manager: None)

    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {})
    monkeypatch.setattr(runs_api, "get_execution_driver", get_driver)
    monkeypatch.setattr(
        runs_api.workspace_manager,
        "get_current_workspace",
        lambda: SimpleNamespace(path=str(tmp_path)),
    )

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.post("/api/runs/execution-job-records/missing/cancel")

    assert response.status_code == 404
    assert response.json()["detail"] == "Execution job record missing not found"
    assert driver_calls == []


def test_list_run_execution_job_records_route_is_not_captured_by_run_id(monkeypatch):
    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {})

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.get("/api/runs/execution-job-records")

    assert response.status_code == 200
    assert response.json() == {"records": [], "total": 0}


def test_delete_run_removes_persisted_run_dir_and_store_entry(monkeypatch, tmp_path):
    run_dir = tmp_path / "runs" / "run-1"
    run_dir.mkdir(parents=True)
    (run_dir / "manifest.json").write_text("{}", encoding="utf-8")
    (run_dir / "execution_job_record.json").write_text("{}", encoding="utf-8")

    store_deletes = []

    def open_run_store_repository(workspace_path):
        assert workspace_path == str(tmp_path)
        return SimpleNamespace(
            delete_run=lambda run_id: store_deletes.append(run_id) or 4,
        )

    run = runs_api.Run(
        id="run-1",
        name="Completed run",
        execution_backend="cluster",
        datasets=[],
        status="completed",
        created_at="2026-06-30T10:00:00",
        total_pipelines=0,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
        store_run_id="store-run-1",
    )
    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})
    monkeypatch.setattr(runs_api, "_open_run_store_repository", open_run_store_repository)

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.delete("/api/runs/run-1")

    assert response.status_code == 200
    assert response.json()["success"] is True
    assert not run_dir.exists()
    assert store_deletes == ["store-run-1"]
    assert "run-1" not in runs_api._runs


def test_build_store_run_config_includes_execution_backend_and_project():
    run = runs_api.Run(
        id="run-1",
        name="Store config",
        execution_backend="cluster",
        engine="dag-ml",
        datasets=[
            runs_api.DatasetRun(
                dataset_id="dataset-a",
                dataset_name="Dataset A",
                pipelines=[],
            )
        ],
        status="queued",
        created_at="2026-06-30T10:00:00",
        total_pipelines=2,
        completed_pipelines=0,
        project_id="project-1",
    )

    assert runs_api._build_store_run_config(run, 2) == {
        "n_pipelines": 2,
        "n_datasets": 1,
        "execution_backend": "cluster",
        "requested_engine": "dag-ml",
        "fallback_policy": {
            "source": "nirs4all.run.allow_fallback",
            "engine_requested": "dag-ml",
            "allow_fallback": True,
            "mode": "allow_fallback",
        },
        "project_id": "project-1",
    }


def test_execute_run_job_uses_run_store_repository_for_lifecycle_writes(monkeypatch, tmp_path):
    class DummyRunStoreRepository:
        def __init__(self):
            self.begin_runs = []
            self.project_assignments = []
            self.completions = []

        def begin_run(self, *, name, config, datasets):
            self.begin_runs.append({"name": name, "config": config, "datasets": datasets})
            return "store-run-1"

        def set_project(self, run_id, project_id):
            self.project_assignments.append((run_id, project_id))

        def complete_run(self, run_id, summary):
            self.completions.append((run_id, summary))

    repositories = []
    opened_paths = []

    def open_repository(workspace_path):
        opened_paths.append(workspace_path)
        repository = DummyRunStoreRepository()
        repositories.append(repository)
        return repository

    run = runs_api.Run(
        id="run-1",
        name="Project run",
        execution_backend="cluster",
        datasets=[],
        status="queued",
        created_at="2026-06-30T10:00:00",
        total_pipelines=0,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
        project_id="project-1",
    )

    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: None)
    monkeypatch.setattr(runs_api, "_open_run_store_repository", open_repository)

    result = runs_api._execute_run_job(
        "run-1",
        SimpleNamespace(id="job-1", cancellation_requested=False),
        lambda progress, message: None,
    )

    assert result["status"] == "completed"
    assert run.store_run_id == "store-run-1"
    assert opened_paths == [str(tmp_path)]
    assert repositories[0].begin_runs == [
        {
            "name": "Project run",
            "config": {
                "n_pipelines": 1,
                "n_datasets": 0,
                "execution_backend": "cluster",
                "fallback_policy": {
                    "source": "nirs4all.run.allow_fallback",
                    "engine_requested": None,
                    "allow_fallback": True,
                    "mode": "allow_fallback",
                },
                "project_id": "project-1",
            },
            "datasets": [],
        }
    ]
    assert repositories[0].project_assignments == [("store-run-1", "project-1")]
    assert repositories[0].completions == [("store-run-1", {"total_pipelines": 1})]


def test_execute_run_job_tolerates_run_store_open_failure(monkeypatch, tmp_path, caplog):
    pipeline = runs_api.PipelineRun(
        id="run-1-dataset-a-pipe-a",
        pipeline_id="pipe-a",
        pipeline_name="Pipeline A",
        model="PLS",
        preprocessing="SNV",
        split_strategy="KFold(5)",
        status="queued",
    )
    run = runs_api.Run(
        id="run-1",
        name="Store unavailable run",
        datasets=[
            runs_api.DatasetRun(
                dataset_id="dataset-a",
                dataset_name="Dataset A",
                pipelines=[pipeline],
            )
        ],
        status="queued",
        created_at="2026-06-30T10:00:00",
        total_pipelines=1,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
    )
    training_calls = []

    def open_repository(workspace_path):
        raise RuntimeError("store unavailable")

    def execute_pipeline_training(
        pipeline_arg,
        dataset_id,
        workspace_path,
        run_id,
        split_group_by=None,
        *,
        store_run_id=None,
        engine=None,
        allow_fallback=True,
        should_stop=None,
    ):
        training_calls.append(
            {
                "pipeline": pipeline_arg.id,
                "dataset_id": dataset_id,
                "workspace_path": workspace_path,
                "run_id": run_id,
                "store_run_id": store_run_id,
            }
        )
        return {
            "metrics": {},
            "model_path": str(tmp_path / "model.joblib"),
            "logs": ["trained locally"],
            "variants_tested": 1,
        }

    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: None)
    monkeypatch.setattr(runs_api, "_open_run_store_repository", open_repository)
    monkeypatch.setattr(runs_api, "_execute_pipeline_training", execute_pipeline_training)
    caplog.set_level("WARNING")

    result = runs_api._execute_run_job(
        "run-1",
        SimpleNamespace(id="job-1", cancellation_requested=False),
        lambda progress, message: None,
    )

    assert result["status"] == "completed"
    assert pipeline.status == "completed"
    assert run.completed_pipelines == 1
    assert run.store_run_id is None
    assert training_calls == [
        {
            "pipeline": "run-1-dataset-a-pipe-a",
            "dataset_id": "dataset-a",
            "workspace_path": str(tmp_path),
            "run_id": "run-1",
            "store_run_id": None,
        }
    ]
    assert any(
        record.levelname == "WARNING" and "store unavailable" in record.getMessage()
        for record in caplog.records
    )


def test_execute_run_job_tolerates_store_precreation_failure(monkeypatch, tmp_path, caplog):
    class FailingPrecreateRepository:
        def __init__(self):
            self.begin_calls = []
            self.completions = []

        def begin_run(self, *, name, config, datasets):
            self.begin_calls.append({"name": name, "config": config, "datasets": datasets})
            raise RuntimeError("pre-create unavailable")

        def set_project(self, run_id, project_id):
            raise AssertionError("project assignment should not run without a store run id")

        def complete_run(self, run_id, summary):
            self.completions.append((run_id, summary))

    pipeline = runs_api.PipelineRun(
        id="run-1-dataset-a-pipe-a",
        pipeline_id="pipe-a",
        pipeline_name="Pipeline A",
        model="PLS",
        preprocessing="SNV",
        split_strategy="KFold(5)",
        status="queued",
    )
    run = runs_api.Run(
        id="run-1",
        name="Precreate unavailable run",
        datasets=[
            runs_api.DatasetRun(
                dataset_id="dataset-a",
                dataset_name="Dataset A",
                pipelines=[pipeline],
            )
        ],
        status="queued",
        created_at="2026-06-30T10:00:00",
        total_pipelines=1,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
    )
    repository = FailingPrecreateRepository()
    training_store_run_ids = []

    def execute_pipeline_training(
        pipeline_arg,
        dataset_id,
        workspace_path,
        run_id,
        split_group_by=None,
        *,
        store_run_id=None,
        engine=None,
        allow_fallback=True,
        should_stop=None,
    ):
        training_store_run_ids.append(store_run_id)
        return {
            "metrics": {},
            "model_path": str(tmp_path / "model.joblib"),
            "logs": ["trained locally"],
            "variants_tested": 1,
        }

    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: None)
    monkeypatch.setattr(runs_api, "_open_run_store_repository", lambda workspace_path: repository)
    monkeypatch.setattr(runs_api, "_execute_pipeline_training", execute_pipeline_training)
    caplog.set_level("WARNING")

    result = runs_api._execute_run_job(
        "run-1",
        SimpleNamespace(id="job-1", cancellation_requested=False),
        lambda progress, message: None,
    )

    assert result["status"] == "completed"
    assert pipeline.status == "completed"
    assert run.completed_pipelines == 1
    assert run.store_run_id is None
    assert training_store_run_ids == [None]
    assert repository.begin_calls == [
        {
            "name": "Precreate unavailable run",
            "config": {
                "n_pipelines": 1,
                "n_datasets": 1,
                "execution_backend": "local-python",
                "fallback_policy": {
                    "source": "nirs4all.run.allow_fallback",
                    "engine_requested": None,
                    "allow_fallback": True,
                    "mode": "allow_fallback",
                },
            },
            "datasets": [{"name": "Dataset A"}],
        }
    ]
    assert repository.completions == []
    assert "Failed to pre-create store run" in caplog.text
    assert "pre-create unavailable" in caplog.text


def test_execute_run_job_fails_shared_store_run_when_pipeline_fails(monkeypatch, tmp_path):
    class DummyRunStoreRepository:
        def __init__(self):
            self.completions = []
            self.failures = []

        def begin_run(self, *, name, config, datasets):
            return "store-run-1"

        def complete_run(self, run_id, summary):
            self.completions.append((run_id, summary))

        def fail_run(self, run_id, message):
            self.failures.append((run_id, message))

    pipeline = runs_api.PipelineRun(
        id="run-1-dataset-a-pipe-a",
        pipeline_id="pipe-a",
        pipeline_name="Pipeline A",
        model="PLS",
        preprocessing="SNV",
        split_strategy="KFold(5)",
        status="queued",
    )
    run = runs_api.Run(
        id="run-1",
        name="Failed run",
        datasets=[
            runs_api.DatasetRun(
                dataset_id="dataset-a",
                dataset_name="Dataset A",
                pipelines=[pipeline],
            )
        ],
        status="queued",
        created_at="2026-06-30T10:00:00",
        total_pipelines=1,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
    )
    repository = DummyRunStoreRepository()

    def execute_pipeline_training(*args, **kwargs):
        raise RuntimeError("training exploded")

    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: None)
    monkeypatch.setattr(runs_api, "_open_run_store_repository", lambda workspace_path: repository)
    monkeypatch.setattr(runs_api, "_execute_pipeline_training", execute_pipeline_training)

    result = runs_api._execute_run_job(
        "run-1",
        SimpleNamespace(id="job-1", cancellation_requested=False),
        lambda progress, message: None,
    )

    assert result["status"] == "failed"
    assert pipeline.status == "failed"
    assert pipeline.error_message == "training exploded"
    assert repository.failures == [("store-run-1", "training exploded")]
    assert repository.completions == []


def test_execute_run_job_clears_precreated_store_run_when_project_assignment_fails(monkeypatch, tmp_path, caplog):
    class ProjectFailingRunStoreRepository:
        def __init__(self):
            self.project_assignments = []
            self.completions = []

        def begin_run(self, *, name, config, datasets):
            return "store-run-1"

        def set_project(self, run_id, project_id):
            self.project_assignments.append((run_id, project_id))
            raise RuntimeError("project assignment unavailable")

        def complete_run(self, run_id, summary):
            self.completions.append((run_id, summary))

    pipeline = runs_api.PipelineRun(
        id="run-1-dataset-a-pipe-a",
        pipeline_id="pipe-a",
        pipeline_name="Pipeline A",
        model="PLS",
        preprocessing="SNV",
        split_strategy="KFold(5)",
        status="queued",
    )
    run = runs_api.Run(
        id="run-1",
        name="Project assignment failure",
        datasets=[
            runs_api.DatasetRun(
                dataset_id="dataset-a",
                dataset_name="Dataset A",
                pipelines=[pipeline],
            )
        ],
        status="queued",
        created_at="2026-06-30T10:00:00",
        total_pipelines=1,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
        project_id="project-1",
    )
    repository = ProjectFailingRunStoreRepository()
    training_store_run_ids = []

    def execute_pipeline_training(
        pipeline_arg,
        dataset_id,
        workspace_path,
        run_id,
        split_group_by=None,
        *,
        store_run_id=None,
        engine=None,
        allow_fallback=True,
        should_stop=None,
    ):
        training_store_run_ids.append(store_run_id)
        return {
            "metrics": {},
            "model_path": str(tmp_path / "model.joblib"),
            "logs": ["trained locally"],
            "variants_tested": 1,
            "store_run_id": "fallback-store-run",
        }

    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: None)
    monkeypatch.setattr(runs_api, "_open_run_store_repository", lambda workspace_path: repository)
    monkeypatch.setattr(runs_api, "_execute_pipeline_training", execute_pipeline_training)
    caplog.set_level("WARNING")

    result = runs_api._execute_run_job(
        "run-1",
        SimpleNamespace(id="job-1", cancellation_requested=False),
        lambda progress, message: None,
    )

    assert result["status"] == "completed"
    assert repository.project_assignments == [("store-run-1", "project-1")]
    assert repository.completions == []
    assert training_store_run_ids == [None]
    assert run.store_run_id == "fallback-store-run"
    assert "project assignment unavailable" in caplog.text


def test_execute_run_job_uses_run_store_repository_for_cancel_failure(monkeypatch, tmp_path):
    class DummyRunStoreRepository:
        def __init__(self):
            self.failures = []

        def begin_run(self, *, name, config, datasets):
            return "store-run-1"

        def fail_run(self, run_id, message):
            self.failures.append((run_id, message))

    repositories = []

    def open_repository(workspace_path):
        repository = DummyRunStoreRepository()
        repositories.append(repository)
        return repository

    pipeline = runs_api.PipelineRun(
        id="run-1-dataset-a-pipe-a",
        pipeline_id="pipe-a",
        pipeline_name="Pipeline A",
        model="PLS",
        preprocessing="SNV",
        split_strategy="KFold(5)",
        status="queued",
    )
    run = runs_api.Run(
        id="run-1",
        name="Cancelled run",
        datasets=[
            runs_api.DatasetRun(
                dataset_id="dataset-a",
                dataset_name="Dataset A",
                pipelines=[pipeline],
            )
        ],
        status="queued",
        created_at="2026-06-30T10:00:00",
        total_pipelines=1,
        completed_pipelines=0,
        workspace_path=str(tmp_path),
    )

    monkeypatch.setattr(runs_api, "_runs", {"run-1": run})
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: None)
    monkeypatch.setattr(runs_api, "_open_run_store_repository", open_repository)

    result = runs_api._execute_run_job(
        "run-1",
        SimpleNamespace(id="job-1", cancellation_requested=True),
        lambda progress, message: None,
    )

    assert result["cancelled"] is True
    assert pipeline.status == "failed"
    assert pipeline.error_message == "Cancelled by user"
    assert repositories[0].failures == [("store-run-1", "Stopped by user")]


def test_legacy_run_execution_plan_expands_cartesian_variants_with_callbacks():
    pipeline_configs = {
        "pipe-a": {"name": "Plain", "steps": [], "base_model": "PlainModel", "base_preprocessing": "None"},
        "pipe-b": {"name": "Sweep", "steps": [{"id": "sweep"}], "base_model": "BaseModel", "base_preprocessing": "Base Prep"},
    }

    def extract_pipeline_info(pipeline_config):
        return pipeline_config["base_model"], pipeline_config["base_preprocessing"], "KFold(5)"

    def estimate_pipeline_variants(pipeline_config, *, cv_folds=None):
        fold_count = cv_folds or 1
        if pipeline_config["name"] == "Sweep":
            return runs_api.PipelineEstimate(
                estimated_variants=2,
                has_generators=True,
                fold_count=fold_count,
                branch_count=3,
                total_model_count=fold_count * 3 * 2,
                model_count_breakdown="variant estimate",
            )
        return runs_api.PipelineEstimate(
            estimated_variants=1,
            has_generators=False,
            fold_count=fold_count,
            branch_count=1,
            total_model_count=fold_count,
            model_count_breakdown="plain estimate",
        )

    def expand_pipeline_variants(steps):
        assert steps == [{"id": "sweep"}]
        return [
            SimpleNamespace(index=0, description="alpha", model_name="VariantModel", preprocessing_names=["SNV"], choices={"choice": "alpha"}),
            SimpleNamespace(index=1, description="", model_name="Unknown", preprocessing_names=[], choices={"choice": "beta"}),
        ]

    plan = build_legacy_run_execution_plan(
        run_id="run-1",
        dataset_ids=["dataset-a", "dataset-b"],
        effective_pipeline_ids=["pipe-a", "pipe-b"],
        dataset_infos={"dataset-a": {"name": "Dataset A", "id": "dataset-a"}},
        pipeline_configs=pipeline_configs,
        split_group_by_by_dataset={"dataset-a": "subject", "dataset-b": None},
        cv_folds=7,
        expand_variants=True,
        extract_pipeline_info=extract_pipeline_info,
        estimate_pipeline_variants=estimate_pipeline_variants,
        expand_pipeline_variants=expand_pipeline_variants,
    )

    assert plan.total_pipeline_runs == 6
    assert [dataset.dataset_id for dataset in plan.datasets] == ["dataset-a", "dataset-b"]
    assert plan.datasets[0].dataset_name == "Dataset A"
    assert plan.datasets[0].split_group_by == "subject"
    assert plan.datasets[1].dataset_name == "dataset-b"

    first_dataset_pipelines = plan.datasets[0].pipelines
    assert [pipeline.pipeline_run_id for pipeline in first_dataset_pipelines] == [
        "run-1-dataset-a-pipe-a",
        "run-1-dataset-a-pipe-b-v0",
        "run-1-dataset-a-pipe-b-v1",
    ]
    assert first_dataset_pipelines[0].split_strategy == "KFold(7)"
    assert first_dataset_pipelines[1].pipeline_name == "Sweep [alpha]"
    assert first_dataset_pipelines[1].model == "VariantModel"
    assert first_dataset_pipelines[1].preprocessing == "SNV"
    assert first_dataset_pipelines[1].branch_count == 1
    assert first_dataset_pipelines[1].total_model_count == 7
    assert first_dataset_pipelines[2].pipeline_name == "Sweep"
    assert first_dataset_pipelines[2].model == "BaseModel"
    assert first_dataset_pipelines[2].preprocessing == "Base Prep"
    assert first_dataset_pipelines[2].variant_choices == {"choice": "beta"}


def test_create_run_from_config_preserves_legacy_cartesian_plan_metadata(tmp_path):
    run = runs_api._create_run_from_config(
        runs_api.ExperimentConfig(
            name="Cluster cartesian experiment",
            dataset_ids=["dataset-a", "dataset-b"],
            pipeline_ids=["pipe-a"],
            execution_backend="cluster",
            split_group_by_by_dataset={"dataset-a": "subject", "dataset-b": None},
        ),
        dataset_infos={
            "dataset-a": {"name": "Dataset A", "id": "dataset-a"},
            "dataset-b": {"name": "Dataset B", "id": "dataset-b"},
        },
        pipeline_configs={
            "pipe-a": {"name": "Pipeline A", "steps": []},
            "pipe-b": {"name": "Pipeline B", "steps": []},
        },
        workspace_path=str(tmp_path),
        pipeline_ids=["pipe-b", "pipe-a"],
    )

    assert run.execution_backend == "cluster"
    assert run.total_pipelines == 4
    assert [dataset.dataset_id for dataset in run.datasets] == ["dataset-a", "dataset-b"]
    assert [dataset.split_group_by for dataset in run.datasets] == ["subject", None]
    assert [pipeline.id for pipeline in run.datasets[0].pipelines] == [
        f"{run.id}-dataset-a-pipe-b",
        f"{run.id}-dataset-a-pipe-a",
    ]
    assert [pipeline.pipeline_name for pipeline in run.datasets[0].pipelines] == ["Pipeline B", "Pipeline A"]
    assert [pipeline.id for pipeline in run.datasets[1].pipelines] == [
        f"{run.id}-dataset-b-pipe-b",
        f"{run.id}-dataset-b-pipe-a",
    ]


def _native_run_group_payload(*, inline_source: str = "inline", include_inline_steps: bool = True):
    saved_campaign = {
        "mode": "paired_by_index",
        "executionBackend": "cluster",
        "datasets": [{"id": "dataset-a", "name": "Dataset A", "splitGroupBy": "subject"}],
        "pipelines": [{"id": "pipe-saved", "name": "Saved Pipeline", "source": "saved"}],
        "runMatrix": [
            {
                "id": "dataset-a::pipe-saved",
                "datasetId": "dataset-a",
                "pipelineId": "pipe-saved",
                "splitGroupBy": "subject",
            }
        ],
    }
    inline_pipeline = {"id": "pipe-inline", "name": "Inline Pipeline", "source": inline_source}
    if include_inline_steps:
        inline_pipeline["steps"] = [{"id": "inline-model", "type": "model", "name": "Inline Model"}]
    inline_campaign = {
        "mode": "paired_by_index",
        "executionBackend": "cluster",
        "datasets": [{"id": "dataset-a", "name": "Dataset A", "splitGroupBy": "session"}],
        "pipelines": [inline_pipeline],
        "runMatrix": [
            {
                "id": "dataset-a::pipe-inline",
                "datasetId": "dataset-a",
                "pipelineId": "pipe-inline",
                "splitGroupBy": "session",
            }
        ],
    }
    split_specs = [
        {
            "id": "single-pair:dataset-a::pipe-saved",
            "sourceRunId": "dataset-a::pipe-saved",
            "sourceDatasetId": "dataset-a",
            "sourcePipelineId": "pipe-saved",
            "campaign": saved_campaign,
        },
        {
            "id": "single-pair:dataset-a::pipe-inline",
            "sourceRunId": "dataset-a::pipe-inline",
            "sourceDatasetId": "dataset-a",
            "sourcePipelineId": "pipe-inline",
            "campaign": inline_campaign,
        },
    ]
    return {
        "legacyConfig": {
            "name": "Native cluster campaign",
            "description": "Saved plus inline pipelines",
            "dataset_ids": ["dataset-a"],
            "pipeline_ids": ["pipe-saved", "pipe-inline"],
            "execution_backend": "cluster",
            "cv_folds": 2,
            "project_id": "project-1",
        },
        "manifest": {
            "version": "studio.native-launch-payload.v1",
            "legacyExperimentName": "Native cluster campaign",
            "legacyDatasetCount": 1,
            "legacyPipelineCount": 2,
            "strictCampaignCount": len(split_specs),
            "skippedRunCount": 0,
            "sourceRunIds": ["dataset-a::pipe-saved", "dataset-a::pipe-inline"],
            "skippedRunIds": [],
        },
        "strictCampaignSpecs": {
            "splitSpecs": split_specs,
            "skippedRunIds": [],
        },
    }


def test_create_run_group_route_rejects_unavailable_backend_before_mutating_state(monkeypatch, tmp_path):
    saved_runs = []
    started_runs = []

    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {})
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: saved_runs.append(run) or True)
    monkeypatch.setattr(runs_api, "_start_run_job", lambda run: started_runs.append(run))
    monkeypatch.setattr(
        runs_api.workspace_manager,
        "get_current_workspace",
        lambda: SimpleNamespace(path=str(tmp_path)),
    )

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.post("/api/runs/run-groups", json=_native_run_group_payload())

    assert response.status_code == 501
    assert response.json()["detail"] == {
        "verb": "run",
        "cause": "unavailable_backend",
        "message": "Cluster execution is typed but no cluster driver is configured.",
        "mitigation": "Run on an available execution backend, or configure a driver for this backend.",
    }
    assert runs_api._runs == {}
    assert saved_runs == []
    assert started_runs == []


def test_create_run_group_route_accepts_saved_and_inline_pipelines_and_starts_job(monkeypatch, tmp_path):
    saved_pipeline_config = {
        "id": "pipe-saved",
        "name": "Saved Pipeline",
        "steps": [{"id": "saved-model", "type": "model", "name": "Saved Model"}],
    }
    inline_steps = [{"id": "inline-model", "type": "model", "name": "Inline Model"}]
    saved_runs = []
    prepared_grouping_calls = []
    submitted_requests = []
    dataset = SimpleNamespace(name="Loaded Dataset A")

    class DummyDriver:
        def submit(self, request, manager, task_fn):
            submitted_requests.append(request)
            return SimpleNamespace(id=request.run_id, config={"execution_request": request.to_metadata()})

    def fake_extract_pipeline_info(pipeline_config):
        if pipeline_config["name"] == "Saved Pipeline":
            return "Saved Model", "SNV", "KFold(5)"
        return "Inline Model", "None", "KFold(5)"

    def fake_estimate_pipeline_variants(pipeline_config, *, cv_folds=None):
        return runs_api.PipelineEstimate(
            estimated_variants=1,
            has_generators=False,
            fold_count=cv_folds or 1,
            branch_count=1,
            total_model_count=cv_folds or 1,
            model_count_breakdown=f"{cv_folds or 1} folds",
        )

    def fake_prepare_pipeline_steps_with_runtime_grouping(steps, dataset_object, runtime_group_by):
        prepared_grouping_calls.append((steps, dataset_object, runtime_group_by))
        return steps

    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {})
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: saved_runs.append(run) or True)
    monkeypatch.setattr(spectra_api, "_load_dataset", lambda dataset_id: dataset)
    monkeypatch.setattr(pipelines_api, "_load_pipeline", lambda pipeline_id: saved_pipeline_config)
    monkeypatch.setattr(runs_api, "prepare_pipeline_steps_with_runtime_grouping", fake_prepare_pipeline_steps_with_runtime_grouping)
    monkeypatch.setattr(runs_api, "_extract_pipeline_info", fake_extract_pipeline_info)
    monkeypatch.setattr(runs_api, "_estimate_pipeline_variants", fake_estimate_pipeline_variants)
    monkeypatch.setattr(runs_api, "get_execution_driver", lambda backend, job_record_repository=None: DummyDriver())
    monkeypatch.setattr(
        runs_api.workspace_manager,
        "get_current_workspace",
        lambda: SimpleNamespace(path=str(tmp_path)),
    )

    payload = _native_run_group_payload()
    payload["legacyConfig"]["engine"] = "dag-ml"
    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.post("/api/runs/run-groups", json=payload)

    assert response.status_code == 200
    response_payload = response.json()
    assert response_payload["name"] == "Native cluster campaign"
    assert response_payload["description"] == "Saved plus inline pipelines"
    assert response_payload["execution_backend"] == "cluster"
    assert response_payload["engine"] == "dag-ml"
    assert response_payload["cv_folds"] == 2
    assert response_payload["total_pipelines"] == 2
    assert response_payload["completed_pipelines"] == 0
    assert response_payload["project_id"] == "project-1"
    assert len(saved_runs) == 1
    assert saved_runs[0].engine == "dag-ml"
    assert saved_runs[0].execution_metadata == {
        "campaign_shape": "explicit-run-group",
        "native_payload_version": "studio.native-launch-payload.v1",
        "source_run_ids": ["dataset-a::pipe-saved", "dataset-a::pipe-inline"],
        "skipped_run_ids": [],
        "strict_campaign_count": 2,
    }

    dataset_runs = response_payload["datasets"]
    assert [dataset_run["dataset_id"] for dataset_run in dataset_runs] == ["dataset-a", "dataset-a"]
    assert [dataset_run["dataset_name"] for dataset_run in dataset_runs] == ["Loaded Dataset A", "Loaded Dataset A"]
    assert [dataset_run["split_group_by"] for dataset_run in dataset_runs] == ["subject", "session"]
    assert [dataset_run["pipelines"][0]["pipeline_id"] for dataset_run in dataset_runs] == ["pipe-saved", "pipe-inline"]
    assert [dataset_run["pipelines"][0]["id"] for dataset_run in dataset_runs] == [
        f"{response_payload['id']}-single-pair-dataset-a-pipe-saved",
        f"{response_payload['id']}-single-pair-dataset-a-pipe-inline",
    ]
    assert dataset_runs[0]["pipelines"][0]["config"] == saved_pipeline_config
    assert dataset_runs[1]["pipelines"][0]["config"] == {
        "name": "Inline Pipeline",
        "steps": inline_steps,
    }

    assert prepared_grouping_calls == [
        (saved_pipeline_config["steps"], dataset, "subject"),
        (inline_steps, dataset, "session"),
    ]
    assert saved_runs == [runs_api._runs[response_payload["id"]]]
    assert len(submitted_requests) == 1

    expected_metadata = runs_api._build_run_execution_metadata(saved_runs[0])
    assert submitted_requests[0].metadata == expected_metadata
    assert submitted_requests[0].to_metadata()["requested_engine"] == "dag-ml"
    assert submitted_requests[0].to_metadata()["metadata"] == {
        "kind": "campaign",
        "campaign_shape": "explicit-run-group",
        "dataset_bindings": [
            {
                "dataset_id": "dataset-a",
                "dataset_name": "Loaded Dataset A",
                "split_group_by": "subject",
                "pipeline_count": 1,
                "pipeline_ids": ["pipe-saved"],
            },
            {
                "dataset_id": "dataset-a",
                "dataset_name": "Loaded Dataset A",
                "split_group_by": "session",
                "pipeline_count": 1,
                "pipeline_ids": ["pipe-inline"],
            },
        ],
        "planned_pipeline_runs": 2,
        "project_id": "project-1",
        "native_payload_version": "studio.native-launch-payload.v1",
        "source_run_ids": ["dataset-a::pipe-saved", "dataset-a::pipe-inline"],
        "skipped_run_ids": [],
        "strict_campaign_count": 2,
    }


def test_create_run_group_route_preserves_reused_inline_pipeline_steps_per_split(monkeypatch, tmp_path):
    steps_a = [{"id": "inline-model-a", "type": "model", "name": "Inline Model A"}]
    steps_b = [{"id": "inline-model-b", "type": "model", "name": "Inline Model B"}]
    saved_runs = []
    prepared_grouping_calls = []
    submitted_requests = []

    class DummyDriver:
        def submit(self, request, manager, task_fn):
            submitted_requests.append(request)
            return SimpleNamespace(id=request.run_id, config={"execution_request": request.to_metadata()})

    def fake_extract_pipeline_info(pipeline_config):
        return pipeline_config["steps"][0]["name"], "None", "KFold(5)"

    def fake_estimate_pipeline_variants(pipeline_config, *, cv_folds=None):
        return runs_api.PipelineEstimate(
            estimated_variants=1,
            has_generators=False,
            fold_count=cv_folds or 1,
            branch_count=1,
            total_model_count=cv_folds or 1,
            model_count_breakdown=f"{cv_folds or 1} folds",
        )

    def fake_load_dataset(dataset_id):
        return SimpleNamespace(name=f"Loaded {dataset_id}")

    def fake_prepare_pipeline_steps_with_runtime_grouping(steps, dataset_object, runtime_group_by):
        prepared_grouping_calls.append((steps, dataset_object.name, runtime_group_by))
        return SimpleNamespace(steps=steps, warnings=[])

    def split_spec(dataset_id, steps, group_by):
        return {
            "id": f"single-pair:source-campaign:{dataset_id}:pipe-inline",
            "sourceRunId": "source-campaign",
            "sourceDatasetId": dataset_id,
            "sourcePipelineId": "pipe-inline",
            "campaign": {
                "mode": "paired_by_index",
                "executionBackend": "cluster",
                "datasets": [{"id": dataset_id, "name": dataset_id, "splitGroupBy": group_by}],
                "pipelines": [{"id": "pipe-inline", "name": "Inline Pipeline", "source": "inline-pruned", "steps": steps}],
                "runMatrix": [
                    {
                        "id": f"source-campaign:{dataset_id}:pipe-inline",
                        "datasetId": dataset_id,
                        "pipelineId": "pipe-inline",
                        "splitGroupBy": group_by,
                    }
                ],
            },
        }

    split_specs = [
        split_spec("dataset-a", steps_a, "subject"),
        split_spec("dataset-b", steps_b, "batch"),
    ]
    payload = {
        "legacyConfig": {
            "name": "Native reused inline campaign",
            "dataset_ids": ["dataset-a", "dataset-b"],
            "pipeline_ids": ["pipe-inline"],
            "execution_backend": "cluster",
            "cv_folds": 3,
        },
        "manifest": {
            "version": "studio.native-launch-payload.v1",
            "legacyExperimentName": "Native reused inline campaign",
            "legacyDatasetCount": 2,
            "legacyPipelineCount": 1,
            "strictCampaignCount": len(split_specs),
            "skippedRunCount": 0,
            "sourceRunIds": ["source-campaign"],
            "skippedRunIds": [],
        },
        "strictCampaignSpecs": {
            "splitSpecs": split_specs,
            "skippedRunIds": [],
        },
    }

    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {})
    monkeypatch.setattr(runs_api, "_save_run_manifest", lambda run: saved_runs.append(run) or True)
    monkeypatch.setattr(spectra_api, "_load_dataset", fake_load_dataset)
    monkeypatch.setattr(runs_api, "prepare_pipeline_steps_with_runtime_grouping", fake_prepare_pipeline_steps_with_runtime_grouping)
    monkeypatch.setattr(runs_api, "_extract_pipeline_info", fake_extract_pipeline_info)
    monkeypatch.setattr(runs_api, "_estimate_pipeline_variants", fake_estimate_pipeline_variants)
    monkeypatch.setattr(runs_api, "get_execution_driver", lambda backend, job_record_repository=None: DummyDriver())
    monkeypatch.setattr(
        runs_api.workspace_manager,
        "get_current_workspace",
        lambda: SimpleNamespace(path=str(tmp_path)),
    )

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.post("/api/runs/run-groups", json=payload)

    assert response.status_code == 200
    dataset_runs = response.json()["datasets"]
    assert [dataset_run["dataset_id"] for dataset_run in dataset_runs] == ["dataset-a", "dataset-b"]
    assert [dataset_run["pipelines"][0]["pipeline_id"] for dataset_run in dataset_runs] == ["pipe-inline", "pipe-inline"]
    assert [dataset_run["pipelines"][0]["config"]["steps"] for dataset_run in dataset_runs] == [steps_a, steps_b]
    assert [dataset_run["pipelines"][0]["model"] for dataset_run in dataset_runs] == ["Inline Model A", "Inline Model B"]
    assert [dataset_run["pipelines"][0]["id"] for dataset_run in dataset_runs] == [
        f"{response.json()['id']}-single-pair-source-campaign-dataset-a-pipe-inline",
        f"{response.json()['id']}-single-pair-source-campaign-dataset-b-pipe-inline",
    ]
    assert prepared_grouping_calls == [
        (steps_a, "Loaded dataset-a", "subject"),
        (steps_b, "Loaded dataset-b", "batch"),
    ]
    assert len(saved_runs) == 1
    assert len(submitted_requests) == 1


@pytest.mark.parametrize("inline_source", ["inline", "inline-pruned"])
def test_create_run_group_rejects_inline_pipeline_without_steps(monkeypatch, inline_source):
    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")

    payload = _native_run_group_payload(inline_source=inline_source, include_inline_steps=False)
    with TestClient(app) as client:
        response = client.post("/api/runs/run-groups", json=payload)

    assert response.status_code == 422
    assert response.json()["detail"] == "Campaign split 'single-pair:dataset-a::pipe-inline' inline pipeline is missing executable steps"


def test_retry_run_route_uses_retry_plan_and_starts_new_run(monkeypatch):
    started_runs = []

    def fake_start_run_job(run):
        started_runs.append(run)
        return SimpleNamespace(id=run.id)

    class DummyDriver:
        capability = SimpleNamespace(available=True)

    class FakeUuid:
        def __str__(self):
            return "retryrun-abcdef"

    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api.uuid, "uuid4", lambda: FakeUuid())
    monkeypatch.setattr(runs_api, "get_execution_driver", lambda backend, job_record_repository=None: DummyDriver())
    monkeypatch.setattr(runs_api, "_start_run_job", fake_start_run_job)

    old_run = runs_api.Run(
        id="old-run",
        name="Failed calibration",
        description="Retry source",
        execution_backend="cluster",
        datasets=[
            runs_api.DatasetRun(
                dataset_id="dataset-a",
                dataset_name="Dataset A",
                split_group_by="subject",
                pipelines=[
                    runs_api.PipelineRun(
                        id="old-run-dataset-a-pipe-a",
                        pipeline_id="pipe-a",
                        pipeline_name="Pipeline A [alpha]",
                        model="PLS",
                        preprocessing="SNV",
                        split_strategy="KFold(7)",
                        status="failed",
                        progress=82,
                        metrics=runs_api.RunMetrics(r2=0.91, rmse=0.42),
                        config={"name": "Pipeline A", "steps": [{"id": "snv"}]},
                        logs=["old log"],
                        started_at="2026-06-30T09:00:00",
                        completed_at="2026-06-30T09:05:00",
                        error_message="Training failed",
                        model_path="/workspace/model.pkl",
                        variant_index=0,
                        variant_description="alpha",
                        variant_choices={"n_components": 8},
                        is_expanded_variant=True,
                        estimated_variants=1,
                        has_generators=False,
                        fold_count=7,
                        branch_count=1,
                        total_model_count=7,
                        model_count_breakdown="7 folds",
                    )
                ],
            )
        ],
        status="failed",
        created_at="2026-06-30T09:00:00",
        cv_folds=7,
        total_pipelines=1,
        completed_pipelines=1,
        workspace_path="/workspace",
        project_id="project-1",
        store_run_id="old-store-run",
    )
    monkeypatch.setattr(runs_api, "_runs", {"old-run": old_run})

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.post("/api/runs/old-run/retry")

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == "retryrun"
    assert payload["name"] == "Failed calibration (retry)"
    assert payload["description"] == "Retry source"
    assert payload["execution_backend"] == "cluster"
    assert payload["status"] == "queued"
    assert payload["cv_folds"] == 7
    assert payload["total_pipelines"] == 1
    assert payload["completed_pipelines"] == 0
    assert payload["workspace_path"] == "/workspace"
    assert payload["project_id"] == "project-1"
    assert payload["store_run_id"] is None

    pipeline_payload = payload["datasets"][0]["pipelines"][0]
    assert pipeline_payload["id"] == "retryrun-pipe-a"
    assert pipeline_payload["pipeline_name"] == "Pipeline A [alpha]"
    assert pipeline_payload["status"] == "queued"
    assert pipeline_payload["progress"] == 0
    assert pipeline_payload["metrics"] is None
    assert pipeline_payload["logs"] is None
    assert pipeline_payload["started_at"] is None
    assert pipeline_payload["completed_at"] is None
    assert pipeline_payload["error_message"] is None
    assert pipeline_payload["model_path"] is None
    assert pipeline_payload["config"] == {"name": "Pipeline A", "steps": [{"id": "snv"}]}
    assert pipeline_payload["variant_choices"] == {"n_components": 8}
    assert pipeline_payload["fold_count"] == 7

    assert runs_api._runs["retryrun"] is started_runs[0]
    assert old_run.status == "failed"


def test_retry_run_route_rejects_unavailable_backend_before_mutating_state(monkeypatch):
    started_runs = []
    old_run = runs_api.Run(
        id="old-run",
        name="Failed cluster run",
        execution_backend="cluster",
        datasets=[],
        status="failed",
        created_at="2026-06-30T09:00:00",
        total_pipelines=0,
        completed_pipelines=0,
    )

    monkeypatch.setattr(runs_api, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs_api, "_runs", {"old-run": old_run})
    monkeypatch.setattr(runs_api, "_start_run_job", lambda run: started_runs.append(run))

    app = FastAPI()
    app.include_router(runs_api.router, prefix="/api")
    with TestClient(app) as client:
        response = client.post("/api/runs/old-run/retry")

    assert response.status_code == 501
    assert response.json()["detail"] == {
        "verb": "run",
        "cause": "unavailable_backend",
        "message": "Cluster execution is typed but no cluster driver is configured.",
        "mitigation": "Run on an available execution backend, or configure a driver for this backend.",
    }
    assert runs_api._runs == {"old-run": old_run}
    assert started_runs == []


def _plan_field(value, *names):
    for name in names:
        if isinstance(value, dict) and name in value:
            return value[name]
        if hasattr(value, name):
            return getattr(value, name)
    raise AssertionError(f"Expected one of {names} on {value!r}")


def _optional_plan_field(value, *names):
    for name in names:
        if isinstance(value, dict) and name in value:
            return value[name]
        if hasattr(value, name):
            return getattr(value, name)
    return None


def _failed_run_like_for_retry_plan():
    return SimpleNamespace(
        id="old-run-1",
        name="Failed calibration",
        description="Retry source",
        execution_backend="cluster",
        datasets=[
            SimpleNamespace(
                dataset_id="dataset-a",
                dataset_name="Dataset A",
                split_group_by="subject",
                pipelines=[
                    SimpleNamespace(
                        id="old-run-1-dataset-a-pipe-a",
                        pipeline_id="pipe-a",
                        pipeline_name="Pipeline A",
                        model="PLS",
                        preprocessing="SNV",
                        split_strategy="KFold(7)",
                        status="failed",
                        progress=82,
                        metrics={"rmse": 0.42},
                        config={"name": "Pipeline A", "steps": [{"id": "snv"}]},
                        logs=["started", "failed"],
                        started_at="2026-06-30T09:00:00",
                        completed_at="2026-06-30T09:05:00",
                        error_message="Training failed",
                        model_path="/workspace/models/pipe-a.n4a",
                    )
                ],
            ),
            SimpleNamespace(
                dataset_id="dataset-b",
                dataset_name="Dataset B",
                split_group_by=None,
                pipelines=[
                    SimpleNamespace(
                        id="old-run-1-dataset-b-pipe-b-v0",
                        pipeline_id="pipe-b",
                        pipeline_name="Pipeline B [n_components=8]",
                        model="PLSRegression",
                        preprocessing="SNV + Derivative",
                        split_strategy="KFold(7)",
                        status="completed",
                        progress=100,
                        metrics={"r2": 0.91},
                        config={"name": "Pipeline B", "steps": [{"id": "sweep"}]},
                        logs=["completed"],
                        started_at="2026-06-30T09:01:00",
                        completed_at="2026-06-30T09:06:00",
                        error_message=None,
                        model_path="/workspace/models/pipe-b.n4a",
                        variant_index=0,
                        variant_description="n_components=8",
                        variant_choices={"model__n_components": 8},
                        is_expanded_variant=True,
                        estimated_variants=1,
                        has_generators=False,
                        fold_count=7,
                        branch_count=1,
                        total_model_count=7,
                        model_count_breakdown="7 folds",
                    )
                ],
            ),
        ],
        status="failed",
        created_at="2026-06-30T08:59:00",
        cv_folds=7,
        total_pipelines=2,
        completed_pipelines=1,
        workspace_path="/workspace",
        project_id="project-1",
    )


def test_retry_run_execution_plan_resets_run_and_pipeline_runtime_state():
    plan = build_retry_run_execution_plan(
        _failed_run_like_for_retry_plan(),
        new_run_id="retry-run-1",
        created_at="2026-06-30T10:00:00",
    )

    assert _plan_field(plan, "run_id", "id") == "retry-run-1"
    assert _plan_field(plan, "name") == "Failed calibration (retry)"
    assert _plan_field(plan, "status") == "queued"
    assert _plan_field(plan, "created_at") == "2026-06-30T10:00:00"
    assert _plan_field(plan, "completed_pipelines") == 0

    datasets = _plan_field(plan, "datasets")
    retried_pipelines = [pipeline for dataset in datasets for pipeline in _plan_field(dataset, "pipelines")]

    assert [_plan_field(pipeline, "pipeline_run_id", "id") for pipeline in retried_pipelines] == [
        "retry-run-1-pipe-a",
        "retry-run-1-pipe-b",
    ]

    for pipeline in retried_pipelines:
        assert _plan_field(pipeline, "status") == "queued"
        assert _plan_field(pipeline, "progress") == 0
        assert _optional_plan_field(pipeline, "metrics") is None
        assert _optional_plan_field(pipeline, "logs") is None
        assert _optional_plan_field(pipeline, "started_at") is None
        assert _optional_plan_field(pipeline, "completed_at") is None
        assert _optional_plan_field(pipeline, "error_message", "error") is None
        assert _optional_plan_field(pipeline, "model_path") is None


def test_retry_run_execution_plan_preserves_configuration_and_variant_metadata():
    plan = build_retry_run_execution_plan(
        _failed_run_like_for_retry_plan(),
        new_run_id="retry-run-1",
        created_at="2026-06-30T10:00:00",
    )

    assert _plan_field(plan, "execution_backend") == "cluster"
    assert _plan_field(plan, "cv_folds") == 7
    assert _plan_field(plan, "workspace_path") == "/workspace"
    assert _plan_field(plan, "project_id") == "project-1"
    assert _plan_field(plan, "total_pipelines") == 2

    dataset_a, dataset_b = _plan_field(plan, "datasets")
    assert _plan_field(dataset_a, "split_group_by") == "subject"
    assert _plan_field(dataset_b, "split_group_by") is None

    pipeline_a = _plan_field(dataset_a, "pipelines")[0]
    assert _plan_field(pipeline_a, "config") == {"name": "Pipeline A", "steps": [{"id": "snv"}]}

    variant_pipeline = _plan_field(dataset_b, "pipelines")[0]
    assert _plan_field(variant_pipeline, "pipeline_id") == "pipe-b"
    assert _plan_field(variant_pipeline, "pipeline_name") == "Pipeline B [n_components=8]"
    assert _plan_field(variant_pipeline, "model") == "PLSRegression"
    assert _plan_field(variant_pipeline, "preprocessing") == "SNV + Derivative"
    assert _plan_field(variant_pipeline, "split_strategy") == "KFold(7)"
    assert _plan_field(variant_pipeline, "config") == {"name": "Pipeline B", "steps": [{"id": "sweep"}]}
    assert _plan_field(variant_pipeline, "variant_index") == 0
    assert _plan_field(variant_pipeline, "variant_description") == "n_components=8"
    assert _plan_field(variant_pipeline, "variant_choices") == {"model__n_components": 8}
    assert _plan_field(variant_pipeline, "is_expanded_variant") is True
    assert _plan_field(variant_pipeline, "estimated_variants") == 1
    assert _plan_field(variant_pipeline, "has_generators") is False
    assert _plan_field(variant_pipeline, "fold_count") == 7
    assert _plan_field(variant_pipeline, "branch_count") == 1
    assert _plan_field(variant_pipeline, "total_model_count") == 7
    assert _plan_field(variant_pipeline, "model_count_breakdown") == "7 folds"
