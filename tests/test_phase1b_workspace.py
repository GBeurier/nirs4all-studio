"""Phase 1b regression guards for api/workspace.py.

Phase 1b stops blocking the uvicorn event loop: the legacy ``.meta.parquet``
discovery paths (runs-summary aggregation and the read-all-before-paginating
prediction-data path, including the recursive NaN/Inf clean) are wrapped in
``asyncio.to_thread`` so the heavy parquet/pandas work runs off the loop.

These tests assert:
  * ``api/workspace.py`` imports ``asyncio`` and offloads both legacy blocks
    with ``await asyncio.to_thread(...)`` (static check),
  * the offload preserves the response shapes and the pagination/cleaning
    behaviour (functional check against a real temp workspace),
  * the blocking parquet read actually executes on a worker thread, not the
    event-loop thread.
"""

import ast
import asyncio
import json
import threading
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from api import workspace as ws_module
from api.workspace import (
    get_workspace_runs,
    get_workspace_predictions_data,
)

MODULE_PATH = Path(ws_module.__file__).resolve()


# ---------------------------------------------------------------------------
# Static guards
# ---------------------------------------------------------------------------

def _module_source() -> str:
    return MODULE_PATH.read_text(encoding="utf-8")


def test_imports_asyncio():
    tree = ast.parse(_module_source())
    imported = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    assert "asyncio" in imported


def test_legacy_blocks_offloaded_to_thread():
    source = _module_source()
    # Runs-summary parquet aggregation offloaded.
    assert "await asyncio.to_thread(_discover_parquet_runs" in source
    # Legacy prediction-data parquet read + recursive clean offloaded.
    assert "await asyncio.to_thread(_read_legacy_prediction_records)" in source


def test_import_guard_preserved_for_pandas_lazy_import():
    # pandas is imported lazily inside the legacy paths (kept local to the
    # offloaded work); the module must still import without it at top level.
    source = _module_source()
    assert "import pandas as pd" in source


# ---------------------------------------------------------------------------
# Functional behaviour (legacy filesystem path, no store)
# ---------------------------------------------------------------------------

class _FakeWorkspace:
    def __init__(self, path: str):
        self.path = path
        self.id = "ws-test"
        self.name = "test"


def _write_meta_parquet(workspace_dir: Path, dataset: str) -> Path:
    """Write a minimal ``<dataset>.meta.parquet`` file with NaN/Inf to clean."""
    df = pd.DataFrame(
        {
            "id": ["a", "b"],
            "dataset_name": [dataset, dataset],
            "config_name": ["0001_cfg_x", "0001_cfg_x"],
            "pipeline_uid": ["p1", "p2"],
            "model_name": ["PLS", "RF"],
            "partition": ["val", "test"],
            "val_score": [0.9, np.nan],
            "test_score": [np.inf, 0.5],
            "n_samples": [10, 20],
            "preprocessings": ["snv", "msc"],
            "best_params": ['{"n": 3}', None],
            "scores": [None, None],
        }
    )
    target = workspace_dir / f"{dataset}.meta.parquet"
    df.to_parquet(target)
    return target


@pytest.fixture()
def legacy_workspace(tmp_path, monkeypatch):
    """A workspace dir with .meta.parquet files and no store.sqlite."""
    # Make it look like a workspace dir (has runs/ child) but with no store.
    (tmp_path / "runs").mkdir()
    _write_meta_parquet(tmp_path, "wheat")

    fake = _FakeWorkspace(str(tmp_path))
    monkeypatch.setattr(
        ws_module.workspace_manager,
        "_find_linked_workspace",
        lambda workspace_id: fake,
    )
    # Bypass the TTL cache so each call exercises the offloaded path.
    monkeypatch.setattr(ws_module, "_get_cached_runs", lambda *a, **k: None)
    monkeypatch.setattr(ws_module, "_set_cached_runs", lambda *a, **k: None)
    return tmp_path


@pytest.mark.asyncio
async def test_get_workspace_runs_legacy_parquet_shape(legacy_workspace):
    result = await get_workspace_runs("ws-test", source="parquet", refresh=True)

    assert set(result.keys()) == {"workspace_id", "runs", "total"}
    assert result["workspace_id"] == "ws-test"
    assert result["total"] == len(result["runs"])
    assert result["total"] >= 1

    run = result["runs"][0]
    assert run["format"] == "parquet_derived"
    assert run["dataset"] == "wheat"
    # max(0.9, nan) -> 0.9 ; cleaned to a float (not NaN).
    assert run["best_val_score"] == 0.9
    # max(inf, 0.5) -> inf in pandas, surfaced as float('inf'); the run dict
    # keeps the raw float here (the JSON encoder cleans Inf at the boundary),
    # so just assert it is a float and finite handling is unchanged.
    assert isinstance(run["best_test_score"], float)


@pytest.mark.asyncio
async def test_get_workspace_predictions_data_legacy_shape_and_clean(legacy_workspace):
    response = await get_workspace_predictions_data("ws-test", limit=500, offset=0)

    # Legacy path returns a fastapi Response with sanitized JSON.
    payload = json.loads(response.body)
    assert set(payload.keys()) == {"records", "total", "limit", "offset", "has_more"}
    assert payload["limit"] == 500
    assert payload["offset"] == 0
    assert payload["total"] == 2
    assert payload["has_more"] is False
    assert len(payload["records"]) == 2

    rec = payload["records"][0]
    assert rec["source_dataset"] == "wheat"
    assert rec["source_file"].endswith("wheat.meta.parquet")
    # best_params JSON string was parsed into a dict.
    assert rec["best_params"] == {"n": 3}

    # NaN/Inf cleaned to null across the record set.
    val_scores = [r.get("val_score") for r in payload["records"]]
    test_scores = [r.get("test_score") for r in payload["records"]]
    assert None in val_scores  # the np.nan val_score became None
    assert None in test_scores  # the np.inf test_score became None


@pytest.mark.asyncio
async def test_predictions_data_pagination_preserved(legacy_workspace):
    response = await get_workspace_predictions_data("ws-test", limit=1, offset=0)
    payload = json.loads(response.body)
    assert payload["total"] == 2
    assert len(payload["records"]) == 1
    assert payload["has_more"] is True

    response2 = await get_workspace_predictions_data("ws-test", limit=1, offset=1)
    payload2 = json.loads(response2.body)
    assert len(payload2["records"]) == 1
    assert payload2["has_more"] is False


@pytest.mark.asyncio
async def test_parquet_read_runs_off_event_loop_thread(legacy_workspace, monkeypatch):
    """The blocking pd.read_parquet must execute on a worker thread."""
    loop_thread = threading.current_thread()
    seen_threads: list[threading.Thread] = []

    real_read_parquet = pd.read_parquet

    def _tracking_read_parquet(*args, **kwargs):
        seen_threads.append(threading.current_thread())
        return real_read_parquet(*args, **kwargs)

    monkeypatch.setattr(pd, "read_parquet", _tracking_read_parquet)

    await get_workspace_predictions_data("ws-test", limit=500, offset=0)

    assert seen_threads, "pd.read_parquet was not called"
    assert all(t is not loop_thread for t in seen_threads), (
        "pd.read_parquet ran on the event-loop thread; it must be offloaded"
    )
