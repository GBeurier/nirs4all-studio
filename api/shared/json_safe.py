"""NaN/Inf-safe value sanitization for JSON serialization.

Single source of truth for the float/dict sanitizers that were previously
copy-pasted across routers (predict, runs, store_adapter, inspector,
aggregated_predictions).
"""

import math
from typing import Any


def sanitize_float(value: Any) -> Any:
    """Convert NaN / Inf floats to ``None``; pass every other value through."""
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def sanitize_dict(d: dict[str, Any]) -> dict[str, Any]:
    """Recursively replace NaN / Inf float values with ``None`` in a dict."""
    out: dict[str, Any] = {}
    for k, v in d.items():
        if isinstance(v, dict):
            out[k] = sanitize_dict(v)
        elif isinstance(v, list):
            out[k] = [
                sanitize_dict(item) if isinstance(item, dict) else sanitize_float(item)
                for item in v
            ]
        else:
            out[k] = sanitize_float(v)
    return out
