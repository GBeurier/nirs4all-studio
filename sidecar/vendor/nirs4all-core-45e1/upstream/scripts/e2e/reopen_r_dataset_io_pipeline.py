#!/usr/bin/env python3
"""Reopen the R dataset/IO pipeline artifacts and rerun them in Python.

This script is intentionally small and evidence-oriented: it does not implement
new pipeline logic. It calls the existing Python aggregate runner over the
pipeline and dataset saved by the R E2E lane, then compares the Python result
with the R prediction artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any


DEFAULT_TOLERANCE = 1e-8


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _workspace_root() -> Path:
    return Path.cwd().parent if Path.cwd().name == "nirs4all-core" else _repo_root().parent


def _prepend_workspace_paths(workspace_root: Path) -> None:
    paths = [
        _repo_root() / "bindings" / "python" / "src",
        workspace_root / "nirs4all-methods" / "bindings" / "python" / "src",
        workspace_root / "nirs4all-methods" / "bindings" / "python_nirs4all_methods" / "src",
        workspace_root / "nirs4all-methods" / "bindings" / "python_pls4all" / "src",
    ]
    for path in reversed(paths):
        if path.is_dir():
            sys.path.insert(0, str(path))


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise RuntimeError(f"cannot read {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid JSON {path}: {exc}") from exc


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=True, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _canonical_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _sha256_json(data: Any) -> str:
    return hashlib.sha256(_canonical_json(data).encode("utf-8")).hexdigest()


def _numeric_list(value: Any, label: str) -> list[float]:
    if not isinstance(value, list):
        raise RuntimeError(f"{label} must be a list")
    result = [float(item) for item in value]
    if not all(math.isfinite(item) for item in result):
        raise RuntimeError(f"{label} contains non-finite values")
    return result


def _max_abs_delta(actual: list[float], expected: list[float], label: str) -> float:
    if len(actual) != len(expected):
        raise RuntimeError(f"{label} length mismatch: {len(actual)} != {len(expected)}")
    return max((abs(lhs - rhs) for lhs, rhs in zip(actual, expected, strict=True)), default=0.0)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def _compare_split(actual: dict[str, Any], expected: dict[str, Any]) -> bool:
    return (
        actual.get("kind") == expected.get("kind")
        and actual.get("trainIndices") == expected.get("trainIndices")
        and actual.get("testIndices") == expected.get("testIndices")
    )


def _compare_result(actual: dict[str, Any], expected: dict[str, Any], tolerance: float) -> dict[str, Any]:
    _require(int(actual["rows"]) == int(expected["rows"]), "row count differs")
    _require(int(actual["cols"]) == int(expected["cols"]), "column count differs")
    _require(_compare_split(actual["split"], expected["split"]), "split differs")

    targets_delta = _max_abs_delta(
        _numeric_list(actual["targets"], "python targets"),
        _numeric_list(expected["targets"], "R targets"),
        "targets",
    )
    _require(targets_delta <= tolerance, f"target delta {targets_delta} > {tolerance}")

    actual_variants = actual.get("variants")
    expected_variants = expected.get("variants")
    _require(isinstance(actual_variants, list), "python variants must be a list")
    _require(isinstance(expected_variants, list), "R variants must be a list")
    _require(len(actual_variants) == len(expected_variants), "variant count differs")

    variant_deltas: list[dict[str, Any]] = []
    for index, (lhs, rhs) in enumerate(zip(actual_variants, expected_variants, strict=True)):
        _require(int(lhs["n_components"]) == int(rhs["n_components"]), f"variant {index} n_components differs")
        rmse_delta = abs(float(lhs["rmse"]) - float(rhs["rmse"]))
        predictions_delta = _max_abs_delta(
            _numeric_list(lhs["predictions"], f"python variant {index} predictions"),
            _numeric_list(rhs["predictions"], f"R variant {index} predictions"),
            f"variant {index} predictions",
        )
        _require(rmse_delta <= tolerance, f"variant {index} rmse delta {rmse_delta} > {tolerance}")
        _require(
            predictions_delta <= tolerance,
            f"variant {index} prediction delta {predictions_delta} > {tolerance}",
        )
        variant_deltas.append(
            {
                "index": index,
                "n_components": int(lhs["n_components"]),
                "rmse_delta": rmse_delta,
                "prediction_max_abs_delta": predictions_delta,
            }
        )

    _require(
        int(actual["selected"]["n_components"]) == int(expected["selected"]["n_components"]),
        "selected n_components differs",
    )
    selected_prediction_delta = _max_abs_delta(
        _numeric_list(actual["selected"]["predictions"], "python selected predictions"),
        _numeric_list(expected["selected"]["predictions"], "R selected predictions"),
        "selected predictions",
    )
    selected_rmse_delta = abs(float(actual["selected"]["rmse"]) - float(expected["selected"]["rmse"]))
    _require(selected_rmse_delta <= tolerance, f"selected rmse delta {selected_rmse_delta} > {tolerance}")
    _require(
        selected_prediction_delta <= tolerance,
        f"selected prediction delta {selected_prediction_delta} > {tolerance}",
    )

    return {
        "targets_max_abs_delta": targets_delta,
        "selected_rmse_delta": selected_rmse_delta,
        "selected_prediction_max_abs_delta": selected_prediction_delta,
        "variants": variant_deltas,
    }


def build_ledger(in_dir: Path, *, workspace_root: Path, tolerance: float) -> dict[str, Any]:
    _prepend_workspace_paths(workspace_root)
    import nirs4all_core as n4a

    workspace_path = in_dir / "workspace.n4a.json"
    pipeline_path = in_dir / "pipeline.n4a.json"
    reshaped_path = in_dir / "reshaped-dataset.json"
    r_predictions_path = in_dir / "r-predictions.json"

    workspace = _read_json(workspace_path)
    pipeline = _read_json(pipeline_path)
    reshaped = _read_json(reshaped_path)
    r_predictions = _read_json(r_predictions_path)

    _require(workspace.get("schema_version") == "n4a.e2e.r_workspace/v1", "unsupported R workspace schema")
    _require(workspace.get("status") == "passed", "R workspace did not pass")
    _require(pipeline.get("schema_version") == "n4a.e2e.r_pipeline/v1", "unsupported R pipeline schema")
    _require(r_predictions.get("schema_version") == "n4a.e2e.r_predictions/v1", "unsupported R predictions schema")
    _require(r_predictions.get("status") == "passed", "R predictions did not pass")
    _require(reshaped.get("schema_version") == "n4a.e2e.r_dataset_io_pipeline/v2", "unsupported reshaped schema")

    dataset = reshaped["dataset"]
    dataset_hash = _sha256_json(dataset)
    expected_dataset_hash = workspace.get("source", {}).get("dataset_sha256")
    prepared_dataset_hash = reshaped.get("io_reshape", {}).get("dataset_sha256")
    dataset_hash_match = dataset_hash == expected_dataset_hash == prepared_dataset_hash
    _require(dataset_hash_match, "dataset hash mismatch across R workspace and reshaped dataset")

    actual = n4a.run_portable_pipeline(str(pipeline_path), dataset)
    expected = dict(workspace["result"])
    deltas = _compare_result(actual, expected, tolerance)

    r_prediction_delta = _max_abs_delta(
        _numeric_list(actual["selected"]["predictions"], "python selected predictions"),
        _numeric_list(r_predictions["predictions"], "R prediction artifact predictions"),
        "R prediction artifact",
    )
    _require(r_prediction_delta <= tolerance, f"R prediction artifact delta {r_prediction_delta} > {tolerance}")

    return {
        "schema_version": "n4a.e2e.r_dataset_python_reopen/v1",
        "status": "passed",
        "runtime": "python",
        "engine": "nirs4all-core",
        "tolerance": tolerance,
        "artifacts": {
            "workspace": str(workspace_path),
            "pipeline": str(pipeline_path),
            "reshaped_dataset": str(reshaped_path),
            "r_predictions": str(r_predictions_path),
        },
        "checks": {
            "workspace_reopened": True,
            "pipeline_reopened": True,
            "python_rerun_executed": True,
            "finite_targets": all(math.isfinite(float(item)) for item in actual["targets"]),
            "finite_predictions": all(math.isfinite(float(item)) for item in actual["selected"]["predictions"]),
            "dataset_hash_match": dataset_hash_match,
            "pipeline_name_match": actual.get("name") == pipeline.get("name"),
            "row_count": int(actual["rows"]),
            "column_count": int(actual["cols"]),
            "selected_n_components": int(actual["selected"]["n_components"]),
            "r_prediction_artifact_max_abs_delta": r_prediction_delta,
            **deltas,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="in_dir", type=Path, required=True, help="R scenario artifact directory.")
    parser.add_argument("--out", type=Path, required=True, help="Output ledger JSON path.")
    parser.add_argument("--workspace-root", type=Path, default=_workspace_root())
    parser.add_argument("--tolerance", type=float, default=DEFAULT_TOLERANCE)
    args = parser.parse_args(argv)

    try:
        ledger = build_ledger(args.in_dir, workspace_root=args.workspace_root, tolerance=args.tolerance)
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    _write_json(args.out, ledger)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
