"""Dependency changes must never mix newly installed files with live ML modules."""

import subprocess
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import api.shared  # noqa: F401 - initialize shared services as main.py does
from api import lazy_imports
from api.jobs import JobStatus, JobType, job_manager
from api.runtime_mutation import RuntimeMutationMiddleware, runtime_mutation
from api.venv_manager import VenvManager


@pytest.fixture
def ready_runtime(monkeypatch):
    monkeypatch.setattr(lazy_imports, "_ml_ready", True)
    monkeypatch.setattr(lazy_imports, "_workspace_ready", True)
    monkeypatch.setattr(lazy_imports, "_ml_loading", False)
    monkeypatch.setattr(job_manager, "list_jobs", lambda **kwargs: [])
    return runtime_mutation


@pytest.mark.parametrize("outcome", [0, 1, "timeout"])
def test_install_blocks_science_before_pip_and_requires_restart_even_on_failure(monkeypatch, ready_runtime, outcome):
    manager = VenvManager()
    monkeypatch.setattr(manager, "_is_valid_venv", lambda: True)
    monkeypatch.setattr(manager, "_load_metadata", lambda: {})
    monkeypatch.setattr(manager, "_save_metadata", lambda value: None)
    cached = object()
    monkeypatch.setitem(lazy_imports._cache, "regression", cached)

    def pip(command, on_line, timeout):
        state = lazy_imports.get_ml_status()
        assert state["dependency_installing"] and state["requires_restart"]
        assert not state["ml_ready"] and not state["workspace_ready"]
        with pytest.raises(HTTPException, match="Restart the backend"):
            lazy_imports.get_cached("regression")
        assert lazy_imports._cache["regression"] is cached
        assert "tabpfn==2.0.3" in command
        assert "scikit-learn>=1.5,<1.7" in command
        if outcome == "timeout":
            raise subprocess.TimeoutExpired(command, timeout)
        return outcome

    monkeypatch.setattr("api.venv_manager.stream_install_process", pip)
    result = manager.install_package("tabpfn", version="2.0.3")
    assert result[0] is (outcome == 0)
    assert ready_runtime.snapshot()["requires_restart"]
    assert not ready_runtime.snapshot()["dependency_installing"]
    assert not lazy_imports.is_ml_ready()


def test_mutation_refuses_active_request_before_invalidating(ready_runtime):
    assert ready_runtime.enter_request()
    try:
        with pytest.raises(RuntimeError, match="active requests"):
            with ready_runtime.mutation("tabpfn"):
                pytest.fail("pip must not start")
        assert not ready_runtime.snapshot()["requires_restart"]
    finally:
        ready_runtime.leave_request()


@pytest.mark.parametrize("status", [JobStatus.RUNNING, JobStatus.PENDING])
def test_mutation_refuses_background_analysis(monkeypatch, ready_runtime, status):
    monkeypatch.setattr(job_manager, "list_jobs", lambda **kwargs: [SimpleNamespace(type=JobType.TRAINING)] if kwargs["status"] == status else [])
    with pytest.raises(RuntimeError, match="running analyses"):
        with ready_runtime.mutation("tabpfn"):
            pytest.fail("pip must not start")
    assert not ready_runtime.snapshot()["requires_restart"]


def test_ml_bootstrap_cannot_overlap_pip(monkeypatch, ready_runtime):
    monkeypatch.setattr(lazy_imports, "_ml_loading", True)
    with pytest.raises(RuntimeError, match="ML initialization"):
        with ready_runtime.mutation("tabpfn"):
            pytest.fail("pip must not start")
    assert not ready_runtime.snapshot()["requires_restart"]


def test_http_boundary_blocks_cached_model_routes_but_keeps_installation_controls(ready_runtime):
    app = FastAPI()
    app.add_middleware(RuntimeMutationMiddleware)
    calls = []

    @app.get("/api/playground/execute")
    def scientific():
        calls.append("science")
        return {"ok": True}

    @app.get("/api/updates/dependencies")
    def dependencies():
        return {"ok": True}

    @app.get("/api/system/readiness")
    def readiness():
        return lazy_imports.get_ml_status()

    with TestClient(app) as client:
        assert client.get("/api/playground/execute").status_code == 200
        with ready_runtime.mutation("tabpfn"):
            assert client.get("/api/playground/execute").status_code == 503
            assert client.get("/api/system/readiness").json()["dependency_installing"]
        response = client.get("/api/playground/execute")
        assert response.status_code == 503
        assert response.json()["requires_restart"]
        assert client.get("/api/updates/dependencies").status_code == 200
        assert calls == ["science"]


def test_later_profile_package_preserves_installed_tabpfn_bounds(monkeypatch):
    from api.package_compatibility import environment_installation_requirements

    monkeypatch.setattr("importlib.metadata.version", lambda name: "2.0.3")
    assert environment_installation_requirements("nirs4all", "1.1.2") == ["scikit-learn>=1.5,<1.7"]
    assert environment_installation_requirements("tabpfn", "2.0.3") == ["scikit-learn>=1.5,<1.7"]
    assert environment_installation_requirements("tabpfn", "2.1.0") == []
