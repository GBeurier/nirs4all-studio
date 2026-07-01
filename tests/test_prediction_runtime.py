from __future__ import annotations

import asyncio
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
import pytest
from fastapi import HTTPException

import api.models as models_api
import api.prediction_runtime as prediction_runtime
import api.predictions as predictions_api
from api.runtime_errors import RtUnsupportedError


class _FakePredictResult:
    def __init__(self, y_pred: Any, *, preprocessing_steps: list[str] | None = None, model_name: str = "fake") -> None:
        self.y_pred = np.asarray(y_pred)
        self.preprocessing_steps = preprocessing_steps or []
        self.model_name = model_name

    def to_numpy(self) -> np.ndarray:
        return self.y_pred


class _FakeDataset:
    def __init__(self, X: Any, y: Any | None = None) -> None:
        self._X = np.asarray(X)
        self._y = None if y is None else np.asarray(y)

    def x(self, selector=None, layout=None):  # noqa: ANN001, ANN201
        return self._X

    def y(self, selector=None):  # noqa: ANN001, ANN201
        if self._y is None:
            raise RuntimeError("no target")
        return self._y


def _workspace_with_model(tmp_path: Path, model_id: str = "model") -> tuple[SimpleNamespace, Path]:
    workspace_dir = tmp_path / "workspace"
    model_dir = workspace_dir / "models"
    model_dir.mkdir(parents=True)
    model_path = model_dir / f"{model_id}.n4a"
    model_path.write_text("fake bundle", encoding="utf-8")
    return SimpleNamespace(path=str(workspace_dir)), model_path


def test_prediction_request_runtime_defaults() -> None:
    batch = predictions_api.PredictBatchRequest(model_id="m", spectra=[[1.0, 2.0]])
    dataset = predictions_api.PredictDatasetRequest(model_id="m", dataset_id="d")
    compare = models_api.CompareModelsRequest(model_paths=["a.n4a", "b.n4a"], dataset_path="d")

    assert batch.engine is None
    assert batch.allow_fallback is False
    assert dataset.engine is None
    assert dataset.allow_fallback is False
    assert compare.engine is None
    assert compare.allow_fallback is False


def test_predict_batch_uses_python_oracle_y_pred_without_runtime_kwargs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    workspace, model_path = _workspace_with_model(tmp_path)
    calls: list[dict[str, Any]] = []

    def fake_predict(**kwargs):
        calls.append(kwargs)
        return _FakePredictResult([1.1, 2.2], preprocessing_steps=["snv"])

    monkeypatch.setattr(predictions_api.workspace_manager, "get_current_workspace", lambda: workspace)
    monkeypatch.setattr(predictions_api, "get_cached", lambda key: SimpleNamespace(predict=fake_predict))

    response = asyncio.run(
        predictions_api.predict_batch(
            predictions_api.PredictBatchRequest(model_id="model", spectra=[[1.0, 2.0], [3.0, 4.0]])
        )
    )

    assert response.predictions == [1.1, 2.2]
    assert response.preprocessing_applied == ["snv"]
    assert response.runtime["runtime_source"] == "python_oracle"
    assert response.runtime["engine"] == "legacy"
    assert calls[0]["model"] == str(model_path)
    assert calls[0]["verbose"] == 0
    assert np.asarray(calls[0]["data"]).tolist() == [[1.0, 2.0], [3.0, 4.0]]
    assert "engine" not in calls[0]
    assert "allow_fallback" not in calls[0]


def test_predict_batch_refuses_dagml_without_fallback(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    workspace, _model_path = _workspace_with_model(tmp_path)
    calls: list[dict[str, Any]] = []

    def fake_predict(**kwargs):
        calls.append(kwargs)
        return _FakePredictResult([1.0])

    monkeypatch.setattr(predictions_api.workspace_manager, "get_current_workspace", lambda: workspace)
    monkeypatch.setattr(predictions_api, "get_cached", lambda key: SimpleNamespace(predict=fake_predict))

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            predictions_api.predict_batch(
                predictions_api.PredictBatchRequest(
                    model_id="model",
                    spectra=[[1.0, 2.0]],
                    engine="dag-ml",
                    allow_fallback=False,
                )
            )
        )

    assert exc_info.value.status_code == 501
    assert exc_info.value.detail["cause"] == "unsupported_capability"
    assert exc_info.value.detail["unsupported_capability"] == "dagml_predict"
    assert calls == []


def test_predict_batch_dagml_fallback_runs_python_oracle(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    workspace, _model_path = _workspace_with_model(tmp_path)
    calls: list[dict[str, Any]] = []

    def fake_predict(**kwargs):
        calls.append(kwargs)
        return _FakePredictResult([5.0])

    monkeypatch.setattr(predictions_api.workspace_manager, "get_current_workspace", lambda: workspace)
    monkeypatch.setattr(predictions_api, "get_cached", lambda key: SimpleNamespace(predict=fake_predict))

    response = asyncio.run(
        predictions_api.predict_batch(
            predictions_api.PredictBatchRequest(
                model_id="model",
                spectra=[[1.0, 2.0]],
                engine="dag-ml",
                allow_fallback=True,
            )
        )
    )

    assert response.predictions == [5.0]
    assert response.runtime["engine"] == "legacy"
    assert response.runtime["engine_requested"] == "dag-ml"
    assert response.runtime["runtime_source"] == "python_oracle_fallback"
    assert response.runtime["fallback_policy"]["source"] == "nirs4all.predict.allow_fallback"
    assert response.runtime["fallback_policy"]["allow_fallback"] is True
    assert response.runtime["engine_diagnostics"][0]["unsupported_capability"] == "dagml_predict"
    assert "engine" not in calls[0]
    assert "allow_fallback" not in calls[0]


def test_predict_dataset_preserves_predictions_actuals_and_runtime(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    workspace, _model_path = _workspace_with_model(tmp_path)
    dataset = _FakeDataset([[1.0, 2.0], [3.0, 4.0]], [1.0, 2.0])

    def fake_predict(**kwargs):
        return _FakePredictResult([1.1, 1.9], preprocessing_steps=["msc"])

    import api.spectra as spectra_api

    monkeypatch.setattr(predictions_api.workspace_manager, "get_current_workspace", lambda: workspace)
    monkeypatch.setattr(predictions_api, "get_cached", lambda key: SimpleNamespace(predict=fake_predict))
    monkeypatch.setattr(spectra_api, "_load_dataset", lambda dataset_id: dataset)

    response = asyncio.run(
        predictions_api.predict_dataset(
            predictions_api.PredictDatasetRequest(model_id="model", dataset_id="dataset-a")
        )
    )

    assert response["predictions"] == [1.1, 1.9]
    assert response["actual_values"] == [1.0, 2.0]
    assert response["preprocessing_applied"] == ["msc"]
    assert response["num_samples"] == 2
    assert response["runtime"]["runtime_source"] == "python_oracle"


def test_compare_models_records_runtime_without_changing_metrics(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    model_a = tmp_path / "a.n4a"
    model_b = tmp_path / "b.n4a"
    model_a.write_text("a", encoding="utf-8")
    model_b.write_text("b", encoding="utf-8")
    dataset = _FakeDataset([[1.0, 2.0], [3.0, 4.0]], [1.0, 2.0])
    predict_calls: list[dict[str, Any]] = []
    metric_calls: list[tuple[list[float], list[float], str]] = []

    class FakeNirs4all:
        def predict(self, **kwargs):
            predict_calls.append(kwargs)
            if kwargs["model"] == str(model_a):
                return _FakePredictResult([1.1, 2.1])
            return _FakePredictResult([1.2, 1.8])

    def fake_eval_multi(y_true, y_pred, task_type):
        metric_calls.append((np.asarray(y_true).tolist(), np.asarray(y_pred).tolist(), task_type))
        return {"r2": 0.8 if len(metric_calls) == 1 else 0.7, "rmse": 0.2}

    metrics_mod = types.ModuleType("nirs4all.core.metrics")
    metrics_mod.eval_multi = fake_eval_multi
    core_mod = types.ModuleType("nirs4all.core")
    core_mod.metrics = metrics_mod
    nirs_mod = types.ModuleType("nirs4all")
    nirs_mod.core = core_mod

    import api.spectra as spectra_api

    monkeypatch.setitem(sys.modules, "nirs4all", nirs_mod)
    monkeypatch.setitem(sys.modules, "nirs4all.core", core_mod)
    monkeypatch.setitem(sys.modules, "nirs4all.core.metrics", metrics_mod)
    monkeypatch.setattr(models_api, "get_cached", lambda key: FakeNirs4all() if key == "nirs4all" else None)
    monkeypatch.setattr(spectra_api, "_load_dataset", lambda dataset_path: dataset)

    response = asyncio.run(
        models_api.compare_models(
            models_api.CompareModelsRequest(
                model_paths=[str(model_a), str(model_b)],
                dataset_path="dataset-a",
            )
        )
    )

    assert response.best_model_path == str(model_a)
    assert response.models[0]["metrics"] == {"r2": 0.8, "rmse": 0.2}
    assert response.models[0]["runtime"]["runtime_source"] == "python_oracle"
    assert response.models[0]["runtime"]["engine"] == "legacy"
    assert predict_calls[0]["model"] == str(model_a)
    assert np.asarray(predict_calls[0]["data"]).tolist() == [[1.0, 2.0], [3.0, 4.0]]
    assert "engine" not in predict_calls[0]
    assert "allow_fallback" not in predict_calls[0]
    assert metric_calls[0] == ([1.0, 2.0], [1.1, 2.1], "regression")


def test_compare_models_refuses_dagml_without_fallback(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    model_a = tmp_path / "a.n4a"
    model_b = tmp_path / "b.n4a"
    model_a.write_text("a", encoding="utf-8")
    model_b.write_text("b", encoding="utf-8")
    dataset = _FakeDataset([[1.0, 2.0]], [1.0])
    calls: list[dict[str, Any]] = []

    class FakeNirs4all:
        def predict(self, **kwargs):
            calls.append(kwargs)
            return _FakePredictResult([1.0])

    import api.spectra as spectra_api

    monkeypatch.setattr(models_api, "get_cached", lambda key: FakeNirs4all() if key == "nirs4all" else None)
    monkeypatch.setattr(spectra_api, "_load_dataset", lambda dataset_path: dataset)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            models_api.compare_models(
                models_api.CompareModelsRequest(
                    model_paths=[str(model_a), str(model_b)],
                    dataset_path="dataset-a",
                    engine="dag-ml",
                    allow_fallback=False,
                )
            )
        )

    assert exc_info.value.status_code == 501
    assert exc_info.value.detail["unsupported_capability"] == "dagml_predict"
    assert calls == []


def test_prediction_runtime_rejects_unknown_engine() -> None:
    with pytest.raises(RtUnsupportedError) as exc_info:
        prediction_runtime.predict_with_runtime_record(
            lambda **kwargs: _FakePredictResult([1.0]),
            predict_kwargs={"model": "m", "data": [[1.0]]},
            engine="unknown",
        )

    assert exc_info.value.rt_error.cause == "invalid_request"
    assert "unknown" in exc_info.value.rt_error.message
