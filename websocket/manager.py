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
from enum import Enum
from typing import Any, Dict, Optional, Set

from fastapi import WebSocket


class MessageType(str, Enum):
    """Types of WebSocket messages."""

    # Job-related messages
    JOB_STARTED = "job_started"
    JOB_PROGRESS = "job_progress"
    JOB_COMPLETED = "job_completed"
    JOB_FAILED = "job_failed"
    JOB_CANCELLED = "job_cancelled"
    JOB_METRICS = "job_metrics"

    # Training-specific messages
    TRAINING_EPOCH = "training_epoch"
    TRAINING_BATCH = "training_batch"
    TRAINING_CHECKPOINT = "training_checkpoint"

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
    data: Dict[str, Any] = field(default_factory=dict)
    timestamp: Optional[str] = None

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
        self._connections: Set[WebSocket] = set()

        # Channel subscriptions: channel -> set of WebSockets
        self._channels: Dict[str, Set[WebSocket]] = {}

        # Connection metadata: WebSocket -> subscription info
        self._connection_info: Dict[WebSocket, Dict[str, Any]] = {}

        # Lock for thread-safe operations
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, client_id: Optional[str] = None) -> None:
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
            print(f"Error sending WebSocket message: {e}")
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
    ) -> Optional[WebSocketMessage]:
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


async def notify_job_started(job_id: str, job_data: Dict[str, Any]) -> None:
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
    metrics: Optional[Dict[str, Any]] = None,
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


async def notify_job_completed(job_id: str, result: Dict[str, Any]) -> None:
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


async def notify_job_failed(job_id: str, error: str, traceback: Optional[str] = None) -> None:
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


async def notify_training_epoch(
    job_id: str,
    epoch: int,
    total_epochs: int,
    train_metrics: Dict[str, float],
    val_metrics: Optional[Dict[str, float]] = None,
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


async def notify_job_metrics(job_id: str, metrics: Dict[str, Any]) -> None:
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
