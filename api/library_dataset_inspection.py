"""Pure dataset projections delegated to the scientific library.

Rust authorizes every file/config reference before this adapter is invoked.
There is no server, job, filesystem discovery or numeric parser here.
"""

import sys
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


def _missing_spectra(payload: dict[str, Any]) -> dict[str, int]:
    """Count the missing spectral values of the dataset as loaded, and the samples that hold them."""
    import numpy as np
    from nirs4all.analysis.playground_dataset import extract_playground_dataset
    from nirs4all.analysis.playground_types import PreviewLimits
    from nirs4all.api.dataset_inspection import load_dataset_for_analysis

    dataset, _reader = load_dataset_for_analysis(payload["config"], load_limits=payload.get("load_limits"),
                                                 max_input_bytes=payload.get("max_input_bytes", sys.maxsize))
    values = 0
    affected: set[Any] = set()
    for source in range(dataset.n_sources):
        batch = extract_playground_dataset(dataset, partition="all", source_index=source,
                                           limits=PreviewLimits(max_samples=sys.maxsize, max_features=sys.maxsize, max_cells=sys.maxsize)).batch
        missing = ~np.isfinite(np.asarray(batch.x, dtype=float))
        values += int(missing.sum())
        rows = np.flatnonzero(missing.any(axis=1))
        # Sources are counted on the dataset's own sample identities.
        affected.update(rows.tolist() if batch.sample_ids is None else np.asarray(batch.sample_ids)[rows].tolist())
    return {"values": values, "samples": len(affected)}


def inspect_dataset_document(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Dispatch a closed inspection request after Rust path authorization."""
    from nirs4all.api.dataset_inspection import (
        dataset_statistics,
        inspect_format_file,
        preview_dataset,
    )

    allowed = {
        "dataset.inspect_multimodal": {"dataset_document"},
        "dataset.preview": {"config", "max_samples", "load_limits", "max_input_bytes", "count_missing_spectra"},
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
    # Studio sets no input ceiling: the memory of this worker bounds the load.
    payload.setdefault("max_input_bytes", sys.maxsize)
    if operation == "dataset.preview":
        count_missing = payload.pop("count_missing_spectra", False) is True
        preview = preview_dataset(**payload, max_response_bytes=sys.maxsize)
        if count_missing and preview.get("success") is True:
            preview["summary"]["missing_spectra"] = _missing_spectra(payload)
        return preview
    return dataset_statistics(**payload)
