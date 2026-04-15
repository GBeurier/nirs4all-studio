"""
Network state detection for offline-first startup.

Resolves whether the app should attempt outbound network calls, based on:
1. ``NIRS4ALL_OFFLINE`` env var (propagated from Electron)
2. ``offline_mode`` field in update_settings.yaml ("auto" | "on" | "off")
3. Short probe against a well-known host, cached for 60 s

The single source of truth is ``is_online()``. Downstream code should never
attempt a "nice to have" outbound fetch without gating on it.
"""

from __future__ import annotations

import os
from typing import Literal

from fastapi import APIRouter

from .shared.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/system", tags=["system"])

OfflineMode = Literal["auto", "on", "off"]


def _env_forces_offline() -> bool:
    """Return True if NIRS4ALL_OFFLINE env var forces offline mode."""
    value = os.environ.get("NIRS4ALL_OFFLINE", "").strip().lower()
    return value in ("1", "true", "yes", "on")


def _settings_offline_mode() -> OfflineMode:
    """Read offline_mode from UpdateSettings. Default 'auto' on any failure."""
    try:
        from .updates import update_manager
        mode = getattr(update_manager.settings, "offline_mode", "auto")
        if mode in ("auto", "on", "off"):
            return mode  # type: ignore[return-value]
    except Exception as e:
        logger.debug("Could not read offline_mode setting: %s", e)
    return "auto"


async def is_online() -> bool:
    """True when network calls should be attempted.

    Only returns False when offline is explicitly forced (env var or user setting).
    We intentionally do NOT use a network probe as the default: HEAD probes to
    public hosts are blocked on many corporate networks even when the user has
    full internet access, which caused false "offline" badges. Timeouts are
    short (3 s) and callers handle failure gracefully, so an occasional failed
    fetch when actually offline is cheaper than a misleading offline state.
    """
    if _env_forces_offline():
        return False
    if _settings_offline_mode() == "on":
        return False
    return True


def is_offline_sync() -> bool:
    """Synchronous quick-check (no probe). Returns True only when *forced* offline.

    Use this from sync code that needs a zero-latency decision. It cannot
    distinguish "network down" from "online" without the probe, so prefer
    ``is_online()`` when an await is possible.
    """
    if _env_forces_offline():
        return True
    if _settings_offline_mode() == "on":
        return True
    return False


class OfflineError(RuntimeError):
    """Raised when a network call is skipped because the app is offline."""


@router.get("/network")
async def get_network_state() -> dict[str, object]:
    """Report whether the app is forced offline.

    This is NOT a real-world connectivity check — the frontend combines this
    with ``navigator.onLine`` for display. Backend only reports user/env overrides.
    """
    env_forced = _env_forces_offline()
    mode = _settings_offline_mode()
    forced_offline = env_forced or mode == "on"
    return {
        "online": not forced_offline,
        "forced": forced_offline,
        "mode": mode,
        "env_forced": env_forced,
    }
