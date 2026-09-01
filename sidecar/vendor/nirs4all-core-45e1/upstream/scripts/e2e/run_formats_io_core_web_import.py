#!/usr/bin/env python3
"""Replay the formats/IO assembled dataset ledger through nirs4all-core WASM."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


SCENARIO_ID = "e2e-formats-io-datasets-methods-language-bindings"
OUTPUT_ARTIFACT = "web-core-pipeline-import.json"
TOLERANCE = 1e-8
PIPELINE = {
    "name": "formats_io_core_web_pls",
    "pipeline": [
        {
            "model": {
                "class": "sklearn.cross_decomposition.PLSRegression",
                "params": {"n_components": 1},
            }
        }
    ],
}


def _core_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _workspace_root() -> Path:
    return _core_root().parent


def _read_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise TypeError(f"{path} must contain a JSON object")
    return data


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")


def _sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _stable_hash(payload: Any) -> str:
    data = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return "sha256:" + hashlib.sha256(data).hexdigest()


def _ensure_python_paths() -> None:
    for path in (
        _core_root() / "bindings" / "python" / "src",
        _workspace_root() / "nirs4all-methods" / "bindings" / "python" / "src",
    ):
        if path.is_dir():
            text = str(path)
            if text not in sys.path:
                sys.path.insert(0, text)


def _find_node() -> Path:
    candidates = [
        os.environ.get("NODE"),
        shutil.which("node"),
        str(Path.home() / ".nvm" / "versions" / "node" / "v24.16.0" / "bin" / "node"),
        str(Path.home() / ".nvm" / "versions" / "node" / "v22.21.1" / "bin" / "node"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    raise RuntimeError("Node.js runtime not found; cannot run nirs4all-core WASM import evidence")


def _methods_dist() -> Path:
    override = os.environ.get("NIRS4ALL_METHODS_JS_DIST")
    dist = Path(override) if override else _workspace_root() / "nirs4all-methods" / "bindings" / "js" / "dist"
    missing = [name for name in ("index.js", "n4m.js", "n4m.wasm") if not (dist / name).exists()]
    if missing:
        raise FileNotFoundError(
            f"missing nirs4all-methods JS/WASM dist files in {dist}: {', '.join(missing)}; "
            "build/stage the methods WASM artifact before running this evidence"
        )
    return dist


def _max_abs_diff(actual: list[Any], expected: list[Any]) -> float:
    if len(actual) != len(expected):
        raise AssertionError(f"length mismatch: {len(actual)} != {len(expected)}")
    return max((abs(float(a) - float(e)) for a, e in zip(actual, expected)), default=0.0)


def _finite(values: list[Any]) -> bool:
    return all(math.isfinite(float(value)) for value in values)


def _dataset_from_fixture(fixture: dict[str, Any]) -> dict[str, Any]:
    x = fixture["X"]
    y = fixture["y"]
    rows = int(fixture["rows"])
    cols = int(fixture["cols"])
    if not isinstance(x, list) or len(x) != rows:
        raise AssertionError(f"{fixture.get('dataset_id')}: X rows do not match fixture rows")
    if len(y) != rows:
        raise AssertionError(f"{fixture.get('dataset_id')}: y length does not match fixture rows")
    return {"X": x, "y": y, "rows": rows, "cols": cols}


def _run_python(dataset: dict[str, Any]) -> dict[str, Any]:
    _ensure_python_paths()
    import nirs4all_core as n4a

    return n4a.run_portable_pipeline(PIPELINE, dataset)


def _run_wasm(dataset: dict[str, Any], artifacts_dir: Path, dataset_id: str) -> dict[str, Any]:
    node = _find_node()
    methods_dist = _methods_dist()
    core_module = _core_root() / "bindings" / "wasm" / "src" / "index.js"
    with tempfile.TemporaryDirectory(prefix=f"n4a-core-web-{dataset_id}-", dir=str(artifacts_dir)) as tmp:
        tmp_dir = Path(tmp)
        pipeline_path = tmp_dir / "pipeline.json"
        dataset_path = tmp_dir / "dataset.json"
        pipeline_path.write_text(json.dumps(PIPELINE, allow_nan=False), encoding="utf-8")
        dataset_path.write_text(json.dumps(dataset, allow_nan=False), encoding="utf-8")
        code = r"""
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [coreModulePath, methodsIndexPath, pipelinePath, datasetPath] = process.argv.slice(1);
const core = await import(pathToFileURL(coreModulePath).href);
const methods = await import(pathToFileURL(methodsIndexPath).href);
await methods.loadModule();
const pipeline = JSON.parse(readFileSync(pipelinePath, 'utf8'));
const dataset = JSON.parse(readFileSync(datasetPath, 'utf8'));
const actual = await core.runPortablePipeline(pipeline, dataset, { methods });
const predicted = await core.predictPortablePipeline(actual, {
  X: dataset.X,
  rows: dataset.rows,
  cols: dataset.cols,
}, { methods });
const heldOut = actual.split.testIndices.map((index) => predicted.data[index]);
let predictRoundtripAbsMax = 0;
for (let i = 0; i < heldOut.length; i += 1) {
  predictRoundtripAbsMax = Math.max(predictRoundtripAbsMax, Math.abs(heldOut[i] - actual.selected.predictions[i]));
}
console.log(JSON.stringify({
  status: 'passed',
  runtime: 'javascript_wasm',
  client_side_only: true,
  backend_api_request_count: 0,
  node: process.version,
  core_package: 'nirs4all',
  core_entrypoint: 'runPortablePipeline',
  predict_entrypoint: 'predictPortablePipeline',
  methods_version: methods.version(),
  result: actual,
  predict_roundtrip: {
    rows: predicted.rows,
    cols: predicted.cols,
    held_out_prediction_count: heldOut.length,
    selected_prediction_abs_max: predictRoundtripAbsMax,
  },
}));
"""
        proc = subprocess.run(
            [
                str(node),
                "--input-type=module",
                "-e",
                code,
                str(core_module),
                str(methods_dist / "index.js"),
                str(pipeline_path),
                str(dataset_path),
            ],
            cwd=_core_root() / "bindings" / "wasm",
            text=True,
            capture_output=True,
            check=False,
            timeout=60,
        )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"node exited with {proc.returncode}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


def _case_evidence(fixture: dict[str, Any], artifacts_dir: Path) -> dict[str, Any]:
    dataset = _dataset_from_fixture(fixture)
    python_result = _run_python(dataset)
    wasm_result = _run_wasm(dataset, artifacts_dir, str(fixture["dataset_id"]))
    actual = wasm_result["result"]
    py_selected = python_result["selected"]
    js_selected = actual["selected"]
    prediction_delta = _max_abs_diff(js_selected["predictions"], py_selected["predictions"])
    target_delta = _max_abs_diff(actual["targets"], python_result["targets"])
    rmse_delta = abs(float(js_selected["rmse"]) - float(py_selected["rmse"]))
    variant_rmse_delta = max(
        (
            abs(float(js_variant["rmse"]) - float(py_variant["rmse"]))
            for js_variant, py_variant in zip(actual["variants"], python_result["variants"])
        ),
        default=0.0,
    )
    variant_prediction_delta = max(
        (
            _max_abs_diff(js_variant["predictions"], py_variant["predictions"])
            for js_variant, py_variant in zip(actual["variants"], python_result["variants"])
        ),
        default=0.0,
    )
    predict_roundtrip_abs = float(wasm_result["predict_roundtrip"]["selected_prediction_abs_max"])
    checks = {
        "pipeline_imported": actual["name"] == PIPELINE["name"],
        "runtime_executed": wasm_result["status"] == "passed" and wasm_result["runtime"] == "javascript_wasm",
        "client_side_only": wasm_result["client_side_only"] is True and wasm_result["backend_api_request_count"] == 0,
        "finite_predictions": _finite(js_selected["predictions"]),
        "prediction_delta_within_tolerance": prediction_delta <= TOLERANCE,
        "target_delta_within_tolerance": target_delta <= TOLERANCE,
        "rmse_delta_within_tolerance": rmse_delta <= TOLERANCE,
        "variant_rmse_delta_within_tolerance": variant_rmse_delta <= TOLERANCE,
        "variant_prediction_delta_within_tolerance": variant_prediction_delta <= TOLERANCE,
        "predict_roundtrip_within_tolerance": predict_roundtrip_abs <= TOLERANCE,
    }
    if not all(checks.values()):
        raise AssertionError(f"formats/IO core Web import parity failed for {fixture['dataset_id']}: {checks}")
    return {
        "dataset_id": fixture["dataset_id"],
        "status": "passed",
        "feature_policy": fixture["feature_policy"],
        "source_count": int(fixture["source_count"]),
        "rows": int(fixture["rows"]),
        "cols": int(fixture["cols"]),
        "manifest_root": fixture["manifest_root"],
        "dataset_fixture_sha256": _stable_hash(fixture),
        "pipeline_sha256": _stable_hash(PIPELINE),
        "runtime": {
            "surface": "javascript_wasm",
            "core_package": wasm_result["core_package"],
            "core_entrypoint": wasm_result["core_entrypoint"],
            "predict_entrypoint": wasm_result["predict_entrypoint"],
            "methods_version": wasm_result["methods_version"],
            "node": wasm_result["node"],
            "client_side_only": True,
            "backend_api_request_count": 0,
        },
        "comparison": {
            "status": "passed",
            "tolerance": TOLERANCE,
            "prediction_max_abs_delta": prediction_delta,
            "target_max_abs_delta": target_delta,
            "rmse_delta": rmse_delta,
            "variant_rmse_max_abs_delta": variant_rmse_delta,
            "variant_prediction_max_abs_delta": variant_prediction_delta,
            "predict_roundtrip_abs_max": predict_roundtrip_abs,
        },
        "checks": checks,
        "prediction_count": len(js_selected["predictions"]),
        "selected_n_components": int(js_selected["n_components"]),
    }


def build_evidence(artifacts_dir: Path) -> dict[str, Any]:
    ledger_path = artifacts_dir / "assembled-datasets.json"
    ledger = _read_json(ledger_path)
    if ledger.get("scenario") != SCENARIO_ID:
        raise AssertionError(f"unexpected assembled ledger scenario: {ledger.get('scenario')}")
    cases = []
    for item in ledger.get("datasets") or []:
        fixture = item.get("web_core_fixture")
        if not isinstance(fixture, dict):
            raise AssertionError(f"{item.get('dataset_id')}: missing web_core_fixture")
        cases.append(_case_evidence(fixture, artifacts_dir))
    if len(cases) < 2:
        raise AssertionError("formats/IO core Web import requires at least two assembled dataset fixtures")
    comparison_summary = {
        "tolerance": TOLERANCE,
        "prediction_max_abs_delta": max(case["comparison"]["prediction_max_abs_delta"] for case in cases),
        "target_max_abs_delta": max(case["comparison"]["target_max_abs_delta"] for case in cases),
        "rmse_delta": max(case["comparison"]["rmse_delta"] for case in cases),
        "variant_prediction_max_abs_delta": max(case["comparison"]["variant_prediction_max_abs_delta"] for case in cases),
        "variant_rmse_max_abs_delta": max(case["comparison"]["variant_rmse_max_abs_delta"] for case in cases),
        "predict_roundtrip_abs_max": max(case["comparison"]["predict_roundtrip_abs_max"] for case in cases),
    }
    return {
        "schema_version": "n4a.e2e.formats_io_core_web_import.v1",
        "scenario_id": SCENARIO_ID,
        "status": "passed",
        "assembled_ledger": str(ledger_path),
        "assembled_ledger_sha256": _sha256(ledger_path),
        "dataset_count": len(cases),
        "executed_dataset_ids": [case["dataset_id"] for case in cases],
        "feature_policies": sorted({case["feature_policy"] for case in cases}),
        "pipeline": PIPELINE,
        "comparison_summary": comparison_summary,
        "cases": cases,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts-dir", type=Path, required=True)
    args = parser.parse_args()
    evidence = build_evidence(args.artifacts_dir)
    _write_json(args.artifacts_dir / OUTPUT_ARTIFACT, evidence)


if __name__ == "__main__":
    main()
