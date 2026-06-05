"""Non-routing services for the workspace API package.

Contains the heavier business logic that the routers call: dataset-name →
linked-id matching, rerun pipeline cloning helpers, the compact dataset-scores
payload builder, and the predictions-maintenance compatibility shims. None of
these are FastAPI handlers; they are pure helpers invoked from the routers.
"""

import inspect
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import HTTPException

from ..lazy_imports import get_cached
from ..shared.logger import get_logger
from ._shared import MIGRATION_AVAILABLE, PREDICTIONS_AVAILABLE, STORE_AVAILABLE

if TYPE_CHECKING:
    from ..store_adapter import StoreAdapter

logger = get_logger(__name__)


# ============= Dataset name → linked-id matching =============


def _dataset_match_key(value: Any) -> str:
    """Normalize dataset names/paths into a comparable lowercase key."""
    if not isinstance(value, str):
        return ""
    return "".join(c if c.isalnum() else "_" for c in value).lower()


def _resolve_dataset_mapping(datasets_result: list[dict], linked_datasets: list) -> None:
    """Resolve store dataset_name → linked dataset ID using smart matching.

    Matching strategies (in priority order):
    1. Exact normalized name match (case-insensitive)
    2. folder_to_name(linked_path) is a prefix of store name (longest wins)
    3. Linked name is a prefix of store name (longest wins)

    Mutates each entry in datasets_result to add ``linked_dataset_id``.
    """
    if not linked_datasets:
        return

    # Build list of (id, raw_name_lower, normalized_name, normalized_folder_name)
    linked_info: list[tuple[str, str, str, str]] = []
    linked_ids: set[str] = set()
    for ld in linked_datasets:
        ld_id = ld.id if hasattr(ld, "id") else ld.get("id", "")
        ld_name = ld.name if hasattr(ld, "name") else ld.get("name", "")
        ld_path = ld.path if hasattr(ld, "path") else ld.get("path", "")
        ld_id = str(ld_id or "")
        name_lower = ld_name.lower() if ld_name else ""
        name_key = _dataset_match_key(ld_name)
        folder_key = ""
        if ld_path:
            folder_key = _dataset_match_key(Path(ld_path).name)
        linked_ids.add(ld_id)
        linked_info.append((ld_id, name_lower, name_key, folder_key))

    for ds_entry in datasets_result:
        store_name = (
            ds_entry.get("dataset_name")
            or ds_entry.get("name")
            or ds_entry.get("dataset")
            or ""
        )
        if not store_name:
            continue

        if not ds_entry.get("name"):
            ds_entry["name"] = store_name
        if not ds_entry.get("dataset_name"):
            ds_entry["dataset_name"] = store_name

        existing_linked_id = str(ds_entry.get("linked_dataset_id") or "")
        if existing_linked_id and existing_linked_id in linked_ids:
            continue

        store_lower = str(store_name).lower()
        store_key = _dataset_match_key(store_name)
        matched_id: str | None = None

        # Strategy 1: exact name match (case-insensitive / normalized)
        for ld_id, name_lower, name_key, _ in linked_info:
            if store_lower == name_lower or (store_key and store_key == name_key):
                matched_id = ld_id
                break
        if matched_id:
            ds_entry["linked_dataset_id"] = matched_id
            continue

        # Strategy 2: folder_to_name(path) is a prefix of store name (longest wins)
        best_id: str | None = None
        best_len = 0
        for ld_id, _, _, folder_key in linked_info:
            if folder_key and store_key.startswith(folder_key) and len(folder_key) > best_len:
                best_id = ld_id
                best_len = len(folder_key)

        if best_id:
            ds_entry["linked_dataset_id"] = best_id
            continue

        # Strategy 3: linked name prefix (longest wins)
        for ld_id, _, name_key, _ in linked_info:
            if name_key and store_key.startswith(name_key) and len(name_key) > best_len:
                best_id = ld_id
                best_len = len(name_key)

        if best_id:
            ds_entry["linked_dataset_id"] = best_id


def _normalize_run_dataset_entries(raw_datasets: Any) -> list[dict[str, Any]]:
    """Normalize stored run dataset payloads to a list of dictionaries."""
    if not isinstance(raw_datasets, list):
        return []

    normalized: list[dict[str, Any]] = []
    for entry in raw_datasets:
        if isinstance(entry, dict):
            dataset_entry = dict(entry)
            dataset_name = (
                dataset_entry.get("dataset_name")
                or dataset_entry.get("name")
                or dataset_entry.get("dataset")
            )
            if isinstance(dataset_name, str) and dataset_name.strip():
                stripped_name = dataset_name.strip()
                dataset_entry.setdefault("name", stripped_name)
                dataset_entry.setdefault("dataset_name", stripped_name)
            normalized.append(dataset_entry)
        elif isinstance(entry, str) and entry.strip():
            dataset_name = entry.strip()
            normalized.append({"name": dataset_name, "dataset_name": dataset_name})
    return normalized


# ============= Rerun pipeline cloning helpers =============


def _rerunnable_pipeline_rows(pipelines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Prefer base CV pipelines over generated refit pipelines for reruns."""
    base_pipelines = [pipeline for pipeline in pipelines if not pipeline.get("is_refit_pipeline")]
    return base_pipelines or pipelines


def _pipeline_clone_name(name: str, suffix: str, existing: set[str]) -> str:
    """Generate a readable clone name without colliding repeatedly."""
    candidate = f"{name} {suffix}".strip()
    if candidate not in existing:
        existing.add(candidate)
        return candidate

    index = 2
    while True:
        numbered = f"{candidate} {index}"
        if numbered not in existing:
            existing.add(numbered)
            return numbered
        index += 1


def _pipeline_rerun_signature(pipeline: dict[str, Any]) -> str:
    """Stable signature used to deduplicate stored pipeline rows across datasets."""
    name = str(pipeline.get("name") or "")
    expanded_config = pipeline.get("expanded_config")
    try:
        payload = json.dumps(expanded_config, sort_keys=True, default=str)
    except Exception:
        payload = str(expanded_config)
    return f"{name}::{payload}"


def _normalize_rerun_cv_strategy(value: Any) -> str:
    """Map inferred splitter names back to ``ExperimentConfig`` values."""
    if not isinstance(value, str):
        return "kfold"

    normalized = value.strip().lower()
    strategy_map = {
        "kfold": "kfold",
        "group_kfold": "kfold",
        "repeated_kfold": "kfold",
        "stratified_kfold": "stratified",
        "repeated_stratified_kfold": "stratified",
        "stratified_group_kfold": "stratified",
        "loo": "loo",
        "holdout": "holdout",
        "shuffle_split": "holdout",
        "stratified_shuffle_split": "holdout",
        "group_shuffle_split": "holdout",
    }
    return strategy_map.get(normalized, "kfold")


# ============= Dataset-scores payload builder =============


def _build_dataset_scores_payload(
    adapter: "StoreAdapter",
    workspace_id: str,
    linked_datasets: list,
) -> dict[str, Any]:
    """Compute the compact dataset-scores payload directly from
    ``v_chain_summary`` rows. Avoids loading pipeline metadata, parsing
    ``expanded_config``, or building any per-chain serialization that the
    Datasets page does not render.
    """
    try:
        df = adapter.store.query_chain_summaries()
    except Exception:
        return {"workspace_id": workspace_id, "datasets": []}

    if len(df) == 0:
        return {"workspace_id": workspace_id, "datasets": []}

    from nirs4all.pipeline.run import get_metric_info

    def _to_float(value: Any) -> float | None:
        if value is None:
            return None
        try:
            f = float(value)
        except (TypeError, ValueError):
            return None
        # Polars may give us NaN for missing scores; treat as missing.
        if f != f:  # NaN check
            return None
        return f

    def _is_better(candidate: float, incumbent: float | None, *, higher_is_better: bool) -> bool:
        if incumbent is None:
            return True
        return candidate > incumbent if higher_is_better else candidate < incumbent

    # Group rows by dataset_name. iter_rows(named=True) yields plain dicts.
    by_dataset: dict[str, list[dict[str, Any]]] = {}
    for row in df.iter_rows(named=True):
        ds = row.get("dataset_name") or ""
        if not ds:
            continue
        by_dataset.setdefault(ds, []).append(row)

    datasets_out: list[dict[str, Any]] = []
    for ds_name in sorted(by_dataset):
        rows = by_dataset[ds_name]
        metric = next((r.get("metric") for r in rows if r.get("metric")), "r2")
        higher_is_better = bool(get_metric_info(metric).get("higher_is_better", True))

        best_final_row: dict[str, Any] | None = None
        best_final_score: float | None = None
        best_cv_row: dict[str, Any] | None = None
        best_cv_score: float | None = None

        for r in rows:
            final = _to_float(r.get("final_test_score"))
            if final is not None and _is_better(final, best_final_score, higher_is_better=higher_is_better):
                best_final_row = r
                best_final_score = final
            cv = _to_float(r.get("cv_val_score"))
            if cv is not None and _is_better(cv, best_cv_score, higher_is_better=higher_is_better):
                best_cv_row = r
                best_cv_score = cv

        if best_final_row is None and best_cv_row is None:
            continue

        # Preserve the previous Datasets-page semantics: prefer the best final
        # score when one exists, and only fall back to the best CV score when
        # no refit/final result is available for that dataset.
        if best_final_row is not None and best_final_score is not None:
            best_row = best_final_row
            best_score = best_final_score
            best_kind = "final"
            cv_score = _to_float(best_final_row.get("cv_val_score"))
        else:
            best_row = best_cv_row or {}
            best_score = best_cv_score
            best_kind = "cv"
            cv_score = None

        datasets_out.append({
            "dataset_name": ds_name,
            "linked_dataset_id": None,
            "metric": metric,
            "best_score": best_score,
            "cv_score": cv_score,
            "score_kind": best_kind,
            "model_name": best_row.get("model_name") or best_row.get("model_class") or "",
        })

    _resolve_dataset_mapping(datasets_out, linked_datasets)
    return {"workspace_id": workspace_id, "datasets": datasets_out}


# ============= Predictions maintenance helpers =============


def _to_plain_dict(value: Any) -> Any:
    """Convert rich objects (dataclass/Pydantic) to plain JSON-serializable structures."""
    from dataclasses import asdict, is_dataclass

    if is_dataclass(value):
        return {k: _to_plain_dict(v) for k, v in asdict(value).items()}
    if hasattr(value, "model_dump") and callable(getattr(value, "model_dump", None)):
        return _to_plain_dict(value.model_dump())  # type: ignore[no-any-return]
    if isinstance(value, dict):
        return {k: _to_plain_dict(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_plain_dict(v) for v in value]
    return value


def _prepare_predictions_instance(workspace_path: Path) -> tuple[Any, Any]:
    """Create a Predictions instance and optional store handle for maintenance operations."""
    if not PREDICTIONS_AVAILABLE:
        raise HTTPException(status_code=501, detail="nirs4all Predictions API is not available")

    store = None
    predictions_obj = None
    errors: list[str] = []

    Predictions = get_cached("Predictions")

    # Prefer the store-backed constructor: maintenance operations (clean_dead_links,
    # compact, remove_bottom, etc.) require a live store handle.
    # Predictions.from_workspace() closes the store after loading, leaving a
    # store-less in-memory instance that fails on _require_store().
    if STORE_AVAILABLE:
        try:
            store = get_cached("WorkspaceStore")(workspace_path)
            predictions_obj = get_cached("Predictions")(store=store)
            return predictions_obj, store
        except Exception as exc:
            errors.append(str(exc))

    if hasattr(Predictions, "from_workspace"):
        try:
            predictions_obj = Predictions.from_workspace(workspace_path)  # type: ignore[attr-defined]
            return predictions_obj, store
        except Exception as exc:
            errors.append(str(exc))

    detail = (
        "Current nirs4all version does not expose a store-backed Predictions interface "
        "required for maintenance operations."
    )
    if errors:
        detail = f"{detail} Last error: {errors[-1]}"
    raise HTTPException(status_code=501, detail=detail)


def _invoke_predictions_method(workspace_path: Path, method_name: str, **kwargs: Any) -> dict[str, Any]:
    """Call a maintenance method on Predictions with compatibility fallbacks."""
    predictions_obj, store = _prepare_predictions_instance(workspace_path)
    try:
        method = getattr(predictions_obj, method_name, None)
        if method is None or not callable(method):
            raise HTTPException(
                status_code=501,
                detail=f"Current nirs4all version does not support '{method_name}'",
            )

        result = method(**kwargs)
        plain = _to_plain_dict(result)
        if isinstance(plain, dict):
            return plain
        return {"result": plain}
    finally:
        if store is not None:
            try:
                store.close()
            except Exception:
                pass


def _normalize_migration_report(report: Any) -> dict[str, Any]:
    """Map migration report object/dict to API response shape."""
    raw = _to_plain_dict(report)
    if not isinstance(raw, dict):
        raw = {}
    return {
        "total_rows": int(raw.get("total_rows", 0) or 0),
        "rows_migrated": int(raw.get("rows_migrated", 0) or 0),
        "datasets_migrated": list(raw.get("datasets_migrated", []) or []),
        "verification_passed": bool(raw.get("verification_passed", False)),
        "verification_sample_size": int(raw.get("verification_sample_size", 0) or 0),
        "verification_mismatches": int(raw.get("verification_mismatches", 0) or 0),
        "duckdb_size_before": int(raw.get("duckdb_size_before", 0) or 0),
        "duckdb_size_after": int(raw.get("duckdb_size_after", 0) or 0),
        "parquet_total_size": int(raw.get("parquet_total_size", 0) or 0),
        "duration_seconds": float(raw.get("duration_seconds", 0.0) or 0.0),
        "errors": [str(e) for e in (raw.get("errors", []) or [])],
    }


def _call_migrate_arrays_to_parquet(
    workspace_path: Path,
    *,
    dry_run: bool,
    batch_size: int | None = None,
) -> dict[str, Any]:
    """Call migration function with backward-compatible signature handling."""
    migrate_arrays_to_parquet = get_cached("migrate_arrays_to_parquet", optional=True)
    if not MIGRATION_AVAILABLE or migrate_arrays_to_parquet is None:
        raise HTTPException(status_code=501, detail="Migration API is not available in current nirs4all version")

    kwargs: dict[str, Any] = {"dry_run": dry_run}
    if batch_size is not None:
        kwargs["batch_size"] = batch_size

    try:
        signature = inspect.signature(migrate_arrays_to_parquet)
        accepted = set(signature.parameters.keys())
        kwargs = {k: v for k, v in kwargs.items() if k in accepted}
    except Exception:
        pass

    report = migrate_arrays_to_parquet(workspace_path, **kwargs)  # type: ignore[misc]
    return _normalize_migration_report(report)


def _get_legacy_arrays_row_count(workspace_path: Path) -> int | None:
    """Count legacy rows in prediction_arrays if the table exists."""
    if not STORE_AVAILABLE:
        return None
    if not (workspace_path / "store.sqlite").exists() and not (workspace_path / "store.duckdb").exists():
        return None

    try:
        store = get_cached("WorkspaceStore")(workspace_path)
    except Exception:
        return None

    try:
        has_table = False
        try:
            table_df = store._fetch_pl(  # type: ignore[attr-defined]
                "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_name = 'prediction_arrays'"
            )
            if len(table_df) > 0:
                has_table = int(table_df.row(0, named=True).get("cnt", 0) or 0) > 0
        except Exception:
            has_table = False

        if not has_table:
            return None

        count_df = store._fetch_pl("SELECT COUNT(*) AS cnt FROM prediction_arrays")
        if len(count_df) == 0:
            return 0
        return int(count_df.row(0, named=True).get("cnt", 0) or 0)
    except Exception:
        return None
    finally:
        try:
            store.close()
        except Exception:
            pass


def _estimate_migration_duration_seconds(legacy_row_count: int | None) -> int | None:
    """Estimate migration time from row count using a conservative throughput heuristic."""
    if legacy_row_count is None:
        return None
    if legacy_row_count == 0:
        return 0
    rows_per_second = 10_000
    return max(1, int(legacy_row_count / rows_per_second))


def _extract_orphan_counts(report: dict[str, Any]) -> tuple[int, int]:
    metadata_orphans = int(
        report.get("metadata_orphans_removed")
        or report.get("orphan_metadata_count")
        or report.get("metadata_orphans")
        or 0
    )
    array_orphans = int(
        report.get("array_orphans_removed")
        or report.get("orphan_array_count")
        or report.get("array_orphans")
        or 0
    )
    return metadata_orphans, array_orphans


def _extract_corrupt_files(report: dict[str, Any]) -> list[str]:
    candidates = [
        report.get("corrupt_files"),
        report.get("corrupted_files"),
        report.get("invalid_files"),
    ]
    for value in candidates:
        if isinstance(value, list):
            return [str(item) for item in value]
    return []
