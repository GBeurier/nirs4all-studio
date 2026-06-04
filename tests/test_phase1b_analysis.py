"""Phase 1b regression guards for api/analysis.py.

Phase 1b stops blocking the uvicorn event loop: every heavy sklearn / numpy /
dataset-extraction call that runs inside an ``async def`` handler must be moved
onto a worker thread with ``asyncio.to_thread`` while preserving identical
response shapes and exception behavior.

These tests:
  * statically assert each heavy async handler offloads via ``asyncio.to_thread``,
  * functionally run ``compute_pca`` with a stubbed ``_load_analysis_data`` to
    confirm the response shape is unchanged and the PCA fit ran in a worker
    thread (not the event loop),
  * confirm ``asyncio`` is imported,
  * confirm the cheap/boundary handler ``important_wavelengths`` is NOT forced
    onto a thread (it operates on already-in-memory user arrays).
"""

import ast
import asyncio
import threading
from pathlib import Path

import numpy as np
import pytest

import api.analysis as analysis

MODULE_PATH = Path(__file__).resolve().parent.parent / "api" / "analysis.py"
_SOURCE = MODULE_PATH.read_text(encoding="utf-8")
_TREE = ast.parse(_SOURCE)


def _async_handler(name: str) -> ast.AsyncFunctionDef:
    for node in ast.walk(_TREE):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == name:
            return node
    raise AssertionError(f"async handler {name!r} not found")


def _to_thread_call_count(node: ast.AST) -> int:
    return sum(
        1
        for n in ast.walk(node)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Attribute)
        and n.func.attr == "to_thread"
    )


def test_asyncio_imported():
    assert "import asyncio" in _SOURCE


@pytest.mark.parametrize(
    "handler",
    [
        "compute_pca",
        "get_pca_loadings",
        "get_scree_data",
        "compute_tsne",
        "compute_umap_endpoint",
        "feature_importance",
        "correlation_matrix",
        "select_features",
    ],
)
def test_heavy_handlers_offload_to_thread(handler):
    """Each heavy async handler must offload work via asyncio.to_thread."""
    node = _async_handler(handler)
    assert _to_thread_call_count(node) >= 1, (
        f"{handler} must offload heavy work via asyncio.to_thread"
    )


def test_import_guard_preserved():
    """The sklearn/umap import guards remain intact."""
    assert "SKLEARN_AVAILABLE = True" in _SOURCE
    assert "SKLEARN_AVAILABLE = False" in _SOURCE
    assert "UMAP_AVAILABLE = True" in _SOURCE
    assert "UMAP_AVAILABLE = False" in _SOURCE


def test_cheap_handler_not_forced_to_thread():
    """important_wavelengths operates on in-memory user arrays; it stays on loop."""
    node = _async_handler("important_wavelengths")
    assert _to_thread_call_count(node) == 0


def test_compute_pca_response_shape_and_threading(monkeypatch):
    """compute_pca returns the unchanged shape and runs PCA off the event loop."""
    if not analysis.SKLEARN_AVAILABLE:
        pytest.skip("sklearn not available")

    rng = np.random.default_rng(0)
    X = rng.standard_normal((20, 8)).astype(np.float64)
    wavelengths = [float(i) for i in range(8)]

    def fake_load(dataset_id, partition, preprocessing_chain):
        return object(), X, wavelengths

    monkeypatch.setattr(analysis, "_load_analysis_data", fake_load)

    loop_thread = threading.get_ident()
    fit_threads: list[int] = []

    real_fit_transform = analysis.PCA.fit_transform

    def spy_fit_transform(self, *args, **kwargs):
        fit_threads.append(threading.get_ident())
        return real_fit_transform(self, *args, **kwargs)

    monkeypatch.setattr(analysis.PCA, "fit_transform", spy_fit_transform)

    request = analysis.PCARequest(
        dataset_id="ds", n_components=3, partition="train", center=True, scale=True
    )
    result = asyncio.run(analysis.compute_pca(request))

    # Response shape unchanged.
    assert result.dataset_id == "ds"
    assert result.n_components == 3
    assert result.n_samples == 20
    assert result.n_features == 8
    assert len(result.scores) == 20
    assert len(result.scores[0]) == 3
    assert len(result.loadings) == 3
    assert len(result.loadings[0]) == 8
    assert len(result.explained_variance_ratio) == 3
    assert len(result.cumulative_variance_ratio) == 3
    assert result.wavelengths == wavelengths
    assert result.mean is not None and len(result.mean) == 8

    # PCA fit ran on a worker thread, not the event-loop thread.
    assert fit_threads, "PCA.fit_transform was not invoked"
    assert all(t != loop_thread for t in fit_threads), (
        "PCA fit must run off the event loop"
    )


def test_correlation_unknown_method_raises_before_thread(monkeypatch):
    """Unknown correlation method still raises HTTPException(400), unchanged."""
    from fastapi import HTTPException

    rng = np.random.default_rng(1)
    X = rng.standard_normal((10, 5)).astype(np.float64)
    wavelengths = [float(i) for i in range(5)]

    monkeypatch.setattr(
        analysis, "_load_analysis_data", lambda *a, **k: (object(), X, wavelengths)
    )

    request = analysis.CorrelationRequest(
        dataset_id="ds", partition="train", method="bogus"
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(analysis.correlation_matrix(request))
    assert exc.value.status_code == 400


def test_pearson_correlation_shape(monkeypatch):
    """Pearson correlation returns an (n_features, n_features) matrix, unchanged."""
    rng = np.random.default_rng(2)
    X = rng.standard_normal((12, 6)).astype(np.float64)
    wavelengths = [float(i) for i in range(6)]

    monkeypatch.setattr(
        analysis, "_load_analysis_data", lambda *a, **k: (object(), X, wavelengths)
    )

    request = analysis.CorrelationRequest(
        dataset_id="ds", partition="train", method="pearson"
    )
    result = asyncio.run(analysis.correlation_matrix(request))
    assert result.n_features == 6
    assert len(result.correlation) == 6
    assert len(result.correlation[0]) == 6
    assert result.sampled is False
