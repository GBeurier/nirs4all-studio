"""Neutral runtime error envelope (``RtError``) for explicit unsupported semantics.

Studio's execution-backend routes historically signalled an unavailable or
unsupported backend with ad-hoc shapes: a free-form ``metadata.reason`` string on
the driver capability and a bare :class:`RuntimeError` on submission. This module
introduces the neutral ``RtError`` envelope that ``RT_spec.md`` (§RT-003) and
``SW8_RT_STUDIO_IMPL_spec.md`` (§5) define for the runtime surface, so the same
explicit shape can be carried across REST today and the WASM/CLI runtimes later
(blocker ``B-018``).

The envelope is a thin wrapper — it adds no new vocabulary. The ``cause`` set is
owned by ``CAP-004`` and the portability levels by ``CAP-002``; this module only
*carries* them. It is dependency-free (pure Pydantic + stdlib) so it imports
during Phase-1 startup without ``nirs4all`` and stays inside the Studio
orchestration boundary.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel

# CAP-004 cause vocabulary (carried, not defined here). See RT_spec.md §RT-003.
RtErrorCause = Literal[
    "unsupported_shape",
    "unsupported_capability",
    "unavailable_backend",
    "invalid_request",
    "runtime_error",
]

# Driver-capability ``metadata.reason`` -> neutral ``RtError.cause``.
# Maps the existing wire reason strings onto the shared cause vocabulary without
# changing the reason strings themselves (the capability wire shape is frozen).
_DRIVER_REASON_TO_CAUSE: dict[str, RtErrorCause] = {
    "driver_unavailable": "unavailable_backend",
}


class RtError(BaseModel):
    """Explicit runtime error / unsupported envelope (``RT_spec`` §RT-003).

    Attributes:
        verb: The runtime verb that failed (e.g. ``"run"``).
        cause: CAP-004 cause for the failure.
        message: Human-readable description, reused verbatim from existing signals.
        mitigation: Concrete next step the caller can take, when one is known.
        unsupported_capability: CAP-004 capability id, when the cause is a
            specific unsupported capability.
        portable_level: CAP-002 portability level, when relevant.
    """

    verb: str
    cause: RtErrorCause
    message: str
    mitigation: str | None = None
    unsupported_capability: str | None = None
    portable_level: str | None = None

    def to_envelope(self) -> dict[str, Any]:
        """Return a compact JSON envelope, omitting unset optional fields."""
        return self.model_dump(exclude_none=True)


class RtUnsupportedError(RuntimeError):
    """``RuntimeError`` carrying a structured :class:`RtError`.

    Subclasses ``RuntimeError`` so existing ``except RuntimeError`` handlers and
    ``pytest.raises(RuntimeError, ...)`` contracts keep working unchanged, while
    callers that understand the runtime envelope can read :attr:`rt_error`.
    """

    def __init__(self, rt_error: RtError) -> None:
        super().__init__(rt_error.message)
        self.rt_error = rt_error


def rt_error_from_execution_metadata(
    *,
    verb: str,
    backend: str,
    available: bool,
    metadata: Mapping[str, Any] | None,
) -> RtError | None:
    """Classify an execution-driver capability into a neutral :class:`RtError`.

    Returns ``None`` for an available backend (there is no error to report). For an
    unavailable backend it maps the driver ``metadata.reason`` onto the CAP-004
    cause vocabulary, surfaces the existing human ``metadata.message`` verbatim
    (falling back to the same phrasing the drivers already use), and attaches a
    concrete mitigation.

    Args:
        verb: The runtime verb being attempted (e.g. ``"run"``).
        backend: Execution backend id (e.g. ``"cluster"``).
        available: Whether the backend can currently run jobs.
        metadata: The capability ``metadata`` mapping, if any.

    Returns:
        An :class:`RtError` for an unavailable backend, otherwise ``None``.
    """
    if available:
        return None

    meta: Mapping[str, Any] = metadata or {}
    reason = meta.get("reason")
    cause: RtErrorCause = (
        _DRIVER_REASON_TO_CAUSE.get(reason, "unavailable_backend")
        if isinstance(reason, str)
        else "unavailable_backend"
    )

    message = meta.get("message")
    if not isinstance(message, str) or not message.strip():
        message = f"Execution backend {backend!r} is typed but no execution driver is configured."

    return RtError(
        verb=verb,
        cause=cause,
        message=message,
        mitigation="Run on an available execution backend, or configure a driver for this backend.",
    )
