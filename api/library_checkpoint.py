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
    from nirs4all.pipeline.dagml.host_container import JSON_CONTENT_TYPE, HostMember, write_host_container

    sections = document.get("sections", {})
    if not isinstance(sections, dict) or not sections or sections.keys() - {"recipe", "dataset", "processed", "results", "shap", "provenance", "model"}:
        raise ValueError("Choose at least one supported checkpoint section")
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
    members.append(HostMember("checkpoint/manifest.json", json.dumps({
        "schema": "nirs4all.studio.checkpoint.v1", "included": list(sections),
        "training_performed": False, "snapshots_are_executable": False,
    }).encode(), "provenance", JSON_CONTENT_TYPE))
    with TemporaryDirectory(prefix="studio-checkpoint-") as temporary:
        target = Path(temporary) / "checkpoint.n4a"
        if "model" not in sections:
            write_host_container(target, members, entrypoint=False)
        else:
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
