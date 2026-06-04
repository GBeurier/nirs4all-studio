"""
Sentry telemetry integration for nirs4all Studio.

Telemetry is opt-in. The SDK only sends events when the user enabled debug data
sharing in app settings and a Sentry DSN is configured in the environment.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Optional

_debug_data_sharing_enabled = False
_sentry_initialized = False
_accepted_event_count = 0


def _read_bool(value: Any) -> bool:
    return value is True or value in {"true", "True", "1", 1}


def _read_sample_rate(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return value if 0 <= value <= 1 else default


def _read_positive_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return value if value >= 0 else default


def _max_events_per_session() -> int:
    return _read_positive_int("SENTRY_MAX_EVENTS_PER_SESSION", 20)


def _can_send_event() -> bool:
    global _accepted_event_count

    if _accepted_event_count >= _max_events_per_session():
        return False
    _accepted_event_count += 1
    return True


def _get_sentry_dsn() -> Optional[str]:
    return os.environ.get("NIRS4ALL_SENTRY_DSN") or os.environ.get("SENTRY_DSN")


def _get_release() -> str:
    return os.environ.get("SENTRY_RELEASE", "nirs4all-studio@1.0.0")


def _get_environment() -> str:
    if os.environ.get("SENTRY_ENVIRONMENT"):
        return os.environ["SENTRY_ENVIRONMENT"]
    if os.environ.get("NIRS4ALL_ENV"):
        return os.environ["NIRS4ALL_ENV"]
    return "production" if os.environ.get("NIRS4ALL_DESKTOP") == "true" else "development"


def _strip_query_string(url: Optional[str]) -> Optional[str]:
    if not url:
        return url
    return url.split("?", 1)[0]


def _scrub_headers(headers: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(headers, dict):
        return None

    scrubbed = {}
    for key, value in headers.items():
        normalized = str(key).lower()
        if any(secret in normalized for secret in ("authorization", "cookie", "token", "key")):
            scrubbed[key] = "[Filtered]"
        else:
            scrubbed[key] = value
    return scrubbed


def _event_text(event: Dict[str, Any]) -> str:
    parts = []

    for key in ("message", "logentry"):
        value = event.get(key)
        if isinstance(value, str):
            parts.append(value)
        elif isinstance(value, dict):
            for nested_key in ("message", "formatted"):
                nested = value.get(nested_key)
                if nested:
                    parts.append(str(nested))

    for exception in event.get("exception", {}).get("values", []) or []:
        if isinstance(exception, dict):
            for key in ("type", "value"):
                value = exception.get(key)
                if value:
                    parts.append(str(value))

    return "\n".join(parts)


def _is_expected_user_error(event: Dict[str, Any]) -> bool:
    text = _event_text(event)
    expected_patterns = (
        "received NaN input",
        "Set na_policy on this step",
        "Invalid hyperparameters for PLSRegression",
        "`n_components` upper bound",
        "Found input variables with inconsistent numbers of samples",
        "Error checking GitHub releases",
        "Error checking PyPI releases",
        "Error checking outdated packages",
        "pip list --outdated",
        "Cancelled by user",
        "pip install timed out after",
        "No matching distribution found",
    )
    return any(pattern in text for pattern in expected_patterns)


def _before_send(event: Dict[str, Any], hint: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    del hint
    if not _debug_data_sharing_enabled:
        return None
    if _is_expected_user_error(event):
        return None
    if not _can_send_event():
        return None

    event.pop("user", None)
    request = event.get("request")
    if isinstance(request, dict):
        request["url"] = _strip_query_string(request.get("url"))
        headers = _scrub_headers(request.get("headers"))
        if headers is not None:
            request["headers"] = headers
        request.pop("cookies", None)
        request.pop("data", None)
        request.pop("query_string", None)

    tags = event.setdefault("tags", {})
    tags["debug_data_sharing"] = "enabled"
    tags["app_surface"] = "backend"
    return event


def _read_consent_from_settings() -> bool:
    try:
        from api.app_config import app_config

        settings = app_config.get_app_settings()
        return bool(
            settings.get("ui_preferences", {}).get("debug_data_sharing_enabled", False)
        )
    except Exception:
        return False


def initialize_sentry(debug_data_sharing_enabled: Optional[bool] = None) -> bool:
    """Initialize Sentry if consent and DSN are both available."""
    global _debug_data_sharing_enabled, _sentry_initialized

    if debug_data_sharing_enabled is None:
        debug_data_sharing_enabled = _read_consent_from_settings()

    _debug_data_sharing_enabled = bool(debug_data_sharing_enabled)
    if _sentry_initialized:
        return True
    if not _debug_data_sharing_enabled:
        return False

    dsn = _get_sentry_dsn()
    if not dsn:
        return False

    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration

    sentry_sdk.init(
        dsn=dsn,
        integrations=[
            FastApiIntegration(),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
        release=_get_release(),
        environment=_get_environment(),
        send_default_pii=False,
        send_client_reports=False,
        max_breadcrumbs=30,
        traces_sample_rate=_read_sample_rate("SENTRY_TRACES_SAMPLE_RATE", 0),
        profiles_sample_rate=_read_sample_rate("SENTRY_PROFILES_SAMPLE_RATE", 0),
        before_send=_before_send,
    )

    sentry_sdk.set_tag("debug_data_sharing", "enabled")
    sentry_sdk.set_tag("app_surface", "backend")
    _sentry_initialized = True
    return True


def set_debug_data_sharing_enabled(enabled: bool) -> None:
    """Apply a consent change at runtime."""
    global _debug_data_sharing_enabled

    _debug_data_sharing_enabled = bool(enabled)
    if enabled:
        initialize_sentry(enabled)


def apply_consent_from_app_settings(settings: Dict[str, Any]) -> None:
    """Apply consent from the persisted app settings payload."""
    enabled = bool(
        settings.get("ui_preferences", {}).get("debug_data_sharing_enabled", False)
    )
    set_debug_data_sharing_enabled(enabled)


def capture_exception(exc: BaseException, tags: Optional[Dict[str, Any]] = None) -> None:
    """Capture an exception when telemetry is active."""
    if not _debug_data_sharing_enabled:
        return
    if not initialize_sentry(True):
        return

    import sentry_sdk

    with sentry_sdk.push_scope() as scope:
        for key, value in (tags or {}).items():
            if value is not None:
                scope.set_tag(key, str(value))
        sentry_sdk.capture_exception(exc)
