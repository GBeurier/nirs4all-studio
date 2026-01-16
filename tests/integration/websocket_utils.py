"""
WebSocket testing utilities for nirs4all webapp integration tests.

Provides helpers for:
- Connecting to WebSocket endpoints
- Subscribing to job channels
- Collecting and asserting message sequences
- Timeout handling
"""

import json
import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from starlette.testclient import TestClient


@dataclass
class WebSocketTestSession:
    """
    Managed WebSocket test session with message collection.

    Usage:
        with WebSocketTestSession(client, f"/ws/job/{run_id}") as session:
            # Trigger some action that generates WS messages
            session.wait_for_message_type("job_completed", timeout=30)
            messages = session.messages
    """

    client: TestClient
    endpoint: str
    messages: List[Dict[str, Any]] = field(default_factory=list)
    _ws: Any = None
    _collector_thread: Optional[threading.Thread] = None
    _stop_event: threading.Event = field(default_factory=threading.Event)
    _message_queue: queue.Queue = field(default_factory=queue.Queue)

    def __enter__(self):
        """Connect to WebSocket and start message collection."""
        self._ws = self.client.websocket_connect(self.endpoint)
        self._ws.__enter__()

        # Start collector thread
        self._stop_event.clear()
        self._collector_thread = threading.Thread(
            target=self._collect_messages,
            daemon=True,
        )
        self._collector_thread.start()

        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Stop collection and disconnect."""
        self._stop_event.set()

        if self._collector_thread:
            self._collector_thread.join(timeout=2.0)

        if self._ws:
            try:
                self._ws.__exit__(exc_type, exc_val, exc_tb)
            except Exception:
                pass

    def _collect_messages(self):
        """Background thread to collect messages."""
        while not self._stop_event.is_set():
            try:
                # Short timeout to check stop event frequently
                data = self._ws.receive_json()
                self.messages.append(data)
                self._message_queue.put(data)
            except Exception:
                # Connection closed or timeout
                if not self._stop_event.is_set():
                    time.sleep(0.1)

    def wait_for_message_type(
        self,
        msg_type: str,
        timeout: float = 30.0,
    ) -> Optional[Dict[str, Any]]:
        """
        Wait for a specific message type.

        Args:
            msg_type: The message type to wait for
            timeout: Maximum time to wait in seconds

        Returns:
            The message dict if found, None if timeout
        """
        start = time.time()

        # First check already collected messages
        for msg in self.messages:
            if msg.get("type") == msg_type:
                return msg

        # Wait for new messages
        while time.time() - start < timeout:
            try:
                remaining = timeout - (time.time() - start)
                msg = self._message_queue.get(timeout=min(remaining, 1.0))
                if msg.get("type") == msg_type:
                    return msg
            except queue.Empty:
                continue

        return None

    def wait_for_completion(
        self,
        timeout: float = 60.0,
    ) -> str:
        """
        Wait for job to complete or fail.

        Returns:
            "completed", "failed", or "timeout"
        """
        msg = self.wait_for_message_type("job_completed", timeout=timeout / 2)
        if msg:
            return "completed"

        msg = self.wait_for_message_type("job_failed", timeout=timeout / 2)
        if msg:
            return "failed"

        return "timeout"

    def get_messages_by_type(self, msg_type: str) -> List[Dict[str, Any]]:
        """Get all messages of a specific type."""
        return [m for m in self.messages if m.get("type") == msg_type]

    def get_progress_sequence(self) -> List[float]:
        """Extract progress values from progress messages."""
        progress_msgs = self.get_messages_by_type("job_progress")
        return [
            m.get("data", {}).get("progress", 0)
            for m in progress_msgs
            if "progress" in m.get("data", {})
        ]

    def get_final_metrics(self) -> Optional[Dict[str, Any]]:
        """Get metrics from the completion message."""
        completed_msgs = self.get_messages_by_type("job_completed")
        if completed_msgs:
            return completed_msgs[-1].get("data", {}).get("result", {})
        return None

    def send_ping(self):
        """Send a ping message to keep connection alive."""
        self._ws.send_json({"type": "ping"})

    def subscribe(self, channel: str):
        """Subscribe to an additional channel."""
        self._ws.send_json({"type": "subscribe", "channel": channel})


def assert_message_sequence(
    messages: List[Dict[str, Any]],
    expected_sequence: List[str],
    strict: bool = False,
) -> bool:
    """
    Assert that message types appear in expected order.

    Args:
        messages: List of message dicts
        expected_sequence: List of expected message types in order
        strict: If True, require exact match; if False, allow extra messages

    Returns:
        True if sequence matches

    Raises:
        AssertionError with details if sequence doesn't match
    """
    actual_types = [m.get("type") for m in messages]

    if strict:
        # Exact match
        if actual_types != expected_sequence:
            raise AssertionError(
                f"Message sequence mismatch.\n"
                f"Expected: {expected_sequence}\n"
                f"Actual:   {actual_types}"
            )
        return True

    # Subsequence match - expected types should appear in order
    idx = 0
    for expected_type in expected_sequence:
        found = False
        while idx < len(actual_types):
            if actual_types[idx] == expected_type:
                found = True
                idx += 1
                break
            idx += 1

        if not found:
            raise AssertionError(
                f"Expected message type '{expected_type}' not found in sequence.\n"
                f"Expected sequence: {expected_sequence}\n"
                f"Actual types: {actual_types}"
            )

    return True


def assert_progress_increases(progress_values: List[float]) -> bool:
    """
    Assert that progress values generally increase.

    Allows for some variance but overall trend should be upward.
    """
    if len(progress_values) < 2:
        return True

    # Check that last value is greater than first
    if progress_values[-1] <= progress_values[0]:
        raise AssertionError(
            f"Progress did not increase.\n"
            f"First: {progress_values[0]}, Last: {progress_values[-1]}\n"
            f"All values: {progress_values}"
        )

    return True


def assert_metrics_present(
    result: Dict[str, Any],
    expected_keys: List[str] = None,
) -> bool:
    """
    Assert that expected metrics are present in result.

    Args:
        result: Result dict from job completion
        expected_keys: List of expected metric keys (default: ["r2", "rmse"])

    Returns:
        True if all expected keys are present

    Raises:
        AssertionError if keys are missing
    """
    if expected_keys is None:
        expected_keys = ["r2", "rmse"]

    metrics = result.get("metrics", result)  # Handle nested or flat structure

    missing = [k for k in expected_keys if k not in metrics]
    if missing:
        raise AssertionError(
            f"Missing expected metrics: {missing}\n"
            f"Present metrics: {list(metrics.keys())}"
        )

    return True


class RunProgressTracker:
    """
    Track run progress through WebSocket and HTTP polling.

    Combines WebSocket real-time updates with HTTP polling fallback.
    """

    def __init__(
        self,
        client: TestClient,
        run_id: str,
        ws_endpoint: Optional[str] = None,
    ):
        self.client = client
        self.run_id = run_id
        self.ws_endpoint = ws_endpoint or f"/ws/job/{run_id}"
        self.progress_history: List[float] = []
        self.status_history: List[str] = []
        self.final_result: Optional[Dict[str, Any]] = None

    def poll_until_complete(
        self,
        timeout: float = 60.0,
        poll_interval: float = 1.0,
    ) -> str:
        """
        Poll run status until completion.

        Returns:
            Final status: "completed", "failed", or "timeout"
        """
        start = time.time()

        while time.time() - start < timeout:
            response = self.client.get(f"/api/runs/{self.run_id}")

            if response.status_code == 200:
                data = response.json()
                status = data.get("status")
                self.status_history.append(status)

                if status in ("completed", "failed"):
                    self.final_result = data
                    return status

            time.sleep(poll_interval)

        return "timeout"

    def get_run_details(self) -> Optional[Dict[str, Any]]:
        """Get current run details via HTTP."""
        response = self.client.get(f"/api/runs/{self.run_id}")
        if response.status_code == 200:
            return response.json()
        return None
