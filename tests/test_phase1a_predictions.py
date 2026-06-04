"""Phase 1a regression guards for api/predictions.py.

These tests load ``api/predictions.py`` in isolation (stubbing the intra-package
imports and forcing nirs4all to be absent) so they neither depend on a working
nirs4all install nor trigger the unguarded import in ``api/__init__.py``.

They assert the Phase 1a contract:
  * the dead/unused JSON-file prediction CRUD endpoints (list/get/create/delete/
    stats/export) and their home-grown helpers/models are removed,
  * the current single/batch/dataset inference endpoints remain,
  * the ``try: import nirs4all`` guard still degrades gracefully,
  * blocking nirs4all/dataset calls are offloaded with ``asyncio.to_thread``.
"""

import ast
import importlib.util
import sys
import types
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).resolve().parent.parent / "api" / "predictions.py"


@pytest.fixture()
def predictions_module(monkeypatch):
    """Import api/predictions.py with nirs4all absent and api/* stubbed."""
    # Force ``import nirs4all`` to raise ImportError (exercise the guard path).
    monkeypatch.setitem(sys.modules, "nirs4all", None)

    pkg = types.ModuleType("api")
    pkg.__path__ = [str(MODULE_PATH.parent)]
    monkeypatch.setitem(sys.modules, "api", pkg)

    wm = types.ModuleType("api.workspace_manager")
    wm.workspace_manager = object()
    monkeypatch.setitem(sys.modules, "api.workspace_manager", wm)

    shared = types.ModuleType("api.shared")
    shared.__path__ = [str(MODULE_PATH.parent / "shared")]
    monkeypatch.setitem(sys.modules, "api.shared", shared)

    paths = types.ModuleType("api.shared.paths")
    paths.resolve_within = lambda *a, **k: None
    monkeypatch.setitem(sys.modules, "api.shared.paths", paths)

    spec = importlib.util.spec_from_file_location("api.predictions", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, "api.predictions", module)
    spec.loader.exec_module(module)
    return module


def _route_paths(module) -> set[str]:
    return {route.path for route in module.router.routes}


def test_import_guard_degrades_without_nirs4all(predictions_module):
    assert predictions_module.NIRS4ALL_AVAILABLE is False


def test_inference_endpoints_present(predictions_module):
    paths = _route_paths(predictions_module)
    assert "/predictions/single" in paths
    assert "/predictions/batch" in paths
    assert "/predictions/dataset" in paths


def test_dead_json_file_crud_endpoints_removed(predictions_module):
    paths = _route_paths(predictions_module)
    # The deprecated JSON-file CRUD surface backed by _get_predictions_dir /
    # _load_prediction / _save_prediction was deleted in favour of the
    # SQLite-backed /api/aggregated-predictions endpoints. The collection and
    # stats/export routes must be gone entirely; the only remaining
    # "/predictions/..." routes are the inference handlers asserted below.
    assert "/predictions" not in paths
    assert "/predictions/stats" not in paths
    assert "/predictions/export" not in paths
    assert "/predictions/{prediction_id}" not in paths


def test_homegrown_crud_helpers_and_models_removed(predictions_module):
    for name in (
        "_get_predictions_dir",
        "_load_prediction",
        "_save_prediction",
        "_deprecated_response",
        "_DEPRECATION_MSG",
        "list_predictions",
        "get_prediction",
        "create_prediction",
        "delete_prediction",
        "get_predictions_stats",
        "export_predictions",
        "PredictionCreate",
        "PredictionFilter",
    ):
        assert not hasattr(predictions_module, name), f"{name} should be removed"


def test_blocking_calls_offloaded_to_thread():
    """Static check: the async inference handlers wrap blocking work in to_thread."""
    tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
    handlers = {"predict_single", "predict_batch", "predict_dataset"}

    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name in handlers:
            calls = [
                n
                for n in ast.walk(node)
                if isinstance(n, ast.Call)
                and isinstance(n.func, ast.Attribute)
                and n.func.attr == "to_thread"
            ]
            assert calls, f"{node.name} must offload blocking work via asyncio.to_thread"

    # Ensure no nirs4all.predict / _load_dataset call is left running on the loop
    # (i.e. every such call is an argument handed to asyncio.to_thread).
    direct_blocking = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr == "predict" and getattr(node.func.value, "id", None) == "nirs4all":
                direct_blocking.append(node)
    assert not direct_blocking, "nirs4all.predict must be called via asyncio.to_thread"
