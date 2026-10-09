"""Bounded document bridge to library-owned Inspector diagnostics."""
from __future__ import annotations

from typing import Any


def inspector_view(operation: str, document: dict[str, Any]) -> dict[str, Any]:
    """Delegate all numerical analysis to the owner facade."""
    from nirs4all.api.inspector_views import read_inspector_view

    if set(document) != {"workspace_path", "request"} or not isinstance(document["request"], dict):
        raise ValueError("Inspector requires an explicit workspace and request object")
    return read_inspector_view(operation, document["workspace_path"], document["request"])
