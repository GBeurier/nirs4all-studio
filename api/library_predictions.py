"""Thin prediction projections for the explicitly attested scientific host.

Rust authorizes workspace, bundle and dataset references. This module does not
scan directories, own application state, expose routes or train estimators.
Scientific loading, replay, identity and metrics remain library operations.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from .shared.json_safe import sanitize_dict

MAX_MODELS = 10000


def available_models(document: dict[str, Any]) -> dict[str, Any]:
    """Read captured-model metadata without deserializing any fitted payload."""
    from nirs4all.pipeline.dagml.general_archive import general_archive_manifest
    from nirs4all.pipeline.storage.model_catalogue import read_model_catalogue

    if set(document) - {"workspace_path", "exports"}:
        raise ValueError("Unexpected model catalogue fields")
    root = Path(document["workspace_path"])
    models = []
    if (root / "store.sqlite").is_file():
        for record in read_model_catalogue(root, max_models=MAX_MODELS):
            row, chain = record["summary"], record["chain"]
            steps = chain.get("steps") or []
            marker = steps[0].get("dagml_host_replay") if len(steps) == 1 and isinstance(steps[0], dict) else None
            if not isinstance(marker, dict) or marker.get("schema") != "nirs4all.dagml-workspace-refit.v1":
                continue
            artifacts = chain.get("fold_artifacts") or {}
            if not artifacts.get("final"):
                continue
            models.append({
                "id": row["chain_id"], "name": row.get("model_name") or row.get("model_class") or row["chain_id"],
                "source": "chain", "model_class": row.get("model_class") or "",
                "dataset_name": row.get("dataset_name"), "metric": row.get("metric"),
                "best_score": row.get("cv_val_score"), "created_at": row.get("created_at"),
                "file_size": None, "preprocessing": row.get("preprocessings"), "bundle_path": None,
                "has_refit": True, "fold_artifacts": artifacts, "prediction_metric": row.get("metric"),
                "prediction_score": row.get("final_test_score"), "task_type": row.get("task_type"),
                "execution_profile": "captured_general", "artifact_scope": "full_training_refit",
                "artifact_fingerprint": marker.get("artifact_fingerprint"), "cv_artifacts_available": False,
                "target_names": marker.get("target_names", ["y"]),
            })
    exports = document.get("exports", [])
    if not isinstance(exports, list) or len(exports) + len(models) > MAX_MODELS:
        raise ValueError("Invalid or oversized model catalogue")
    for record in exports:
        path = Path(record["path"])
        manifest = general_archive_manifest(path)
        if manifest is None:
            continue  # Portable archives are listed by their separate native catalogue.
        models.append({
            "id": record["id"], "name": path.stem, "source": "bundle", "model_class": manifest.get("model_class") or path.stem,
            "dataset_name": manifest.get("dataset_name"), "metric": None, "best_score": None,
            "created_at": manifest.get("created_at"), "file_size": record["size"], "preprocessing": manifest.get("preprocessing_chain"),
            "bundle_path": record["id"], "has_refit": True, "fold_artifacts": None,
            "prediction_metric": None, "prediction_score": None, "execution_profile": "captured_general",
            "archive_fingerprint": record["fingerprint"], "artifact_scope": "full_training_refit", "cv_artifacts_available": False,
            "target_names": manifest.get("target_names", ["y"]),
        })
    return sanitize_dict({"models": models, "total": len(models)})


def run_prediction(document: dict[str, Any]) -> dict[str, Any]:
    """Replay one authorized model; preserve row identities and target axes."""
    import nirs4all
    from nirs4all.api.dataset_inspection import load_dataset_for_analysis
    from nirs4all.core.metrics import eval_multi
    from nirs4all.core.task_detection import detect_task_type
    from nirs4all.pipeline.dagml.general_archive import predict_general_archive

    allowed = {"workspace_path", "model_id", "model_source", "bundle_path", "archive_fingerprint",
               "data_source", "spectra", "config", "partition", "load_limits", "max_input_bytes", "output_index", "file_path", "params"}
    if set(document) - allowed:
        raise ValueError("Unexpected general prediction fields")
    source = document.get("data_source")
    selected = None
    targets = None
    partitions = None
    reader = None
    sample_labels = None
    if source == "array":
        data = np.asarray(document["spectra"], dtype=float)
        if data.ndim != 2 or not all(data.shape) or not np.isfinite(data).all():
            raise ValueError("Prediction requires a nonempty finite 2D matrix")
    elif source in {"dataset", "file"}:
        if source == "file":
            from nirs4all.api.dataset_inspection import load_prediction_file

            data, reader, sample_labels = load_prediction_file(
                document["file_path"], params=document.get("params"), load_limits=document.get("load_limits"),
                max_input_bytes=document.get("max_input_bytes", 512 * 1024 * 1024),
            )
        else:
            data, reader = load_dataset_for_analysis(
                document["config"], load_limits=document.get("load_limits"),
                max_input_bytes=document.get("max_input_bytes", 512 * 1024 * 1024),
            )
        partition = document.get("partition") or "all"
        if partition not in {"all", "train", "val", "test"}:
            raise ValueError("Invalid prediction partition")
        # Replay the unchanged scientific dataset, then select storage rows.
        # Never truncate labels or manufacture positional wire identifiers.
        partitions = data.index_column("partition", {})
        selected = np.ones(len(partitions), dtype=bool) if partition == "all" else np.asarray(partitions) == partition
        if not selected.any():
            raise ValueError("Requested partition contains no samples")
        loaded_targets = np.asarray(data.y({}))
        targets = loaded_targets if loaded_targets.size else None
    else:
        raise ValueError("Unknown general prediction data source")
    if document.get("model_source") == "chain":
        result = nirs4all.predict(
            chain_id=document["model_id"], workspace_path=document["workspace_path"],
            data=data, engine="dag-ml", verbose=0,
        )
    elif document.get("model_source") == "bundle":
        fingerprint = document.get("archive_fingerprint")
        if not isinstance(fingerprint, str) or not fingerprint.startswith("sha256:"):
            raise ValueError("Captured bundle prediction requires its selected fingerprint")
        result = predict_general_archive(document["bundle_path"], data, expected_archive_fingerprint=fingerprint)
    else:
        raise ValueError("Unknown general prediction model source")
    metadata = result.metadata
    ids = metadata["sample_ids"]
    values = np.asarray(result.y_pred).reshape(len(ids), -1)
    names = metadata["target_names"]
    if values.shape[1] != len(names) or not np.isfinite(values).all():
        raise ValueError("Prediction target dimensions or finitude are inconsistent")
    if selected is not None:
        if partitions is None or len(selected) != len(values) or (targets is not None and len(targets) != len(values)):
            raise ValueError("Prediction rows do not match the original dataset identities")
        values = values[selected]
        if targets is not None:
            targets = targets[selected]
        ids = [value for value, keep in zip(ids, selected, strict=True) if keep]
        partitions = [value for value, keep in zip(partitions, selected, strict=True) if keep]
        if sample_labels is not None:
            sample_labels = [value for value, keep in zip(sample_labels, selected, strict=True) if keep]
    output_index = document.get("output_index", 0)
    if type(output_index) is not int or not 0 <= output_index < len(names):
        raise ValueError("output_index is outside the captured target axis")
    predictions = values[:, output_index]
    actual = None
    metrics = None
    if targets is not None and targets.size:
        target_matrix = targets.reshape(len(values), -1)
        if target_matrix.shape[1] == len(names):
            actual = target_matrix[:, output_index]
            if np.isfinite(actual).all():
                task_type = detect_task_type(actual).value
                metrics = eval_multi(actual, predictions, task_type)
    return sanitize_dict({
        "predictions": predictions.tolist(), "prediction_matrix": values.tolist(), "target_names": names,
        "output_index": output_index, "num_samples": len(values), "model_name": result.model_name,
        "preprocessing_steps": result.preprocessing_steps or [], "actual_values": None if actual is None else actual.tolist(),
        "metrics": metrics, "sample_ids": ids, "sample_labels": sample_labels, "partitions": partitions,
        "runtime": {"verb": "predict", "engine": "dag-ml", "runtime_source": "captured_general",
                    "runtime_manifest": metadata, "reader": reader, "fallback_policy": {"allow_fallback": False}},
    })


def adapt_prediction(operation: str, document: dict[str, Any]) -> dict[str, Any]:
    """Closed host dispatch: no runtime fallback or alternative server."""
    if not isinstance(document, dict):
        raise ValueError("Prediction document must be an object")
    if operation == "predictions.catalogue":
        return available_models(document)
    if operation in {"predictions.run", "predictions.file"}:
        return run_prediction(document)
    raise ValueError("Unknown prediction operation")
