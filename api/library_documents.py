"""Pure Studio document adapters for the bounded CPython library host.

This module has no HTTP routes, app configuration, workspace manager or jobs.
It only reuses the editor/canonical conversion and wizard/config translation.
Scientific validation is delegated to nirs4all; loading stays with its IO owner.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .pipeline_canonical import (
    canonical_to_editor,
    editor_steps_to_runtime_canonical,
    editor_to_canonical,
    hydrate_editor_steps,
    validate_canonical,
)
from .shared.dataset_config import build_nirs4all_config, build_nirs4all_config_from_stored


def normalize_pipeline(document: dict[str, Any]) -> dict[str, Any]:
    """Validate and preserve a general editor pipeline using library semantics."""
    from nirs4all.api.studio_scientific_general import validate_studio_pipeline_config

    steps = document.get("steps")
    if not isinstance(steps, list) or any(not isinstance(step, dict) for step in steps):
        raise ValueError("steps must be an array of editor objects")
    validate_studio_pipeline_config(steps)
    normalized = hydrate_editor_steps(steps)
    payload = editor_to_canonical(
        normalized,
        name=document.get("name"),
        description=document.get("description"),
        include_wrapper=True,
    )
    validate_studio_pipeline_config(payload["pipeline"])
    validation = validate_canonical(payload)
    return {
        "steps": normalized,
        "payload": payload,
        "runtime_pipeline": editor_steps_to_runtime_canonical(normalized),
        "validation": validation,
    }


def import_pipeline(document: dict[str, Any]) -> dict[str, Any]:
    """Convert JSON/YAML or editor documents without acquiring any store."""
    import yaml
    from nirs4all.api.studio_scientific_general import validate_studio_pipeline_config

    payload = document.get("payload")
    if payload is None:
        content = document.get("content")
        if not isinstance(content, str):
            raise ValueError("Import request requires content or payload")
        format_name = str(document.get("format", "yaml")).lower()
        if format_name in {"yaml", "yml"}:
            payload = yaml.safe_load(content)
        elif format_name == "json":
            payload = json.loads(content)
        else:
            raise ValueError(f"Unsupported import format: {format_name}")
    validate_studio_pipeline_config(
        payload.get("pipeline", payload.get("steps")) if isinstance(payload, dict) else payload
    )
    if isinstance(payload, list):
        steps, name, description = canonical_to_editor(payload), None, ""
    elif isinstance(payload, dict) and "pipeline" in payload:
        steps = canonical_to_editor(payload)
        name, description = payload.get("name"), payload.get("description", "")
    elif isinstance(payload, dict) and "steps" in payload:
        steps = payload["steps"]
        name, description = payload.get("name"), payload.get("description", "")
    else:
        raise ValueError("Expected a canonical pipeline wrapper/list or editor document")
    normalized = normalize_pipeline({"steps": steps, "name": name, "description": description})
    return {"success": True, "name": document.get("name") or name or "Imported Pipeline",
            "description": description, "steps": normalized["steps"]}


def render_pipeline(document: dict[str, Any]) -> dict[str, Any]:
    """Render the library-validated canonical payload in both supported formats."""
    import yaml

    normalized = normalize_pipeline(document)
    payload = normalized["payload"]
    filename = str(document.get("name") or "pipeline").replace(" ", "_").lower()
    return {
        "success": True,
        "payload": payload,
        "json": json.dumps(payload, indent=2),
        "yaml": yaml.safe_dump(payload, sort_keys=False, default_flow_style=False, allow_unicode=False),
        "filename": f"{filename}.yaml",
    }


def configure_dataset(document: dict[str, Any]) -> dict[str, Any]:
    """Expose library-resolved references for Rust's subsequent confinement check."""
    from nirs4all.api.dataset_documents import normalize_dataset_document

    if "record" in document:
        record = document["record"]
        if not isinstance(record, dict):
            raise ValueError("Dataset record must be an object")
        config = record.get("config") or {}
        if not isinstance(config, dict):
            raise ValueError("Dataset config must be an object")
        if not config:
            path = record.get("path")
            if not isinstance(path, str) or not path:
                raise ValueError("Dataset record requires a path")
            # Rust authorizes this root before calling the adapter and checks
            # every resulting reference afterwards. FolderParser only inspects
            # filenames; it does not open matrices or implicit configuration.
            root = Path(path)
            if not root.is_absolute() or not root.is_dir():
                raise ValueError("Dataset auto-detection requires an authorized directory")
            normalized = normalize_dataset_document(root)
            normalized["name"] = record.get("name") or normalized["name"]
            return normalized
        if config.get("files") or config.get("train_x"):
            config = build_nirs4all_config_from_stored(record)
        return normalize_dataset_document(config, base_dir=record.get("path"))
    config = build_nirs4all_config(
        files=document.get("files", []),
        parsing=document.get("parsing", {}),
        base_path=document.get("path"),
        aggregation=document.get("aggregation"),
        folds=document.get("folds"),
        task_type=document.get("task_type"),
        dataset_name=document.get("name"),
    )
    return normalize_dataset_document(config, base_dir=document.get("path"))


def adapt_document(operation: str, document: dict[str, Any]) -> Any:
    """Dispatch a bounded library adapter; never own HTTP or schedule jobs."""
    if not isinstance(document, dict):
        raise ValueError("Document must be a JSON object")
    if operation == "config.compare":
        from .library_runtime_config import compare_configuration

        return compare_configuration(document)
    if operation in {"predictions.catalogue", "predictions.run", "predictions.file"}:
        from .library_predictions import adapt_prediction

        return adapt_prediction(operation, document)
    if operation in {"dataset.preview", "dataset.stats", "dataset.inspect_format"}:
        from .library_dataset_inspection import inspect_dataset_document

        return inspect_dataset_document(operation, document)
    if operation == "documents.batch":
        requests = document.get("requests")
        if set(document) != {"requests"} or not isinstance(requests, list) or not 1 <= len(requests) <= 128:
            raise ValueError("Document batch requires 1 to 128 requests")
        for item in requests:
            if not isinstance(item, dict) or set(item) != {"operation", "payload"}:
                raise ValueError("Invalid document batch member")
            if item["operation"] not in {"dataset.configure", "pipeline.normalize"} or not isinstance(item["payload"], dict):
                raise ValueError("Document batch only supports normalization")
            if len(json.dumps(item["payload"], allow_nan=False).encode("utf-8")) > 2 * 1024 * 1024:
                raise ValueError("Document batch member exceeds 2 MiB")
        return [adapt_document(item["operation"], item["payload"]) for item in requests]
    operations = {
        "pipeline.normalize": normalize_pipeline,
        "pipeline.import": import_pipeline,
        "pipeline.render": render_pipeline,
        "dataset.configure": configure_dataset,
    }
    if operation not in operations:
        raise ValueError(f"Unknown document operation: {operation}")
    return operations[operation](document)
