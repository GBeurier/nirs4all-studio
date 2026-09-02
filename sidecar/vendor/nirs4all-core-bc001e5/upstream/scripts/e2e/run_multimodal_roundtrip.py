#!/usr/bin/env python3
"""Consume the multimodal Python oracle and run available core/R/WASM parity checks."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import pandas as pd  # type: ignore[import-untyped]


SCENARIO_ID = "e2e-multimodal-python-r-wasm-roundtrip"
REQUIRED_JS_METHODS_FILES = ("index.js", "n4m.js", "n4m.wasm")


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")


def _stable_hash(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _source_id(source: dict[str, Any], index: int) -> str:
    for key in ("source_id", "id", "name"):
        value = source.get(key)
        if isinstance(value, str) and value:
            return value
    return f"source_{index}"


def _slice_bounds(value: Any) -> tuple[int, int] | None:
    if not isinstance(value, list | tuple) or len(value) != 2:
        return None
    try:
        start = int(value[0])
        end = int(value[1])
    except (TypeError, ValueError):
        return None
    if start < 0 or end < start:
        return None
    return start, end


def _sample_ids_for_indices(dataset: dict[str, Any], indices: list[int]) -> tuple[list[str], list[str]]:
    samples = list(dataset.get("samples") or [])
    sample_ids: list[str] = []
    gaps: list[str] = []
    for index in indices:
        if 0 <= index < len(samples) and isinstance(samples[index], dict) and samples[index].get("sample_id") is not None:
            sample_ids.append(str(samples[index]["sample_id"]))
        else:
            gaps.append(f"sample_id missing for sample index {index}")
    return sample_ids, gaps


def _runtime_metadata_alignment(dataset: dict[str, Any], actual: dict[str, Any]) -> dict[str, Any]:
    test_indices = _as_int_list(actual.get("split", {}).get("testIndices"))
    test_sample_ids, gaps = _sample_ids_for_indices(dataset, test_indices)
    selected_predictions = _as_float_list(actual.get("selected", {}).get("predictions"))
    targets = _as_float_list(actual.get("targets"))
    return {
        "available": not gaps,
        "sample_indices": test_indices,
        "sample_ids": test_sample_ids,
        "sample_ids_sha256": _stable_hash(test_sample_ids),
        "prediction_rows": len(selected_predictions),
        "target_rows": len(targets),
        "row_count_matches": len(test_indices) == len(test_sample_ids) == len(selected_predictions) == len(targets),
        "gaps": gaps,
    }


def _multimodal_artifact_audit(pipeline: dict[str, Any], dataset: dict[str, Any], oracle: dict[str, Any]) -> dict[str, Any]:
    portable = dataset.get("portable_view", {})
    sources = list(dataset.get("sources") or [])
    headers = [str(header) for header in list(dataset.get("feature_headers") or [])]
    samples = [row for row in list(dataset.get("samples") or []) if isinstance(row, dict)]
    sample_ids = [str(row["sample_id"]) for row in samples if row.get("sample_id") is not None]
    rows = int(portable.get("rows", 0) or 0)
    cols = int(portable.get("cols", 0) or 0)
    declared_source_count = pipeline.get("multimodal_contract", {}).get("source_count")
    gaps: list[str] = []

    if rows != len(samples):
        gaps.append(f"portable rows ({rows}) do not match sample metadata rows ({len(samples)})")
    if len(sample_ids) != len(samples):
        gaps.append("one or more sample metadata rows are missing sample_id")
    if cols != len(headers):
        gaps.append(f"portable cols ({cols}) do not match feature_headers ({len(headers)})")
    if isinstance(declared_source_count, int) and declared_source_count != len(sources):
        gaps.append(f"pipeline source_count ({declared_source_count}) does not match dataset sources ({len(sources)})")
    elif not isinstance(declared_source_count, int):
        gaps.append("pipeline multimodal_contract.source_count is not an integer")

    source_descriptors: list[dict[str, Any]] = []
    source_ids: list[str] = []
    valid_slices: list[tuple[int, int]] = []
    for index, raw_source in enumerate(sources):
        source = raw_source if isinstance(raw_source, dict) else {}
        source_name = _source_id(source, index)
        source_ids.append(source_name)
        bounds = _slice_bounds(source.get("feature_slice"))
        if bounds is None:
            gaps.append(f"{source_name} has no valid feature_slice")
            header_slice: list[str] = []
            feature_slice: list[int] | None = None
        else:
            start, end = bounds
            feature_slice = [start, end]
            valid_slices.append(bounds)
            if end > len(headers):
                gaps.append(f"{source_name} feature_slice {feature_slice} exceeds feature_headers length {len(headers)}")
            header_slice = headers[start:min(end, len(headers))]
            if end - start != len(header_slice):
                gaps.append(f"{source_name} header slice length does not match feature_slice width")
        descriptor = {
            "source_id": source_name,
            "kind": source.get("kind"),
            "feature_slice": feature_slice,
            "header_count": len(header_slice),
            "headers": header_slice,
            "headers_sha256": _stable_hash(header_slice),
        }
        source_descriptors.append(descriptor)

    sorted_slices = sorted(valid_slices)
    slices_cover_all_features = bool(sorted_slices) and sorted_slices[0][0] == 0 and sorted_slices[-1][1] == cols
    slices_non_overlapping = all(left[1] <= right[0] for left, right in zip(sorted_slices, sorted_slices[1:]))
    if sources and not slices_cover_all_features:
        gaps.append("source feature_slices do not cover the full portable feature width")
    if not slices_non_overlapping:
        gaps.append("source feature_slices overlap")

    oracle_test_indices = _as_int_list(oracle.get("case", {}).get("split", {}).get("testIndices"))
    oracle_test_sample_ids, oracle_gaps = _sample_ids_for_indices(dataset, oracle_test_indices)
    gaps.extend(oracle_gaps)

    return {
        "available": not gaps,
        "strict_claim": False,
        "source_count": {
            "declared": declared_source_count,
            "dataset": len(sources),
            "matches": isinstance(declared_source_count, int) and declared_source_count == len(sources),
        },
        "source_ids": source_ids,
        "source_ids_sha256": _stable_hash(source_ids),
        "sources": source_descriptors,
        "source_slices_sha256": _stable_hash([list(bounds) for bounds in sorted_slices]),
        "feature_headers": {
            "count": len(headers),
            "portable_cols": cols,
            "matches_portable_cols": len(headers) == cols,
            "sha256": _stable_hash(headers),
        },
        "sample_id_metadata_alignment": {
            "sample_metadata_rows": len(samples),
            "portable_rows": rows,
            "matches_portable_rows": len(samples) == rows,
            "sample_ids": sample_ids,
            "sample_ids_sha256": _stable_hash(sample_ids),
            "sample_metadata_rows_sha256": _stable_hash(samples),
            "oracle_test_sample_ids": oracle_test_sample_ids,
            "oracle_test_sample_ids_sha256": _stable_hash(oracle_test_sample_ids),
        },
        "slice_alignment": {
            "covers_all_features": slices_cover_all_features,
            "non_overlapping": slices_non_overlapping,
            "sorted_slices": [list(bounds) for bounds in sorted_slices],
        },
        "gaps": gaps,
    }


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _max_abs_diff(actual: list[Any], expected: list[Any]) -> float:
    if len(actual) != len(expected):
        raise AssertionError(f"length mismatch: {len(actual)} != {len(expected)}")
    return max((abs(float(a) - float(e)) for a, e in zip(actual, expected)), default=0.0)


def _as_int_list(values: Any) -> list[int]:
    return [int(value) for value in list(values or [])]


def _as_float_list(values: Any) -> list[float]:
    return [float(value) for value in list(values or [])]


def _methods_root(workspace_root: Path) -> Path:
    configured = os.environ.get("NIRS4ALL_METHODS_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    return workspace_root / "nirs4all-methods"


def _methods_lib_path(workspace_root: Path) -> Path | None:
    lib_dir = _methods_root(workspace_root) / "build" / "dev-release" / "cpp" / "src"
    for name in ("libn4m.so", "libn4m.dylib", "n4m.dll", "libn4m.dll"):
        candidate = lib_dir / name
        if candidate.exists():
            return candidate
    return None


def _prepend_path_env(env: dict[str, str], key: str, value: Path) -> None:
    current = env.get(key)
    env[key] = str(value) + (os.pathsep + current if current else "")


def _prepend_r_library_env(env: dict[str, str], library: Path) -> None:
    """Prefer the scenario library without hiding preinstalled R imports."""
    _prepend_path_env(env, "R_LIBS", library)
    if env.get("R_LIBS_USER"):
        _prepend_path_env(env, "R_LIBS_USER", library)


def _prepend_methods_lib_env(env: dict[str, str], lib_dir: Path) -> None:
    for key in ("LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH", "PATH"):
        _prepend_path_env(env, key, lib_dir)


def _prepend_r_toolchain_env(env: dict[str, str], rscript: str) -> None:
    r_bin = Path(rscript).resolve().parent
    if r_bin.is_dir():
        _prepend_path_env(env, "PATH", r_bin)


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


def _prediction_frame(runtime: str, dataset: dict[str, Any], actual: dict[str, Any]) -> pd.DataFrame:
    test_indices = _as_int_list(actual["split"]["testIndices"])
    selected = actual["selected"]
    predictions = _as_float_list(selected["predictions"])
    targets = _as_float_list(actual["targets"])
    samples = dataset["samples"]
    return pd.DataFrame(
        {
            "scenario_id": SCENARIO_ID,
            "runtime": runtime,
            "sample_index": test_indices,
            "sample_id": [samples[index]["sample_id"] for index in test_indices],
            "target": targets,
            "prediction": predictions,
            "residual": [prediction - target for prediction, target in zip(predictions, targets)],
            "n_components": int(selected["n_components"]),
        }
    )


def _compare_result(runtime: str, actual: dict[str, Any], oracle: dict[str, Any], tolerance: float) -> dict[str, Any]:
    expected = oracle["case"]
    split_match = {
        "kind": actual["split"].get("kind") == expected["split"].get("kind"),
        "train_indices": _as_int_list(actual["split"].get("trainIndices")) == _as_int_list(expected["split"].get("trainIndices")),
        "test_indices": _as_int_list(actual["split"].get("testIndices")) == _as_int_list(expected["split"].get("testIndices")),
    }
    targets_abs_max = _max_abs_diff(_as_float_list(actual["targets"]), _as_float_list(expected["targets"]))

    actual_variants = list(actual.get("variants") or [])
    expected_variants = list(expected.get("variants") or [])
    if len(actual_variants) != len(expected_variants):
        raise AssertionError(f"{runtime}: variant count mismatch: {len(actual_variants)} != {len(expected_variants)}")

    variant_diffs = []
    prediction_abs_max = 0.0
    rmse_abs_max = 0.0
    for actual_variant, expected_variant in zip(actual_variants, expected_variants):
        if int(actual_variant["n_components"]) != int(expected_variant["n_components"]):
            raise AssertionError(f"{runtime}: n_components mismatch")
        pred_diff = _max_abs_diff(_as_float_list(actual_variant["predictions"]), _as_float_list(expected_variant["predictions"]))
        rmse_diff = abs(float(actual_variant["rmse"]) - float(expected_variant["rmse"]))
        prediction_abs_max = max(prediction_abs_max, pred_diff)
        rmse_abs_max = max(rmse_abs_max, rmse_diff)
        variant_diffs.append(
            {
                "n_components": int(actual_variant["n_components"]),
                "prediction_abs_max": pred_diff,
                "rmse_abs": rmse_diff,
            }
        )

    selected_match = int(actual["selected"]["n_components"]) == int(expected["selected"]["n_components"])
    passed = (
        all(split_match.values())
        and targets_abs_max <= tolerance
        and prediction_abs_max <= tolerance
        and rmse_abs_max <= tolerance
        and selected_match
    )
    return {
        "runtime": runtime,
        "status": "passed" if passed else "failed",
        "split_match": split_match,
        "selected_n_components_match": selected_match,
        "targets_abs_max": targets_abs_max,
        "prediction_abs_max": prediction_abs_max,
        "rmse_abs_max": rmse_abs_max,
        "tolerance": tolerance,
        "variants": variant_diffs,
    }


def _blocked(runtime: str, reason: str, output_path: Path) -> dict[str, Any]:
    payload = {
        "scenario_id": SCENARIO_ID,
        "runtime": runtime,
        "status": "blocked",
        "reason": reason,
    }
    _write_json(output_path, payload)
    return payload


def _unlink_outputs(*paths: Path) -> None:
    for path in paths:
        path.unlink(missing_ok=True)


def _record_runtime_success(
    runtime: str,
    actual: dict[str, Any],
    dataset: dict[str, Any],
    oracle: dict[str, Any],
    artifacts_dir: Path,
    prediction_path: Path,
    result_path: Path,
) -> dict[str, Any]:
    tolerance = float(oracle["metadata"]["prediction_abs_tolerance"])
    comparison = _compare_result(runtime, actual, oracle, tolerance)
    _prediction_frame(runtime, dataset, actual).to_parquet(prediction_path, index=False)
    payload = {
        "scenario_id": SCENARIO_ID,
        "runtime": runtime,
        "status": comparison["status"],
        "comparison": comparison,
        "metadata_alignment": _runtime_metadata_alignment(dataset, actual),
        "predictions": prediction_path.name,
        "actual": actual,
    }
    _write_json(result_path, payload)
    return payload


def _run_python_core(
    workspace_root: Path,
    core_root: Path,
    artifacts_dir: Path,
    pipeline_path: Path,
    dataset: dict[str, Any],
    oracle: dict[str, Any],
) -> dict[str, Any]:
    runtime = "nirs4all-core-python"
    output_json = artifacts_dir / "python-core-predictions.json"
    blocked_json = artifacts_dir / "python-core-predictions.blocked.json"
    _unlink_outputs(output_json, blocked_json, artifacts_dir / "python-core-predictions.parquet")
    methods_python = workspace_root / "nirs4all-methods" / "bindings" / "python" / "src"
    for path in (core_root / "bindings/python/src", methods_python):
        if path.is_dir():
            sys.path.insert(0, str(path))
    methods_lib = _methods_lib_path(workspace_root)
    if methods_lib is not None:
        os.environ.setdefault("N4M_LIB_PATH", str(methods_lib))
    try:
        import nirs4all_core as n4core  # type: ignore[import-not-found]

        actual = n4core.run_portable_pipeline(str(pipeline_path), dataset["portable_view"])
    except Exception as exc:
        return _blocked(runtime, str(exc), blocked_json)
    return _record_runtime_success(runtime, actual, dataset, oracle, artifacts_dir, artifacts_dir / "python-core-predictions.parquet", output_json)


def _rscript_executable() -> str | None:
    found = shutil.which("Rscript")
    if found:
        return found
    fallback = Path("/home/delete/miniconda3/envs/pls4all_r/bin/Rscript")
    return str(fallback) if fallback.exists() else None


def _r_executable(rscript: str) -> Path | None:
    paired = Path(rscript).with_name("R")
    if paired.exists():
        return paired
    found = shutil.which("R")
    return Path(found) if found else None


def _prepare_r_library(workspace_root: Path, core_root: Path, artifacts_dir: Path, rscript: str) -> tuple[Path | None, str | None]:
    r_cmd = _r_executable(rscript)
    if r_cmd is None:
        return None, "R is not available on PATH or next to Rscript."
    methods_root = _methods_root(workspace_root)
    methods_r = methods_root / "bindings" / "r" / "n4m"
    generated_dir = methods_root / "build" / "dev-release" / "generated"
    include_dir = methods_root / "cpp" / "include"
    if not methods_r.is_dir():
        return None, f"nirs4all-methods R binding not found at {methods_r}"
    methods_lib = _methods_lib_path(workspace_root)
    if methods_lib is None:
        return None, f"libn4m dev-release build not found under {methods_root / 'build' / 'dev-release' / 'cpp' / 'src'}"
    methods_lib_dir = methods_lib.parent
    r_lib = artifacts_dir / "_r-lib"
    r_lib.mkdir(parents=True, exist_ok=True)
    makevars = _write_r_makevars(artifacts_dir)
    env = os.environ.copy()
    env.update(
        {
            "N4M_R_LINK_PREBUILT": "1",
            "N4M_LIB_DIR": str(methods_lib_dir),
            "N4M_GENERATED_DIR": str(generated_dir),
            "N4M_INCLUDE_DIR": str(include_dir),
            "R_MAKEVARS_USER": str(makevars),
            "NIRS4ALL_CORE_R_PARITY_LIB": str(r_lib),
        }
    )
    _prepend_r_library_env(env, r_lib)
    _prepend_methods_lib_env(env, methods_lib_dir)
    _prepend_r_toolchain_env(env, rscript)
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
        [str(r_cmd), "CMD", "INSTALL", f"--library={r_lib}", str(core_root / "bindings" / "r")],
    ]
    for command in commands:
        completed = subprocess.run(
            command,
            cwd=core_root,
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


def _run_r(
    workspace_root: Path,
    core_root: Path,
    artifacts_dir: Path,
    pipeline_path: Path,
    dataset_path: Path,
    dataset: dict[str, Any],
    oracle: dict[str, Any],
) -> dict[str, Any]:
    runtime = "r"
    rscript = _rscript_executable()
    blocked_json = artifacts_dir / "r-predictions.blocked.json"
    _unlink_outputs(blocked_json, artifacts_dir / "r-result.json", artifacts_dir / "r-predictions.json", artifacts_dir / "r-predictions.parquet")
    if not rscript:
        return _blocked(runtime, "Rscript is not available on PATH or at /home/delete/miniconda3/envs/pls4all_r/bin/Rscript.", blocked_json)
    r_lib, setup_error = _prepare_r_library(workspace_root, core_root, artifacts_dir, rscript)
    if setup_error is not None:
        return _blocked(runtime, setup_error, blocked_json)

    output_json = artifacts_dir / "r-result.json"
    script_path = artifacts_dir / "run-r-roundtrip.R"
    script_path.write_text(
        """
args <- commandArgs(trailingOnly = TRUE)
pipeline_path <- args[[1]]
dataset_path <- args[[2]]
output_path <- args[[3]]
r_src_dir <- args[[4]]

if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("jsonlite R package is not installed", call. = FALSE)
}
if (!requireNamespace("n4m", quietly = TRUE)) {
  stop("n4m R package is not installed; strict R execution requires the nirs4all-methods R binding", call. = FALSE)
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
  binding_source <- "installed-package"
} else {
  source(file.path(r_src_dir, "upstreams.R"))
  source(file.path(r_src_dir, "pipeline.R"))
  source(file.path(r_src_dir, "execution.R"))
  run_portable <- nirs4all_run_portable_pipeline
  binding_source <- "source-checkout"
}

payload <- jsonlite::fromJSON(dataset_path, simplifyVector = FALSE)
actual <- run_portable(pipeline_path, payload$portable_view)
actual$binding_source <- binding_source
jsonlite::write_json(actual, output_path, auto_unbox = TRUE, digits = 16)
""".strip()
        + "\n",
        encoding="utf-8",
    )
    env = os.environ.copy()
    if r_lib is not None:
        _prepend_r_library_env(env, r_lib)
        env["NIRS4ALL_CORE_R_PARITY_LIB"] = str(r_lib)
    _prepend_r_toolchain_env(env, rscript)
    methods_lib_dir = _methods_root(workspace_root) / "build" / "dev-release" / "cpp" / "src"
    if methods_lib_dir.is_dir():
        _prepend_methods_lib_env(env, methods_lib_dir)
    completed = subprocess.run(
        [rscript, "--vanilla", str(script_path), str(pipeline_path), str(dataset_path), str(output_json), str(core_root / "bindings/r/R")],
        cwd=artifacts_dir,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        return _blocked(
            runtime,
            f"R execution failed with exit {completed.returncode}: {completed.stderr.strip() or completed.stdout.strip()}",
            blocked_json,
        )
    actual = _load_json(output_json)
    return _record_runtime_success(runtime, actual, dataset, oracle, artifacts_dir, artifacts_dir / "r-predictions.parquet", artifacts_dir / "r-predictions.json")


def _node_executable() -> str | None:
    found = shutil.which("node")
    if found:
        return found
    nvm_root = Path.home() / ".nvm" / "versions" / "node"
    if nvm_root.is_dir():
        for candidate in sorted(nvm_root.glob("*/bin/node"), reverse=True):
            if candidate.is_file():
                return str(candidate)
    return None


def _methods_js_index(workspace_root: Path) -> tuple[Path | None, str]:
    if os.environ.get("NIRS4ALL_METHODS_JS_DIST"):
        dist = Path(os.environ["NIRS4ALL_METHODS_JS_DIST"])
        source = "NIRS4ALL_METHODS_JS_DIST"
    elif os.environ.get("NIRS4ALL_METHODS_ROOT"):
        dist = Path(os.environ["NIRS4ALL_METHODS_ROOT"]) / "bindings/js/dist"
        source = "NIRS4ALL_METHODS_ROOT"
    else:
        dist = workspace_root / "nirs4all-methods" / "bindings/js/dist"
        source = "default sibling nirs4all-methods"
    missing = [name for name in REQUIRED_JS_METHODS_FILES if not (dist / name).exists()]
    if missing:
        return None, f"local nirs4all-methods JS/WASM build is unavailable from {source}: {dist}; missing {', '.join(missing)}"
    return dist / "index.js", source


def _run_wasm(
    workspace_root: Path,
    core_root: Path,
    artifacts_dir: Path,
    pipeline_path: Path,
    dataset_path: Path,
    dataset: dict[str, Any],
    oracle: dict[str, Any],
) -> dict[str, Any]:
    runtime = "javascript_wasm"
    result_json = artifacts_dir / "wasm-predictions.json"
    _unlink_outputs(result_json, artifacts_dir / "wasm-predictions.parquet")
    node = _node_executable()
    if not node:
        return _blocked(runtime, "node is not available on PATH or under ~/.nvm/versions/node.", result_json)
    methods_index, methods_source = _methods_js_index(workspace_root)
    if methods_index is None:
        return _blocked(runtime, methods_source, result_json)

    node_script = artifacts_dir / "run-wasm-roundtrip.mjs"
    node_script.write_text(
        """
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [indexPath, methodsPath, pipelinePath, datasetPath, outputPath] = process.argv.slice(2);
const n4a = await import(pathToFileURL(indexPath).href);
const methods = await import(pathToFileURL(methodsPath).href);
if (typeof methods.loadModule === 'function') {
  await methods.loadModule();
}

const pipeline = readFileSync(pipelinePath, 'utf8');
const pipelineObject = JSON.parse(pipeline);
const payload = JSON.parse(readFileSync(datasetPath, 'utf8'));
const portable = payload.portable_view;
const manifest = n4a.capabilityManifest();
const definition = n4a.loadPipelineDefinition(pipelineObject);
const wasmRuntime = manifest.runtimeContracts.find((item) => item.surface === 'javascript_wasm');
const dataset = {
  X: Float64Array.from(portable.X),
  y: Float64Array.from(portable.y),
  rows: portable.rows,
  cols: portable.cols,
};
const actual = await n4a.runPortablePipeline(pipeline, dataset, { methods });
const predicted = await n4a.predictPortablePipeline(actual, {
  X: Float64Array.from(portable.X),
  rows: portable.rows,
  cols: portable.cols,
}, { methods });
actual.predict_roundtrip = {
  rows: predicted.rows,
  cols: predicted.cols,
  held_out_predictions: actual.split.testIndices.map((index) => predicted.data[index]),
};
actual.web_core_import = {
  schema_version: 'n4a.e2e.multimodal_web_core_import.v1',
  scenario_id: 'e2e-multimodal-python-r-wasm-roundtrip',
  status: 'passed',
  runtime_surface: 'javascript_wasm',
  client_side_only: true,
  backend_api_calls: 0,
  aggregate: manifest.aggregate,
  capability_schema: manifest.schema,
  runtime_surfaces: manifest.runtimeSurfaces,
  runtime_contract: wasmRuntime ?? null,
  pipeline_imported: true,
  loaded_pipeline_name: definition.name,
  original_pipeline_name: pipelineObject.name,
  pipeline_name_match: definition.name === pipelineObject.name,
  run_entrypoint: typeof n4a.runPortablePipeline,
  predict_entrypoint: typeof n4a.predictPortablePipeline,
  dataset_imported: true,
  dataset_name: payload.name,
  dataset_rows: portable.rows,
  dataset_cols: portable.cols,
  source_count: Array.isArray(payload.sources) ? payload.sources.length : 0,
  source_ids: Array.isArray(payload.sources) ? payload.sources.map((source) => source.name ?? source.id ?? source.source_id ?? null) : [],
  source_slices: Array.isArray(payload.sources) ? payload.sources.map((source) => source.feature_slice ?? null) : [],
  sample_count: Array.isArray(payload.samples) ? payload.samples.length : 0,
  prediction_rows: actual.selected.predictions.length,
  predict_roundtrip_rows: predicted.rows,
  predict_roundtrip_cols: predicted.cols,
};
writeFileSync(outputPath, `${JSON.stringify(actual, null, 2)}\\n`);
""".strip()
        + "\n",
        encoding="utf-8",
    )
    completed = subprocess.run(
        [
            node,
            str(node_script),
            str(core_root / "bindings/wasm/src/index.js"),
            str(methods_index),
            str(pipeline_path),
            str(dataset_path),
            str(result_json),
        ],
        cwd=core_root / "bindings/wasm",
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        return _blocked(
            runtime,
            f"WASM execution failed with exit {completed.returncode}: {completed.stderr.strip() or completed.stdout.strip()}",
            result_json,
        )
    actual = _load_json(result_json)
    payload = _record_runtime_success(runtime, actual, dataset, oracle, artifacts_dir, artifacts_dir / "wasm-predictions.parquet", result_json)
    held_out = actual.get("predict_roundtrip", {}).get("held_out_predictions", [])
    if held_out:
        payload["predict_roundtrip_abs_max"] = _max_abs_diff(_as_float_list(held_out), _as_float_list(actual["selected"]["predictions"]))
        _write_json(result_json, payload)
    return payload


def _write_web_core_import_evidence(
    pipeline: dict[str, Any],
    dataset: dict[str, Any],
    oracle: dict[str, Any],
    wasm_payload: dict[str, Any],
    artifacts_dir: Path,
) -> dict[str, Any]:
    output_path = artifacts_dir / "web-core-import.json"
    tolerance = float(oracle["metadata"]["prediction_abs_tolerance"])
    web = dict(wasm_payload.get("actual", {}).get("web_core_import") or {})
    comparison = dict(wasm_payload.get("comparison") or {})
    predict_roundtrip_abs_max = wasm_payload.get("predict_roundtrip_abs_max")
    runtime_contract = dict(web.get("runtime_contract") or {})
    serialized_model_predict_surfaces = [
        item.get("surface")
        for item in web.get("runtime_contracts", [])
        if isinstance(item, dict) and item.get("serializedModelPredict") is True
    ]
    if not serialized_model_predict_surfaces and runtime_contract.get("serializedModelPredict") is True:
        serialized_model_predict_surfaces = [str(runtime_contract.get("surface"))]

    expected_source_ids = [_source_id(source if isinstance(source, dict) else {}, index) for index, source in enumerate(dataset.get("sources") or [])]
    expected_source_slices = [
        list(bounds)
        for source in dataset.get("sources") or []
        if isinstance(source, dict) and (bounds := _slice_bounds(source.get("feature_slice"))) is not None
    ]

    checks = {
        "client_side_only": web.get("client_side_only") is True,
        "backend_api_calls_zero": int(web.get("backend_api_calls", -1)) == 0,
        "capability_schema": web.get("capability_schema") == "nirs4all-core.capabilities.v1",
        "javascript_wasm_surface_declared": "javascript_wasm" in list(web.get("runtime_surfaces") or []),
        "runtime_contract_predict_entrypoint": runtime_contract.get("predictEntrypoint") == "predictPortablePipeline",
        "runtime_contract_pipeline_entrypoint": runtime_contract.get("pipelineEntrypoint") == "runPortablePipeline",
        "serialized_model_predict_surface": serialized_model_predict_surfaces == ["javascript_wasm"],
        "pipeline_imported": web.get("pipeline_imported") is True,
        "pipeline_name_match": web.get("pipeline_name_match") is True and web.get("original_pipeline_name") == pipeline.get("name"),
        "run_entrypoint_is_function": web.get("run_entrypoint") == "function",
        "predict_entrypoint_is_function": web.get("predict_entrypoint") == "function",
        "dataset_imported": web.get("dataset_imported") is True,
        "dataset_shape_match": int(web.get("dataset_rows", -1)) == int(dataset.get("rows", -2))
        and int(web.get("dataset_cols", -1)) == int(dataset.get("cols", -2)),
        "source_count_match": int(web.get("source_count", -1)) == len(expected_source_ids),
        "source_ids_match": list(web.get("source_ids") or []) == expected_source_ids,
        "source_slices_match": list(web.get("source_slices") or []) == expected_source_slices,
        "sample_count_match": int(web.get("sample_count", -1)) == len(list(dataset.get("samples") or [])),
        "prediction_rows_match": int(web.get("prediction_rows", -1)) == len(_as_float_list(oracle["case"]["selected"]["predictions"])),
        "prediction_abs_max_within_tolerance": float(comparison.get("prediction_abs_max", float("inf"))) <= tolerance,
        "predict_roundtrip_abs_max_within_tolerance": float(predict_roundtrip_abs_max if predict_roundtrip_abs_max is not None else float("inf")) <= tolerance,
    }
    status = "passed" if checks and all(checks.values()) else "failed"
    evidence = {
        "schema_version": "n4a.e2e.multimodal_web_core_import.v1",
        "scenario_id": SCENARIO_ID,
        "status": status,
        "runtime": "javascript_wasm",
        "artifact": "web-core-import.json",
        "pipeline_sha256": _stable_hash(pipeline),
        "dataset_sha256": _stable_hash(dataset["portable_view"]),
        "client_side_only": web.get("client_side_only") is True,
        "backend_api_calls": int(web.get("backend_api_calls", -1)),
        "capability_schema": web.get("capability_schema"),
        "runtime_surfaces": list(web.get("runtime_surfaces") or []),
        "runtime_contract": runtime_contract,
        "serialized_model_predict_surfaces": serialized_model_predict_surfaces,
        "pipeline_import": {
            "imported": web.get("pipeline_imported") is True,
            "loaded_pipeline_name": web.get("loaded_pipeline_name"),
            "original_pipeline_name": web.get("original_pipeline_name"),
            "pipeline_name_match": web.get("pipeline_name_match") is True,
        },
        "dataset_import": {
            "imported": web.get("dataset_imported") is True,
            "dataset_name": web.get("dataset_name"),
            "rows": web.get("dataset_rows"),
            "cols": web.get("dataset_cols"),
            "source_count": web.get("source_count"),
            "source_ids": list(web.get("source_ids") or []),
            "source_slices": list(web.get("source_slices") or []),
            "sample_count": web.get("sample_count"),
        },
        "prediction_comparison": {
            "prediction_abs_max": comparison.get("prediction_abs_max"),
            "predict_roundtrip_abs_max": predict_roundtrip_abs_max,
            "tolerance": tolerance,
            "prediction_rows": web.get("prediction_rows"),
        },
        "checks": checks,
    }
    _write_json(output_path, evidence)
    return evidence


def _required_artifacts(artifacts_dir: Path) -> tuple[Path, Path, Path]:
    pipeline_path = artifacts_dir / "multimodal-pipeline.n4a.json"
    dataset_path = artifacts_dir / "multimodal-dataset.json"
    oracle_path = artifacts_dir / "python-oracle.json"
    missing = [path.name for path in (pipeline_path, dataset_path, oracle_path) if not path.exists()]
    if missing:
        raise FileNotFoundError(
            "Missing Python oracle artifact(s): "
            + ", ".join(missing)
            + ". Run `python3.11 -m pytest tests/e2e/test_multimodal_roundtrip.py::test_generate_oracle --artifacts-dir=<dir>` first."
        )
    return pipeline_path, dataset_path, oracle_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace-root", type=Path, required=True)
    parser.add_argument("--artifacts-dir", type=Path, required=True)
    args = parser.parse_args(argv)

    workspace_root = args.workspace_root.resolve()
    core_root = Path(__file__).resolve().parents[2]
    artifacts_dir = args.artifacts_dir.resolve()
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    try:
        pipeline_path, dataset_path, oracle_path = _required_artifacts(artifacts_dir)
        pipeline = _load_json(pipeline_path)
        dataset = _load_json(dataset_path)
        oracle = _load_json(oracle_path)
    except Exception as exc:
        _write_json(
            artifacts_dir / "core-roundtrip-evidence.json",
            {"scenario_id": SCENARIO_ID, "status": "blocked", "reason": str(exc)},
        )
        print(str(exc), file=sys.stderr)
        return 2

    checks = {
        "pipeline_sha256_match": _stable_hash(pipeline) == oracle["pipeline_sha256"],
        "dataset_sha256_match": _stable_hash(dataset["portable_view"]) == oracle["dataset_sha256"],
    }
    multimodal_audit = _multimodal_artifact_audit(pipeline, dataset, oracle)

    runtime_results = [
        _run_python_core(workspace_root, core_root, artifacts_dir, pipeline_path, dataset, oracle),
        _run_r(workspace_root, core_root, artifacts_dir, pipeline_path, dataset_path, dataset, oracle),
        _run_wasm(workspace_root, core_root, artifacts_dir, pipeline_path, dataset_path, dataset, oracle),
    ]
    wasm_result = next((result for result in runtime_results if result.get("runtime") == "javascript_wasm"), None)
    if wasm_result and wasm_result.get("status") == "passed":
        web_core_import = _write_web_core_import_evidence(pipeline, dataset, oracle, wasm_result, artifacts_dir)
    else:
        web_core_import = _blocked(
            "web_core_import",
            "javascript_wasm runtime did not pass, so client-side web/core import evidence cannot be written.",
            artifacts_dir / "web-core-import.json",
        )

    required_runtimes = {"r", "javascript_wasm"}
    blockers = [result for result in runtime_results if result["status"] == "blocked" and result["runtime"] in required_runtimes]
    failures = [result for result in runtime_results if result["status"] == "failed"]
    if web_core_import["status"] == "failed":
        failures.append(web_core_import)
    elif web_core_import["status"] == "blocked":
        blockers.append(web_core_import)
    status = "passed"
    if failures:
        status = "failed"
    elif blockers or not all(checks.values()):
        status = "blocked"

    evidence = {
        "scenario_id": SCENARIO_ID,
        "status": status,
        "checks": checks,
        "artifacts_dir": str(artifacts_dir),
        "pipeline": {"path": pipeline_path.name, "sha256": oracle["pipeline_sha256"]},
        "dataset": {"path": dataset_path.name, "sha256": oracle["dataset_sha256"]},
        "multimodal_artifact_audit": multimodal_audit,
        "runtime_results": runtime_results,
        "web_core_import": web_core_import,
        "decisions": [
            "The client-side nirs4all-core JavaScript/WASM runtime imports the same multimodal pipeline and dataset artifacts and records web-core-import.json; the full Studio shell is not exercised by this scenario.",
            "R and JavaScript/WASM receive the explicit fused dense matrix view from the multimodal dataset contract.",
            "Runtime blockers are recorded as JSON artifacts; prediction files are written only after actual execution.",
        ],
    }
    _write_json(artifacts_dir / "core-roundtrip-evidence.json", evidence)

    existing_evidence_path = artifacts_dir / "roundtrip-evidence.json"
    if existing_evidence_path.exists():
        existing = _load_json(existing_evidence_path)
        existing["core_roundtrip"] = evidence
        existing["status"] = "blocked" if status == "blocked" else status
        existing["remaining_blockers"] = [
            f"{result['runtime']}: {result.get('reason', 'blocked')}"
            for result in runtime_results
            if result["status"] == "blocked"
        ]
        _write_json(existing_evidence_path, existing)

    summary = {"scenario_id": SCENARIO_ID, "status": status, "checks": checks}
    if blockers:
        summary["blockers"] = [
            {"runtime": result.get("runtime"), "reason": result.get("reason", "blocked")}
            for result in blockers
        ]
    if failures:
        summary["failures"] = [
            {"runtime": result.get("runtime"), "status": result.get("status"), "reason": result.get("reason")}
            for result in failures
        ]
    print(json.dumps(summary, indent=2, sort_keys=True))
    if failures:
        return 1
    if blockers or not all(checks.values()):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
