"""
WebSocket module for nirs4all webapp.

Provides real-time updates for training progress, job status changes,
and other long-running operations via WebSocket connections.
"""

from .manager import (
    WebSocketManager,
    WebSocketMessage,
    MessageType,
    ws_manager,
    notify_job_started,
    notify_job_progress,
    notify_job_completed,
    notify_job_failed,
    notify_job_metrics,
    notify_job_log,
    notify_training_epoch,
    notify_refit_started,
    notify_refit_progress,
    notify_refit_step,
    notify_refit_completed,
    notify_refit_failed,
)

__all__ = [
    "WebSocketManager",
    "WebSocketMessage",
    "MessageType",
    "ws_manager",
    "notify_job_started",
    "notify_job_progress",
    "notify_job_completed",
    "notify_job_failed",
    "notify_job_metrics",
    "notify_job_log",
    "notify_training_epoch",
    "notify_refit_started",
    "notify_refit_progress",
    "notify_refit_step",
    "notify_refit_completed",
    "notify_refit_failed",
]
