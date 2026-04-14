from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient


def _write_pipeline(workspace_path: Path, pipeline_id: str, steps: list[dict]) -> None:
    payload = {
        "id": pipeline_id,
        "name": pipeline_id,
        "description": "",
        "category": "user",
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "steps": steps,
    }
    (workspace_path / "pipelines" / f"{pipeline_id}.json").write_text(
        json.dumps(payload, indent=2),
        encoding="utf-8",
    )


def test_quick_run_rejects_required_group_pipeline_without_effective_group(
    workspace_client: TestClient,
):
    workspace_path = Path(workspace_client._test_workspace_path)
    _write_pipeline(
        workspace_path,
        "group_required_pipeline",
        [
            {"id": "split", "type": "splitting", "name": "GroupKFold", "params": {"n_splits": 2}},
            {"id": "model", "type": "model", "name": "PLSRegression", "params": {"n_components": 2}},
        ],
    )

    response = workspace_client.post(
        "/api/runs/quick",
        json={
            "pipeline_id": "group_required_pipeline",
            "dataset_id": "test_dataset",
            "cv_folds": 2,
        },
    )

    assert response.status_code == 400
    assert "requires an effective group" in response.json()["detail"]


def test_quick_run_rejects_pipeline_with_persisted_group_by(
    workspace_client: TestClient,
):
    workspace_path = Path(workspace_client._test_workspace_path)
    _write_pipeline(
        workspace_path,
        "persisted_group_pipeline",
        [
            {"id": "split", "type": "splitting", "name": "KFold", "params": {"n_splits": 3, "group_by": "batch"}},
            {"id": "model", "type": "model", "name": "PLSRegression", "params": {"n_components": 2}},
        ],
    )

    response = workspace_client.post(
        "/api/runs/quick",
        json={
            "pipeline_id": "persisted_group_pipeline",
            "dataset_id": "test_dataset",
            "cv_folds": 3,
            "split_group_by_by_dataset": {"test_dataset": "batch"},
        },
    )

    assert response.status_code == 400
    assert "already persists 'group_by' or legacy 'group'" in response.json()["detail"]
