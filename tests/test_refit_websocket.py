"""
Tests for refit phase WebSocket events.

Tests:
- REFIT_* message types are defined in MessageType enum
- Refit notification helper functions create correct messages
- Refit event emission functions in training.py work correctly

Run tests:
    pytest tests/test_refit_websocket.py -v
"""

import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

# Ensure the webapp root is in the path
webapp_root = Path(__file__).parent.parent
if str(webapp_root) not in sys.path:
    sys.path.insert(0, str(webapp_root))

from websocket.manager import (
    MessageType,
    WebSocketMessage,
    notify_refit_completed,
    notify_refit_failed,
    notify_refit_progress,
    notify_refit_started,
    notify_refit_step,
)

# ============================================================================
# MessageType Enum Tests
# ============================================================================


class TestRefitMessageTypes:
    """Test that REFIT_* message types are properly defined."""

    def test_refit_started_exists(self):
        assert MessageType.REFIT_STARTED == "refit_started"

    def test_refit_progress_exists(self):
        assert MessageType.REFIT_PROGRESS == "refit_progress"

    def test_refit_step_exists(self):
        assert MessageType.REFIT_STEP == "refit_step"

    def test_refit_completed_exists(self):
        assert MessageType.REFIT_COMPLETED == "refit_completed"

    def test_refit_failed_exists(self):
        assert MessageType.REFIT_FAILED == "refit_failed"

    def test_refit_types_are_string_enum(self):
        """Verify refit types can be used as strings."""
        assert isinstance(MessageType.REFIT_STARTED.value, str)
        assert isinstance(MessageType.REFIT_COMPLETED.value, str)


# ============================================================================
# WebSocket Message Serialization Tests
# ============================================================================


class TestRefitMessageSerialization:
    """Test that refit messages serialize and deserialize correctly."""

    def test_refit_started_message_to_json(self):
        msg = WebSocketMessage(
            type=MessageType.REFIT_STARTED,
            channel="job:test123",
            data={
                "job_id": "test123",
                "total_steps": 3,
                "description": "Refitting best model...",
            },
        )
        parsed = json.loads(msg.to_json())
        assert parsed["type"] == "refit_started"
        assert parsed["channel"] == "job:test123"
        assert parsed["data"]["job_id"] == "test123"
        assert parsed["data"]["total_steps"] == 3
        assert parsed["data"]["description"] == "Refitting best model..."
        assert "timestamp" in parsed

    def test_refit_step_message_to_json(self):
        msg = WebSocketMessage(
            type=MessageType.REFIT_STEP,
            channel="job:test123",
            data={
                "job_id": "test123",
                "current_step": 2,
                "total_steps": 3,
                "step_name": "Model training",
                "step_type": "model_training",
            },
        )
        parsed = json.loads(msg.to_json())
        assert parsed["type"] == "refit_step"
        assert parsed["data"]["current_step"] == 2
        assert parsed["data"]["step_name"] == "Model training"
        assert parsed["data"]["step_type"] == "model_training"

    def test_refit_completed_message_to_json(self):
        msg = WebSocketMessage(
            type=MessageType.REFIT_COMPLETED,
            channel="job:test123",
            data={
                "job_id": "test123",
                "score": 0.95,
                "metrics": {"rmse": 0.12, "r2": 0.95},
            },
        )
        parsed = json.loads(msg.to_json())
        assert parsed["type"] == "refit_completed"
        assert parsed["data"]["score"] == 0.95
        assert parsed["data"]["metrics"]["rmse"] == 0.12

    def test_refit_failed_message_to_json(self):
        msg = WebSocketMessage(
            type=MessageType.REFIT_FAILED,
            channel="job:test123",
            data={
                "job_id": "test123",
                "error": "Out of memory",
                "traceback": "...",
            },
        )
        parsed = json.loads(msg.to_json())
        assert parsed["type"] == "refit_failed"
        assert parsed["data"]["error"] == "Out of memory"

    def test_refit_message_from_json(self):
        json_str = json.dumps({
            "type": "refit_started",
            "channel": "job:abc",
            "data": {"job_id": "abc", "total_steps": 3},
            "timestamp": "2026-01-01T00:00:00",
        })
        msg = WebSocketMessage.from_json(json_str)
        assert msg.type == MessageType.REFIT_STARTED
        assert msg.channel == "job:abc"
        assert msg.data["total_steps"] == 3


# ============================================================================
# Notification Helper Tests
# ============================================================================


class TestRefitNotificationHelpers:
    """Test refit notification helper functions."""

    def test_notify_refit_started(self):
        with patch("websocket.manager.ws_manager") as mock_manager:
            mock_manager.broadcast_to_channel = AsyncMock(return_value=1)
            asyncio.run(notify_refit_started("job123", total_steps=3, description="Refitting..."))

            mock_manager.broadcast_to_channel.assert_called_once()
            call_args = mock_manager.broadcast_to_channel.call_args
            channel = call_args[0][0]
            message = call_args[0][1]

            assert channel == "job:job123"
            assert message.type == MessageType.REFIT_STARTED
            assert message.data["job_id"] == "job123"
            assert message.data["total_steps"] == 3
            assert message.data["description"] == "Refitting..."

    def test_notify_refit_progress(self):
        with patch("websocket.manager.ws_manager") as mock_manager:
            mock_manager.broadcast_to_channel = AsyncMock(return_value=1)
            asyncio.run(notify_refit_progress("job123", progress=66.0, message="Training final model..."))

            call_args = mock_manager.broadcast_to_channel.call_args
            message = call_args[0][1]

            assert message.type == MessageType.REFIT_PROGRESS
            assert message.data["progress"] == 66.0
            assert message.data["message"] == "Training final model..."

    def test_notify_refit_step(self):
        with patch("websocket.manager.ws_manager") as mock_manager:
            mock_manager.broadcast_to_channel = AsyncMock(return_value=1)
            asyncio.run(notify_refit_step(
                "job123",
                current_step=2,
                total_steps=3,
                step_name="Refitting base model 1/3",
                step_type="model_training",
            ))

            call_args = mock_manager.broadcast_to_channel.call_args
            message = call_args[0][1]

            assert message.type == MessageType.REFIT_STEP
            assert message.data["current_step"] == 2
            assert message.data["total_steps"] == 3
            assert message.data["step_name"] == "Refitting base model 1/3"
            assert message.data["step_type"] == "model_training"

    def test_notify_refit_completed(self):
        with patch("websocket.manager.ws_manager") as mock_manager:
            mock_manager.broadcast_to_channel = AsyncMock(return_value=1)
            metrics = {"rmse": 0.12, "r2": 0.95}
            asyncio.run(notify_refit_completed("job123", score=0.95, metrics=metrics))

            call_args = mock_manager.broadcast_to_channel.call_args
            message = call_args[0][1]

            assert message.type == MessageType.REFIT_COMPLETED
            assert message.data["score"] == 0.95
            assert message.data["metrics"] == metrics

    def test_notify_refit_completed_no_metrics(self):
        with patch("websocket.manager.ws_manager") as mock_manager:
            mock_manager.broadcast_to_channel = AsyncMock(return_value=1)
            asyncio.run(notify_refit_completed("job123"))

            call_args = mock_manager.broadcast_to_channel.call_args
            message = call_args[0][1]

            assert message.data["score"] is None
            assert message.data["metrics"] == {}

    def test_notify_refit_failed(self):
        with patch("websocket.manager.ws_manager") as mock_manager:
            mock_manager.broadcast_to_channel = AsyncMock(return_value=1)
            asyncio.run(notify_refit_failed("job123", error="Model error", traceback="..."))

            call_args = mock_manager.broadcast_to_channel.call_args
            message = call_args[0][1]

            assert message.type == MessageType.REFIT_FAILED
            assert message.data["error"] == "Model error"
            assert message.data["traceback"] == "..."

    def test_notify_refit_failed_no_traceback(self):
        with patch("websocket.manager.ws_manager") as mock_manager:
            mock_manager.broadcast_to_channel = AsyncMock(return_value=1)
            asyncio.run(notify_refit_failed("job123", error="Error"))

            call_args = mock_manager.broadcast_to_channel.call_args
            message = call_args[0][1]

            assert message.data["traceback"] is None


# ============================================================================
# Training Module Refit Emission Tests
# ============================================================================


class TestTrainingRefitEmission:
    """Test that training.py refit emission helpers work correctly."""

    def test_send_refit_started(self):
        from api.training import _send_refit_started

        with patch("api.training._dispatch_refit_notification") as mock_dispatch:
            _send_refit_started("job123", total_steps=3, description="Refitting...")
            mock_dispatch.assert_called_once()

    def test_send_refit_step(self):
        from api.training import _send_refit_step

        with patch("api.training._dispatch_refit_notification") as mock_dispatch:
            _send_refit_step("job123", 1, 3, "Preprocessing", "preprocessing")
            mock_dispatch.assert_called_once()

    def test_send_refit_progress(self):
        from api.training import _send_refit_progress

        with patch("api.training._dispatch_refit_notification") as mock_dispatch:
            _send_refit_progress("job123", 50.0, "Training...")
            mock_dispatch.assert_called_once()

    def test_send_refit_completed(self):
        from api.training import _send_refit_completed

        with patch("api.training._dispatch_refit_notification") as mock_dispatch:
            _send_refit_completed("job123", score=0.95, metrics={"r2": 0.95})
            mock_dispatch.assert_called_once()

    def test_send_refit_failed(self):
        from api.training import _send_refit_failed

        with patch("api.training._dispatch_refit_notification") as mock_dispatch:
            _send_refit_failed("job123", "Error", "traceback...")
            mock_dispatch.assert_called_once()

    def test_send_refit_started_handles_import_error(self):
        """Verify graceful handling when websocket module is unavailable."""
        from api.training import _send_refit_started

        with patch("api.training._dispatch_refit_notification", side_effect=ImportError):
            # Should not raise
            _send_refit_started("job123")


# ============================================================================
# Module Export Tests
# ============================================================================


class TestWebSocketModuleExports:
    """Test that websocket __init__.py exports refit helpers."""

    def test_refit_started_exported(self):
        from websocket import notify_refit_started
        assert callable(notify_refit_started)

    def test_refit_progress_exported(self):
        from websocket import notify_refit_progress
        assert callable(notify_refit_progress)

    def test_refit_step_exported(self):
        from websocket import notify_refit_step
        assert callable(notify_refit_step)

    def test_refit_completed_exported(self):
        from websocket import notify_refit_completed
        assert callable(notify_refit_completed)

    def test_refit_failed_exported(self):
        from websocket import notify_refit_failed
        assert callable(notify_refit_failed)
