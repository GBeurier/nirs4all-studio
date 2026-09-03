#!/usr/bin/env python3
"""Validate the multisource stacking replay artifacts produced by full Python nirs4all."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

SCENARIO_ID = "e2e-multisource-branching-stacking-replay"


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _finite(value: Any, label: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise AssertionError(f"{label} must be finite, got {value!r}")
    return number


def _parity_delta(parity: dict[str, Any], canonical_key: str, legacy_key: str) -> float:
    if canonical_key in parity:
        return _finite(parity[canonical_key], canonical_key)
    return _finite(parity[legacy_key], legacy_key)


def _stable_hash(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _as_int_list(values: Any) -> list[int]:
    if values is None:
        return []
    return [int(value) for value in list(values)]


def _as_float_list(values: Any) -> list[float]:
    if values is None:
        return []
    return [float(value) for value in list(values)]


def _ledger_fold_sample_ids(ledger: dict[str, Any], fold_id: str | None) -> list[int]:
    if fold_id is None:
        return []
    try:
        wanted = int(fold_id)
    except ValueError:
        return []
    for fold in ledger.get("folds", []):
        if int(fold.get("fold_id", -1)) == wanted:
            return _as_int_list(fold.get("sample_ids"))
    return []


def _row_vector_lengths(row: dict[str, Any]) -> dict[str, int]:
    return {
        "sample_indices": len(_as_int_list(row.get("sample_indices"))),
        "y_true": len(_as_float_list(row.get("y_true"))),
        "y_pred": len(_as_float_list(row.get("y_pred"))),
    }


def _test_vector_parity(array_rows: list[dict[str, Any]], ledger: dict[str, Any], tolerance: float) -> dict[str, Any]:
    gaps: list[str] = []
    test_rows = [row for row in array_rows if row.get("partition") == "test"]
    if not test_rows:
        return {
            "available": False,
            "partition": "test",
            "reason": "no test rows with arrays_present=true in native predictions.parquet",
            "gaps": ["native test vectors unavailable"],
        }

    native_sample_order: list[int] = []
    native_targets: dict[int, float] = {}
    native_predictions: dict[int, float] = {}
    for row in test_rows:
        sample_indices = _as_int_list(row.get("sample_indices"))
        y_true = _as_float_list(row.get("y_true"))
        y_pred = _as_float_list(row.get("y_pred"))
        if not (len(sample_indices) == len(y_true) == len(y_pred)):
            gaps.append(
                "native test vector length mismatch: "
                f"sample_indices={len(sample_indices)} y_true={len(y_true)} y_pred={len(y_pred)}"
            )
            continue
        native_sample_order.extend(sample_indices)
        for sample_id, target, prediction in zip(sample_indices, y_true, y_pred):
            native_targets[int(sample_id)] = float(target)
            native_predictions[int(sample_id)] = float(prediction)

    oracle_test = ledger.get("test", {})
    oracle_sample_order = _as_int_list(oracle_test.get("sample_ids"))
    oracle_targets_list = _as_float_list(oracle_test.get("targets"))
    oracle_predictions_list = _as_float_list(oracle_test.get("predictions"))
    if not (len(oracle_sample_order) == len(oracle_targets_list) == len(oracle_predictions_list)):
        gaps.append(
            "oracle test vector length mismatch: "
            f"sample_ids={len(oracle_sample_order)} targets={len(oracle_targets_list)} predictions={len(oracle_predictions_list)}"
        )

    oracle_targets = {sample_id: target for sample_id, target in zip(oracle_sample_order, oracle_targets_list)}
    oracle_predictions = {
        sample_id: prediction for sample_id, prediction in zip(oracle_sample_order, oracle_predictions_list)
    }
    native_ids = set(native_predictions)
    oracle_ids = set(oracle_predictions)
    missing_in_native = sorted(oracle_ids - native_ids)
    extra_in_native = sorted(native_ids - oracle_ids)
    common_ids = sorted(native_ids & oracle_ids & set(native_targets) & set(oracle_targets))
    if missing_in_native:
        gaps.append(f"native vectors missing oracle sample ids: {missing_in_native}")
    if extra_in_native:
        gaps.append(f"native vectors include extra sample ids: {extra_in_native}")
    if not common_ids:
        return {
            "available": False,
            "partition": "test",
            "reason": "no common test sample ids between native vectors and oracle ledger",
            "gaps": gaps or ["no common test sample ids"],
        }

    target_abs_max = max(abs(native_targets[sample_id] - oracle_targets[sample_id]) for sample_id in common_ids)
    prediction_abs_max = max(abs(native_predictions[sample_id] - oracle_predictions[sample_id]) for sample_id in common_ids)
    return {
        "available": not gaps,
        "partition": "test",
        "sample_count_native": len(native_sample_order),
        "sample_count_oracle": len(oracle_sample_order),
        "sample_count_compared": len(common_ids),
        "sample_order_match": native_sample_order == oracle_sample_order,
        "sample_set_match": not missing_in_native and not extra_in_native,
        "native_sample_ids_sha256": _stable_hash(native_sample_order),
        "oracle_sample_ids_sha256": _stable_hash(oracle_sample_order),
        "target_abs_max": target_abs_max,
        "prediction_abs_max": prediction_abs_max,
        "tolerance": tolerance,
        "within_tolerance": target_abs_max <= tolerance and prediction_abs_max <= tolerance,
        "gaps": gaps,
    }


def _required_artifacts(artifacts_dir: Path) -> tuple[Path, Path]:
    replay_path = artifacts_dir / "stacking-replay.n4a.json"
    ledger_path = artifacts_dir / "oof-ledger.json"
    missing = [path.name for path in (replay_path, ledger_path) if not path.exists()]
    if missing:
        raise FileNotFoundError(
            "Missing multisource stacking artifact(s): "
            + ", ".join(missing)
            + ". Run `python3.11 -m pytest tests/e2e/test_multisource_stacking_replay.py --artifacts-dir=<dir>` first."
        )
    return replay_path, ledger_path


def _native_dir(replay: dict[str, Any], artifacts_dir: Path) -> Path:
    raw = replay.get("dagml_native", {}).get("native_results_dir")
    if isinstance(raw, str) and raw:
        candidate = Path(raw)
        if candidate.is_dir():
            return candidate
    native_root = artifacts_dir / "native-results"
    candidates = sorted(path for path in native_root.iterdir() if path.is_dir()) if native_root.is_dir() else []
    if len(candidates) == 1:
        return candidates[0]
    raise FileNotFoundError(f"Unable to resolve native results directory from {raw!r} or {native_root}")


def _merge_stack_score(score_set: dict[str, Any], *, partition: str, fold_id: str | None) -> float:
    matches = [
        report
        for report in score_set.get("reports", [])
        if report.get("producer_node") == "merge:stack"
        and report.get("partition") == partition
        and report.get("fold_id") == fold_id
        and isinstance(report.get("metrics"), dict)
        and "rmse" in report["metrics"]
    ]
    if len(matches) != 1:
        raise AssertionError(f"expected one merge:stack report for partition={partition!r} fold_id={fold_id!r}, got {len(matches)}")
    return _finite(matches[0]["metrics"]["rmse"], f"merge:stack {partition}/{fold_id} rmse")


def _prediction_table_audit(native_dir: Path, replay: dict[str, Any], ledger: dict[str, Any]) -> dict[str, Any]:
    try:
        import pyarrow.parquet as pq
    except ModuleNotFoundError as exc:
        raise AssertionError("pyarrow is required to audit native predictions.parquet") from exc

    table = pq.read_table(native_dir / "predictions.parquet")
    rows = table.to_pylist()
    required_columns = {
        "model_name",
        "partition",
        "fold_id",
        "sample_indices",
        "y_true",
        "y_pred",
        "arrays_present",
        "metric",
        "target_width",
    }
    columns = set(table.column_names)
    missing_columns = sorted(required_columns - columns)
    if missing_columns:
        raise AssertionError(f"native predictions.parquet missing column(s): {missing_columns}")

    expected_rows = int(replay["dagml_native"]["num_predictions"])
    if len(rows) != expected_rows:
        raise AssertionError(f"native predictions.parquet row count mismatch: {len(rows)} != {expected_rows}")

    meta_rows = [row for row in rows if row.get("model_name") == "MetaModel_Ridge"]
    if len(meta_rows) != expected_rows:
        raise AssertionError(f"expected all native prediction rows to be MetaModel_Ridge, got {len(meta_rows)} of {expected_rows}")
    if any(row.get("metric") != "rmse" for row in meta_rows):
        raise AssertionError("native prediction table carries a non-rmse MetaModel row")
    if any(int(row.get("target_width", -1)) != 1 for row in meta_rows):
        raise AssertionError("native prediction table carries an unexpected target width")

    array_rows = [row for row in meta_rows if row.get("arrays_present")]
    tolerance = _finite(ledger.get("prediction_tolerance", replay["parity"]["score_tolerance"]), "prediction_tolerance")
    row_alignment: list[dict[str, Any]] = []
    alignment_gaps: list[str] = []
    for index, row in enumerate(meta_rows):
        partition = str(row.get("partition"))
        fold_id = None if row.get("fold_id") is None else str(row.get("fold_id"))
        arrays_present = bool(row.get("arrays_present"))
        target_width = int(row.get("target_width", -1))
        sample_indices = _as_int_list(row.get("sample_indices")) if arrays_present else []
        expected_samples: list[int] = []
        expected_scope = "unavailable"
        if partition == "test":
            expected_samples = _as_int_list(ledger.get("test", {}).get("sample_ids"))
            expected_scope = "ledger.test.sample_ids"
        elif partition == "validation":
            expected_samples = _ledger_fold_sample_ids(ledger, fold_id)
            expected_scope = "ledger.folds.sample_ids"

        lengths = _row_vector_lengths(row) if arrays_present else {"sample_indices": 0, "y_true": 0, "y_pred": 0}
        vector_lengths_match = arrays_present and lengths["sample_indices"] == lengths["y_true"] == lengths["y_pred"]
        sample_order_match = sample_indices == expected_samples if expected_samples and arrays_present else None
        sample_set_match = sorted(sample_indices) == sorted(expected_samples) if expected_samples and arrays_present else None
        if arrays_present and not vector_lengths_match:
            alignment_gaps.append(f"row {index} vector lengths do not align: {lengths}")
        if arrays_present and expected_samples and not sample_set_match:
            alignment_gaps.append(f"row {index} sample set does not match {expected_scope}")

        row_alignment.append(
            {
                "row_index": index,
                "partition": partition,
                "fold_id": fold_id,
                "arrays_present": arrays_present,
                "target_width": target_width,
                "target_width_expected": 1,
                "target_width_matches": target_width == 1,
                "vector_lengths": lengths,
                "vector_lengths_match": vector_lengths_match,
                "expected_sample_scope": expected_scope,
                "sample_count_native": len(sample_indices),
                "sample_count_expected": len(expected_samples),
                "sample_order_match": sample_order_match,
                "sample_set_match": sample_set_match,
                "sample_indices_sha256": _stable_hash(sample_indices),
                "expected_sample_ids_sha256": _stable_hash(expected_samples),
            }
        )

    arrays_present_values = sorted({bool(row.get("arrays_present")) for row in meta_rows})
    target_width_values = sorted({int(row.get("target_width", -1)) for row in meta_rows})
    return {
        "rows": len(rows),
        "meta_model_rows": len(meta_rows),
        "array_rows": len(array_rows),
        "arrays_present": {
            "column_present": True,
            "values": arrays_present_values,
            "true_rows": len(array_rows),
            "false_rows": len(meta_rows) - len(array_rows),
        },
        "array_payload_scope": "present_in_native_prediction_table" if array_rows else "absent_in_current_native_prediction_table",
        "partitions": sorted({str(row.get("partition")) for row in meta_rows}),
        "fold_ids": sorted({str(row.get("fold_id")) for row in meta_rows}),
        "target_width": {
            "values": target_width_values,
            "all_one": target_width_values == [1],
        },
        "sample_fold_partition_target_alignment": {
            "available": bool(array_rows),
            "strict_claim": False,
            "rows": row_alignment,
            "gaps": alignment_gaps,
        },
        "vector_parity": _test_vector_parity(array_rows, ledger, tolerance),
        "schema_columns": table.column_names,
    }


def _validate(artifacts_dir: Path) -> dict[str, Any]:
    replay_path, ledger_path = _required_artifacts(artifacts_dir)
    replay = _load_json(replay_path)
    ledger = _load_json(ledger_path)

    if replay.get("scenario_id") != SCENARIO_ID or ledger.get("scenario_id") != SCENARIO_ID:
        raise AssertionError("scenario_id mismatch in replay artifacts")
    if replay.get("status") != "python_oracle_and_native_ready":
        raise AssertionError(f"unexpected replay status {replay.get('status')!r}")

    tolerance = _finite(replay["parity"]["score_tolerance"], "score_tolerance")
    cv_delta = _parity_delta(replay["parity"], "cv_best_score_delta", "cv_best_score_abs")
    best_delta = _parity_delta(replay["parity"], "best_rmse_delta", "best_rmse_abs")
    if cv_delta > tolerance or best_delta > tolerance:
        raise AssertionError(f"replay parity deltas exceed tolerance: cv={cv_delta} best={best_delta} tol={tolerance}")

    oracle_scores = ledger["scores"]
    replay_scores = replay["oracle_scores"]
    for key in ("cv_best_score", "best_rmse"):
        delta = abs(_finite(oracle_scores[key], f"ledger {key}") - _finite(replay_scores[key], f"replay {key}"))
        if delta > 1e-12:
            raise AssertionError(f"oracle score mismatch for {key}: {delta}")

    native_dir = _native_dir(replay, artifacts_dir)
    required_native = [native_dir / "manifest.json", native_dir / "score_set.json", native_dir / "predictions.parquet"]
    missing_native = [path.name for path in required_native if not path.exists()]
    if missing_native:
        raise FileNotFoundError(f"native result directory is incomplete: {missing_native}")

    native_manifest = _load_json(native_dir / "manifest.json")
    score_set = _load_json(native_dir / "score_set.json")

    checks = {
        "native_engine": native_manifest.get("engine") == "dag-ml",
        "native_metric": native_manifest.get("metric") == "rmse",
        "native_model": "MetaModel_Ridge" in set(native_manifest.get("model_names", [])),
        "native_num_predictions": int(native_manifest.get("num_predictions", -1)) == int(replay["dagml_native"]["num_predictions"]),
        "native_prediction_file": (native_dir / native_manifest.get("files", {}).get("predictions", "")).exists(),
        "native_score_file": (native_dir / native_manifest.get("files", {}).get("score_set", "")).exists(),
    }
    if not all(checks.values()):
        raise AssertionError(f"native manifest checks failed: {checks}")

    score_cv = _merge_stack_score(score_set, partition="validation", fold_id="avg")
    score_best = _merge_stack_score(score_set, partition="test", fold_id=None)
    cv_score_delta = abs(score_cv - _finite(oracle_scores["cv_best_score"], "oracle cv_best_score"))
    best_score_delta = abs(score_best - _finite(oracle_scores["best_rmse"], "oracle best_rmse"))
    if cv_score_delta > tolerance or best_score_delta > tolerance:
        raise AssertionError(
            f"native score_set deltas exceed tolerance: cv={cv_score_delta} best={best_score_delta} tol={tolerance}"
        )
    prediction_table = _prediction_table_audit(native_dir, replay, ledger)
    vector_parity = prediction_table["vector_parity"]
    prediction_vector_parity = {
        "available": bool(vector_parity.get("available")),
        "compared_rows": int(vector_parity.get("sample_count_compared") or 0),
        "max_abs_delta": vector_parity.get("prediction_abs_max"),
        "target_max_abs_delta": vector_parity.get("target_abs_max"),
        "tolerance": vector_parity.get("tolerance"),
        "within_tolerance": bool(vector_parity.get("within_tolerance")),
    }
    decisions = [
        "nirs4all-core validates the native dag-ml replay score_set and audits predictions.parquet schema/coverage instead of reimplementing the Python stacking runner.",
        "The richer by_source stacking legacy case remains fallback-only and is recorded as a known boundary in the replay manifest.",
    ]
    if prediction_vector_parity["available"]:
        decisions.append(
            "Native MetaModel test rows carry per-sample arrays, so native prediction_vector_parity is enforced against the Python oracle ledger."
        )
    else:
        decisions.append(
            "Native MetaModel rows do not yet expose comparable per-sample arrays, so prediction_vector_parity remains unavailable."
        )

    return {
        "scenario_id": SCENARIO_ID,
        "status": "passed",
        "artifacts_dir": str(artifacts_dir),
        "replay": replay_path.name,
        "ledger": ledger_path.name,
        "native_results_dir": str(native_dir),
        "checks": checks,
        "score_set_parity": {
            "cv_best_score_abs": cv_score_delta,
            "best_rmse_abs": best_score_delta,
            "tolerance": tolerance,
        },
        "prediction_vector_parity": prediction_vector_parity,
        "prediction_table": prediction_table,
        "decisions": decisions,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts-dir", type=Path, required=True)
    args = parser.parse_args(argv)

    artifacts_dir = args.artifacts_dir.resolve()
    output_path = artifacts_dir / "native-replay.json"
    try:
        evidence = _validate(artifacts_dir)
    except Exception as exc:
        _write_json(output_path, {"scenario_id": SCENARIO_ID, "status": "failed", "reason": str(exc)})
        print(str(exc), file=sys.stderr)
        return 1

    _write_json(output_path, evidence)
    print(json.dumps({"scenario_id": SCENARIO_ID, "status": "passed"}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
