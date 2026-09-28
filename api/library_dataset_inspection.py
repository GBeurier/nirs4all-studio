"""Pure dataset projections delegated to the scientific library.

Rust authorizes every file/config reference before this adapter is invoked.
There is no server, job, filesystem discovery or numeric parser here.
"""

from typing import Any


def _inspect_multimodal_document(document: Any) -> dict[str, Any]:
    """Project counts after the published IO cohort contract validates values."""
    if (not isinstance(document, dict) or set(document) != {"schema", "cohort"}
            or document.get("schema") != "nirs4all.studio-multimodal-dataset.v1"
            or not isinstance(document.get("cohort"), dict)):
        raise ValueError("Invalid multimodal dataset descriptor")
    from nirs4all_io import MultimodalDataset

    cohort = MultimodalDataset.from_dict(document["cohort"])
    return {"success": True, "summary": {
        "num_samples": len(cohort.sample_ids), "num_features": 0,
        "train_samples": sum(partition == "train" for partition in cohort.partitions),
        "test_samples": sum(partition == "test" for partition in cohort.partitions),
        "n_sources": len(cohort.sources), "has_targets": cohort.y is not None,
        "has_metadata": False, "metadata_columns": [],
    }}


def inspect_dataset_document(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Dispatch a closed inspection request after Rust path authorization."""
    from nirs4all.api.dataset_inspection import (
        dataset_statistics,
        inspect_format_file,
        preview_dataset,
    )

    allowed = {
        "dataset.inspect_multimodal": {"dataset_document"},
        "dataset.preview": {"config", "max_samples", "load_limits", "max_input_bytes"},
        "dataset.stats": {"config", "partition", "load_limits", "max_input_bytes"},
        "dataset.inspect_format": {"path", "params", "sample_rows"},
    }
    if operation not in allowed:
        raise ValueError(f"Unsupported dataset inspection operation: {operation}")
    if not isinstance(payload, dict) or set(payload) - allowed[operation]:
        raise ValueError("Unexpected dataset inspection request fields")
    if operation == "dataset.inspect_multimodal":
        return _inspect_multimodal_document(payload.get("dataset_document"))
    if operation == "dataset.inspect_format":
        if not isinstance(payload.get("path"), str):
            raise ValueError("File inspection requires an authorized path")
        return inspect_format_file(**payload)
    if not isinstance(payload.get("config"), dict):
        raise ValueError("Dataset inspection requires an explicit authorized config")
    if operation == "dataset.preview":
        return preview_dataset(**payload)
    return dataset_statistics(**payload)
