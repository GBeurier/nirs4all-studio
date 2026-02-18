"""Adapter between webapp endpoints and WorkspaceStore.

Provides convenience methods for webapp-specific queries that combine
or format WorkspaceStore data for the frontend.  The adapter is a thin
layer -- all data operations are delegated to ``WorkspaceStore``.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

# WorkspaceStore is optional (nirs4all may not be installed)
try:
    from nirs4all.pipeline.storage import WorkspaceStore

    STORE_AVAILABLE = True
except ImportError:
    WorkspaceStore = None  # type: ignore[assignment, misc]
    STORE_AVAILABLE = False


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
        self._store = WorkspaceStore(workspace_path)

    def __enter__(self) -> "StoreAdapter":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @property
    def store(self) -> WorkspaceStore:
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
            "generated_at": datetime.now(timezone.utc).isoformat(),
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
            records.append(d)

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

        # Total count (without limit) for the frontend pagination display.
        total_df = self._store.query_predictions(
            dataset_name=dataset_name, model_class=model_class, partition=partition,
        )
        total = len(total_df)

        return {
            "records": records,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        }

    def get_prediction_scatter(self, prediction_id: str) -> dict[str, Any] | None:
        """Get scatter plot data for a prediction.

        Args:
            prediction_id: Prediction identifier.

        Returns:
            Dict with y_true, y_pred, n_samples, partition, model_name,
            dataset_name; or ``None`` if not found.
        """
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

            # Group by dataset_name
            datasets_map: dict[str, list] = {}
            for agg in agg_rows:
                ds = agg.get("dataset_name", "unknown")
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

            # Ensure we have all datasets even if no predictions yet
            for dm in datasets_meta:
                ds_name = dm.get("name", "") if isinstance(dm, dict) else str(dm)
                if ds_name and ds_name not in datasets_map:
                    datasets_map[ds_name] = []

            # Build per-dataset enriched data
            enriched_datasets = []
            for ds_name, agg_list in datasets_map.items():
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

                # Also find refit-only chains for this run+dataset
                refit_only_chains: list[dict[str, Any]] = []
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
                        if rrow.get("chain_id", "") not in top_5_chain_ids:
                            refit_only_chains.append(dict(rrow))
                except Exception:
                    pass

                # Load chain summary data (cv_scores + final scores already precomputed)
                all_chain_ids = list(top_5_chain_ids | {r.get("chain_id", "") for r in refit_only_chains})
                chain_summary_map: dict[str, dict[str, Any]] = {}
                if all_chain_ids:
                    try:
                        ph = ", ".join(f"${i + 1}" for i in range(len(all_chain_ids)))
                        cs_df = store._fetch_pl(
                            f"SELECT chain_id, cv_scores, final_test_score, final_train_score, final_scores "
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

                    if final_ts is not None:
                        if best_final_score is None:
                            best_final_score = final_ts
                        elif higher_is_better and final_ts > best_final_score:
                            best_final_score = final_ts
                        elif not higher_is_better and final_ts < best_final_score:
                            best_final_score = final_ts

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
                    }))

                # Add refit-only chains not in top_5
                for rchain in refit_only_chains:
                    rchain_id = rchain.get("chain_id", "")
                    cs = chain_summary_map.get(rchain_id, {})
                    rts = _sanitize_float(cs.get("final_test_score") or rchain.get("test_score"))
                    rtrs = _sanitize_float(cs.get("final_train_score") or rchain.get("train_score"))
                    rfinal_scores_raw = cs.get("final_scores") or rchain.get("scores")
                    rfinal_scores = json.loads(rfinal_scores_raw) if isinstance(rfinal_scores_raw, str) else (rfinal_scores_raw or {})

                    if rts is not None:
                        if best_final_score is None:
                            best_final_score = rts
                        elif higher_is_better and rts > best_final_score:
                            best_final_score = rts
                        elif not higher_is_better and rts < best_final_score:
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

                enriched_datasets.append(_sanitize_dict({
                    "dataset_name": ds_name,
                    "best_avg_val_score": best_avg_val,
                    "best_avg_test_score": best_avg_test,
                    "best_final_score": _sanitize_float(best_final_score),
                    "metric": metric,
                    "task_type": task_type,
                    "gain_from_previous_best": gain,
                    "pipeline_count": len(set(a.get("pipeline_id") for a in agg_list)),
                    "top_5": top_5,
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
            }))

        return {"runs": enriched_runs, "total": len(enriched_runs)}

    def _get_run_artifact_size(self, run_id: str) -> int:
        """Sum of artifact sizes for all chains in a run's pipelines."""
        try:
            # Use a simpler approach: get all artifact IDs from chains,
            # then sum their sizes.  The JSON extraction can be fragile
            # in DuckDB so we fall back to 0 on any error.
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
    # Results Summary (top models per dataset)
    # ------------------------------------------------------------------

    def get_dataset_top_chains(self, n: int = 5) -> dict[str, Any]:
        """Get top N models per dataset across all runs, with final scores.

        Uses the ``v_chain_summary`` view which has both CV averages and
        final/refit scores pre-computed on each chain row.

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

        # Group chains by dataset
        datasets_result: list[dict[str, Any]] = []
        rows = list(all_df.iter_rows(named=True))
        datasets: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            ds = row.get("dataset_name") or ""
            if ds:
                datasets.setdefault(ds, []).append(dict(row))

        for ds_name in sorted(datasets):
            ds_chains = datasets[ds_name]
            metric = next((c.get("metric") for c in ds_chains if c.get("metric")), "r2")
            task_type = next((c.get("task_type") for c in ds_chains if c.get("task_type")), None)
            metric_info = get_metric_info(metric)
            higher_is_better = metric_info.get("higher_is_better", True)

            # Separate CV chains (have cv_fold_count > 0) and refit-only
            cv_chains = [c for c in ds_chains if (c.get("cv_fold_count") or 0) > 0]
            refit_only = [c for c in ds_chains if (c.get("cv_fold_count") or 0) == 0 and c.get("final_test_score") is not None]

            # Sort CV chains by cv_val_score
            cv_chains.sort(
                key=lambda x: x.get("cv_val_score") if x.get("cv_val_score") is not None else (float("inf") if not higher_is_better else float("-inf")),
                reverse=higher_is_better,
            )

            top_chains = []
            cv_chain_ids: set[str] = set()

            for entry in cv_chains[:n]:
                chain_id = entry.get("chain_id", "")
                cv_chain_ids.add(chain_id)
                cv_scores_raw = entry.get("cv_scores")
                cv_scores = json.loads(cv_scores_raw) if isinstance(cv_scores_raw, str) else (cv_scores_raw or {})
                final_scores_raw = entry.get("final_scores")
                final_scores = json.loads(final_scores_raw) if isinstance(final_scores_raw, str) else (final_scores_raw or {})
                top_chains.append(_sanitize_dict({
                    "chain_id": chain_id,
                    "run_id": entry.get("run_id", ""),
                    "model_name": entry.get("model_name", ""),
                    "model_class": entry.get("model_class", ""),
                    "preprocessings": entry.get("preprocessings", ""),
                    "avg_val_score": entry.get("cv_val_score"),
                    "avg_test_score": entry.get("cv_test_score"),
                    "avg_train_score": entry.get("cv_train_score"),
                    "fold_count": entry.get("cv_fold_count", 0),
                    "scores": cv_scores,
                    "final_test_score": entry.get("final_test_score"),
                    "final_train_score": entry.get("final_train_score"),
                    "final_scores": final_scores,
                }))

            # Add refit-only chains
            for entry in refit_only:
                chain_id = entry.get("chain_id", "")
                if chain_id in cv_chain_ids:
                    continue
                final_scores_raw = entry.get("final_scores")
                final_scores = json.loads(final_scores_raw) if isinstance(final_scores_raw, str) else (final_scores_raw or {})
                top_chains.append(_sanitize_dict({
                    "chain_id": chain_id,
                    "run_id": entry.get("run_id", ""),
                    "model_name": entry.get("model_name", ""),
                    "model_class": entry.get("model_class", ""),
                    "preprocessings": entry.get("preprocessings", ""),
                    "avg_val_score": None,
                    "avg_test_score": None,
                    "avg_train_score": None,
                    "fold_count": 0,
                    "scores": {},
                    "final_test_score": entry.get("final_test_score"),
                    "final_train_score": entry.get("final_train_score"),
                    "final_scores": final_scores,
                    "is_refit_only": True,
                }))

            if not top_chains:
                continue

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
