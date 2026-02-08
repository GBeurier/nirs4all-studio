"""Adapter between webapp endpoints and WorkspaceStore.

Provides convenience methods for webapp-specific queries that combine
or format WorkspaceStore data for the frontend.  The adapter is a thin
layer -- all data operations are delegated to ``WorkspaceStore``.
"""

from __future__ import annotations

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
    # Lifecycle
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close the underlying store connection."""
        self._store.close()
