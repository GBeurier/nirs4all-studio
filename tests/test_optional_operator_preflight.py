"""Optional dependencies must be importable before a run is declared ready."""

# Production initializes shared services through main before adapters.
# isort: off
import asyncio
import sys
from types import ModuleType

import pytest

from main import app  # noqa: F401 - initialize the application as in production

from api import pipeline_canonical
from api.nirs4all_adapter import check_pipeline_imports
# isort: on


STEP = {"id": "tabpfn", "type": "model", "name": "TabPFN", "classPath": "tabpfn.TabPFNRegressor"}


@pytest.mark.parametrize("failure", [
    ModuleNotFoundError("No module named 'tabpfn'", name="tabpfn"),
    ImportError("cannot import name 'some_api' from 'torch'"),
    OSError("torch_cpu.dll could not be loaded"),
    AttributeError("module 'numpy' has no attribute 'removed_api'"),
])
def test_optional_import_failure_blocks_preflight_and_availability(monkeypatch, failure):
    from api import runs, system
    original = pipeline_canonical.importlib.import_module

    def import_operator(name):
        if name == "tabpfn":
            raise failure
        return original(name)

    async def coherent():
        return {"coherent": True}

    monkeypatch.setattr(pipeline_canonical.importlib, "import_module", import_operator)
    monkeypatch.setattr(system, "check_env_coherence", coherent)
    monkeypatch.setattr(system, "_load_operator_reference", lambda: {"nodes": [STEP]})
    issues = check_pipeline_imports([STEP])
    assert len(issues) == 1
    assert str(failure) in issues[0]["error"]
    assert sys.executable in issues[0]["error"]
    request = runs.PreflightRequest(inline_pipeline={"name": "TabPFN", "steps": [STEP]})
    result = asyncio.run(runs.run_preflight(request))
    assert result["ready"] is False
    assert str(failure) in result["issues"][0]["message"]
    availability = asyncio.run(system.system_operator_availability())
    assert len(availability["unavailable"]) == 1
    assert str(failure) in availability["unavailable"][0]["error"]


def test_available_optional_operator_does_not_construct_or_download(monkeypatch):
    class TabPFNRegressor:
        def __init__(self):
            pytest.fail("Availability must not instantiate or download model weights")

    module = ModuleType("tabpfn")
    module.TabPFNRegressor = TabPFNRegressor
    monkeypatch.setitem(sys.modules, "tabpfn", module)
    assert check_pipeline_imports([STEP]) == []


def test_optional_operator_failure_in_nested_branch_is_not_ignored(monkeypatch):
    monkeypatch.setitem(sys.modules, "tabpfn", None)
    result = check_pipeline_imports([{"type": "flow", "subType": "branch", "branches": [[STEP]]}])
    assert len(result) == 1
    assert result[0]["step_id"] == "tabpfn"


def test_lazy_wrapper_missing_backend_is_rejected_before_training(monkeypatch):
    from api import runs, system

    step = {"id": "aom", "type": "model", "name": "AOMPLSAomlibRegressor",
            "classPath": "nirs4all.operators.models.sklearn.aom_pls_aomlib.AOMPLSAomlibRegressor"}
    monkeypatch.setitem(sys.modules, "n4m.model_selection.aom_search", None)
    issues = check_pipeline_imports([step])
    assert len(issues) == 1
    assert "n4m.model_selection.aom_search" in issues[0]["error"]
    assert sys.executable in issues[0]["error"]
    assert "nirs4all-methods native Python wheel" in issues[0]["installation_hint"]
    monkeypatch.setattr(system, "_load_operator_reference", lambda: {"nodes": [step]})
    preflight = asyncio.run(runs.run_preflight(runs.PreflightRequest(inline_pipeline={"name": "AOM", "steps": [step]})))
    assert preflight["ready"] is False
    assert "nirs4all-methods native Python wheel" in preflight["issues"][0]["message"]
    assert "Install it via Settings" not in preflight["issues"][0]["message"]
    availability = asyncio.run(system.system_operator_availability())
    assert availability["unavailable"][0]["id"] == "aom"
    assert "nirs4all-methods native Python wheel" in availability["unavailable"][0]["error"]

    class AOMPLSRegressor:
        def __init__(self):
            pytest.fail("Checking a lazy backend must not construct or fit it")

    module = ModuleType("n4m.model_selection.aom_search")
    module.AOMPLSRegressor = AOMPLSRegressor
    monkeypatch.setitem(sys.modules, "n4m.model_selection.aom_search", module)
    assert check_pipeline_imports([step]) == []
