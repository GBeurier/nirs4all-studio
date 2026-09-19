"""Restored workspace requests must not race the scientific import thread."""
from __future__ import annotations

import asyncio
import builtins
import threading
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import api.shared  # noqa: F401 (initialize the application's lightweight modules)
from api import lazy_imports, runs, store_adapter
from api.workspace import router_datasets, router_discovery


@pytest.fixture
def loading_without_scientific_imports(monkeypatch):
    monkeypatch.setattr(lazy_imports, "_ml_ready", False)
    monkeypatch.setattr(lazy_imports, "_ml_loading", True)
    monkeypatch.setattr(lazy_imports, "_ml_error", None)
    monkeypatch.setattr(lazy_imports, "_cache", {})
    original_import = builtins.__import__
    attempted = []

    def guarded_import(name, *args, **kwargs):
        if name.split(".")[0] in {"nirs4all", "sklearn", "scipy", "numpy"}:
            attempted.append(name)
            raise AssertionError(f"Request competed with ML initialization: {name}")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded_import)
    yield
    assert attempted == []


@pytest.mark.asyncio
async def test_restored_datasets_stay_visible_without_starting_ml_imports(tmp_path, monkeypatch, loading_without_scientific_imports):
    record = {"id": "restored", "name": "Existing spectra", "path": str(tmp_path), "metadata_columns": []}
    monkeypatch.setattr(router_datasets.app_config, "get_datasets", lambda: [SimpleNamespace(to_dict=lambda: dict(record))])
    monkeypatch.setattr(router_datasets.app_config, "get_dataset_groups", lambda: [])
    app = FastAPI()
    app.include_router(router_datasets.router, prefix="/api")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/datasets")
    assert response.status_code == 200
    assert response.json() == {"datasets": [record], "groups": [], "total": 1}


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["dataset-scores", "summary"])
async def test_store_results_retry_loading_instead_of_importing_or_reporting_empty(tmp_path, monkeypatch, loading_without_scientific_imports, endpoint):
    (tmp_path / "store.sqlite").touch()
    monkeypatch.setattr(router_discovery.workspace_manager, "_find_linked_workspace", lambda _: SimpleNamespace(path=str(tmp_path)))
    monkeypatch.setattr(router_discovery.app_config, "get_datasets", lambda: [])
    monkeypatch.setattr(router_discovery, "_DATASET_SCORES_CACHE", {})
    monkeypatch.setattr(router_discovery, "_RESULTS_SUMMARY_CACHE", {})
    app = FastAPI()
    app.include_router(router_discovery.router, prefix="/api")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(f"/api/workspaces/restored/results/{endpoint}")
    assert response.status_code == 503, response.text
    assert response.headers["retry-after"] == "5"
    assert "still loading" in response.json()["detail"]


def _restored_run(tmp_path):
    return runs.Run(
        id="restored", name="Previous run", status="completed", created_at="2026-09-19",
        workspace_path=str(tmp_path), datasets=[runs.DatasetRun(
            dataset_id="spectra", dataset_name="Spectra", pipelines=[runs.PipelineRun(
                id="pipeline", pipeline_id="pipeline", pipeline_name="PLS", model="PLS",
                preprocessing="None", split_strategy="KFold", status="completed",
            )],
        )],
    )


@pytest.mark.asyncio
async def test_restored_run_metadata_stays_available_without_importing_storage(tmp_path, monkeypatch, loading_without_scientific_imports):
    run = _restored_run(tmp_path)
    monkeypatch.setattr(runs, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs, "_runs", {run.id: run})
    app = FastAPI()
    app.include_router(runs.router, prefix="/api")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        listing = await client.get("/api/runs")
        detail = await client.get(f"/api/runs/{run.id}")
    assert listing.status_code == detail.status_code == 200
    assert listing.json()["runs"][0]["id"] == run.id
    assert detail.json()["id"] == run.id


@pytest.mark.asyncio
@pytest.mark.parametrize("detail", [False, True], ids=["list", "detail"])
async def test_run_artifact_reads_leave_http_event_loop_responsive(tmp_path, monkeypatch, detail):
    run = _restored_run(tmp_path)
    entered, release = threading.Event(), threading.Event()
    monkeypatch.setattr(runs, "_ensure_runs_loaded", lambda: None)
    monkeypatch.setattr(runs, "_runs", {run.id: run})

    def read_artifacts(response_run):
        response_run.datasets[0].pipelines[0].artifact_refs = [{"id": "read-only-response"}]
        entered.set()
        release.wait(timeout=1)

    monkeypatch.setattr(runs, "_attach_workspace_robustness_artifacts", read_artifacts)
    monkeypatch.setattr(runs, "_attach_workspace_tuning_artifacts", lambda _: None)
    task = asyncio.create_task(runs.get_run(run.id) if detail else runs.list_runs())
    try:
        for _ in range(100):
            if entered.is_set():
                break
            await asyncio.sleep(0.001)
        assert entered.is_set()
        assert not task.done(), "Artifact I/O blocked the event loop until completion"
    finally:
        release.set()
        response = await asyncio.wait_for(task, timeout=2)
    response_run = response if detail else response.runs[0]
    assert response_run.datasets[0].pipelines[0].artifact_refs == [{"id": "read-only-response"}]
    assert run.datasets[0].pipelines[0].artifact_refs is None


def test_initialized_storage_uses_the_actual_loader_cache():
    from api.lazy_imports import _do_load_ml_deps, get_cached, get_ml_status, is_ml_ready

    _do_load_ml_deps()
    assert is_ml_ready(), get_ml_status()
    assert store_adapter._get_workspace_store_cls() is get_cached("WorkspaceStore")
