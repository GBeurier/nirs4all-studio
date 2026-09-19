"""Real Studio training must retain every sequential model and its predictions."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from sklearn.cross_decomposition import PLSRegression
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import api.shared  # noqa: F401 (initialize application lazy imports)


@pytest.fixture(scope="module", autouse=True)
def initialized_scientific_dependencies():
    """Exercise the same real initialization barrier as the running backend."""
    from api.lazy_imports import _do_load_ml_deps, get_ml_status, is_ml_ready

    _do_load_ml_deps()
    assert is_ml_ready(), get_ml_status()


@pytest.mark.parametrize("with_cv", [False, True], ids=["train-only", "kfold"])
def test_sequential_models_survive_studio_training_results_and_export(tmp_path, monkeypatch, with_cv):
    import nirs4all
    from nirs4all.pipeline.storage import WorkspaceStore

    from api import runs, spectra
    from api.results_repository import resolve_results_repository
    from api.store_adapter import StoreAdapter
    from api.workspace.services import _build_results_summary_payload

    X = np.random.default_rng(783).normal(size=(48, 6))
    y = 3 * X[:, 0] - 1.7 * X[:, 1] + 0.1 * X[:, 2] ** 2
    data = tmp_path / "data"
    data.mkdir()
    np.savetxt(data / "X.csv", X, delimiter=";", header=";".join(str(1000 + i) for i in range(6)), comments="")
    np.savetxt(data / "Y.csv", y, delimiter=";", header="target", comments="")
    dataset_id = f"sequential-{with_cv}"
    record = {"id": dataset_id, "name": dataset_id, "path": str(data), "config": {
        "files": [{"path": str(data / "X.csv"), "type": "X", "split": "train"},
                  {"path": str(data / "Y.csv"), "type": "Y", "split": "train"}],
        "delimiter": ";", "has_header": True, "task_type": "regression",
    }}
    workspace_path = tmp_path / "workspace"
    workspace = SimpleNamespace(path=str(workspace_path), datasets=[record])
    # Bind the application to this disposable profile; all loading, conversion,
    # fitting, storage and replay below use the real implementations.
    monkeypatch.setattr(runs.workspace_manager, "get_current_workspace", lambda: workspace)
    monkeypatch.setattr(spectra, "_dataset_cache", spectra._DatasetLRUCache(2))
    with WorkspaceStore(workspace_path) as store:
        shared_run_id = store.begin_run("Sequential models", {}, [{"name": dataset_id, "path": str(data)}])

    def step(kind, name, path, **params):
        return {"id": name, "type": kind, "name": name, "classPath": path, "params": params}

    steps = [step("preprocessing", "StandardScaler", "sklearn.preprocessing.StandardScaler")]
    if with_cv:
        steps.append(step("splitting", "KFold", "sklearn.model_selection.KFold", n_splits=3))
    steps.extend([step("model", "Ridge", "sklearn.linear_model.Ridge", alpha=8.0),
                  step("model", "PLSRegression", "sklearn.cross_decomposition.PLSRegression", n_components=2)])
    pipeline = runs.PipelineRun(id="sequential", pipeline_id="sequential", pipeline_name="Sequential models",
                                model="Ridge, PLSRegression", preprocessing="StandardScaler",
                                split_strategy="KFold" if with_cv else "None", status="running", config={"steps": steps})
    outcome = runs._execute_pipeline_training(pipeline, dataset_id, str(workspace_path), "studio-run",
                                              store_run_id=shared_run_id, engine="legacy")
    assert outcome["engine"] == "legacy"
    assert outcome["store_run_id"] == shared_run_id
    if with_cv:
        assert outcome["model_path"] and Path(outcome["model_path"]).is_file(), outcome["logs"]
        assert outcome["metrics"], outcome["logs"]
    else:
        assert outcome["model_path"] is None  # No evaluation partition to select a best model.

    repository = resolve_results_repository(workspace_path, workspace_store_factory=WorkspaceStore)
    try:
        summary = _build_results_summary_payload(repository, "workspace", [record], n=10)
        assert len(summary["datasets"]) == 1
        summary_chains = summary["datasets"][0]["top_chains"]
        assert {row["model_name"] for row in summary_chains} == {"Ridge", "PLSRegression"}
        if not with_cv:
            for chain in summary_chains:
                assert chain["fold_count"] == 0
                assert chain["avg_val_score"] is None and chain["avg_test_score"] is None
                assert chain["final_train_score"] is None and chain["final_test_score"] is None
                assert chain["synthetic_refit"] is False
                model = Ridge(alpha=8.0) if chain["model_name"] == "Ridge" else PLSRegression(n_components=2)
                expected = make_pipeline(StandardScaler(), model).fit(X, y).predict(X).ravel()
                rmse = np.sqrt(np.mean((y - expected) ** 2))
                assert chain["avg_train_score"] == pytest.approx(rmse, abs=1e-6)
                assert chain["scores"]["train"]["rmse"] == pytest.approx(rmse, abs=1e-6)
    finally:
        repository.close()

    with StoreAdapter(workspace_path) as adapter:
        chains = adapter.get_all_chains_for_results_dataset(dataset_id)["chains"]
        assert {row["model_name"] for row in chains} == {"Ridge", "PLSRegression"}, chains
        assert len({row["chain_id"] for row in chains}) == len(chains)
        assert {row["run_id"] for row in chains} == {shared_run_id}
        top = adapter.get_dataset_top_chains(n=10)["datasets"]
        assert len(top) == 1
        assert {row["model_name"] for row in top[0]["top_chains"]} == {"Ridge", "PLSRegression"}, top
        rows = adapter.store.query_predictions(run_id=shared_run_id).to_dicts()
        assert {row["model_name"] for row in rows} == {"Ridge", "PLSRegression"}
        for row in rows:
            saved = adapter.store.get_prediction(row["prediction_id"], load_arrays=True)
            if saved["y_pred"] is None:
                assert row["partition"] == "val" and not with_cv
                assert row["val_score"] is None
                continue
            actual_rmse = np.sqrt(np.mean((np.asarray(saved["y_true"]).ravel() - np.asarray(saved["y_pred"]).ravel()) ** 2))
            assert np.isfinite(actual_rmse)
            assert actual_rmse == pytest.approx(row[f'{row["partition"]}_score'], abs=1e-6)

        for chain in chains:
            assert chain["final_test_score"] is None
            assert chain["synthetic_refit"] is False
            if not with_cv:
                assert chain["cv_fold_count"] == 0
                assert chain["cv_val_score"] is None
                assert chain["cv_test_score"] is None
                assert chain["final_train_score"] is None
                model = Ridge(alpha=8.0) if chain["model_name"] == "Ridge" else PLSRegression(n_components=2)
                expected = make_pipeline(StandardScaler(), model).fit(X, y).predict(X).ravel()
                rmse = np.sqrt(np.mean((y - expected) ** 2))
                assert chain["cv_train_score"] == pytest.approx(rmse, abs=1e-6)
                assert chain["cv_scores"]["train"]["rmse"] == pytest.approx(rmse, abs=1e-6)
                archive = adapter.store.export_chain(chain["chain_id"], tmp_path / f'{chain["model_name"]}.n4a')
                replay = nirs4all.predict(archive, X, engine="legacy", verbose=0)
                np.testing.assert_allclose(np.asarray(replay.y_pred).ravel(), expected, atol=1e-5)
            elif not chain["is_refit_only"]:
                assert chain["cv_fold_count"] == 3
                assert np.isfinite(chain["cv_val_score"])
    if with_cv:
        replay = nirs4all.predict(outcome["model_path"], X, engine="legacy", verbose=0)
        expected = [make_pipeline(StandardScaler(), model).fit(X, y).predict(X).ravel()
                    for model in (Ridge(alpha=8.0), PLSRegression(n_components=2))]
        assert any(np.allclose(np.asarray(replay.y_pred).ravel(), reference, atol=1e-5) for reference in expected)
