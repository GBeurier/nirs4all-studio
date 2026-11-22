"""Document bridge to owner-backed portable prediction exports."""
from __future__ import annotations

import base64
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any


def prediction_export(document: dict[str, Any]) -> dict[str, str]:
    """Pass the Rust-authorized read-only workspace to the storage owner."""
    from nirs4all.pipeline.storage.prediction_export import export_prediction_arrays

    if set(document) != {"workspace_path", "request"} or not isinstance(document["request"], dict):
        raise ValueError("Prediction export requires an explicit workspace and request")
    if document["request"].get("format") == "n4a":
        return _export_prediction_container(Path(document["workspace_path"]), document["request"])
    return export_prediction_arrays(document["workspace_path"], document["request"])


def _export_prediction_container(workspace: Path, request: dict[str, Any]) -> dict[str, str]:
    """Package the owner's self-describing prediction tables in a Core container."""
    import polars as pl
    from nirs4all.pipeline.dagml.host_container import JSON_CONTENT_TYPE, HostMember, write_host_container
    from nirs4all.pipeline.storage.workspace_store import WorkspaceStore

    if request.keys() - {"format", "dataset_names"}:
        raise ValueError("Unknown .n4a prediction export fields")
    selected = request.get("dataset_names")
    if selected is not None and (not isinstance(selected, list) or not selected or any(not isinstance(name, str) or not name for name in selected)):
        raise ValueError("Select at least one prediction dataset")
    workspace = workspace.resolve(strict=True)
    if not (workspace / "store.sqlite").is_file():
        raise ValueError("not_found: Prediction results store does not exist")

    with TemporaryDirectory(prefix="studio-predictions-") as temporary:
        directory = Path(temporary)
        members = []
        datasets = []
        with WorkspaceStore.open_readonly(workspace) as store, store.transaction():
            if selected is None:
                selected = sorted(set(store.query_predictions()["dataset_name"].to_list()))
            if not selected:
                raise ValueError("not_found: No prediction datasets are available")
            for number, name in enumerate(dict.fromkeys(selected), start=1):
                live = store.query_predictions(dataset_name=name)
                if live.is_empty():
                    raise ValueError(f"not_found: Selected prediction dataset does not exist: {name}")
                arrays = store.array_store
                source = arrays._parquet_path(name)
                if source.is_symlink() or source.parent.is_symlink() or not source.resolve().is_relative_to(workspace):
                    raise ValueError("Unsafe prediction array file")
                if not source.is_file():
                    raise ValueError(f"not_found: Prediction arrays missing for dataset {name}")
                rows = arrays.load_dataset(name).filter(
                    (pl.col("dataset_name") == name) & pl.col("prediction_id").is_in(live["prediction_id"].implode())
                )
                if rows.is_empty():
                    raise ValueError(f"not_found: No stored prediction arrays for dataset {name}")
                path = directory / f"{number}.parquet"
                member = f"predictions/{path.name}"
                rows.write_parquet(path, compression="zstd")
                members.append(HostMember(member, path, "prediction", "nirs4all.studio.prediction-arrays.parquet"))
                datasets.append({"name": name, "member": member, "prediction_rows": rows.height})
        inventory = json.dumps({"schema": "nirs4all.studio.prediction-export.v1", "datasets": datasets}).encode()
        members.append(HostMember("predictions/index.json", inventory, "provenance", JSON_CONTENT_TYPE))
        target = directory / "predictions.n4a"
        write_host_container(target, members, entrypoint=False)
        return {"filename": target.name, "media_type": "application/octet-stream", "content_base64": base64.b64encode(target.read_bytes()).decode("ascii")}
