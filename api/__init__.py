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

from .workspace_manager import workspace_manager, WorkspaceConfig
from .jobs import job_manager, Job, JobStatus, JobType

__all__ = [
    "workspace_manager",
    "WorkspaceConfig",
    "job_manager",
    "Job",
    "JobStatus",
    "JobType",
]
