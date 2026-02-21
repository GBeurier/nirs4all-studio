"""
Jobs package for background task management.

Provides job manager for tracking long-running tasks like training,
evaluation, and AutoML searches.
"""

from .manager import Job, JobStatus, JobType, job_manager

__all__ = ["job_manager", "Job", "JobStatus", "JobType"]
