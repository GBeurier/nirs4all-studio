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
from .shared.dataset_config import build_nirs4all_config, build_nirs4all_config_from_stored, for_dataset_configs


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
    result = {
        "steps": normalized,
        "payload": payload,
        "runtime_pipeline": editor_steps_to_runtime_canonical(normalized),
        "validation": validation,
    }
    if document.get("scientific_run") is True:
        from nirs4all.api.studio_scientific import StudioScientificJobError
        from nirs4all.api.studio_scientific_general import _preflight_optional_product_operators

        # Reuse the library's execution check before Rust admits a job. Editing
        # and importing optional model presets remain independent of installation.
        try:
            _preflight_optional_product_operators(result["runtime_pipeline"])
            result["execution_validation"] = {"valid": True}
        except StudioScientificJobError as error:
            result["execution_validation"] = {"valid": False, "code": error.code, "message": str(error)}
    return result


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

    def finish(config: dict[str, Any]) -> dict[str, Any]:
        if document.get("scientific_run") is not True:
            return config
        return for_dataset_configs(config)

    if "record" in document:
        record = document["record"]
        if not isinstance(record, dict):
            raise ValueError("Dataset record must be an object")
        config = record.get("config") or {}
        if not isinstance(config, dict):
            raise ValueError("Dataset config must be an object")
        # The inline cohort is reconstructed by the scientific host. Keep this
        # document intact; flat file configurations still use normalization.
        if "dataset_document" in config:
            descriptor = config["dataset_document"]
            if not isinstance(descriptor, dict) or descriptor.get("schema") != "nirs4all.studio-multimodal-dataset.v1" or not isinstance(descriptor.get("cohort"), dict) or set(descriptor) != {"schema", "cohort"}:
                raise ValueError("Invalid multimodal dataset descriptor")
            return descriptor
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
            return finish(normalized)
        # Translation preserves library-owned fields and idempotently bridges
        # legacy flat NA policies for both new wizard and existing records.
        if config.get("files") or config.get("train_x") or config.get("test_x"):
            config = build_nirs4all_config_from_stored(record)
        return finish(normalize_dataset_document(config, base_dir=record.get("path")))
    config = build_nirs4all_config(
        files=document.get("files", []),
        parsing=document.get("parsing", {}),
        base_path=document.get("path"),
        aggregation=document.get("aggregation"),
        folds=document.get("folds"),
        task_type=document.get("task_type"),
        dataset_name=document.get("name"),
    )
    return finish(normalize_dataset_document(config, base_dir=document.get("path")))


def plain_windows_path(value: str) -> str:
    """Drop the verbatim prefix of a Windows path (``\\\\?\\D:\\...``, ``\\\\?\\UNC\\...``).

    The native sidecar reports canonical Windows paths in verbatim form; SQLite
    file URIs built from them (``Path.as_uri()``) get ``?`` as their authority.
    """
    if value.startswith("\\\\?\\UNC\\"):
        return "\\\\" + value[8:]
    if value.startswith("\\\\?\\") and value[5:6] == ":":
        return value[4:]
    return value


def adapt_document(operation: str, document: dict[str, Any]) -> Any:
    """Dispatch a bounded library adapter; never own HTTP or schedule jobs."""
    if not isinstance(document, dict):
        raise ValueError("Document must be a JSON object")
    if isinstance(document.get("workspace_path"), str):
        document = {**document, "workspace_path": plain_windows_path(document["workspace_path"])}
    if operation in {"runs.preflight", "runs.detail", "runs.logs"}:
        return read_stored_run(operation, document)
    if operation == "runs.delete":
        return delete_stored_run(document)
    if operation in {"playground.operators", "playground.presets", "spectra.data", "spectra.stats"}:
        from .library_playground_views import playground_view

        return playground_view(operation, document)
    if operation == "workspace.upgrade":
        from nirs4all.workspace.upgrade import upgrade_workspace_copy

        if set(document) != {"source", "output"}:
            raise ValueError("Workspace upgrade requires explicit source and output paths")
        return upgrade_workspace_copy(document["source"], document["output"])
    if operation == "config.dependencies":
        from .library_runtime_config import dependency_inventory

        return dependency_inventory(document)
    if operation == "config.compare":
        from .library_runtime_config import compare_configuration

        return compare_configuration(document)
    if operation in {"results.chains", "results.top", "results.chain", "results.chain_detail", "results.arrays", "results.chain_steps", "results.pipeline_steps"}:
        from .library_aggregated_results import read_aggregated_results

        return read_aggregated_results(operation, document)
    if operation in {"results.page", "results.summary"}:
        from .library_prediction_results import read_prediction_results

        return read_prediction_results(operation, document)
    if operation in {"predictions.catalogue", "predictions.run", "predictions.file"}:
        from .library_predictions import adapt_prediction

        return adapt_prediction(operation, document)
    if operation in {"dataset.preview", "dataset.stats", "dataset.inspect_format", "dataset.inspect_multimodal"}:
        from .library_dataset_inspection import inspect_dataset_document

        return inspect_dataset_document(operation, document)
    if operation == "documents.batch":
        requests = document.get("requests")
        if set(document) != {"requests"} or not isinstance(requests, list) or not 1 <= len(requests) <= 128:
            raise ValueError("Document batch requires 1 to 128 requests")
        for item in requests:
            if not isinstance(item, dict) or set(item) != {"operation", "payload"}:
                raise ValueError("Invalid document batch member")
            if item["operation"] not in {"dataset.configure", "pipeline.normalize", "pipeline.import"} or not isinstance(item["payload"], dict):
                raise ValueError("Document batch only supports normalization and pipeline import")
            if len(json.dumps(item["payload"], allow_nan=False).encode("utf-8")) > 2 * 1024 * 1024:
                raise ValueError("Document batch member exceeds 2 MiB")
        results = []
        for item in requests:
            try:
                results.append(adapt_document(item["operation"], item["payload"]))
            except Exception as error:
                # History browsing skips unsupported templates; launch normalization remains strict.
                if item["operation"] != "pipeline.import":
                    raise
                results.append({"success": False, "error": str(error)})
        return results
    operations = {
        "pipeline.normalize": normalize_pipeline,
        "pipeline.import": import_pipeline,
        "pipeline.render": render_pipeline,
        "dataset.configure": configure_dataset,
    }
    if operation not in operations:
        raise ValueError(f"Unknown document operation: {operation}")
    return operations[operation](document)


def read_stored_run(operation: str, document: dict[str, Any]) -> Any:
    """Read history through the library owner without opening a writable store."""
    from nirs4all.pipeline.storage import WorkspaceStore, studio_run_detail_http_inputs_v1

    if operation == "runs.preflight":
        if document:
            raise ValueError("Run owner preflight does not accept fields")
        if not callable(studio_run_detail_http_inputs_v1):
            raise TypeError("Run owner materializer is not callable")
        return {"callable": "nirs4all.pipeline.storage.studio_run_detail_http_inputs_v1", "ready": True}
    fields = {"workspace_path", "run_id"} | ({"pipeline_id"} if operation == "runs.logs" else set())
    if set(document) != fields or not isinstance(document["workspace_path"], str) or not document["workspace_path"]:
        raise ValueError("Run history requires an explicit workspace path and identifiers")
    for field in fields - {"workspace_path"}:
        identifier = document[field]
        if not isinstance(identifier, str) or not identifier or len(identifier) > 1024 or any(character in identifier for character in "/\\\0") or identifier in {".", ".."}:
            raise ValueError(f"Invalid {field}")
    if operation == "runs.detail":
        return studio_run_detail_http_inputs_v1(document["workspace_path"], document["run_id"])
    from .shared.json_safe import sanitize_dict

    with WorkspaceStore.open_readonly(document["workspace_path"]) as store:
        pipeline = store.get_pipeline(document["pipeline_id"])
        if not isinstance(pipeline, dict) or pipeline.get("run_id") != document["run_id"]:
            raise ValueError("Pipeline not found in run")
        logs = []
        for row in store.get_pipeline_log(document["pipeline_id"]).iter_rows(named=True):
            entry = sanitize_dict(dict(row))
            if isinstance(entry.get("details"), str):
                try:
                    entry["details"] = json.loads(entry["details"])
                except (ValueError, TypeError):
                    pass
            logs.append(entry)
        return {"pipeline_id": document["pipeline_id"], "pipeline_name": pipeline.get("name"), "logs": logs}


def retire_run_documents(workspace: Path, run_id: str, store: Any) -> list[str]:
    """Move only documents identifying the deleted run; preserve shared jobs."""
    import os
    import uuid

    runs = workspace / "runs"
    if not runs.is_dir() or runs.is_symlink():
        return []
    warnings = []
    with os.scandir(runs) as entries:
        for index, entry in enumerate(entries):
            if index >= 2000:
                break
            directory = Path(entry.path)
            if not entry.is_dir(follow_symlinks=False) or entry.is_symlink():
                continue
            matched = False
            for filename, maximum in (("manifest.json", 2 * 1024 * 1024), ("execution_job_record.json", 256 * 1024)):
                path = directory / filename
                try:
                    if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
                        continue
                    with path.open("rb") as stream:
                        raw = stream.read(maximum + 1)
                    if len(raw) > maximum:
                        continue
                    document = json.loads(raw)
                    if not isinstance(document, dict):
                        continue
                    if filename == "manifest.json":
                        matched = document.get("id") == entry.name and document.get("store_run_id") == run_id
                    else:
                        driver = document.get("driver")
                        ids = driver.get("store_run_ids") if isinstance(driver, dict) else None
                        if document.get("job_id") == entry.name and isinstance(ids, list) and 1 <= len(ids) <= 256 and all(isinstance(identifier, str) and identifier for identifier in ids):
                            matched = run_id in ids and all(identifier == run_id or store.get_run(identifier) is None for identifier in ids)
                    if matched:
                        break
                except (OSError, ValueError, TypeError):
                    continue
            if not matched:
                continue
            retired = workspace / ".nirs4all" / "deleted-runs"
            # Do not move historical documents through a user-controlled symlink.
            if (workspace / ".nirs4all").is_symlink() or retired.is_symlink():
                warnings.append(f"Could not retire run documents: {entry.name}")
                continue
            try:
                retired.mkdir(parents=True, exist_ok=True)
                destination = retired / entry.name
                if destination.exists() or destination.is_symlink():
                    destination = retired / f"{entry.name}-{uuid.uuid4().hex}"
                directory.rename(destination)
            except OSError:
                # The Store deletion already succeeded; never report it as a
                # retryable failure merely because a Windows file is open.
                warnings.append(f"Could not retire run documents: {entry.name}")
    return warnings


def delete_stored_run(document: dict[str, Any]) -> dict[str, Any]:
    """Delegate run deletion, including partial results, to the storage owner."""
    from nirs4all.pipeline.storage import WorkspaceStore

    if set(document) != {"workspace_path", "run_id"}:
        raise ValueError("Run deletion requires a workspace path and run ID")
    workspace = Path(document["workspace_path"])
    run_id = document["run_id"]
    if not isinstance(run_id, str) or not run_id or len(run_id) > 1024 or any(character in run_id for character in "/\\\0") or run_id in {".", ".."}:
        raise ValueError("Run ID must be a non-empty string")
    # Opening a writable store must not create a database for an unknown run.
    if not (workspace / "store.sqlite").is_file():
        return {"success": False, "reason": "run_not_found"}
    with WorkspaceStore(workspace) as store:
        run = store.get_run(run_id)
        if run is None:
            return {"success": False, "reason": "run_not_found"}
        if run.get("status") in {"running", "queued", "pending"}:
            return {"success": False, "reason": "run_active"}
        deleted_rows = store.delete_run(run_id, delete_artifacts=True)
        try:
            warnings = retire_run_documents(workspace, run_id, store)
        except OSError:
            warnings = ["Could not inspect historical run documents after Store deletion"]
    result = {"success": True, "deleted_rows": deleted_rows, "run_id": run_id}
    if warnings:
        result["warnings"] = warnings
    return result
