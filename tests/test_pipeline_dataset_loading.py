"""Execution must load the same configured targets as dataset preview."""

from functools import wraps
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from api import pipelines, spectra
from api.nirs4all_adapter import build_dataset_config
from api.shared.dataset_config import build_nirs4all_config_from_stored, for_dataset_configs


@pytest.fixture(params=["wizard", "library"])
def configured_dataset(request, tmp_path, monkeypatch):
    rng = np.random.default_rng(42)
    x = rng.normal(size=(24, 6))
    y = 2 * x[:, 0] - x[:, 1]
    # The target filename deliberately cannot be inferred from the folder.
    np.savetxt(tmp_path / "Xcal.csv", x, delimiter=";")
    np.savetxt(tmp_path / "response.csv", y, delimiter=",")
    parsing = {"delimiter": ";", "has_header": False, "na_policy": "ignore"}
    if request.param == "wizard":
        config = {**parsing, "global_params": {"has_header": True}, "files": [
            {"path": "Xcal.csv", "type": "X", "split": "train"},
            {"path": "response.csv", "type": "Y", "split": "train", "overrides": {"delimiter": ","}},
        ]}
    else:
        config = {"train_x": str(tmp_path / "Xcal.csv"), "train_y": str(tmp_path / "response.csv"), "global_params": parsing,
                  "train_y_params": {"delimiter": ","}, "task_type": "regression"}
    record = {"id": "configured-target", "name": "Configured target", "path": str(tmp_path), "config": config}
    monkeypatch.setattr("api.nirs4all_adapter.get_dataset_record", lambda dataset_id: record)
    return record, x, y


def test_execution_dataset_config_preserves_preview_settings(configured_dataset):
    record, _, _ = configured_dataset
    config = build_dataset_config(record["id"])
    expected = for_dataset_configs(build_nirs4all_config_from_stored(record))
    assert config == expected
    assert config["global_params"]["has_header"] is False


def test_pipeline_task_trains_with_configured_target(configured_dataset, monkeypatch, tmp_path):
    import nirs4all
    from nirs4all.data import DatasetConfigs

    record, x, y = configured_dataset
    preview_config = for_dataset_configs(build_nirs4all_config_from_stored(record))
    # The library resolves relative file references against the dataset root.
    for key in ("train_x", "train_y"):
        preview_config[key] = str(Path(record["path"]) / preview_config[key])
    dataset = DatasetConfigs(preview_config).get_datasets()[0]
    np.testing.assert_allclose(dataset.y({"partition": "train"}).ravel(), y)
    monkeypatch.setattr(spectra, "_load_dataset", lambda dataset_id: dataset)
    real_run = nirs4all.run
    calls = []

    @wraps(real_run)
    def run_in_temporary_workspace(**kwargs):
        calls.append(kwargs)
        return real_run(**kwargs, workspace_path=str(tmp_path / "results"), save_artifacts=False,
                        save_charts=False, plots_visible=False)

    monkeypatch.setattr(nirs4all, "run", run_in_temporary_workspace)
    steps = [
        {"type": "preprocessing", "name": "StandardScaler", "classPath": "sklearn.preprocessing.StandardScaler"},
        {"type": "preprocessing", "name": "PCA", "classPath": "sklearn.decomposition.PCA", "params": {"n_components": 3}},
        {"type": "splitting", "name": "KFold", "classPath": "sklearn.model_selection.KFold", "params": {"n_splits": 3}},
        {"type": "model", "name": "Ridge", "classPath": "sklearn.linear_model.Ridge"},
    ]
    job = SimpleNamespace(config={"dataset_id": record["id"], "dataset_path": record["path"],
                                  "pipeline_id": "four-step", "pipeline_steps": steps,
                                  "engine": "legacy", "verbose": 0, "refit": False, "export_model": False})
    result = pipelines._run_pipeline_task(job, lambda *_: True)
    assert result["success"], result.get("traceback")
    assert len(calls) == 1
    loaded = DatasetConfigs(calls[0]["dataset"]).get_datasets()[0]
    np.testing.assert_allclose(loaded.x({"partition": "train"}, layout="2d"), x)
    np.testing.assert_allclose(loaded.y({"partition": "train"}).ravel(), y)
    assert result["metrics"]["rmse"] is not None
