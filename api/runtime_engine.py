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
that accessor exists, the engine, manifest, diagnostics, and native result
references come straight from the structured envelope. Warning-string fallback
classification is retained only as a compatibility quarantine for older library
results that do not expose ``RtResult`` / ``RtError`` yet.
"""

from __future__ import annotations

import inspect
import warnings
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .runtime_errors import RtError, RtErrorCause, RtUnsupportedError

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


def supports_explicit_run_engine() -> bool:
    """Return whether the installed nirs4all runtime accepts ``run(engine=...)``."""
    try:
        import nirs4all

        run = getattr(nirs4all, "run", None)
        if run is None:
            from nirs4all.api.run import run as api_run

            run = api_run
        return "engine" in inspect.signature(run).parameters
    except Exception:
        return False


def runtime_engine_capabilities() -> dict[str, Any]:
    """Expose Studio's safe ML-engine selection surface for the active runtime."""
    supports_explicit = supports_explicit_run_engine()
    return {
        "supports_explicit_run_engine": supports_explicit,
        "supported_engines": ["legacy", "dag-ml"] if supports_explicit else [],
        "default_engine": resolve_engine(None),
        "reason": None
        if supports_explicit
        else "The active nirs4all runtime does not expose nirs4all.run(engine=...).",
    }


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
        if not supports_explicit_run_engine():
            raise RtUnsupportedError(
                RtError(
                    verb="run",
                    cause="unsupported_capability",
                    message=(
                        "Explicit ML engine selection requires a nirs4all runtime "
                        "that supports nirs4all.run(engine=...)."
                    ),
                    mitigation="Use the library default runtime backend or update the configured Python runtime.",
                    unsupported_capability="nirs4all.run.engine",
                )
            )
        return {"engine": requested.strip()}
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


def rt_error_envelope_from_exception(exc: BaseException) -> dict[str, Any] | None:
    """Return a structured ``RtError`` envelope from an exception when present."""
    rt_error = getattr(exc, "rt_error", None)
    if rt_error is not None:
        if hasattr(rt_error, "to_envelope"):
            return rt_error.to_envelope()
        if hasattr(rt_error, "to_dict"):
            return rt_error.to_dict()
        if isinstance(rt_error, Mapping):
            return dict(rt_error)

    if hasattr(exc, "to_envelope"):
        return exc.to_envelope()  # type: ignore[no-any-return]
    if hasattr(exc, "to_dict"):
        payload = exc.to_dict()
        return dict(payload) if isinstance(payload, Mapping) else None
    return None


def _runtime_field(value: Any, key: str) -> Any:
    """Read a field from a runtime envelope shaped as JSON or an object."""
    if isinstance(value, Mapping):
        return value.get(key)
    return getattr(value, key, None)


def _mapping_or_none(value: Any) -> dict[str, Any] | None:
    if isinstance(value, Mapping):
        return dict(value)
    return None


def _jsonable_list(value: Any) -> list[Any] | None:
    if value is None:
        return None
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return None


def _native_result_refs(result: Any, artifacts: Any) -> list[dict[str, Any]] | None:
    """Build durable references to native result outputs without embedding them."""
    refs: list[dict[str, Any]] = []
    run_dir = getattr(result, "_dagml_results_dir", None)
    if run_dir:
        path = Path(run_dir)
        refs.append(
            {
                "source": "native_results",
                "role": "run_dir",
                "artifact_type": "native_results_dir",
                "run_id": path.name,
                "path": str(path),
                "manifest_path": str(path / "manifest.json"),
            }
        )

    for artifact in _jsonable_list(artifacts) or []:
        if not isinstance(artifact, Mapping):
            continue
        refs.append(
            {
                "source": "rt_result",
                "role": "model_artifact",
                "artifact_type": "native_artifact_ref",
                "artifact_id": artifact.get("artifact_id"),
                "uri": artifact.get("uri"),
                "backend": artifact.get("backend"),
                "kind": artifact.get("kind"),
                "content_fingerprint": artifact.get("content_fingerprint"),
            }
        )

    return refs or None


def fallback_policy_record(requested: str | None, allow_fallback: bool) -> dict[str, Any]:
    """Return the run-record fallback/refusal policy for a runtime call."""
    return {
        "source": "nirs4all.run.allow_fallback",
        "engine_requested": requested,
        "allow_fallback": allow_fallback,
        "mode": "allow_fallback" if allow_fallback else "refuse_fallback",
    }


def _rt_result_outcome(result: Any) -> dict[str, Any] | None:
    """Read runtime outcome data from an ``RtResult`` when available.

    The engine that actually ran, diagnostics, manifest, and native result refs
    come straight from the structured envelope. Returns ``None`` when the
    accessor is absent, so callers can use the warning quarantine for old
    results only.
    """
    to_rt = getattr(result, "to_rt_result", None)
    if not callable(to_rt):
        return None
    try:
        rt_result = to_rt()
    except Exception:
        return None

    manifest = _runtime_field(rt_result, "manifest")
    manifest_payload = _mapping_or_none(manifest)
    engine = _runtime_field(manifest_payload or manifest, "engine")
    diagnostics = _runtime_field(rt_result, "diagnostics")
    artifacts = _runtime_field(rt_result, "artifacts")

    return {
        "runtime_source": "rt_result",
        "engine": engine,
        "diagnostics": _diagnostics_to_envelopes(diagnostics),
        "runtime_manifest": manifest_payload,
        "native_result_refs": _native_result_refs(result, artifacts),
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

    def finalize(
        self,
        result: Any = None,
        *,
        diagnostics: Any = None,
        fallback_policy: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Return the engine record for the run record.

        Args:
            result: The ``nirs4all.run`` result, used to read a W7 ``RtResult``
                envelope when present.
            diagnostics: Structured ``RtError`` diagnostics captured outside the
                result envelope, for example from a strict refusal before an
                allowed Studio fallback reruns legacy.
            fallback_policy: The explicit fallback/refusal policy in effect for
                this call.

        Returns:
            A dict with ``engine`` (the engine that actually ran, including
            fallback), ``engine_requested`` (the request input; ``None`` =
            default), ``engine_diagnostics`` (list of :class:`RtError`
            envelopes, or ``None``), and runtime metadata preserved from the
            structured envelope when available.
        """
        explicit_diagnostics = _diagnostics_to_envelopes(diagnostics)
        rt_outcome = _rt_result_outcome(result)
        if rt_outcome is not None and rt_outcome.get("engine"):
            rt_diagnostics = rt_outcome["diagnostics"] or explicit_diagnostics
            return {
                "engine": rt_outcome["engine"],
                "engine_requested": self.requested,
                "engine_diagnostics": rt_diagnostics or None,
                "runtime_source": rt_outcome["runtime_source"],
                "runtime_manifest": rt_outcome["runtime_manifest"],
                "fallback_policy": fallback_policy,
                "native_result_refs": rt_outcome["native_result_refs"],
            }

        warning_diagnostics: list[dict[str, Any]] = []
        ran = self.resolved
        runtime_source = "resolved_engine"
        for message in self._warnings:
            if _FALLBACK_FRAGMENT in message:
                ran = _LEGACY
                runtime_source = "warning_heuristic"
                warning_diagnostics.append(
                    RtError(
                        verb="run",
                        cause=_cause_for_warning(message),
                        message=message,
                        mitigation=_FALLBACK_MITIGATION,
                    ).to_envelope()
                )
        all_diagnostics = [*explicit_diagnostics, *warning_diagnostics]
        return {
            "engine": ran,
            "engine_requested": self.requested,
            "engine_diagnostics": all_diagnostics or None,
            "runtime_source": runtime_source,
            "runtime_manifest": None,
            "fallback_policy": fallback_policy,
            "native_result_refs": None,
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
