"""Probe the attested editor catalogue within the selected library interpreter."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from .node_registry_loader import load_editor_registry_reference
from .pipeline_canonical import import_operator_class


def operator_availability(document: dict[str, Any]) -> dict[str, Any]:
    """Resolve executable references without constructing or fitting estimators."""
    if document:
        raise ValueError("Operator availability takes no request fields")
    reference = load_editor_registry_reference()
    unavailable = []
    checked = 0
    executable = {"preprocessing", "y_processing", "splitting", "model", "filter", "augmentation"}
    for node in reference["nodes"]:
        if node.get("type") not in executable:
            continue
        checked += 1
        path = node.get("functionPath") or node.get("classPath")
        try:
            if not isinstance(path, str) or not path:
                raise ValueError("Executable operator has no library reference")
            operator = import_operator_class(path, allow_callable=bool(node.get("functionPath")))
            if not callable(operator):
                raise ValueError("Operator reference is not callable")
        except Exception as error:
            unavailable.append({"id": node.get("id", ""), "name": node.get("name", ""), "type": node["type"],
                                "class_path": node.get("classPath"), "function_path": node.get("functionPath"),
                                "available": False, "error": str(error)})
    return {"registry_version": reference.get("version"), "generated_at": reference.get("generatedAt"),
            "computed_at": datetime.now(UTC).isoformat(), "checked_count": checked, "unavailable": unavailable}
