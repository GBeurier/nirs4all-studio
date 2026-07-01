"""Tests for predict.py metric routing through nirs4all.core.metrics.

B-017: Studio's prediction endpoint must

1. stop re-rolling RMSE/R²/MAE/RPD with sklearn and route through the library's
   single metric implementation (``nirs4all.core.metrics.eval_multi``), and
2. resolve the task type with the library's detector
   (``nirs4all.core.task_detection.detect_task_type``) instead of assuming
   ``"regression"`` —

so a classification model gets classification metrics (accuracy/F1/...) rather
than meaningless RMSE/R² computed on its class labels, and Studio's numbers stay
identical to the engine's and to ``api/evaluation.py``.
"""

from __future__ import annotations

import asyncio
import io
from types import SimpleNamespace

import numpy as np  # noqa: E402
import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.testclient import TestClient

# ``api.predict``'s first import is ``from .lazy_imports import get_cached``,
# which makes ``lazy_imports`` the entry point of the lazy_imports <-> api.shared
# import cycle and raises ``ImportError`` when ``api.predict`` is imported in
# isolation. Importing ``api.shared`` first — exactly as the app does at startup
# — fully initialises ``lazy_imports`` and breaks the cycle for standalone runs.
import api.shared  # noqa: F401,E402  (import-order guard; must precede api.predict)
from api import predict as predict_mod  # noqa: E402


class _FakePredictResult:
    def __init__(self, y_pred):
        self.y_pred = np.asarray(y_pred, dtype=float)
        self.model_name = "FakeModel"
        self.preprocessing_steps = ["snv"]


class _FakeTaskType:
    """Stand-in for ``nirs4all`` ``TaskType`` (predict only reads ``.value``)."""

    def __init__(self, value: str):
        self.value = value


class _FakeNirs4all:
    def __init__(self, y_pred, calls: list[dict[str, object]] | None = None):
        self._y_pred = y_pred
        self._calls = calls

    def predict(self, **kwargs):
        if self._calls is not None:
            self._calls.append(dict(kwargs))
        return _FakePredictResult(self._y_pred)


def _fake_get_cached_factory(
    *,
    y_pred,
    eval_multi=None,
    task_type_value: str = "regression",
    detect_raises: bool = False,
    captured: dict | None = None,
):
    """Build a ``get_cached`` stand-in returning fakes for the library helpers."""

    def detect_task_type(y):
        if captured is not None:
            captured["detect_y"] = np.asarray(y).flatten().tolist()
        if detect_raises:
            raise ValueError("Target array contains only NaN values")
        return _FakeTaskType(task_type_value)

    table = {
        "nirs4all": _FakeNirs4all(y_pred),
        "detect_task_type": detect_task_type,
    }
    if eval_multi is not None:
        table["eval_multi"] = eval_multi

    def fake_get_cached(key, **kwargs):
        return table.get(key)

    return fake_get_cached


def test_run_prediction_routes_metrics_through_eval_multi(monkeypatch):
    """Regression path: metrics come from eval_multi keyed on the detected type."""
    y_true = [1.0, 2.0, 3.0, 4.0, 5.0]
    y_pred = [1.1, 1.9, 3.2, 3.8, 5.1]
    captured: dict[str, object] = {}

    def fake_eval_multi(yt, yp, task_type):
        captured["task_type"] = task_type
        captured["y_true"] = np.asarray(yt).tolist()
        captured["y_pred"] = np.asarray(yp).tolist()
        # Full eval_multi-style dict (superset of the old 4-key re-roll).
        return {"rmse": 0.15, "r2": 0.99, "mae": 0.14, "rpd": 9.6, "pearson_r": 0.99}

    monkeypatch.setattr(
        predict_mod,
        "get_cached",
        _fake_get_cached_factory(
            y_pred=y_pred,
            eval_multi=fake_eval_multi,
            task_type_value="regression",
            captured=captured,
        ),
    )
    monkeypatch.setattr(
        predict_mod.workspace_manager, "get_current_workspace", lambda: None
    )

    response = predict_mod._run_prediction(
        "chain123", "chain", np.zeros((5, 10)), y_true=y_true
    )

    # Metrics come from eval_multi (incl. keys the old sklearn re-roll never had).
    assert response.metrics == {
        "rmse": 0.15,
        "r2": 0.99,
        "mae": 0.14,
        "rpd": 9.6,
        "pearson_r": 0.99,
    }
    # Task type is the value resolved by the library detector, not a constant,
    # and detection runs on the ground-truth (same contract as evaluation.py).
    assert captured["task_type"] == "regression"
    assert captured["detect_y"] == y_true
    assert captured["y_true"] == y_true
    assert response.actual_values == y_true


def test_run_prediction_uses_detected_classification_task_type(monkeypatch):
    """Classification path: a classifier must NOT get regression metrics.

    This is the behaviour the hardcoded ``"regression"`` broke — it would have
    asked eval_multi for RMSE/R² on integer class labels. With library task-type
    detection, eval_multi is invoked with ``"binary_classification"`` and the
    classification metric dict flows straight through.
    """
    y_true = [0.0, 1.0, 1.0, 0.0, 1.0, 0.0]
    y_pred = [0.0, 1.0, 0.0, 0.0, 1.0, 1.0]
    captured: dict[str, object] = {}

    def fake_eval_multi(yt, yp, task_type):
        captured["task_type"] = task_type
        # Classification-shaped dict (no rmse/r2 keys at all).
        return {"accuracy": 0.6667, "f1": 0.6667, "balanced_accuracy": 0.6667}

    monkeypatch.setattr(
        predict_mod,
        "get_cached",
        _fake_get_cached_factory(
            y_pred=y_pred,
            eval_multi=fake_eval_multi,
            task_type_value="binary_classification",
            captured=captured,
        ),
    )
    monkeypatch.setattr(
        predict_mod.workspace_manager, "get_current_workspace", lambda: None
    )

    response = predict_mod._run_prediction(
        "chain123", "chain", np.zeros((6, 10)), y_true=y_true
    )

    assert captured["task_type"] == "binary_classification"
    assert response.metrics == {
        "accuracy": 0.6667,
        "f1": 0.6667,
        "balanced_accuracy": 0.6667,
    }
    # No regression keys leaked in.
    assert "rmse" not in response.metrics
    assert "r2" not in response.metrics


def test_run_prediction_metrics_none_when_task_detection_fails(monkeypatch):
    """If the library detector raises, metrics degrade to None but predictions
    are still returned (best-effort metric block, never fatal)."""
    y_true = [float("nan"), float("nan"), float("nan")]
    y_pred = [1.0, 2.0, 3.0]

    def fake_eval_multi(yt, yp, task_type):  # pragma: no cover - must not run
        raise AssertionError("eval_multi must not be reached when detection fails")

    monkeypatch.setattr(
        predict_mod,
        "get_cached",
        _fake_get_cached_factory(
            y_pred=y_pred,
            eval_multi=fake_eval_multi,
            detect_raises=True,
        ),
    )
    monkeypatch.setattr(
        predict_mod.workspace_manager, "get_current_workspace", lambda: None
    )

    response = predict_mod._run_prediction(
        "chain123", "chain", np.zeros((3, 10)), y_true=y_true
    )
    assert response.metrics is None
    assert response.predictions == y_pred


def test_run_prediction_without_y_true_has_no_metrics(monkeypatch):
    y_pred = [1.0, 2.0, 3.0]

    monkeypatch.setattr(
        predict_mod,
        "get_cached",
        _fake_get_cached_factory(y_pred=y_pred),
    )
    monkeypatch.setattr(
        predict_mod.workspace_manager, "get_current_workspace", lambda: None
    )

    response = predict_mod._run_prediction("chain123", "chain", np.zeros((3, 10)))
    assert response.metrics is None
    assert response.predictions == y_pred


def test_predict_json_returns_runtime_without_forwarding_runtime_kwargs(monkeypatch, tmp_path):
    calls: list[dict[str, object]] = []
    workspace = SimpleNamespace(path=str(tmp_path))

    monkeypatch.setattr(
        predict_mod,
        "get_cached",
        lambda key: _FakeNirs4all([1.0, 2.0], calls) if key == "nirs4all" else None,
    )
    monkeypatch.setattr(
        predict_mod.workspace_manager, "get_current_workspace", lambda: workspace
    )

    response = asyncio.run(
        predict_mod.predict(
            predict_mod.PredictRequest(
                model_id="chain123",
                model_source="chain",
                data_source="array",
                spectra=[[1.0, 2.0], [3.0, 4.0]],
            )
        )
    )

    assert response.predictions == [1.0, 2.0]
    assert response.runtime["runtime_source"] == "python_oracle"
    assert response.runtime["engine"] == "legacy"
    assert calls[0]["chain_id"] == "chain123"
    assert calls[0]["workspace_path"] == str(tmp_path)
    assert np.asarray(calls[0]["data"]).tolist() == [[1.0, 2.0], [3.0, 4.0]]
    assert "engine" not in calls[0]
    assert "allow_fallback" not in calls[0]


def test_predict_json_refuses_dagml_without_fallback(monkeypatch, tmp_path):
    calls: list[dict[str, object]] = []
    workspace = SimpleNamespace(path=str(tmp_path))

    monkeypatch.setattr(
        predict_mod,
        "get_cached",
        lambda key: _FakeNirs4all([1.0], calls) if key == "nirs4all" else None,
    )
    monkeypatch.setattr(
        predict_mod.workspace_manager, "get_current_workspace", lambda: workspace
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            predict_mod.predict(
                predict_mod.PredictRequest(
                    model_id="chain123",
                    model_source="chain",
                    data_source="array",
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


def test_predict_json_dagml_fallback_records_python_oracle(monkeypatch, tmp_path):
    calls: list[dict[str, object]] = []
    workspace = SimpleNamespace(path=str(tmp_path))

    monkeypatch.setattr(
        predict_mod,
        "get_cached",
        lambda key: _FakeNirs4all([5.0], calls) if key == "nirs4all" else None,
    )
    monkeypatch.setattr(
        predict_mod.workspace_manager, "get_current_workspace", lambda: workspace
    )

    response = asyncio.run(
        predict_mod.predict(
            predict_mod.PredictRequest(
                model_id="chain123",
                model_source="chain",
                data_source="array",
                spectra=[[1.0, 2.0]],
                engine="dag-ml",
                allow_fallback=True,
            )
        )
    )

    assert response.predictions == [5.0]
    assert response.runtime["engine_requested"] == "dag-ml"
    assert response.runtime["runtime_source"] == "python_oracle_fallback"
    assert response.runtime["fallback_policy"]["allow_fallback"] is True
    assert response.runtime["engine_diagnostics"][0]["unsupported_capability"] == "dagml_predict"
    assert "engine" not in calls[0]
    assert "allow_fallback" not in calls[0]


def test_predict_file_threads_runtime_policy(monkeypatch, tmp_path):
    calls: list[dict[str, object]] = []
    workspace = SimpleNamespace(path=str(tmp_path))
    upload = UploadFile(
        filename="spectra.csv",
        file=io.BytesIO(b"sample_id,w1,w2\ns1,1.0,2.0\ns2,3.0,4.0\n"),
    )

    monkeypatch.setattr(
        predict_mod,
        "get_cached",
        lambda key: _FakeNirs4all([6.0, 7.0], calls) if key == "nirs4all" else None,
    )
    monkeypatch.setattr(
        predict_mod.workspace_manager, "get_current_workspace", lambda: workspace
    )

    response = asyncio.run(
        predict_mod.predict_from_file(
            model_id="chain123",
            model_source="chain",
            engine="dag-ml",
            allow_fallback=True,
            file=upload,
        )
    )

    assert response.predictions == [6.0, 7.0]
    assert response.sample_ids == ["s1", "s2"]
    assert response.runtime["runtime_source"] == "python_oracle_fallback"
    assert response.runtime["engine_requested"] == "dag-ml"
    assert np.asarray(calls[0]["data"]).tolist() == [[1.0, 2.0], [3.0, 4.0]]
    assert "engine" not in calls[0]
    assert "allow_fallback" not in calls[0]


def _predict_test_client() -> TestClient:
    app = FastAPI()
    app.include_router(predict_mod.router, prefix="/api")
    return TestClient(app)


def test_predict_json_http_serializes_runtime(monkeypatch, tmp_path):
    calls: list[dict[str, object]] = []
    workspace = SimpleNamespace(path=str(tmp_path))

    monkeypatch.setattr(
        predict_mod,
        "get_cached",
        lambda key: _FakeNirs4all([8.0], calls) if key == "nirs4all" else None,
    )
    monkeypatch.setattr(
        predict_mod.workspace_manager, "get_current_workspace", lambda: workspace
    )

    with _predict_test_client() as client:
        response = client.post(
            "/api/predict",
            json={
                "model_id": "chain123",
                "model_source": "chain",
                "data_source": "array",
                "spectra": [[1.0, 2.0]],
                "engine": "dag-ml",
                "allow_fallback": True,
            },
        )

    payload = response.json()
    assert response.status_code == 200
    assert payload["predictions"] == [8.0]
    assert payload["runtime"]["runtime_source"] == "python_oracle_fallback"
    assert payload["runtime"]["engine_requested"] == "dag-ml"
    assert calls[0]["chain_id"] == "chain123"
    assert "engine" not in calls[0]
    assert "allow_fallback" not in calls[0]


def test_predict_json_http_bundle_serializes_runtime(monkeypatch, tmp_path):
    calls: list[dict[str, object]] = []
    workspace = SimpleNamespace(path=str(tmp_path))
    bundle_path = tmp_path / "bundle.n4a"

    monkeypatch.setattr(
        predict_mod,
        "get_cached",
        lambda key: _FakeNirs4all([9.0], calls) if key == "nirs4all" else None,
    )
    monkeypatch.setattr(
        predict_mod.workspace_manager, "get_current_workspace", lambda: workspace
    )
    monkeypatch.setattr(predict_mod, "_resolve_bundle_path", lambda _model_id: bundle_path)

    with _predict_test_client() as client:
        response = client.post(
            "/api/predict",
            json={
                "model_id": "bundle",
                "model_source": "bundle",
                "data_source": "array",
                "spectra": [[1.0, 2.0]],
                "engine": "dag-ml",
                "allow_fallback": True,
            },
        )

    payload = response.json()
    assert response.status_code == 200
    assert payload["predictions"] == [9.0]
    assert payload["runtime"]["runtime_source"] == "python_oracle_fallback"
    assert payload["runtime"]["engine_requested"] == "dag-ml"
    assert calls[0]["model"] == str(bundle_path)
    assert "engine" not in calls[0]
    assert "allow_fallback" not in calls[0]


def test_predict_json_http_refuses_dagml_without_fallback(monkeypatch, tmp_path):
    calls: list[dict[str, object]] = []
    workspace = SimpleNamespace(path=str(tmp_path))

    monkeypatch.setattr(
        predict_mod,
        "get_cached",
        lambda key: _FakeNirs4all([1.0], calls) if key == "nirs4all" else None,
    )
    monkeypatch.setattr(
        predict_mod.workspace_manager, "get_current_workspace", lambda: workspace
    )

    with _predict_test_client() as client:
        response = client.post(
            "/api/predict",
            json={
                "model_id": "chain123",
                "model_source": "chain",
                "data_source": "array",
                "spectra": [[1.0, 2.0]],
                "engine": "dag-ml",
                "allow_fallback": False,
            },
        )

    payload = response.json()
    assert response.status_code == 501
    assert payload["detail"]["cause"] == "unsupported_capability"
    assert payload["detail"]["unsupported_capability"] == "dagml_predict"
    assert calls == []


def test_predict_file_http_parses_runtime_policy(monkeypatch, tmp_path):
    calls: list[dict[str, object]] = []
    workspace = SimpleNamespace(path=str(tmp_path))

    monkeypatch.setattr(
        predict_mod,
        "get_cached",
        lambda key: _FakeNirs4all([6.0, 7.0], calls) if key == "nirs4all" else None,
    )
    monkeypatch.setattr(
        predict_mod.workspace_manager, "get_current_workspace", lambda: workspace
    )

    with _predict_test_client() as client:
        response = client.post(
            "/api/predict/file",
            data={
                "model_id": "chain123",
                "model_source": "chain",
                "engine": "dag-ml",
                "allow_fallback": "true",
            },
            files={
                "file": (
                    "spectra.csv",
                    b"sample_id,w1,w2\ns1,1.0,2.0\ns2,3.0,4.0\n",
                    "text/csv",
                )
            },
        )

    payload = response.json()
    assert response.status_code == 200
    assert payload["sample_ids"] == ["s1", "s2"]
    assert payload["runtime"]["runtime_source"] == "python_oracle_fallback"
    assert payload["runtime"]["engine_requested"] == "dag-ml"
    assert np.asarray(calls[0]["data"]).tolist() == [[1.0, 2.0], [3.0, 4.0]]
    assert "engine" not in calls[0]
    assert "allow_fallback" not in calls[0]
