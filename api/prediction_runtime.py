"""Studio prediction runtime adapter around the Python ``nirs4all.predict`` oracle.

Prediction is not routed through the ``nirs4all.run`` ML-engine selector today:
the public Python API exposes bundle/chain replay through ``nirs4all.predict``
and does not accept ``engine`` or ``allow_fallback`` kwargs. Studio keeps that
oracle boundary explicit here instead of forwarding unsupported runtime kwargs.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from .runtime_engine import resolve_engine
from .runtime_errors import RtError, RtUnsupportedError

_LEGACY = "legacy"
_DAGML = "dag-ml"
_PREDICT_CAPABILITY = "dagml_predict"


@dataclass(frozen=True)
class RuntimePredictionOutcome:
    """Prediction result plus Studio runtime metadata."""

    result: Any
    runtime_record: dict[str, Any]


def rt_error_http_status(rt_error: RtError) -> int:
    """Map a structured runtime error to the route-level HTTP status."""
    if rt_error.cause == "invalid_request":
        return 400
    if rt_error.cause == "unavailable_backend":
        return 503
    if rt_error.cause == "unsupported_capability":
        return 501
    return 500


def prediction_values(result: Any) -> Any:
    """Return the stable prediction payload from a ``PredictResult``-like object."""
    to_numpy = getattr(result, "to_numpy", None)
    if callable(to_numpy):
        value = to_numpy()
        if value is not None:
            return value

    for attr in ("y_pred", "values", "predictions"):
        if hasattr(result, attr):
            value = getattr(result, attr)
            if value is not None:
                return value
    return []


def prediction_values_to_list(result: Any) -> list[Any]:
    """Return prediction values as JSON-ready lists without flattening shape."""
    values = prediction_values(result)
    if hasattr(values, "tolist"):
        converted = values.tolist()
        return converted if isinstance(converted, list) else [converted]
    return list(values)


def predict_with_runtime_record(
    predict_func: Callable[..., Any],
    *,
    predict_kwargs: Mapping[str, Any],
    engine: str | None,
    allow_fallback: bool = False,
) -> RuntimePredictionOutcome:
    """Call ``nirs4all.predict`` under Studio's explicit prediction policy.

    ``engine`` and ``allow_fallback`` are interpreted by Studio only; they are
    never forwarded to the Python oracle because ``nirs4all.predict`` does not
    support those kwargs.
    """
    engine_requested, resolved_engine = _resolve_prediction_engine(engine)
    fallback_policy = _prediction_fallback_policy_record(engine_requested, allow_fallback)

    if resolved_engine == _DAGML:
        rt_error = _dagml_predict_error()
        if not allow_fallback:
            raise RtUnsupportedError(rt_error)
        result = predict_func(**dict(predict_kwargs))
        return RuntimePredictionOutcome(
            result=result,
            runtime_record=_prediction_runtime_record(
                engine_requested=engine_requested,
                runtime_source="python_oracle_fallback",
                fallback_policy=fallback_policy,
                diagnostics=[rt_error.to_envelope()],
            ),
        )

    result = predict_func(**dict(predict_kwargs))
    return RuntimePredictionOutcome(
        result=result,
        runtime_record=_prediction_runtime_record(
            engine_requested=engine_requested,
            runtime_source="python_oracle",
            fallback_policy=fallback_policy,
        ),
    )


def _resolve_prediction_engine(requested: str | None) -> tuple[str | None, str]:
    clean = requested.strip() if isinstance(requested, str) else None
    if not clean:
        return None, _LEGACY

    try:
        resolved = resolve_engine(clean)
    except ValueError as exc:
        raise RtUnsupportedError(
            RtError(
                verb="predict",
                cause="invalid_request",
                message=str(exc),
                mitigation="Request engine='legacy', omit engine, or use engine='dag-ml' with allow_fallback=true.",
            )
        ) from exc
    except NotImplementedError as exc:
        raise RtUnsupportedError(
            RtError(
                verb="predict",
                cause="unsupported_capability",
                message=str(exc),
                mitigation="Use engine='legacy' for prediction.",
                unsupported_capability=f"engine:{clean}",
            )
        ) from exc

    if resolved not in {_LEGACY, _DAGML}:
        raise RtUnsupportedError(
            RtError(
                verb="predict",
                cause="invalid_request",
                message=f"unknown nirs4all prediction engine {clean!r}",
                mitigation="Request engine='legacy', omit engine, or use engine='dag-ml' with allow_fallback=true.",
            )
        )
    return clean, resolved


def _dagml_predict_error() -> RtError:
    return RtError(
        verb="predict",
        cause="unsupported_capability",
        message="engine='dag-ml' does not support nirs4all.predict yet; prediction currently uses the Python oracle bundle/chain replay path.",
        mitigation="Request engine='legacy', omit engine, or set allow_fallback=true to run the Python oracle explicitly.",
        unsupported_capability=_PREDICT_CAPABILITY,
    )


def _prediction_fallback_policy_record(requested: str | None, allow_fallback: bool) -> dict[str, Any]:
    return {
        "source": "nirs4all.predict.allow_fallback",
        "engine_requested": requested,
        "allow_fallback": allow_fallback,
        "mode": "allow_fallback" if allow_fallback else "refuse_fallback",
    }


def _prediction_runtime_record(
    *,
    engine_requested: str | None,
    runtime_source: str,
    fallback_policy: dict[str, Any],
    diagnostics: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "verb": "predict",
        "backend": "local-python",
        "oracle": "nirs4all.predict",
        "engine": _LEGACY,
        "engine_requested": engine_requested,
        "engine_diagnostics": diagnostics or None,
        "runtime_source": runtime_source,
        "runtime_manifest": None,
        "fallback_policy": fallback_policy,
        "native_result_refs": None,
    }
