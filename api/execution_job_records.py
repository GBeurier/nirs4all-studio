"""Normalized execution job records for execution-driver backends."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any, Protocol

from .jobs.manager import Job


def _as_mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, Mapping) else {}


def _as_value(value: Any) -> str:
    return str(getattr(value, "value", value))


def _as_isoformat(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _fallback_progress(status: Any) -> float:
    return 100.0 if status == "completed" else 0.0


def _normalize_record_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    normalized = dict(payload)
    progress_missing = "progress" not in normalized or normalized["progress"] is None
    progress_message_missing = "progress_message" not in normalized or normalized["progress_message"] is None
    explicit_progress_unavailable = normalized.get("progress_unavailable")
    normalized["progress_unavailable"] = (explicit_progress_unavailable if isinstance(explicit_progress_unavailable, bool) else False) or progress_missing or progress_message_missing
    if progress_missing:
        normalized["progress"] = _fallback_progress(normalized.get("status"))
    if progress_message_missing:
        normalized["progress_message"] = "Progress unavailable"
    return normalized


def _validate_job_id(job_id: str) -> str:
    if not job_id or job_id in {".", ".."} or "/" in job_id or "\\" in job_id:
        raise ValueError("Execution job id must be a single path segment.")
    return job_id


@dataclass(frozen=True)
class ExecutionJobRecord:
    """JSON-friendly request/status record for a submitted execution job."""

    job_id: str
    job_type: str
    requested_backend: str
    execution_backend: str
    execution_mode: str | None
    status: str
    progress: float
    progress_message: str
    created_at: str
    progress_unavailable: bool = False
    started_at: str | None = None
    completed_at: str | None = None
    request: Mapping[str, Any] = field(default_factory=dict)
    driver: Mapping[str, Any] = field(default_factory=dict)
    metrics: Mapping[str, Any] = field(default_factory=dict)
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Return a plain dictionary suitable for durable JSON storage."""
        return {
            "job_id": self.job_id,
            "job_type": self.job_type,
            "requested_backend": self.requested_backend,
            "execution_backend": self.execution_backend,
            "execution_mode": self.execution_mode,
            "status": self.status,
            "progress": self.progress,
            "progress_message": self.progress_message,
            "progress_unavailable": self.progress_unavailable,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "request": dict(self.request),
            "driver": dict(self.driver),
            "metrics": dict(self.metrics),
            "error": self.error,
        }


class ExecutionJobRecordRepository(Protocol):
    """Narrow persistence seam for execution job request/status records."""

    def save_job_record(self, record: ExecutionJobRecord) -> None:
        """Persist or emit the latest normalized record for a job."""


@dataclass
class InMemoryExecutionJobRecordRepository:
    """Small repository useful for tests and adapters that want a snapshot."""

    records: dict[str, ExecutionJobRecord] = field(default_factory=dict)
    history: list[ExecutionJobRecord] = field(default_factory=list)

    def save_job_record(self, record: ExecutionJobRecord) -> None:
        """Store the latest record and retain the update history."""
        self.records[record.job_id] = record
        self.history.append(record)

    def get(self, job_id: str) -> ExecutionJobRecord | None:
        """Return the latest record for a job."""
        return self.records.get(job_id)


@dataclass
class WorkspaceExecutionJobRecordRepository:
    """Persist latest execution job snapshots inside a workspace."""

    workspace_path: str | Path
    file_name: str = "execution_job_record.json"
    _lock: Lock = field(default_factory=Lock, init=False, repr=False)

    def _record_path(self, job_id: str) -> Path:
        return Path(self.workspace_path) / "runs" / _validate_job_id(job_id) / self.file_name

    def save_job_record(self, record: ExecutionJobRecord) -> None:
        """Write the latest normalized record snapshot for a job."""
        record_path = self._record_path(record.job_id)
        record_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = record_path.with_suffix(f"{record_path.suffix}.tmp")

        with self._lock:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(record.to_dict(), f, indent=2, sort_keys=True)
                f.write("\n")
            tmp_path.replace(record_path)

    def get(self, job_id: str) -> ExecutionJobRecord | None:
        """Load the latest persisted record for a job, if present."""
        record_path = self._record_path(job_id)
        if not record_path.exists():
            return None
        with open(record_path, encoding="utf-8") as f:
            payload = json.load(f)
        if not isinstance(payload, Mapping):
            raise TypeError("Execution job record snapshot must be a JSON object.")
        return ExecutionJobRecord(**_normalize_record_payload(payload))

    def list_job_ids(self) -> list[str]:
        """Return the job ids that have a persisted snapshot, sorted.

        Discovery scans the workspace ``runs`` directory directly, so it stays
        usable for cluster/WASM consumers that do not have the in-process
        JobManager (``_runs``) available.
        """
        runs_dir = Path(self.workspace_path) / "runs"
        if not runs_dir.is_dir():
            return []
        return sorted(
            entry.name
            for entry in runs_dir.iterdir()
            if entry.is_dir() and (entry / self.file_name).is_file()
        )

    def list_records(self) -> list[ExecutionJobRecord]:
        """Return every persisted snapshot, sorted by job id.

        Snapshots that fail to load (corrupt or partially written) are skipped
        so a single bad file cannot break enumeration.
        """
        records: list[ExecutionJobRecord] = []
        for job_id in self.list_job_ids():
            try:
                record = self.get(job_id)
            except (json.JSONDecodeError, TypeError, ValueError, OSError):
                continue
            if record is not None:
                records.append(record)
        return records


def execution_job_record_from_job(job: Job) -> ExecutionJobRecord:
    """Build a normalized execution record from the current JobManager job state."""
    config = _as_mapping(job.config)
    request = _as_mapping(config.get("execution_request"))
    driver = _as_mapping(config.get("execution_driver"))

    requested_backend = str(
        config.get("execution_backend")
        or request.get("requested_backend")
        or driver.get("backend")
        or ""
    )
    execution_backend = str(driver.get("backend") or requested_backend)
    execution_mode = driver.get("mode")

    return ExecutionJobRecord(
        job_id=job.id,
        job_type=_as_value(job.type),
        requested_backend=requested_backend,
        execution_backend=execution_backend,
        execution_mode=str(execution_mode) if execution_mode is not None else None,
        status=_as_value(job.status),
        progress=float(job.progress),
        progress_message=job.progress_message,
        created_at=_as_isoformat(job.created_at) or "",
        started_at=_as_isoformat(job.started_at),
        completed_at=_as_isoformat(job.completed_at),
        request=request,
        driver=driver,
        metrics=dict(job.metrics),
        error=job.error,
    )
