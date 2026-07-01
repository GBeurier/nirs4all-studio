"""Runtime ML-engine resolution + outcome recording for Studio run routing.

Studio launches training through :func:`nirs4all.run` but historically never
*selected* or *recorded* which ML engine produced a result. This module threads
the engine selector (``legacy`` | ``dag-ml``) into the run call and records the
engine that **actually ran** — including nirs4all's transparent
``dag-ml`` → ``legacy`` fallback — plus any structured :class:`RtError`
diagnostics, so the run read models can show "ran ``<engine>`` (because
``<cause>``)". Blockers ``B-017`` (V1) / ``B-018``; see
``SW8_RT_STUDIO_IMPL_spec.md`` §4.A.

``engine`` is the **ML engine** and is orthogonal to ``execution_backend`` (the
environment: ``local-python`` | ``cluster`` | ``wasm-local``); the two are never
overloaded onto one another.

The module is dependency-light and import-safe without ``nirs4all`` (Phase-1),
and is forward-compatible with W7's ``RunResult.to_rt_result()`` envelope: when
that accessor exists, the engine + diagnostics come straight from the structured
envelope; until then they are derived from the library's fallback warning.
"""

from __future__ import annotations

import warnings
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

from .runtime_errors import RtError, RtErrorCause

_LEGACY = "legacy"

# nirs4all emits a transparent-fallback warning (run.py:413-421) carrying this
# stable fragment. Classify the two known shapes onto the CAP-004 cause vocab.
_FALLBACK_FRAGMENT = "falling back to the legacy engine"
_FALLBACK_CAUSE_SIGNATURES: tuple[tuple[str, RtErrorCause], ...] = (
    ("is not available", "unavailable_backend"),
    ("does not support this pipeline shape", "unsupported_shape"),
)
_DEFAULT_FALLBACK_CAUSE: RtErrorCause = "runtime_error"
_FALLBACK_MITIGATION = (
    "Run on engine='legacy', or adjust the pipeline so the dag-ml engine supports it."
)


def resolve_engine(requested: str | None) -> str:
    """Resolve a requested engine to the engine nirs4all would select.

    Delegates to nirs4all's own resolver so Studio never re-defines the default
    (``None`` → ``"legacy"``). Degrades to the same default when the library is
    not importable (Phase-1 / library absent), so the orchestration layer keeps
    working without ``nirs4all``.

    Args:
        requested: The engine the caller asked for, or ``None`` for the default.

    Returns:
        The resolved engine id (e.g. ``"legacy"`` or ``"dag-ml"``).
    """
    try:
        from nirs4all.api.run import resolve_engine as _lib_resolve
    except Exception:
        if isinstance(requested, str) and requested.strip():
            return requested
        return _LEGACY
    return _lib_resolve(requested)


def engine_run_kwargs(requested: str | None) -> dict[str, str]:
    """Return the ``engine`` kwarg for :func:`nirs4all.run`, when one is requested.

    Returns an empty dict for ``None``/blank so the library's own default applies
    unchanged — behaviour-preserving for runs that do not select an engine.

    Args:
        requested: The requested engine id, or ``None``.

    Returns:
        ``{"engine": requested}`` when a non-blank engine was requested, else ``{}``.
    """
    if isinstance(requested, str) and requested.strip():
        return {"engine": requested}
    return {}


def _cause_for_warning(message: str) -> RtErrorCause:
    """Classify a fallback warning message onto the CAP-004 cause vocabulary."""
    for fragment, cause in _FALLBACK_CAUSE_SIGNATURES:
        if fragment in message:
            return cause
    return _DEFAULT_FALLBACK_CAUSE


def _diagnostics_to_envelopes(diagnostics: Any) -> list[dict[str, Any]]:
    """Normalise a sequence of diagnostic objects to JSON envelopes."""
    envelopes: list[dict[str, Any]] = []
    for diagnostic in diagnostics or []:
        if hasattr(diagnostic, "to_envelope"):
            envelopes.append(diagnostic.to_envelope())
        elif hasattr(diagnostic, "to_dict"):
            envelopes.append(diagnostic.to_dict())
        elif isinstance(diagnostic, dict):
            envelopes.append(diagnostic)
        else:
            envelopes.append({"message": str(diagnostic)})
    return envelopes


def _runtime_field(value: Any, key: str) -> Any:
    """Read a field from a runtime envelope shaped as JSON or an object."""
    if isinstance(value, Mapping):
        return value.get(key)
    return getattr(value, key, None)


def _rt_result_outcome(result: Any) -> dict[str, Any] | None:
    """Read engine + diagnostics from a W7 ``RtResult`` when available.

    Forward-compatible: once ``RunResult.to_rt_result()`` (W7) lands, the engine
    that actually ran and its diagnostics come straight from the structured
    envelope. Returns ``None`` when the accessor is absent (today), so the caller
    falls back to warning-based detection.
    """
    to_rt = getattr(result, "to_rt_result", None)
    if not callable(to_rt):
        return None
    try:
        rt_result = to_rt()
    except Exception:
        return None

    manifest = _runtime_field(rt_result, "manifest")
    engine = _runtime_field(manifest, "engine")
    diagnostics = _runtime_field(rt_result, "diagnostics")

    return {
        "engine": engine,
        "diagnostics": _diagnostics_to_envelopes(diagnostics),
    }


@dataclass
class EngineObservation:
    """Records which engine ran for a single :func:`nirs4all.run` call.

    Attributes:
        requested: The engine the caller asked for, or ``None`` for the default.
        resolved: The engine nirs4all would select for ``requested``.
    """

    requested: str | None
    resolved: str
    _warnings: list[str] = field(default_factory=list)

    def finalize(self, result: Any = None) -> dict[str, Any]:
        """Return the engine record for the run record.

        Args:
            result: The ``nirs4all.run`` result, used to read a W7 ``RtResult``
                envelope when present.

        Returns:
            A dict with ``engine`` (the engine that actually ran, including
            fallback), ``engine_requested`` (the request input; ``None`` =
            default) and ``engine_diagnostics`` (list of :class:`RtError`
            envelopes, or ``None``).
        """
        rt_outcome = _rt_result_outcome(result)
        if rt_outcome is not None and rt_outcome.get("engine"):
            return {
                "engine": rt_outcome["engine"],
                "engine_requested": self.requested,
                "engine_diagnostics": rt_outcome["diagnostics"] or None,
            }

        diagnostics: list[dict[str, Any]] = []
        ran = self.resolved
        for message in self._warnings:
            if _FALLBACK_FRAGMENT in message:
                ran = _LEGACY
                diagnostics.append(
                    RtError(
                        verb="run",
                        cause=_cause_for_warning(message),
                        message=message,
                        mitigation=_FALLBACK_MITIGATION,
                    ).to_envelope()
                )
        return {
            "engine": ran,
            "engine_requested": self.requested,
            "engine_diagnostics": diagnostics or None,
        }


@contextmanager
def observe_engine(requested: str | None) -> Iterator[EngineObservation]:
    """Observe a :func:`nirs4all.run` call and record the engine that ran.

    Wraps the call in a **non-suppressing** ``warnings.showwarning`` hook so the
    transparent ``dag-ml`` → ``legacy`` fallback warning is captured for the run
    record *and still reaches* the normal warning handler (no behaviour change).

    Args:
        requested: The requested engine id, or ``None`` for the default.

    Yields:
        An :class:`EngineObservation`; call :meth:`EngineObservation.finalize`
        with the run result after the wrapped call returns.
    """
    observation = EngineObservation(requested=requested, resolved=resolve_engine(requested))
    original_showwarning = warnings.showwarning

    def _record(message, category, filename, lineno, file=None, line=None):  # noqa: ANN001
        observation._warnings.append(str(message))
        return original_showwarning(message, category, filename, lineno, file, line)

    # catch_warnings scopes both the filter reset and the hook to this call;
    # simplefilter("always") guarantees the transparent-fallback warning reaches
    # the hook (Python's default filters would otherwise dedupe/suppress it).
    with warnings.catch_warnings():
        warnings.simplefilter("always")
        warnings.showwarning = _record
        yield observation
