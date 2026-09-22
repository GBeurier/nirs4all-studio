"""Recovery trains and replays real Python models with the current store library."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import numpy as np
import pytest
from sklearn.linear_model import Ridge
from sklearn.model_selection import KFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import api.shared  # noqa: F401 (same lazy-import initialization as application startup)


def test_recovery_predict_and_batch_replay_its_actual_refit_model(tmp_path, monkeypatch):
    import nirs4all

    from api import predict, predictions, recommended_config
    from api.runtime_engine import engine_run_kwargs

    monkeypatch.setattr(recommended_config, "recovery_nirs4all_version", lambda: "1.1.2")
    monkeypatch.setenv("N4A_ENGINE", "dag-ml")
    X = np.random.default_rng(212).normal(size=(40, 5))
    y = X[:, 0] * 2 + X[:, 1]
    expected = make_pipeline(StandardScaler(), Ridge()).fit(X[:32], y[:32]).predict(X[32:])
    with nirs4all.run([StandardScaler(), KFold(n_splits=2), Ridge()], (X, y, {"train": 32}),
                      **engine_run_kwargs(None), workspace_path=tmp_path / "workspace",
                      verbose=0, save_charts=False) as result:
        archive = result.export(tmp_path / "trained.n4a")
        chain_id = result.final["chain_id"]
    workspace = SimpleNamespace(path=str(tmp_path / "workspace"))
    monkeypatch.setattr(predict.workspace_manager, "get_current_workspace", lambda: workspace)
    monkeypatch.setattr(predict, "_resolve_bundle_path", lambda _: archive)
    monkeypatch.setattr(predict, "get_cached", lambda key, **kwargs: nirs4all if key == "nirs4all" else None)
    monkeypatch.setattr(predictions, "get_cached", lambda key, **kwargs: nirs4all if key == "nirs4all" else None)
    for model_id, source in ((str(archive), "bundle"), (chain_id, "chain")):
        response = predict._run_prediction(model_id, source, X[32:])
        np.testing.assert_allclose(np.asarray(response.predictions).ravel(), expected, atol=1e-5)
    response = asyncio.run(predictions.predict_batch(predictions.PredictBatchRequest(
        model_id=str(archive), spectra=X[32:].tolist())))
    np.testing.assert_allclose(np.asarray(response.predictions).ravel(), expected, atol=1e-5)
    assert response.num_samples == 8


def test_replay_policy_only_changes_recovery_releases(monkeypatch):
    from api import recommended_config
    from api.runtime_engine import recovery_replay_kwargs

    monkeypatch.setattr(recommended_config, "recovery_nirs4all_version", lambda: None)
    assert recovery_replay_kwargs() == {}
    monkeypatch.setattr(recommended_config, "recovery_nirs4all_version", lambda: "1.1.2")
    assert recovery_replay_kwargs() == {"engine": "legacy"}
