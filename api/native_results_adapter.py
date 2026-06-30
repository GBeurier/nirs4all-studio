"""Read-only adapter exposing a nirs4all NATIVE results dir as a WorkspaceStore-shaped surface.

ADDITIVE, READ-ONLY. This adapter lets the ``/api/aggregated-predictions`` endpoints DISPLAY a
nirs4all native results directory (the dag-ml on-disk format written by
``nirs4all.pipeline.dagml.native_results.write_native_results``) when the legacy SQLite/DuckDB
``WorkspaceStore`` is absent. It is a graceful FALLBACK only — when a ``store.sqlite`` / ``store.duckdb``
exists the endpoints keep using :class:`~nirs4all.pipeline.storage.workspace_store.WorkspaceStore`
unchanged (see ``api/aggregated_predictions._get_store``).

CARDINAL RULE (AGENTS.md / BACKEND_RULES): the backend NEVER re-parses or re-derives nirs4all results.
The native format is read ONLY through the library reader
``nirs4all.pipeline.dagml.native_results.read_native_results`` — it returns the verified manifest, the
verbatim dag-ml ScoreSet, a populated :class:`~nirs4all.data.predictions.Predictions` (the library's own
projection of the ScoreSet, carrying per-row ``val_score`` / ``test_score`` / ``train_score`` / ``scores``
/ ``metric`` / ``task_type``), and the rehydrated model artifacts. This adapter only MAPS that returned
data onto the polars / dict shapes the endpoints already consume. It performs no NIRS / ML / scoring
logic of its own.

Scores are taken from the library-projected prediction rows (NOT by re-parsing the raw ScoreSet schema):
that is the canonical projection the library itself produced from the ScoreSet, so reading it here adds
no parsing logic. The raw ScoreSet (in ``manifest``/``read["score_set"]``) is still hash-verified by
``read_native_results`` before we ever see it.

Native results layout consumed (one run dir per run under a results root)::

    <native_root>/<run_id>/manifest.json
    <native_root>/<run_id>/score_set.json
    <native_root>/<run_id>/predictions.parquet
    <native_root>/<run_id>/artifacts/*.joblib

Surrogate identifiers (DOCUMENTED — the native format has no legacy ``chains`` table, so the
chain-centric SQLite identifiers do not exist and are SYNTHESIZED deterministically; never faked data):

* ``chain_id``  = ``"{run_id}::{config_name}"`` — one displayed "chain" per (run, variant). The native
  per-variant identity is ``config_name`` (the projection mirrors a sweep's variant onto ``config_name``;
  see ``native_results._projection_rows``). The projection emits the refit rows under a ``"{base}_refit"``
  config; those are FOLDED back into their base variant so each model is ONE chain carrying both its CV
  summary and its final/refit scores (matching the legacy ``v_chain_summary``, one row per chain). The
  surrogate id therefore uses the BASE config name. Stable across reads of the same dir.
* ``pipeline_id`` = the ``run_id`` — the native format has one run dir = one pipeline's worth of variants;
  there is no separate pipeline grouping on disk.
* ``run_id``      = the manifest ``run_id`` (also the native dir name).
* ``model_class`` = the projected ``model_name`` — the native projection carries only ``model_name`` (no
  dotted class path), so the displayed class falls back to it (its trailing segment if dotted).
* ``prediction_id`` = ``"{run_id}::{config_name}::{partition}::{fold_id}"`` — a STABLE id derived from the
  projected row's identity. The library reader assigns a fresh random ``id`` on every read, so it would
  not survive across separate requests (chain-detail vs. arrays build separate adapter instances); this
  deterministic key is unique per row and identical across reads.

Fields the native format may not supply (reported as gaps; rendered as ``None`` / empty, never fabricated):
``best_params`` / expanded operator params (no expanded pipeline config persisted), legacy per-fold artifact
maps (a synthetic ``fold_final`` is exposed only when exactly one native REFIT model artifact is loadable for
the chain), ``cv_source_chain_id``, the repetition-aggregated ``final_agg_*`` scores, and the
relation-replay columns. ``branch_path`` / ``source_index`` are preserved only when the native projection
or manifest carries them. ``variant_params`` is limited to additive native ``result_metadata`` provenance.
CV ``cv_train_score`` is present only when the projection carried a train fold (it usually does not).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import polars as pl

# The projection's refit-config suffix + the aggregate (non-real) CV fold ids it emits. The refit rows
# arrive under ``"{base}_refit"`` and are folded into their base variant; ``avg`` / ``w_avg`` are
# cross-fold AGGREGATE rows (the OOF summary), not real folds — used for the CV summary score but
# excluded from the real-fold count.
_REFIT_CONFIG_SUFFIX = "_refit"
_AGGREGATE_FOLD_IDS = frozenset({"avg", "w_avg"})

# The legacy ``v_chain_summary`` VIEW columns plus native-only additive fields, WITH their polars dtypes,
# in order. The chain-summary endpoints build ``ChainSummary`` rows from these keys; we emit a typed
# schema so endpoint code consumes native rows like SQLite rows while still surfacing native score maps
# and provenance. Dtypes mirror the ``chains`` table column types where fields are legacy-shaped
# (nirs4all/pipeline/storage/store_schema.py): TEXT→Utf8, REAL→Float64, INTEGER→Int64; ``run_id`` /
# ``pipeline_status`` come from the joined ``pipelines`` row (TEXT). Additive native payloads use
# ``pl.Object`` so the API can return objects, not JSON strings.
_CHAIN_SUMMARY_SCHEMA: dict[str, pl.DataType] = {
    "chain_id": pl.Utf8,
    "pipeline_id": pl.Utf8,
    "model_class": pl.Utf8,
    "model_step_idx": pl.Int64,
    "model_name": pl.Utf8,
    "preprocessings": pl.Utf8,
    "branch_path": pl.Utf8,
    "source_index": pl.Int64,
    "metric": pl.Utf8,
    "task_type": pl.Utf8,
    "best_params": pl.Utf8,
    "dataset_name": pl.Utf8,
    "cv_val_score": pl.Float64,
    "cv_test_score": pl.Float64,
    "cv_train_score": pl.Float64,
    "cv_fold_count": pl.Int64,
    "cv_scores": pl.Object,
    "score_maps": pl.Object,
    "final_test_score": pl.Float64,
    "final_train_score": pl.Float64,
    "final_scores": pl.Object,
    "final_agg_test_score": pl.Float64,
    "final_agg_train_score": pl.Float64,
    "final_agg_scores": pl.Object,
    "variant_params": pl.Object,
    "relation_replay_manifest": pl.Utf8,
    "relation_replay_version": pl.Int64,
    "relation_replay_fingerprint": pl.Utf8,
    "run_id": pl.Utf8,
    "pipeline_status": pl.Utf8,
}
_CHAIN_SUMMARY_COLUMNS: tuple[str, ...] = tuple(_CHAIN_SUMMARY_SCHEMA)

# Legacy ``score_column`` validation + alias mapping, matching
# nirs4all.pipeline.storage.store_queries.build_top_chains_query so query_top_chains accepts the SAME
# score_column values the endpoint passes (incl. deprecated ``avg_*`` / ``min_*`` / ``max_*`` aliases).
_VALID_SCORE_COLUMNS: frozenset[str] = frozenset({
    "cv_val_score", "cv_test_score", "cv_train_score",
    "final_test_score", "final_train_score",
    "min_val_score", "max_val_score", "avg_val_score",
    "min_test_score", "max_test_score", "avg_test_score",
    "min_train_score", "max_train_score", "avg_train_score",
})
_SCORE_COLUMN_ALIASES: dict[str, str] = {
    "avg_val_score": "cv_val_score",
    "avg_test_score": "cv_test_score",
    "avg_train_score": "cv_train_score",
    "min_val_score": "cv_val_score",
    "max_val_score": "cv_val_score",
    "min_test_score": "cv_test_score",
    "max_test_score": "cv_test_score",
    "min_train_score": "cv_train_score",
    "max_train_score": "cv_train_score",
}


def _read_native_results(run_dir: Path) -> dict[str, Any]:
    """Read one native run dir via the library reader (the ONLY decoder of the native format)."""
    from nirs4all.pipeline.dagml.native_results import read_native_results

    return read_native_results(run_dir)


def _finite(value: Any) -> float | None:
    """Coerce a score to a finite float, mapping ``None`` / NaN / Inf to ``None``."""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _json_safe(value: Any) -> Any:
    """Best-effort JSON-safe copy for native projection payloads."""
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return _finite(value)

    item = getattr(value, "item", None)
    if callable(item):
        try:
            return _json_safe(item())
        except Exception:
            pass

    tolist = getattr(value, "tolist", None)
    if callable(tolist):
        try:
            return _json_safe(tolist())
        except Exception:
            pass

    try:
        json.dumps(value, allow_nan=False)
    except Exception:
        return str(value)
    return value


def _first_present(mapping: dict[str, Any], keys: tuple[str, ...]) -> Any:
    """Return the first explicitly present non-null value for ``keys`` from ``mapping``."""
    for key in keys:
        if key in mapping and mapping[key] is not None:
            return mapping[key]
    return None


def _branch_path_for_summary(value: Any) -> str | None:
    """JSON-safe branch path text for the legacy TEXT summary column."""
    if value is None:
        return None
    safe_value = _json_safe(value)
    if isinstance(safe_value, str):
        return safe_value
    return json.dumps(safe_value, allow_nan=False, sort_keys=True)


def _source_index_for_summary(value: Any) -> int | None:
    """Coerce native source aliases to the legacy integer source_index field."""
    safe_value = _json_safe(value)
    if isinstance(safe_value, bool) or safe_value is None:
        return None
    if isinstance(safe_value, int):
        return safe_value
    if isinstance(safe_value, float):
        if math.isfinite(safe_value) and safe_value.is_integer():
            return int(safe_value)
        return None
    if isinstance(safe_value, str):
        stripped = safe_value.strip()
        if not stripped:
            return None
        try:
            return int(stripped)
        except ValueError:
            return None
    return None


def _first_coerced_index(*values: Any) -> int | None:
    """Return the first non-null integer-like index from native metadata candidates."""
    for value in values:
        index = _source_index_for_summary(value)
        if index is not None:
            return index
    return None


def _first_text_value(*values: Any) -> str | None:
    """Return the first non-empty text value from native metadata candidates."""
    for value in values:
        if value is None:
            continue
        safe_value = _json_safe(value)
        if isinstance(safe_value, str):
            text = safe_value.strip()
            if text:
                return text
    return None


def _native_prediction_context(row: dict[str, Any]) -> dict[str, Any]:
    """Additive source/target metadata for native prediction rows and arrays."""
    result_metadata = row.get("result_metadata")
    result_metadata = _json_safe(result_metadata) if isinstance(result_metadata, dict) else None
    metadata_dict = result_metadata if isinstance(result_metadata, dict) else {}
    dimensions = metadata_dict.get("dimensions")
    dimensions = dimensions if isinstance(dimensions, dict) else {}

    source_index = _first_coerced_index(
        _first_present(row, ("source_index", "source_idx", "source")),
        _first_present(metadata_dict, ("source_index", "source_idx", "source")),
        _first_present(dimensions, ("source_index", "source_idx", "source")),
    )
    target_index = _first_coerced_index(
        _first_present(row, ("target_index", "target_idx", "target")),
        _first_present(metadata_dict, ("target_index", "target_idx", "target")),
        _first_present(dimensions, ("target_index", "target_idx", "target")),
    )

    return {
        "branch_path": _branch_path_for_summary(_first_present(row, ("branch_path",))),
        "source_index": source_index,
        "source_name": _first_text_value(
            _first_present(row, ("source_name", "source_label")),
            _first_present(metadata_dict, ("source_name", "source_label")),
            _first_present(dimensions, ("source_name", "source_label")),
        ),
        "target_index": target_index,
        "target_name": _first_text_value(
            _first_present(row, ("target_name", "target_label")),
            _first_present(metadata_dict, ("target_name", "target_label")),
            _first_present(dimensions, ("target_name", "target_label")),
        ),
        "result_metadata": result_metadata,
    }


def _native_identity_candidates(manifest: dict[str, Any], base_config: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Potential identity metadata locations, ordered from most specific to broadest."""
    candidates = list(rows)

    for key in ("variants", "variant_metadata", "configs", "config_metadata"):
        value = manifest.get(key)
        if isinstance(value, dict):
            entry = value.get(base_config) or value.get(f"{base_config}{_REFIT_CONFIG_SUFFIX}")
            if isinstance(entry, dict):
                candidates.append(entry)
            continue
        if isinstance(value, list):
            for item in value:
                if not isinstance(item, dict):
                    continue
                name = item.get("config_name") or item.get("variant_id") or item.get("name") or item.get("id")
                if _native_base_config(str(name or "")) == base_config:
                    candidates.append(item)

    candidates.append(manifest)
    return candidates


def _native_summary_identity(manifest: dict[str, Any], base_config: str, rows: list[dict[str, Any]]) -> tuple[str | None, int | None]:
    """Extract legacy identity fields when native rows/manifest carry them."""
    branch_path: str | None = None
    source_index: int | None = None

    for candidate in _native_identity_candidates(manifest, base_config, rows):
        if branch_path is None:
            branch_path = _branch_path_for_summary(_first_present(candidate, ("branch_path",)))
        if source_index is None:
            source_index = _source_index_for_summary(_first_present(candidate, ("source_index", "source_idx", "source")))
        if branch_path is not None and source_index is not None:
            break

    return branch_path, source_index


def _partition_key(value: Any) -> str | None:
    """Normalize native/legacy partition labels to the score-map keys the UI consumes."""
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    aliases = {
        "validation": "val",
        "valid": "val",
        "val": "val",
        "test": "test",
        "train": "train",
        "training": "train",
    }
    return aliases.get(normalized, normalized)


def _flat_metric_scores(value: Any) -> dict[str, float]:
    """Return ``{metric: score}`` for a flat score payload."""
    if not isinstance(value, dict):
        return {}
    scores: dict[str, float] = {}
    for key, item in value.items():
        if isinstance(item, dict):
            continue
        score = _finite(item)
        if score is not None:
            scores[str(key)] = score
    return scores


def _merge_score_maps(*maps: dict[str, dict[str, float]] | None) -> dict[str, dict[str, float]] | None:
    """Merge partitioned score maps, preserving any extra metrics emitted by the native projection."""
    merged: dict[str, dict[str, float]] = {}
    for score_map in maps:
        if not score_map:
            continue
        for partition, scores in score_map.items():
            if not scores:
                continue
            merged.setdefault(str(partition), {}).update(scores)
    return merged or None


def _merge_native_score_payloads(*payloads: dict[str, Any] | None) -> dict[str, Any] | None:
    """Merge JSON-safe native score payloads without flattening target/source dimensions."""
    merged: dict[str, Any] = {}
    for payload in payloads:
        if not isinstance(payload, dict):
            continue
        for key, value in payload.items():
            safe_value = _json_safe(value)
            existing = merged.get(str(key))
            if isinstance(existing, dict) and isinstance(safe_value, dict):
                merged[str(key)] = _merge_native_score_payloads(existing, safe_value) or {}
            else:
                merged[str(key)] = safe_value
    return merged or None


def _row_score_map(row: dict[str, Any]) -> dict[str, dict[str, float]] | None:
    """Map one native projection row's scores onto legacy ``{partition: {metric: value}}`` shape."""
    score_map: dict[str, dict[str, float]] = {}

    raw_scores = row.get("scores")
    if isinstance(raw_scores, dict):
        if any(isinstance(value, dict) for value in raw_scores.values()):
            for key, value in raw_scores.items():
                partition = _partition_key(str(key))
                scores = _flat_metric_scores(value)
                if partition and scores:
                    score_map.setdefault(partition, {}).update(scores)
        else:
            partition = _partition_key(row.get("partition"))
            scores = _flat_metric_scores(raw_scores)
            if partition and scores:
                score_map.setdefault(partition, {}).update(scores)

    metric = row.get("metric")
    metric_key = str(metric) if isinstance(metric, str) and metric else None
    if metric_key:
        for partition, field in (
            ("val", "val_score"),
            ("test", "test_score"),
            ("train", "train_score"),
        ):
            score = _finite(row.get(field))
            if score is not None:
                score_map.setdefault(partition, {})[metric_key] = score

    return score_map or None


def _native_row_score_payload(row: dict[str, Any]) -> dict[str, Any] | None:
    """Return the raw native score payload plus scalar partition fallbacks."""
    payload = row.get("scores")
    score_payload = _json_safe(payload) if isinstance(payload, dict) else {}
    partition_scores = _row_score_map(row)
    if partition_scores:
        score_payload = _merge_native_score_payloads(score_payload, partition_scores) or {}
    return score_payload or None


def _native_result_metadata(run_id: str, base_config: str, read: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Small provenance payload exposed as ``variant_params.result_metadata`` for native summaries."""
    metadata: dict[str, Any] = {
        "source": "native_results",
        "run_id": run_id,
        "chain_id": _native_chain_id(run_id, base_config),
        "config_name": base_config,
    }
    manifest = read.get("manifest") if isinstance(read.get("manifest"), dict) else {}
    selected_variant = manifest.get("selected_variant")
    if isinstance(selected_variant, str) and selected_variant:
        metadata["selected_variant"] = selected_variant

    explicit = manifest.get("result_metadata")
    if isinstance(explicit, dict):
        metadata.update(_json_safe(explicit))

    for row in rows:
        row_metadata = row.get("result_metadata")
        if isinstance(row_metadata, dict):
            metadata.update(_json_safe(row_metadata))

    return metadata


def _variant_params_for_summary(
    run_id: str,
    base_config: str,
    read: dict[str, Any],
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Additive native variant params; currently only provenance/result metadata is available."""
    params: dict[str, Any] = {}
    for row in rows:
        row_params = row.get("variant_params")
        if isinstance(row_params, dict):
            params.update(_json_safe(row_params))

    result_metadata = _native_result_metadata(run_id, base_config, read, rows)
    existing_metadata = params.get("result_metadata")
    if isinstance(existing_metadata, dict):
        result_metadata.update(existing_metadata)
    params["result_metadata"] = result_metadata
    return params


def _model_class_from_name(model_name: str) -> str:
    """Display class for a variant: the model name (its trailing segment if dotted)."""
    if not model_name:
        return ""
    return model_name.rsplit(".", 1)[-1]


def _infer_metric_ascending(metric: str | None) -> bool:
    """Sort direction for ``metric`` — DELEGATES to the library's canonical metric-direction registry.

    nirs4all centralizes metric direction in ``nirs4all.core.metrics.infer_ascending`` (lower-is-better
    → ascending). We call it rather than re-deriving direction here (BACKEND_RULES: no reimplementation
    of NIRS/ML logic), so ranking matches legacy WorkspaceStore exactly — including metrics a token
    heuristic gets wrong (e.g. ``bias``) and unknown metrics. An absent metric defaults to ascending,
    as the legacy ``query_top_chains`` does.
    """
    if not metric:
        return True
    from nirs4all.core.metrics import infer_ascending

    return infer_ascending(metric)


def _native_base_config(config_name: str) -> str:
    """The base variant name (the projection's ``"{base}_refit"`` rows fold into their base)."""
    if config_name.endswith(_REFIT_CONFIG_SUFFIX):
        return config_name[: -len(_REFIT_CONFIG_SUFFIX)]
    return config_name


def _native_chain_id(run_id: str, base_config: str) -> str:
    """Deterministic surrogate chain id for a (run, base variant) — DOCUMENTED in the module docstring."""
    return f"{run_id}::{base_config}"


def _native_prediction_id(run_id: str, row: dict[str, Any]) -> str:
    """STABLE surrogate prediction id from the row's identity (DOCUMENTED in the module docstring).

    The library reader assigns a FRESH random ``id`` on every read, so it is NOT stable across
    adapter instances / requests (the chain-detail call and the arrays call build separate adapters).
    We instead derive a deterministic id from ``(run_id, config_name, partition, fold_id)`` — unique
    per projected row and identical across reads — so an id handed out by one request resolves on the
    next.
    """
    return "::".join(
        (
            run_id,
            str(row.get("config_name") or ""),
            str(row.get("partition") or ""),
            str(row.get("fold_id") or ""),
        )
    )


def _native_loadable_artifact_id(run_id: str, base_config: str, source_artifact_id: str) -> str:
    """Stable synthetic artifact id emitted by ``get_chain(...).fold_artifacts`` for native refit models."""
    return f"{run_id}::{base_config}::artifact::{source_artifact_id}"


class _NativeArtifactModel:
    """Predict-capable wrapper over a native ``{estimator, y_transform}`` artifact payload."""

    def __init__(self, estimator: Any, y_transform: Any) -> None:
        self.estimator = estimator
        self.y_transform = y_transform

    def predict(self, X: Any) -> Any:
        """Predict in the original target space, applying y inverse transformation when present."""
        import numpy as np

        pred = np.asarray(self.estimator.predict(X), dtype=float)
        if self.y_transform is None:
            return pred
        return np.asarray(self.y_transform.inverse_transform(pred.reshape(len(pred), -1)), dtype=float)


def _native_model_from_artifact(artifact: dict[str, Any]) -> Any:
    """Return a predict-capable model object from a rehydrated native artifact."""
    estimator = artifact.get("estimator")
    if estimator is None:
        raise ValueError(f"Native results model artifact {artifact.get('artifact_id')!r} has no estimator payload.")
    y_transform = artifact.get("y_transform")
    try:
        from nirs4all.api.result import _DagmlExportedModel
    except Exception:
        return _NativeArtifactModel(estimator, y_transform)
    return _DagmlExportedModel(estimator, y_transform)


class NativeResultsAdapter:
    """WorkspaceStore-shaped, read-only view over a nirs4all native results root.

    Exposes the SUBSET of the ``WorkspaceStore`` query surface the
    ``/api/aggregated-predictions`` endpoints call, backed by
    ``read_native_results`` over each ``<run_id>`` directory under ``results_root``.

    The adapter is read-only and cheap to construct; each run dir is read (and the
    library reader validates its ScoreSet hash + artifact fingerprints) lazily on first
    query and cached for the adapter's lifetime. Call :meth:`close` when done.

    Args:
        results_root: A directory containing one or more ``<run_id>/`` native run dirs
            (each with ``manifest.json`` + ``score_set.json`` + ``predictions.parquet``).
    """

    def __init__(self, results_root: Path) -> None:
        self._results_root = Path(results_root)
        self._cache: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def __enter__(self) -> NativeResultsAdapter:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        """Release the cached reads (no open DB handle; matches WorkspaceStore.close())."""
        self._cache.clear()

    # ------------------------------------------------------------------
    # Run discovery + library-reader-backed loading
    # ------------------------------------------------------------------

    def _run_dirs(self) -> list[Path]:
        """The native run directories under the root (each holding a manifest.json), sorted by name."""
        if not self._results_root.is_dir():
            return []
        return sorted(
            child
            for child in self._results_root.iterdir()
            if child.is_dir() and (child / "manifest.json").is_file()
        )

    def _load_run(self, run_dir: Path) -> dict[str, Any]:
        """Read one native run dir through the library reader (cached, hash-validated)."""
        key = run_dir.name
        cached = self._cache.get(key)
        if cached is None:
            cached = _read_native_results(run_dir)
            self._cache[key] = cached
        return cached

    def _iter_runs(self) -> list[tuple[str, dict[str, Any]]]:
        """``(run_id, read_native_results-payload)`` for every native run dir under the root."""
        runs: list[tuple[str, dict[str, Any]]] = []
        for run_dir in self._run_dirs():
            read = self._load_run(run_dir)
            run_id = str(read["manifest"].get("run_id") or run_dir.name)
            runs.append((run_id, read))
        return runs

    # ------------------------------------------------------------------
    # Variant -> chain-summary mapping (library-projected scores only)
    # ------------------------------------------------------------------

    @staticmethod
    def _chain_id(run_id: str, base_config: str) -> str:
        """Deterministic surrogate chain id for a (run, base variant) — DOCUMENTED in the module docstring."""
        return _native_chain_id(run_id, base_config)

    @staticmethod
    def _base_config(config_name: str) -> str:
        """The base variant name (the projection's ``"{base}_refit"`` rows fold into their base)."""
        return _native_base_config(config_name)

    @staticmethod
    def _prediction_id(run_id: str, row: dict[str, Any]) -> str:
        """STABLE surrogate prediction id from the row's identity (DOCUMENTED in the module docstring).

        The library reader assigns a FRESH random ``id`` on every read, so it is NOT stable across
        adapter instances / requests (the chain-detail call and the arrays call build separate adapters).
        We instead derive a deterministic id from ``(run_id, config_name, partition, fold_id)`` — unique
        per projected row and identical across reads — so an id handed out by one request resolves on the
        next.
        """
        return _native_prediction_id(run_id, row)

    def _variant_summaries(self, run_id: str, read: dict[str, Any]) -> list[dict[str, Any]]:
        """One chain-summary dict per variant in a native run, from the library-projected rows.

        Rows are grouped by BASE variant (the ``"{base}_refit"`` config folds into ``base``). The
        cross-fold AGGREGATE CV row (``fold_id == "avg"``) supplies ``cv_val_score`` / ``cv_test_score``
        / ``cv_train_score`` (the library's own OOF summary; no re-averaging here); the real-fold count
        excludes the ``avg`` / ``w_avg`` aggregate rows. The refit/final rows
        (``refit_context`` set / ``fold_id == "final"``) supply ``final_test_score`` /
        ``final_train_score``. All scores come straight from the row scalars the library projected from
        the ScoreSet.
        """
        manifest = read["manifest"]
        predictions = read["predictions"]
        rows = predictions.filter_predictions(load_arrays=False)

        manifest_metric = manifest.get("metric")
        metric_default = manifest_metric if isinstance(manifest_metric, str) else None
        manifest_task = manifest.get("task_type")
        task_default = manifest_task if isinstance(manifest_task, str) else None

        # Group rows by BASE variant; the projection mirrors a sweep's variant onto config_name and emits
        # the refit rows under "{base}_refit" (folded back here).
        variants: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            base = _native_base_config(str(row.get("config_name") or ""))
            variants.setdefault(base, []).append(row)

        summaries: list[dict[str, Any]] = []
        for base_config, variant_rows in variants.items():
            cv_rows = [r for r in variant_rows if not self._is_refit_row(r)]
            refit_rows = [r for r in variant_rows if self._is_refit_row(r)]

            # CV summary: prefer the cross-fold AGGREGATE row (fold_id == "avg") the library emits as the
            # OOF summary; that is exactly the ScoreSet's (variant, "validation", "avg") report.
            cv_summary = self._aggregate_cv_row(cv_rows)
            cv_val = _finite(cv_summary.get("val_score")) if cv_summary else None
            cv_test = _finite(cv_summary.get("test_score")) if cv_summary else None
            cv_train = _finite(cv_summary.get("train_score")) if cv_summary else None
            cv_scores = _row_score_map(cv_summary) if cv_summary else None
            cv_score_payload = _native_row_score_payload(cv_summary) if cv_summary else None
            cv_fold_count = len({
                str(r.get("fold_id") or "")
                for r in cv_rows
                if r.get("fold_id") not in (None, "") and str(r.get("fold_id")) not in _AGGREGATE_FOLD_IDS
            })

            final_test = next((_finite(r.get("test_score")) for r in refit_rows if _finite(r.get("test_score")) is not None), None)
            final_train = next((_finite(r.get("train_score")) for r in refit_rows if _finite(r.get("train_score")) is not None), None)
            final_scores = _merge_score_maps(*(_row_score_map(r) for r in refit_rows))
            final_score_payload = _merge_native_score_payloads(*(_native_row_score_payload(r) for r in refit_rows))
            score_maps = {
                key: value
                for key, value in {
                    "cv": cv_score_payload,
                    "final": final_score_payload,
                }.items()
                if value
            } or None

            source_rows = variant_rows
            model_name = next((str(r.get("model_name") or "") for r in source_rows if r.get("model_name")), "")
            dataset_name = next((str(r.get("dataset_name") or "") for r in source_rows if r.get("dataset_name")), "")
            metric = next((str(r.get("metric") or "") for r in source_rows if r.get("metric")), "") or (metric_default or "")
            task_type = next((str(r.get("task_type") or "") for r in source_rows if r.get("task_type")), "") or (task_default or "")
            variant_params = _variant_params_for_summary(run_id, base_config, read, variant_rows)
            branch_path, source_index = _native_summary_identity(manifest, base_config, variant_rows)

            summaries.append(
                {
                    "chain_id": _native_chain_id(run_id, base_config),
                    "pipeline_id": run_id,
                    "model_class": _model_class_from_name(model_name),
                    "model_step_idx": 0,
                    "model_name": model_name,
                    "preprocessings": base_config,
                    "branch_path": branch_path,
                    "source_index": source_index,
                    "metric": metric or None,
                    "task_type": task_type or None,
                    "best_params": None,
                    "dataset_name": dataset_name or None,
                    "cv_val_score": cv_val,
                    "cv_test_score": cv_test,
                    "cv_train_score": cv_train,
                    "cv_fold_count": cv_fold_count,
                    "cv_scores": cv_scores,
                    "score_maps": score_maps,
                    "final_test_score": final_test,
                    "final_train_score": final_train,
                    "final_scores": final_scores,
                    "final_agg_test_score": None,
                    "final_agg_train_score": None,
                    "final_agg_scores": None,
                    "variant_params": variant_params,
                    "relation_replay_manifest": None,
                    "relation_replay_version": None,
                    "relation_replay_fingerprint": None,
                    "run_id": run_id,
                    "pipeline_status": "completed",
                }
            )
        return summaries

    @staticmethod
    def _is_refit_row(row: dict[str, Any]) -> bool:
        """A refit/final row: the held-out refit prediction (vs. a CV fold row)."""
        if row.get("refit_context"):
            return True
        return str(row.get("fold_id") or "") == "final"

    @staticmethod
    def _aggregate_cv_row(cv_rows: list[dict[str, Any]]) -> dict[str, Any] | None:
        """The cross-fold OOF summary row (``fold_id == "avg"``), else any CV row (else ``None``).

        The library projects an ``avg`` aggregate row carrying the variant's OOF summary scores — the
        same numbers as the ScoreSet's ``(variant, "validation", "avg")`` report — so we read that
        directly rather than re-averaging folds (re-averaging would be re-doing library scoring).
        """
        if not cv_rows:
            return None
        for row in cv_rows:
            if str(row.get("fold_id") or "") == "avg":
                return row
        return cv_rows[0]

    def _all_summaries(self) -> list[dict[str, Any]]:
        """Every variant's chain summary across every native run under the root."""
        summaries: list[dict[str, Any]] = []
        for run_id, read in self._iter_runs():
            summaries.extend(self._variant_summaries(run_id, read))
        return summaries

    @staticmethod
    def _matches(value: Any, wanted: str | None) -> bool:
        """Single-value AND filter (the endpoints only pass single string filters)."""
        if wanted is None:
            return True
        return str(value or "") == wanted

    def _summaries_df(self, rows: list[dict[str, Any]]) -> pl.DataFrame:
        """Build the chain-summary-shaped DataFrame (explicit typed schema) from summary dicts.

        The empty frame carries the typed v_chain_summary-compatible schema plus native additive fields
        (not all-Utf8). Populated rows are built with the explicit schema too, so a sparse column (e.g. a
        later row's first non-null score) cannot flip the dtype or fail polars' first-rows schema
        inference — matching the legacy ``_fetch_pl``, which infers across all rows.
        """
        ordered = [{col: row.get(col) for col in _CHAIN_SUMMARY_COLUMNS} for row in rows]
        return pl.DataFrame(ordered, schema=_CHAIN_SUMMARY_SCHEMA)

    # ------------------------------------------------------------------
    # Public WorkspaceStore-shaped query surface (the endpoint subset)
    # ------------------------------------------------------------------

    def query_chain_summaries(
        self,
        run_id: str | None = None,
        pipeline_id: str | None = None,
        chain_id: str | None = None,
        dataset_name: str | None = None,
        model_class: str | None = None,
        metric: str | None = None,
        task_type: str | None = None,
    ) -> pl.DataFrame:
        """Return chain summaries (one row per native variant), filtered, as a polars DataFrame.

        Same signature + return shape as
        :meth:`nirs4all.pipeline.storage.workspace_store.WorkspaceStore.query_chain_summaries`.
        """
        rows = [
            row
            for row in self._all_summaries()
            if self._matches(row.get("run_id"), run_id)
            and self._matches(row.get("pipeline_id"), pipeline_id)
            and self._matches(row.get("chain_id"), chain_id)
            and self._matches(row.get("dataset_name"), dataset_name)
            and self._matches(row.get("model_class"), model_class)
            and self._matches(row.get("metric"), metric)
            and self._matches(row.get("task_type"), task_type)
        ]
        return self._summaries_df(rows)

    def count_chain_summaries(self, **filters: Any) -> int:
        """Count chain summaries using the same filters as ``query_chain_summaries``."""
        return len(self.query_chain_summaries(**filters))

    def query_top_chains(
        self,
        metric: str | None = None,
        n: int = 10,
        offset: int = 0,
        score_column: str = "cv_val_score",
        ascending: bool | None = None,
        **filters: Any,
    ) -> pl.DataFrame:
        """Return the top-``n`` chain summaries ranked by ``score_column``.

        Same signature + ranking semantics as :meth:`WorkspaceStore.query_top_chains`: the metric
        direction comes from the library registry (:func:`_infer_metric_ascending`), and ``score_column``
        is validated + alias-resolved exactly like the legacy ``build_top_chains_query`` (so legacy
        ``avg_*`` / ``min_*`` / ``max_*`` aliases map onto the native ``cv_*`` columns and rank correctly
        instead of returning no rows).
        """
        if score_column not in _VALID_SCORE_COLUMNS:
            raise ValueError(f"Invalid score column: {score_column!r}")
        resolved_column = _SCORE_COLUMN_ALIASES.get(score_column, score_column)

        if ascending is None:
            ascending = _infer_metric_ascending(metric)

        rows = [
            row
            for row in self._all_summaries()
            if self._matches(row.get("run_id"), filters.get("run_id"))
            and self._matches(row.get("pipeline_id"), filters.get("pipeline_id"))
            and self._matches(row.get("dataset_name"), filters.get("dataset_name"))
            and self._matches(row.get("model_class"), filters.get("model_class"))
            and (metric is None or self._matches(row.get("metric"), metric))
        ]
        ranked = [row for row in rows if _finite(row.get(resolved_column)) is not None]
        ranked.sort(key=lambda row: _finite(row.get(resolved_column)), reverse=not ascending)
        page = ranked[offset : offset + n]
        return self._summaries_df(page)

    def get_chain_predictions(
        self,
        chain_id: str,
        partition: str | None = None,
        fold_id: str | None = None,
    ) -> pl.DataFrame:
        """Per-prediction drill-down rows for one surrogate chain (predictions-table-shaped).

        Resolves the ``"{run_id}::{config_name}"`` surrogate back to its native run + variant and
        returns the projected rows for that variant, mapped to the predictions-table columns the
        ``PartitionPrediction`` model consumes (``prediction_id`` from the row id).
        """
        resolved = self._resolve_chain(chain_id)
        if resolved is None:
            return pl.DataFrame()
        run_id, base_config, read = resolved
        rows = read["predictions"].filter_predictions(load_arrays=False)
        records: list[dict[str, Any]] = []
        for row in rows:
            if _native_base_config(str(row.get("config_name") or "")) != base_config:
                continue
            if partition is not None and str(row.get("partition") or "") != partition:
                continue
            if fold_id is not None and str(row.get("fold_id") or "") != fold_id:
                continue
            model_name = str(row.get("model_name") or "")
            records.append(
                {
                    "prediction_id": _native_prediction_id(run_id, row),
                    "pipeline_id": run_id,
                    "chain_id": chain_id,
                    "dataset_name": str(row.get("dataset_name") or ""),
                    "model_name": model_name,
                    "model_class": _model_class_from_name(model_name),
                    "fold_id": str(row.get("fold_id") or ""),
                    "partition": str(row.get("partition") or ""),
                    "val_score": _finite(row.get("val_score")),
                    "test_score": _finite(row.get("test_score")),
                    "train_score": _finite(row.get("train_score")),
                    "metric": str(row.get("metric") or ""),
                    "task_type": str(row.get("task_type") or ""),
                    "n_samples": None,
                    "n_features": None,
                    "preprocessings": base_config,
                    "scores": _json_safe(row.get("scores")) if isinstance(row.get("scores"), dict) else None,
                    "best_params": _json_safe(row.get("best_params")) if isinstance(row.get("best_params"), dict) else None,
                    **_native_prediction_context(row),
                }
            )
        if not records:
            return pl.DataFrame()
        return pl.DataFrame(records)

    def _resolve_prediction_row(self, prediction_id: str) -> dict[str, Any] | None:
        """Find the projected row whose STABLE surrogate id matches (across all native runs)."""
        for run_id, read in self._iter_runs():
            for row in read["predictions"].filter_predictions(load_arrays=True):
                if _native_prediction_id(run_id, row) == prediction_id:
                    return row
        return None

    def get_prediction_arrays(self, prediction_id: str) -> dict[str, Any] | None:
        """Arrays (y_true / y_pred / y_proba / sample_indices / weights) for one projected prediction.

        Same return shape as :meth:`WorkspaceStore.get_prediction_arrays`: a dict keyed by
        ``prediction_id`` + the array fields, or ``None`` when the id is unknown. The id is the STABLE
        surrogate (:meth:`_prediction_id`), so it resolves even though it came from an earlier request.
        """
        row = self._resolve_prediction_row(prediction_id)
        if row is None:
            return None
        return {
            "prediction_id": prediction_id,
            "dataset_name": row.get("dataset_name"),
            "y_true": row.get("y_true"),
            "y_pred": row.get("y_pred"),
            "y_proba": row.get("y_proba"),
            "weights": row.get("weights"),
            "sample_indices": row.get("sample_indices"),
            "sample_metadata": row.get("metadata"),
            **_native_prediction_context(row),
        }

    def get_prediction(self, prediction_id: str, load_arrays: bool = True) -> dict[str, Any] | None:
        """One projected prediction row by STABLE surrogate id (WorkspaceStore.get_prediction shape)."""
        row = self._resolve_prediction_row(prediction_id)
        if row is None:
            return None
        result = dict(row)
        result["prediction_id"] = prediction_id
        if not load_arrays:
            for key in ("y_true", "y_pred", "y_proba"):
                result.pop(key, None)
        return result

    def get_chain(self, chain_id: str) -> dict[str, Any] | None:
        """Minimal chain descriptor for a surrogate chain id (or ``None`` if unknown).

        The native format has no chains table; this returns just enough for the
        ``get_chain_detail`` summary lookup (which then queries ``query_chain_summaries``).
        """
        resolved = self._resolve_chain(chain_id)
        if resolved is None:
            return None
        run_id, base_config, read = resolved
        chain: dict[str, Any] = {"chain_id": chain_id, "pipeline_id": run_id, "preprocessings": base_config}

        summary = self.query_chain_summaries(chain_id=chain_id)
        if summary.height:
            row = summary.row(0, named=True)
            chain.update(
                {
                    "model_class": row.get("model_class", ""),
                    "model_name": row.get("model_name", ""),
                    "dataset_name": row.get("dataset_name", ""),
                    "metric": row.get("metric"),
                    "task_type": row.get("task_type"),
                }
            )

        artifact = self._single_artifact_for_chain(base_config, read)
        if artifact is not None:
            source_artifact_id = str(artifact.get("artifact_id") or "")
            chain["fold_artifacts"] = {"fold_final": _native_loadable_artifact_id(run_id, base_config, source_artifact_id)}
            chain["native_artifact_id"] = source_artifact_id
        else:
            chain["fold_artifacts"] = {}
            chain["artifact_unavailable_reason"] = self._artifact_unavailable_reason(run_id, base_config, read)
        return chain

    def load_artifact(self, artifact_id: str) -> Any:
        """Load a predict-capable model from a native synthetic artifact id.

        Native results expose rehydrated REFIT model artifacts, not legacy per-fold artifact records. This
        method only accepts the synthetic ids emitted through ``get_chain(...).fold_artifacts`` for chains
        that map to exactly one loadable REFIT model.
        """
        for run_id, read in self._iter_runs():
            for base_config in self._base_configs(read):
                artifact = self._single_artifact_for_chain(base_config, read)
                if artifact is None:
                    continue
                source_artifact_id = str(artifact.get("artifact_id") or "")
                if _native_loadable_artifact_id(run_id, base_config, source_artifact_id) == artifact_id:
                    return _native_model_from_artifact(artifact)
        raise ValueError(
            f"Native results artifact is not available or not uniquely loadable: {artifact_id!r}. "
            "SHAP requires a single refit model artifact for the selected chain."
        )

    def get_chains_for_pipeline(self, pipeline_id: str) -> pl.DataFrame:
        """Chain summaries for one surrogate pipeline (== run) — used to list sibling chains."""
        return self.query_chain_summaries(pipeline_id=pipeline_id)

    def get_pipeline(self, pipeline_id: str) -> dict[str, Any] | None:
        """Minimal pipeline descriptor for a surrogate pipeline (== run) id, or ``None``.

        The native format persists no expanded/authoring pipeline config, so ``generator_choices`` /
        ``expanded_config`` are absent (reported as a gap); the descriptor carries the run-level header
        the ``get_chain_detail`` endpoint reads for display.
        """
        for run_id, read in self._iter_runs():
            if run_id != pipeline_id:
                continue
            manifest = read["manifest"]
            datasets = manifest.get("datasets") or []
            metric = manifest.get("metric")
            return {
                "pipeline_id": run_id,
                "name": run_id,
                "dataset_name": datasets[0] if isinstance(datasets, list) and datasets else None,
                "generator_choices": None,
                "expanded_config": None,
                "original_template": None,
                "status": "completed",
                "metric": metric if isinstance(metric, str) else None,
                "best_val": None,
                "best_test": None,
            }
        return None

    def _fetch_pl(self, sql: str, params: list[Any] | None = None) -> pl.DataFrame:
        """REFUSE raw SQL — the native results store is a file projection, not a SQL database.

        The native format is parquet + JSON read through the library reader; there is no SQL engine on
        disk. Rather than fake a result (an empty frame would make the ``/aggregated-predictions/query``
        endpoint report a hollow ``columns:[]/rows:[]`` success on a native-only workspace), we raise a
        clear error. The chain-summary endpoints' OPTIONAL enrichment helpers
        (``_fetch_fold_artifacts`` / ``_build_pipeline_metadata_map``) already wrap their ``_fetch_pl``
        call in ``try/except`` and degrade to no-enrichment, so this refusal does not break them; the
        direct ``/query`` caller wraps it into a clear HTTP 400.
        """
        raise NotImplementedError(
            "raw SQL queries are not supported on a native results store: the native results format is a "
            "parquet + manifest projection read via the nirs4all library reader, not a SQL database. "
            "Use the structured endpoints (chain summaries / top / chain detail / prediction arrays) instead."
        )

    # ------------------------------------------------------------------
    # Surrogate resolution
    # ------------------------------------------------------------------

    def _resolve_chain(self, chain_id: str) -> tuple[str, str, dict[str, Any]] | None:
        """Resolve a ``"{run_id}::{base_config}"`` surrogate to ``(run_id, base_config, read)``.

        Matches against the documented surrogate format over each run's BASE variant names (the
        ``"{base}_refit"`` configs fold into their base), so the resolved variant spans both its CV and
        refit rows.
        """
        for run_id, read in self._iter_runs():
            for base_config in self._base_configs(read):
                if _native_chain_id(run_id, base_config) == chain_id:
                    return run_id, base_config, read
        return None

    @staticmethod
    def _base_configs(read: dict[str, Any]) -> set[str]:
        """Base variant names present in one native run payload."""
        return {
            _native_base_config(str(row.get("config_name") or ""))
            for row in read["predictions"].filter_predictions(load_arrays=False)
        }

    @staticmethod
    def _selected_base_config(read: dict[str, Any]) -> str | None:
        """Best/refit variant name recorded by the native manifest, normalized to a base config."""
        manifest = read.get("manifest") or {}
        selected = manifest.get("selected_variant")
        if isinstance(selected, str) and selected:
            return _native_base_config(selected)
        return None

    @staticmethod
    def _artifact_matches_base_config(artifact: dict[str, Any], base_config: str) -> bool:
        """Whether a native artifact id directly identifies the chain's base config."""
        if not base_config:
            return False
        source_artifact_id = str(artifact.get("artifact_id") or "")
        if source_artifact_id == base_config:
            return True
        return source_artifact_id.rsplit(":", 1)[-1] == base_config

    def _artifact_candidates_for_chain(self, base_config: str, read: dict[str, Any]) -> list[dict[str, Any]]:
        """Candidate rehydrated REFIT model artifacts for one native chain."""
        artifacts = [artifact for artifact in (read.get("artifacts") or []) if isinstance(artifact, dict)]
        if not artifacts:
            return []

        direct = [artifact for artifact in artifacts if self._artifact_matches_base_config(artifact, base_config)]
        if direct:
            return direct

        selected_base = self._selected_base_config(read)
        base_configs = self._base_configs(read)
        if selected_base == base_config or (selected_base is None and base_configs == {base_config}):
            return artifacts
        return []

    def _single_artifact_for_chain(self, base_config: str, read: dict[str, Any]) -> dict[str, Any] | None:
        """Return the one loadable artifact for a chain, or ``None`` when the mapping is absent/ambiguous."""
        candidates = self._artifact_candidates_for_chain(base_config, read)
        if len(candidates) == 1:
            return candidates[0]
        return None

    def _artifact_unavailable_reason(self, run_id: str, base_config: str, read: dict[str, Any]) -> str:
        """Clear reason why a native chain cannot currently expose a SHAP-loadable final artifact."""
        artifacts = [artifact for artifact in (read.get("artifacts") or []) if isinstance(artifact, dict)]
        if not artifacts:
            manifest = read.get("manifest") or {}
            capabilities = manifest.get("capabilities") if isinstance(manifest.get("capabilities"), dict) else {}
            if capabilities.get("has_model_artifacts") is False:
                return (
                    "Native results manifest reports has_model_artifacts=false; this run did not persist "
                    "loadable refit model artifacts."
                )
            return "Native results manifest does not contain loadable refit model artifacts for this chain."

        candidates = self._artifact_candidates_for_chain(base_config, read)
        if len(candidates) > 1:
            return (
                f"Native chain {_native_chain_id(run_id, base_config)!r} maps to {len(candidates)} refit artifacts; "
                "SHAP currently requires exactly one predict-capable model artifact."
            )
        return (
            f"Native results artifacts do not identify a refit model for chain "
            f"{_native_chain_id(run_id, base_config)!r}."
        )
