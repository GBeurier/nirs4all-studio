"""Adapter between webapp endpoints and WorkspaceStore.

Provides convenience methods for webapp-specific queries that combine
or format WorkspaceStore data for the frontend.  The adapter is a thin
layer -- all data operations are delegated to ``WorkspaceStore``.
"""

from __future__ import annotations

import json
import math
import re
from datetime import UTC, datetime, timezone
from pathlib import Path
from typing import Any

from .lazy_imports import get_cached, is_ml_ready

STORE_AVAILABLE = True


def _get_workspace_store_cls() -> Any:
    """Resolve ``WorkspaceStore`` without waiting for the full ML warmup.

    Store-backed data pages only need the storage layer. If the background ML
    loader has not populated the lazy cache yet, import ``WorkspaceStore``
    directly so read-only database views do not stay blocked behind
    ``ml_ready``.
    """
    if is_ml_ready():
        store_cls = get_cached("WorkspaceStore", optional=True)
        if store_cls is not None:
            return store_cls

    try:
        from nirs4all.pipeline.storage import WorkspaceStore
    except Exception as exc:
        raise RuntimeError("nirs4all WorkspaceStore is not available") from exc

    return WorkspaceStore


def _sanitize_float(value: Any) -> Any:
    """Convert NaN / Inf to ``None`` for JSON serialization."""
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def _sanitize_dict(d: dict[str, Any]) -> dict[str, Any]:
    """Recursively sanitize float values in a dictionary."""
    out: dict[str, Any] = {}
    for k, v in d.items():
        if isinstance(v, dict):
            out[k] = _sanitize_dict(v)
        elif isinstance(v, list):
            out[k] = [_sanitize_dict(item) if isinstance(item, dict) else _sanitize_float(item) for item in v]
        elif isinstance(v, (float, int)):
            out[k] = _sanitize_float(v)
        else:
            out[k] = v
    return out


def _parse_json_maybe(value: Any) -> Any:
    """Parse JSON strings, otherwise return the input unchanged."""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return value
    return value


def _extract_model_params_from_expanded_config(
    expanded_config: Any,
    model_step_idx: Any,
) -> dict[str, Any] | None:
    """Extract concrete params for the model step from an expanded pipeline config."""
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
            if isinstance(params, dict):
                return params
        return None

    if isinstance(step, dict):
        params = step.get("params")
        if isinstance(params, dict):
            return params

    return None


def _merge_variant_params(
    step_params: dict[str, Any] | None,
    best_params: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Merge concrete step params with finetuned best_params for display."""
    merged: dict[str, Any] = {}
    if isinstance(step_params, dict):
        merged.update(step_params)
    if isinstance(best_params, dict):
        merged.update(best_params)
    return merged or None


def _stable_serialize_for_signature(value: Any) -> str:
    """Stable serialization used to compare CV / refit chain signatures."""
    if value is None:
        return ""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return value
    try:
        return json.dumps(value, sort_keys=True, default=str)
    except Exception:
        return str(value)


def _chain_match_signature(record: dict[str, Any]) -> tuple[str, str, str, str]:
    """Build a (model_class, model_name, preprocessings, params) signature.

    Mirrors the frontend ``signatureParts`` helper so refit chains can be
    paired with the matching CV chain that produced their best params.
    """
    return (
        record.get("model_class") or "",
        record.get("model_name") or "",
        record.get("preprocessings") or "",
        _stable_serialize_for_signature(record.get("best_params")),
    )


_CV_FALLBACK_FIELDS = ("cv_val_score", "cv_test_score", "cv_train_score", "cv_fold_count", "cv_scores")


def _enrich_refit_with_cv_inplace(rows: list[dict[str, Any]]) -> None:
    """Copy CV scores from sibling CV chains onto refit chains in-place.

    A row is treated as a "refit-only" entry when ``final_test_score``
    is set but ``cv_val_score`` is missing. The matching CV row is found
    by comparing (model_class, model_name, preprocessings, best_params).
    """
    refits = [
        r for r in rows
        if r.get("final_test_score") is not None and r.get("cv_val_score") is None
    ]
    if not refits:
        return

    cv_by_signature: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for row in rows:
        if row.get("cv_val_score") is None:
            continue
        sig = _chain_match_signature(row)
        cv_by_signature.setdefault(sig, row)

    if not cv_by_signature:
        return

    for refit in refits:
        match = cv_by_signature.get(_chain_match_signature(refit))
        if match is None:
            continue
        for field in _CV_FALLBACK_FIELDS:
            if refit.get(field) is None:
                refit[field] = match.get(field)


class StoreAdapter:
    """Wraps ``WorkspaceStore`` for webapp-specific operations.

    The adapter owns its store instance and should be closed when no
    longer needed (or used as a context-manager).

    Args:
        workspace_path: Root directory of the nirs4all workspace.
    """

    def __init__(self, workspace_path: Path) -> None:
        if not STORE_AVAILABLE:
            raise RuntimeError("nirs4all library is required for StoreAdapter")
        self._workspace_path = Path(workspace_path)
        self._store = _get_workspace_store_cls()(workspace_path)

    def __enter__(self) -> StoreAdapter:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @property
    def store(self) -> Any:
        """Return the underlying ``WorkspaceStore``."""
        return self._store

    def get_store_status(self) -> dict[str, Any]:
        """Return storage backend status for the workspace store.

        Returns:
            {
                "storage_mode": "migrated" | "legacy" | "mid_migration" | "new",
                "has_prediction_arrays_table": bool,
                "has_arrays_directory": bool,
                "migration_needed": bool,
            }
        """
        # Prefer native implementation if available
        if hasattr(self._store, "get_storage_status"):
            try:
                status = self._store.get_storage_status()  # type: ignore[attr-defined]
                if isinstance(status, dict) and "storage_mode" in status:
                    return {
                        "storage_mode": status.get("storage_mode", "new"),
                        "has_prediction_arrays_table": bool(status.get("has_prediction_arrays_table", False)),
                        "has_arrays_directory": bool(status.get("has_arrays_directory", False)),
                        "migration_needed": bool(status.get("migration_needed", False)),
                    }
            except Exception:
                pass

        workspace_path = getattr(self._store, "_workspace_path", None) or Path(".")
        arrays_dir = Path(workspace_path) / "arrays"
        has_arrays_directory = arrays_dir.exists() and arrays_dir.is_dir()

        has_prediction_arrays_table = False
        try:
            df = self._store._fetch_pl(
                "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_name = 'prediction_arrays'"
            )
            if len(df) > 0:
                has_prediction_arrays_table = int(df.row(0, named=True).get("cnt", 0) or 0) > 0
        except Exception:
            try:
                df = self._store._fetch_pl("PRAGMA show_tables")
                if "name" in df.columns:
                    has_prediction_arrays_table = "prediction_arrays" in df.get_column("name").to_list()
            except Exception:
                has_prediction_arrays_table = False

        if has_prediction_arrays_table and not has_arrays_directory:
            storage_mode = "legacy"
        elif has_prediction_arrays_table and has_arrays_directory:
            storage_mode = "mid_migration"
        elif not has_prediction_arrays_table and has_arrays_directory:
            storage_mode = "migrated"
        else:
            storage_mode = "new"

        return {
            "storage_mode": storage_mode,
            "has_prediction_arrays_table": has_prediction_arrays_table,
            "has_arrays_directory": has_arrays_directory,
            "migration_needed": storage_mode in ("legacy", "mid_migration"),
        }

    # ------------------------------------------------------------------
    # Runs
    # ------------------------------------------------------------------

    def get_runs_summary(self, limit: int = 50, offset: int = 0, status: str | None = None, dataset: str | None = None) -> dict[str, Any]:
        """Get runs with summary info for the webapp dashboard.

        Args:
            limit: Maximum number of runs to return.
            offset: Pagination offset.
            status: Optional status filter.
            dataset: Optional dataset name filter.

        Returns:
            Dict with ``runs`` list, ``count`` (page size), ``has_more``,
            ``limit``, and ``offset``.
        """
        # Request one extra row to detect whether more pages exist.
        df = self._store.list_runs(status=status, dataset=dataset, limit=limit + 1, offset=offset)
        rows = list(df.iter_rows(named=True))
        has_more = len(rows) > limit
        rows = rows[:limit]

        runs = []
        for row in rows:
            run = _sanitize_dict(dict(row))
            # Convert datetime objects to ISO strings
            for ts_field in ("created_at", "completed_at"):
                val = run.get(ts_field)
                if isinstance(val, datetime):
                    run[ts_field] = val.isoformat()
            runs.append(run)
        return {"runs": runs, "count": len(runs), "has_more": has_more, "limit": limit, "offset": offset}

    def get_run_detail(self, run_id: str) -> dict[str, Any] | None:
        """Get full run detail including pipelines and chains.

        Args:
            run_id: Run identifier.

        Returns:
            Run dictionary with nested pipelines, or ``None``.
        """
        run = self._store.get_run(run_id)
        if run is None:
            return None
        run = _sanitize_dict(run)
        # Convert datetimes
        for ts_field in ("created_at", "completed_at"):
            val = run.get(ts_field)
            if isinstance(val, datetime):
                run[ts_field] = val.isoformat()
        # Attach pipelines
        pipelines_df = self._store.list_pipelines(run_id=run_id)
        pipelines = []
        for row in pipelines_df.iter_rows(named=True):
            p = _sanitize_dict(dict(row))
            for ts_field in ("created_at", "completed_at"):
                val = p.get(ts_field)
                if isinstance(val, datetime):
                    p[ts_field] = val.isoformat()
            pipelines.append(p)
        run["pipelines"] = pipelines
        return run

    def get_run_log(self, run_id: str) -> list[dict[str, Any]]:
        """Get structured log summary for a run.

        Args:
            run_id: Run identifier.

        Returns:
            List of log summary dicts (one per pipeline).
        """
        df = self._store.get_run_log_summary(run_id)
        return [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

    def delete_run(self, run_id: str) -> dict[str, Any]:
        """Delete a run with cascade.

        Args:
            run_id: Run identifier.

        Returns:
            Dict with ``deleted_rows`` count and ``success`` flag.
        """
        total = self._store.delete_run(run_id, delete_artifacts=True)
        return {"success": True, "deleted_rows": total, "run_id": run_id}

    # ------------------------------------------------------------------
    # Predictions
    # ------------------------------------------------------------------

    def get_predictions_summary(self, dataset_name: str | None = None) -> dict[str, Any]:
        """Get prediction summary stats for dashboard.

        Args:
            dataset_name: Optional dataset filter.

        Returns:
            Dict with total count, top predictions, model breakdown, and stats.
        """
        # Total count
        all_preds = self._store.query_predictions(dataset_name=dataset_name)
        total = len(all_preds)

        # Top predictions
        top_df = self._store.top_predictions(n=10, dataset_name=dataset_name)
        top_predictions = []
        for row in top_df.iter_rows(named=True):
            d = _sanitize_dict(dict(row))
            if "prediction_id" in d and "id" not in d:
                d["id"] = d.pop("prediction_id")
            top_predictions.append(d)

        # Model breakdown
        models: dict[str, dict[str, Any]] = {}
        if total > 0 and "model_class" in all_preds.columns:
            for row in all_preds.iter_rows(named=True):
                mc = row.get("model_class", "Unknown")
                if mc not in models:
                    models[mc] = {"name": mc, "count": 0, "total_val_score": 0.0, "score_count": 0}
                models[mc]["count"] += 1
                vs = row.get("val_score")
                if vs is not None and isinstance(vs, (int, float)) and not math.isnan(vs):
                    models[mc]["total_val_score"] += vs
                    models[mc]["score_count"] += 1

        models_list = []
        for m in models.values():
            avg = round(m["total_val_score"] / m["score_count"], 4) if m["score_count"] > 0 else None
            models_list.append({"name": m["name"], "count": m["count"], "avg_val_score": avg})
        models_list.sort(key=lambda x: x["count"], reverse=True)

        return {
            "total_predictions": total,
            "top_predictions": top_predictions,
            "models": models_list,
            "generated_at": datetime.now(UTC).isoformat(),
        }

    def get_predictions_page(
        self,
        dataset_name: str | None = None,
        model_class: str | None = None,
        partition: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Get paginated predictions for the predictions view.

        Args:
            dataset_name: Optional dataset filter.
            model_class: Optional model class filter.
            partition: Optional partition filter.
            limit: Page size.
            offset: Pagination offset.

        Returns:
            Dict with ``records``, ``total``, ``limit``, ``offset``, ``has_more``.
        """
        try:
            # Fetch the requested page.
            df = self._store.query_predictions(
                dataset_name=dataset_name, model_class=model_class, partition=partition,
                limit=limit, offset=offset,
            )
            records = []
            for row in df.iter_rows(named=True):
                d = _sanitize_dict(dict(row))
                # Rename prediction_id → id for frontend compatibility
                if "prediction_id" in d and "id" not in d:
                    d["id"] = d.pop("prediction_id")
                # Expose chain_id under trace_id for legacy frontend consumers
                # that key the pipeline-editor link off ``trace_id``.
                if "chain_id" in d and "trace_id" not in d:
                    d["trace_id"] = d.get("chain_id")
                records.append(d)

            # Total count (without limit) for the frontend pagination display.
            total_df = self._store.query_predictions(
                dataset_name=dataset_name, model_class=model_class, partition=partition,
            )
            total = len(total_df)
        except Exception:
            records, total = self._get_predictions_page_fallback(
                dataset_name=dataset_name,
                model_class=model_class,
                partition=partition,
                limit=limit,
                offset=offset,
            )

        # Enrich refit predictions: set val_score from chain summary
        refit_chain_ids = list({
            r.get("chain_id", "")
            for r in records
            if r.get("refit_context") is not None and r.get("chain_id")
        })
        if refit_chain_ids:
            try:
                ph = ", ".join(f"${i + 1}" for i in range(len(refit_chain_ids)))
                cv_df = self._store._fetch_pl(
                    f"SELECT chain_id, cv_val_score FROM v_chain_summary WHERE chain_id IN ({ph})",
                    refit_chain_ids,
                )
                cv_val_map: dict[str, float | None] = {}
                for cv_row in cv_df.iter_rows(named=True):
                    cid = cv_row.get("chain_id", "")
                    avs = cv_row.get("cv_val_score")
                    if avs is not None and isinstance(avs, (int, float)):
                        cv_val_map[cid] = round(float(avs), 6)
                for rec in records:
                    if rec.get("refit_context") is not None and rec.get("chain_id") in cv_val_map:
                        rec["val_score"] = cv_val_map[rec["chain_id"]]
            except Exception:
                pass

        return {
            "records": records,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        }

    def _get_predictions_page_fallback(
        self,
        dataset_name: str | None = None,
        model_class: str | None = None,
        partition: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        """Fallback reader for predictions when store.query_predictions() cannot infer schema."""
        where_clauses = ["1=1"]
        params: list[Any] = []

        if dataset_name:
            where_clauses.append("p.dataset_name = ?")
            params.append(dataset_name)
        if model_class:
            where_clauses.append("p.model_class = ?")
            params.append(model_class)
        if partition:
            where_clauses.append("p.partition = ?")
            params.append(partition)

        where_sql = " AND ".join(where_clauses)
        select_sql = f"""
            SELECT
                p.prediction_id,
                p.pipeline_id,
                p.chain_id,
                p.dataset_name,
                p.model_name,
                p.model_class,
                p.fold_id,
                p.partition,
                p.val_score,
                p.test_score,
                p.train_score,
                p.metric,
                p.task_type,
                p.n_samples,
                p.n_features,
                p.scores,
                p.best_params,
                p.preprocessings,
                p.branch_id,
                p.branch_name,
                p.exclusion_count,
                p.exclusion_rate,
                CAST(p.refit_context AS TEXT) AS refit_context,
                p.created_at
            FROM predictions p
            WHERE {where_sql}
            ORDER BY p.created_at DESC, p.prediction_id DESC
            LIMIT ? OFFSET ?
        """
        count_sql = f"SELECT COUNT(*) FROM predictions p WHERE {where_sql}"

        def normalize_record(raw: dict[str, Any]) -> dict[str, Any]:
            record = _sanitize_dict(dict(raw))

            if "prediction_id" in record and "id" not in record:
                record["id"] = record.pop("prediction_id")

            for json_field in ("best_params", "scores"):
                value = record.get(json_field)
                if isinstance(value, str):
                    try:
                        record[json_field] = json.loads(value)
                    except Exception:
                        pass

            record["source_dataset"] = record.get("dataset_name")
            record["source_file"] = ""
            record["pipeline_uid"] = record.get("pipeline_id")
            record["model_classname"] = record.get("model_class")
            record["trace_id"] = record.get("chain_id")
            record.setdefault("config_name", None)
            record.setdefault("step_idx", None)
            record.setdefault("op_counter", None)
            record.setdefault("model_artifact_id", None)
            return record

        sqlite_path = self._workspace_path / "store.sqlite"
        if sqlite_path.exists():
            import sqlite3

            con = sqlite3.connect(sqlite_path)
            con.row_factory = sqlite3.Row
            try:
                rows = con.execute(select_sql, [*params, limit, offset]).fetchall()
                total = int(con.execute(count_sql, params).fetchone()[0])
                return [normalize_record(dict(row)) for row in rows], total
            finally:
                con.close()

        duckdb_path = self._workspace_path / "store.duckdb"
        if duckdb_path.exists():
            import duckdb

            con = duckdb.connect(str(duckdb_path), read_only=True)
            try:
                rows = con.execute(select_sql, [*params, limit, offset]).fetchall()
                columns = [desc[0] for desc in con.description]
                total = int(con.execute(count_sql, params).fetchone()[0])
                return [normalize_record(dict(zip(columns, row, strict=False))) for row in rows], total
            finally:
                con.close()

        raise RuntimeError("No store database found for prediction fallback")

    def get_prediction_scatter(self, prediction_id: str) -> dict[str, Any] | None:
        """Get scatter plot data for a prediction.

        Args:
            prediction_id: Prediction identifier.

        Returns:
            Dict with y_true, y_pred, n_samples, partition, model_name,
            dataset_name; or ``None`` if not found.
        """
        import numpy as np
        pred = self._store.get_prediction(prediction_id, load_arrays=True)
        if pred is None:
            return None

        y_true = pred.get("y_true")
        y_pred = pred.get("y_pred")
        if y_true is None or y_pred is None:
            return None

        y_true_list = y_true.tolist() if isinstance(y_true, np.ndarray) else list(y_true)
        y_pred_list = y_pred.tolist() if isinstance(y_pred, np.ndarray) else list(y_pred)

        if not y_true_list or not y_pred_list:
            return None

        return {
            "prediction_id": prediction_id,
            "y_true": y_true_list,
            "y_pred": y_pred_list,
            "n_samples": len(y_true_list),
            "partition": pred.get("partition", "unknown"),
            "model_name": pred.get("model_name", "unknown"),
            "dataset_name": pred.get("dataset_name", "unknown"),
        }

    # ------------------------------------------------------------------
    # Chain Summaries (v_chain_summary)
    # ------------------------------------------------------------------

    def get_chain_summaries(
        self,
        run_id: str | None = None,
        pipeline_id: str | None = None,
        chain_id: str | None = None,
        dataset_name: str | None = None,
        model_class: str | None = None,
        metric: str | None = None,
    ) -> list[dict[str, Any]]:
        """Query chain summaries (one row per chain).

        Each row contains CV averages, final/refit scores, multi-metric
        JSON, and chain metadata.

        Args:
            run_id: Optional run filter.
            pipeline_id: Optional pipeline filter.
            chain_id: Optional chain filter.
            dataset_name: Optional dataset filter.
            model_class: Optional model class filter.
            metric: Optional metric filter.

        Returns:
            List of sanitized chain summary dicts.
        """
        df = self._store.query_chain_summaries(
            run_id=run_id,
            pipeline_id=pipeline_id,
            chain_id=chain_id,
            dataset_name=dataset_name,
            model_class=model_class,
            metric=metric,
        )
        return [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

    # Deprecated alias
    get_aggregated_predictions = get_chain_summaries

    def get_top_chain_summaries(
        self,
        metric: str | None = None,
        n: int = 10,
        score_column: str = "cv_val_score",
        **filters: Any,
    ) -> list[dict[str, Any]]:
        """Get top-N chain summaries ranked by score.

        Args:
            metric: Optional metric name filter.
            n: Number of top results.
            score_column: Column to sort by.
            **filters: Additional filters (run_id, pipeline_id, etc.).

        Returns:
            List of sanitized top chain summary dicts.
        """
        df = self._store.query_top_chains(
            metric=metric,
            n=n,
            score_column=score_column,
            **filters,
        )
        return [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

    # Deprecated alias
    get_top_aggregated_predictions = get_top_chain_summaries

    def get_chain_predictions(
        self,
        chain_id: str,
        partition: str | None = None,
        fold_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Get individual prediction rows for a chain (drill-down).

        Args:
            chain_id: Chain identifier.
            partition: Optional partition filter.
            fold_id: Optional fold filter.

        Returns:
            List of sanitized prediction dicts.
        """
        df = self._store.get_chain_predictions(
            chain_id=chain_id,
            partition=partition,
            fold_id=fold_id,
        )
        return [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

    def get_prediction_arrays(self, prediction_id: str) -> dict[str, Any] | None:
        """Get arrays for a single prediction.

        Args:
            prediction_id: Prediction identifier.

        Returns:
            Dict with y_true, y_pred, etc. as lists, or ``None``.
        """
        import numpy as np
        arrays = self._store.get_prediction_arrays(prediction_id)
        if arrays is None:
            return None

        result: dict[str, Any] = {"prediction_id": prediction_id}
        for key in ("y_true", "y_pred", "y_proba", "weights"):
            val = arrays.get(key)
            if val is not None and isinstance(val, np.ndarray):
                result[key] = val.tolist()
            else:
                result[key] = None

        sample_indices = arrays.get("sample_indices")
        if sample_indices is not None and isinstance(sample_indices, np.ndarray):
            result["sample_indices"] = sample_indices.tolist()
        else:
            result["sample_indices"] = None

        return result

    # ------------------------------------------------------------------
    # Enriched Runs
    # ------------------------------------------------------------------

    def get_enriched_runs(self, limit: int = 50, offset: int = 0, project_id: str | None = None) -> dict[str, Any]:
        """Get runs enriched with per-dataset scores, top chains, and stats."""
        store = self._store

        # Get runs list -- list_runs doesn't support project_id, so filter manually
        runs_df = store.list_runs(limit=limit + offset, offset=0)
        enriched_runs = []

        all_rows = list(runs_df.iter_rows(named=True))

        # Filter by project_id if specified
        if project_id is not None:
            all_rows = [r for r in all_rows if r.get("project_id") == project_id]

        # Apply pagination after filtering
        all_rows = all_rows[offset:offset + limit]

        for row in all_rows:
            run_id = row.get("run_id", "")

            # Convert datetimes
            created_at = row.get("created_at")
            if isinstance(created_at, datetime):
                created_at = created_at.isoformat()
            completed_at = row.get("completed_at")
            if isinstance(completed_at, datetime):
                completed_at = completed_at.isoformat()

            # Compute duration
            duration_seconds = None
            if row.get("created_at") and row.get("completed_at"):
                try:
                    ca = row["created_at"] if isinstance(row["created_at"], datetime) else datetime.fromisoformat(str(row["created_at"]))
                    co = row["completed_at"] if isinstance(row["completed_at"], datetime) else datetime.fromisoformat(str(row["completed_at"]))
                    duration_seconds = int((co - ca).total_seconds())
                except Exception:
                    pass

            # Get pipeline stats for this run
            pipelines_df = store.list_pipelines(run_id=run_id)
            pipeline_count = len(pipelines_df)

            # Get chain summaries for this run (uses v_chain_summary view)
            agg_df = store.query_aggregated_predictions(run_id=run_id)
            agg_rows = list(agg_df.iter_rows(named=True)) if len(agg_df) > 0 else []

            # Group by dataset_name, filtering out parasitic calibration/validation subsets
            _PARASITIC_DS_RE = re.compile(r"_X_?(?:cal|val)$", re.IGNORECASE)
            datasets_map: dict[str, list] = {}
            for agg in agg_rows:
                ds = agg.get("dataset_name", "unknown")
                if _PARASITIC_DS_RE.search(ds):
                    continue
                if ds not in datasets_map:
                    datasets_map[ds] = []
                datasets_map[ds].append(agg)

            # Also get dataset names from runs.datasets JSON
            datasets_raw = row.get("datasets")
            if isinstance(datasets_raw, str):
                try:
                    datasets_meta = json.loads(datasets_raw)
                except Exception:
                    datasets_meta = []
            elif isinstance(datasets_raw, list):
                datasets_meta = datasets_raw
            else:
                datasets_meta = []

            # Extract run config from runs.config JSON
            config_raw = row.get("config")
            if isinstance(config_raw, str):
                try:
                    run_config_data = json.loads(config_raw)
                except Exception:
                    run_config_data = {}
            elif isinstance(config_raw, dict):
                run_config_data = config_raw
            else:
                run_config_data = {}

            # Build dataset metadata lookup from runs.datasets JSON
            datasets_meta_map: dict[str, dict] = {}
            for dm in datasets_meta:
                if isinstance(dm, dict):
                    datasets_meta_map[dm.get("name", "")] = dm

            # Ensure we have all datasets even if no predictions yet (skip parasitic subsets)
            for dm in datasets_meta:
                ds_name = dm.get("name", "") if isinstance(dm, dict) else str(dm)
                if ds_name and ds_name not in datasets_map and not _PARASITIC_DS_RE.search(ds_name):
                    datasets_map[ds_name] = []

            # Build per-dataset enriched data
            enriched_datasets = []
            for ds_name, agg_list in datasets_map.items():
                ds_meta = datasets_meta_map.get(ds_name, {})

                if not agg_list:
                    enriched_datasets.append({
                        "dataset_name": ds_name,
                        "best_avg_val_score": None,
                        "best_avg_test_score": None,
                        "metric": None,
                        "task_type": None,
                        "gain_from_previous_best": None,
                        "pipeline_count": 0,
                        "top_5": [],
                        "n_samples": ds_meta.get("n_samples"),
                        "n_features": ds_meta.get("n_features"),
                    })
                    continue

                # Determine metric from first entry
                metric = agg_list[0].get("metric", "r2")

                # Determine sort direction
                from nirs4all.pipeline.run import get_metric_info
                metric_info = get_metric_info(metric)
                higher_is_better = metric_info.get("higher_is_better", True)

                # Sort aggregated entries by cv_val_score
                sorted_agg = sorted(
                    [a for a in agg_list if a.get("cv_val_score") is not None],
                    key=lambda x: x.get("cv_val_score", 0),
                    reverse=higher_is_better,
                )

                best = sorted_agg[0] if sorted_agg else {}
                best_avg_val = _sanitize_float(best.get("cv_val_score"))
                best_avg_test = _sanitize_float(best.get("cv_test_score"))

                # Historical best for gain calculation
                gain = None
                try:
                    hist_best = self._get_dataset_historical_best(ds_name, metric, exclude_run_id=run_id)
                    if hist_best is not None and best_avg_val is not None:
                        gain = round(best_avg_val - hist_best, 6)
                except Exception:
                    pass

                # Top 5 chains with final (refit) scores
                top_5_entries = sorted_agg[:5]
                top_5_chain_ids = {e.get("chain_id", "") for e in top_5_entries}

                # Find ALL refit predictions for this run+dataset (used as fallback
                # when v_chain_summary hasn't been backfilled yet, and to detect
                # refit-only chains not in the top 5).
                refit_predictions_map: dict[str, dict[str, Any]] = {}
                try:
                    refit_df = store._fetch_pl(
                        "SELECT p.chain_id, p.model_name, p.model_class, p.test_score, p.train_score, "
                        "p.scores, p.preprocessings "
                        "FROM predictions p "
                        "JOIN chains c ON p.chain_id = c.chain_id "
                        "JOIN pipelines pl ON c.pipeline_id = pl.pipeline_id "
                        "WHERE pl.run_id = $1 AND p.dataset_name = $2 "
                        "AND p.refit_context IS NOT NULL AND p.fold_id = 'final' AND p.partition = 'test'",
                        [run_id, ds_name],
                    )
                    for rrow in refit_df.iter_rows(named=True):
                        refit_predictions_map[rrow.get("chain_id", "")] = dict(rrow)
                except Exception:
                    pass

                # Load chain summary data (cv_scores + final scores already precomputed)
                refit_only_chain_ids = {cid for cid in refit_predictions_map if cid not in top_5_chain_ids}
                all_chain_ids = list(top_5_chain_ids | refit_only_chain_ids)
                chain_summary_map: dict[str, dict[str, Any]] = {}
                if all_chain_ids:
                    try:
                        ph = ", ".join(f"${i + 1}" for i in range(len(all_chain_ids)))
                        cs_df = store._fetch_pl(
                            f"SELECT chain_id, cv_scores, final_test_score, final_train_score, final_scores, best_params "
                            f"FROM v_chain_summary WHERE chain_id IN ({ph})",
                            all_chain_ids,
                        )
                        for cs_row in cs_df.iter_rows(named=True):
                            cid = cs_row.get("chain_id", "")
                            chain_summary_map[cid] = dict(cs_row)
                    except Exception:
                        pass

                top_5 = []
                best_final_score = None
                for entry in top_5_entries:
                    chain_id = entry.get("chain_id", "")
                    cs = chain_summary_map.get(chain_id, {})
                    cv_scores_raw = cs.get("cv_scores")
                    scores_detail = json.loads(cv_scores_raw) if isinstance(cv_scores_raw, str) else (cv_scores_raw or {})
                    final_ts = _sanitize_float(cs.get("final_test_score"))
                    final_trs = _sanitize_float(cs.get("final_train_score"))
                    final_scores_raw = cs.get("final_scores")
                    final_scores = json.loads(final_scores_raw) if isinstance(final_scores_raw, str) else (final_scores_raw or {})

                    # Fallback: if chain_summary not backfilled, use refit prediction directly
                    refit_pred = refit_predictions_map.get(chain_id)
                    if final_ts is None and refit_pred:
                        final_ts = _sanitize_float(refit_pred.get("test_score"))
                        final_trs = _sanitize_float(refit_pred.get("train_score"))
                        rp_scores_raw = refit_pred.get("scores")
                        final_scores = json.loads(rp_scores_raw) if isinstance(rp_scores_raw, str) else (rp_scores_raw or {})

                    if final_ts is not None:
                        if best_final_score is None or higher_is_better and final_ts > best_final_score or not higher_is_better and final_ts < best_final_score:
                            best_final_score = final_ts

                    # Parse best_params from chain summary or aggregated entry
                    bp_raw = cs.get("best_params") or entry.get("best_params")
                    best_params = json.loads(bp_raw) if isinstance(bp_raw, str) else (bp_raw or None)

                    top_5.append(_sanitize_dict({
                        "chain_id": chain_id,
                        "model_name": entry.get("model_name", ""),
                        "model_class": entry.get("model_class", ""),
                        "preprocessings": entry.get("preprocessings", ""),
                        "avg_val_score": entry.get("cv_val_score"),
                        "avg_test_score": entry.get("cv_test_score"),
                        "avg_train_score": entry.get("cv_train_score"),
                        "fold_count": entry.get("cv_fold_count", 0),
                        "scores": scores_detail,
                        "final_test_score": final_ts,
                        "final_train_score": final_trs,
                        "final_scores": final_scores,
                        "best_params": best_params,
                    }))

                # Add refit-only chains not in top_5
                for rchain_id in refit_only_chain_ids:
                    rchain = refit_predictions_map[rchain_id]
                    cs = chain_summary_map.get(rchain_id, {})
                    rts = _sanitize_float(cs.get("final_test_score") or rchain.get("test_score"))
                    rtrs = _sanitize_float(cs.get("final_train_score") or rchain.get("train_score"))
                    rfinal_scores_raw = cs.get("final_scores") or rchain.get("scores")
                    rfinal_scores = json.loads(rfinal_scores_raw) if isinstance(rfinal_scores_raw, str) else (rfinal_scores_raw or {})

                    if rts is not None:
                        if best_final_score is None or higher_is_better and rts > best_final_score or not higher_is_better and rts < best_final_score:
                            best_final_score = rts

                    top_5.append(_sanitize_dict({
                        "chain_id": rchain_id,
                        "model_name": rchain.get("model_name", ""),
                        "model_class": rchain.get("model_class", ""),
                        "preprocessings": rchain.get("preprocessings", ""),
                        "avg_val_score": None,
                        "avg_test_score": None,
                        "avg_train_score": None,
                        "fold_count": 0,
                        "scores": {},
                        "final_test_score": rts,
                        "final_train_score": rtrs,
                        "final_scores": rfinal_scores,
                        "is_refit_only": True,
                    }))

                # Get task_type from first prediction
                task_type = None
                try:
                    pred_df = store.query_predictions(run_id=run_id, dataset_name=ds_name, limit=1)
                    if len(pred_df) > 0:
                        task_type = pred_df.row(0, named=True).get("task_type")
                except Exception:
                    pass

                # Dataset sample/feature counts from metadata, fallback to prediction data
                n_samples = ds_meta.get("n_samples")
                n_features = ds_meta.get("n_features")
                if (n_samples is None or n_features is None) and len(pred_df) > 0:
                    pred_row = pred_df.row(0, named=True)
                    n_samples = n_samples or pred_row.get("n_samples")
                    n_features = n_features or pred_row.get("n_features")

                enriched_datasets.append(_sanitize_dict({
                    "dataset_name": ds_name,
                    "best_avg_val_score": best_avg_val,
                    "best_avg_test_score": best_avg_test,
                    "best_final_score": _sanitize_float(best_final_score),
                    "metric": metric,
                    "task_type": task_type,
                    "gain_from_previous_best": gain,
                    "pipeline_count": len({a.get("pipeline_id") for a in agg_list}),
                    "top_5": top_5,
                    "n_samples": n_samples,
                    "n_features": n_features,
                }))

            # Compute total stats
            final_models = 0
            total_folds = 0
            total_models_trained = 0
            try:
                # Count final models (predictions with refit_context)
                final_df = store._fetch_pl(
                    "SELECT COUNT(DISTINCT chain_id) as cnt FROM predictions "
                    "WHERE pipeline_id IN (SELECT pipeline_id FROM pipelines WHERE run_id = $1) "
                    "AND refit_context IS NOT NULL",
                    [run_id]
                )
                if len(final_df) > 0:
                    final_models = final_df.row(0, named=True).get("cnt", 0) or 0

                # Count distinct folds
                folds_df = store._fetch_pl(
                    "SELECT COUNT(DISTINCT fold_id) as cnt FROM predictions "
                    "WHERE pipeline_id IN (SELECT pipeline_id FROM pipelines WHERE run_id = $1) "
                    "AND refit_context IS NULL AND fold_id != 'avg'",
                    [run_id]
                )
                if len(folds_df) > 0:
                    total_folds = folds_df.row(0, named=True).get("cnt", 0) or 0

                # Total models trained (total predictions with partition='val' and refit_context IS NULL)
                models_df = store._fetch_pl(
                    "SELECT COUNT(*) as cnt FROM predictions "
                    "WHERE pipeline_id IN (SELECT pipeline_id FROM pipelines WHERE run_id = $1) "
                    "AND partition = 'val' AND refit_context IS NULL",
                    [run_id]
                )
                if len(models_df) > 0:
                    total_models_trained = models_df.row(0, named=True).get("cnt", 0) or 0
            except Exception:
                pass

            # Artifact size
            artifact_size = self._get_run_artifact_size(run_id)

            # Model class distribution from chains
            model_classes: list[dict[str, Any]] = []
            try:
                mc_df = store._fetch_pl(
                    "SELECT c.model_class, COUNT(*) as count "
                    "FROM chains c "
                    "JOIN pipelines pl ON c.pipeline_id = pl.pipeline_id "
                    "WHERE pl.run_id = $1 "
                    "GROUP BY c.model_class ORDER BY count DESC",
                    [run_id]
                )
                for mc_row in mc_df.iter_rows(named=True):
                    model_classes.append({
                        "name": mc_row.get("model_class", ""),
                        "count": mc_row.get("count", 0),
                    })
            except Exception:
                pass

            # Derive CV config from predictions + stored run config
            run_cv_config: dict[str, Any] = {}
            try:
                cv_info_df = store._fetch_pl(
                    "SELECT COUNT(DISTINCT fold_id) as fold_count, "
                    "FIRST(metric) as metric "
                    "FROM predictions "
                    "WHERE pipeline_id IN (SELECT pipeline_id FROM pipelines WHERE run_id = $1) "
                    "AND refit_context IS NULL AND fold_id != 'avg'",
                    [run_id]
                )
                if len(cv_info_df) > 0:
                    cv_info = cv_info_df.row(0, named=True)
                    run_cv_config["cv_folds"] = cv_info.get("fold_count", 0) or 0
                    run_cv_config["metric"] = cv_info.get("metric")
            except Exception:
                pass
            # Stored config takes priority
            run_cv_config.update({k: v for k, v in run_config_data.items() if v is not None})

            enriched_runs.append(_sanitize_dict({
                "run_id": run_id,
                "name": row.get("name", ""),
                "status": row.get("status", "unknown"),
                "project_id": row.get("project_id"),
                "created_at": created_at or "",
                "completed_at": completed_at or "",
                "duration_seconds": duration_seconds,
                "artifact_size_bytes": artifact_size,
                "datasets_count": len(enriched_datasets),
                "pipeline_runs_count": pipeline_count,
                "final_models_count": final_models,
                "total_models_trained": total_models_trained,
                "total_folds": total_folds,
                "datasets": enriched_datasets,
                "error": row.get("error"),
                "config": _sanitize_dict(run_cv_config),
                "model_classes": model_classes,
            }))

        return {"runs": enriched_runs, "total": len(enriched_runs)}

    def _get_run_artifact_size(self, run_id: str) -> int:
        """Sum of artifact sizes for all chains in a run's pipelines."""
        try:
            # Use a simpler approach: get all artifact IDs from chains,
            # then sum their sizes.  The JSON extraction can be fragile
            # in the store so we fall back to 0 on any error.
            pipeline_filter = (
                "SELECT pipeline_id FROM pipelines WHERE run_id = $1"
            )
            df = self._store._fetch_pl(
                "SELECT COALESCE(SUM(a.size_bytes), 0) AS total_size "
                "FROM artifacts a "
                "WHERE a.artifact_id IN ("
                "  SELECT DISTINCT aid FROM ("
                "    SELECT json_extract_string("
                "      c.fold_artifacts, k"
                "    ) AS aid "
                "    FROM chains c, "
                "    unnest(json_keys(c.fold_artifacts)) AS t(k) "
                f"   WHERE c.pipeline_id IN ({pipeline_filter}) "
                "    AND c.fold_artifacts IS NOT NULL "
                "    UNION ALL "
                "    SELECT json_extract_string("
                "      c.shared_artifacts, k"
                "    ) AS aid "
                "    FROM chains c, "
                "    unnest(json_keys(c.shared_artifacts)) AS t(k) "
                f"   WHERE c.pipeline_id IN ({pipeline_filter}) "
                "    AND c.shared_artifacts IS NOT NULL"
                "  ) sub WHERE aid IS NOT NULL"
                ")",
                [run_id]
            )
            if len(df) > 0:
                return int(
                    df.row(0, named=True).get("total_size", 0) or 0
                )
        except Exception:
            pass
        return 0

    def _get_dataset_historical_best(self, dataset_name: str, metric: str, exclude_run_id: str | None = None) -> float | None:
        """Get the best historical cv_val_score for a dataset across all runs."""
        try:
            from nirs4all.pipeline.run import get_metric_info
            metric_info = get_metric_info(metric)
            higher_is_better = metric_info.get("higher_is_better", True)
            agg_fn = "MAX" if higher_is_better else "MIN"

            if exclude_run_id:
                df = self._store._fetch_pl(
                    f"SELECT {agg_fn}(cv_val_score) AS best FROM v_chain_summary "
                    "WHERE dataset_name = $1 AND metric = $2 AND run_id != $3",
                    [dataset_name, metric, exclude_run_id]
                )
            else:
                df = self._store._fetch_pl(
                    f"SELECT {agg_fn}(cv_val_score) AS best FROM v_chain_summary "
                    "WHERE dataset_name = $1 AND metric = $2",
                    [dataset_name, metric]
                )
            if len(df) > 0:
                val = df.row(0, named=True).get("best")
                if val is not None and not (isinstance(val, float) and (math.isnan(val) or math.isinf(val))):
                    return float(val)
        except Exception:
            pass
        return None

    # ------------------------------------------------------------------
    # All chains for a run + dataset (lazy-loaded by frontend)
    # ------------------------------------------------------------------

    def _get_pipeline_metadata_map(self, pipeline_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Load pipeline metadata needed to enrich chain display rows."""
        if not pipeline_ids:
            return {}

        try:
            placeholders = ", ".join(f"${i + 1}" for i in range(len(pipeline_ids)))
            pipelines_df = self._store._fetch_pl(
                f"SELECT pipeline_id, name, expanded_config, generator_choices "
                f"FROM pipelines WHERE pipeline_id IN ({placeholders})",
                pipeline_ids,
            )
            return {
                prow.get("pipeline_id", ""): dict(prow)
                for prow in pipelines_df.iter_rows(named=True)
            }
        except Exception:
            return {}

    def _serialize_chain_summary_row(
        self,
        entry: dict[str, Any],
        pipeline_map: dict[str, dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Convert one v_chain_summary row to the frontend chain payload."""
        pipeline_map = pipeline_map or {}
        pipeline_id = entry.get("pipeline_id", "")
        pipeline_row = pipeline_map.get(pipeline_id, {})
        cv_scores_raw = entry.get("cv_scores")
        cv_scores = json.loads(cv_scores_raw) if isinstance(cv_scores_raw, str) else (cv_scores_raw or {})
        final_scores_raw = entry.get("final_scores")
        final_scores = json.loads(final_scores_raw) if isinstance(final_scores_raw, str) else (final_scores_raw or {})
        bp_raw = entry.get("best_params")
        best_params = json.loads(bp_raw) if isinstance(bp_raw, str) else (bp_raw or None)
        step_params = _extract_model_params_from_expanded_config(
            pipeline_row.get("expanded_config"),
            entry.get("model_step_idx"),
        )
        variant_params = _merge_variant_params(step_params, best_params)

        return _sanitize_dict({
            "chain_id": entry.get("chain_id", ""),
            "run_id": entry.get("run_id", ""),
            "pipeline_id": pipeline_id,
            "pipeline_name": pipeline_row.get("name"),
            "model_name": entry.get("model_name", ""),
            "model_class": entry.get("model_class", ""),
            "preprocessings": entry.get("preprocessings", ""),
            "best_params": best_params,
            "variant_params": variant_params,
            "cv_val_score": _sanitize_float(entry.get("cv_val_score")),
            "cv_test_score": _sanitize_float(entry.get("cv_test_score")),
            "cv_train_score": _sanitize_float(entry.get("cv_train_score")),
            "cv_fold_count": entry.get("cv_fold_count", 0),
            "cv_scores": cv_scores,
            "final_test_score": _sanitize_float(entry.get("final_test_score")),
            "final_train_score": _sanitize_float(entry.get("final_train_score")),
            "final_scores": final_scores,
            "metric": entry.get("metric"),
            "task_type": entry.get("task_type"),
        })

    def get_all_chains_for_dataset(self, run_id: str, dataset_name: str) -> dict[str, Any]:
        """Get ALL chain summaries for a run+dataset, sorted by primary metric.

        Returns:
            ``{"chains": [...], "total": N, "metric": "rmse"}``
        """
        store = self._store
        try:
            df = store.query_chain_summaries(run_id=run_id, dataset_name=dataset_name)
        except Exception:
            return {"chains": [], "total": 0, "metric": None}

        if len(df) == 0:
            return {"chains": [], "total": 0, "metric": None}

        rows = [dict(row) for row in df.iter_rows(named=True)]
        _enrich_refit_with_cv_inplace(rows)
        metric = next((r.get("metric") for r in rows if r.get("metric")), "r2")
        pipeline_ids = list({r.get("pipeline_id") for r in rows if r.get("pipeline_id")})
        pipeline_map = self._get_pipeline_metadata_map(pipeline_ids)

        from nirs4all.pipeline.run import get_metric_info
        metric_info = get_metric_info(metric)
        higher_is_better = metric_info.get("higher_is_better", True)

        # Sort by cv_val_score
        scored = [r for r in rows if r.get("cv_val_score") is not None]
        unscored = [r for r in rows if r.get("cv_val_score") is None]
        scored.sort(key=lambda x: x.get("cv_val_score", 0), reverse=higher_is_better)

        chains = []
        for entry in scored + unscored:
            chains.append(self._serialize_chain_summary_row(entry, pipeline_map))

        return {"chains": chains, "total": len(chains), "metric": metric}

    def get_all_chains_for_results_dataset(self, dataset_name: str) -> dict[str, Any]:
        """Get ALL chain summaries for one dataset across all runs."""
        store = self._store
        try:
            df = store.query_chain_summaries(dataset_name=dataset_name)
        except Exception:
            return {"chains": [], "total": 0, "metric": None}

        if len(df) == 0:
            return {"chains": [], "total": 0, "metric": None}

        rows = [dict(row) for row in df.iter_rows(named=True)]
        _enrich_refit_with_cv_inplace(rows)
        metric = next((r.get("metric") for r in rows if r.get("metric")), "r2")
        pipeline_ids = list({r.get("pipeline_id") for r in rows if r.get("pipeline_id")})
        pipeline_map = self._get_pipeline_metadata_map(pipeline_ids)

        from nirs4all.pipeline.run import get_metric_info
        metric_info = get_metric_info(metric)
        higher_is_better = metric_info.get("higher_is_better", True)

        scored = [r for r in rows if r.get("cv_val_score") is not None]
        unscored = [r for r in rows if r.get("cv_val_score") is None]
        scored.sort(key=lambda x: x.get("cv_val_score", 0), reverse=higher_is_better)

        chains = [self._serialize_chain_summary_row(entry, pipeline_map) for entry in scored + unscored]
        return {"chains": chains, "total": len(chains), "metric": metric}

    # ------------------------------------------------------------------
    # Results Summary (top models per dataset)
    # ------------------------------------------------------------------

    def get_dataset_top_chains(self, n: int = 5) -> dict[str, Any]:
        """Get top N models per dataset across all runs, with final scores.

        Uses the ``v_chain_summary`` view which has both CV averages and
        final/refit scores pre-computed on each chain row. The returned
        ``top_chains`` list always includes the best refit/final chain
        when one exists, even if that chain falls outside the top ``n``
        cross-validation ranks.

        Implementation notes (Phase 5 of the startup-perf plan):
            * Per-dataset ranking is performed in Python over a single
              streamed pass of the chain-summary rows. Heavy fields
              (``cv_scores``/``final_scores``/``best_params`` JSON blobs)
              are only deserialized for chains that survive the ranking.
            * ``_get_pipeline_metadata_map`` is now called only with the
              pipeline IDs of the chains that are actually emitted, not
              every pipeline that has a chain row in the store. This
              avoids loading and JSON-parsing ``expanded_config`` for
              pipelines that get filtered out.
            * Metric direction (lower-is-better vs higher-is-better) is
              looked up once per metric so a workspace with many
              datasets sharing one metric only pays the lookup cost
              once.

        Returns:
            ``{"datasets": [{"dataset_name", "metric", "task_type", "top_chains": [...]}]}``
        """
        store = self._store
        try:
            all_df = store.query_chain_summaries()
        except Exception:
            return {"datasets": []}

        if len(all_df) == 0:
            return {"datasets": []}

        from nirs4all.pipeline.run import get_metric_info

        def _coerce_score(value: Any) -> float | None:
            value = _sanitize_float(value)
            if value is None:
                return None
            try:
                return float(value)
            except Exception:
                return None

        # Cache metric direction lookups - many datasets share a metric.
        metric_direction_cache: dict[str, bool] = {}

        def _higher_is_better(metric_name: str | None) -> bool:
            key = metric_name or ""
            cached = metric_direction_cache.get(key)
            if cached is not None:
                return cached
            info = get_metric_info(metric_name) if metric_name else {}
            value = bool(info.get("higher_is_better", True))
            metric_direction_cache[key] = value
            return value

        # Single pass: bucket rows by dataset_name. Skip rows without one.
        datasets: dict[str, list[dict[str, Any]]] = {}
        for row in all_df.iter_rows(named=True):
            ds = row.get("dataset_name") or ""
            if not ds:
                continue
            datasets.setdefault(ds, []).append(dict(row))

        # Inherit CV scores from sibling CV chains for refit-only entries.
        for ds_chains in datasets.values():
            _enrich_refit_with_cv_inplace(ds_chains)

        # Phase 1: rank per dataset and collect ONLY the rows we will emit.
        # We defer pipeline-metadata loading and JSON deserialization until
        # after this filter so we never pay those costs for chains that get
        # dropped on the floor. Each selection is a (entry, is_refit_only)
        # tuple.
        per_dataset_selection: list[
            tuple[str, str, str | None, list[tuple[dict[str, Any], bool]]]
        ] = []

        for ds_name in sorted(datasets):
            ds_chains = datasets[ds_name]
            metric = next((c.get("metric") for c in ds_chains if c.get("metric")), "r2")
            task_type = next((c.get("task_type") for c in ds_chains if c.get("task_type")), None)
            higher_is_better = _higher_is_better(metric)

            # Best final/refit chain across all rows for this dataset.
            best_final_entry: dict[str, Any] | None = None
            best_final_score: float | None = None

            cv_chains: list[dict[str, Any]] = []
            refit_only: list[dict[str, Any]] = []

            for entry in ds_chains:
                fold_count = entry.get("cv_fold_count") or 0
                final_score = _coerce_score(entry.get("final_test_score"))
                if fold_count > 0:
                    cv_chains.append(entry)
                elif final_score is not None:
                    refit_only.append(entry)

                if final_score is not None and (best_final_score is None or (higher_is_better and final_score > best_final_score) or (not higher_is_better and final_score < best_final_score)):
                    best_final_score = final_score
                    best_final_entry = entry

            # Rank CV chains by cv_val_score (None pushed to the end).
            sentinel = float("-inf") if higher_is_better else float("inf")

            def _cv_key(c: dict[str, Any], _s: float = sentinel) -> float:
                v = c.get("cv_val_score")
                return v if v is not None else _s

            cv_chains.sort(key=_cv_key, reverse=higher_is_better)
            top_cv = cv_chains[:n]

            # Build the ordered selection list, deduping by chain_id while
            # preserving emission order: top CV first, then refit-only,
            # then the best-final fallback if it is not already present.
            seen_chain_ids: set[str] = set()
            selected: list[tuple[dict[str, Any], bool]] = []
            for entry in top_cv:
                cid = entry.get("chain_id") or ""
                if cid and cid in seen_chain_ids:
                    continue
                if cid:
                    seen_chain_ids.add(cid)
                selected.append((entry, False))

            for entry in refit_only:
                cid = entry.get("chain_id") or ""
                if cid and cid in seen_chain_ids:
                    continue
                if cid:
                    seen_chain_ids.add(cid)
                selected.append((entry, True))

            if best_final_entry is not None:
                cid = best_final_entry.get("chain_id") or ""
                if cid and cid not in seen_chain_ids:
                    seen_chain_ids.add(cid)
                    # Best-final is appended without is_refit_only=True so
                    # the legacy payload shape (no flag) is preserved for
                    # final chains that ALSO had CV folds.
                    selected.append((best_final_entry, False))

            if not selected:
                continue

            per_dataset_selection.append((ds_name, metric, task_type, selected))

        if not per_dataset_selection:
            return {"datasets": []}

        # Phase 2: load pipeline metadata only for the chains we will emit.
        needed_pipeline_ids: set[str] = set()
        for _ds, _metric, _task, sel in per_dataset_selection:
            for entry, _is_refit in sel:
                pid = entry.get("pipeline_id")
                if pid:
                    needed_pipeline_ids.add(pid)
        pipeline_map = self._get_pipeline_metadata_map(list(needed_pipeline_ids))

        # Phase 3: serialize selected chains.
        datasets_result: list[dict[str, Any]] = []
        for ds_name, metric, task_type, selected in per_dataset_selection:
            top_chains: list[dict[str, Any]] = []
            for entry, is_refit_only in selected:
                chain = self._serialize_chain_summary_row(entry, pipeline_map)
                payload: dict[str, Any] = {
                    "chain_id": chain.get("chain_id", ""),
                    "run_id": chain.get("run_id", ""),
                    "pipeline_id": chain.get("pipeline_id"),
                    "pipeline_name": chain.get("pipeline_name"),
                    "model_name": chain.get("model_name", ""),
                    "model_class": chain.get("model_class", ""),
                    "preprocessings": chain.get("preprocessings", ""),
                    "avg_val_score": chain.get("cv_val_score"),
                    "avg_test_score": chain.get("cv_test_score"),
                    "avg_train_score": chain.get("cv_train_score"),
                    "fold_count": chain.get("cv_fold_count", 0),
                    "scores": chain.get("cv_scores", {}),
                    "final_test_score": chain.get("final_test_score"),
                    "final_train_score": chain.get("final_train_score"),
                    "final_scores": chain.get("final_scores", {}),
                    "best_params": chain.get("best_params"),
                    "variant_params": chain.get("variant_params"),
                }
                if is_refit_only:
                    payload["is_refit_only"] = True
                top_chains.append(_sanitize_dict(payload))

            datasets_result.append(_sanitize_dict({
                "dataset_name": ds_name,
                "metric": metric,
                "task_type": task_type,
                "top_chains": top_chains,
            }))

        return {"datasets": datasets_result}

    # ------------------------------------------------------------------
    # Score Distribution
    # ------------------------------------------------------------------

    def get_score_distribution(self, run_id: str, dataset_name: str, n_bins: int = 20) -> dict[str, Any]:
        """Get score distribution histogram data for a run+dataset, per partition."""
        import numpy as np
        result: dict[str, Any] = {"dataset_name": dataset_name, "metric": None, "partitions": {}}
        try:
            df = self._store._fetch_pl(
                "SELECT pr.partition, pr.val_score, pr.test_score, pr.train_score, pr.metric, pr.fold_id, pr.refit_context "
                "FROM predictions pr "
                "JOIN pipelines pl ON pr.pipeline_id = pl.pipeline_id "
                "WHERE pl.run_id = $1 AND pr.dataset_name = $2",
                [run_id, dataset_name]
            )
            if len(df) == 0:
                return result

            # Get metric
            result["metric"] = df.row(0, named=True).get("metric", "r2")

            # Build histogram per partition type
            for part_name, score_col, filter_fn in [
                ("val", "val_score", lambda r: r.get("refit_context") is None),
                ("test", "test_score", lambda r: r.get("refit_context") is None),
                ("train", "train_score", lambda r: r.get("refit_context") is None),
                ("final", "test_score", lambda r: r.get("refit_context") is not None),
            ]:
                scores = []
                for row in df.iter_rows(named=True):
                    if filter_fn(row):
                        val = row.get(score_col)
                        if val is not None and isinstance(val, (int, float)) and not (isinstance(val, float) and (math.isnan(val) or math.isinf(val))):
                            scores.append(float(val))

                if not scores:
                    continue

                # Compute histogram
                scores_arr = np.array(scores)
                counts, bin_edges = np.histogram(scores_arr, bins=min(n_bins, len(scores)))
                result["partitions"][part_name] = {
                    "bins": [round(float(b), 6) for b in bin_edges],
                    "counts": [int(c) for c in counts],
                    "n_scores": len(scores),
                    "min": round(float(scores_arr.min()), 6),
                    "max": round(float(scores_arr.max()), 6),
                    "mean": round(float(scores_arr.mean()), 6),
                }
        except Exception:
            pass
        return result

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close the underlying store connection."""
        self._store.close()
