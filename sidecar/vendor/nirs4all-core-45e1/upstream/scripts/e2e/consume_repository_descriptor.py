#!/usr/bin/env python3
"""Consume a repository-served pipeline through nirs4all-core bindings."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


PIPELINE_ARTIFACT = "repository-pipeline.n4a.json"
RESOLUTION_ARTIFACT = "provider-resolution.json"
OUTPUT_ARTIFACT = "cross-language-consumption.json"
EXECUTION_TOLERANCE = 1e-10


def _core_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _workspace_root() -> Path:
    return _core_root().parent


def _methods_root() -> Path:
    configured = os.environ.get("NIRS4ALL_METHODS_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    return _workspace_root() / "nirs4all-methods"


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _ensure_python_paths() -> None:
    src = _core_root() / "bindings" / "python" / "src"
    methods_src = _workspace_root() / "nirs4all-methods" / "bindings" / "python" / "src"
    for path in (src, methods_src):
        src_text = str(path)
        if path.is_dir() and src_text not in sys.path:
            sys.path.insert(0, src_text)


def _stable_hash(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _load_python(pipeline_path: Path) -> dict[str, Any]:
    _ensure_python_paths()

    import nirs4all_core as n4a

    definition = n4a.load_pipeline_definition(pipeline_path)
    return {
        "surface": "bindings/python",
        "status": "passed",
        "name": definition.name,
        "random_state": definition.random_state,
        "classes": n4a.portable_class_names(definition),
        "pipeline": definition.as_dict(),
    }


def _find_node() -> Path | None:
    candidates = [
        shutil.which("node"),
        "/mnt/c/Program Files/nodejs/node.exe",
    ]
    nvm_root = Path.home() / ".nvm" / "versions" / "node"
    if nvm_root.is_dir():
        candidates.extend(str(path) for path in sorted(nvm_root.glob("*/bin/node"), reverse=True))
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    return None


def _node_arg(path: Path, node: Path) -> str:
    if node.suffix.lower() != ".exe":
        return str(path)
    try:
        proc = subprocess.run(
            ["wslpath", "-w", str(path)],
            text=True,
            capture_output=True,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return str(path)
    return proc.stdout.strip()


def _load_javascript_wasm(pipeline_path: Path) -> dict[str, Any]:
    node = _find_node()
    if node is None:
        raise RuntimeError("Node.js runtime not found; cannot validate the JavaScript/WASM binding surface")

    module_path = _core_root() / "bindings" / "wasm" / "src" / "index.js"
    code = """
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = process.argv[1];
const pipelinePath = process.argv[2];
const nirs4all = await import(pathToFileURL(modulePath).href);
const source = readFileSync(pipelinePath, 'utf8');
const definition = nirs4all.loadPipelineDefinition(source);
console.log(JSON.stringify({
  surface: 'bindings/wasm',
  status: 'passed',
  node: process.version,
  name: definition.name,
  random_state: definition.random_state ?? null,
  classes: nirs4all.portableClassNames(definition),
  pipeline: definition,
}));
"""
    proc = subprocess.run(
        [
            str(node),
            "--input-type=module",
            "-e",
            code,
            _node_arg(module_path, node),
            _node_arg(pipeline_path, node),
        ],
        text=True,
        capture_output=True,
        check=False,
        timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"node exited with {proc.returncode}")
    return _read_json_from_text(proc.stdout)


def _read_json_from_text(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if not stripped:
        raise RuntimeError("JavaScript/WASM loader emitted no JSON")
    return json.loads(stripped.splitlines()[-1])


def _as_float_list(values: Any) -> list[float]:
    return [float(value) for value in list(values or [])]


def _as_int_list(values: Any) -> list[int]:
    return [int(value) for value in list(values or [])]


def _max_abs_diff(actual: list[Any], expected: list[Any]) -> float:
    if len(actual) != len(expected):
        raise AssertionError(f"length mismatch: {len(actual)} != {len(expected)}")
    return max((abs(float(a) - float(e)) for a, e in zip(actual, expected)), default=0.0)


def _variant_evidence(variant: dict[str, Any]) -> dict[str, Any]:
    predictions = _as_float_list(variant.get("predictions"))
    return {
        "n_components": int(variant["n_components"]),
        "rmse": float(variant["rmse"]),
        "prediction_count": len(predictions),
        "predictions": predictions,
    }


def _execution_evidence(surface: str, actual: dict[str, Any], extra: dict[str, Any] | None = None) -> dict[str, Any]:
    split = actual.get("split") or {}
    selected = _variant_evidence(actual["selected"])
    evidence = {
        "surface": surface,
        "status": "passed",
        "name": actual.get("name"),
        "rows": int(actual["rows"]),
        "cols": int(actual["cols"]),
        "split": {
            "kind": split.get("kind"),
            "train_count": len(split.get("trainIndices") or []),
            "test_count": len(split.get("testIndices") or []),
            "trainIndices": _as_int_list(split.get("trainIndices")),
            "testIndices": _as_int_list(split.get("testIndices")),
        },
        "preprocessing": actual.get("preprocessing") or [],
        "variants": [_variant_evidence(variant) for variant in list(actual.get("variants") or [])],
        "selected": selected,
        "target_count": len(actual.get("targets") or []),
        "targets": _as_float_list(actual.get("targets")),
    }
    predict_roundtrip = actual.get("predict_roundtrip")
    if isinstance(predict_roundtrip, dict):
        held_out = _as_float_list(predict_roundtrip.get("held_out_predictions"))
        evidence["predict_roundtrip"] = {
            "rows": int(predict_roundtrip.get("rows", 0)),
            "cols": int(predict_roundtrip.get("cols", 0)),
            "held_out_prediction_count": len(held_out),
            "held_out_predictions": held_out,
            "selected_prediction_abs_max": _max_abs_diff(held_out, selected["predictions"]) if held_out else None,
        }
    if extra:
        evidence.update(extra)
    return evidence


def _run_python_execution(pipeline_path: Path, dataset: dict[str, Any]) -> dict[str, Any]:
    _ensure_python_paths()

    import nirs4all_core as n4a

    actual = n4a.run_portable_pipeline(pipeline_path, dataset)
    return _execution_evidence("bindings/python", actual)


def _find_rscript() -> Path | None:
    candidates = [
        shutil.which("Rscript"),
        "/home/delete/miniconda3/envs/pls4all_r/bin/Rscript",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    return None


def _r_executable(rscript: Path) -> Path | None:
    paired = rscript.with_name("R")
    if paired.exists():
        return paired
    found = shutil.which("R")
    return Path(found) if found else None


def _methods_lib_path() -> Path | None:
    lib_dir = _methods_root() / "build" / "dev-release" / "cpp" / "src"
    for name in ("libn4m.so", "libn4m.dylib", "n4m.dll", "libn4m.dll"):
        candidate = lib_dir / name
        if candidate.exists():
            return candidate
    return None


def _prepend_env_path(env: dict[str, str], key: str, value: Path) -> None:
    current = env.get(key)
    env[key] = str(value) + (os.pathsep + current if current else "")


def _prepend_r_library_env(env: dict[str, str], library: Path) -> None:
    _prepend_env_path(env, "R_LIBS", library)
    if env.get("R_LIBS_USER"):
        _prepend_env_path(env, "R_LIBS_USER", library)


def _prepend_methods_lib_env(env: dict[str, str], lib_dir: Path) -> None:
    for key in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH", "PATH"):
        _prepend_env_path(env, key, lib_dir)


def _write_r_makevars(artifacts_dir: Path) -> Path:
    makevars = artifacts_dir / "r-Makevars"
    makevars.write_text(
        "CC=gcc\n"
        "CXX=g++\n"
        "CXX11=g++\n"
        "CXX14=g++\n"
        "CXX17=g++\n"
        "CXX17STD=-std=gnu++17\n",
        encoding="utf-8",
    )
    return makevars


def _prepare_r_execution_library(artifacts_dir: Path, rscript: Path) -> tuple[Path | None, str | None]:
    r_cmd = _r_executable(rscript)
    if r_cmd is None:
        return None, "R is not available on PATH or next to Rscript."
    methods_root = _methods_root()
    methods_r = methods_root / "bindings" / "r" / "n4m"
    generated_dir = methods_root / "build" / "dev-release" / "generated"
    include_dir = methods_root / "cpp" / "include"
    if not methods_r.is_dir():
        return None, f"nirs4all-methods R binding not found at {methods_r}"
    methods_lib = _methods_lib_path()
    if methods_lib is None:
        return None, f"libn4m dev-release build not found under {methods_root / 'build' / 'dev-release' / 'cpp' / 'src'}"

    r_lib = artifacts_dir / "_r-lib"
    r_lib.mkdir(parents=True, exist_ok=True)
    makevars = _write_r_makevars(artifacts_dir)
    env = os.environ.copy()
    env.update(
        {
            "N4M_R_LINK_PREBUILT": "1",
            "N4M_LIB_DIR": str(methods_lib.parent),
            "N4M_GENERATED_DIR": str(generated_dir),
            "N4M_INCLUDE_DIR": str(include_dir),
            "R_MAKEVARS_USER": str(makevars),
            "NIRS4ALL_CORE_R_PARITY_LIB": str(r_lib),
        }
    )
    _prepend_r_library_env(env, r_lib)
    _prepend_methods_lib_env(env, methods_lib.parent)
    commands = [
        [
            str(r_cmd),
            "CMD",
            "INSTALL",
            "--preclean",
            f"--library={r_lib}",
            "--no-multiarch",
            "--no-staged-install",
            str(methods_r),
        ],
        [str(r_cmd), "CMD", "INSTALL", f"--library={r_lib}", str(_core_root() / "bindings" / "r")],
    ]
    for command in commands:
        completed = subprocess.run(
            command,
            cwd=_core_root(),
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if completed.returncode != 0:
            return None, (
                f"R package install failed with exit {completed.returncode}: "
                f"{completed.stderr.strip() or completed.stdout.strip()}"
            )
    return r_lib, None


def _run_r_execution(pipeline_path: Path, dataset: dict[str, Any]) -> dict[str, Any]:
    rscript = _find_rscript()
    if rscript is None:
        raise RuntimeError("Rscript runtime not found; cannot execute the R binding surface")
    r_lib, setup_error = _prepare_r_execution_library(pipeline_path.parent, rscript)
    if setup_error is not None:
        raise RuntimeError(setup_error)

    code = r"""
args <- commandArgs(trailingOnly = TRUE)
core_root <- normalizePath(args[[1]], mustWork = TRUE)
pipeline_path <- normalizePath(args[[2]], mustWork = TRUE)
dataset_path <- normalizePath(args[[3]], mustWork = TRUE)
output_path <- args[[4]]
scenario_lib <- args[[5]]

if (nzchar(scenario_lib) && dir.exists(scenario_lib)) {
  .libPaths(c(normalizePath(scenario_lib, winslash = "/", mustWork = TRUE), .libPaths()))
}
if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("jsonlite is required to execute the nirs4all-core R provider/repository parity path", call. = FALSE)
}
if (!requireNamespace("n4m", quietly = TRUE)) {
  stop("n4m R package is not installed; strict repository/provider execution requires the nirs4all-methods R binding", call. = FALSE)
}
expected_n4m_lib <- Sys.getenv("NIRS4ALL_CORE_R_PARITY_LIB")
if (nzchar(expected_n4m_lib)) {
  expected_n4m_lib <- normalizePath(expected_n4m_lib, winslash = "/", mustWork = TRUE)
  actual_n4m_lib <- normalizePath(find.package("n4m"), winslash = "/", mustWork = TRUE)
  if (!startsWith(actual_n4m_lib, expected_n4m_lib)) {
    stop(sprintf("n4m loaded from %s instead of scenario R library %s", actual_n4m_lib, expected_n4m_lib), call. = FALSE)
  }
}

if (requireNamespace("nirs4all", quietly = TRUE)) {
  run_portable <- nirs4all::nirs4all_run_portable_pipeline
  nirs4all_version <- as.character(utils::packageVersion("nirs4all"))
} else {
  r_dir <- file.path(core_root, "bindings", "r", "R")
  source(file.path(r_dir, "upstreams.R"))
  source(file.path(r_dir, "pipeline.R"))
  source(file.path(r_dir, "execution.R"))
  run_portable <- nirs4all_run_portable_pipeline
  nirs4all_version <- NULL
}

dataset <- jsonlite::fromJSON(dataset_path, simplifyVector = FALSE)
actual <- run_portable(pipeline_path, dataset)
payload <- list(
  r = R.version.string,
  nirs4all = nirs4all_version,
  n4m = if (requireNamespace("n4m", quietly = TRUE)) as.character(utils::packageVersion("n4m")) else NULL,
  actual = actual
)
jsonlite::write_json(payload, output_path, auto_unbox = TRUE, pretty = TRUE, digits = NA)
"""
    with tempfile.TemporaryDirectory(prefix="n4a-provider-r-") as tmp:
        tmp_dir = Path(tmp)
        dataset_path = tmp_dir / "dataset.json"
        output_path = tmp_dir / "r-result.json"
        _write_json(dataset_path, dataset)
        env = os.environ.copy()
        if r_lib is not None:
            _prepend_r_library_env(env, r_lib)
            env["NIRS4ALL_CORE_R_PARITY_LIB"] = str(r_lib)
        methods_lib = _methods_lib_path()
        if methods_lib is not None:
            _prepend_methods_lib_env(env, methods_lib.parent)
        proc = subprocess.run(
            [
                str(rscript),
                "--vanilla",
                "-e",
                code,
                str(_core_root()),
                str(pipeline_path),
                str(dataset_path),
                str(output_path),
                str(r_lib or ""),
            ],
            text=True,
            capture_output=True,
            check=False,
            timeout=60,
            env=env,
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or f"Rscript exited with {proc.returncode}")
        payload = _read_json(output_path)
    return _execution_evidence(
        "bindings/r",
        payload["actual"],
        {
            "r": payload.get("r"),
            "nirs4all": payload.get("nirs4all"),
            "n4m": payload.get("n4m"),
        },
    )


def _methods_js_index() -> tuple[Path | None, str]:
    if os.environ.get("NIRS4ALL_METHODS_JS_DIST"):
        dist = Path(os.environ["NIRS4ALL_METHODS_JS_DIST"])
        source = "NIRS4ALL_METHODS_JS_DIST"
    elif os.environ.get("NIRS4ALL_METHODS_ROOT"):
        dist = Path(os.environ["NIRS4ALL_METHODS_ROOT"]) / "bindings" / "js" / "dist"
        source = "NIRS4ALL_METHODS_ROOT"
    else:
        dist = _workspace_root() / "nirs4all-methods" / "bindings" / "js" / "dist"
        source = "default sibling nirs4all-methods"

    required = ("index.js", "n4m.js", "n4m.wasm")
    missing = [name for name in required if not (dist / name).exists()]
    if missing:
        return None, f"local nirs4all-methods JS/WASM build is unavailable from {source}: {dist}; missing {', '.join(missing)}"
    return dist / "index.js", source


def _run_javascript_wasm_execution(pipeline_path: Path, dataset: dict[str, Any]) -> dict[str, Any]:
    node = _find_node()
    if node is None:
        raise RuntimeError("Node.js runtime not found; cannot execute the JavaScript/WASM binding surface")
    methods_index, methods_source = _methods_js_index()
    if methods_index is None:
        raise RuntimeError(methods_source)

    module_path = _core_root() / "bindings" / "wasm" / "src" / "index.js"
    code = """
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = process.argv[1];
const methodsPath = process.argv[2];
const pipelinePath = process.argv[3];
const dataset = JSON.parse(process.argv[4]);
const nirs4all = await import(pathToFileURL(modulePath).href);
const methods = await import(pathToFileURL(methodsPath).href);
if (typeof methods.loadModule === 'function') {
  await methods.loadModule();
}
const source = readFileSync(pipelinePath, 'utf8');
const actual = await nirs4all.runPortablePipeline(source, {
  X: Float64Array.from(dataset.X.flat()),
  y: Float64Array.from(dataset.y),
  rows: dataset.rows,
  cols: dataset.cols,
}, { methods });
const predicted = await nirs4all.predictPortablePipeline(actual, {
  X: Float64Array.from(dataset.X.flat()),
  rows: dataset.rows,
  cols: dataset.cols,
}, { methods });
actual.predict_roundtrip = {
  rows: predicted.rows,
  cols: predicted.cols,
  held_out_predictions: actual.split.testIndices.map((index) => predicted.data[index]),
};
console.log(JSON.stringify({
  node: process.version,
  actual,
}));
"""
    proc = subprocess.run(
        [
            str(node),
            "--input-type=module",
            "-e",
            code,
            _node_arg(module_path, node),
            _node_arg(methods_index, node),
            _node_arg(pipeline_path, node),
            json.dumps(dataset, ensure_ascii=True, sort_keys=True),
        ],
        text=True,
        capture_output=True,
        check=False,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or f"node exited with {proc.returncode}")
    payload = _read_json_from_text(proc.stdout)
    return _execution_evidence("bindings/wasm", payload["actual"], {"node": payload.get("node")})


def _strict_prediction_comparison(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    split_match = {
        "kind": left["split"].get("kind") == right["split"].get("kind"),
        "train_indices": left["split"].get("trainIndices") == right["split"].get("trainIndices"),
        "test_indices": left["split"].get("testIndices") == right["split"].get("testIndices"),
    }
    preprocessing_match = left.get("preprocessing") == right.get("preprocessing")
    selected_n_components_match = int(left["selected"]["n_components"]) == int(right["selected"]["n_components"])
    targets_abs_max = _max_abs_diff(left["targets"], right["targets"])

    left_variants = list(left.get("variants") or [])
    right_variants = list(right.get("variants") or [])
    if len(left_variants) != len(right_variants):
        raise AssertionError(f"execution variant count mismatch: {len(left_variants)} != {len(right_variants)}")

    prediction_abs_max = 0.0
    rmse_abs_max = 0.0
    variants = []
    for left_variant, right_variant in zip(left_variants, right_variants):
        n_components_match = int(left_variant["n_components"]) == int(right_variant["n_components"])
        prediction_abs = _max_abs_diff(left_variant["predictions"], right_variant["predictions"])
        rmse_abs = abs(float(left_variant["rmse"]) - float(right_variant["rmse"]))
        prediction_abs_max = max(prediction_abs_max, prediction_abs)
        rmse_abs_max = max(rmse_abs_max, rmse_abs)
        variants.append(
            {
                "n_components": int(left_variant["n_components"]),
                "n_components_match": n_components_match,
                "prediction_abs_max": prediction_abs,
                "rmse_abs": rmse_abs,
            }
        )

    predict_roundtrip_abs_max = None
    right_roundtrip = right.get("predict_roundtrip") or {}
    if right_roundtrip.get("held_out_predictions"):
        predict_roundtrip_abs_max = _max_abs_diff(right_roundtrip["held_out_predictions"], right["selected"]["predictions"])

    passed = (
        all(split_match.values())
        and preprocessing_match
        and selected_n_components_match
        and targets_abs_max <= EXECUTION_TOLERANCE
        and prediction_abs_max <= EXECUTION_TOLERANCE
        and rmse_abs_max <= EXECUTION_TOLERANCE
        and all(item["n_components_match"] for item in variants)
        and (predict_roundtrip_abs_max is None or predict_roundtrip_abs_max <= EXECUTION_TOLERANCE)
    )
    return {
        "status": "passed" if passed else "failed",
        "surfaces": [left["surface"], right["surface"]],
        "tolerance": EXECUTION_TOLERANCE,
        "split_match": split_match,
        "preprocessing_match": preprocessing_match,
        "selected_n_components_match": selected_n_components_match,
        "targets_abs_max": targets_abs_max,
        "prediction_abs_max": prediction_abs_max,
        "rmse_abs_max": rmse_abs_max,
        "predict_roundtrip_abs_max": predict_roundtrip_abs_max,
        "variants": variants,
    }


def _execution_dataset_from_provider_resolution(resolution: dict[str, Any]) -> dict[str, Any]:
    dataset = ((resolution.get("dataset") or {}).get("execution_dataset") or {})
    if not isinstance(dataset, dict):
        raise AssertionError("provider resolution must include dataset.execution_dataset")
    required = ("X", "y", "rows", "cols")
    missing = [key for key in required if key not in dataset]
    if missing:
        raise AssertionError(f"provider execution dataset is missing required field(s): {', '.join(missing)}")
    rows = int(dataset["rows"])
    cols = int(dataset["cols"])
    if rows <= 0 or cols <= 0:
        raise AssertionError("provider execution dataset must have positive rows and cols")
    if len(dataset["X"]) != rows or len(dataset["y"]) != rows:
        raise AssertionError("provider execution dataset row counts do not match rows/y")
    if any(len(row) != cols for row in dataset["X"]):
        raise AssertionError("provider execution dataset feature rows do not match cols")
    expected_sha = (resolution.get("dataset") or {}).get("execution_dataset_sha256")
    actual_sha = _stable_hash(dataset)
    if expected_sha and expected_sha != actual_sha:
        raise AssertionError("provider execution dataset sha256 does not match resolution metadata")
    return dataset


def _runtime_execution(pipeline_path: Path, resolution: dict[str, Any]) -> dict[str, Any]:
    dataset = _execution_dataset_from_provider_resolution(resolution)
    runtime_results = []
    runtime_errors = []
    for surface, runner in (
        ("bindings/python", _run_python_execution),
        ("bindings/r", _run_r_execution),
        ("bindings/wasm", _run_javascript_wasm_execution),
    ):
        try:
            runtime_results.append(runner(pipeline_path, dataset))
        except Exception as exc:
            runtime_errors.append({"surface": surface, "reason": str(exc)})

    if runtime_errors:
        raise AssertionError(f"repository pipeline execution failed on required runtime surface(s): {runtime_errors}")

    python_result = next((result for result in runtime_results if result["surface"] == "bindings/python"), None)
    r_result = next((result for result in runtime_results if result["surface"] == "bindings/r"), None)
    wasm_result = next((result for result in runtime_results if result["surface"] == "bindings/wasm"), None)
    if python_result is None or r_result is None or wasm_result is None:
        raise AssertionError("repository pipeline execution requires Python, R, and JavaScript/WASM runtime evidence")

    comparisons = {
        "python_vs_r": _strict_prediction_comparison(python_result, r_result),
        "python_vs_wasm": _strict_prediction_comparison(python_result, wasm_result),
        "r_vs_wasm": _strict_prediction_comparison(r_result, wasm_result),
    }
    failures = {name: comparison for name, comparison in comparisons.items() if comparison["status"] != "passed"}
    if failures:
        raise AssertionError(f"Repository pipeline execution diverged across runtime surfaces: {failures}")

    return {
        "status": "passed",
        "dataset": {
            "kind": dataset.get("kind", "provider_materialized_dataset"),
            "rows": dataset["rows"],
            "cols": dataset["cols"],
            "target_count": len(dataset["y"]),
            "sha256": _stable_hash(dataset),
            "provider_resolution_sha256": (resolution.get("dataset") or {}).get("execution_dataset_sha256"),
            "source_csv_sha256": (resolution.get("dataset") or {}).get("execution_dataset_csv_sha256"),
            "io_package_summary_sha256": (resolution.get("dataset") or {}).get("io_package_summary_sha256"),
        },
        "runtime_results": runtime_results,
        "comparison": comparisons["python_vs_wasm"],
        "comparisons": comparisons,
    }


def consume(artifacts_dir: Path) -> dict[str, Any]:
    pipeline_path = artifacts_dir / PIPELINE_ARTIFACT
    resolution_path = artifacts_dir / RESOLUTION_ARTIFACT
    if not pipeline_path.is_file():
        raise FileNotFoundError(f"missing repository pipeline artifact: {pipeline_path}")
    if not resolution_path.is_file():
        raise FileNotFoundError(f"missing provider resolution artifact: {resolution_path}")

    resolution = _read_json(resolution_path)
    python = _load_python(pipeline_path)
    javascript_wasm = _load_javascript_wasm(pipeline_path)
    execution = _runtime_execution(pipeline_path, resolution)

    parity = {
        "classes_match": python["classes"] == javascript_wasm["classes"],
        "random_state_match": python["random_state"] == javascript_wasm["random_state"],
        "name_match": python["name"] == javascript_wasm["name"],
    }
    if not all(parity.values()):
        raise AssertionError(f"Python and JavaScript/WASM repository consumption diverged: {parity}")

    return {
        "schema_version": "n4a.e2e.repository-consumption/v1",
        "status": "passed",
        "pipeline_id": resolution["repository"]["pipeline_id"],
        "repository_index_count": resolution["repository"]["catalog_count"],
        "source_artifacts": {
            "provider_resolution": str(resolution_path),
            "repository_pipeline": str(pipeline_path),
        },
        "python": python,
        "javascript_wasm": javascript_wasm,
        "parity": parity,
        "execution": execution,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts-dir", type=Path, required=True)
    args = parser.parse_args(argv)

    artifacts_dir = args.artifacts_dir.expanduser().resolve()
    result = consume(artifacts_dir)
    _write_json(artifacts_dir / OUTPUT_ARTIFACT, result)
    print(json.dumps(result["parity"], ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
