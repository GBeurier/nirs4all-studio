"""Document bridge to owner-backed portable prediction exports."""
from __future__ import annotations

from typing import Any


def prediction_export(document: dict[str, Any]) -> dict[str, str]:
    """Pass the Rust-authorized read-only workspace to the storage owner."""
    from nirs4all.pipeline.storage.prediction_export import export_prediction_arrays

    if set(document) != {"workspace_path", "request"} or not isinstance(document["request"], dict):
        raise ValueError("Prediction export requires an explicit workspace and request")
    return export_prediction_arrays(document["workspace_path"], document["request"])
