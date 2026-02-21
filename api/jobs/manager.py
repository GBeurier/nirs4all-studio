"""
Job manager for background tasks in nirs4all webapp.

This module provides a JobManager class for managing long-running tasks
such as training, evaluation, and AutoML searches.

Phase 5: WebSocket integration for real-time updates.
"""

import asyncio
import threading
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

from ..shared.logger import get_logger

logger = get_logger(__name__)


class JobStatus(str, Enum):
    """Status of a background job."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobType(str, Enum):
    """Type of background job."""

    TRAINING = "training"
    EVALUATION = "evaluation"
    PREDICTION = "prediction"
    AUTOML = "automl"
    EXPORT = "export"
    ANALYSIS = "analysis"
    MAINTENANCE = "maintenance"
    # Update-related jobs
    UPDATE_DOWNLOAD = "update_download"
    UPDATE_APPLY = "update_apply"
    VENV_CREATE = "venv_create"
    VENV_INSTALL = "venv_install"


@dataclass
class Job:
    """Represents a background job."""

    id: str
    type: JobType
    status: JobStatus
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    progress: float = 0.0
    progress_message: str = ""
    config: Dict[str, Any] = field(default_factory=dict)
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    error_traceback: Optional[str] = None
    metrics: Dict[str, Any] = field(default_factory=dict)
    history: List[Dict[str, Any]] = field(default_factory=list)
    cancellation_requested: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Convert job to dictionary for JSON serialization."""
        return {
            "id": self.id,
            "type": self.type.value,
            "status": self.status.value,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "progress": self.progress,
            "progress_message": self.progress_message,
            "config": self.config,
            "result": self.result,
            "error": self.error,
            "metrics": self.metrics,
            "duration_seconds": self._get_duration(),
        }

    def _get_duration(self) -> Optional[float]:
        """Get job duration in seconds."""
        if not self.started_at:
            return None

        end_time = self.completed_at or datetime.now()
        return (end_time - self.started_at).total_seconds()


class JobManager:
    """
    Manages background jobs for the nirs4all webapp.

    Provides methods to create, track, update, and cancel jobs.
    Uses a thread pool for executing long-running tasks.
    """

    def __init__(self, max_workers: int = 4):
        """Initialize the job manager.

        Args:
            max_workers: Maximum number of concurrent jobs
        """
        self._jobs: Dict[str, Job] = {}
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._lock = threading.Lock()
        self._callbacks: Dict[str, List[Callable[[Job], None]]] = {}

    def create_job(
        self,
        job_type: JobType,
        config: Dict[str, Any],
    ) -> Job:
        """Create a new job.

        Args:
            job_type: Type of job (training, evaluation, etc.)
            config: Job configuration

        Returns:
            The created Job instance
        """
        job_id = f"{job_type.value}_{uuid.uuid4().hex[:8]}"

        job = Job(
            id=job_id,
            type=job_type,
            status=JobStatus.PENDING,
            created_at=datetime.now(),
            config=config,
        )

        with self._lock:
            self._jobs[job_id] = job

        return job

    def submit_job(
        self,
        job: Job,
        task_fn: Callable[[Job, Callable[[float, str], None]], Any],
    ) -> Job:
        """Submit a job for execution.

        Args:
            job: The job to execute
            task_fn: Function to execute, receives (job, progress_callback)

        Returns:
            The job instance
        """

        def run_task():
            self._execute_job(job, task_fn)

        self._executor.submit(run_task)
        return job

    def _execute_job(
        self,
        job: Job,
        task_fn: Callable[[Job, Callable[[float, str], None]], Any],
    ) -> None:
        """Execute a job in the thread pool.

        Args:
            job: The job to execute
            task_fn: Function to execute
        """
        job.status = JobStatus.RUNNING
        job.started_at = datetime.now()
        self._notify_callbacks(job)

        def progress_callback(progress: float, message: str = "") -> bool:
            """Callback for task to report progress.

            Returns:
                False if cancellation was requested
            """
            job.progress = min(max(progress, 0.0), 100.0)
            job.progress_message = message
            self._notify_callbacks(job)
            return not job.cancellation_requested

        try:
            result = task_fn(job, progress_callback)

            if job.cancellation_requested:
                job.status = JobStatus.CANCELLED
                job.error = "Job was cancelled"
            else:
                job.status = JobStatus.COMPLETED
                job.result = result if isinstance(result, dict) else {"result": result}
                job.progress = 100.0

        except Exception as e:
            job.status = JobStatus.FAILED
            job.error = str(e)
            job.error_traceback = traceback.format_exc()

        finally:
            job.completed_at = datetime.now()
            self._notify_callbacks(job)

    def get_job(self, job_id: str) -> Optional[Job]:
        """Get a job by ID.

        Args:
            job_id: Job ID

        Returns:
            Job instance or None if not found
        """
        with self._lock:
            return self._jobs.get(job_id)

    def list_jobs(
        self,
        job_type: Optional[JobType] = None,
        status: Optional[JobStatus] = None,
        limit: int = 50,
    ) -> List[Job]:
        """List jobs with optional filtering.

        Args:
            job_type: Filter by job type
            status: Filter by status
            limit: Maximum number of jobs to return

        Returns:
            List of matching jobs
        """
        with self._lock:
            jobs = list(self._jobs.values())

        # Apply filters
        if job_type:
            jobs = [j for j in jobs if j.type == job_type]
        if status:
            jobs = [j for j in jobs if j.status == status]

        # Sort by created_at descending
        jobs.sort(key=lambda j: j.created_at, reverse=True)

        return jobs[:limit]

    def cancel_job(self, job_id: str) -> bool:
        """Request cancellation of a job.

        Args:
            job_id: Job ID

        Returns:
            True if cancellation was requested, False if job not found
        """
        job = self.get_job(job_id)
        if not job:
            return False

        if job.status not in (JobStatus.PENDING, JobStatus.RUNNING):
            return False

        job.cancellation_requested = True

        if job.status == JobStatus.PENDING:
            job.status = JobStatus.CANCELLED
            job.completed_at = datetime.now()
            self._notify_callbacks(job)

        return True

    def update_job_metrics(
        self,
        job_id: str,
        metrics: Dict[str, Any],
        append_history: bool = True,
    ) -> bool:
        """Update job metrics.

        Args:
            job_id: Job ID
            metrics: Metrics to update/merge
            append_history: Whether to append to history

        Returns:
            True if updated, False if job not found
        """
        job = self.get_job(job_id)
        if not job:
            return False

        job.metrics.update(metrics)

        if append_history:
            history_entry = {
                "timestamp": datetime.now().isoformat(),
                **metrics,
            }
            job.history.append(history_entry)

        self._notify_callbacks(job)
        return True

    def register_callback(
        self,
        job_id: str,
        callback: Callable[[Job], None],
    ) -> None:
        """Register a callback for job updates.

        Args:
            job_id: Job ID
            callback: Function to call on job updates
        """
        with self._lock:
            if job_id not in self._callbacks:
                self._callbacks[job_id] = []
            self._callbacks[job_id].append(callback)

    def unregister_callback(
        self,
        job_id: str,
        callback: Callable[[Job], None],
    ) -> None:
        """Unregister a callback.

        Args:
            job_id: Job ID
            callback: Callback function to remove
        """
        with self._lock:
            if job_id in self._callbacks:
                try:
                    self._callbacks[job_id].remove(callback)
                except ValueError:
                    pass

    def _notify_callbacks(self, job: Job) -> None:
        """Notify all callbacks for a job.

        Args:
            job: Job instance
        """
        with self._lock:
            callbacks = self._callbacks.get(job.id, [])

        for callback in callbacks:
            try:
                callback(job)
            except Exception as e:
                logger.error("Error in job callback: %s", e)

        # Dispatch WebSocket notification asynchronously
        self._dispatch_websocket_notification(job)

    def _dispatch_websocket_notification(self, job: Job) -> None:
        """
        Dispatch WebSocket notification for job update.

        This runs the async notification in the event loop if available,
        or creates a new one if needed.

        Args:
            job: Job instance
        """
        try:
            # Import here to avoid circular imports
            from websocket import (
                notify_job_started,
                notify_job_progress,
                notify_job_completed,
                notify_job_failed,
            )

            async def send_notification():
                job_data = job.to_dict()

                if job.status == JobStatus.RUNNING and job.progress == 0:
                    await notify_job_started(job.id, job_data)
                elif job.status == JobStatus.RUNNING:
                    await notify_job_progress(
                        job.id,
                        job.progress,
                        job.progress_message,
                        job.metrics,
                    )
                elif job.status == JobStatus.COMPLETED:
                    await notify_job_completed(job.id, job.result or {})
                elif job.status == JobStatus.FAILED:
                    await notify_job_failed(job.id, job.error or "Unknown error", job.error_traceback)
                elif job.status == JobStatus.CANCELLED:
                    await notify_job_failed(job.id, "Job was cancelled")

            # Try to get running event loop
            try:
                loop = asyncio.get_running_loop()
                asyncio.run_coroutine_threadsafe(send_notification(), loop)
            except RuntimeError:
                # No running loop - create one for this thread
                try:
                    asyncio.run(send_notification())
                except Exception as e:
                    logger.error("Error running WebSocket notification: %s", e)

        except ImportError:
            # WebSocket module not available, skip notification
            pass
        except Exception as e:
            logger.error("Error dispatching WebSocket notification: %s", e)

    def cleanup_old_jobs(self, max_age_hours: int = 24) -> int:
        """Remove old completed/failed jobs.

        Args:
            max_age_hours: Maximum age in hours for jobs to keep

        Returns:
            Number of jobs removed
        """
        cutoff = datetime.now()
        removed = 0

        with self._lock:
            job_ids_to_remove = []
            for job_id, job in self._jobs.items():
                if job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
                    if job.completed_at:
                        age_hours = (cutoff - job.completed_at).total_seconds() / 3600
                        if age_hours > max_age_hours:
                            job_ids_to_remove.append(job_id)

            for job_id in job_ids_to_remove:
                del self._jobs[job_id]
                if job_id in self._callbacks:
                    del self._callbacks[job_id]
                removed += 1

        return removed

    def shutdown(self, wait: bool = True) -> None:
        """Shutdown the job manager.

        Args:
            wait: Whether to wait for pending jobs to complete
        """
        self._executor.shutdown(wait=wait)


# Global job manager instance
job_manager = JobManager()
