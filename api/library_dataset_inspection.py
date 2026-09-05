"""Pure dataset projections delegated to the scientific library.

Rust authorizes every file/config reference before this adapter is invoked.
There is no server, job, filesystem discovery or numeric parser here.
"""

from typing import Any


def inspect_dataset_document(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Dispatch a closed inspection request after Rust path authorization."""
    from nirs4all.api.dataset_inspection import (
        dataset_statistics,
        inspect_format_file,
        preview_dataset,
    )

    allowed = {
        "dataset.preview": {"config", "max_samples", "load_limits", "max_input_bytes"},
        "dataset.stats": {"config", "partition", "load_limits", "max_input_bytes"},
        "dataset.inspect_format": {"path", "params", "sample_rows"},
    }
    if operation not in allowed:
        raise ValueError(f"Unsupported dataset inspection operation: {operation}")
    if not isinstance(payload, dict) or set(payload) - allowed[operation]:
        raise ValueError("Unexpected dataset inspection request fields")
    if operation == "dataset.inspect_format":
        if not isinstance(payload.get("path"), str):
            raise ValueError("File inspection requires an authorized path")
        return inspect_format_file(**payload)
    if not isinstance(payload.get("config"), dict):
        raise ValueError("Dataset inspection requires an explicit authorized config")
    if operation == "dataset.preview":
        return preview_dataset(**payload)
    return dataset_statistics(**payload)
