"""Tests for the spectra API performance changes (T3.5).

Covers:
- The bounded LRU dataset cache (PERF-04): capped size + LRU eviction, with
  ``_load_dataset`` reuse and ``_clear_dataset_cache`` semantics intact.
- Optional wavelength decimation on the raw spectra endpoint (PERF-05): the new
  ``max_wavelengths_returned`` query param trims the wavelength axis while the
  default keeps the full width.
- The thread-offloaded ``get_spectra`` path (PERF-03) still returns correct data.
- The W25 shared spectral-statistics helper backs both spectra and playground
  statistics response shapes.

``api.shared`` is imported before ``api.spectra`` so this module is importable
in isolation despite the pre-existing api.lazy_imports <-> api.shared load-order
sensitivity.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))

import api.shared  # noqa: F401  (import first to satisfy load-order constraint)
from api import spectra as spectra_module
from api.playground import charts as charts_module
from api.shared.metrics_computer import compute_spectral_statistics


class _FakeSpectraDataset:
    """Minimal dataset exposing the surface ``get_spectra`` consumes."""

    def __init__(self, X_train: np.ndarray, headers: list[float] | None = None):
        self._X = {"train": X_train, "test": np.empty((0, X_train.shape[1]))}
        self._headers = headers if headers is not None else list(range(X_train.shape[1]))
        self.repetition = None

    def x(self, context, layout="2d", concat_source=True):
        return self._X[context["partition"]]

    def y(self, context):
        return None

    def metadata(self, context):
        return None

    def headers(self, _source_index):
        return self._headers

    def header_unit(self, _source_index):
        return "nm"


def test_dataset_lru_cache_evicts_least_recently_used():
    cache = spectra_module._DatasetLRUCache(max_entries=2)
    cache["a"] = "A"
    cache["b"] = "B"
    # Touch "a" so "b" becomes least-recently-used.
    assert cache["a"] == "A"
    cache["c"] = "C"  # exceeds cap -> evicts "b"

    assert "a" in cache
    assert "c" in cache
    assert "b" not in cache


def test_dataset_lru_cache_respects_module_cap():
    cap = spectra_module._DATASET_CACHE_MAX_ENTRIES
    cache = spectra_module._DatasetLRUCache(max_entries=cap)
    for i in range(cap + 3):
        cache[f"d{i}"] = i
    # Never grows beyond the cap; only the most-recent `cap` survive.
    assert all(f"d{i}" not in cache for i in range(3))
    assert all(f"d{i}" in cache for i in range(3, cap + 3))


def test_clear_dataset_cache_single_and_all(monkeypatch):
    fake = spectra_module._DatasetLRUCache(max_entries=spectra_module._DATASET_CACHE_MAX_ENTRIES)
    monkeypatch.setattr(spectra_module, "_dataset_cache", fake)
    fake["x"] = object()
    fake["y"] = object()

    spectra_module._clear_dataset_cache("x")
    assert "x" not in fake
    assert "y" in fake

    spectra_module._clear_dataset_cache()
    assert "y" not in fake


def test_get_spectra_returns_full_width_by_default(monkeypatch):
    X = np.arange(30, dtype=float).reshape(3, 10)
    dataset = _FakeSpectraDataset(X, headers=[float(w) for w in range(10)])
    monkeypatch.setattr(spectra_module, "_load_dataset", lambda _id: dataset)

    data = asyncio.run(
        spectra_module.get_spectra("ds", start=0, end=None, partition="train", source=0)
    )

    assert data["num_features"] == 10
    assert len(data["wavelengths"]) == 10
    assert len(data["spectra"][0]) == 10
    # Round-trip the actual values to confirm no decimation occurred.
    assert data["spectra"] == X.tolist()


def test_get_spectra_decimates_when_max_wavelengths_returned(monkeypatch):
    X = np.random.RandomState(0).rand(4, 50)
    dataset = _FakeSpectraDataset(X, headers=[float(w) for w in range(50)])
    monkeypatch.setattr(spectra_module, "_load_dataset", lambda _id: dataset)

    data = asyncio.run(
        spectra_module.get_spectra(
            "ds",
            start=0,
            end=None,
            partition="train",
            source=0,
            max_wavelengths_returned=8,
        )
    )

    # Wavelength axis trimmed to the requested cap; row count unchanged.
    assert len(data["wavelengths"]) == 8
    assert len(data["spectra"]) == 4
    assert all(len(row) == 8 for row in data["spectra"])
    # num_features reports the original full width (pre-decimation).
    assert data["num_features"] == 50


def test_get_spectra_no_decimation_when_cap_exceeds_width(monkeypatch):
    X = np.arange(20, dtype=float).reshape(4, 5)
    dataset = _FakeSpectraDataset(X, headers=[float(w) for w in range(5)])
    monkeypatch.setattr(spectra_module, "_load_dataset", lambda _id: dataset)

    data = asyncio.run(
        spectra_module.get_spectra(
            "ds",
            start=0,
            end=None,
            partition="train",
            source=0,
            max_wavelengths_returned=100,
        )
    )

    # Cap larger than the axis -> untouched.
    assert len(data["wavelengths"]) == 5
    assert data["spectra"] == X.tolist()


def test_compute_spectral_statistics_canonical_values():
    X = np.array(
        [
            [1.0, 10.0, 100.0],
            [2.0, 20.0, 200.0],
            [3.0, 30.0, 300.0],
        ]
    )

    stats = compute_spectral_statistics(X)

    np.testing.assert_allclose(stats["mean"], [2.0, 20.0, 200.0])
    np.testing.assert_allclose(stats["std"], np.std(X, axis=0))
    np.testing.assert_allclose(stats["min"], [1.0, 10.0, 100.0])
    np.testing.assert_allclose(stats["max"], [3.0, 30.0, 300.0])
    np.testing.assert_allclose(stats["p5"], np.percentile(X, 5, axis=0))
    np.testing.assert_allclose(stats["p25"], np.percentile(X, 25, axis=0))
    np.testing.assert_allclose(stats["p50"], [2.0, 20.0, 200.0])
    np.testing.assert_allclose(stats["p75"], np.percentile(X, 75, axis=0))
    np.testing.assert_allclose(stats["p95"], np.percentile(X, 95, axis=0))
    assert stats["global"] == {
        "mean": float(np.mean(X)),
        "std": float(np.std(X)),
        "min": float(np.min(X)),
        "max": float(np.max(X)),
        "n_samples": 3,
        "n_features": 3,
    }


def test_playground_statistics_delegates_to_shared_helper(monkeypatch):
    X = np.arange(6, dtype=float).reshape(2, 3)
    called = {}

    def fake_compute_spectral_statistics(arg):
        called["shape"] = arg.shape
        return {
            "mean": ["mean"],
            "std": ["std"],
            "min": ["min"],
            "max": ["max"],
            "p5": ["p5"],
            "p25": ["p25"],
            "p50": ["p50"],
            "p75": ["p75"],
            "p95": ["p95"],
            "global": {"n_samples": 2, "n_features": 3},
        }

    monkeypatch.setattr(charts_module, "compute_spectral_statistics", fake_compute_spectral_statistics)

    data = charts_module.compute_statistics(X)

    assert called["shape"] == (2, 3)
    assert data == {
        "mean": ["mean"],
        "std": ["std"],
        "min": ["min"],
        "max": ["max"],
        "p5": ["p5"],
        "p95": ["p95"],
        "global": {"n_samples": 2, "n_features": 3},
    }


def test_get_spectra_statistics_delegates_to_shared_helper(monkeypatch):
    X = np.arange(6, dtype=float).reshape(2, 3)
    dataset = _FakeSpectraDataset(X, headers=[1100.0, 1200.0, 1300.0])
    called = {}

    def fake_compute_spectral_statistics(arg):
        called["shape"] = arg.shape
        return {
            "mean": ["mean"],
            "std": ["std"],
            "min": ["min"],
            "max": ["max"],
            "p5": ["p5"],
            "p25": ["q1"],
            "p50": ["median"],
            "p75": ["q3"],
            "p95": ["p95"],
            "global": {
                "mean": 1.0,
                "std": 2.0,
                "min": 3.0,
                "max": 4.0,
                "n_samples": 2,
                "n_features": 3,
            },
        }

    monkeypatch.setattr(spectra_module, "_load_dataset", lambda _id: dataset)
    monkeypatch.setattr(spectra_module, "compute_spectral_statistics", fake_compute_spectral_statistics)

    data = asyncio.run(spectra_module.get_spectra_statistics("ds", partition="train", source=0))

    assert called["shape"] == (2, 3)
    assert data["statistics"] == {
        "mean": ["mean"],
        "std": ["std"],
        "min": ["min"],
        "max": ["max"],
        "median": ["median"],
        "q1": ["q1"],
        "q3": ["q3"],
    }
    assert data["global"] == {
        "global_mean": 1.0,
        "global_std": 2.0,
        "global_min": 3.0,
        "global_max": 4.0,
        "num_samples": 2,
        "num_features": 3,
    }
