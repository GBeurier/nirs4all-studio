"""Batched builder for the results-dashboard enriched-runs payload.

``StoreAdapter.get_enriched_runs`` used to issue per-run / per-dataset store
queries inside a loop (N+1 fan-out). This module rebuilds the same payload
with set-based queries keyed by the page's ``run_id`` list: one
``list_runs``, one chain-summary query, one pipelines fetch, and one batched
query for each aggregate (predictions sample row, refit predictions, count
stats, model-class distribution, CV info, artifact sizes). Per-run loops then
run over the already-materialized in-memory rows.

The response shape preserves the previous monolith and additionally threads
native launch metadata that must survive workspace reloads.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Callable

from .robustness_contract import (
    build_robustness_execution_diagnostic,
    normalize_robustness_launch_payload,
)
from .shared.json_safe import sanitize_dict, sanitize_float

# Imported lazily at module load -- store_adapter imports EnrichedRunsBuilder
# only inside get_enriched_runs(), so store_adapter is fully initialized by the
# time this module is first imported.
from .store_adapter import (  # noqa: E402
    _aggregate_runtime_fields,
    _apply_synthetic_refit_fallback_inplace,
    _attach_variant_params_inplace,
    _coerce_metric_name,
    _infer_run_config_from_pipelines,
)

_PARASITIC_DS_RE = re.compile(r"_X_?(?:cal|val)$", re.IGNORECASE)


def _placeholders(values: list[Any]) -> str:
    """Return ``$1, $2, ...`` placeholders for a positional-param query."""
    return ", ".join(f"${i + 1}" for i in range(len(values)))


def _grouped_rows(df: Any, key: str) -> dict[str, list[dict[str, Any]]]:
    """Bucket a frame's rows by a string column value."""
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in df.iter_rows(named=True):
        row_dict = dict(row)
        grouped.setdefault(str(row_dict.get(key) or ""), []).append(row_dict)
    return grouped


def _extract_robustness_launch_plan(run_config_data: dict[str, Any]) -> dict[str, Any] | None:
    raw = run_config_data.get("robustness")
    if raw is None:
        return None
    try:
        return normalize_robustness_launch_payload(raw)
    except (TypeError, ValueError):
        return None


def _robustness_launch_fields(robustness_plan: dict[str, Any] | None) -> dict[str, Any]:
    if not robustness_plan:
        return {}
    return {
        "robustness_plan": robustness_plan,
        "robustness_execution": build_robustness_execution_diagnostic(robustness_plan),
    }


class EnrichedRunsBuilder:
    """Builds the enriched-runs payload with batched store access."""

    def __init__(
        self,
        store: Any,
        *,
        artifact_size_lookup: Callable[[str], int],
        historical_best_lookup: Callable[[str, str, str | None], float | None],
    ) -> None:
        self._store = store
        self._artifact_size_lookup = artifact_size_lookup
        self._historical_best_lookup = historical_best_lookup

    # -- batched fetch helpers ----------------------------------------

    def _fetch_pipelines(self, run_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        ph = _placeholders(run_ids)
        df = self._store._fetch_pl(
            f"SELECT * FROM pipelines WHERE run_id IN ({ph}) ORDER BY created_at DESC",
            run_ids,
        )
        return _grouped_rows(df, "run_id")

    def _fetch_chain_summaries(self, run_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        df = self._store.query_chain_summaries(run_id=run_ids)
        return _grouped_rows(df, "run_id")

    def _fetch_sample_rows(self, run_ids: list[str]) -> dict[tuple[str, str], dict[str, Any]]:
        """First prediction row per (run_id, dataset_name) for task-type fallback."""
        ph = _placeholders(run_ids)
        try:
            df = self._store._fetch_pl(
                "SELECT pr.run_id, pr.dataset_name, pr.task_type, pr.metric, "
                "pr.n_samples, pr.n_features FROM predictions pr "
                f"WHERE pr.run_id IN ({ph})",
                run_ids,
            )
        except Exception:
            return {}
        sample_rows: dict[tuple[str, str], dict[str, Any]] = {}
        for row in df.iter_rows(named=True):
            row_dict = dict(row)
            key = (str(row_dict.get("run_id") or ""), str(row_dict.get("dataset_name") or ""))
            sample_rows.setdefault(key, row_dict)
        return sample_rows

    def _fetch_refit_predictions(self, run_ids: list[str]) -> dict[tuple[str, str], dict[str, dict[str, Any]]]:
        """All refit/final test predictions grouped by (run_id, dataset_name) -> {chain_id: row}."""
        ph = _placeholders(run_ids)
        result: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
        try:
            df = self._store._fetch_pl(
                "SELECT pl.run_id, p.dataset_name, p.chain_id, p.model_name, p.model_class, "
                "p.test_score, p.train_score, p.scores, p.preprocessings "
                "FROM predictions p "
                "JOIN chains c ON p.chain_id = c.chain_id "
                "JOIN pipelines pl ON c.pipeline_id = pl.pipeline_id "
                f"WHERE pl.run_id IN ({ph}) "
                "AND p.refit_context IS NOT NULL AND p.fold_id = 'final' AND p.partition = 'test'",
                run_ids,
            )
        except Exception:
            return {}
        for row in df.iter_rows(named=True):
            row_dict = dict(row)
            key = (str(row_dict.get("run_id") or ""), str(row_dict.get("dataset_name") or ""))
            result.setdefault(key, {})[row_dict.get("chain_id", "")] = row_dict
        return result

    def _fetch_run_counts(self, run_ids: list[str]) -> dict[str, dict[str, int]]:
        """Final-model, fold, and trained-model counts grouped by run_id."""
        ph = _placeholders(run_ids)
        counts: dict[str, dict[str, int]] = {}

        def _slot(run_id: str) -> dict[str, int]:
            return counts.setdefault(run_id, {"final_models": 0, "total_folds": 0, "total_models_trained": 0})

        try:
            final_df = self._store._fetch_pl(
                "SELECT pl.run_id AS run_id, COUNT(DISTINCT p.chain_id) as cnt FROM predictions p "
                "JOIN pipelines pl ON p.pipeline_id = pl.pipeline_id "
                f"WHERE pl.run_id IN ({ph}) AND p.refit_context IS NOT NULL "
                "GROUP BY pl.run_id",
                run_ids,
            )
            for row in final_df.iter_rows(named=True):
                _slot(str(row.get("run_id") or ""))["final_models"] = int(row.get("cnt", 0) or 0)
        except Exception:
            pass

        try:
            folds_df = self._store._fetch_pl(
                "SELECT pl.run_id AS run_id, COUNT(DISTINCT p.fold_id) as cnt FROM predictions p "
                "JOIN pipelines pl ON p.pipeline_id = pl.pipeline_id "
                f"WHERE pl.run_id IN ({ph}) AND p.refit_context IS NULL "
                "AND p.fold_id NOT IN ('avg', 'w_avg') AND p.fold_id NOT LIKE '%_agg' "
                "GROUP BY pl.run_id",
                run_ids,
            )
            for row in folds_df.iter_rows(named=True):
                _slot(str(row.get("run_id") or ""))["total_folds"] = int(row.get("cnt", 0) or 0)
        except Exception:
            pass

        try:
            models_df = self._store._fetch_pl(
                "SELECT pl.run_id AS run_id, COUNT(*) as cnt FROM predictions p "
                "JOIN pipelines pl ON p.pipeline_id = pl.pipeline_id "
                f"WHERE pl.run_id IN ({ph}) AND p.partition = 'val' AND p.refit_context IS NULL "
                "AND p.fold_id NOT IN ('avg', 'w_avg') AND p.fold_id NOT LIKE '%_agg' "
                "GROUP BY pl.run_id",
                run_ids,
            )
            for row in models_df.iter_rows(named=True):
                _slot(str(row.get("run_id") or ""))["total_models_trained"] = int(row.get("cnt", 0) or 0)
        except Exception:
            pass

        return counts

    def _fetch_model_classes(self, run_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        """Model-class distribution grouped by run_id, count-descending per run."""
        ph = _placeholders(run_ids)
        result: dict[str, list[dict[str, Any]]] = {}
        try:
            df = self._store._fetch_pl(
                "SELECT pl.run_id AS run_id, c.model_class, COUNT(*) as count "
                "FROM chains c JOIN pipelines pl ON c.pipeline_id = pl.pipeline_id "
                f"WHERE pl.run_id IN ({ph}) "
                "GROUP BY pl.run_id, c.model_class ORDER BY count DESC",
                run_ids,
            )
        except Exception:
            return {}
        for row in df.iter_rows(named=True):
            run_id = str(row.get("run_id") or "")
            result.setdefault(run_id, []).append({
                "name": row.get("model_class", ""),
                "count": row.get("count", 0),
            })
        return result

    def _fetch_cv_info(self, run_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Distinct-fold count + a representative metric grouped by run_id."""
        ph = _placeholders(run_ids)
        result: dict[str, dict[str, Any]] = {}
        try:
            df = self._store._fetch_pl(
                "SELECT pl.run_id AS run_id, COUNT(DISTINCT p.fold_id) as fold_count, "
                "FIRST(p.metric) as metric FROM predictions p "
                "JOIN pipelines pl ON p.pipeline_id = pl.pipeline_id "
                f"WHERE pl.run_id IN ({ph}) AND p.refit_context IS NULL "
                "AND p.fold_id NOT IN ('avg', 'w_avg') AND p.fold_id NOT LIKE '%_agg' "
                "GROUP BY pl.run_id",
                run_ids,
            )
        except Exception:
            return {}
        for row in df.iter_rows(named=True):
            result[str(row.get("run_id") or "")] = dict(row)
        return result

    # -- payload assembly --------------------------------------------

    def build(self, limit: int, offset: int, project_id: str | None) -> dict[str, Any]:
        store = self._store

        runs_df = store.list_runs(limit=limit + offset, offset=0)
        all_rows = list(runs_df.iter_rows(named=True))

        if project_id is not None:
            all_rows = [r for r in all_rows if r.get("project_id") == project_id]

        all_rows = all_rows[offset:offset + limit]
        if not all_rows:
            return {"runs": [], "total": 0}

        run_ids = [str(r.get("run_id") or "") for r in all_rows if r.get("run_id")]

        # One batched fetch per concern, keyed by the page's run_ids.
        pipelines_by_run = self._fetch_pipelines(run_ids) if run_ids else {}
        agg_by_run = self._fetch_chain_summaries(run_ids) if run_ids else {}
        sample_rows = self._fetch_sample_rows(run_ids) if run_ids else {}
        refit_by_key = self._fetch_refit_predictions(run_ids) if run_ids else {}
        counts_by_run = self._fetch_run_counts(run_ids) if run_ids else {}
        model_classes_by_run = self._fetch_model_classes(run_ids) if run_ids else {}
        cv_info_by_run = self._fetch_cv_info(run_ids) if run_ids else {}

        enriched_runs = [
            self._build_run(
                row,
                pipeline_rows=pipelines_by_run.get(str(row.get("run_id") or ""), []),
                agg_rows=[dict(a) for a in agg_by_run.get(str(row.get("run_id") or ""), [])],
                sample_rows=sample_rows,
                refit_by_key=refit_by_key,
                run_counts=counts_by_run.get(str(row.get("run_id") or ""), {}),
                model_classes=model_classes_by_run.get(str(row.get("run_id") or ""), []),
                cv_info=cv_info_by_run.get(str(row.get("run_id") or "")),
            )
            for row in all_rows
        ]

        return {"runs": enriched_runs, "total": len(enriched_runs)}

    def _build_run(
        self,
        row: dict[str, Any],
        *,
        pipeline_rows: list[dict[str, Any]],
        agg_rows: list[dict[str, Any]],
        sample_rows: dict[tuple[str, str], dict[str, Any]],
        refit_by_key: dict[tuple[str, str], dict[str, dict[str, Any]]],
        run_counts: dict[str, int],
        model_classes: list[dict[str, Any]],
        cv_info: dict[str, Any] | None,
    ) -> dict[str, Any]:
        run_id = row.get("run_id", "")

        created_at = row.get("created_at")
        if isinstance(created_at, datetime):
            created_at = created_at.isoformat()
        completed_at = row.get("completed_at")
        if isinstance(completed_at, datetime):
            completed_at = completed_at.isoformat()

        duration_seconds = None
        if row.get("created_at") and row.get("completed_at"):
            try:
                ca = row["created_at"] if isinstance(row["created_at"], datetime) else datetime.fromisoformat(str(row["created_at"]))
                co = row["completed_at"] if isinstance(row["completed_at"], datetime) else datetime.fromisoformat(str(row["completed_at"]))
                duration_seconds = int((co - ca).total_seconds())
            except Exception:
                pass

        pipeline_count = len(pipeline_rows)
        pipeline_map = {
            prow.get("pipeline_id", ""): dict(prow)
            for prow in pipeline_rows
            if prow.get("pipeline_id")
        }

        if agg_rows:
            _attach_variant_params_inplace(agg_rows, pipeline_map)

        run_has_refit = any(
            agg.get("final_test_score") is not None or agg.get("final_train_score") is not None
            for agg in agg_rows
        )

        datasets_map: dict[str, list] = {}
        for agg in agg_rows:
            ds = agg.get("dataset_name", "unknown")
            if _PARASITIC_DS_RE.search(ds):
                continue
            datasets_map.setdefault(ds, []).append(agg)

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
        robustness_plan = _extract_robustness_launch_plan(run_config_data)

        datasets_meta_map: dict[str, dict] = {}
        for dm in datasets_meta:
            if isinstance(dm, dict):
                datasets_meta_map[dm.get("name", "")] = dm

        for dm in datasets_meta:
            ds_name = dm.get("name", "") if isinstance(dm, dict) else str(dm)
            if ds_name and ds_name not in datasets_map and not _PARASITIC_DS_RE.search(ds_name):
                datasets_map[ds_name] = []

        enriched_datasets = [
            self._build_dataset(
                run_id=run_id,
                ds_name=ds_name,
                agg_list=agg_list,
                ds_meta=datasets_meta_map.get(ds_name, {}),
                run_config_data=run_config_data,
                robustness_plan=robustness_plan,
                sample_row=sample_rows.get((str(run_id), ds_name)),
                refit_predictions_map=refit_by_key.get((str(run_id), ds_name), {}),
            )
            for ds_name, agg_list in datasets_map.items()
        ]

        final_models = int(run_counts.get("final_models", 0) or 0)
        total_folds = int(run_counts.get("total_folds", 0) or 0)
        total_models_trained = int(run_counts.get("total_models_trained", 0) or 0)

        artifact_size = self._artifact_size_lookup(run_id)

        run_cv_config: dict[str, Any] = _infer_run_config_from_pipelines(pipeline_rows)
        run_cv_config["has_refit"] = run_has_refit
        if cv_info:
            inferred_folds = cv_info.get("fold_count", 0) or 0
            if inferred_folds:
                run_cv_config["cv_folds"] = inferred_folds
            run_cv_config["metric"] = _coerce_metric_name(cv_info.get("metric"), default=None)
        run_cv_config.update({k: v for k, v in run_config_data.items() if v is not None})
        run_cv_config["metric"] = (
            _coerce_metric_name(run_cv_config.get("metric"), default=None)
            or next(
                (
                    metric_name
                    for metric_name in (
                        _coerce_metric_name(dataset.get("metric"), default=None)
                        for dataset in enriched_datasets
                    )
                    if metric_name is not None
                ),
                None,
            )
            or "r2"
        )

        run_name = self._derive_run_name(row, pipeline_rows)
        runtime_fields = _aggregate_runtime_fields(run_cv_config, pipeline_rows)

        payload = {
            "run_id": run_id,
            "name": run_name,
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
            "config": sanitize_dict(run_cv_config),
            "model_classes": model_classes,
        }
        if robustness_plan:
            payload["robustness"] = robustness_plan
        payload.update(runtime_fields)
        return sanitize_dict(payload)

    def _build_dataset(
        self,
        *,
        run_id: str,
        ds_name: str,
        agg_list: list[dict[str, Any]],
        ds_meta: dict[str, Any],
        run_config_data: dict[str, Any],
        robustness_plan: dict[str, Any] | None,
        sample_row: dict[str, Any] | None,
        refit_predictions_map: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        from nirs4all.pipeline.run import get_metric_info

        for agg in agg_list:
            _apply_synthetic_refit_fallback_inplace(agg)

        pred_row = sample_row
        task_type = pred_row.get("task_type") if pred_row else None

        if not agg_list:
            return {
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
            }

        metric = next(
            (
                metric_name
                for metric_name in (
                    _coerce_metric_name(agg.get("metric"), default=None)
                    for agg in agg_list
                )
                if metric_name is not None
            ),
            None,
        )
        metric = (
            metric
            or _coerce_metric_name(run_config_data.get("metric"), default=None)
            or _coerce_metric_name(pred_row.get("metric") if pred_row else None, default="r2")
        )

        metric_info = get_metric_info(metric)
        higher_is_better = metric_info.get("higher_is_better", True)

        sorted_agg = sorted(
            [a for a in agg_list if a.get("cv_val_score") is not None],
            key=lambda x: x.get("cv_val_score", 0),
            reverse=higher_is_better,
        )

        best = sorted_agg[0] if sorted_agg else {}
        best_avg_val = sanitize_float(best.get("cv_val_score"))
        best_avg_test = sanitize_float(best.get("cv_test_score"))

        gain = None
        try:
            hist_best = self._historical_best_lookup(ds_name, metric, run_id)
            if hist_best is not None and best_avg_val is not None:
                gain = round(best_avg_val - hist_best, 6)
        except Exception:
            pass

        top_5_entries = sorted_agg[:5]
        top_5_chain_ids = {e.get("chain_id", "") for e in top_5_entries}
        agg_entry_by_chain_id = {
            agg.get("chain_id", ""): agg
            for agg in agg_list
            if agg.get("chain_id")
        }

        refit_only_chain_ids = {cid for cid in refit_predictions_map if cid not in top_5_chain_ids}

        top_5: list[dict[str, Any]] = []
        best_final_score = None
        robustness_fields = _robustness_launch_fields(robustness_plan)
        for entry in top_5_entries:
            chain_id = entry.get("chain_id", "")
            agg_entry = agg_entry_by_chain_id.get(chain_id, entry)
            cv_scores_raw = agg_entry.get("cv_scores")
            scores_detail = json.loads(cv_scores_raw) if isinstance(cv_scores_raw, str) else (cv_scores_raw or {})
            final_ts = sanitize_float(agg_entry.get("final_test_score"))
            final_trs = sanitize_float(agg_entry.get("final_train_score"))
            final_scores_raw = agg_entry.get("final_scores")
            final_scores = json.loads(final_scores_raw) if isinstance(final_scores_raw, str) else (final_scores_raw or {})
            final_agg_ts = sanitize_float(agg_entry.get("final_agg_test_score"))
            final_agg_trs = sanitize_float(agg_entry.get("final_agg_train_score"))
            final_agg_scores_raw = agg_entry.get("final_agg_scores")
            final_agg_scores = (
                json.loads(final_agg_scores_raw)
                if isinstance(final_agg_scores_raw, str)
                else (final_agg_scores_raw or {})
            )

            refit_pred = refit_predictions_map.get(chain_id)
            if final_ts is None and refit_pred:
                final_ts = sanitize_float(refit_pred.get("test_score"))
                final_trs = sanitize_float(refit_pred.get("train_score"))
                rp_scores_raw = refit_pred.get("scores")
                final_scores = json.loads(rp_scores_raw) if isinstance(rp_scores_raw, str) else (rp_scores_raw or {})

            if final_ts is not None:
                if best_final_score is None or higher_is_better and final_ts > best_final_score or not higher_is_better and final_ts < best_final_score:
                    best_final_score = final_ts

            bp_raw = agg_entry.get("best_params") or entry.get("best_params")
            best_params = json.loads(bp_raw) if isinstance(bp_raw, str) else (bp_raw or None)

            top_5.append(sanitize_dict({
                "chain_id": chain_id,
                "model_name": agg_entry.get("model_name", entry.get("model_name", "")),
                "model_class": agg_entry.get("model_class", entry.get("model_class", "")),
                "preprocessings": agg_entry.get("preprocessings", entry.get("preprocessings", "")),
                "avg_val_score": agg_entry.get("cv_val_score", entry.get("cv_val_score")),
                "avg_test_score": agg_entry.get("cv_test_score", entry.get("cv_test_score")),
                "avg_train_score": agg_entry.get("cv_train_score", entry.get("cv_train_score")),
                "fold_count": agg_entry.get("cv_fold_count", entry.get("cv_fold_count", 0)),
                "scores": scores_detail,
                "cv_source_chain_id": agg_entry.get("cv_source_chain_id"),
                "final_test_score": final_ts,
                "final_train_score": final_trs,
                "final_scores": final_scores,
                "best_params": best_params,
                "variant_params": agg_entry.get("variant_params"),
                "final_agg_test_score": final_agg_ts,
                "final_agg_train_score": final_agg_trs,
                "final_agg_scores": final_agg_scores,
                "synthetic_refit": bool(agg_entry.get("synthetic_refit")),
                **robustness_fields,
            }))

        for rchain_id in refit_only_chain_ids:
            rchain = refit_predictions_map[rchain_id]
            agg_entry = agg_entry_by_chain_id.get(rchain_id, {})
            rts = sanitize_float(agg_entry.get("final_test_score") or rchain.get("test_score"))
            rtrs = sanitize_float(agg_entry.get("final_train_score") or rchain.get("train_score"))
            rfinal_scores_raw = agg_entry.get("final_scores") or rchain.get("scores")
            rfinal_scores = json.loads(rfinal_scores_raw) if isinstance(rfinal_scores_raw, str) else (rfinal_scores_raw or {})
            rfinal_agg_ts = sanitize_float(agg_entry.get("final_agg_test_score"))
            rfinal_agg_trs = sanitize_float(agg_entry.get("final_agg_train_score"))
            rfinal_agg_scores_raw = agg_entry.get("final_agg_scores")
            rfinal_agg_scores = (
                json.loads(rfinal_agg_scores_raw)
                if isinstance(rfinal_agg_scores_raw, str)
                else (rfinal_agg_scores_raw or {})
            )
            rbp_raw = agg_entry.get("best_params")
            rbest_params = json.loads(rbp_raw) if isinstance(rbp_raw, str) else (rbp_raw or None)

            if rts is not None:
                if best_final_score is None or higher_is_better and rts > best_final_score or not higher_is_better and rts < best_final_score:
                    best_final_score = rts

            top_5.append(sanitize_dict({
                "chain_id": rchain_id,
                "model_name": agg_entry.get("model_name", rchain.get("model_name", "")),
                "model_class": agg_entry.get("model_class", rchain.get("model_class", "")),
                "preprocessings": agg_entry.get("preprocessings", rchain.get("preprocessings", "")),
                "avg_val_score": None,
                "avg_test_score": None,
                "avg_train_score": None,
                "fold_count": 0,
                "scores": {},
                "cv_source_chain_id": agg_entry.get("cv_source_chain_id"),
                "final_test_score": rts,
                "final_train_score": rtrs,
                "final_scores": rfinal_scores,
                "best_params": rbest_params,
                "variant_params": agg_entry.get("variant_params"),
                "final_agg_test_score": rfinal_agg_ts,
                "final_agg_train_score": rfinal_agg_trs,
                "final_agg_scores": rfinal_agg_scores,
                "is_refit_only": True,
                "synthetic_refit": bool(agg_entry.get("synthetic_refit")),
                **robustness_fields,
            }))

        n_samples = ds_meta.get("n_samples")
        n_features = ds_meta.get("n_features")
        if (n_samples is None or n_features is None) and pred_row is not None:
            n_samples = n_samples or pred_row.get("n_samples")
            n_features = n_features or pred_row.get("n_features")

        return sanitize_dict({
            "dataset_name": ds_name,
            "best_avg_val_score": best_avg_val,
            "best_avg_test_score": best_avg_test,
            "best_final_score": sanitize_float(best_final_score),
            "metric": metric,
            "task_type": task_type,
            "gain_from_previous_best": gain,
            "pipeline_count": len({a.get("pipeline_id") for a in agg_list}),
            "top_5": top_5,
            "n_samples": n_samples,
            "n_features": n_features,
        })

    @staticmethod
    def _derive_run_name(row: dict[str, Any], pipeline_rows: list[dict[str, Any]]) -> str:
        run_name = row.get("name", "")
        if not isinstance(run_name, str):
            run_name = ""
        run_name = run_name.strip()
        if run_name.lower() not in {"", "run"}:
            return run_name

        base_pipeline_names: list[str] = []
        seen_pipeline_names: set[str] = set()
        for pipeline_row in pipeline_rows:
            pipeline_name = str(pipeline_row.get("name") or "").strip()
            if not pipeline_name:
                continue
            if pipeline_name.endswith("_refit"):
                pipeline_name = pipeline_name[:-len("_refit")]
            if pipeline_name in seen_pipeline_names:
                continue
            seen_pipeline_names.add(pipeline_name)
            base_pipeline_names.append(pipeline_name)
        if len(base_pipeline_names) == 1:
            return base_pipeline_names[0]
        if len(base_pipeline_names) > 1:
            return f"{base_pipeline_names[0]} (+{len(base_pipeline_names) - 1})"
        return run_name
