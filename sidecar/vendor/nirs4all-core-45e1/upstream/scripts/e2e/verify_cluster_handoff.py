#!/usr/bin/env python3
"""Verify the cluster scheduler artifact handoff from the core side."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any


SCHEDULER_RUN_ARTIFACT = "scheduler-run.json"
CORE_CLIENT_RESULT_ARTIFACT = "core-client-result.json"
PARITY_ARTIFACT = "local-vs-cluster-parity.json"
NUMERIC_PARITY_ARTIFACT = "local-vs-cluster-numeric.json"


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _task_metric(task: dict[str, Any], metric: str) -> float:
    result = task.get("result")
    if not isinstance(result, dict):
        raise ValueError(f"task {task.get('id')} has no result")
    metrics = result.get("metrics")
    if not isinstance(metrics, dict) or metric not in metrics:
        raise ValueError(f"task {task.get('id')} result has no metric {metric!r}")
    return float(metrics[metric])


def _best_task(tasks: list[dict[str, Any]], metric: str) -> tuple[dict[str, Any], float]:
    if not tasks:
        raise ValueError("scheduler-run contains no tasks")
    scored = [(task, _task_metric(task, metric)) for task in tasks]
    return min(scored, key=lambda item: item[1])


def _verify_numeric_oracle(artifacts_dir: Path, scheduler_run: dict[str, Any]) -> dict[str, Any]:
    embedded = scheduler_run.get("numeric_oracle")
    if not isinstance(embedded, dict):
        return {"status": "missing", "available": False}

    sidecar_path = artifacts_dir / NUMERIC_PARITY_ARTIFACT
    sidecar = _read_json(sidecar_path) if sidecar_path.is_file() else None
    if sidecar is not None and sidecar != embedded:
        raise AssertionError("numeric oracle sidecar does not match scheduler-run embedded evidence")

    status = embedded.get("status")
    if status != "passed":
        raise AssertionError(f"numeric oracle did not pass: {embedded!r}")

    cluster = float(embedded["cluster_best_rmse"])
    local = float(embedded["local_best_rmse"])
    abs_diff = float(embedded["abs_diff"])
    tolerance = float(embedded["tolerance_abs"])
    if not all(math.isfinite(value) for value in (cluster, local, abs_diff, tolerance)):
        raise AssertionError(f"numeric oracle contains non-finite values: {embedded!r}")
    if not math.isclose(abs(cluster - local), abs_diff, rel_tol=0.0, abs_tol=1e-12):
        raise AssertionError(f"numeric oracle abs_diff is inconsistent: {embedded!r}")
    if abs_diff > tolerance:
        raise AssertionError(f"numeric oracle exceeds tolerance: {embedded!r}")

    return {
        "status": "passed",
        "available": True,
        "job_id": embedded.get("job_id"),
        "task_id": embedded.get("task_id"),
        "cluster_best_rmse": cluster,
        "local_best_rmse": local,
        "abs_diff": abs_diff,
        "tolerance_abs": tolerance,
    }


def verify(artifacts_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    scheduler_path = artifacts_dir / SCHEDULER_RUN_ARTIFACT
    if not scheduler_path.is_file():
        raise FileNotFoundError(f"missing cluster scheduler artifact: {scheduler_path}")

    scheduler_run = _read_json(scheduler_path)
    if scheduler_run.get("scenario") != "e2e-cluster-dag-rights-client-core":
        raise AssertionError(f"unexpected scenario marker: {scheduler_run.get('scenario')!r}")
    if scheduler_run.get("status") != "succeeded":
        raise AssertionError(f"cluster job did not succeed: {scheduler_run.get('status')!r}")

    scheduler = scheduler_run.get("scheduler") or {}
    if scheduler.get("shape") != "dag_shaped_whole_run":
        raise AssertionError(f"unexpected scheduler shape: {scheduler.get('shape')!r}")

    rights = scheduler_run.get("rights_checks") or {}
    for key in ("viewer_submit_missing", "executor_submit_missing", "viewer_execute_missing"):
        missing = rights.get(key)
        if not isinstance(missing, list) or not missing:
            raise AssertionError(f"rights check {key!r} did not record a denied right")
    if sorted(rights.get("executor_granted", [])) != ["execute", "read"]:
        raise AssertionError(f"executor rights mismatch: {rights.get('executor_granted')!r}")

    routing = scheduler_run.get("routing_checks") or {}
    if len(routing.get("blocked_workers", [])) != 3:
        raise AssertionError("expected three blocked workers: missing package, wrong version, wrong site")

    tasks = scheduler_run.get("tasks")
    if not isinstance(tasks, list) or len(tasks) != 4:
        raise AssertionError(f"expected four cluster tasks, got {len(tasks) if isinstance(tasks, list) else 'invalid'}")
    if {task.get("status") for task in tasks} != {"succeeded"}:
        raise AssertionError("not all cluster tasks succeeded")

    aggregate = scheduler_run.get("aggregate") or {}
    local_best, local_best_rmse = _best_task(tasks, "best_rmse")
    best_task_id = local_best.get("id")
    cluster_num_tasks = int(aggregate.get("num_tasks"))
    cluster_num_succeeded = int(aggregate.get("num_succeeded"))
    local_num_tasks = len(tasks)
    local_num_succeeded = sum(1 for task in tasks if task.get("status") == "succeeded")
    cluster_best_metric = float(aggregate.get("best_metric"))
    best_metric_tolerance = 1e-12
    best_metric_absolute_delta = abs(cluster_best_metric - local_best_rmse)
    count_tolerance = 0
    if aggregate.get("best_task_id") != best_task_id:
        raise AssertionError(
            f"best task mismatch: aggregate={aggregate.get('best_task_id')!r} local={best_task_id!r}"
        )
    if not math.isclose(cluster_best_metric, local_best_rmse, rel_tol=0.0, abs_tol=best_metric_tolerance):
        raise AssertionError(
            f"best metric mismatch: aggregate={aggregate.get('best_metric')!r} local={local_best_rmse!r}"
        )

    artifacts = scheduler_run.get("artifacts")
    if not isinstance(artifacts, list):
        raise AssertionError("scheduler-run artifacts must be a list")
    best_model = next((artifact for artifact in artifacts if artifact.get("role") == "best_model"), None)
    if not best_model:
        raise AssertionError("cluster artifact handoff has no best_model artifact")

    numeric_oracle = _verify_numeric_oracle(artifacts_dir, scheduler_run)

    core_client_result = {
        "schema_version": "n4a.e2e.cluster-core-handoff/v1",
        "status": "passed",
        "source_artifact": str(scheduler_path),
        "job_id": scheduler_run["job_id"],
        "scheduler_shape": scheduler["shape"],
        "rights_checks": rights,
        "artifact_handoff": {
            "best_model": best_model,
            "aggregate_best_model_artifact_id": aggregate.get("best_model_artifact_id"),
        },
        "numeric_oracle": numeric_oracle,
    }
    parity = {
        "schema_version": "n4a.e2e.cluster-local-recompute/v1",
        "status": "passed",
        "scope": "control_plane_metric_recompute+numeric_oracle",
        "note": (
            "This gate recomputes the scheduler aggregate from task results and requires "
            "a real cluster nirs4all.run metric against the local Python reference."
        ),
        "cluster": {
            "num_tasks": cluster_num_tasks,
            "num_succeeded": cluster_num_succeeded,
            "best_task_id": aggregate.get("best_task_id"),
            "best_metric": cluster_best_metric,
        },
        "local_recompute": {
            "num_tasks": local_num_tasks,
            "num_succeeded": local_num_succeeded,
            "best_task_id": best_task_id,
            "best_metric": local_best_rmse,
        },
        "numeric_recompute": {
            "task_count_absolute_delta": abs(cluster_num_tasks - local_num_tasks),
            "succeeded_count_absolute_delta": abs(cluster_num_succeeded - local_num_succeeded),
            "count_tolerance": count_tolerance,
            "best_metric_absolute_delta": best_metric_absolute_delta,
            "best_metric_tolerance": best_metric_tolerance,
        },
        "checks": {
            "num_tasks_match": abs(cluster_num_tasks - local_num_tasks) <= count_tolerance,
            "all_succeeded": abs(cluster_num_succeeded - local_num_succeeded) <= count_tolerance,
            "best_task_match": aggregate.get("best_task_id") == best_task_id,
            "best_metric_match": best_metric_absolute_delta <= best_metric_tolerance,
            "numeric_oracle_valid": numeric_oracle["status"] == "passed",
        },
        "numeric_oracle": numeric_oracle,
    }
    if not all(parity["checks"].values()):
        raise AssertionError(f"cluster handoff parity failed: {parity['checks']}")
    return core_client_result, parity


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts-dir", type=Path, required=True)
    args = parser.parse_args(argv)

    artifacts_dir = args.artifacts_dir.expanduser().resolve()
    core_client_result, parity = verify(artifacts_dir)
    _write_json(artifacts_dir / CORE_CLIENT_RESULT_ARTIFACT, core_client_result)
    _write_json(artifacts_dir / PARITY_ARTIFACT, parity)
    print(json.dumps(parity["checks"], ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
