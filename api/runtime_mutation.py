"""Keep a running scientific process isolated from pip changes to its files."""

import threading
from contextlib import contextmanager

from starlette.responses import JSONResponse


class RuntimeMutationState:
    def __init__(self):
        self.lock = threading.Lock()
        self.active_requests = 0
        self.installing = False
        self.restart_reason = None

    def snapshot(self):
        with self.lock:
            return {
                "dependency_installing": self.installing,
                "requires_restart": self.restart_reason is not None,
                "restart_reason": self.restart_reason,
            }

    def enter_request(self):
        with self.lock:
            if self.restart_reason:
                return False
            self.active_requests += 1
            return True

    def leave_request(self):
        with self.lock:
            self.active_requests -= 1

    @contextmanager
    def mutation(self, package):
        # The HTTP counter covers inline analyses and job submission; the job
        # check covers work that continues after the submission response.
        from . import lazy_imports
        from .jobs import JobStatus, JobType, job_manager

        with self.lock:
            if self.installing:
                raise RuntimeError("Another dependency installation is still running")
            if self.active_requests or lazy_imports._ml_loading:
                raise RuntimeError("Wait for active requests and ML initialization to finish before changing dependencies")
            installation_jobs = {JobType.UPDATE_DOWNLOAD, JobType.UPDATE_APPLY, JobType.VENV_CREATE, JobType.VENV_INSTALL}
            for status in (JobStatus.PENDING, JobStatus.RUNNING):
                if any(job.type not in installation_jobs for job in job_manager.list_jobs(status=status, limit=1000)):
                    raise RuntimeError("Wait for running analyses or cancel them before changing dependencies")
            self.installing = True
            self.restart_reason = (
                f"Python dependencies are being changed ({package}). Restart the backend before running analyses; "
                "its imported modules may differ from the installed files."
            )
        try:
            yield
        finally:
            # Even a failed pip command may already have replaced dependencies.
            # Only a fresh backend process can clear this state safely.
            with self.lock:
                self.installing = False


runtime_mutation = RuntimeMutationState()


def runtime_change_status():
    return runtime_mutation.snapshot()


class RuntimeMutationMiddleware:
    """Drain active requests before pip and retain settings/restart access."""

    _CONTROL_ROUTES = {"health", "system", "updates", "config", "jobs", "logs"}

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        control = path.removeprefix("/api/").split("/", 1)[0] in self._CONTROL_ROUTES
        protected = scope["type"] == "http" and path.startswith("/api/") and not control and scope.get("method") != "OPTIONS"
        if not protected:
            return await self.app(scope, receive, send)
        if not runtime_mutation.enter_request():
            state = runtime_mutation.snapshot()
            response = JSONResponse(status_code=503, content={"detail": state["restart_reason"], **state})
            return await response(scope, receive, send)
        try:
            return await self.app(scope, receive, send)
        finally:
            runtime_mutation.leave_request()
