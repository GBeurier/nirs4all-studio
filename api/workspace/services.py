"""Non-routing services for the workspace API package.

Contains the heavier business logic that the routers call: dataset-name →
linked-id matching, rerun pipeline cloning helpers, the compact dataset-scores
payload builder, and the predictions-maintenance compatibility shims. None of
these are FastAPI handlers; they are pure helpers invoked from the routers.
"""

import inspect
import json
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from ..lazy_imports import get_cached
from ..results_repository import workspace_store_root
from ..shared.json_safe import sanitize_dict, sanitize_float
from ..shared.logger import get_logger
from ._shared import MIGRATION_AVAILABLE, PREDICTIONS_AVAILABLE, STORE_AVAILABLE

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


# ============= Results-summary payload builder =============


def _parse_json_maybe(value: Any) -> Any:
    """Parse JSON strings, otherwise return the input unchanged."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return value
    return value


def _coerce_summary_score(value: Any) -> float | None:
    """Return a finite float score, or None for missing/non-finite values."""
    value = sanitize_float(value)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _summary_metric_higher_is_better(metric_name: str | None, cache: dict[str, bool]) -> bool:
    key = metric_name or ""
    cached = cache.get(key)
    if cached is not None:
        return cached

    from nirs4all.pipeline.run import get_metric_info

    value = bool(get_metric_info(metric_name).get("higher_is_better", True)) if metric_name else True
    cache[key] = value
    return value


def _summary_is_better(candidate: float, incumbent: float | None, *, higher_is_better: bool) -> bool:
    if incumbent is None:
        return True
    return candidate > incumbent if higher_is_better else candidate < incumbent


def _summary_dict_payload(value: Any) -> dict[str, Any]:
    parsed = _parse_json_maybe(value)
    return parsed if isinstance(parsed, dict) else {}


def _summary_optional_dict_payload(value: Any) -> dict[str, Any] | None:
    parsed = _parse_json_maybe(value)
    return parsed if isinstance(parsed, dict) and parsed else None


def _summary_has_meaningful_final_payload(row: dict[str, Any]) -> bool:
    if row.get("final_test_score") is not None or row.get("final_train_score") is not None:
        return True
    return bool(_summary_dict_payload(row.get("final_scores")))


def _summary_has_cv_payload(row: dict[str, Any]) -> bool:
    return (
        row.get("cv_val_score") is not None
        or row.get("cv_test_score") is not None
        or row.get("cv_train_score") is not None
        or bool(row.get("cv_fold_count"))
        or bool(_summary_dict_payload(row.get("cv_scores")))
    )


def _mark_summary_refit_only_entries(rows: list[dict[str, Any]]) -> None:
    for row in rows:
        row["is_refit_only"] = bool(row.get("is_refit_only")) or (
            _summary_has_meaningful_final_payload(row) and not _summary_has_cv_payload(row)
        )


def _build_summary_synthetic_final_scores(row: dict[str, Any]) -> dict[str, Any]:
    cv_scores = _summary_dict_payload(row.get("cv_scores"))
    if cv_scores:
        return cv_scores

    metric = row.get("metric")
    if not isinstance(metric, str) or not metric:
        return {}

    scores: dict[str, dict[str, float]] = {}
    for partition, value in (
        ("val", row.get("cv_val_score")),
        ("test", row.get("cv_test_score")),
        ("train", row.get("cv_train_score")),
    ):
        score = _coerce_summary_score(value)
        if score is None:
            continue
        scores.setdefault(partition, {})[metric] = score
    return scores


def _apply_summary_synthetic_refit_fallback(row: dict[str, Any]) -> None:
    if _summary_has_meaningful_final_payload(row):
        row["synthetic_refit"] = bool(row.get("synthetic_refit"))
        return

    if not _summary_has_cv_payload(row):
        row["synthetic_refit"] = bool(row.get("synthetic_refit"))
        return

    row["final_test_score"] = _coerce_summary_score(row.get("cv_test_score"))
    row["final_train_score"] = _coerce_summary_score(row.get("cv_train_score"))
    row["final_scores"] = _build_summary_synthetic_final_scores(row)
    row["synthetic_refit"] = True


def _summary_extract_model_params(expanded_config: Any, model_step_idx: Any) -> dict[str, Any] | None:
    steps = _parse_json_maybe(expanded_config)
    if not isinstance(steps, list):
        return None

    try:
        idx = int(model_step_idx) - 1
    except Exception:
        return None

    if idx < 0 or idx >= len(steps):
        return None

    step = steps[idx]
    if isinstance(step, dict) and "model" in step:
        model_spec = step.get("model")
        if isinstance(model_spec, dict):
            params = model_spec.get("params")
            return params if isinstance(params, dict) else None
        return None

    if isinstance(step, dict):
        params = step.get("params")
        return params if isinstance(params, dict) else None

    return None


def _summary_merge_variant_params(
    step_params: dict[str, Any] | None,
    best_params: dict[str, Any] | None,
) -> dict[str, Any] | None:
    merged: dict[str, Any] = {}
    if isinstance(step_params, dict):
        merged.update(step_params)
    if isinstance(best_params, dict):
        merged.update(best_params)
    return merged or None


def _query_chain_summaries_for_results_summary(source: Any) -> Any:
    """Return all chain summaries from a repository, or from a legacy StoreAdapter."""
    query_chain_summaries = getattr(source, "query_chain_summaries", None)
    if callable(query_chain_summaries):
        return query_chain_summaries()

    store = getattr(source, "store", None)
    query_chain_summaries = getattr(store, "query_chain_summaries", None)
    if callable(query_chain_summaries):
        return query_chain_summaries()

    raise AttributeError("source does not expose query_chain_summaries")


def _query_top_chains_for_results_summary(
    source: Any,
    *,
    dataset_name: str,
    metric: str | None,
    n: int,
    higher_is_better: bool,
) -> list[dict[str, Any]]:
    """Return repository-ranked top CV rows for one dataset."""
    query_top_chains = getattr(source, "query_top_chains", None)
    if not callable(query_top_chains):
        store = getattr(source, "store", None)
        query_top_chains = getattr(store, "query_top_chains", None)
    if not callable(query_top_chains):
        return []

    try:
        df = query_top_chains(
            dataset_name=dataset_name,
            metric=metric,
            n=n,
            score_column="cv_val_score",
            ascending=not higher_is_better,
        )
    except Exception:
        return []
    return [dict(row) for row in df.iter_rows(named=True)]


def _summary_chain_key(row: dict[str, Any]) -> tuple[Any, ...] | None:
    chain_id = row.get("chain_id")
    if chain_id:
        return ("chain_id", chain_id)
    fallback = (
        row.get("run_id"),
        row.get("pipeline_id"),
        row.get("dataset_name"),
        row.get("model_class"),
        row.get("model_name"),
        row.get("preprocessings"),
    )
    return fallback if any(value is not None for value in fallback) else None


def _summary_rank_cv_rows(
    rows: list[dict[str, Any]],
    *,
    n: int,
    higher_is_better: bool,
) -> list[dict[str, Any]]:
    sentinel = float("-inf") if higher_is_better else float("inf")

    def _cv_key(row: dict[str, Any], _sentinel: float = sentinel) -> float:
        value = _coerce_summary_score(row.get("cv_val_score"))
        return value if value is not None else _sentinel

    return sorted(rows, key=_cv_key, reverse=higher_is_better)[:n]


def _summary_pipeline_map(repository: Any, pipeline_ids: set[str]) -> dict[str, dict[str, Any]]:
    get_pipeline = getattr(repository, "get_pipeline", None)
    if not callable(get_pipeline):
        return {}

    pipeline_map: dict[str, dict[str, Any]] = {}
    for pipeline_id in pipeline_ids:
        try:
            pipeline = get_pipeline(pipeline_id)
        except Exception:
            continue
        if isinstance(pipeline, dict):
            pipeline_map[pipeline_id] = pipeline
    return pipeline_map


def _serialize_results_summary_chain(
    entry: dict[str, Any],
    pipeline_map: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    pipeline_id = entry.get("pipeline_id")
    pipeline_row = pipeline_map.get(str(pipeline_id or ""), {})
    best_params = _summary_optional_dict_payload(entry.get("best_params"))
    variant_params = _summary_optional_dict_payload(entry.get("variant_params"))
    if variant_params is None:
        variant_params = _summary_merge_variant_params(
            _summary_extract_model_params(pipeline_row.get("expanded_config"), entry.get("model_step_idx")),
            best_params,
        )

    payload = {
        "chain_id": entry.get("chain_id", ""),
        "run_id": entry.get("run_id", ""),
        "pipeline_id": pipeline_id,
        "pipeline_name": entry.get("pipeline_name") or pipeline_row.get("name"),
        "model_name": entry.get("model_name", ""),
        "model_class": entry.get("model_class", ""),
        "preprocessings": entry.get("preprocessings", ""),
        "avg_val_score": _coerce_summary_score(entry.get("cv_val_score")),
        "avg_test_score": _coerce_summary_score(entry.get("cv_test_score")),
        "avg_train_score": _coerce_summary_score(entry.get("cv_train_score")),
        "fold_count": entry.get("cv_fold_count", 0),
        "scores": _summary_dict_payload(entry.get("cv_scores")),
        "cv_source_chain_id": entry.get("cv_source_chain_id"),
        "final_test_score": _coerce_summary_score(entry.get("final_test_score")),
        "final_train_score": _coerce_summary_score(entry.get("final_train_score")),
        "final_scores": _summary_dict_payload(entry.get("final_scores")),
        "final_agg_test_score": _coerce_summary_score(entry.get("final_agg_test_score")),
        "final_agg_train_score": _coerce_summary_score(entry.get("final_agg_train_score")),
        "final_agg_scores": _summary_dict_payload(entry.get("final_agg_scores")),
        "best_params": best_params,
        "variant_params": variant_params,
        "synthetic_refit": bool(entry.get("synthetic_refit")),
    }
    if entry.get("is_refit_only"):
        payload["is_refit_only"] = True
    return sanitize_dict(payload)


def _build_results_summary_payload(
    repository: Any,
    workspace_id: str,
    linked_datasets: list,
    *,
    n: int,
) -> dict[str, Any]:
    """Compute the legacy results-summary response from a ResultsRepository.

    The payload shape mirrors ``StoreAdapter.get_dataset_top_chains`` while
    retrieving rows through the repository query surface.
    """
    try:
        df = _query_chain_summaries_for_results_summary(repository)
    except Exception:
        return {"workspace_id": workspace_id, "datasets": []}

    if len(df) == 0:
        return {"workspace_id": workspace_id, "datasets": []}

    rows = [dict(row) for row in df.iter_rows(named=True)]
    by_dataset: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        dataset_name = row.get("dataset_name") or ""
        if dataset_name:
            by_dataset.setdefault(str(dataset_name), []).append(row)

    metric_direction_cache: dict[str, bool] = {}
    per_dataset_selection: list[tuple[str, str | None, str | None, list[dict[str, Any]]]] = []

    for dataset_name in sorted(by_dataset):
        dataset_rows = by_dataset[dataset_name]
        _mark_summary_refit_only_entries(dataset_rows)
        for row in dataset_rows:
            _apply_summary_synthetic_refit_fallback(row)

        metric = next((row.get("metric") for row in dataset_rows if row.get("metric")), "r2")
        metric = str(metric) if metric is not None else None
        task_type = next((row.get("task_type") for row in dataset_rows if row.get("task_type")), None)
        task_type = str(task_type) if task_type is not None else None
        higher_is_better = _summary_metric_higher_is_better(metric, metric_direction_cache)

        cv_rows: list[dict[str, Any]] = []
        refit_only_rows: list[dict[str, Any]] = []
        best_final_row: dict[str, Any] | None = None
        best_final_score: float | None = None

        for row in dataset_rows:
            fold_count = row.get("cv_fold_count") or 0
            final_score = _coerce_summary_score(row.get("final_test_score"))
            if fold_count > 0:
                cv_rows.append(row)
            elif final_score is not None:
                refit_only_rows.append(row)

            if final_score is not None and _summary_is_better(
                final_score,
                best_final_score,
                higher_is_better=higher_is_better,
            ):
                best_final_score = final_score
                best_final_row = row

        row_by_key = {
            key: row
            for row in dataset_rows
            if (key := _summary_chain_key(row)) is not None
        }
        queried_top_rows = _query_top_chains_for_results_summary(
            repository,
            dataset_name=dataset_name,
            metric=metric,
            n=n,
            higher_is_better=higher_is_better,
        )

        top_cv_rows: list[dict[str, Any]] = []
        seen_top_keys: set[tuple[Any, ...]] = set()
        for queried_row in queried_top_rows:
            key = _summary_chain_key(queried_row)
            row = row_by_key.get(key, queried_row) if key is not None else queried_row
            if key is not None:
                if key in seen_top_keys:
                    continue
                seen_top_keys.add(key)
            if row.get("cv_fold_count") or row.get("cv_val_score") is not None:
                top_cv_rows.append(row)
            if len(top_cv_rows) >= n:
                break

        if len(top_cv_rows) < n:
            for row in _summary_rank_cv_rows(cv_rows, n=n, higher_is_better=higher_is_better):
                key = _summary_chain_key(row)
                if key is not None and key in seen_top_keys:
                    continue
                if key is not None:
                    seen_top_keys.add(key)
                top_cv_rows.append(row)
                if len(top_cv_rows) >= n:
                    break

        selected: list[dict[str, Any]] = []
        seen_chain_ids: set[str] = set()

        def _append_selected(
            row: dict[str, Any],
            *,
            is_refit_only: bool = False,
            _seen_chain_ids: set[str] = seen_chain_ids,
            _selected: list[dict[str, Any]] = selected,
        ) -> None:
            chain_id = str(row.get("chain_id") or "")
            if chain_id and chain_id in _seen_chain_ids:
                return
            if chain_id:
                _seen_chain_ids.add(chain_id)
            selected_row = dict(row)
            if is_refit_only:
                selected_row["is_refit_only"] = True
            _selected.append(selected_row)

        for row in top_cv_rows:
            _append_selected(row)
        for row in refit_only_rows:
            _append_selected(row, is_refit_only=True)
        if best_final_row is not None:
            _append_selected(best_final_row)

        if selected:
            per_dataset_selection.append((dataset_name, metric, task_type, selected))

    if not per_dataset_selection:
        return {"workspace_id": workspace_id, "datasets": []}

    pipeline_ids = {
        str(row.get("pipeline_id"))
        for _, _, _, selected in per_dataset_selection
        for row in selected
        if row.get("pipeline_id")
    }
    pipeline_map = _summary_pipeline_map(repository, pipeline_ids)

    datasets_out: list[dict[str, Any]] = []
    for dataset_name, metric, task_type, selected in per_dataset_selection:
        datasets_out.append(sanitize_dict({
            "dataset_name": dataset_name,
            "metric": metric,
            "task_type": task_type,
            "top_chains": [
                _serialize_results_summary_chain(row, pipeline_map)
                for row in selected
            ],
        }))

    _resolve_dataset_mapping(datasets_out, linked_datasets)
    return {"workspace_id": workspace_id, "datasets": datasets_out}


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


def _query_chain_summaries_for_dataset_scores(source: Any) -> Any:
    """Return chain summaries from a repository, or from a legacy StoreAdapter."""
    query_chain_summaries = getattr(source, "query_chain_summaries", None)
    if callable(query_chain_summaries):
        return query_chain_summaries()

    store = getattr(source, "store", None)
    query_chain_summaries = getattr(store, "query_chain_summaries", None)
    if callable(query_chain_summaries):
        return query_chain_summaries()

    raise AttributeError("source does not expose query_chain_summaries")


def _build_dataset_scores_payload(
    repository: Any,
    workspace_id: str,
    linked_datasets: list,
) -> dict[str, Any]:
    """Compute the compact dataset-scores payload directly from
    ``v_chain_summary`` rows. Avoids loading pipeline metadata, parsing
    ``expanded_config``, or building any per-chain serialization that the
    Datasets page does not render. Accepts a ResultsRepository-style object
    directly, while preserving the legacy StoreAdapter call path.
    """
    try:
        df = _query_chain_summaries_for_dataset_scores(repository)
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
            if cv_score is None:
                cv_score = best_cv_score
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
    """Call the library migration function, tolerant of nirs4all signature versions."""
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
    store_root = workspace_store_root(workspace_path)
    if store_root is None:
        return None

    try:
        store = get_cached("WorkspaceStore")(store_root)
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
