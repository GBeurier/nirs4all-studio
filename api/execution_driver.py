"""Small execution-driver contract for backend run dispatch."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from .execution_job_records import ExecutionJobRecordRepository, execution_job_record_from_job
from .jobs.manager import Job, JobManager, JobType
from .runtime_errors import RtError, RtUnsupportedError, rt_error_from_execution_metadata

ExecutionBackend = Literal["local-python", "cluster", "wasm-local"]
ExecutionDriverMode = Literal["in-process"]
AnalysisExecutionType = Literal["shap", "automl"]
ExecutionJobCommandAction = Literal["cancel"]
ProgressCallback = Callable[[float, str], bool]
ExecutionTask = Callable[[Job, ProgressCallback], Any]


@dataclass(frozen=True)
class ExecutionDriverCapability:
    """Serializable capability metadata advertised by an execution driver."""

    backend: ExecutionBackend
    label: str
    available: bool
    mode: ExecutionDriverMode
    supports_progress: bool
    supports_cancellation: bool
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return a plain JSON-friendly capability dictionary."""
        return {
            "backend": self.backend,
            "label": self.label,
            "available": self.available,
            "mode": self.mode,
            "supports_progress": self.supports_progress,
            "supports_cancellation": self.supports_cancellation,
            "metadata": dict(self.metadata),
        }

    def rt_error(self, verb: str = "run") -> RtError | None:
        """Return the neutral ``RtError`` envelope for this capability.

        Returns ``None`` when the backend is available (no error to report). The
        envelope is derived purely from the existing capability fields, so the
        frozen :meth:`to_dict` wire shape is unaffected.
        """
        return rt_error_from_execution_metadata(
            verb=verb,
            backend=self.backend,
            available=self.available,
            metadata=self.metadata,
        )


@dataclass(frozen=True)
class ExecutionJobCommandResult:
    """Serializable result for a driver-level execution job command."""

    action: ExecutionJobCommandAction
    job_id: str
    success: bool
    message: str
    backend: ExecutionBackend
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return a plain JSON-friendly command result."""
        payload: dict[str, Any] = {
            "action": self.action,
            "job_id": self.job_id,
            "success": self.success,
            "message": self.message,
            "backend": self.backend,
        }
        if self.metadata:
            payload["metadata"] = dict(self.metadata)
        return payload


@dataclass(frozen=True)
class ExecutionRequest:
    """Run execution request passed to a concrete driver."""

    run_id: str
    run_name: str
    requested_backend: ExecutionBackend = "local-python"
    total_pipelines: int = 0
    dataset_count: int = 0
    workspace_path: str | None = None
    created_at: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_metadata(self) -> dict[str, Any]:
        """Return safe metadata for job config and WebSocket payloads."""
        payload: dict[str, Any] = {
            "run_id": self.run_id,
            "run_name": self.run_name,
            "requested_backend": self.requested_backend,
            "total_pipelines": self.total_pipelines,
            "dataset_count": self.dataset_count,
            "has_workspace": self.workspace_path is not None,
        }
        if self.created_at is not None:
            payload["created_at"] = self.created_at
        if self.metadata:
            payload["metadata"] = dict(self.metadata)
        return payload


@dataclass(frozen=True)
class ExecutionArtifactRef:
    """Serializable reference to an execution input or output artifact."""

    role: str
    artifact_type: str
    artifact_id: str | None = None
    path: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-friendly artifact reference without empty fields."""
        payload: dict[str, Any] = {
            "role": self.role,
            "artifact_type": self.artifact_type,
        }
        if self.artifact_id is not None:
            payload["artifact_id"] = self.artifact_id
        if self.path is not None:
            payload["path"] = self.path
        if self.metadata:
            payload["metadata"] = dict(self.metadata)
        return payload


@dataclass(frozen=True)
class AnalysisExecutionRequest:
    """Analysis job execution metadata that can later be persisted."""

    job_id: str
    analysis_type: AnalysisExecutionType
    dataset_id: str
    requested_backend: ExecutionBackend = "local-python"
    workspace_path: str | None = None
    artifacts: Sequence[ExecutionArtifactRef] = field(default_factory=tuple)
    parameters: Mapping[str, Any] = field(default_factory=dict)
    created_at: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def to_metadata(self) -> dict[str, Any]:
        """Return safe analysis metadata for JobManager config/result payloads."""
        payload: dict[str, Any] = {
            "kind": "analysis",
            "job_id": self.job_id,
            "analysis_type": self.analysis_type,
            "requested_backend": self.requested_backend,
            "dataset_id": self.dataset_id,
            "has_workspace": self.workspace_path is not None,
        }
        if self.created_at is not None:
            payload["created_at"] = self.created_at
        if self.parameters:
            payload["parameters"] = dict(self.parameters)
        if self.metadata:
            payload["metadata"] = dict(self.metadata)
        if self.artifacts:
            payload["artifacts"] = [artifact.to_dict() for artifact in self.artifacts]
        return payload


def new_execution_job_id(job_type: JobType) -> str:
    """Return a JobManager-compatible id while allowing config metadata up front."""
    return f"{job_type.value}_{uuid.uuid4().hex[:8]}"


def build_analysis_job_config(
    base_config: Mapping[str, Any],
    request: AnalysisExecutionRequest,
) -> dict[str, Any]:
    """Attach analysis execution metadata while preserving legacy config keys."""
    return {
        **dict(base_config),
        "execution_backend": request.requested_backend,
        "execution_request": request.to_metadata(),
        "execution_artifacts": [artifact.to_dict() for artifact in request.artifacts],
    }


def build_analysis_result_metadata(
    config: Mapping[str, Any],
    output_artifacts: Sequence[ExecutionArtifactRef] = (),
) -> dict[str, Any]:
    """Return execution metadata for a completed analysis result."""
    input_artifacts = config.get("execution_artifacts") or ()
    execution_artifacts = [
        *input_artifacts,
        *(artifact.to_dict() for artifact in output_artifacts),
    ]
    execution_request = config.get("execution_request")
    if isinstance(execution_request, Mapping):
        execution_request = dict(execution_request)
        if execution_artifacts:
            execution_request["artifacts"] = execution_artifacts

    return {
        "execution_request": execution_request,
        "execution_artifacts": execution_artifacts,
    }


class ExecutionDriver(Protocol):
    """Protocol implemented by run execution drivers."""

    @property
    def capability(self) -> ExecutionDriverCapability:
        """Driver capability metadata."""

    def build_job_config(self, request: ExecutionRequest) -> dict[str, Any]:
        """Build the JobManager config for this execution request."""

    def submit(
        self,
        request: ExecutionRequest,
        job_manager: JobManager,
        task_fn: ExecutionTask,
    ) -> Job:
        """Submit the request for execution."""

    def cancel_job(self, job_id: str, job_manager: JobManager) -> ExecutionJobCommandResult:
        """Request cancellation for an execution job."""


LOCAL_PYTHON_CAPABILITY = ExecutionDriverCapability(
    backend="local-python",
    label="Local Python",
    available=True,
    mode="in-process",
    supports_progress=True,
    supports_cancellation=True,
    metadata={
        "job_type": JobType.TRAINING.value,
        "scheduler": "job-manager-thread-pool",
        "runner": "nirs4all.run",
    },
)


@dataclass(frozen=True)
class LocalPythonExecutionDriver:
    """Execution driver for the existing local JobManager/nirs4all path."""

    capability: ExecutionDriverCapability = LOCAL_PYTHON_CAPABILITY
    job_record_repository: ExecutionJobRecordRepository | None = None

    def build_job_config(self, request: ExecutionRequest) -> dict[str, Any]:
        """Build JobManager config while preserving legacy run_id/run_name keys."""
        return {
            "run_id": request.run_id,
            "run_name": request.run_name,
            "execution_backend": request.requested_backend,
            "execution_request": request.to_metadata(),
            "execution_driver": self.capability.to_dict(),
        }

    def _save_job_record(self, job: Job) -> None:
        if self.job_record_repository is None:
            return
        self.job_record_repository.save_job_record(execution_job_record_from_job(job))

    def _register_job_record_updates(self, job: Job, job_manager: JobManager) -> None:
        if self.job_record_repository is None:
            return
        register_callback = getattr(job_manager, "register_callback", None)
        if callable(register_callback):
            register_callback(job.id, self._save_job_record)

    def submit(
        self,
        request: ExecutionRequest,
        job_manager: JobManager,
        task_fn: ExecutionTask,
    ) -> Job:
        """Submit a training job through the existing local JobManager."""
        job = job_manager.create_job(
            JobType.TRAINING,
            self.build_job_config(request),
            job_id=request.run_id,
        )
        self._save_job_record(job)
        self._register_job_record_updates(job, job_manager)
        job_manager.submit_job(job, task_fn)
        return job

    def cancel_job(self, job_id: str, job_manager: JobManager) -> ExecutionJobCommandResult:
        """Request cooperative cancellation through the local JobManager."""
        success = job_manager.cancel_job(job_id)
        message = (
            f"Cancellation requested for job {job_id}"
            if success
            else f"Execution job {job_id} was not found or cannot be cancelled"
        )
        return ExecutionJobCommandResult(
            action="cancel",
            job_id=job_id,
            success=success,
            message=message,
            backend=self.capability.backend,
            metadata={"scheduler": "job-manager-thread-pool"},
        )


LOCAL_PYTHON_DRIVER = LocalPythonExecutionDriver()

CLUSTER_UNAVAILABLE_CAPABILITY = ExecutionDriverCapability(
    backend="cluster",
    label="Cluster",
    available=False,
    mode="in-process",
    supports_progress=False,
    supports_cancellation=False,
    metadata={
        "reason": "driver_unavailable",
        "message": "Cluster execution is typed but no cluster driver is configured.",
    },
)

WASM_LOCAL_UNAVAILABLE_CAPABILITY = ExecutionDriverCapability(
    backend="wasm-local",
    label="WASM Local",
    available=False,
    mode="in-process",
    supports_progress=False,
    supports_cancellation=False,
    metadata={
        "reason": "driver_unavailable",
        "message": "WASM local execution is typed but no WASM driver is configured.",
    },
)


def _unavailable_execution_backend_message(capability: ExecutionDriverCapability) -> str:
    message = capability.metadata.get("message")
    if isinstance(message, str) and message.strip():
        return message
    return f"Execution backend {capability.backend!r} is typed but no execution driver is configured."


@dataclass(frozen=True)
class UnavailableExecutionDriver:
    """Driver placeholder for typed execution backends without an implementation."""

    capability: ExecutionDriverCapability

    def build_job_config(self, request: ExecutionRequest) -> dict[str, Any]:
        """Build non-runnable job metadata for diagnostics and future records."""
        return {
            "run_id": request.run_id,
            "run_name": request.run_name,
            "execution_backend": request.requested_backend,
            "execution_request": request.to_metadata(),
            "execution_driver": self.capability.to_dict(),
        }

    def submit(
        self,
        request: ExecutionRequest,
        job_manager: JobManager,
        task_fn: ExecutionTask,
    ) -> Job:
        """Reject submission with an explicit ``RtError``.

        Raises :class:`RtUnsupportedError` (a ``RuntimeError`` subclass) carrying
        the neutral envelope; the message is unchanged from the legacy bare
        ``RuntimeError`` so existing handlers keep matching it.
        """
        rt_error = self.capability.rt_error(verb="run")
        # An UnavailableExecutionDriver always wraps an unavailable capability,
        # so the classifier never returns None here.
        assert rt_error is not None
        raise RtUnsupportedError(rt_error)

    def cancel_job(self, job_id: str, job_manager: JobManager) -> ExecutionJobCommandResult:
        """Return a structured cancellation refusal for unavailable backends."""
        return ExecutionJobCommandResult(
            action="cancel",
            job_id=job_id,
            success=False,
            message=_unavailable_execution_backend_message(self.capability),
            backend=self.capability.backend,
            metadata={"reason": "driver_unavailable"},
        )


CLUSTER_UNAVAILABLE_DRIVER = UnavailableExecutionDriver(CLUSTER_UNAVAILABLE_CAPABILITY)
WASM_LOCAL_UNAVAILABLE_DRIVER = UnavailableExecutionDriver(WASM_LOCAL_UNAVAILABLE_CAPABILITY)

_DRIVER_BY_REQUESTED_BACKEND: dict[ExecutionBackend, ExecutionDriver] = {
    "local-python": LOCAL_PYTHON_DRIVER,
    "cluster": CLUSTER_UNAVAILABLE_DRIVER,
    "wasm-local": WASM_LOCAL_UNAVAILABLE_DRIVER,
}

KNOWN_EXECUTION_BACKENDS: tuple[ExecutionBackend, ...] = (
    "local-python",
    "cluster",
    "wasm-local",
)


def list_execution_driver_capabilities() -> list[ExecutionDriverCapability]:
    """Return driver capabilities for every typed execution backend."""
    return [
        _DRIVER_BY_REQUESTED_BACKEND[backend].capability
        for backend in KNOWN_EXECUTION_BACKENDS
    ]


def get_execution_driver(
    requested_backend: ExecutionBackend,
    job_record_repository: ExecutionJobRecordRepository | None = None,
) -> ExecutionDriver:
    """Resolve the driver used for a requested execution backend."""
    driver = _DRIVER_BY_REQUESTED_BACKEND[requested_backend]
    if job_record_repository is None:
        return driver
    if isinstance(driver, LocalPythonExecutionDriver):
        return LocalPythonExecutionDriver(
            capability=driver.capability,
            job_record_repository=job_record_repository,
        )
    return driver
