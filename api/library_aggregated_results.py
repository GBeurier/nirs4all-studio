"""Stored result views shared by the native host, with one owner snapshot per request."""
from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .shared.json_safe import sanitize_dict
from .store_adapter import (
    StoreAdapter,
    _extract_model_params_from_expanded_config,
    _mark_refit_only_entries_inplace,
    _parse_json_maybe,
)

_FILTERS = ("run_id", "pipeline_id", "chain_id", "dataset_name", "model_class", "metric")


def _summaries(adapter: StoreAdapter, document: dict[str, Any], *, top: bool = False) -> list[dict[str, Any]]:
    store = adapter._store
    filters = {key: document[key] for key in _FILTERS if key in document}
    if top:
        frame = store.query_top_chains(**filters, n=document["n"], score_column=document["score_column"])
    else:
        frame = store.query_chain_summaries(**filters)
    records = [sanitize_dict(dict(row)) for row in frame.iter_rows(named=True)]
    if not records:
        return []
    _mark_refit_only_entries_inplace(records)
    ids = list(dict.fromkeys(row["chain_id"] for row in records))
    artifacts: dict[str, Any] = {}
    for start in range(0, len(ids), 500):
        batch = ids[start:start + 500]
        placeholders = ",".join("?" for _ in batch)
        for row in store._fetch_pl(f"SELECT chain_id, fold_artifacts FROM chains WHERE chain_id IN ({placeholders})", batch).iter_rows(named=True):
            artifacts[row["chain_id"]] = _parse_json_maybe(row.get("fold_artifacts"))
    for row in records:
        row["fold_artifacts"] = artifacts.get(row["chain_id"])
    adapter._attach_robustness_summary_artifacts_to_chain_rows(records)
    adapter._attach_tuning_summary_artifacts_to_chain_rows(records)
    return records


def _predictions(store: Any, chain_id: str, summary: dict[str, Any] | None, document: dict[str, Any]) -> list[dict[str, Any]]:
    ids = list(dict.fromkeys(filter(None, (chain_id, (summary or {}).get("cv_source_chain_id")))))
    records = []
    seen = set()
    for current in ids:
        frame = store.get_chain_predictions(current, partition=document.get("partition"), fold_id=document.get("fold_id"))
        for source in frame.iter_rows(named=True):
            row = dict(source)
            identifier = row.get("prediction_id")
            if identifier in seen:
                continue
            seen.add(identifier)
            for key in ("scores", "best_params"):
                parsed = _parse_json_maybe(row.get(key))
                if isinstance(parsed, dict):
                    row[key] = parsed
            records.append(sanitize_dict(row))
    return records


def read_aggregated_results(operation: str, document: dict[str, Any]) -> dict[str, Any]:
    """Project real owner data, without migrations, reconciliation, or HTTP imports."""
    workspace = Path(document["workspace_path"])
    generated = datetime.now(UTC).isoformat()
    if not (workspace / "store.sqlite").exists():
        if (workspace / "store.duckdb").exists() or any(workspace.glob("*.meta.parquet")):
            raise ValueError("Legacy prediction storage requires workspace migration")
        if operation in {"results.chains", "results.top"}:
            result: dict[str, Any] = {"predictions": [], "total": 0, "generated_at": generated}
            if operation == "results.top":
                result.update(metric=document["metric"], score_column=document["score_column"])
            return result
        raise ValueError("not_found: Prediction or chain does not exist")
    with StoreAdapter(workspace, read_only=True) as adapter:
        if operation == "results.pipeline_steps":
            from .library_aggregated_steps import _extract_stored_pipeline_steps

            pipeline = adapter._store.get_pipeline(document["pipeline_id"])
            if pipeline is None:
                raise ValueError("not_found: Pipeline does not exist")
            original = pipeline.get("original_template")
            return {"pipeline_id": pipeline["pipeline_id"], "name": pipeline.get("name") or pipeline["pipeline_id"],
                    "pipeline": _extract_stored_pipeline_steps(original if original is not None else pipeline.get("expanded_config")),
                    "reload": {"source": "authoring_template" if original is not None else "expanded_snapshot",
                               "is_editable_template": original is not None, "is_legacy_fallback": original is None}}
        if operation == "results.chain_steps":
            from .library_aggregated_steps import _chain_step_to_canonical

            chain = adapter._store.get_chain(document["chain_id"])
            if chain is None:
                raise ValueError("not_found: Chain does not exist")
            model_index = chain.get("model_step_idx")
            others = {row.get("model_step_idx") for row in adapter._store.get_chains_for_pipeline(chain["pipeline_id"]).iter_rows(named=True)
                      if row.get("model_step_idx") is not None and row.get("model_step_idx") != model_index}
            steps = []
            for step in chain.get("steps") or []:
                reference = step.get("operator_class", "")
                if step.get("step_idx") in others or "_FullTrainFoldSplitter" in reference or " object at 0x" in reference:
                    continue
                canonical = _chain_step_to_canonical(step, is_model=step.get("step_idx") == model_index)
                if canonical is not None:
                    steps.append(canonical)
            name = chain.get("model_name") or chain.get("model_class", "").rsplit(".", 1)[-1]
            if chain.get("preprocessings"):
                name = f"{chain['preprocessings']} → {name}"
            return {"chain_id": chain["chain_id"], "name": name, "pipeline": steps,
                    "reload": {"source": "chain_snapshot", "selection_scope": "preprocessing_chain_plus_selected_model", "is_editable_template": False}}
        if operation in {"results.chains", "results.top"}:
            records = _summaries(adapter, document, top=operation == "results.top")
            result = {"predictions": records, "total": len(records), "generated_at": generated}
            if operation == "results.top":
                result.update(metric=document["metric"], score_column=document["score_column"])
            return result
        if operation in {"results.chain", "results.chain_detail"}:
            summaries = _summaries(adapter, {key: value for key, value in document.items() if key in _FILTERS})
            summary = summaries[0] if summaries else None
            records = _predictions(adapter._store, document["chain_id"], summary, document)
            if operation == "results.chain_detail":
                return {"chain_id": document["chain_id"], "predictions": records, "total": len(records),
                        "partition": document.get("partition"), "fold_id": document.get("fold_id")}
            if not records and summary is None:
                raise ValueError("not_found: Chain does not exist or has no predictions")
            pipeline = adapter._store.get_pipeline(summary["pipeline_id"]) if summary else None
            if summary:
                params = _parse_json_maybe(summary.get("best_params"))
                summary["best_params"] = params if isinstance(params, dict) else None
                model_params = _extract_model_params_from_expanded_config((pipeline or {}).get("expanded_config"), summary.get("model_step_idx"))
                if model_params:
                    summary["variant_params"] = {**(summary.get("variant_params") or {}), **model_params}
            info = sanitize_dict({key: pipeline.get(key) for key in (
                "pipeline_id", "name", "dataset_name", "generator_choices", "status", "metric", "best_val", "best_test",
            )}) if pipeline else None
            return {"chain_id": document["chain_id"], "summary": summary, "predictions": records, "pipeline": info}
        if operation == "results.arrays":
            result = adapter.get_prediction_arrays(document["prediction_id"])
            if result is None:
                raise ValueError("not_found: Prediction arrays do not exist")
            result.setdefault("sample_ids", None)
            result["n_samples"] = next((len(result[key]) for key in ("y_true", "y_pred", "sample_indices", "sample_ids") if result.get(key) is not None), 0)
            return result
    raise ValueError(f"Unknown stored result operation: {operation}")
