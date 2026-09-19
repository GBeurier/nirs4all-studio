"""A real Studio run must use the requested neural training settings."""
from types import SimpleNamespace

import numpy as np
import pytest

torch = pytest.importorskip("torch")


def test_studio_neural_epochs_batch_size_and_learning_rate_are_effective(tmp_path, monkeypatch):
    from nirs4all.pipeline.storage import WorkspaceStore

    import api.shared  # noqa: F401
    from api import runs
    from api.lazy_imports import _do_load_ml_deps, is_ml_ready

    _do_load_ml_deps()
    assert is_ml_ready()
    X = np.random.default_rng(521).normal(size=(36, 256))
    y = X[:, 0] + .2 * X[:, 1] + 4
    folder = tmp_path / "data"
    folder.mkdir()
    np.savetxt(folder / "X.csv", X, delimiter=";", header=";".join(str(1000+i) for i in range(256)), comments="")
    np.savetxt(folder / "Y.csv", y, delimiter=";", header="target", comments="")
    record = {"id": "neural", "name": "neural", "path": str(folder), "config": {
        "files": [{"path": str(folder / "X.csv"), "type": "X", "split": "train"},
                  {"path": str(folder / "Y.csv"), "type": "Y", "split": "train"}],
        "delimiter": ";", "has_header": True, "task_type": "regression"}}
    workspace = tmp_path / "workspace"
    monkeypatch.setattr(runs.workspace_manager, "get_current_workspace", lambda: SimpleNamespace(path=str(workspace), datasets=[record]))
    updates = []
    original_step = torch.optim.Adam.step

    def record_update(optimizer, *args, **kwargs):
        updates.append(optimizer.param_groups[0]["lr"])
        return original_step(optimizer, *args, **kwargs)

    monkeypatch.setattr(torch.optim.Adam, "step", record_update)
    steps = [
        {"id": "scale", "type": "preprocessing", "name": "StandardScaler", "classPath": "sklearn.preprocessing.StandardScaler", "params": {}},
        {"id": "folds", "type": "splitting", "name": "KFold", "classPath": "sklearn.model_selection.KFold", "params": {"n_splits": 2}},
        {"id": "model", "type": "model", "name": "Transformer", "classPath": "nirs4all.operators.models.pytorch.spectral_transformer.spectral_transformer",
         "params": {"epochs": 3, "batch_size": 64, "learning_rate": .004, "d_model": 16, "nhead": 2, "num_layers": 1}},
    ]
    pipeline = runs.PipelineRun(id="neural", pipeline_id="neural", pipeline_name="Neural", model="Transformer",
                               preprocessing="StandardScaler", split_strategy="KFold", status="running", config={"steps": steps})
    with WorkspaceStore(workspace) as store:
        run_id = store.begin_run("Neural settings", {}, [{"name": "neural"}])
    outcome = runs._execute_pipeline_training(pipeline, "neural", str(workspace), "neural", store_run_id=run_id, engine="legacy")
    assert outcome["metrics"]
    # Two CV fits of18 samples and one refit of36: each fits a single
    # batch per requested epoch. Defaults100epochs/batch32 would fail this.
    assert len(updates) == 9, updates
    assert updates == pytest.approx([.004] * 9)
    with WorkspaceStore(workspace) as store:
        rows = store.query_predictions(run_id=run_id).to_dicts()
        assert rows
        model_artifact = store.load_artifact(next(iter(store.get_chain(rows[0]["chain_id"])["fold_artifacts"].values())))
        assert model_artifact.cls_token.shape[-1] == 16
        assert len(model_artifact.blocks) == 1
