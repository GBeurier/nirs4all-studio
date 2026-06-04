"""Phase 1b guards for api/spectra.py.

Asserts the Phase 1b contract:
  * the module-level ``_dataset_cache`` is a bounded LRU (oldest evicted first,
    access marks an entry most-recently-used) without changing the cache
    key/semantics,
  * ``_clear_dataset_cache`` still pops / clears the cache,
  * the async spectra handlers offload blocking nirs4all/numpy work via
    ``asyncio.to_thread`` rather than calling it directly on the event loop.
"""

import ast
import types
from collections import OrderedDict
from pathlib import Path

import pytest

import api.spectra as spectra

MODULE_PATH = Path(spectra.__file__).resolve()


# --------------------------------------------------------------------------- #
# Bounded LRU cache
# --------------------------------------------------------------------------- #
@pytest.fixture()
def clean_cache():
    """Save/restore the module-level dataset cache around a test."""
    saved = spectra._dataset_cache
    spectra._dataset_cache = OrderedDict()
    try:
        yield spectra._dataset_cache
    finally:
        spectra._dataset_cache = saved


def _force_load_path(monkeypatch, tmp_path):
    """Make ``_load_dataset`` reach the cache-insert path with a fake dataset.

    Returns a dict ``{dataset_id: sentinel}`` recording which dataset object was
    produced for each id, so tests can assert identity / eviction.
    """
    produced: dict = {}

    real_path = tmp_path / "x.csv"
    real_path.write_text("a,b\n1,2\n", encoding="utf-8")

    monkeypatch.setattr(spectra, "NIRS4ALL_AVAILABLE", True)
    monkeypatch.setattr(
        spectra,
        "_get_dataset_config",
        lambda ds_id: {"path": str(real_path)},
    )
    monkeypatch.setattr(
        spectra,
        "_build_nirs4all_config_from_stored",
        lambda cfg: {"train_x": str(real_path)},
    )
    monkeypatch.setattr(spectra, "_find_missing_dataset_files", lambda cfg: [])

    class _FakeDatasetConfigs:
        def __init__(self, config):
            self._config = config

        def get_datasets(self):
            sentinel = object()
            # Stash so the caller can map id -> object after the call.
            _FakeDatasetConfigs.last = sentinel
            return [sentinel]

    fake_data_mod = types.ModuleType("nirs4all.data")
    fake_data_mod.DatasetConfigs = _FakeDatasetConfigs
    monkeypatch.setitem(__import__("sys").modules, "nirs4all.data", fake_data_mod)

    def _load(ds_id):
        obj = spectra._load_dataset(ds_id)
        produced[ds_id] = obj
        return obj

    return _load


def test_cache_is_bounded_ordered_dict():
    assert isinstance(spectra._dataset_cache, OrderedDict)
    assert isinstance(spectra._DATASET_CACHE_MAXSIZE, int)
    assert spectra._DATASET_CACHE_MAXSIZE > 0


def test_lru_evicts_oldest_when_over_capacity(clean_cache, monkeypatch, tmp_path):
    load = _force_load_path(monkeypatch, tmp_path)
    cap = spectra._DATASET_CACHE_MAXSIZE

    # Fill beyond capacity.
    for i in range(cap + 3):
        load(f"ds-{i}")

    assert len(spectra._dataset_cache) == cap
    # Oldest ids (0..2) evicted, newest kept.
    assert "ds-0" not in spectra._dataset_cache
    assert "ds-2" not in spectra._dataset_cache
    assert f"ds-{cap + 2}" in spectra._dataset_cache


def test_lru_access_marks_recently_used(clean_cache, monkeypatch, tmp_path):
    load = _force_load_path(monkeypatch, tmp_path)
    cap = spectra._DATASET_CACHE_MAXSIZE

    # Fill exactly to capacity.
    for i in range(cap):
        load(f"ds-{i}")

    # Touch the oldest entry -> it becomes most-recently-used (cache hit path).
    first = spectra._load_dataset("ds-0")
    assert first is spectra._dataset_cache["ds-0"]

    # Insert one more: the now-oldest is ds-1, which should be evicted, not ds-0.
    load(f"ds-{cap}")
    assert "ds-0" in spectra._dataset_cache
    assert "ds-1" not in spectra._dataset_cache
    assert len(spectra._dataset_cache) == cap


def test_cache_returns_same_object_on_hit(clean_cache, monkeypatch, tmp_path):
    load = _force_load_path(monkeypatch, tmp_path)
    first = load("ds-x")
    second = spectra._load_dataset("ds-x")
    assert first is second


def test_clear_dataset_cache_pop_and_clear(clean_cache, monkeypatch, tmp_path):
    load = _force_load_path(monkeypatch, tmp_path)
    load("a")
    load("b")
    spectra._clear_dataset_cache("a")
    assert "a" not in spectra._dataset_cache
    assert "b" in spectra._dataset_cache
    spectra._clear_dataset_cache()
    assert len(spectra._dataset_cache) == 0


# --------------------------------------------------------------------------- #
# Event-loop offloading (static checks)
# --------------------------------------------------------------------------- #
_HANDLERS = {
    "get_spectra",
    "get_spectrum",
    "get_processed_spectra",
    "get_spectra_statistics",
}


def _async_handlers(tree: ast.AST) -> dict[str, ast.AsyncFunctionDef]:
    return {
        node.name: node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name in _HANDLERS
    }


def test_handlers_offload_via_to_thread():
    tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
    handlers = _async_handlers(tree)
    assert set(handlers) == _HANDLERS, "all spectra handlers must be present"

    for name, node in handlers.items():
        to_thread_calls = [
            n
            for n in ast.walk(node)
            if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Attribute)
            and n.func.attr == "to_thread"
        ]
        assert to_thread_calls, f"{name} must offload blocking work via asyncio.to_thread"


def test_load_dataset_never_called_directly_in_handlers():
    """Inside the async handlers, ``_load_dataset`` must be handed to
    ``asyncio.to_thread`` (i.e. it is an argument), never invoked directly."""
    tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
    for name, node in _async_handlers(tree).items():
        for call in ast.walk(node):
            if (
                isinstance(call, ast.Call)
                and isinstance(call.func, ast.Name)
                and call.func.id == "_load_dataset"
            ):
                pytest.fail(
                    f"{name} calls _load_dataset() directly on the event loop"
                )
