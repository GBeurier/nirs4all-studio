"""Helpers for filtering benign backend Sentry events."""

from __future__ import annotations

import asyncio
from typing import Any

_SENSITIVE_KEY_PARTS = (
    "dataset",
    "spectra",
    "spectrum",
    "prediction",
    "model",
    "workspace",
    "file",
    "path",
)


def _exception_types(event: dict[str, Any]) -> set[str]:
    values = (event.get("exception") or {}).get("values") or []
    return {
        value.get("type")
        for value in values
        if isinstance(value, dict) and value.get("type")
    }


def _event_message(event: dict[str, Any]) -> str:
    logentry = event.get("logentry") or {}
    if isinstance(logentry, dict):
        formatted = logentry.get("formatted")
        if isinstance(formatted, str):
            return formatted
    message = event.get("message")
    return message if isinstance(message, str) else ""


def is_benign_shutdown_event(event: dict[str, Any]) -> bool:
    """Return True for normal Uvicorn shutdown events."""
    exception_types = _exception_types(event)
    if "KeyboardInterrupt" in exception_types:
        return True
    if "CancelledError" in exception_types and event.get("logger") == "uvicorn.error":
        return True

    message = _event_message(event)
    return "KeyboardInterrupt" in message and "CancelledError" in message


def is_benign_job_notification_shutdown_event(event: dict[str, Any]) -> bool:
    """Return True for pending job WebSocket notifications during shutdown."""
    if event.get("logger") != "asyncio":
        return False

    message = _event_message(event)
    return (
        "Task was destroyed but it is pending!" in message
        and "JobManager._dispatch_websocket_notification" in message
        and "send_notification" in message
    )


def _strip_url_query(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    return value.split("?", 1)[0].split("#", 1)[0]


def _redact_sensitive_event_data(event: dict[str, Any]) -> None:
    """Remove request/user details and obvious analysis data before upload."""
    event.pop("user", None)

    request = event.get("request")
    if isinstance(request, dict):
        for key in ("cookies", "headers", "data", "query_string", "env"):
            request.pop(key, None)
        if "url" in request:
            request["url"] = _strip_url_query(request["url"])

    for container_key in ("extra", "contexts"):
        container = event.get(container_key)
        if not isinstance(container, dict):
            continue
        for key in list(container):
            lowered = key.lower()
            if any(part in lowered for part in _SENSITIVE_KEY_PARTS):
                container[key] = "[Filtered]"


def backend_before_send(
    event: dict[str, Any],
    hint: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Drop benign shutdown events before they reach Sentry."""
    hint = hint or {}
    exc_info = hint.get("exc_info")
    if exc_info:
        exc = exc_info[1]
        if isinstance(exc, KeyboardInterrupt):
            return None
        if isinstance(exc, asyncio.CancelledError) and is_benign_shutdown_event(event):
            return None

    if is_benign_shutdown_event(event):
        return None
    if is_benign_job_notification_shutdown_event(event):
        return None

    _redact_sensitive_event_data(event)
    return event
