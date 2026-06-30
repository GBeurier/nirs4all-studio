from __future__ import annotations

import json
from dataclasses import replace

import pytest

from api.execution_job_records import ExecutionJobRecord, WorkspaceExecutionJobRecordRepository


def test_workspace_execution_job_record_repository_persists_latest_snapshot(tmp_path):
    repository = WorkspaceExecutionJobRecordRepository(tmp_path)
    pending = ExecutionJobRecord(
        job_id="run-1",
        job_type="training",
        requested_backend="cluster",
        execution_backend="local-python",
        execution_mode="in-process",
        status="pending",
        progress=0.0,
        progress_message="",
        created_at="2026-06-30T10:00:00",
        request={"run_id": "run-1", "has_workspace": True},
        driver={"backend": "local-python"},
    )

    repository.save_job_record(pending)
    repository.save_job_record(
        replace(
            pending,
            status="running",
            progress=40.0,
            progress_message="training",
            started_at="2026-06-30T10:00:01",
        )
    )

    record_path = tmp_path / "runs" / "run-1" / "execution_job_record.json"
    payload = json.loads(record_path.read_text(encoding="utf-8"))

    assert payload["job_id"] == "run-1"
    assert payload["status"] == "running"
    assert payload["progress"] == 40.0
    assert payload["progress_unavailable"] is False
    assert payload["request"] == {"run_id": "run-1", "has_workspace": True}
    record = repository.get("run-1")
    assert record is not None
    assert record.status == "running"
    assert record.progress_unavailable is False


@pytest.mark.parametrize(("status", "expected_progress"), [("completed", 100.0), ("running", 0.0)])
def test_workspace_execution_job_record_repository_loads_partial_snapshot_with_progress_fallbacks(tmp_path, status, expected_progress):
    repository = WorkspaceExecutionJobRecordRepository(tmp_path)
    job_id = f"partial-{status}"
    record_path = tmp_path / "runs" / job_id / "execution_job_record.json"
    record_path.parent.mkdir(parents=True)
    record_path.write_text(
        json.dumps(
            {
                "job_id": job_id,
                "job_type": "training",
                "requested_backend": "cluster",
                "execution_backend": "local-python",
                "execution_mode": "in-process",
                "status": status,
                "created_at": "2026-06-30T10:00:00",
            }
        ),
        encoding="utf-8",
    )

    record = repository.get(job_id)

    assert record is not None
    assert record.progress == expected_progress
    assert record.progress_message == "Progress unavailable"
    assert record.progress_unavailable is True
    payload = record.to_dict()
    assert payload["progress"] == expected_progress
    assert payload["progress_message"] == "Progress unavailable"
    assert payload["progress_unavailable"] is True


def test_workspace_execution_job_record_repository_preserves_explicit_progress_unavailable(tmp_path):
    repository = WorkspaceExecutionJobRecordRepository(tmp_path)
    job_id = "explicit-unavailable"
    record_path = tmp_path / "runs" / job_id / "execution_job_record.json"
    record_path.parent.mkdir(parents=True)
    record_path.write_text(
        json.dumps(
            {
                "job_id": job_id,
                "job_type": "training",
                "requested_backend": "cluster",
                "execution_backend": "local-python",
                "execution_mode": "in-process",
                "status": "running",
                "progress": 25.0,
                "progress_message": "queued remotely",
                "progress_unavailable": True,
                "created_at": "2026-06-30T10:00:00",
            }
        ),
        encoding="utf-8",
    )

    record = repository.get(job_id)

    assert record is not None
    assert record.progress == 25.0
    assert record.progress_message == "queued remotely"
    assert record.progress_unavailable is True
    assert record.to_dict()["progress_unavailable"] is True


def test_workspace_execution_job_record_repository_rejects_nested_job_ids(tmp_path):
    repository = WorkspaceExecutionJobRecordRepository(tmp_path)
    record = ExecutionJobRecord(
        job_id="../escape",
        job_type="training",
        requested_backend="cluster",
        execution_backend="local-python",
        execution_mode="in-process",
        status="pending",
        progress=0.0,
        progress_message="",
        created_at="2026-06-30T10:00:00",
    )

    with pytest.raises(ValueError, match="single path segment"):
        repository.save_job_record(record)

    with pytest.raises(ValueError, match="single path segment"):
        repository.get("nested/run")


def _record(job_id: str) -> ExecutionJobRecord:
    return ExecutionJobRecord(
        job_id=job_id,
        job_type="training",
        requested_backend="cluster",
        execution_backend="local-python",
        execution_mode="in-process",
        status="pending",
        progress=0.0,
        progress_message="",
        created_at="2026-06-30T10:00:00",
    )


def test_list_job_ids_returns_empty_when_no_runs(tmp_path):
    repository = WorkspaceExecutionJobRecordRepository(tmp_path)
    assert repository.list_job_ids() == []
    assert repository.list_records() == []


def test_list_job_ids_and_records_enumerate_persisted_snapshots(tmp_path):
    repository = WorkspaceExecutionJobRecordRepository(tmp_path)
    repository.save_job_record(_record("run-b"))
    repository.save_job_record(_record("run-a"))

    # A non-record directory and an unrelated file must be ignored.
    (tmp_path / "runs" / "run-a" / "artifacts").mkdir(parents=True, exist_ok=True)
    (tmp_path / "runs" / "stray").mkdir(parents=True, exist_ok=True)

    assert repository.list_job_ids() == ["run-a", "run-b"]
    assert [r.job_id for r in repository.list_records()] == ["run-a", "run-b"]


def test_list_records_skips_corrupt_snapshot(tmp_path):
    repository = WorkspaceExecutionJobRecordRepository(tmp_path)
    repository.save_job_record(_record("good"))
    bad_path = tmp_path / "runs" / "bad" / "execution_job_record.json"
    bad_path.parent.mkdir(parents=True, exist_ok=True)
    bad_path.write_text("{not valid json", encoding="utf-8")

    assert repository.list_job_ids() == ["bad", "good"]
    assert [r.job_id for r in repository.list_records()] == ["good"]
