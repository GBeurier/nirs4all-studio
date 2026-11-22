"""Host serialization for user-selected checkpoints in Core containers."""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any


def checkpoint_export(document: dict[str, Any]) -> dict[str, Any]:
    """Preserve selected snapshots and optional source files without running science."""
    import nirs4all_core as core
    from nirs4all.api.dataset_inspection import _references
    from nirs4all.pipeline.dagml.host_container import JSON_CONTENT_TYPE, HostMember

    sections = document.get("sections", {})
    if not isinstance(sections, dict) or not sections or sections.keys() - {"recipe", "dataset", "processed", "results", "shap", "provenance", "model"}:
        raise ValueError("Choose at least one supported checkpoint section")
    if "run_ids" in document:
        with TemporaryDirectory(prefix="studio-run-export-") as temporary:
            directory = Path(temporary)
            members = _run_members(document, sections, directory)
            return _write_checkpoint(directory / "run.n4a", members, sections)

    members = [HostMember(f"checkpoint/{name}.json", json.dumps(value, allow_nan=False).encode(),
                          "recipe" if name == "recipe" else "attachment", JSON_CONTENT_TYPE)
               for name, value in sections.items() if name != "model"]
    if "dataset" in sections and document.get("dataset_config") is not None:
        config = document["dataset_config"]
        paths = list(dict.fromkeys(_references(config)))
        names = {str(path): f"dataset/inputs/{index}/{path.name}" for index, path in enumerate(paths)}

        def relative(value: Any) -> Any:
            if isinstance(value, str):
                return names.get(value, value)
            if isinstance(value, list):
                return [relative(item) for item in value]
            if isinstance(value, dict):
                return {key: relative(item) for key, item in value.items()}
            return value

        members.append(HostMember("dataset/config.json", json.dumps(relative(config), allow_nan=False).encode(), "dataset", JSON_CONTENT_TYPE))
        members.extend(HostMember(names[str(path)], path, "attachment", "nirs4all.studio.source-file") for path in paths)
    with TemporaryDirectory(prefix="studio-checkpoint-") as temporary:
        target = Path(temporary) / "checkpoint.n4a"
        if "model" not in sections:
            return _write_checkpoint(target, members, sections)
        else:
            members.append(_checkpoint_manifest(sections))
            path = Path(document["bundle_path"])
            with core.open_n4a_file(path) as source:
                manifest = json.loads(source.manifest_bytes())
                if "sha256:" + source.view()["readability"]["container_sha256"] != document["archive_fingerprint"]:
                    raise ValueError("Model archive changed before export")
                owner = "nirs4all.python-host" if "nirs4all-python-host@1" in manifest["required_features"] else "nirs4all.studio"
                for member in members:
                    if any(item["path"] == member.path for item in manifest["members"]):
                        raise ValueError("This model already contains a checkpoint with the same member paths")
                    payload = member.source if isinstance(member.source, bytes) else member.source.read_bytes()
                    manifest["members"].append({"path": member.path, "byte_length": 0, "sha256": "0" * 64})
                    manifest["artifacts"].append({"id": member.path, "owner": owner, "kind": member.kind,
                        "content_type": {"id": member.content_type, "version": 1}, "requirements": None,
                        "identity": {"owner": owner, "schema": member.content_type, "schema_version": 1,
                                     "fingerprint_profile": "sha256.raw.v1", "fingerprint": "sha256:" + hashlib.sha256(payload).hexdigest()},
                        "storage": {"kind": "embedded", "root_member": member.path, "member_paths": [member.path]}})
                core.write_n4a_file(target, json.dumps(manifest), [(member.path, member.source) for member in members], base=source)
        return {"content_base64": base64.b64encode(target.read_bytes()).decode(), "filename": "checkpoint.n4a", "media_type": "application/octet-stream"}



def _json_attachment(name: str, data: Any, kind: str = "attachment") -> Any:
    from nirs4all.pipeline.dagml.host_container import JSON_CONTENT_TYPE, HostMember

    return HostMember(f"checkpoint/{name}.json", json.dumps(data, allow_nan=False).encode(), kind, JSON_CONTENT_TYPE)


def _checkpoint_manifest(sections: dict[str, Any]) -> Any:
    return _json_attachment("manifest", {
        "schema": "nirs4all.studio.checkpoint.v1", "included": list(sections),
        "training_performed": False, "snapshots_are_executable": False,
    }, "provenance")


def _write_checkpoint(target: Path, members: list[Any], sections: dict[str, Any]) -> dict[str, Any]:
    from nirs4all.pipeline.dagml.host_container import write_host_container

    write_host_container(target, [*members, _checkpoint_manifest(sections)], entrypoint=False)
    return {"content_base64": base64.b64encode(target.read_bytes()).decode(), "filename": target.name, "media_type": "application/octet-stream"}


def _run_members(document: dict[str, Any], sections: dict[str, Any], directory: Path) -> list[Any]:
    """Collect only selected, persisted run data through the SDK workspace API."""
    from nirs4all.pipeline.dagml.host_container import HostMember
    from nirs4all.pipeline.storage.workspace_store import WorkspaceStore

    from .shared.json_safe import sanitize_dict
    from .store_adapter import _parse_json_maybe

    if sections.keys() - {"recipe", "results", "model"}:
        raise ValueError("Run export supports recipes, results, and saved refit models")
    workspace = Path(document["workspace_path"])
    if not (workspace / "store.sqlite").is_file():
        workspace = workspace / "workspace"
    metadata: dict[str, list[dict[str, Any]]] = {key: [] for key in sections}
    models = []
    with WorkspaceStore.open_readonly(workspace) as store, store.transaction():
        for run_id in dict.fromkeys(document["run_ids"]):
            run = store.get_run(run_id)
            if run is None:
                raise ValueError(f"Stored run is unavailable: {run_id}")
            reference = {"run_id": run_id, "name": run["name"]}
            if "recipe" in sections:
                pipelines = []
                for item in store.list_pipelines(run_id=run_id).iter_rows(named=True):
                    pipeline_id = item["pipeline_id"]
                    pipeline = store.get_pipeline(pipeline_id)
                    if pipeline:
                        recipe = pipeline.get("original_template") or pipeline.get("expanded_config")
                        pipelines.append({"pipeline_id": pipeline_id, "name": item["name"], "recipe": recipe})
                metadata["recipe"].append({**reference, "pipelines": pipelines})
            if "results" in sections:
                rows = store.query_chain_summaries(run_id=run_id).iter_rows(named=True)
                metadata["results"].append(sanitize_dict({
                    **reference, "status": run["status"], "datasets": run["datasets"],
                    "chains": [dict(row) for row in rows],
                }))
            if "model" in sections:
                for pipeline in store.list_pipelines(run_id=run_id).iter_rows(named=True):
                    for chain in store.get_chains_for_pipeline(pipeline["pipeline_id"]).iter_rows(named=True):
                        fold_artifacts = _parse_json_maybe(chain["fold_artifacts"])
                        if not fold_artifacts or not (fold_artifacts.get("final") or fold_artifacts.get("fold_final")):
                            continue
                        chain_id = chain["chain_id"]
                        name = f"models/{len(metadata['model']) + 1}.n4a"
                        item = {**reference, "chain_id": chain_id, "dataset": pipeline["dataset_name"], "model": chain["model_class"]}
                        try:
                            archive = store.export_chain(chain_id, directory / Path(name).name)
                        except (FileNotFoundError, NotImplementedError, ValueError) as error:
                            metadata["model"].append({**item, "unavailable": str(error)[:500]})
                            continue
                        models.append(HostMember(name, archive, "attachment", "nirs4all.studio.fitted-model-container"))
                        metadata["model"].append({**item, "member": name})
    if "model" in sections and not models:
        raise ValueError("The selected runs have no exportable saved refit model")
    return [
        *(_json_attachment(key, payload, "recipe" if key == "recipe" else "attachment") for key, payload in metadata.items()),
        *models,
    ]
