"""Phase 1a regression guards for api/shap.py.

These tests load ``api/shap.py`` in isolation (stubbing the intra-package
imports and forcing nirs4all to be absent) so they neither depend on a working
nirs4all install nor trigger the unguarded import in ``api/__init__.py``.

They assert the Phase 1a contract:
  * the broken home-grown model loader (``_load_model`` reaching for the
    non-existent ``NIRSBundle`` and a raw ``joblib.load``) is removed,
  * SHAP computation is delegated to nirs4all's ``ShapAnalyzer`` via a
    bundle ``BundleLoader`` predictor, and the symbol is re-exported,
  * the SHAP endpoints the frontend consumes remain,
  * the ``try: import nirs4all`` guard still degrades gracefully,
  * the compute handler offloads blocking SHAP work with ``asyncio.to_thread``.
"""

import ast
import importlib.util
import sys
import types
from pathlib import Path

import numpy as np
import pytest

MODULE_PATH = Path(__file__).resolve().parent.parent / "api" / "shap.py"


@pytest.fixture()
def shap_module(monkeypatch):
    """Import api/shap.py with nirs4all absent and api/* stubbed."""
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
    paths.is_within_directory = lambda *a, **k: True
    monkeypatch.setitem(sys.modules, "api.shared.paths", paths)

    spec = importlib.util.spec_from_file_location("api.shap", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, "api.shap", module)
    spec.loader.exec_module(module)
    return module


def _route_paths(module) -> set[str]:
    return {route.path for route in module.router.routes}


def test_import_guard_degrades_without_nirs4all(shap_module):
    assert shap_module.NIRS4ALL_AVAILABLE is False
    assert shap_module.SHAP_AVAILABLE is False
    # ShapAnalyzer symbol must still exist (re-export contract), set to None.
    assert hasattr(shap_module, "ShapAnalyzer")
    assert shap_module.ShapAnalyzer is None


def test_frontend_endpoints_present(shap_module):
    paths = _route_paths(shap_module)
    assert "/analysis/shap/config" in paths
    assert "/analysis/shap/models" in paths
    assert "/analysis/shap/compute" in paths
    assert "/analysis/shap/results/{job_id}" in paths
    assert "/analysis/shap/results/{job_id}/spectral" in paths
    assert "/analysis/shap/results/{job_id}/beeswarm" in paths
    assert "/analysis/shap/results/{job_id}/sample/{sample_idx}" in paths


def test_homegrown_model_loader_removed(shap_module):
    # _load_model (NIRSBundle + raw joblib.load) is deleted; the bundle path is
    # now resolved through nirs4all's BundleLoader.
    assert not hasattr(shap_module, "_load_model")
    assert hasattr(shap_module, "_load_bundle_predictor")
    assert hasattr(shap_module, "_run_shap_explanation")


def test_no_nirsbundle_or_joblib_in_source():
    source = MODULE_PATH.read_text(encoding="utf-8")
    assert "NIRSBundle" not in source, "broken NIRSBundle import must be gone"
    assert "import joblib" not in source, "raw joblib.load must be gone"
    assert "BundleLoader" in source, "bundle loading must go through nirs4all BundleLoader"


def test_compute_handler_offloads_to_thread():
    """Static check: the async compute handler wraps SHAP work in to_thread."""
    tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))

    found = False
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "compute_shap_explanation":
            found = True
            calls = [
                n
                for n in ast.walk(node)
                if isinstance(n, ast.Call)
                and isinstance(n.func, ast.Attribute)
                and n.func.attr == "to_thread"
            ]
            assert calls, "compute_shap_explanation must offload via asyncio.to_thread"
    assert found, "compute_shap_explanation handler not found"


def test_run_source_routes_through_nirs4all_explain(shap_module, monkeypatch):
    """A training-run SHAP request is routed through ``nirs4all.explain()``.

    Real SHAP needs fitted artifacts and data, so the dataset loader, run
    resolver, and ``nirs4all.explain`` are stubbed. The test asserts that the
    adapted results honour the cache contract the GET visualization handlers
    rely on (raw 2D SHAP values, int bin metadata, populated importance, set
    base value).
    """
    # 3 samples, 10 features of raw spectra (>= bin_size so bins are produced).
    n_features = 10
    X = np.arange(3 * n_features, dtype=float).reshape(3, n_features) / 10.0
    wavelengths = [float(10 * (i + 1)) for i in range(n_features)]
    feature_names = [f"λ{w:.1f}" for w in wavelengths]
    sample_indices = [0, 1, 2]

    monkeypatch.setattr(
        shap_module,
        "_load_dataset_for_shap",
        lambda *a, **k: (X, wavelengths, feature_names, sample_indices),
    )
    monkeypatch.setattr(
        shap_module,
        "_resolve_run_directory",
        lambda model_id: Path("/ws/runs/ds1/0001_run"),
    )

    # Known 2D SHAP values (same shape as X) + scalar base value.
    rng = np.random.default_rng(0)
    fake_shap_values = rng.standard_normal((3, n_features))

    class _FakeExplainResult:
        """Mimic nirs4all ExplainResult: ``.values`` is a 2D ndarray."""

        explainer_type = "kernel"
        base_value = 0.42

        @property
        def values(self):
            return fake_shap_values

    captured = {}

    def _fake_explain(*, model, data, **kwargs):
        captured["model"] = model
        captured["data"] = data
        return _FakeExplainResult()

    # The guard fixture made ``import nirs4all`` fail, so the module never bound
    # the ``nirs4all`` name; inject a stub exposing only ``explain``.
    fake_nirs4all = types.SimpleNamespace(explain=_fake_explain)
    monkeypatch.setattr(shap_module, "nirs4all", fake_nirs4all, raising=False)

    request = shap_module.ShapComputeRequest(
        model_source="run",
        model_id="0001_run",
        dataset_id="ds1",
        bin_size=5,
        bin_stride=5,
    )

    results = shap_module._run_shap_explanation("job1", request)

    # nirs4all.explain received the resolved run directory and the raw X.
    assert captured["model"] == str(Path("/ws/runs/ds1/0001_run"))
    assert np.array_equal(captured["data"], X)

    # Cache contract the GET visualization handlers depend on.
    assert results["_raw_shap_values"].shape == X.shape
    assert np.array_equal(results["_raw_X"], X)
    assert results["base_value"] == pytest.approx(0.42)
    assert results["explainer_type"] == "kernel"
    assert results["n_samples"] == 3
    assert results["n_features"] == n_features
    assert isinstance(results["binned_importance"]["bin_size"], int)
    assert results["binned_importance"]["bin_size"] == 5
    assert results["feature_importance"]  # populated, non-empty


def test_binned_importance_aggregations(shap_module):
    """The presentational binning helper aggregates mean|SHAP| correctly."""
    # 2 samples, 4 features; mean|SHAP| per feature = [1, 3, 2, 4].
    shap_values = np.array([[1.0, -3.0, 2.0, -4.0], [-1.0, 3.0, -2.0, 4.0]])
    wavelengths = [10.0, 20.0, 30.0, 40.0]

    summed = shap_module._build_binned_importance(
        shap_values, wavelengths, bin_size=2, bin_stride=2, bin_aggregation="sum"
    )
    assert summed["bin_size"] == 2
    assert summed["bin_stride"] == 2
    assert summed["aggregation"] == "sum"
    # bins: [10,20] -> 1+3=4, [30,40] -> 2+4=6
    assert summed["bin_values"] == [4.0, 6.0]
    assert summed["bin_centers"] == [15.0, 35.0]
    assert summed["bin_ranges"] == [(10.0, 20.0), (30.0, 40.0)]

    meaned = shap_module._build_binned_importance(
        shap_values, wavelengths, bin_size=2, bin_stride=2, bin_aggregation="mean"
    )
    # bins: mean(1,3)=2, mean(2,4)=3
    assert meaned["bin_values"] == [2.0, 3.0]
