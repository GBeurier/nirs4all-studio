from __future__ import annotations

import sys
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


class MockDataFrame:
    def __init__(self, rows: list[dict]):
        self._rows = rows

    def __len__(self) -> int:
        return len(self._rows)

    def iter_rows(self, named: bool = False):
        if named:
            yield from self._rows
            return
        for row in self._rows:
            yield tuple(row.values())

    def row(self, index: int, named: bool = False):
        row = self._rows[index]
        if named:
            return row
        return tuple(row.values())


class StoreWithoutArrayGetter:
    def __init__(
        self,
        chain_rows: list[dict],
        prediction_rows_by_chain: dict[str, list[dict]],
        predictions_by_id: dict[str, dict],
    ):
        self._chain_rows = chain_rows
        self._prediction_rows_by_chain = prediction_rows_by_chain
        self._predictions_by_id = predictions_by_id

    def query_chain_summaries(self, **_kwargs):
        return MockDataFrame(self._chain_rows)

    def get_chain_predictions(self, chain_id: str, partition: str | None = None, **_kwargs):
        rows = self._prediction_rows_by_chain.get(chain_id, [])
        if partition is not None:
            rows = [row for row in rows if row.get("partition") == partition]
        return MockDataFrame(rows)

    def get_prediction(self, prediction_id: str, load_arrays: bool = False):
        prediction = dict(self._predictions_by_id[prediction_id])
        prediction["prediction_id"] = prediction_id
        if not load_arrays:
            prediction = {key: value for key, value in prediction.items() if key not in {"y_true", "y_pred", "sample_indices"}}
        return prediction

    def get_pipeline(self, pipeline_id: str):
        return {"pipeline_id": pipeline_id, "name": pipeline_id, "expanded_config": []}

    def close(self):
        return None


@pytest.fixture()
def mock_workspace(tmp_path):
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()
    (workspace_dir / "store.duckdb").touch()

    class Workspace:
        path = str(workspace_dir)

    return Workspace()


@contextmanager
def make_client(store, mock_workspace):
    from fastapi.testclient import TestClient

    import api.inspector
    from main import app

    original_get_cached = api.inspector.get_cached

    def patched_get_cached(name):
        if name == "WorkspaceStore":
            return lambda _workspace_path: store
        return original_get_cached(name)

    with ExitStack() as stack:
        patched_workspace_manager = stack.enter_context(patch.object(api.inspector, "workspace_manager"))
        stack.enter_context(patch.object(api.inspector, "get_cached", side_effect=patched_get_cached))
        stack.enter_context(patch.object(api.inspector, "STORE_AVAILABLE", True))
        patched_workspace_manager.get_current_workspace.return_value = mock_workspace
        with TestClient(app) as client:
            yield client


def test_scatter_endpoint_falls_back_to_get_prediction(mock_workspace):
    chain_rows = [
        {
            "chain_id": "chain-a",
            "run_id": "run-1",
            "pipeline_id": "pipe-1",
            "model_class": "PLSRegression",
            "model_name": "PLS 8",
            "preprocessings": "SNV",
            "metric": "rmse",
            "task_type": "regression",
            "dataset_name": "diesel",
            "cv_val_score": 0.12,
            "cv_test_score": 0.14,
            "cv_train_score": 0.1,
            "cv_fold_count": 2,
            "final_test_score": None,
            "final_train_score": None,
            "pipeline_status": "completed",
            "model_step_idx": 1,
            "branch_path": None,
            "best_params": None,
        }
    ]
    prediction_rows = {
        "chain-a": [
            {
                "prediction_id": "pred-1",
                "chain_id": "chain-a",
                "partition": "val",
                "model_class": "PLSRegression",
                "model_name": "PLS 8",
                "preprocessings": "SNV",
                "val_score": 0.12,
                "test_score": 0.14,
                "train_score": 0.1,
            }
        ]
    }
    predictions_by_id = {
        "pred-1": {
            "y_true": [1.0, 2.0, 3.0],
            "y_pred": [0.9, 2.1, 3.2],
            "sample_indices": [0, 1, 2],
        }
    }

    store = StoreWithoutArrayGetter(chain_rows, prediction_rows, predictions_by_id)

    with make_client(store, mock_workspace) as client:
        response = client.post("/api/inspector/scatter", json={"chain_ids": ["chain-a"], "partition": "val"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_samples"] == 3
    assert payload["points"][0]["y_true"] == [1.0, 2.0, 3.0]
    assert payload["points"][0]["sample_indices"] == [0, 1, 2]


def test_confusion_matrix_accepts_list_payloads(mock_workspace):
    chain_rows = [
        {
            "chain_id": "clf-chain",
            "run_id": "run-1",
            "pipeline_id": "pipe-1",
            "model_class": "RandomForestClassifier",
            "model_name": "RF",
            "preprocessings": "SNV",
            "metric": "accuracy",
            "task_type": "classification",
            "dataset_name": "beans",
            "cv_val_score": 0.91,
            "cv_test_score": 0.88,
            "cv_train_score": 0.95,
            "cv_fold_count": 2,
            "final_test_score": None,
            "final_train_score": None,
            "pipeline_status": "completed",
            "model_step_idx": 1,
            "branch_path": None,
            "best_params": None,
        }
    ]
    prediction_rows = {
        "clf-chain": [
            {
                "prediction_id": "clf-pred",
                "chain_id": "clf-chain",
                "partition": "val",
                "model_class": "RandomForestClassifier",
                "model_name": "RF",
                "preprocessings": "SNV",
                "val_score": 0.91,
                "test_score": 0.88,
                "train_score": 0.95,
            }
        ]
    }
    predictions_by_id = {
        "clf-pred": {
            "y_true": ["cat", "dog", "cat", "dog"],
            "y_pred": ["cat", "dog", "dog", "dog"],
        }
    }

    store = StoreWithoutArrayGetter(chain_rows, prediction_rows, predictions_by_id)

    with make_client(store, mock_workspace) as client:
        response = client.post("/api/inspector/confusion", json={"chain_ids": ["clf-chain"], "partition": "val"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["labels"] == ["cat", "dog"]
    assert payload["total_samples"] == 4
    assert any(cell["true_label"] == "cat" and cell["pred_label"] == "dog" and cell["count"] == 1 for cell in payload["cells"])


def test_bias_variance_separates_same_sample_index_across_datasets(mock_workspace):
    chain_rows = [
        {
            "chain_id": "chain-a",
            "run_id": "run-1",
            "pipeline_id": "pipe-1",
            "model_class": "PLSRegression",
            "model_name": "PLS A",
            "preprocessings": "SNV",
            "metric": "rmse",
            "task_type": "regression",
            "dataset_name": "diesel-a",
            "cv_val_score": 0.12,
            "cv_test_score": 0.14,
            "cv_train_score": 0.1,
            "cv_fold_count": 2,
            "final_test_score": None,
            "final_train_score": None,
            "pipeline_status": "completed",
            "model_step_idx": 1,
            "branch_path": None,
            "best_params": None,
        },
        {
            "chain_id": "chain-b",
            "run_id": "run-1",
            "pipeline_id": "pipe-2",
            "model_class": "PLSRegression",
            "model_name": "PLS B",
            "preprocessings": "MSC",
            "metric": "rmse",
            "task_type": "regression",
            "dataset_name": "diesel-b",
            "cv_val_score": 0.11,
            "cv_test_score": 0.13,
            "cv_train_score": 0.09,
            "cv_fold_count": 2,
            "final_test_score": None,
            "final_train_score": None,
            "pipeline_status": "completed",
            "model_step_idx": 1,
            "branch_path": None,
            "best_params": None,
        },
    ]
    prediction_rows = {
        "chain-a": [
            {"prediction_id": "pred-a-1", "chain_id": "chain-a", "partition": "val"},
            {"prediction_id": "pred-a-2", "chain_id": "chain-a", "partition": "val"},
        ],
        "chain-b": [
            {"prediction_id": "pred-b-1", "chain_id": "chain-b", "partition": "val"},
            {"prediction_id": "pred-b-2", "chain_id": "chain-b", "partition": "val"},
        ],
    }
    predictions_by_id = {
        "pred-a-1": {"y_true": [1.0], "y_pred": [1.1], "sample_indices": [0]},
        "pred-a-2": {"y_true": [1.0], "y_pred": [0.9], "sample_indices": [0]},
        "pred-b-1": {"y_true": [2.0], "y_pred": [2.2], "sample_indices": [0]},
        "pred-b-2": {"y_true": [2.0], "y_pred": [1.8], "sample_indices": [0]},
    }

    store = StoreWithoutArrayGetter(chain_rows, prediction_rows, predictions_by_id)

    with make_client(store, mock_workspace) as client:
        response = client.post(
            "/api/inspector/bias-variance",
            json={"chain_ids": ["chain-a", "chain-b"], "score_column": "cv_val_score", "group_by": "model_class"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["entries"]) == 1
    entry = payload["entries"][0]
    assert entry["group_label"] == "PLSRegression"
    assert entry["n_samples"] == 2
    assert entry["variance"] == pytest.approx(0.025, abs=1e-6)
