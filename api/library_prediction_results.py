"""Read-only Studio result projections over the nirs4all workspace owner."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .store_adapter import StoreAdapter


def read_prediction_results(operation: str, document: dict[str, Any]) -> dict[str, Any]:
    """Read a paginated result or summary without opening a writable store."""
    workspace = Path(document["workspace_path"])
    if not workspace.is_dir():
        raise ValueError("Workspace directory does not exist")
    # A freshly created workspace has no store yet. Existing legacy data must
    # never be mistaken for an empty workspace.
    if not (workspace / "store.sqlite").exists():
        if (workspace / "store.duckdb").exists() or any(workspace.glob("*.meta.parquet")):
            raise ValueError("Legacy prediction storage requires workspace migration before native result access")
        if operation == "results.page":
            return {"records": [], "total": 0, "limit": document["limit"],
                    "offset": document["offset"], "has_more": False}
        return {"total_predictions": 0, "top_predictions": [], "models": []}
    with StoreAdapter(workspace, read_only=True) as adapter:
        if operation == "results.page":
            return adapter.get_predictions_page(
                dataset_name=document.get("dataset"), model_class=document.get("model_class"),
                partition=document.get("partition"), limit=document["limit"], offset=document["offset"],
            )
        if operation == "results.summary":
            return adapter.get_predictions_summary(dataset_name=document.get("dataset"))
    raise ValueError(f"Unknown prediction result operation: {operation}")
