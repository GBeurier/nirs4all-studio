"""Real owner arrays retain their sample/output shape through both viewer routes."""
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.shared  # noqa: F401
from api.store_adapter import StoreAdapter


@pytest.mark.parametrize("outputs", [1, 2])
def test_real_training_arrays_are_rectangular_on_both_routes(tmp_path, monkeypatch, outputs):
    import nirs4all
    from nirs4all.pipeline.storage import WorkspaceStore
    from sklearn.linear_model import Ridge

    from api import aggregated_predictions
    from api.lazy_imports import _do_load_ml_deps, get_ml_status, is_ml_ready
    from api.workspace import router_discovery

    _do_load_ml_deps()
    assert is_ml_ready(), get_ml_status()
    rng = np.random.default_rng(771)
    X = rng.normal(size=(20, 4))
    y = X[:, 0] if outputs == 1 else np.column_stack([X[:, 0], 10 * X[:, 1]])
    nirs4all.run([Ridge()], (X, y), engine="legacy", workspace_path=tmp_path, verbose=0)
    with WorkspaceStore.open_readonly(tmp_path) as store:
        rows = store.query_predictions(partition="train").to_dicts()
        prediction_id = rows[0]["prediction_id"]
        expected = store.get_prediction(prediction_id, load_arrays=True)
    monkeypatch.setattr(router_discovery.workspace_manager, "_find_linked_workspace", lambda _: SimpleNamespace(path=str(tmp_path)))
    monkeypatch.setattr(aggregated_predictions, "_get_store", lambda: WorkspaceStore.open_readonly(tmp_path))
    app = FastAPI()
    app.include_router(router_discovery.router, prefix="/api")
    app.include_router(aggregated_predictions.router, prefix="/api")
    client = TestClient(app)
    for route in [f"/api/workspaces/fixture/predictions/{prediction_id}/scatter", f"/api/aggregated-predictions/{prediction_id}/arrays"]:
        response = client.get(route)
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["n_samples"] == 20
        np.testing.assert_allclose(payload["y_true"], expected["y_true"])
        np.testing.assert_allclose(payload["y_pred"], expected["y_pred"])
        assert np.asarray(payload["y_pred"]).shape == ((20,) if outputs == 1 else (20, 2))


def test_scatter_keeps_persisted_ids_and_rejects_misaligned_rows():
    adapter = StoreAdapter.__new__(StoreAdapter)
    store = Mock()
    adapter._store = store
    row = {"y_true": np.array([[1, 10], [2, 20]]), "y_pred": np.array([[1, 12], [2, 24]]), "sample_ids": ["one", "two"]}
    store.get_prediction.return_value = row
    payload = adapter.get_prediction_scatter("fixture")
    assert payload["sample_ids"] == ["one", "two"]
    assert payload["n_samples"] == 2
    row["sample_ids"] = ["one"]
    with pytest.raises(ValueError, match="identities"):
        adapter.get_prediction_scatter("fixture")
    row.pop("sample_ids")
    row["y_pred"] = [1, 2]
    with pytest.raises(ValueError, match="sample/output shapes"):
        adapter.get_prediction_scatter("fixture")
