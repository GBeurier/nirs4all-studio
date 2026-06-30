"""Tests for predict.py metric routing through nirs4all.core.metrics.eval_multi.

B-017 V1: Studio's prediction endpoint must stop re-rolling RMSE/R²/MAE/RPD with
sklearn and instead route through the library's single metric implementation, so
Studio metrics match the engine's and are oracle-checkable.
"""

from __future__ import annotations

import numpy as np

from api import predict as predict_mod


class _FakePredictResult:
    def __init__(self, y_pred):
        self.y_pred = np.asarray(y_pred, dtype=float)
        self.model_name = "FakeModel"
        self.preprocessing_steps = ["snv"]


def test_run_prediction_routes_metrics_through_eval_multi(monkeypatch):
    y_true = [1.0, 2.0, 3.0, 4.0, 5.0]
    y_pred = [1.1, 1.9, 3.2, 3.8, 5.1]
    captured: dict[str, object] = {}

    def fake_eval_multi(yt, yp, task_type):
        captured["task_type"] = task_type
        captured["y_true"] = np.asarray(yt).tolist()
        captured["y_pred"] = np.asarray(yp).tolist()
        # Full eval_multi-style dict (superset of the old 4-key re-roll).
        return {"rmse": 0.15, "r2": 0.99, "mae": 0.14, "rpd": 9.6, "pearson_r": 0.99}

    class _FakeNirs4all:
        @staticmethod
        def predict(**kwargs):
            return _FakePredictResult(y_pred)

    def fake_get_cached(key, **kwargs):
        return {"nirs4all": _FakeNirs4all, "eval_multi": fake_eval_multi}.get(key)

    monkeypatch.setattr(predict_mod, "get_cached", fake_get_cached)
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
    assert captured["task_type"] == "regression"
    assert captured["y_true"] == y_true
    assert response.actual_values == y_true


def test_run_prediction_without_y_true_has_no_metrics(monkeypatch):
    y_pred = [1.0, 2.0, 3.0]

    class _FakeNirs4all:
        @staticmethod
        def predict(**kwargs):
            return _FakePredictResult(y_pred)

    def fake_get_cached(key, **kwargs):
        return {"nirs4all": _FakeNirs4all}.get(key)

    monkeypatch.setattr(predict_mod, "get_cached", fake_get_cached)
    monkeypatch.setattr(
        predict_mod.workspace_manager, "get_current_workspace", lambda: None
    )

    response = predict_mod._run_prediction("chain123", "chain", np.zeros((3, 10)))
    assert response.metrics is None
    assert response.predictions == y_pred
