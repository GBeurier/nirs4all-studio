#!/usr/bin/env python3
"""Produce Python open/rerun evidence for the core+UI custom app host scenario."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
from typing import Any

import nirs4all_core as n4core


ROOT = Path(__file__).resolve().parents[2]
SCENARIO_ID = "e2e-core-ui-custom-app-host"
ORACLE_PATH = ROOT / "tests" / "parity" / "expected" / "portable_python_oracle.json"
FIXTURE_REL = "tests/parity/fixtures/portable_methods_pipeline.json"
FIXTURE_PATH = ROOT / FIXTURE_REL
OPEN_ARTIFACT = "custom-host-python-open.json"
RERUN_ARTIFACT = "custom-host-python-rerun.json"


def _prepend_env_path(name: str, value: Path) -> None:
    existing = os.environ.get(name)
    parts = [str(value)]
    if existing:
        parts.append(existing)
    os.environ[name] = os.pathsep.join(parts)


def _configure_methods_runtime_env() -> None:
    methods_lib_dir = ROOT.parent / "nirs4all-methods" / "build/dev-release/cpp/src"
    if not methods_lib_dir.exists():
        return
    os.environ["PLS4ALL_LIB_PATH"] = str(methods_lib_dir)
    os.environ["N4M_LIB_PATH"] = str(methods_lib_dir)
    _prepend_env_path("LD_LIBRARY_PATH", methods_lib_dir)


def _read_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise TypeError(f"{path} must contain a JSON object")
    return data


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")


def _sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _max_abs_diff(actual: list[float], expected: list[float]) -> float:
    if len(actual) != len(expected):
        raise AssertionError(f"length mismatch: {len(actual)} != {len(expected)}")
    return max((abs(float(a) - float(e)) for a, e in zip(actual, expected)), default=0.0)


def _finite(values: list[float]) -> bool:
    return all(math.isfinite(float(value)) for value in values)


def _case(oracle: dict[str, Any]) -> dict[str, Any]:
    for item in oracle["cases"]:
        if item["name"] == "portable_methods_pipeline":
            return item
    raise AssertionError("portable_methods_pipeline case missing from Python oracle")


def build_evidence(artifacts_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    _configure_methods_runtime_env()
    oracle = _read_json(ORACLE_PATH)
    fixture = _read_json(FIXTURE_PATH)
    expected = _case(oracle)
    definition = n4core.load_pipeline_definition(FIXTURE_PATH)
    plan = n4core.parse_execution_plan(definition)
    classes = n4core.portable_class_names(definition)
    dataset = {
        "X": oracle["dataset"]["X"],
        "y": oracle["dataset"]["y"],
        "rows": oracle["dataset"]["rows"],
        "cols": oracle["dataset"]["cols"],
    }
    tolerances = oracle["metadata"]["tolerances"]

    fixture_path_match = expected["fixture"] == FIXTURE_REL
    pipeline_name_match = definition.name == expected["name"] == fixture["name"]
    open_evidence = {
        "schema_version": "n4a.e2e.python_open_pipeline.v1",
        "scenario_id": SCENARIO_ID,
        "status": "passed",
        "oracle_reopened": True,
        "pipeline_reopened": True,
        "dataset_reopened": True,
        "fixture_path_match": fixture_path_match,
        "pipeline_name_match": pipeline_name_match,
        "case_name_match": expected["name"] == "portable_methods_pipeline",
        "fixture": FIXTURE_REL,
        "pipeline_name": definition.name,
        "pipeline_classes": classes,
        "plan_step_count": len(plan["preprocessing"]) + 2,
        "n_components_values": plan["nComponents"],
        "selected_n_components_expected": int(expected["selected"]["n_components"]),
        "dataset": {
            "rows": int(dataset["rows"]),
            "cols": int(dataset["cols"]),
        },
        "fingerprints": {
            "oracle_sha256": _sha256(ORACLE_PATH),
            "pipeline_descriptor_sha256": _sha256(FIXTURE_PATH),
        },
        "oracle_source": oracle["metadata"]["source"],
        "artifacts_dir": str(artifacts_dir),
    }
    for check in (
        "oracle_reopened",
        "pipeline_reopened",
        "dataset_reopened",
        "fixture_path_match",
        "pipeline_name_match",
        "case_name_match",
    ):
        if open_evidence[check] is not True:
            raise AssertionError(f"custom host open evidence failed: {check}")

    actual = n4core.run_portable_pipeline(FIXTURE_PATH, dataset)
    selected_predictions = [float(value) for value in actual["selected"]["predictions"]]
    expected_predictions = [float(value) for value in expected["selected"]["predictions"]]
    selected_rmse = float(actual["selected"]["rmse"])
    expected_rmse = float(expected["selected"]["rmse"])
    target_delta = _max_abs_diff([float(value) for value in actual["targets"]], [float(value) for value in expected["targets"]])
    prediction_delta = _max_abs_diff(selected_predictions, expected_predictions)
    variant_rmse_delta = max(
        (
            abs(float(actual_variant["rmse"]) - float(expected_variant["rmse"]))
            for actual_variant, expected_variant in zip(actual["variants"], expected["variants"])
        ),
        default=math.inf,
    )
    variant_prediction_delta = max(
        (
            _max_abs_diff(
                [float(value) for value in actual_variant["predictions"]],
                [float(value) for value in expected_variant["predictions"]],
            )
            for actual_variant, expected_variant in zip(actual["variants"], expected["variants"])
        ),
        default=math.inf,
    )
    rerun_evidence = {
        "schema_version": "n4a.e2e.python_rerun_pipeline.v1",
        "scenario_id": SCENARIO_ID,
        "status": "passed",
        "oracle_reopened": True,
        "pipeline_reopened": True,
        "python_rerun_executed": True,
        "finite_predictions": _finite(selected_predictions),
        "prediction_rows": len(selected_predictions),
        "split_match": actual["split"] == expected["split"],
        "variant_count_match": len(actual["variants"]) == len(expected["variants"]),
        "selected_n_components_match": actual["selected"]["n_components"] == expected["selected"]["n_components"],
        "target_max_abs_delta": target_delta,
        "target_tolerance": float(tolerances["targets_abs"]),
        "prediction_max_abs_delta": prediction_delta,
        "prediction_tolerance": float(tolerances["predictions_abs"]),
        "rmse_delta": abs(selected_rmse - expected_rmse),
        "rmse_tolerance": float(tolerances["rmse_abs"]),
        "variant_rmse_max_abs_delta": variant_rmse_delta,
        "variant_prediction_max_abs_delta": variant_prediction_delta,
        "selected": {
            "n_components": int(actual["selected"]["n_components"]),
            "rmse": selected_rmse,
        },
        "dataset": {
            "rows": int(actual["rows"]),
            "cols": int(actual["cols"]),
        },
    }
    checks = (
        rerun_evidence["finite_predictions"],
        rerun_evidence["split_match"],
        rerun_evidence["variant_count_match"],
        rerun_evidence["selected_n_components_match"],
        target_delta <= float(tolerances["targets_abs"]),
        prediction_delta <= float(tolerances["predictions_abs"]),
        rerun_evidence["rmse_delta"] <= float(tolerances["rmse_abs"]),
        variant_rmse_delta <= float(tolerances["rmse_abs"]),
        variant_prediction_delta <= float(tolerances["predictions_abs"]),
    )
    if not all(checks):
        raise AssertionError(f"custom host Python rerun parity failed: {rerun_evidence}")
    return open_evidence, rerun_evidence


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts-dir", type=Path, required=True)
    args = parser.parse_args()
    open_evidence, rerun_evidence = build_evidence(args.artifacts_dir)
    _write_json(args.artifacts_dir / OPEN_ARTIFACT, open_evidence)
    _write_json(args.artifacts_dir / RERUN_ARTIFACT, rerun_evidence)


if __name__ == "__main__":
    main()
