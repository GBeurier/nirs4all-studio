"""Ignore preserves missing values through the wizard and global playground."""

import asyncio
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from api import datasets, spectra
from api.lazy_imports import _do_load_ml_deps, is_ml_ready
from api.playground.routes import router as playground_router
from api.shared.dataset_config import for_dataset_configs


@pytest.fixture
def ignored_dataset(tmp_path, monkeypatch):
    if not is_ml_ready():
        _do_load_ml_deps()
    assert is_ml_ready(), "These regressions require the nirs4all loader"
    (tmp_path / "Xcal.csv").write_text("1000;1001\n1;2\n3;NA\n5;6\n7;8\n9;10\n")
    (tmp_path / "Ycal.csv").write_text("target\n1\nNA\n3\n4\n5\n")
    files = [{"path": name, "filename": name, "type": role, "split": "train"}
             for name, role in (("Xcal.csv", "X"), ("Ycal.csv", "Y"))]
    parsing = {"delimiter": ";", "has_header": True, "na_policy": "ignore"}
    record = {"id": "ignore-na", "name": "Ignored NA", "path": str(tmp_path),
              "config": {"files": files, **parsing}}
    monkeypatch.setattr(spectra.app_config, "get_datasets", lambda: [SimpleNamespace(to_dict=lambda: record)])

    def no_workspace():
        raise AssertionError("Globally linked datasets must not require a workspace")

    monkeypatch.setattr(datasets.workspace_manager, "get_current_workspace", no_workspace)
    spectra._clear_dataset_cache()
    yield record, files, parsing
    spectra._clear_dataset_cache()


def test_ignore_validation_and_preview_keep_all_rows(ignored_dataset):
    record, files, parsing = ignored_dataset
    validation = asyncio.run(datasets.validate_files(datasets.ValidateFilesRequest(
        path=record["path"], files=files, parsing=parsing)))
    assert validation.success
    assert all(shape.error is None and shape.num_rows == 5 for shape in validation.shapes.values())

    app = FastAPI()
    # Match the development app's NaN -> JSON null response behavior.
    from fastapi.responses import ORJSONResponse
    app.router.default_response_class = ORJSONResponse
    app.include_router(datasets.router, prefix="/api")
    response = TestClient(app).post("/api/datasets/preview", json={
        "path": record["path"], "files": files, "parsing": parsing, "max_samples": 10,
    })
    assert response.status_code == 200
    preview = response.json()
    assert preview["success"] is True
    assert preview["error"] is None
    assert preview["summary"]["num_samples"] == 5
    assert len(preview["spectra_preview"]["sample_spectra"]) == 5
    assert preview["spectra_preview"]["sample_spectra"][1][1] is None


def test_global_dataset_loads_in_playground_without_workspace(ignored_dataset):
    record, _, _ = ignored_dataset
    assert spectra._get_dataset_config("IGNORED NA") == record
    dataset = spectra._load_dataset(record["id"])
    assert dataset.num_samples == 5
    assert np.isnan(dataset.x({"partition": "train"}, layout="2d")[1, 1])
    assert np.isnan(dataset.y({"partition": "train"})[1]).all()

    app = FastAPI()
    app.include_router(playground_router, prefix="/api")
    response = TestClient(app).post("/api/playground/execute-dataset", json={
        "dataset_id": record["id"], "steps": [], "sampling": {"method": "all"},
        "options": {"compute_pca": False, "compute_statistics": False, "compute_metrics": False},
    })
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["success"] is True
    assert len(result["original"]["spectra"]) == 5
    assert result["original"]["spectra"][1][1] is None


def test_loader_errors_keep_the_actual_reason(ignored_dataset, monkeypatch):
    import nirs4all.data

    def failing_loader(config):
        raise ValueError("NA values are not allowed by abort")

    monkeypatch.setattr(nirs4all.data, "DatasetConfigs", failing_loader)
    with pytest.raises(HTTPException) as error:
        spectra._load_dataset("ignore-na")
    assert error.value.status_code == 422
    assert "NA values are not allowed by abort" in error.value.detail


def test_native_library_adapters_preserve_ignored_na(ignored_dataset):
    from api.library_dataset_inspection import inspect_dataset_document
    from api.library_documents import configure_dataset
    from api.library_playground_views import playground_view

    record, _, _ = ignored_dataset
    config = configure_dataset({"record": record})
    preview = inspect_dataset_document("dataset.preview", {"config": config, "max_samples": 10})
    assert preview["success"] is True
    assert preview["summary"]["num_samples"] == 5
    data = playground_view("spectra.data", {"config": config, "dataset_id": record["id"], "include_y": True})
    assert data["total_samples"] == 5
    assert data["spectra"][1][1] is None
    assert data["y"][1] is None


def test_dataset_configs_bridge_preserves_native_policy_and_fill():
    config = {"global_params": {"na": {"policy": "ignore"}},
              "train_y_params": {"na": {"policy": "replace", "fill": {"method": "mean"}}}}
    adapted = for_dataset_configs(config)
    assert adapted["global_params"] == {"na_policy": "ignore"}
    assert adapted["train_y_params"] == {"na_policy": "replace", "na_fill_config": {"method": "mean"}}
    assert config["global_params"] == {"na": {"policy": "ignore"}}
