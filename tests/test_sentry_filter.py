"""Tests for backend Sentry filtering of benign shutdown events."""

from api.shared.sentry import backend_before_send


def test_backend_before_send_drops_keyboard_interrupt():
    event = {"exception": {"values": [{"type": "KeyboardInterrupt"}]}}

    assert backend_before_send(event, {}) is None


def test_backend_before_send_drops_uvicorn_cancelled_shutdown_event():
    event = {
        "logger": "uvicorn.error",
        "exception": {"values": [{"type": "CancelledError"}]},
        "message": "KeyboardInterrupt ... CancelledError",
    }

    assert backend_before_send(event, {}) is None


def test_backend_before_send_keeps_unrelated_cancelled_error():
    event = {
        "logger": "api.jobs",
        "exception": {"values": [{"type": "CancelledError"}]},
        "message": "background job cancelled",
    }

    assert backend_before_send(event, {}) == event
