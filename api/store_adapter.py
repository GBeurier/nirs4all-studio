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
        top_predictions = [_sanitize_dict(dict(row)) for row in top_df.iter_rows(named=True)]

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
        records = [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

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
    # Aggregated Predictions
    # ------------------------------------------------------------------

    def get_aggregated_predictions(
        self,
        run_id: str | None = None,
        pipeline_id: str | None = None,
        chain_id: str | None = None,
        dataset_name: str | None = None,
        model_class: str | None = None,
        metric: str | None = None,
    ) -> list[dict[str, Any]]:
        """Query aggregated predictions (one row per chain × metric × dataset).

        Args:
            run_id: Optional run filter.
            pipeline_id: Optional pipeline filter.
            chain_id: Optional chain filter.
            dataset_name: Optional dataset filter.
            model_class: Optional model class filter.
            metric: Optional metric filter.

        Returns:
            List of sanitized aggregated prediction dicts.
        """
        df = self._store.query_aggregated_predictions(
            run_id=run_id,
            pipeline_id=pipeline_id,
            chain_id=chain_id,
            dataset_name=dataset_name,
            model_class=model_class,
            metric=metric,
        )
        return [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

    def get_top_aggregated_predictions(
        self,
        metric: str,
        n: int = 10,
        score_column: str = "avg_val_score",
        **filters: Any,
    ) -> list[dict[str, Any]]:
        """Get top-N aggregated predictions ranked by metric.

        Args:
            metric: Metric name for ranking (e.g. ``"rmse"``, ``"r2"``).
            n: Number of top results.
            score_column: Column to sort by.
            **filters: Additional filters (run_id, pipeline_id, etc.).

        Returns:
            List of sanitized top aggregated prediction dicts.
        """
        df = self._store.query_top_aggregated_predictions(
            metric=metric,
            n=n,
            score_column=score_column,
            **filters,
        )
        return [_sanitize_dict(dict(row)) for row in df.iter_rows(named=True)]

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

            # Get aggregated predictions for this run (uses v_aggregated_predictions view)
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

                # Sort aggregated entries by avg_val_score
                sorted_agg = sorted(
                    [a for a in agg_list if a.get("avg_val_score") is not None],
                    key=lambda x: x.get("avg_val_score", 0),
                    reverse=higher_is_better,
                )

                best = sorted_agg[0] if sorted_agg else {}
                best_avg_val = _sanitize_float(best.get("avg_val_score"))
                best_avg_test = _sanitize_float(best.get("avg_test_score"))

                # Historical best for gain calculation
                gain = None
                try:
                    hist_best = self._get_dataset_historical_best(ds_name, metric, exclude_run_id=run_id)
                    if hist_best is not None and best_avg_val is not None:
                        gain = round(best_avg_val - hist_best, 6)
                except Exception:
                    pass

                # Top 5 chains
                top_5 = []
                for entry in sorted_agg[:5]:
                    # Get detailed scores from predictions for this chain
                    chain_id = entry.get("chain_id", "")
                    scores_detail = self._get_chain_multi_metric_scores(chain_id)

                    top_5.append(_sanitize_dict({
                        "chain_id": chain_id,
                        "model_name": entry.get("model_name", ""),
                        "model_class": entry.get("model_class", ""),
                        "preprocessings": entry.get("preprocessings", ""),
                        "avg_val_score": entry.get("avg_val_score"),
                        "avg_test_score": entry.get("avg_test_score"),
                        "fold_count": entry.get("fold_count", 0),
                        "scores": scores_detail,
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
        """Get the best historical avg_val_score for a dataset across all runs."""
        try:
            from nirs4all.pipeline.run import get_metric_info
            metric_info = get_metric_info(metric)
            higher_is_better = metric_info.get("higher_is_better", True)
            agg_fn = "MAX" if higher_is_better else "MIN"

            if exclude_run_id:
                df = self._store._fetch_pl(
                    f"SELECT {agg_fn}(avg_val_score) AS best FROM v_aggregated_predictions "
                    "WHERE dataset_name = $1 AND metric = $2 AND run_id != $3",
                    [dataset_name, metric, exclude_run_id]
                )
            else:
                df = self._store._fetch_pl(
                    f"SELECT {agg_fn}(avg_val_score) AS best FROM v_aggregated_predictions "
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

    def _get_chain_multi_metric_scores(self, chain_id: str) -> dict[str, dict[str, float | None]]:
        """Get averaged multi-metric scores for a chain across folds.

        Returns dict like: {"val": {"r2": 0.95, "rmse": 0.12, "rpd": 3.2}, "test": {...}}
        """
        result: dict[str, dict[str, float | None]] = {"val": {}, "test": {}}
        try:
            df = self._store._fetch_pl(
                "SELECT partition, scores FROM predictions "
                "WHERE chain_id = $1 AND refit_context IS NULL AND partition IN ('val', 'test')",
                [chain_id]
            )
            # Accumulate scores per partition
            partition_scores: dict[str, dict[str, list[float]]] = {"val": {}, "test": {}}
            for row in df.iter_rows(named=True):
                part = row.get("partition", "")
                scores_raw = row.get("scores")
                if not scores_raw:
                    continue
                scores = json.loads(scores_raw) if isinstance(scores_raw, str) else scores_raw
                if not isinstance(scores, dict):
                    continue
                # scores format: {"val": {"r2": 0.95, "rmse": 0.12}, "test": {...}} or flat {"r2": 0.95}
                # Try nested first (scores[partition])
                inner = scores.get(part, scores)
                if isinstance(inner, dict):
                    if part not in partition_scores:
                        partition_scores[part] = {}
                    for metric_name, val in inner.items():
                        if isinstance(val, (int, float)) and not (isinstance(val, float) and (math.isnan(val) or math.isinf(val))):
                            if metric_name not in partition_scores[part]:
                                partition_scores[part][metric_name] = []
                            partition_scores[part][metric_name].append(float(val))

            # Average scores
            for part in ("val", "test"):
                for metric_name, values in partition_scores.get(part, {}).items():
                    if values:
                        result[part][metric_name] = round(sum(values) / len(values), 6)
        except Exception:
            pass
        return _sanitize_dict(result)

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
