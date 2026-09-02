from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def _load_module():
    path = ROOT / "scripts" / "e2e" / "verify_cluster_handoff.py"
    spec = importlib.util.spec_from_file_location("verify_cluster_handoff", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _scheduler_run(numeric_oracle: dict) -> dict:
    tasks = [
        {"id": "task-a", "status": "succeeded", "result": {"metrics": {"best_rmse": 0.10}}},
        {"id": "task-b", "status": "succeeded", "result": {"metrics": {"best_rmse": 0.20}}},
        {"id": "task-c", "status": "succeeded", "result": {"metrics": {"best_rmse": 0.30}}},
        {"id": "task-d", "status": "succeeded", "result": {"metrics": {"best_rmse": 0.40}}},
    ]
    return {
        "scenario": "e2e-cluster-dag-rights-client-core",
        "status": "succeeded",
        "job_id": "job_1",
        "scheduler": {"shape": "dag_shaped_whole_run"},
        "rights_checks": {
            "viewer_submit_missing": ["execute"],
            "executor_submit_missing": ["read"],
            "viewer_execute_missing": ["execute"],
            "executor_granted": ["read", "execute"],
        },
        "routing_checks": {"blocked_workers": ["missing-package", "wrong-version", "wrong-site"]},
        "tasks": tasks,
        "aggregate": {
            "num_tasks": 4,
            "num_succeeded": 4,
            "best_task_id": "task-a",
            "best_metric": 0.10,
            "best_model_artifact_id": "artifact-model-a",
        },
        "artifacts": [{"id": "artifact-model-a", "role": "best_model", "path": "model.json"}],
        "numeric_oracle": numeric_oracle,
    }


def test_verify_cluster_handoff_requires_numeric_oracle_to_pass(tmp_path: Path) -> None:
    module = _load_module()
    artifacts_dir = tmp_path / "cluster"
    numeric_oracle = {"status": "not_requested", "available": False}
    _write_json(artifacts_dir / "scheduler-run.json", _scheduler_run(numeric_oracle))
    _write_json(artifacts_dir / "local-vs-cluster-numeric.json", numeric_oracle)

    with pytest.raises(AssertionError, match="numeric oracle did not pass"):
        module.verify(artifacts_dir)


def test_verify_cluster_handoff_accepts_passing_numeric_oracle(tmp_path: Path) -> None:
    module = _load_module()
    artifacts_dir = tmp_path / "cluster"
    numeric_oracle = {
        "status": "passed",
        "available": True,
        "job_id": "job_1",
        "task_id": "task-a",
        "cluster_best_rmse": 0.123,
        "local_best_rmse": 0.123,
        "abs_diff": 0.0,
        "tolerance_abs": 1e-6,
    }
    _write_json(artifacts_dir / "scheduler-run.json", _scheduler_run(numeric_oracle))
    _write_json(artifacts_dir / "local-vs-cluster-numeric.json", numeric_oracle)

    core_client_result, parity = module.verify(artifacts_dir)

    assert core_client_result["numeric_oracle"]["status"] == "passed"
    assert parity["scope"] == "control_plane_metric_recompute+numeric_oracle"
    assert parity["checks"]["numeric_oracle_valid"] is True
    assert parity["numeric_recompute"] == {
        "task_count_absolute_delta": 0,
        "succeeded_count_absolute_delta": 0,
        "count_tolerance": 0,
        "best_metric_absolute_delta": 0.0,
        "best_metric_tolerance": 1e-12,
    }
