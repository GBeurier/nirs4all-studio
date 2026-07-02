#!/usr/bin/env python3
"""Lightweight nirs4all/Studio runtime performance comparison.

The default runner is intentionally synthetic. It has the same call shape as
``nirs4all.run`` but does not start the Studio backend, load datasets, or run
parity. The gate measures Studio's runtime-engine wrapper overhead for the two
release-critical paths:

* without the dag-ml backend: explicit ``engine="legacy"``;
* with the dag-ml backend: explicit ``engine="dag-ml"`` in Studio's strict mode.
"""

from __future__ import annotations

import argparse
import gc
import json
import os
import statistics
import sys
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from api.runtime_engine import run_with_engine_record  # noqa: E402

DEFAULT_ITERATIONS = 80
DEFAULT_WARMUP = 10
DEFAULT_MAX_OVERHEAD_MS = 5.0


@dataclass(frozen=True)
class SyntheticRunResult:
    """Small RtResult-compatible object returned by the synthetic runner."""

    engine: str
    checksum: int
    results_path: str | None = None
    workspace_path: str | None = None

    def to_rt_result(self) -> dict[str, Any]:
        return {
            "manifest": {
                "engine": self.engine,
                "fingerprints": {"synthetic_checksum": f"{self.checksum:08x}"},
                "results_path": self.results_path,
                "workspace_path": self.workspace_path,
            },
            "diagnostics": [],
            "artifacts": [],
        }


def synthetic_nirs4all_run(**kwargs: Any) -> SyntheticRunResult:
    """Deterministic, cheap stand-in for ``nirs4all.run``.

    It burns a tiny amount of CPU so the measured ratio is not dominated by an
    empty function call, while staying well below CI time budgets.
    """
    engine = str(kwargs.get("engine") or "legacy")
    payload = repr(
        (
            kwargs.get("pipeline"),
            kwargs.get("dataset"),
            kwargs.get("random_state"),
            kwargs.get("allow_fallback"),
            kwargs.get("results_path"),
            kwargs.get("workspace_path"),
        )
    ).encode("utf-8")

    checksum = 0x4E345A
    for index, byte in enumerate(payload * 3):
        checksum = ((checksum << 5) - checksum + byte + index) & 0xFFFFFFFF
    for index in range(512):
        checksum = ((checksum ^ (index * 2_654_435_761)) + (checksum >> 7)) & 0xFFFFFFFF

    return SyntheticRunResult(
        engine=engine,
        checksum=checksum,
        results_path=str(kwargs["results_path"]) if kwargs.get("results_path") else None,
        workspace_path=str(kwargs["workspace_path"]) if kwargs.get("workspace_path") else None,
    )


def _base_run_kwargs() -> dict[str, Any]:
    return {
        "pipeline": [
            {
                "class": "nirs4all.operators.models.PLSRegression",
                "params": {"n_components": 2},
            }
        ],
        "dataset": {
            "name": "studio-runtime-perf-synthetic",
            "n_samples": 16,
            "n_features": 24,
        },
        "verbose": 0,
        "random_state": 42,
        "refit": False,
    }


def _direct_kwargs(engine: str, workspace_path: Path) -> dict[str, Any]:
    kwargs = _base_run_kwargs()
    kwargs["engine"] = engine
    if engine == "dag-ml":
        kwargs["allow_fallback"] = False
        kwargs["results_path"] = str(workspace_path / "nirs4all_results")
    else:
        kwargs["workspace_path"] = str(workspace_path)
    return kwargs


def _percentile_ns(values: list[int], percentile: float) -> int:
    ordered = sorted(values)
    if not ordered:
        return 0
    index = round((len(ordered) - 1) * percentile)
    return ordered[max(0, min(index, len(ordered) - 1))]


def _stats_ms(values: list[int]) -> dict[str, float]:
    if not values:
        return {"min_ms": 0.0, "median_ms": 0.0, "p95_ms": 0.0, "max_ms": 0.0}
    return {
        "min_ms": min(values) / 1_000_000,
        "median_ms": statistics.median(values) / 1_000_000,
        "p95_ms": _percentile_ns(values, 0.95) / 1_000_000,
        "max_ms": max(values) / 1_000_000,
    }


def _rounded_stats(stats: Mapping[str, float]) -> dict[str, float]:
    return {key: round(value, 6) for key, value in stats.items()}


def _measure(call: Callable[[], Any], *, iterations: int, warmup: int) -> dict[str, Any]:
    for _ in range(warmup):
        call()

    timings: list[int] = []
    gc_was_enabled = gc.isenabled()
    gc.disable()
    try:
        for _ in range(iterations):
            start = time.perf_counter_ns()
            call()
            timings.append(time.perf_counter_ns() - start)
    finally:
        if gc_was_enabled:
            gc.enable()

    return {
        "iterations": iterations,
        **_rounded_stats(_stats_ms(timings)),
    }


def _run_case(engine: str, *, iterations: int, warmup: int, max_overhead_ms: float, workspace_path: Path) -> dict[str, Any]:
    direct = _measure(
        lambda: synthetic_nirs4all_run(**_direct_kwargs(engine, workspace_path)),
        iterations=iterations,
        warmup=warmup,
    )

    studio = _measure(
        lambda: run_with_engine_record(
            synthetic_nirs4all_run,
            run_kwargs=_base_run_kwargs(),
            engine=engine,
            allow_fallback=False,
            workspace_path=workspace_path,
        ),
        iterations=iterations,
        warmup=warmup,
    )

    sample = run_with_engine_record(
        synthetic_nirs4all_run,
        run_kwargs=_base_run_kwargs(),
        engine=engine,
        allow_fallback=False,
        workspace_path=workspace_path,
    )
    overhead_ms = studio["median_ms"] - direct["median_ms"]
    ratio = studio["median_ms"] / max(direct["median_ms"], 0.000001)
    expected_engine = engine
    passed = overhead_ms <= max_overhead_ms and sample.engine_record.get("engine") == expected_engine

    return {
        "id": "without-dagml" if engine == "legacy" else "with-dagml",
        "engine_requested": engine,
        "direct_nirs4all": direct,
        "studio_runtime": studio,
        "studio_overhead_ms": round(overhead_ms, 6),
        "studio_to_direct_ratio": round(ratio, 3),
        "max_overhead_ms": max_overhead_ms,
        "engine_record": sample.engine_record,
        "passed": passed,
    }


def run_perf_gate(
    *,
    iterations: int = DEFAULT_ITERATIONS,
    warmup: int = DEFAULT_WARMUP,
    max_overhead_ms: float = DEFAULT_MAX_OVERHEAD_MS,
    workspace_path: Path | None = None,
) -> dict[str, Any]:
    """Run the lightweight runtime perf comparison and return a JSON report."""
    if iterations < 1:
        raise ValueError("iterations must be >= 1")
    if warmup < 0:
        raise ValueError("warmup must be >= 0")
    if max_overhead_ms < 0:
        raise ValueError("max_overhead_ms must be >= 0")

    workspace = workspace_path or PROJECT_ROOT / "reports" / "perf" / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)

    cases = [
        _run_case("legacy", iterations=iterations, warmup=warmup, max_overhead_ms=max_overhead_ms, workspace_path=workspace),
        _run_case("dag-ml", iterations=iterations, warmup=warmup, max_overhead_ms=max_overhead_ms, workspace_path=workspace),
    ]
    return {
        "schema_version": 1,
        "name": "nirs4all-studio-runtime-perf-gate",
        "runner": "synthetic-nirs4all-run",
        "scope": "Studio runtime wrapper only; no backend server, no Web dependency, no full parity",
        "iterations": iterations,
        "warmup": warmup,
        "budgets": {"max_studio_overhead_ms": max_overhead_ms},
        "cases": cases,
        "passed": all(case["passed"] for case in cases),
    }


def render_markdown(report: Mapping[str, Any]) -> str:
    lines = [
        "# nirs4all Studio runtime perf gate",
        "",
        f"Runner: `{report['runner']}`",
        f"Scope: {report['scope']}",
        f"Iterations: {report['iterations']} measured, {report['warmup']} warmup",
        f"Budget: Studio median overhead <= {report['budgets']['max_studio_overhead_ms']} ms",
        "",
        "| Mode | Engine | Direct median (ms) | Studio median (ms) | Overhead (ms) | Ratio | Result |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for case in report["cases"]:
        result = "PASS" if case["passed"] else "FAIL"
        lines.append(
            f"| {case['id']} | `{case['engine_requested']}` | {case['direct_nirs4all']['median_ms']:.6f} | "
            f"{case['studio_runtime']['median_ms']:.6f} | {case['studio_overhead_ms']:.6f} | "
            f"{case['studio_to_direct_ratio']:.3f} | {result} |"
        )
    lines.extend(
        [
            "",
            "This report compares direct nirs4all-shaped calls with Studio's runtime wrapper for explicit legacy and dag-ml engine requests. It is a lightweight CI gate, not a numerical parity run.",
        ]
    )
    return "\n".join(lines) + "\n"


def write_reports(report: Mapping[str, Any], *, output: Path | None, markdown: Path | None) -> None:
    if output is not None:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if markdown is not None:
        markdown.parent.mkdir(parents=True, exist_ok=True)
        markdown.write_text(render_markdown(report), encoding="utf-8")


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    return int(raw) if raw else default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    return float(raw) if raw else default


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=_env_int("NIRS4ALL_PERF_ITERATIONS", DEFAULT_ITERATIONS))
    parser.add_argument("--warmup", type=int, default=_env_int("NIRS4ALL_PERF_WARMUP", DEFAULT_WARMUP))
    parser.add_argument("--max-overhead-ms", type=float, default=_env_float("NIRS4ALL_PERF_MAX_OVERHEAD_MS", DEFAULT_MAX_OVERHEAD_MS))
    parser.add_argument("--output", type=Path, default=PROJECT_ROOT / "reports" / "perf" / "runtime-gate.json")
    parser.add_argument("--markdown", type=Path, default=PROJECT_ROOT / "reports" / "perf" / "runtime-gate.md")
    parser.add_argument("--workspace", type=Path, default=PROJECT_ROOT / "reports" / "perf" / "workspace")
    parser.add_argument("--no-write", action="store_true", help="Print the markdown report but do not write report files.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    report = run_perf_gate(
        iterations=args.iterations,
        warmup=args.warmup,
        max_overhead_ms=args.max_overhead_ms,
        workspace_path=args.workspace,
    )
    write_reports(
        report,
        output=None if args.no_write else args.output,
        markdown=None if args.no_write else args.markdown,
    )
    print(render_markdown(report), end="")
    if not report["passed"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
