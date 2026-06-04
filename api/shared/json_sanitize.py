"""Shared JSON sanitization helpers.

JSON has no representation for the IEEE-754 special floats ``NaN``,
``Infinity`` and ``-Infinity``. Python's :func:`json.dumps` emits the
non-standard tokens ``NaN``/``Infinity`` for them, which browsers reject when
parsing a response. These helpers replace those values with ``None`` (``null``)
so every response stays valid JSON.

There is exactly one implementation here; the API routers import from this
module rather than keeping their own (previously divergent) copies.
"""

from __future__ import annotations

import math
import numbers
from typing import Any


def sanitize_float(value: Any) -> Any:
    """Return ``None`` for NaN/Inf real floats, otherwise the value unchanged.

    The value's type is preserved: an ``int`` stays an ``int`` (it is never
    coerced to ``float``), a ``str`` stays a ``str``, and a finite float stays a
    float. Only NaN / +Inf / -Inf real-number floats (including numpy floating
    scalars, which :func:`math.isnan` / :func:`math.isinf` accept) become
    ``None``.

    Args:
        value: Any value; typically a scalar coming from a database row.

    Returns:
        ``None`` if ``value`` is a NaN/Inf real float, else ``value`` unchanged.
    """
    # Only true floats (python float, numpy floating) can be NaN/Inf. Excluding
    # Integral (int, bool, numpy ints) preserves those types AND avoids the
    # OverflowError that math.isnan/isinf raise on very large Python ints.
    if isinstance(value, numbers.Real) and not isinstance(value, numbers.Integral):
        if math.isnan(value) or math.isinf(value):
            return None
    return value


def sanitize_json(obj: Any) -> Any:
    """Recursively sanitize an object so it serializes to valid JSON.

    Walks ``dict`` values and ``list`` / ``tuple`` items, replacing every
    NaN/Inf real float with ``None`` (see :func:`sanitize_float`). The container
    structure and every dict key are preserved; tuples are returned as lists
    (matching JSON's only sequence type). All other values pass through
    unchanged.

    Args:
        obj: Any JSON-shaped object (dicts, lists/tuples, scalars).

    Returns:
        A structurally identical object with NaN/Inf floats turned into ``None``.
    """
    if isinstance(obj, dict):
        return {k: sanitize_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize_json(v) for v in obj]
    return sanitize_float(obj)
