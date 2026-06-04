"""Phase 1a guard: api/playground.py outlier-endpoint removal + event-loop offloading.

The POST ``/playground/metrics/outliers`` endpoint was dead at runtime — it called
``MetricsComputer.get_outlier_mask`` which does not exist (AttributeError on every
request) — and was unused by the frontend (no reference to the route, and the
``onDetectOutliers`` prop is never wired to a concrete handler). Phase 1a deletes
the endpoint and its now-orphaned ``OutlierRequest`` model.

Phase 1a also moves the heavy synchronous work in the playground async handlers
(``PlaygroundExecutor.execute`` and the ``MetricsComputer`` numpy/sklearn calls)
off the event loop via ``asyncio.to_thread`` to address the "desktop very slow /
event loop blocked" report.

The module is imported with ``nirs4all`` stubbed absent so the test exercises the
``try: import nirs4all`` guard path and does not depend on the (separately
versioned) sibling library being importable.
"""

import ast
import importlib
import sys
from pathlib import Path

import pytest

_PLAYGROUND_PATH = Path(__file__).resolve().parent.parent / "api" / "playground.py"


class _Nirs4allBlocker:
    """meta_path finder that makes ``import nirs4all`` raise ImportError."""

    def find_spec(self, name, path=None, target=None):  # noqa: D401, ANN001
        if name == "nirs4all" or name.startswith("nirs4all."):
            raise ImportError("nirs4all blocked for phase1a playground probe")
        return None


@pytest.fixture()
def playground_module():
    """Import api.playground with nirs4all stubbed absent (guard path).

    The meta_path finder is only consulted for modules NOT already cached, so we
    must evict both api.playground and any cached nirs4all modules first (earlier
    tests in the session import them with the real library present). Everything is
    restored afterwards so subsequent tests re-import a clean, nirs4all-present
    module — keeping the probe hermetic and order-independent.
    """
    blocker = _Nirs4allBlocker()
    saved = {
        name: mod
        for name, mod in sys.modules.items()
        if name == "api.playground" or name == "nirs4all" or name.startswith("nirs4all.")
    }
    for name in saved:
        sys.modules.pop(name, None)
    sys.meta_path.insert(0, blocker)
    try:
        module = importlib.import_module("api.playground")
        yield module
    finally:
        if blocker in sys.meta_path:
            sys.meta_path.remove(blocker)
        # Drop the nirs4all-absent copy and restore the originals for later tests.
        sys.modules.pop("api.playground", None)
        sys.modules.update(saved)


def test_outlier_endpoint_and_model_removed(playground_module) -> None:
    """The dead outlier endpoint and its request model are gone."""
    assert not hasattr(playground_module, "detect_outliers")
    assert not hasattr(playground_module, "OutlierRequest")

    route_paths = {r.path for r in playground_module.router.routes}
    assert "/playground/metrics/outliers" not in route_paths


def test_surviving_endpoints_preserved(playground_module) -> None:
    """Frontend-used routes and other working endpoints stay registered."""
    route_paths = {r.path for r in playground_module.router.routes}
    for expected in (
        "/playground/execute",
        "/playground/operators",
        "/playground/diff/compute",
        "/playground/diff/repetition-variance",
        "/playground/metrics/compute",
        "/playground/metrics/similar",
    ):
        assert expected in route_paths, f"missing route: {expected}"


def test_guard_keeps_module_importable(playground_module) -> None:
    """The ``try: import nirs4all`` guard lets the module import without the library."""
    assert playground_module.NIRS4ALL_AVAILABLE is False


def _async_handler_sources() -> dict[str, str]:
    """Return source text of the heavy async handlers via AST (no import needed)."""
    tree = ast.parse(_PLAYGROUND_PATH.read_text())
    src = _PLAYGROUND_PATH.read_text().splitlines()
    handlers = {
        "execute_pipeline",
        "compute_metrics",
        "find_similar_samples",
        "compute_diff",
        "compute_repetition_variance",
    }
    out: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name in handlers:
            out[node.name] = "\n".join(src[node.lineno - 1 : node.end_lineno])
    return out


def test_heavy_async_handlers_offload_to_thread() -> None:
    """Each heavy async handler dispatches its blocking work via asyncio.to_thread."""
    sources = _async_handler_sources()
    expected = {
        "execute_pipeline",
        "compute_metrics",
        "find_similar_samples",
        "compute_diff",
        "compute_repetition_variance",
    }
    assert expected.issubset(sources.keys()), f"missing handlers: {expected - sources.keys()}"
    for name, body in sources.items():
        assert "asyncio.to_thread" in body, f"{name} does not offload blocking work"
