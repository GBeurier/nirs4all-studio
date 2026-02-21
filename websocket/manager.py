"""
WebSocket connection manager for nirs4all webapp.

This module provides real-time updates for training progress,
job status changes, and other long-running operations.

Phase 5 Implementation:
- WebSocket connection management
- Channel-based message broadcasting
- Training progress streaming
- Job status updates
"""

import asyncio
import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any, Dict, Optional, Set

from fastapi import WebSocket

from api.shared.logger import get_logger

logger = get_logger(__name__)


class MessageType(StrEnum):
    """Types of WebSocket messages."""

    # Job-related messages
    JOB_STARTED = "job_started"
    JOB_PROGRESS = "job_progress"
    JOB_COMPLETED = "job_completed"
    JOB_FAILED = "job_failed"
    JOB_CANCELLED = "job_cancelled"
    JOB_METRICS = "job_metrics"

    # Maintenance messages
    MAINTENANCE_STARTED = "maintenance_started"
    MAINTENANCE_PROGRESS = "maintenance_progress"
    MAINTENANCE_COMPLETED = "maintenance_completed"
    MAINTENANCE_FAILED = "maintenance_failed"

    # Training-specific messages
    TRAINING_EPOCH = "training_epoch"
    TRAINING_BATCH = "training_batch"
    TRAINING_CHECKPOINT = "training_checkpoint"

    # Granular progress messages (folds, branches, variants)
    FOLD_STARTED = "fold_started"
    FOLD_COMPLETED = "fold_completed"
    BRANCH_ENTERED = "branch_entered"
    BRANCH_EXITED = "branch_exited"
    VARIANT_STARTED = "variant_started"
    VARIANT_COMPLETED = "variant_completed"
    STEP_PROGRESS = "step_progress"

    # Refit-phase messages (sub-phase of training job)
    REFIT_STARTED = "refit_started"
    REFIT_PROGRESS = "refit_progress"
    REFIT_STEP = "refit_step"
    REFIT_COMPLETED = "refit_completed"
    REFIT_FAILED = "refit_failed"

    # System messages
    PING = "ping"
    PONG = "pong"
    ERROR = "error"
    CONNECTED = "connected"
    SUBSCRIBED = "subscribed"
    UNSUBSCRIBED = "unsubscribed"


@dataclass
class WebSocketMessage:
    """Represents a WebSocket message."""

    type: MessageType
    channel: str
    data: dict[str, Any] = field(default_factory=dict)
    timestamp: str | None = None

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.now().isoformat()

    def to_json(self) -> str:
        """Convert message to JSON string."""
        return json.dumps({
            "type": self.type.value,
            "channel": self.channel,
            "data": self.data,
            "timestamp": self.timestamp,
        })

    @classmethod
    def from_json(cls, json_str: str) -> "WebSocketMessage":
        """Create message from JSON string."""
        data = json.loads(json_str)
        return cls(
            type=MessageType(data.get("type", "error")),
            channel=data.get("channel", ""),
            data=data.get("data", {}),
            timestamp=data.get("timestamp"),
        )


class WebSocketManager:
    """
    Manages WebSocket connections for real-time updates.

    Supports channel-based subscriptions for targeted message delivery.
    """

    def __init__(self):
        """Initialize the WebSocket manager."""
        # All active connections
        self._connections: set[WebSocket] = set()

        # Channel subscriptions: channel -> set of WebSockets
        self._channels: dict[str, set[WebSocket]] = {}

        # Connection metadata: WebSocket -> subscription info
        self._connection_info: dict[WebSocket, dict[str, Any]] = {}

        # Lock for thread-safe operations
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, client_id: str | None = None) -> None:
        """
        Accept a new WebSocket connection.

        Args:
            websocket: The WebSocket connection
            client_id: Optional client identifier
        """
        await websocket.accept()

        async with self._lock:
            self._connections.add(websocket)
            self._connection_info[websocket] = {
                "client_id": client_id,
                "connected_at": datetime.now().isoformat(),
                "subscriptions": set(),
            }

        # Send connection confirmation
        await self.send_to_connection(
            websocket,
            WebSocketMessage(
                type=MessageType.CONNECTED,
                channel="system",
                data={
                    "client_id": client_id,
                    "message": "Connected to nirs4all WebSocket server",
                },
            ),
        )

    async def disconnect(self, websocket: WebSocket) -> None:
        """
        Handle WebSocket disconnection.

        Args:
            websocket: The WebSocket connection to disconnect
        """
        async with self._lock:
            # Remove from all channels
            subscriptions = self._connection_info.get(websocket, {}).get("subscriptions", set())
            for channel in subscriptions:
                if channel in self._channels:
                    self._channels[channel].discard(websocket)
                    if not self._channels[channel]:
                        del self._channels[channel]

            # Remove connection tracking
            self._connections.discard(websocket)
            self._connection_info.pop(websocket, None)

    async def subscribe(self, websocket: WebSocket, channel: str) -> None:
        """
        Subscribe a connection to a channel.

        Args:
            websocket: The WebSocket connection
            channel: Channel name to subscribe to
        """
        async with self._lock:
            if channel not in self._channels:
                self._channels[channel] = set()
            self._channels[channel].add(websocket)

            if websocket in self._connection_info:
                self._connection_info[websocket]["subscriptions"].add(channel)

        await self.send_to_connection(
            websocket,
            WebSocketMessage(
                type=MessageType.SUBSCRIBED,
                channel=channel,
                data={"channel": channel},
            ),
        )

    async def unsubscribe(self, websocket: WebSocket, channel: str) -> None:
        """
        Unsubscribe a connection from a channel.

        Args:
            websocket: The WebSocket connection
            channel: Channel name to unsubscribe from
        """
        async with self._lock:
            if channel in self._channels:
                self._channels[channel].discard(websocket)
                if not self._channels[channel]:
                    del self._channels[channel]

            if websocket in self._connection_info:
                self._connection_info[websocket]["subscriptions"].discard(channel)

        await self.send_to_connection(
            websocket,
            WebSocketMessage(
                type=MessageType.UNSUBSCRIBED,
                channel=channel,
                data={"channel": channel},
            ),
        )

    async def send_to_connection(
        self,
        websocket: WebSocket,
        message: WebSocketMessage,
    ) -> bool:
        """
        Send a message to a specific connection.

        Args:
            websocket: Target WebSocket connection
            message: Message to send

        Returns:
            True if sent successfully, False otherwise
        """
        try:
            await websocket.send_text(message.to_json())
            return True
        except Exception as e:
            logger.error("Error sending WebSocket message: %s", e)
            await self.disconnect(websocket)
            return False

    async def broadcast_to_channel(
        self,
        channel: str,
        message: WebSocketMessage,
    ) -> int:
        """
        Broadcast a message to all subscribers of a channel.

        Args:
            channel: Target channel
            message: Message to broadcast

        Returns:
            Number of connections that received the message
        """
        async with self._lock:
            subscribers = list(self._channels.get(channel, set()))

        sent_count = 0
        disconnected = []

        for websocket in subscribers:
            try:
                await websocket.send_text(message.to_json())
                sent_count += 1
            except Exception:
                disconnected.append(websocket)

        # Clean up disconnected clients
        for ws in disconnected:
            await self.disconnect(ws)

        return sent_count

    async def broadcast_to_all(self, message: WebSocketMessage) -> int:
        """
        Broadcast a message to all connected clients.

        Args:
            message: Message to broadcast

        Returns:
            Number of connections that received the message
        """
        async with self._lock:
            connections = list(self._connections)

        sent_count = 0
        disconnected = []

        for websocket in connections:
            try:
                await websocket.send_text(message.to_json())
                sent_count += 1
            except Exception:
                disconnected.append(websocket)

        # Clean up disconnected clients
        for ws in disconnected:
            await self.disconnect(ws)

        return sent_count

    def get_channel_subscribers(self, channel: str) -> int:
        """
        Get the number of subscribers for a channel.

        Args:
            channel: Channel name

        Returns:
            Number of subscribers
        """
        return len(self._channels.get(channel, set()))

    def get_connection_count(self) -> int:
        """Get the total number of active connections."""
        return len(self._connections)

    async def handle_message(
        self,
        websocket: WebSocket,
        message_text: str,
    ) -> WebSocketMessage | None:
        """
        Handle an incoming WebSocket message.

        Args:
            websocket: Source WebSocket connection
            message_text: Raw message text

        Returns:
            Response message or None
        """
        try:
            message = WebSocketMessage.from_json(message_text)
        except (json.JSONDecodeError, ValueError) as e:
            return WebSocketMessage(
                type=MessageType.ERROR,
                channel="system",
                data={"error": f"Invalid message format: {e}"},
            )

        # Handle built-in message types
        if message.type == MessageType.PING:
            return WebSocketMessage(
                type=MessageType.PONG,
                channel="system",
                data={"timestamp": datetime.now().isoformat()},
            )

        # Handle subscription requests
        if message.type.value == "subscribe":
            channel = message.data.get("channel")
            if channel:
                await self.subscribe(websocket, channel)
            return None

        if message.type.value == "unsubscribe":
            channel = message.data.get("channel")
            if channel:
                await self.unsubscribe(websocket, channel)
            return None

        return None


# Global WebSocket manager instance
ws_manager = WebSocketManager()


# ============= Helper Functions for Job Updates =============


async def notify_job_started(job_id: str, job_data: dict[str, Any]) -> None:
    """
    Notify subscribers that a job has started.

    Args:
        job_id: Job identifier
        job_data: Job information
    """
    channel = f"job:{job_id}"
    message = WebSocketMessage(
        type=MessageType.JOB_STARTED,
        channel=channel,
        data=job_data,
    )
    await ws_manager.broadcast_to_channel(channel, message)


async def notify_job_progress(
    job_id: str,
    progress: float,
    message: str = "",
    metrics: dict[str, Any] | None = None,
) -> None:
    """
    Notify subscribers of job progress update.

    Args:
        job_id: Job identifier
        progress: Progress percentage (0-100)
        message: Progress message
        metrics: Optional metrics data
    """
    channel = f"job:{job_id}"
    msg = WebSocketMessage(
        type=MessageType.JOB_PROGRESS,
        channel=channel,
        data={
            "job_id": job_id,
            "progress": progress,
            "message": message,
            "metrics": metrics or {},
        },
    )
    await ws_manager.broadcast_to_channel(channel, msg)


async def notify_job_completed(job_id: str, result: dict[str, Any]) -> None:
    """
    Notify subscribers that a job has completed.

    Args:
        job_id: Job identifier
        result: Job result data
    """
    channel = f"job:{job_id}"
    message = WebSocketMessage(
        type=MessageType.JOB_COMPLETED,
        channel=channel,
        data={
            "job_id": job_id,
            "result": result,
        },
    )
    await ws_manager.broadcast_to_channel(channel, message)


async def notify_job_failed(job_id: str, error: str, traceback: str | None = None) -> None:
    """
    Notify subscribers that a job has failed.

    Args:
        job_id: Job identifier
        error: Error message
        traceback: Optional error traceback
    """
    channel = f"job:{job_id}"
    message = WebSocketMessage(
        type=MessageType.JOB_FAILED,
        channel=channel,
        data={
            "job_id": job_id,
            "error": error,
            "traceback": traceback,
        },
    )
    await ws_manager.broadcast_to_channel(channel, message)


async def notify_maintenance_started(job_id: str, operation: str, details: dict) -> None:
    """
    Notify subscribers that a maintenance operation has started.

    Args:
        job_id: Job identifier
        operation: Operation name (migration, compact, cleanup, etc.)
        details: Extra details for the operation
    """
    channel = f"job:{job_id}"
    message = WebSocketMessage(
        type=MessageType.MAINTENANCE_STARTED,
        channel=channel,
        data={
            "job_id": job_id,
            "operation": operation,
            "details": details,
        },
    )
    await ws_manager.broadcast_to_channel(channel, message)


async def notify_maintenance_progress(job_id: str, progress: float, message: str = "") -> None:
    """
    Notify subscribers of maintenance progress updates.

    Args:
        job_id: Job identifier
        progress: Progress percentage (0-100)
        message: Progress message
    """
    channel = f"job:{job_id}"
    msg = WebSocketMessage(
        type=MessageType.MAINTENANCE_PROGRESS,
        channel=channel,
        data={
            "job_id": job_id,
            "progress": progress,
            "message": message,
        },
    )
    await ws_manager.broadcast_to_channel(channel, msg)


async def notify_maintenance_completed(job_id: str, operation: str, report: dict) -> None:
    """
    Notify subscribers that a maintenance operation completed.

    Args:
        job_id: Job identifier
        operation: Operation name
        report: Operation report data
    """
    channel = f"job:{job_id}"
    message = WebSocketMessage(
        type=MessageType.MAINTENANCE_COMPLETED,
        channel=channel,
        data={
            "job_id": job_id,
            "operation": operation,
            "report": report,
        },
    )
    await ws_manager.broadcast_to_channel(channel, message)


async def notify_maintenance_failed(job_id: str, operation: str, error: str) -> None:
    """
    Notify subscribers that a maintenance operation failed.

    Args:
        job_id: Job identifier
        operation: Operation name
        error: Error message
    """
    channel = f"job:{job_id}"
    message = WebSocketMessage(
        type=MessageType.MAINTENANCE_FAILED,
        channel=channel,
        data={
            "job_id": job_id,
            "operation": operation,
            "error": error,
        },
    )
    await ws_manager.broadcast_to_channel(channel, message)


async def notify_training_epoch(
    job_id: str,
    epoch: int,
    total_epochs: int,
    train_metrics: dict[str, float],
    val_metrics: dict[str, float] | None = None,
) -> None:
    """
    Notify subscribers of training epoch completion.

    Args:
        job_id: Job identifier
        epoch: Current epoch number
        total_epochs: Total number of epochs
        train_metrics: Training metrics for this epoch
        val_metrics: Optional validation metrics
    """
    channel = f"job:{job_id}"
    message = WebSocketMessage(
        type=MessageType.TRAINING_EPOCH,
        channel=channel,
        data={
            "job_id": job_id,
            "epoch": epoch,
            "total_epochs": total_epochs,
            "progress": (epoch / total_epochs) * 100,
            "train": train_metrics,
            "val": val_metrics,
        },
    )
    await ws_manager.broadcast_to_channel(channel, message)


async def notify_job_metrics(job_id: str, metrics: dict[str, Any]) -> None:
    """
    Notify subscribers of job metrics update.

    Args:
        job_id: Job identifier
        metrics: Current metrics data
    """
    channel = f"job:{job_id}"
    message = WebSocketMessage(
        type=MessageType.JOB_METRICS,
        channel=channel,
        data={
            "job_id": job_id,
            "metrics": metrics,
        },
    )
    await ws_manager.broadcast_to_channel(channel, message)


async def notify_job_log(job_id: str, log_entry: str, level: str = "info", context: dict[str, Any] | None = None) -> None:
    """
    Notify subscribers of a new log entry.

    Args:
        job_id: Job identifier
        log_entry: Log message
        level: Log level (info, warn, error)
        context: Optional context dict with fold_id, branch_name, variant_index
    """
    channel = f"job:{job_id}"
    message = WebSocketMessage(
        type=MessageType.JOB_PROGRESS,
        channel=channel,
        data={
            "job_id": job_id,
            "log": log_entry,
            "level": level,
            "log_context": context,
        },
    )
    await ws_manager.broadcast_to_channel(channel, message)


# ============================================================================
# Granular Progress Notification Functions
# ============================================================================


async def notify_fold_progress(
    job_id: str,
    current_fold: int,
    total_folds: int,
    status: str = "started",
    metrics: dict[str, float] | None = None,
) -> None:
    """
    Notify subscribers of fold progress.

    Args:
        job_id: Job identifier
        current_fold: Current fold number (1-based)
        total_folds: Total number of folds
        status: "started" or "completed"
        metrics: Metrics for completed fold
    """
    channel = f"job:{job_id}"
    msg_type = MessageType.FOLD_STARTED if status == "started" else MessageType.FOLD_COMPLETED
    message = WebSocketMessage(
        type=msg_type,
        channel=channel,
        data={
            "job_id": job_id,
            "current_fold": current_fold,
            "total_folds": total_folds,
            "metrics": metrics,
        },
    )
    await ws_manager.broadcast_to_channel(channel, message)


async def notify_branch_progress(
    job_id: str,
    branch_path: list,
    branch_name: str,
    status: str = "entered",
) -> None:
    """
    Notify subscribers of branch traversal.

    Args:
        job_id: Job identifier
        branch_path: List of branch indices (e.g., [0, 1])
        branch_name: Human-readable branch name
        status: "entered" or "exited"
    """
    channel = f"job:{job_id}"
    msg_type = MessageType.BRANCH_ENTERED if status == "entered" else MessageType.BRANCH_EXITED
    message = WebSocketMessage(
        type=msg_type,
        channel=channel,
        data={
            "job_id": job_id,
            "branch_path": branch_path,
            "branch_name": branch_name,
        },
    )
    await ws_manager.broadcast_to_channel(channel, message)


async def notify_variant_progress(
    job_id: str,
    current_variant: int,
    total_variants: int,
    variant_description: str,
    status: str = "started",
) -> None:
    """
    Notify subscribers of variant progress.

    Args:
        job_id: Job identifier
        current_variant: Current variant number (1-based)
        total_variants: Total number of variants
        variant_description: Description of variant (e.g., "n_components=10")
        status: "started" or "completed"
    """
    channel = f"job:{job_id}"
    msg_type = MessageType.VARIANT_STARTED if status == "started" else MessageType.VARIANT_COMPLETED
    message = WebSocketMessage(
        type=msg_type,
        channel=channel,
        data={
            "job_id": job_id,
            "current_variant": current_variant,
            "total_variants": total_variants,
            "variant_description": variant_description,
        },
    )
    await ws_manager.broadcast_to_channel(channel, message)


async def notify_step_progress(
    job_id: str,
    current_step: int,
    total_steps: int,
    step_name: str,
    step_type: str,
) -> None:
    """
    Notify subscribers of step-level progress.

    Args:
        job_id: Job identifier
        current_step: Current step number (1-based)
        total_steps: Total number of steps
        step_name: Name of the current step
        step_type: Type of step (preprocessing, model, splitter, etc.)
    """
    channel = f"job:{job_id}"
    message = WebSocketMessage(
        type=MessageType.STEP_PROGRESS,
        channel=channel,
        data={
            "job_id": job_id,
            "current_step": current_step,
            "total_steps": total_steps,
            "step_name": step_name,
            "step_type": step_type,
        },
    )
    await ws_manager.broadcast_to_channel(channel, message)


# ============================================================================
# Refit Phase Notification Functions
# ============================================================================


async def notify_refit_started(
    job_id: str,
    total_steps: int = 0,
    description: str = "",
) -> None:
    """
    Notify subscribers that the refit phase has started.

    The refit phase runs after cross-validation (Pass 1) completes,
    refitting the best model on all training data.

    Args:
        job_id: Job identifier
        total_steps: Total number of refit steps expected
        description: Human-readable description of the refit
    """
    channel = f"job:{job_id}"
    msg = WebSocketMessage(
        type=MessageType.REFIT_STARTED,
        channel=channel,
        data={
            "job_id": job_id,
            "total_steps": total_steps,
            "description": description,
        },
    )
    await ws_manager.broadcast_to_channel(channel, msg)


async def notify_refit_progress(
    job_id: str,
    progress: float,
    message: str = "",
) -> None:
    """
    Notify subscribers of refit phase progress.

    Args:
        job_id: Job identifier
        progress: Progress percentage (0-100)
        message: Progress message
    """
    channel = f"job:{job_id}"
    msg = WebSocketMessage(
        type=MessageType.REFIT_PROGRESS,
        channel=channel,
        data={
            "job_id": job_id,
            "progress": progress,
            "message": message,
        },
    )
    await ws_manager.broadcast_to_channel(channel, msg)


async def notify_refit_step(
    job_id: str,
    current_step: int,
    total_steps: int,
    step_name: str,
    step_type: str = "preprocessing",
) -> None:
    """
    Notify subscribers of a refit sub-step.

    Args:
        job_id: Job identifier
        current_step: Current step number (1-based)
        total_steps: Total number of refit steps
        step_name: Name of the current step (e.g., "Refitting base model 1/3")
        step_type: Type of step: "preprocessing", "model_training", "evaluation", "meta_model"
    """
    channel = f"job:{job_id}"
    msg = WebSocketMessage(
        type=MessageType.REFIT_STEP,
        channel=channel,
        data={
            "job_id": job_id,
            "current_step": current_step,
            "total_steps": total_steps,
            "step_name": step_name,
            "step_type": step_type,
        },
    )
    await ws_manager.broadcast_to_channel(channel, msg)


async def notify_refit_completed(
    job_id: str,
    score: float | None = None,
    metrics: dict[str, Any] | None = None,
) -> None:
    """
    Notify subscribers that the refit phase completed successfully.

    Args:
        job_id: Job identifier
        score: Refit score on training data
        metrics: Additional refit metrics
    """
    channel = f"job:{job_id}"
    msg = WebSocketMessage(
        type=MessageType.REFIT_COMPLETED,
        channel=channel,
        data={
            "job_id": job_id,
            "score": score,
            "metrics": metrics or {},
        },
    )
    await ws_manager.broadcast_to_channel(channel, msg)


async def notify_refit_failed(
    job_id: str,
    error: str,
    traceback: str | None = None,
) -> None:
    """
    Notify subscribers that the refit phase failed.

    Args:
        job_id: Job identifier
        error: Error message
        traceback: Optional error traceback
    """
    channel = f"job:{job_id}"
    msg = WebSocketMessage(
        type=MessageType.REFIT_FAILED,
        channel=channel,
        data={
            "job_id": job_id,
            "error": error,
            "traceback": traceback,
        },
    )
    await ws_manager.broadcast_to_channel(channel, msg)
