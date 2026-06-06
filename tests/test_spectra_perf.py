"""Tests for the spectra API performance changes (T3.5).

Covers:
- The bounded LRU dataset cache (PERF-04): capped size + LRU eviction, with
  ``_load_dataset`` reuse and ``_clear_dataset_cache`` semantics intact.
- Optional wavelength decimation on the raw spectra endpoint (PERF-05): the new
  ``max_wavelengths_returned`` query param trims the wavelength axis while the
  default keeps the full width.
- The thread-offloaded ``get_spectra`` path (PERF-03) still returns correct data.

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
