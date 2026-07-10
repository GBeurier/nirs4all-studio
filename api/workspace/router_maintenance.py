"""Workspace statistics, storage status, migration, compaction, cleanup,
and workspace settings routes (Phase 5).
"""

import asyncio
import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from ..jobs import JobType, job_manager
from ..lazy_imports import get_cached
from ..shared.logger import get_logger
from ..workspace_manager import WorkspaceScanner, workspace_manager
from ._shared import (
    PREDICTIONS_AVAILABLE,
    STORE_AVAILABLE,
    _compute_directory_size,
    _get_storage_status_for_workspace,
    _has_active_non_maintenance_jobs,
    _invalidate_results_caches,
)
from .models import (
    CleanCacheRequest,
    CleanCacheResponse,
    CleanDeadLinksReport,
    CleanDeadLinksRequest,
    CompactReport,
    CompactRequest,
    DataLoadingDefaults,
    DatasetStorageInfo,
    LegacyWorkspaceConversionRequest,
    LegacyWorkspaceConversionResponse,
    MigrationJobResponse,
    MigrationReportResponse,
    MigrationRequest,
    MigrationStatusResponse,
    RemoveBottomReport,
    RemoveBottomRequest,
    SpaceUsageItem,
    StorageHealthResponse,
    StorageStatusResponse,
    WorkspaceSettingsResponse,
    WorkspaceStatsResponse,
    WorkspaceTransitionStatusResponse,
)
from .services import (
    _build_legacy_conversion_command,
    _call_migrate_arrays_to_parquet,
    _estimate_migration_duration_seconds,
    _extract_corrupt_files,
    _extract_orphan_counts,
    _get_legacy_arrays_row_count,
    _inspect_legacy_workspace_transition,
    _invoke_predictions_method,
    _run_legacy_workspace_converter,
)

# WebSocket notifications (optional). Imported as a top-level module to match
# the original workspace.py import surface.
try:
    from websocket import (
        notify_maintenance_completed,
        notify_maintenance_failed,
        notify_maintenance_progress,
        notify_maintenance_started,
    )
    WS_AVAILABLE = True
except Exception:
    notify_maintenance_started = None  # type: ignore[assignment]
    notify_maintenance_progress = None  # type: ignore[assignment]
    notify_maintenance_completed = None  # type: ignore[assignment]
    notify_maintenance_failed = None  # type: ignore[assignment]
    WS_AVAILABLE = False

logger = get_logger(__name__)

router = APIRouter()


def _link_converted_workspace(output_path: Path) -> dict[str, str | None]:
    """Link and activate a successfully converted workspace."""
    linked = workspace_manager.link_workspace_internal(
        str(output_path.resolve()),
        output_path.name,
        is_new=True,
    )
    activated = workspace_manager.activate_workspace(linked.id) or linked
    return {
        "linked_workspace_id": activated.id,
        "active_workspace_path": activated.path,
        "link_error": None,
    }


def _run_async_notification(coro: Any) -> None:
    """Run an async notification from sync code safely."""
    if not coro:
        return
    try:
        asyncio.run(coro)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(coro)
        finally:
            loop.close()
    except Exception:
        pass


def _emit_maintenance_started(job_id: str, operation: str, details: dict[str, Any]) -> None:
    if WS_AVAILABLE and notify_maintenance_started is not None:
        _run_async_notification(notify_maintenance_started(job_id, operation, details))


def _emit_maintenance_progress(job_id: str, progress: float, message: str = "") -> None:
    if WS_AVAILABLE and notify_maintenance_progress is not None:
        _run_async_notification(notify_maintenance_progress(job_id, progress, message))


def _emit_maintenance_completed(job_id: str, operation: str, report: dict[str, Any]) -> None:
    if WS_AVAILABLE and notify_maintenance_completed is not None:
        _run_async_notification(notify_maintenance_completed(job_id, operation, report))
    # Maintenance jobs (migration, compaction, predictions cleanup) can mutate
    # store contents. Conservatively drop all results caches; entries with a
    # stale store signature would be rejected anyway, but this also clears
    # them eagerly.
    _invalidate_results_caches(None)


def _emit_maintenance_failed(job_id: str, operation: str, error: str) -> None:
    if WS_AVAILABLE and notify_maintenance_failed is not None:
        _run_async_notification(notify_maintenance_failed(job_id, operation, error))


def _compute_workspace_stats(workspace: Any) -> WorkspaceStatsResponse:
    """Compute workspace statistics (blocking; runs in a worker thread)."""
    workspace_path = Path(workspace.path)

    # Define categories and their directories. The structure here must
    # match what ``ensure_default_workspace`` creates and what the rest
    # of nirs4all writes to (runs/, exports/, library/, plus the
    # arrays/ directory used by the new Parquet storage backend).
    categories = [
        ("Runs",            workspace_path / "runs"),
        ("Exports",         workspace_path / "exports"),
        ("Templates",       workspace_path / "library" / "templates"),
        ("Trained models",  workspace_path / "library" / "trained"),
        ("Prediction arrays", workspace_path / "arrays"),
        ("Cache",           workspace_path / ".cache"),
        ("Temp",            workspace_path / ".tmp"),
    ]

    space_usage: list[SpaceUsageItem] = []
    total_workspace_size = 0
    duckdb_size_bytes = 0
    parquet_arrays_size_bytes = 0

    # Compute size for each category
    for name, directory in categories:
        size_bytes, file_count = _compute_directory_size(directory)
        space_usage.append(SpaceUsageItem(
            name=name,
            size_bytes=size_bytes,
            file_count=file_count,
            percentage=0.0,  # Will be calculated after total is known
        ))
        total_workspace_size += size_bytes
        if name == "Prediction arrays":
            parquet_arrays_size_bytes = size_bytes

    # Add workspace.json and other root files
    for file in workspace_path.iterdir():
        if file.is_file():
            try:
                total_workspace_size += file.stat().st_size
                if file.name in ("store.sqlite", "store.duckdb"):
                    duckdb_size_bytes = file.stat().st_size
            except (OSError, PermissionError):
                pass

    # Calculate percentages
    if total_workspace_size > 0:
        for item in space_usage:
            item.percentage = round((item.size_bytes / total_workspace_size) * 100, 1)

    # Calculate external dataset sizes
    external_datasets_size = 0
    for dataset in workspace.datasets:
        dataset_path = Path(dataset.get("path", ""))
        if dataset_path.exists():
            size, _ = _compute_directory_size(dataset_path)
            external_datasets_size += size

    storage_status = _get_storage_status_for_workspace(workspace_path)

    # Workspace-scoped counts: read directly from the active workspace
    # via the same scanner used by the Discovery panel so the Settings
    # card always reflects what nirs4all itself sees. The scanner
    # transparently uses the SQLite store when present and falls back
    # to filesystem manifests otherwise.
    runs_count = 0
    datasets_count = 0
    predictions_count = 0
    models_count = 0
    try:
        scanner = WorkspaceScanner(workspace_path)
        scan_result = scanner.scan()
        summary = scan_result.get("summary", {})
        runs_count = int(summary.get("runs_count", 0))
        datasets_count = int(summary.get("datasets_count", 0))
        predictions_count = int(summary.get("predictions_count", 0))
        # "Trained models" in the workspace are exported pipelines under
        # library/trained/ plus exports/ entries; both are surfaced as
        # ``exports`` by the scanner.
        models_count = int(summary.get("exports_count", 0))
    except Exception as scan_exc:
        # Don't fail the whole stats endpoint if the scanner errors out
        # (e.g. on a freshly-created empty workspace) — just report zero.
        logger.warning("Workspace scan during /workspace/stats failed: %s", scan_exc)

    return WorkspaceStatsResponse(
        path=str(workspace_path),
        name=workspace.name,
        total_size_bytes=total_workspace_size,
        space_usage=space_usage,
        linked_datasets_count=len(workspace.datasets),
        linked_datasets_external_size=external_datasets_size,
        duckdb_size_bytes=duckdb_size_bytes,
        parquet_arrays_size_bytes=parquet_arrays_size_bytes,
        storage_mode=str(storage_status.get("storage_mode", "unknown")),
        created_at=workspace.created_at,
        last_accessed=workspace.last_accessed,
        runs_count=runs_count,
        datasets_count=datasets_count,
        predictions_count=predictions_count,
        models_count=models_count,
    )


@router.get("/workspace/stats", response_model=WorkspaceStatsResponse)
async def get_workspace_stats():
    """
    Get workspace statistics including space usage breakdown.

    Returns detailed statistics about the workspace storage usage,
    broken down by category (results, models, predictions, pipelines).
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        return await asyncio.to_thread(_compute_workspace_stats, workspace)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get workspace stats: {str(e)}"
        )


@router.get("/workspace/storage-status", response_model=StorageStatusResponse)
async def get_workspace_storage_status():
    """Get current workspace storage backend status."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        status = await asyncio.to_thread(
            _get_storage_status_for_workspace, Path(workspace.path)
        )
        return StorageStatusResponse(**status)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get storage status: {str(e)}"
        )


@router.get("/workspace/migrate/status", response_model=MigrationStatusResponse)
async def get_workspace_migration_status():
    """Get migration status and rough migration estimate."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        workspace_path = Path(workspace.path)

        def _compute() -> MigrationStatusResponse:
            status = _get_storage_status_for_workspace(workspace_path)
            legacy_row_count = _get_legacy_arrays_row_count(workspace_path)
            estimated_duration_seconds = _estimate_migration_duration_seconds(legacy_row_count)
            return MigrationStatusResponse(
                migration_needed=bool(status.get("migration_needed", False)),
                storage_mode=str(status.get("storage_mode", "unknown")),
                legacy_row_count=legacy_row_count,
                estimated_duration_seconds=estimated_duration_seconds,
            )

        return await asyncio.to_thread(_compute)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get migration status: {str(e)}"
        )


@router.get("/workspace/transition-status", response_model=WorkspaceTransitionStatusResponse)
async def get_workspace_transition_status():
    """Detect legacy workspace formats that need transition conversion."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        status = await asyncio.to_thread(
            _inspect_legacy_workspace_transition,
            Path(workspace.path),
        )
        return WorkspaceTransitionStatusResponse(**status)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get transition status: {str(e)}"
        )


@router.post(
    "/workspace/legacy-convert",
    response_model=LegacyWorkspaceConversionResponse,
)
async def convert_legacy_workspace(request: LegacyWorkspaceConversionRequest):
    """Convert the active legacy workspace into a fresh V1 workspace."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        workspace_path = Path(workspace.path)
        status = await asyncio.to_thread(_inspect_legacy_workspace_transition, workspace_path)
        if not bool(status.get("conversion_required")):
            raise HTTPException(status_code=409, detail="Active workspace does not require legacy conversion")

        output_path = Path(request.output_path) if request.output_path else Path(str(status["default_output_path"]))
        command = _build_legacy_conversion_command(
            workspace_path,
            output_path,
            verify=request.verify,
            dry_run=request.dry_run,
            strict=request.strict,
        )

        if request.dry_run:
            result = await asyncio.to_thread(_run_legacy_workspace_converter, command)
            if not result["success"]:
                raise HTTPException(status_code=500, detail=result["stderr"] or result["stdout"] or "Legacy conversion dry-run failed")
            return LegacyWorkspaceConversionResponse(
                command=command,
                output_path=str(output_path),
                dry_run=True,
                link_converted_workspace=False,
                **result,
            )

        if _has_active_non_maintenance_jobs():
            raise HTTPException(
                status_code=409,
                detail="Another active job is running. Stop active jobs before legacy conversion.",
            )

        job_config = {
            "operation": "legacy_workspace_conversion",
            "workspace_path": str(workspace_path),
            "output_path": str(output_path),
            "command": command,
            "link_converted_workspace": request.link_converted_workspace,
        }
        job = job_manager.create_job(JobType.MAINTENANCE, job_config)

        def _run_conversion_task(job_obj: Any, progress_callback: Any) -> dict[str, Any]:
            operation = "legacy_workspace_conversion"

            def _progress(value: float, message: str) -> None:
                try:
                    progress_callback(value, message)
                except Exception:
                    pass
                _emit_maintenance_progress(job_obj.id, value, message)

            _emit_maintenance_started(job_obj.id, operation, job_config)
            _progress(5.0, "Starting legacy workspace conversion")
            result = _run_legacy_workspace_converter(command)
            if not result["success"]:
                _emit_maintenance_failed(job_obj.id, operation, result["stderr"] or "Legacy conversion failed")
                raise RuntimeError(result["stderr"] or result["stdout"] or "Legacy conversion failed")
            link_payload: dict[str, str | None] = {
                "linked_workspace_id": None,
                "active_workspace_path": None,
                "link_error": None,
            }
            if request.link_converted_workspace:
                _progress(92.0, "Linking converted workspace")
                try:
                    link_payload = _link_converted_workspace(output_path)
                except Exception as exc:
                    link_payload["link_error"] = str(exc)
                    logger.warning("Legacy workspace conversion succeeded, but linking the converted workspace failed: %s", exc)
            _progress(100.0, "Legacy conversion completed")
            payload = {
                "operation": operation,
                "output_path": str(output_path),
                "command": command,
                "link_converted_workspace": request.link_converted_workspace,
                **link_payload,
                **result,
            }
            _emit_maintenance_completed(job_obj.id, operation, payload)
            return payload

        job_manager.submit_job(job, _run_conversion_task)
        return LegacyWorkspaceConversionResponse(
            job_id=job.id,
            command=command,
            output_path=str(output_path),
            dry_run=False,
            link_converted_workspace=request.link_converted_workspace,
            success=True,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to start legacy conversion: {str(e)}"
        )


@router.post(
    "/workspace/migrate",
    response_model=MigrationJobResponse | MigrationReportResponse,
)
async def migrate_workspace_arrays(request: MigrationRequest):
    """Migrate legacy prediction arrays to Parquet sidecar files."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        workspace_path = Path(workspace.path)

        if request.dry_run:
            report = await asyncio.to_thread(
                _call_migrate_arrays_to_parquet,
                workspace_path,
                dry_run=True,
                batch_size=request.batch_size,
            )
            return MigrationReportResponse(**report)

        if _has_active_non_maintenance_jobs():
            raise HTTPException(
                status_code=409,
                detail="Another active job is running. Stop active jobs before migration.",
            )

        job_config = {
            "operation": "migration",
            "workspace_path": str(workspace_path),
            "dry_run": False,
            "batch_size": request.batch_size,
        }
        job = job_manager.create_job(JobType.MAINTENANCE, job_config)

        def _run_migration_task(job_obj: Any, progress_callback: Any) -> dict[str, Any]:
            operation = "migration"

            def _progress(value: float, message: str) -> None:
                try:
                    progress_callback(value, message)
                except Exception:
                    pass
                _emit_maintenance_progress(job_obj.id, value, message)

            _emit_maintenance_started(
                job_obj.id,
                operation,
                {
                    "workspace_path": str(workspace_path),
                    "batch_size": request.batch_size,
                },
            )
            _progress(2.0, "Preparing migration")
            try:
                report = _call_migrate_arrays_to_parquet(
                    workspace_path,
                    dry_run=False,
                    batch_size=request.batch_size,
                )
                _progress(100.0, "Migration completed")
                _emit_maintenance_completed(job_obj.id, operation, report)
                return {"operation": operation, "report": report}
            except Exception as exc:
                _emit_maintenance_failed(job_obj.id, operation, str(exc))
                raise

        job_manager.submit_job(job, _run_migration_task)
        return MigrationJobResponse(job_id=job.id)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to start migration: {str(e)}"
        )


@router.post("/workspace/compact", response_model=CompactReport)
async def compact_workspace_storage(request: CompactRequest):
    """Compact Parquet array files for one dataset or all datasets."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        if _has_active_non_maintenance_jobs():
            raise HTTPException(
                status_code=409,
                detail="Another active job is running. Stop active jobs before compaction.",
            )

        result = await asyncio.to_thread(
            _invoke_predictions_method,
            Path(workspace.path),
            "compact",
            dataset_name=request.dataset_name,
        )

        if "datasets" not in result:
            dataset_key = request.dataset_name or "all"
            if all(k in result for k in ("rows_before", "rows_after", "rows_removed")):
                result = {"datasets": {dataset_key: result}}
            else:
                result = {"datasets": {}}

        return CompactReport(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compact storage: {str(e)}")


@router.post("/workspace/clean-dead-links", response_model=CleanDeadLinksReport)
async def clean_workspace_dead_links(request: CleanDeadLinksRequest):
    """Clean orphan metadata/array links in storage."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        if not request.dry_run and _has_active_non_maintenance_jobs():
            raise HTTPException(
                status_code=409,
                detail="Another active job is running. Stop active jobs before cleanup.",
            )

        result = await asyncio.to_thread(
            _invoke_predictions_method,
            Path(workspace.path),
            "clean_dead_links",
            dry_run=request.dry_run,
        )
        return CleanDeadLinksReport(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clean dead links: {str(e)}")


@router.post("/workspace/remove-bottom", response_model=RemoveBottomReport)
async def remove_bottom_predictions(request: RemoveBottomRequest):
    """Remove the bottom fraction of predictions based on a ranking metric."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        if not request.dry_run and _has_active_non_maintenance_jobs():
            raise HTTPException(
                status_code=409,
                detail="Another active job is running. Stop active jobs before removal.",
            )

        result = await asyncio.to_thread(
            _invoke_predictions_method,
            Path(workspace.path),
            "remove_bottom",
            fraction=request.fraction,
            metric=request.metric or "val_score",
            partition=request.partition or "val",
            dataset_name=request.dataset_name,
            dry_run=request.dry_run,
        )
        return RemoveBottomReport(**result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to remove bottom predictions: {str(e)}")


def _compute_storage_health(workspace_path: Path) -> StorageHealthResponse:
    """Compute combined storage health (blocking; runs in a worker thread)."""
    status = _get_storage_status_for_workspace(workspace_path)

    duckdb_size_bytes = 0
    db_path = workspace_path / "store.sqlite"
    if not db_path.exists():
        db_path = workspace_path / "store.duckdb"
    if db_path.exists():
        try:
            duckdb_size_bytes = db_path.stat().st_size
        except Exception:
            duckdb_size_bytes = 0

    arrays_path = workspace_path / "arrays"
    parquet_total_size_bytes, _ = _compute_directory_size(arrays_path)

    total_predictions = 0
    dataset_rows: list[dict[str, Any]] = []
    if STORE_AVAILABLE and db_path.exists():
        try:
            store = get_cached("WorkspaceStore")(workspace_path)
            try:
                total_df = store._fetch_pl("SELECT COUNT(*) AS cnt FROM predictions")
                if len(total_df) > 0:
                    total_predictions = int(total_df.row(0, named=True).get("cnt", 0) or 0)

                dataset_df = store._fetch_pl(
                    "SELECT dataset_name, COUNT(*) AS prediction_count "
                    "FROM predictions GROUP BY dataset_name ORDER BY dataset_name"
                )
                dataset_rows = list(dataset_df.iter_rows(named=True))
            finally:
                store.close()
        except Exception:
            dataset_rows = []

    datasets: list[DatasetStorageInfo] = []
    parquet_by_dataset: dict[str, int] = {}
    if arrays_path.exists() and arrays_path.is_dir():
        for parquet_file in arrays_path.glob("*.parquet"):
            dataset_name = parquet_file.stem
            try:
                parquet_by_dataset[dataset_name] = parquet_file.stat().st_size
            except Exception:
                parquet_by_dataset[dataset_name] = 0

    seen_names: set[str] = set()
    for row in dataset_rows:
        ds_name = str(row.get("dataset_name") or "")
        if not ds_name:
            continue
        seen_names.add(ds_name)
        datasets.append(
            DatasetStorageInfo(
                name=ds_name,
                prediction_count=int(row.get("prediction_count", 0) or 0),
                parquet_size_bytes=int(parquet_by_dataset.get(ds_name, 0)),
            )
        )

    for ds_name, ds_size in parquet_by_dataset.items():
        if ds_name in seen_names:
            continue
        datasets.append(
            DatasetStorageInfo(
                name=ds_name,
                prediction_count=0,
                parquet_size_bytes=int(ds_size),
            )
        )

    datasets.sort(key=lambda d: d.name.lower())

    orphan_metadata_count = 0
    orphan_array_count = 0
    corrupt_files: list[str] = []

    # Best-effort integrity/orphan detection using predictions maintenance APIs.
    if PREDICTIONS_AVAILABLE:
        try:
            dry_result = _invoke_predictions_method(
                workspace_path,
                "clean_dead_links",
                dry_run=True,
            )
            orphan_metadata_count, orphan_array_count = _extract_orphan_counts(dry_result)
        except Exception:
            pass

        try:
            integrity_result = _invoke_predictions_method(workspace_path, "integrity_check")
            corrupt_files = _extract_corrupt_files(integrity_result)
            if orphan_metadata_count == 0 and orphan_array_count == 0:
                orphan_metadata_count, orphan_array_count = _extract_orphan_counts(integrity_result)
        except Exception:
            pass

    return StorageHealthResponse(
        storage_mode=str(status.get("storage_mode", "unknown")),
        migration_needed=bool(status.get("migration_needed", False)),
        duckdb_size_bytes=duckdb_size_bytes,
        parquet_total_size_bytes=parquet_total_size_bytes,
        total_predictions=total_predictions,
        total_datasets=len(datasets),
        datasets=datasets,
        orphan_metadata_count=orphan_metadata_count,
        orphan_array_count=orphan_array_count,
        corrupt_files=corrupt_files,
    )


@router.get("/workspace/storage-health", response_model=StorageHealthResponse)
async def get_workspace_storage_health():
    """Combined storage health: integrity check + stats + migration status."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        return await asyncio.to_thread(_compute_storage_health, Path(workspace.path))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get storage health: {str(e)}"
        )


def _clean_cache(workspace_path: Path, request: CleanCacheRequest) -> CleanCacheResponse:
    """Clean workspace cache and temp files (blocking; runs in a worker thread)."""
    files_removed = 0
    bytes_freed = 0
    categories_cleaned: list[str] = []

    # Clean temporary files
    if request.clean_temp:
        temp_dirs = [workspace_path / ".tmp", workspace_path / ".cache"]
        for temp_dir in temp_dirs:
            if temp_dir.exists():
                for file in temp_dir.rglob("*"):
                    if file.is_file():
                        try:
                            bytes_freed += file.stat().st_size
                            file.unlink()
                            files_removed += 1
                        except (OSError, PermissionError):
                            pass
                categories_cleaned.append(temp_dir.name)

    # Clean old predictions
    if request.clean_old_predictions:
        predictions_dir = workspace_path / "predictions"
        if predictions_dir.exists():
            threshold = datetime.now().timestamp() - (request.days_threshold * 24 * 60 * 60)
            for file in predictions_dir.rglob("*"):
                if file.is_file():
                    try:
                        if file.stat().st_mtime < threshold:
                            bytes_freed += file.stat().st_size
                            file.unlink()
                            files_removed += 1
                    except (OSError, PermissionError):
                        pass
            if files_removed > 0:
                categories_cleaned.append("old_predictions")

    # Clean orphan results (results without matching run in workspace.json)
    if request.clean_orphan_results:
        results_dir = workspace_path / "results"
        if results_dir.exists():
            # Get list of known run IDs from workspace
            known_runs = set()
            runs_file = workspace_path / "runs.json"
            if runs_file.exists():
                try:
                    with open(runs_file, encoding="utf-8") as f:
                        runs_data = json.load(f)
                        for run in runs_data.get("runs", []):
                            known_runs.add(run.get("id"))
                except Exception:
                    pass

            # Remove results not in known runs
            for item in results_dir.iterdir():
                if item.is_dir() and item.name not in known_runs:
                    try:
                        size, _ = _compute_directory_size(item)
                        bytes_freed += size
                        shutil.rmtree(item)
                        files_removed += 1
                    except (OSError, PermissionError):
                        pass

            if files_removed > 0:
                categories_cleaned.append("orphan_results")

    return CleanCacheResponse(
        success=True,
        files_removed=files_removed,
        bytes_freed=bytes_freed,
        categories_cleaned=categories_cleaned,
    )


@router.post("/workspace/clean-cache", response_model=CleanCacheResponse)
async def clean_cache(request: CleanCacheRequest):
    """
    Clean workspace cache and temporary files.

    Options:
    - clean_temp: Remove temporary files from .tmp directory
    - clean_orphan_results: Remove result files without associated runs
    - clean_old_predictions: Remove predictions older than threshold
    """
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        return await asyncio.to_thread(_clean_cache, Path(workspace.path), request)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to clean cache: {str(e)}"
        )


@router.get("/workspace/settings", response_model=WorkspaceSettingsResponse)
async def get_workspace_settings():
    """Get workspace settings including data loading defaults."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        settings = workspace_manager.get_workspace_settings()
        return WorkspaceSettingsResponse(**settings)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get workspace settings: {str(e)}"
        )


@router.put("/workspace/settings")
async def update_workspace_settings(settings: dict[str, Any]):
    """Update workspace settings."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        success = workspace_manager.save_workspace_settings(settings)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to save settings")

        return {
            "success": True,
            "message": "Settings updated successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update workspace settings: {str(e)}"
        )


@router.get("/workspace/data-defaults", response_model=DataLoadingDefaults)
async def get_data_loading_defaults():
    """Get default settings for data loading in dataset wizard."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            # Return system defaults if no workspace
            return DataLoadingDefaults()

        settings = workspace_manager.get_workspace_settings()
        defaults = settings.get("data_loading_defaults", {})
        return DataLoadingDefaults(**defaults) if defaults else DataLoadingDefaults()

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to get data loading defaults: {str(e)}"
        )


@router.put("/workspace/data-defaults")
async def update_data_loading_defaults(defaults: DataLoadingDefaults):
    """Update default settings for data loading."""
    try:
        workspace = workspace_manager.get_current_workspace()
        if not workspace:
            raise HTTPException(status_code=409, detail="No workspace selected")

        settings = workspace_manager.get_workspace_settings()
        settings["data_loading_defaults"] = defaults.model_dump()
        success = workspace_manager.save_workspace_settings(settings)

        if not success:
            raise HTTPException(status_code=500, detail="Failed to save defaults")

        return {
            "success": True,
            "message": "Data loading defaults updated",
            "defaults": defaults.model_dump(),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to update data loading defaults: {str(e)}"
        )
