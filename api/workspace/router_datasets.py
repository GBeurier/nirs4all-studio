"""Global dataset management routes (link/unlink/refresh/list) and groups.

Datasets are stored globally and accessible across all workspaces.
"""

import asyncio
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from ..app_config import app_config
from ..shared.logger import get_logger
from .models import CreateGroupRequest, LinkDatasetRequest

logger = get_logger(__name__)

router = APIRouter()


def _extract_dataset_metadata_columns(dataset_info: dict[str, Any]) -> list[str] | None:
    """Best-effort metadata column extraction for globally linked datasets."""
    dataset_path = Path(str(dataset_info.get("path", "")))
    if not dataset_path.exists():
        return None

    try:
        from nirs4all.data import DatasetConfigs

        from ..spectra import _build_nirs4all_config_from_stored

        nirs4all_config = _build_nirs4all_config_from_stored(dataset_info)
        if "train_x" not in nirs4all_config:
            return None

        dataset_configs = DatasetConfigs(nirs4all_config)
        datasets = dataset_configs.get_datasets()
        if not datasets:
            return None

        dataset = datasets[0]
        if not getattr(dataset, "_metadata", None):
            return []

        metadata_columns = getattr(dataset, "metadata_columns", []) or []
        return [
            column
            for column in metadata_columns
            if isinstance(column, str) and column
        ]
    except Exception as exc:
        logger.debug(
            "Failed to extract metadata columns for dataset %s: %s",
            dataset_info.get("id"),
            exc,
        )
        return None


def _maybe_enrich_dataset_metadata_columns(dataset_info: dict[str, Any]) -> dict[str, Any]:
    """Ensure dataset list payloads carry metadata columns for runtime grouping."""
    existing = dataset_info.get("metadata_columns")
    normalized_existing = (
        [column for column in existing if isinstance(column, str) and column]
        if isinstance(existing, list)
        else []
    )

    if normalized_existing:
        if normalized_existing != existing:
            dataset_info["metadata_columns"] = normalized_existing
        return dataset_info

    extracted = _extract_dataset_metadata_columns(dataset_info)
    if extracted is None:
        dataset_info["metadata_columns"] = normalized_existing
        return dataset_info

    dataset_info["metadata_columns"] = extracted
    if extracted != normalized_existing:
        dataset_id = dataset_info.get("id")
        if isinstance(dataset_id, str) and dataset_id:
            try:
                app_config.update_dataset(dataset_id, {"metadata_columns": extracted})
            except Exception as exc:
                logger.debug(
                    "Failed to persist metadata columns for dataset %s: %s",
                    dataset_id,
                    exc,
                )

    return dataset_info


@router.get("/datasets")
async def list_datasets():
    """List all globally linked datasets.

    Datasets are stored globally and accessible across all workspaces.
    """
    try:
        datasets = app_config.get_datasets()
        groups = app_config.get_dataset_groups()
        dataset_payloads = await asyncio.to_thread(
            lambda: [
                _maybe_enrich_dataset_metadata_columns(d.to_dict())
                for d in datasets
            ]
        )
        return {
            "datasets": dataset_payloads,
            "groups": [g.to_dict() for g in groups],
            "total": len(datasets),
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to list datasets: {str(e)}"
        )


def _populate_linked_dataset_stats(dataset_info: dict[str, Any]) -> dict[str, Any]:
    """Load num_samples/features/targets for a freshly linked dataset.

    Heavy (loads NIRS arrays from disk via ``DatasetConfigs``); runs in a
    worker thread. Mutates and returns ``dataset_info``.
    """
    try:
        from ..spectra import _build_nirs4all_config_from_stored

        nirs4all_config = _build_nirs4all_config_from_stored(dataset_info)
        if "train_x" in nirs4all_config:
            from nirs4all.data import DatasetConfigs

            dataset_configs = DatasetConfigs(nirs4all_config)
            datasets = dataset_configs.get_datasets()

            if datasets:
                ds = datasets[0]
                dataset_info["num_samples"] = ds.num_samples
                dataset_info["num_features"] = ds.num_features
                dataset_info["n_sources"] = ds.n_sources

                # Non-critical metadata — failures here must not prevent saving core stats
                try:
                    task_type_str = None
                    if ds.task_type:
                        task_type_str = str(ds.task_type)
                        if "." in task_type_str:
                            task_type_str = task_type_str.split(".")[-1].lower()
                    dataset_info["task_type"] = task_type_str

                    if ds.signal_types:
                        dataset_info["signal_types"] = [st.value for st in ds.signal_types]

                    # ds.metadata_columns is the public accessor (empty when
                    # the dataset has no metadata table).
                    dataset_info["metadata_columns"] = [
                        column
                        for column in (ds.metadata_columns or [])
                        if isinstance(column, str) and column
                    ]

                    # Detect/set targets if not already configured. A detected
                    # task type implies the dataset carries targets (the
                    # library derives task_type from them).
                    config = dataset_info.get("config", {})
                    if "targets" not in config and task_type_str is not None:
                        target_columns = ds.target_columns if hasattr(ds, 'target_columns') else None
                        if target_columns:
                            detected_targets = [{"column": col, "type": task_type_str or "regression"} for col in target_columns]
                        else:
                            detected_targets = [{"column": "target", "type": task_type_str or "regression"}]
                        dataset_info["targets"] = detected_targets
                        if "config" not in dataset_info:
                            dataset_info["config"] = {}
                        dataset_info["config"]["targets"] = detected_targets
                    elif "targets" in config:
                        dataset_info["targets"] = config["targets"]

                    # Preserve user-configured default_target from wizard config
                    config = dataset_info.get("config", {})
                    if config.get("default_target") and not dataset_info.get("default_target"):
                        dataset_info["default_target"] = config["default_target"]

                    if dataset_info.get("targets") and not dataset_info.get("default_target"):
                        dataset_info["default_target"] = dataset_info["targets"][0].get("column")
                except Exception as meta_err:
                    dataset_info["load_warning"] = f"Metadata detection partial failure: {meta_err}"

                # Always persist core stats (num_samples, num_features) even if metadata detection failed
                update_data = {
                    "num_samples": dataset_info.get("num_samples"),
                    "num_features": dataset_info.get("num_features"),
                    "n_sources": dataset_info.get("n_sources", 1),
                    "task_type": dataset_info.get("task_type"),
                    "signal_types": dataset_info.get("signal_types", []),
                    "metadata_columns": dataset_info.get("metadata_columns", []),
                    "targets": dataset_info.get("targets", []),
                    "default_target": dataset_info.get("default_target"),
                }
                if "config" in dataset_info:
                    update_data["config"] = dataset_info["config"]
                app_config.update_dataset(dataset_info["id"], update_data)
    except ImportError:
        pass
    except Exception as e:
        # Don't fail link if we can't populate extra info
        dataset_info["load_warning"] = str(e)
    return dataset_info


@router.post("/datasets/link")
async def link_dataset(request: LinkDatasetRequest):
    """Link a dataset globally (accessible across all workspaces)."""
    try:
        dataset_info = app_config.link_dataset(request.path, config=request.config).to_dict()

        # Try to populate num_samples, num_features, and targets from the actual dataset
        dataset_info = await asyncio.to_thread(_populate_linked_dataset_stats, dataset_info)

        return {
            "success": True,
            "message": "Dataset linked successfully",
            "dataset": dataset_info,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to link dataset: {str(e)}"
        )


@router.delete("/datasets/{dataset_id}")
async def unlink_dataset(dataset_id: str):
    """Unlink a dataset globally (does not delete files)."""
    try:
        success = app_config.unlink_dataset(dataset_id)
        if not success:
            raise HTTPException(status_code=404, detail="Dataset not found")

        return {"success": True, "message": "Dataset unlinked successfully"}
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to unlink dataset: {str(e)}"
        )


@router.post("/datasets/{dataset_id}/refresh")
async def refresh_dataset(dataset_id: str):
    """Refresh dataset information by reloading it."""
    try:
        dataset = await asyncio.to_thread(app_config.refresh_dataset, dataset_id)
        if not dataset:
            raise HTTPException(
                status_code=404, detail="Dataset not found or refresh failed"
            )
        dataset_info = dataset.to_dict()

        metadata_columns = await asyncio.to_thread(_extract_dataset_metadata_columns, dataset_info)
        if metadata_columns is not None:
            dataset_info["metadata_columns"] = metadata_columns
            app_config.update_dataset(
                dataset_id,
                {"metadata_columns": metadata_columns},
            )

        return {
            "success": True,
            "message": "Dataset refreshed successfully",
            "dataset": dataset_info,
        }
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to refresh dataset: {str(e)}"
        )


# ----------------------- Groups management -----------------------


@router.get("/workspace/groups")
async def get_groups():
    try:
        groups = [g.to_dict() for g in app_config.get_dataset_groups()]
        return {"groups": groups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list groups: {str(e)}")


@router.post("/workspace/groups")
async def create_group(req: CreateGroupRequest):
    try:
        grp = app_config.create_dataset_group(req.name).to_dict()
        return {"success": True, "group": grp}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to create group: {str(e)}"
        )


@router.put("/workspace/groups/{group_id}")
async def rename_group(group_id: str, req: CreateGroupRequest):
    try:
        ok = app_config.rename_dataset_group(group_id, req.name)
        if not ok:
            raise HTTPException(status_code=404, detail="Group not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to rename group: {str(e)}"
        )


@router.delete("/workspace/groups/{group_id}")
async def delete_group(group_id: str):
    try:
        ok = app_config.delete_dataset_group(group_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Group not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete group: {str(e)}"
        )


@router.post("/workspace/groups/{group_id}/datasets")
async def add_dataset_to_group(group_id: str, body: dict[str, Any]):
    try:
        dataset_id = body.get("dataset_id")
        if not dataset_id:
            raise HTTPException(status_code=400, detail="dataset_id required")
        ok = app_config.add_dataset_to_group(dataset_id, group_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Group not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to add dataset to group: {str(e)}"
        )


@router.delete("/workspace/groups/{group_id}/datasets/{dataset_id}")
async def remove_dataset_from_group(group_id: str, dataset_id: str):
    try:
        ok = app_config.remove_dataset_from_group(dataset_id, group_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Group not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to remove dataset from group: {str(e)}"
        )
