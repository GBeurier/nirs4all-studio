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
    notify_training_epoch,
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
    "notify_training_epoch",
]
