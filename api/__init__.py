"""
API package for nirs4all webapp FastAPI backend.

This package provides the REST API endpoints for:
- Workspace management (workspace.py)
- Dataset operations (datasets.py)
- Spectral data access (spectra.py)
- Preprocessing methods (preprocessing.py)
- Pipeline CRUD (pipelines.py)
- Training execution (training.py)
- Model management (models.py)
- Prediction storage and execution (predictions.py)
- System health and info (system.py)
- Background job management (jobs/)
- Analysis and dimensionality reduction (analysis.py)
- Model evaluation and metrics (evaluation.py)
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .jobs import Job, JobStatus, JobType, job_manager
    from .workspace_manager import WorkspaceConfig, workspace_manager

__all__ = [
    "workspace_manager",
    "WorkspaceConfig",
    "job_manager",
    "Job",
    "JobStatus",
    "JobType",
]


def __getattr__(name: str) -> Any:
    """Resolve public API symbols lazily to avoid import-time side effects."""
    if name in {"workspace_manager", "WorkspaceConfig"}:
        from .workspace_manager import WorkspaceConfig, workspace_manager

        values = {
            "workspace_manager": workspace_manager,
            "WorkspaceConfig": WorkspaceConfig,
        }
        return values[name]

    if name in {"job_manager", "Job", "JobStatus", "JobType"}:
        from .jobs import Job, JobStatus, JobType, job_manager

        values = {
            "job_manager": job_manager,
            "Job": Job,
            "JobStatus": JobStatus,
            "JobType": JobType,
        }
        return values[name]

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
