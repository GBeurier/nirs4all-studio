"""Linked-workspace discovery routes (Phase 7): workspaces, runs, results,
predictions, exports, templates, and run rerun.
"""

import asyncio
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from ..app_config import app_config
from ..shared.logger import get_logger
from ..workspace_manager import workspace_manager
from ..workspace_scanner import WorkspaceScanner
from ._shared import (
    _DATASET_SCORES_CACHE,
    _RESULTS_SUMMARY_CACHE,
    _dataset_links_signature,
    _get_cached_runs,
    _has_active_non_maintenance_jobs,
    _invalidate_results_caches,
    _resolve_store_backed_scanner,
    _set_cached_runs,
    _store_signature,
    invalidate_workspace_cache,
)
from .models import (
    LinkedWorkspaceResponse,
    LinkedWorkspacesListResponse,
    LinkWorkspaceRequest,
    WorkspaceScanResponse,
)
from .services import (
    _build_dataset_scores_payload,
    _normalize_rerun_cv_strategy,
    _normalize_run_dataset_entries,
    _pipeline_clone_name,
    _pipeline_rerun_signature,
    _rerunnable_pipeline_rows,
    _resolve_dataset_mapping,
)

logger = get_logger(__name__)

router = APIRouter()


# ============= Linked Workspaces Endpoints =============


@router.get("/workspaces", response_model=LinkedWorkspacesListResponse)
async def list_linked_workspaces():
    """List all linked nirs4all workspaces."""
    try:
        workspaces = workspace_manager.get_linked_workspaces()
        active = workspace_manager.get_active_workspace()

        return LinkedWorkspacesListResponse(
            workspaces=[
                LinkedWorkspaceResponse(
                    id=ws.id,
                    path=ws.path,
                    name=ws.name,
                    is_active=ws.is_active,
                    linked_at=ws.linked_at,
                    last_scanned=ws.last_scanned,
                    discovered=ws.discovered,
                )
                for ws in workspaces
            ],
            active_workspace_id=active.id if active else None,
            total=len(workspaces),
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to list workspaces: {str(e)}"
        )


@router.post("/workspaces/link", response_model=LinkedWorkspaceResponse)
async def link_workspace(request: LinkWorkspaceRequest):
    """Link a nirs4all workspace for discovery."""
    try:
        linked_ws = workspace_manager.link_workspace(request.path, request.name)
        return LinkedWorkspaceResponse(
            id=linked_ws.id,
            path=linked_ws.path,
            name=linked_ws.name,
            is_active=linked_ws.is_active,
            linked_at=linked_ws.linked_at,
            last_scanned=linked_ws.last_scanned,
            discovered=linked_ws.discovered,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to link workspace: {str(e)}"
        )


@router.delete("/workspaces/{workspace_id}")
async def unlink_workspace(workspace_id: str):
    """Unlink a nirs4all workspace (doesn't delete files)."""
    try:
        success = workspace_manager.unlink_workspace(workspace_id)
        if not success:
            raise HTTPException(status_code=404, detail="Workspace not found")
        return {"success": True, "message": "Workspace unlinked"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to unlink workspace: {str(e)}"
        )


@router.post("/workspaces/prune")
async def prune_workspaces():
    """Remove linked workspaces whose directories no longer exist on disk.

    Returns the list of removed entries so the caller can verify what
    was cleaned up. If the active workspace was among the removed
    entries, a remaining workspace is activated (or a default created).
    """
    try:
        removed = workspace_manager.prune_missing_workspaces()
        return {
            "success": True,
            "removed_count": len(removed),
            "removed": removed,
        }
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to prune workspaces: {str(e)}"
        )


@router.post("/workspaces/{workspace_id}/activate", response_model=LinkedWorkspaceResponse)
async def activate_workspace(workspace_id: str):
    """Set a linked workspace as active."""
    try:
        activated = workspace_manager.activate_workspace(workspace_id)
        if not activated:
            raise HTTPException(status_code=404, detail="Workspace not found")
        return LinkedWorkspaceResponse(
            id=activated.id,
            path=activated.path,
            name=activated.name,
            is_active=activated.is_active,
            linked_at=activated.linked_at,
            last_scanned=activated.last_scanned,
            discovered=activated.discovered,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to activate workspace: {str(e)}"
        )


@router.post("/workspaces/{workspace_id}/scan", response_model=WorkspaceScanResponse)
async def scan_workspace(workspace_id: str):
    """Trigger a scan of a linked workspace to discover runs, exports, etc."""
    try:
        scan_result = await asyncio.to_thread(workspace_manager.scan_workspace, workspace_id)
        return WorkspaceScanResponse(
            scanned_at=scan_result["scanned_at"],
            summary=scan_result["summary"],
            runs=scan_result["runs"],
            predictions=scan_result["predictions"],
            exports=scan_result["exports"],
            templates=scan_result["templates"],
            datasets=scan_result["datasets"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to scan workspace: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/runs")
async def get_workspace_runs(workspace_id: str, source: str = "unified", refresh: bool = False):
    """Get discovered runs from a linked workspace.

    When a store database is available, runs come directly from the store
    (fast, authoritative).  Otherwise falls back to manifest + parquet
    discovery:

    - "unified" (default): Combines manifest-based and parquet-based discovery
    - "manifests": Only reads from run_manifest.yaml files (accurate but slower)
    - "parquet": Only extracts from prediction parquet files (faster but less complete)

    Use refresh=true to bypass the cache and force a fresh scan.
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        workspace_path = Path(ws.path)
        workspace_path_str = str(workspace_path)

        # Check cache first (unless refresh is requested)
        if not refresh:
            cached = _get_cached_runs(workspace_path_str, source)
            if cached is not None:
                return cached

        scanner = WorkspaceScanner(workspace_path)
        result = await asyncio.to_thread(
            scanner.discover_runs_combined, workspace_id, source
        )

        # Cache the result for subsequent requests
        _set_cached_runs(workspace_path_str, source, result)

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get runs: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/runs/enriched")
async def get_enriched_workspace_runs(workspace_id: str, project_id: str | None = None, limit: int = 50, offset: int = 0):
    """Get enriched runs with per-dataset scores, top chains, and stats."""
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        from api.store_adapter import STORE_AVAILABLE, StoreAdapter
        if not STORE_AVAILABLE:
            return {"runs": [], "total": 0}

        workspace_path = Path(ws.path)
        store_path = workspace_path / "store.sqlite"
        if not store_path.exists():
            store_path = workspace_path / "store.duckdb"
        if not store_path.exists():
            return {"runs": [], "total": 0}

        def _fetch() -> Any:
            adapter = StoreAdapter(workspace_path)
            try:
                return adapter.get_enriched_runs(limit=limit, offset=offset, project_id=project_id)
            finally:
                adapter.close()

        return await asyncio.to_thread(_fetch)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _get_run_detail(workspace_path: Path, run_id: str) -> dict[str, Any]:
    """Resolve full run detail (blocking; runs in a worker thread)."""
    scanner = WorkspaceScanner(workspace_path)

    # ---- Store path (primary) ----
    if scanner._has_store():
        run = scanner.store_adapter.get_run_detail(run_id)
        if run is not None:
            linked_datasets = app_config.get_datasets()
            datasets_result = _normalize_run_dataset_entries(run.get("datasets"))
            _resolve_dataset_mapping(datasets_result, linked_datasets)
            unresolved_dataset_names = [
                str(dataset.get("name") or "")
                for dataset in datasets_result
                if not dataset.get("linked_dataset_id")
            ]

            log_summary = scanner.store_adapter.get_run_log(run_id)
            log_summary_by_pipeline = {
                str(entry.get("pipeline_id") or ""): entry
                for entry in log_summary
                if entry.get("pipeline_id")
            }
            pipelines = []
            for pipeline in run.get("pipelines") or []:
                if not isinstance(pipeline, dict):
                    continue
                merged_pipeline = dict(pipeline)
                merged_pipeline.update(log_summary_by_pipeline.get(str(pipeline.get("pipeline_id") or ""), {}))
                pipelines.append(merged_pipeline)

            run["datasets"] = datasets_result
            run["pipelines"] = pipelines
            run["log_summary"] = log_summary
            run["rerun_ready"] = len(unresolved_dataset_names) == 0 and len(pipelines) > 0
            run["unresolved_dataset_names"] = unresolved_dataset_names
            results = scanner.discover_results(run_id)
            run["results"] = results
            run["results_count"] = len(results)
            return run
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    # ---- Legacy filesystem path ----
    all_runs = scanner.discover_runs()
    for run in all_runs:
        if run.get("id") == run_id:
            results = scanner.discover_results(run_id)
            run["results"] = results
            run["results_count"] = len(results)
            return run

    raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")


@router.get("/workspaces/{workspace_id}/runs/{run_id}")
async def get_workspace_run_detail(workspace_id: str, run_id: str):
    """Get detailed information about a specific run.

    Returns the full run information including templates, datasets,
    configuration, and summary of results.
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        return await asyncio.to_thread(_get_run_detail, Path(ws.path), run_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get run detail: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/runs/{run_id}/pipelines/{pipeline_id}/logs")
async def get_workspace_run_pipeline_logs(workspace_id: str, run_id: str, pipeline_id: str):
    """Get structured log rows for one stored pipeline within a run."""
    try:
        _, _, scanner = _resolve_store_backed_scanner(
            workspace_id, "Prediction deletion requires a store database"
        )

        def _fetch() -> dict[str, Any]:
            pipeline = scanner.store_adapter.store.get_pipeline(pipeline_id)
            if not isinstance(pipeline, dict) or pipeline.get("run_id") != run_id:
                raise HTTPException(status_code=404, detail="Pipeline not found in run")
            return {
                "pipeline_id": pipeline_id,
                "pipeline_name": pipeline.get("name"),
                "logs": scanner.store_adapter.get_pipeline_log(pipeline_id),
            }

        return await asyncio.to_thread(_fetch)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get pipeline logs: {str(e)}",
        )


@router.post("/workspaces/{workspace_id}/runs/{run_id}/rerun")
async def rerun_workspace_run(workspace_id: str, run_id: str):
    """Clone a stored run's base pipelines, save them, and launch a new run."""
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        if not ws.is_active:
            activated = workspace_manager.activate_workspace(workspace_id)
            if not activated:
                raise HTTPException(status_code=409, detail="Failed to activate workspace")

        workspace_path = Path(ws.path)
        scanner = WorkspaceScanner(workspace_path)
        if not scanner._has_store():
            raise HTTPException(status_code=501, detail="Run rerun requires a store database")

        run = await asyncio.to_thread(scanner.store_adapter.get_run_detail, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

        datasets_result = _normalize_run_dataset_entries(run.get("datasets"))
        linked_datasets = app_config.get_datasets()
        _resolve_dataset_mapping(datasets_result, linked_datasets)
        unresolved_dataset_names = [
            str(dataset.get("name") or "")
            for dataset in datasets_result
            if not dataset.get("linked_dataset_id")
        ]
        if unresolved_dataset_names:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Cannot rerun this history entry because some datasets are no longer linked: "
                    + ", ".join(unresolved_dataset_names)
                ),
            )

        source_pipelines = _rerunnable_pipeline_rows([
            pipeline
            for pipeline in (run.get("pipelines") or [])
            if isinstance(pipeline, dict)
        ])
        deduped_source_pipelines: list[dict[str, Any]] = []
        seen_pipeline_signatures: set[str] = set()
        for pipeline in source_pipelines:
            signature = _pipeline_rerun_signature(pipeline)
            if signature in seen_pipeline_signatures:
                continue
            seen_pipeline_signatures.add(signature)
            deduped_source_pipelines.append(pipeline)
        source_pipelines = deduped_source_pipelines
        if not source_pipelines:
            raise HTTPException(status_code=409, detail="No stored pipelines are available to rerun")

        from ..pipeline_canonical import canonical_to_editor
        from ..pipelines import _normalize_and_validate_editor_steps, _save_pipeline
        from ..runs import CreateRunRequest, ExperimentConfig, create_run

        existing_names: set[str] = set()
        cloned_pipelines: list[dict[str, Any]] = []
        cloned_pipeline_ids: list[str] = []

        for pipeline in source_pipelines:
            expanded_config = pipeline.get("expanded_config")
            if isinstance(expanded_config, dict) and isinstance(expanded_config.get("pipeline"), list):
                canonical_steps = expanded_config["pipeline"]
            elif isinstance(expanded_config, list):
                canonical_steps = expanded_config
            elif expanded_config is None:
                canonical_steps = []
            else:
                canonical_steps = [expanded_config]

            source_name = str(pipeline.get("name") or pipeline.get("pipeline_id") or "Pipeline").strip() or "Pipeline"
            if source_name.endswith("_refit"):
                source_name = source_name[:-len("_refit")]
            clone_name = _pipeline_clone_name(source_name, "(Rerun)", existing_names)
            clone_id = f"pipeline_{int(time.time())}_{uuid4().hex[:6]}"
            clone_description = f"Cloned from run {run_id}"
            editor_steps = canonical_to_editor(canonical_steps)
            normalized_steps = _normalize_and_validate_editor_steps(
                editor_steps,
                name=clone_name,
                description=clone_description,
            )

            saved_pipeline = {
                "id": clone_id,
                "name": clone_name,
                "description": clone_description,
                "category": "user",
                "steps": normalized_steps,
                "is_favorite": False,
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat(),
            }
            _save_pipeline(saved_pipeline)
            cloned_pipeline_ids.append(clone_id)
            cloned_pipelines.append({
                "id": clone_id,
                "name": clone_name,
                "source_pipeline_id": pipeline.get("pipeline_id"),
                "source_pipeline_name": pipeline.get("name"),
            })

        run_config = run.get("config") if isinstance(run.get("config"), dict) else {}
        dataset_ids = [str(dataset["linked_dataset_id"]) for dataset in datasets_result if dataset.get("linked_dataset_id")]
        split_group_by_by_dataset = {
            str(dataset["linked_dataset_id"]): (
                dataset.get("repetition")
                if isinstance(dataset.get("repetition"), str) and dataset.get("repetition")
                else None
            )
            for dataset in datasets_result
            if dataset.get("linked_dataset_id")
        }

        requested_cv_folds = run_config.get("cv_folds")
        cv_folds = int(requested_cv_folds) if isinstance(requested_cv_folds, (int, float)) and int(requested_cv_folds) > 1 else 5
        requested_random_state = run_config.get("random_state")
        random_state = int(requested_random_state) if isinstance(requested_random_state, (int, float)) else None
        requested_test_size = run_config.get("test_size")
        test_size = float(requested_test_size) if isinstance(requested_test_size, (int, float)) else 0.2

        run_name = str(run.get("name") or "").strip()
        launch_name = f"{run_name or 'Run'} (rerun)"
        request = CreateRunRequest(config=ExperimentConfig(
            name=launch_name,
            description=f"Rerun of {run_name or run_id}",
            dataset_ids=dataset_ids,
            pipeline_ids=cloned_pipeline_ids,
            cv_folds=cv_folds,
            cv_strategy=_normalize_rerun_cv_strategy(run_config.get("cv_strategy")),
            test_size=test_size,
            random_state=random_state,
            project_id=run.get("project_id"),
            split_group_by_by_dataset=split_group_by_by_dataset,
        ))
        launched_run = await create_run(request)

        return {
            "success": True,
            "source_run_id": run_id,
            "run": launched_run,
            "cloned_pipelines": cloned_pipelines,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to rerun run: {str(e)}",
        )


@router.delete("/workspaces/{workspace_id}/runs/{run_id}")
async def delete_workspace_run(workspace_id: str, run_id: str):
    """Delete a run from a workspace.

    When a store database is available, deletes the run with cascade
    (pipelines, chains, predictions, arrays, logs).  Returns 404
    if the workspace or store is not found.
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        workspace_path = Path(ws.path)
        scanner = WorkspaceScanner(workspace_path)

        if not scanner._has_store():
            raise HTTPException(status_code=501, detail="Run deletion requires a store database")

        result = await asyncio.to_thread(scanner.store_adapter.delete_run, run_id)

        # Invalidate cached runs for this workspace
        invalidate_workspace_cache(str(workspace_path))
        # Results caches are keyed by workspace_id; clear those too.
        _invalidate_results_caches(workspace_id)

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete run: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/runs/{run_id}/datasets/{dataset_name}/chains")
async def get_all_chains_for_dataset(workspace_id: str, run_id: str, dataset_name: str):
    """Get ALL chain summaries for a run+dataset, sorted by primary metric."""
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        from api.store_adapter import STORE_AVAILABLE, StoreAdapter
        if not STORE_AVAILABLE:
            return {"chains": [], "total": 0, "metric": None}

        workspace_path = Path(ws.path)
        store_path = workspace_path / "store.sqlite"
        if not store_path.exists():
            store_path = workspace_path / "store.duckdb"
        if not store_path.exists():
            return {"chains": [], "total": 0, "metric": None}

        def _fetch() -> Any:
            adapter = StoreAdapter(workspace_path)
            try:
                return adapter.get_all_chains_for_dataset(run_id, dataset_name)
            finally:
                adapter.close()

        return await asyncio.to_thread(_fetch)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workspaces/{workspace_id}/runs/{run_id}/datasets/{dataset_name}/scores")
async def get_score_distribution(workspace_id: str, run_id: str, dataset_name: str, n_bins: int = 20):
    """Get score distribution histogram data for a run+dataset."""
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        from api.store_adapter import STORE_AVAILABLE, StoreAdapter
        if not STORE_AVAILABLE:
            return {"dataset_name": dataset_name, "metric": None, "partitions": {}}

        workspace_path = Path(ws.path)

        def _fetch() -> Any:
            adapter = StoreAdapter(workspace_path)
            try:
                return adapter.get_score_distribution(run_id, dataset_name, n_bins=n_bins)
            finally:
                adapter.close()

        return await asyncio.to_thread(_fetch)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workspaces/{workspace_id}/results/summary")
async def get_workspace_results_summary(workspace_id: str, n: int = 5):
    """Get results summary: top N models per dataset across all runs.

    Cached at module scope keyed on (workspace_id, store file signature,
    dataset-links signature, n). Cache entries are validated against the
    current store signature on every read.
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        from api.store_adapter import STORE_AVAILABLE, StoreAdapter
        if not STORE_AVAILABLE:
            return {"workspace_id": workspace_id, "datasets": []}

        workspace_path = Path(ws.path)
        store_sig = _store_signature(workspace_path)
        if store_sig is None:
            return {"workspace_id": workspace_id, "datasets": []}

        linked_datasets = app_config.get_datasets()
        links_sig = _dataset_links_signature(linked_datasets)
        cache_key = (workspace_id, store_sig, links_sig, ("summary", n))

        cached = _RESULTS_SUMMARY_CACHE.get(cache_key)
        if cached is not None:
            return cached

        def _fetch() -> Any:
            adapter = StoreAdapter(workspace_path)
            try:
                result = adapter.get_dataset_top_chains(n=n)
                result["workspace_id"] = workspace_id

                # Resolve store dataset names to linked dataset IDs
                _resolve_dataset_mapping(result.get("datasets", []), linked_datasets)
                return result
            finally:
                adapter.close()

        result = await asyncio.to_thread(_fetch)
        _RESULTS_SUMMARY_CACHE[cache_key] = result
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workspaces/{workspace_id}/results/dataset-scores")
async def get_workspace_dataset_scores(workspace_id: str):
    """Compact best-score-per-dataset endpoint for the Datasets page.

    Returns only the fields needed to render the per-dataset best-score badges,
    avoiding the heavy `top_chains` payload that the Results page consumes via
    `/results/summary`. Cached using the same key shape as
    `get_workspace_results_summary`, in a separate cache namespace.
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        from api.store_adapter import STORE_AVAILABLE, StoreAdapter
        if not STORE_AVAILABLE:
            return {"workspace_id": workspace_id, "datasets": []}

        workspace_path = Path(ws.path)
        store_sig = _store_signature(workspace_path)
        if store_sig is None:
            return {"workspace_id": workspace_id, "datasets": []}

        linked_datasets = app_config.get_datasets()
        links_sig = _dataset_links_signature(linked_datasets)
        cache_key = (workspace_id, store_sig, links_sig, ("dataset_scores",))

        cached = _DATASET_SCORES_CACHE.get(cache_key)
        if cached is not None:
            return cached

        def _fetch() -> Any:
            adapter = StoreAdapter(workspace_path)
            try:
                return _build_dataset_scores_payload(adapter, workspace_id, linked_datasets)
            finally:
                adapter.close()

        payload = await asyncio.to_thread(_fetch)
        _DATASET_SCORES_CACHE[cache_key] = payload
        return payload
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workspaces/{workspace_id}/results/datasets/{dataset_name}/chains")
async def get_all_chains_for_results_dataset(workspace_id: str, dataset_name: str):
    """Get ALL chain summaries for one dataset across all runs."""
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        from api.store_adapter import STORE_AVAILABLE, StoreAdapter
        if not STORE_AVAILABLE:
            return {"chains": [], "total": 0, "metric": None}

        workspace_path = Path(ws.path)
        store_path = workspace_path / "store.sqlite"
        if not store_path.exists():
            store_path = workspace_path / "store.duckdb"
        if not store_path.exists():
            return {"chains": [], "total": 0, "metric": None}

        def _fetch() -> Any:
            adapter = StoreAdapter(workspace_path)
            try:
                return adapter.get_all_chains_for_results_dataset(dataset_name)
            finally:
                adapter.close()

        return await asyncio.to_thread(_fetch)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _discover_results(workspace_path: Path, run_id: str | None) -> list[dict[str, Any]]:
    """Discover results for a run (blocking; runs in a worker thread)."""
    scanner = WorkspaceScanner(workspace_path)
    return scanner.discover_results(run_id)


@router.get("/workspaces/{workspace_id}/results")
async def get_workspace_results(
    workspace_id: str,
    run_id: str | None = None,
    dataset: str | None = None,
    template_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    """Get individual results (pipeline config × dataset combinations).

    Results represent the granular level below runs - each result is
    one specific pipeline configuration executed on one dataset.

    Filters:
    - run_id: Filter to results from a specific run
    - dataset: Filter to results for a specific dataset
    - template_id: Filter to results from a specific template
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        # Discover all results
        all_results = await asyncio.to_thread(_discover_results, Path(ws.path), run_id)

        # Apply filters
        if dataset:
            all_results = [r for r in all_results if r.get("dataset") == dataset]
        if template_id:
            all_results = [r for r in all_results if r.get("template_id") == template_id]

        # Sort by best_score descending (best first)
        all_results.sort(
            key=lambda r: r.get("best_score") if r.get("best_score") is not None else float("-inf"),
            reverse=True
        )

        # Paginate
        total = len(all_results)
        paginated = all_results[offset:offset + limit]

        return {
            "workspace_id": workspace_id,
            "results": paginated,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get results: {str(e)}"
        )


def _discover_datasets(workspace_path: Path) -> list[dict[str, Any]]:
    """Discover datasets from run manifests (blocking; runs in a worker thread)."""
    scanner = WorkspaceScanner(workspace_path)
    runs = scanner.discover_runs()
    return scanner.extract_datasets(runs)


@router.get("/workspaces/{workspace_id}/datasets/discovered")
async def get_workspace_discovered_datasets(workspace_id: str):
    """Get datasets discovered from run manifests.

    This endpoint extracts unique datasets from all runs, including
    full metadata like n_samples, y_stats, and path status.
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        datasets = await asyncio.to_thread(_discover_datasets, Path(ws.path))

        return {
            "workspace_id": workspace_id,
            "datasets": datasets,
            "total": len(datasets),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get discovered datasets: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/predictions")
async def get_workspace_predictions(workspace_id: str):
    """Get discovered predictions from a linked workspace."""
    try:
        predictions = await asyncio.to_thread(
            workspace_manager.get_workspace_predictions, workspace_id
        )
        return {"predictions": predictions, "count": len(predictions)}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get predictions: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/predictions/data")
async def get_workspace_predictions_data(
    workspace_id: str,
    limit: int = 500,
    offset: int = 0,
    dataset: str | None = None,
    model_class: str | None = None,
    partition: str | None = None,
):
    """Get prediction records with metadata.

    When a store database is available, reads directly from the store
    (fast, paginated at the DB level).  Otherwise falls back to reading
    ``.meta.parquet`` files with pandas.
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        scanner = WorkspaceScanner(Path(ws.path))
        return await asyncio.to_thread(
            scanner.read_predictions_data,
            limit,
            offset,
            dataset,
            model_class,
            partition,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to read predictions data: {str(e)}"
        )


@router.delete("/workspaces/{workspace_id}/predictions/datasets/{dataset_name}")
async def delete_workspace_dataset_predictions(workspace_id: str, dataset_name: str):
    """Delete all predictions for one dataset in a linked workspace."""
    try:
        if _has_active_non_maintenance_jobs():
            raise HTTPException(
                status_code=409,
                detail="Another active job is running. Stop active jobs before deletion.",
            )

        _ws, workspace_path, scanner = _resolve_store_backed_scanner(
            workspace_id, "Prediction deletion requires a store database"
        )
        result = await asyncio.to_thread(
            scanner.store_adapter.delete_dataset_predictions, dataset_name
        )

        invalidate_workspace_cache(str(workspace_path))
        _invalidate_results_caches(workspace_id)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete dataset predictions: {str(e)}",
        )


@router.delete("/workspaces/{workspace_id}/predictions/chains/{chain_id}")
async def delete_workspace_chain_predictions(workspace_id: str, chain_id: str):
    """Delete all predictions for one displayed model variant in a workspace."""
    try:
        if _has_active_non_maintenance_jobs():
            raise HTTPException(
                status_code=409,
                detail="Another active job is running. Stop active jobs before deletion.",
            )

        _ws, workspace_path, scanner = _resolve_store_backed_scanner(
            workspace_id, "Prediction deletion requires a store database"
        )
        result = await asyncio.to_thread(
            scanner.store_adapter.delete_chain_predictions, chain_id
        )

        invalidate_workspace_cache(str(workspace_path))
        _invalidate_results_caches(workspace_id)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete chain predictions: {str(e)}",
        )


@router.delete("/workspaces/{workspace_id}/predictions/chains/{chain_id}/folds/{fold_id}")
async def delete_workspace_prediction_group(workspace_id: str, chain_id: str, fold_id: str):
    """Delete one displayed prediction group (chain + fold)."""
    try:
        if _has_active_non_maintenance_jobs():
            raise HTTPException(
                status_code=409,
                detail="Another active job is running. Stop active jobs before deletion.",
            )

        _ws, workspace_path, scanner = _resolve_store_backed_scanner(
            workspace_id, "Prediction deletion requires a store database"
        )
        result = await asyncio.to_thread(
            scanner.store_adapter.delete_prediction_group, chain_id, fold_id
        )

        invalidate_workspace_cache(str(workspace_path))
        _invalidate_results_caches(workspace_id)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete prediction group: {str(e)}",
        )


@router.delete("/workspaces/{workspace_id}/predictions/{prediction_id}")
async def delete_workspace_prediction(workspace_id: str, prediction_id: str):
    """Delete one stored prediction row by ID."""
    try:
        if _has_active_non_maintenance_jobs():
            raise HTTPException(
                status_code=409,
                detail="Another active job is running. Stop active jobs before deletion.",
            )

        _ws, workspace_path, scanner = _resolve_store_backed_scanner(
            workspace_id, "Prediction deletion requires a store database"
        )
        result = await asyncio.to_thread(
            scanner.store_adapter.delete_prediction, prediction_id
        )

        invalidate_workspace_cache(str(workspace_path))
        _invalidate_results_caches(workspace_id)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to delete prediction: {str(e)}",
        )


@router.get("/workspaces/{workspace_id}/predictions/{prediction_id}/scatter")
async def get_prediction_scatter_data(workspace_id: str, prediction_id: str):
    """Get scatter plot data (y_true vs y_pred) for a specific prediction.

    When a store database is available, loads arrays directly from the
    store.  Otherwise falls back to ``.arrays.parquet`` files.

    Returns:
        - y_true: Actual values array
        - y_pred: Predicted values array
        - n_samples: Number of data points
        - partition: Data partition (train/val/test)
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        scanner = WorkspaceScanner(Path(ws.path))
        return await asyncio.to_thread(
            scanner.read_prediction_scatter, prediction_id
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get scatter data: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/predictions/summary")
async def get_workspace_predictions_summary(workspace_id: str):
    """Get aggregated prediction summary.

    When a store database is available, the summary is computed directly
    from the store (fast).  Otherwise falls back to reading parquet
    file footers.

    Returns:
    - Total predictions across all datasets
    - Model breakdown with average scores
    - Top predictions by validation score
    """
    try:
        ws = workspace_manager._find_linked_workspace(workspace_id)
        if not ws:
            raise HTTPException(status_code=404, detail="Workspace not found")

        scanner = WorkspaceScanner(Path(ws.path))
        return await asyncio.to_thread(scanner.read_predictions_summary)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to read predictions summary: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/exports")
async def get_workspace_exports(workspace_id: str):
    """Get discovered exports from a linked workspace."""
    try:
        exports = await asyncio.to_thread(
            workspace_manager.get_workspace_exports, workspace_id
        )
        return {"exports": exports, "count": len(exports)}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get exports: {str(e)}"
        )


@router.get("/workspaces/{workspace_id}/templates")
async def get_workspace_templates(workspace_id: str):
    """Get discovered library templates from a linked workspace."""
    try:
        templates = await asyncio.to_thread(
            workspace_manager.get_workspace_templates, workspace_id
        )
        return {"templates": templates, "count": len(templates)}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get templates: {str(e)}"
        )
