"""Helpers for filtering benign backend Sentry events."""

from __future__ import annotations

import asyncio
from typing import Any


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

    return event
