"""Shared preprocessing execution through runtime operator resolution."""

from __future__ import annotations

import inspect
from typing import Any

from .pipeline_service import instantiate_operator


def _step_name_and_params(step: Any) -> tuple[str, dict[str, Any]]:
    """Extract a preprocessing step name/params from route or playground models."""
    if isinstance(step, dict):
        return str(step.get("name", "")), dict(step.get("params") or {})
    return str(getattr(step, "name", "")), dict(getattr(step, "params", {}) or {})


def _fit_transform_kwargs(operator: Any, *, wavelengths: Any = None, y: Any = None) -> dict[str, Any]:
    """Build optional fit_transform kwargs supported by a runtime operator."""
    kwargs: dict[str, Any] = {}
    try:
        signature = inspect.signature(operator.fit_transform)
    except (TypeError, ValueError):
        signature = None

    if signature is not None and "y" in signature.parameters and y is not None:
        kwargs["y"] = y

    needs_wavelengths = bool(getattr(operator, "_requires_wavelengths", False))
    if wavelengths is not None and (needs_wavelengths or (signature is not None and "wavelengths" in signature.parameters)):
        kwargs["wavelengths"] = wavelengths

    return kwargs


def apply_preprocessing_chain(
    X: Any,
    chain: list[Any],
    *,
    wavelengths: Any = None,
    y: Any = None,
    strict: bool = False,
) -> tuple[Any, list[str]]:
    """Apply preprocessing steps using Studio's shared runtime operator resolver.

    Args:
        X: Input spectral matrix.
        chain: Route dictionaries or models with ``name`` and ``params``.
        wavelengths: Optional wavelength axis for wavelength-aware operators.
        y: Optional target values for supervised preprocessing operators.
        strict: Raise ``ValueError`` for unknown or failing operators. When false,
            unknown/failing steps are skipped to preserve the historical spectra wrapper.

    Returns:
        Tuple of transformed matrix and names of successfully applied steps.
    """
    import numpy as np

    transformed = X
    applied_steps: list[str] = []

    for step in chain:
        name, params = _step_name_and_params(step)
        if not name:
            continue

        if name == "Resampler" and wavelengths is not None and "n_points" in params:
            wl_arr = np.asarray(wavelengths, dtype=float)
            if wl_arr.size:
                n_points = int(params.pop("n_points", getattr(transformed, "shape", [len(wl_arr), len(wl_arr)])[1]))
                params["target_wavelengths"] = np.linspace(wl_arr.min(), wl_arr.max(), n_points)

        try:
            operator = instantiate_operator(name, params, operator_type="preprocessing")
        except Exception as exc:
            if strict:
                raise ValueError(f"Error resolving {name}: {exc}") from exc
            continue

        if operator is None:
            if strict:
                raise ValueError(f"Unknown preprocessing method: {name}")
            continue

        try:
            fit_kwargs = _fit_transform_kwargs(operator, wavelengths=wavelengths, y=y)
            result = operator.fit_transform(transformed, **fit_kwargs)
            if hasattr(result, "toarray") and not isinstance(result, np.ndarray):
                result = result.toarray()
            transformed = result
            applied_steps.append(name)
        except Exception as exc:
            if strict:
                raise ValueError(f"Error applying {name}: {exc}") from exc
            continue

    return transformed, applied_steps
