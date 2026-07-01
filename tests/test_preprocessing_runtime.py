"""Focused tests for shared preprocessing execution."""

from __future__ import annotations

import asyncio

import numpy as np
import pytest

import api.shared  # noqa: F401  (import first to satisfy load-order constraints)
from api import preprocessing as preprocessing_module
from api import spectra as spectra_module
from api.shared import preprocessing_runtime


def test_apply_preprocessing_chain_uses_runtime_operator_resolution(monkeypatch):
    calls: list[tuple[str, dict, str]] = []

    class RuntimeTransformer:
        _requires_wavelengths = True

        def __init__(self, offset: float):
            self.offset = offset

        def fit_transform(self, X, y=None, wavelengths=None):
            assert y is not None
            assert wavelengths is not None
            return X + self.offset

    def fake_instantiate_operator(name, params, operator_type="preprocessing"):
        calls.append((name, params, operator_type))
        return RuntimeTransformer(params["offset"])

    monkeypatch.setattr(preprocessing_runtime, "instantiate_operator", fake_instantiate_operator)

    X = np.array([[1.0, 2.0], [3.0, 4.0]])
    transformed, applied = preprocessing_runtime.apply_preprocessing_chain(
        X,
        [{"name": "RuntimeOffset", "params": {"offset": 2.5}}],
        wavelengths=[1000.0, 1100.0],
        y=np.array([1.0, 2.0]),
        strict=True,
    )

    assert calls == [("RuntimeOffset", {"offset": 2.5}, "preprocessing")]
    assert applied == ["RuntimeOffset"]
    np.testing.assert_allclose(transformed, X + 2.5)


def test_apply_preprocessing_chain_converts_resampler_points_with_wavelength_context(monkeypatch):
    captured_params = {}

    class IdentityTransformer:
        def fit_transform(self, X):
            return X

    def fake_instantiate_operator(name, params, operator_type="preprocessing"):
        assert name == "Resampler"
        captured_params.update(params)
        return IdentityTransformer()

    monkeypatch.setattr(preprocessing_runtime, "instantiate_operator", fake_instantiate_operator)

    X = np.ones((2, 5))
    transformed, applied = preprocessing_runtime.apply_preprocessing_chain(
        X,
        [{"name": "Resampler", "params": {"n_points": 3}}],
        wavelengths=[1000.0, 1050.0, 1100.0, 1150.0, 1200.0],
        strict=True,
    )

    assert applied == ["Resampler"]
    assert "n_points" not in captured_params
    np.testing.assert_allclose(captured_params["target_wavelengths"], [1000.0, 1100.0, 1200.0])
    np.testing.assert_allclose(transformed, X)


def test_apply_preprocessing_chain_strict_unknown_raises(monkeypatch):
    monkeypatch.setattr(preprocessing_runtime, "instantiate_operator", lambda *args, **kwargs: None)

    with pytest.raises(ValueError, match="Unknown preprocessing method: Missing"):
        preprocessing_runtime.apply_preprocessing_chain(
            np.ones((2, 2)),
            [{"name": "Missing", "params": {}}],
            strict=True,
        )


def test_apply_preprocessing_route_delegates_to_shared_runtime(monkeypatch):
    called = {}

    def fake_apply_preprocessing_chain(X, chain, *, strict, wavelengths=None, y=None):
        called["shape"] = X.shape
        called["chain"] = chain
        called["strict"] = strict
        return X + 1.0, [chain[0].name]

    monkeypatch.setattr(preprocessing_module, "apply_preprocessing_chain", fake_apply_preprocessing_chain)

    request = preprocessing_module.ApplyPreprocessingRequest(
        data=[[1.0, 2.0], [3.0, 4.0]],
        chain=[preprocessing_module.PreprocessingStep(name="RuntimeOffset", params={})],
    )

    response = asyncio.run(preprocessing_module.apply_preprocessing(request))

    assert called["shape"] == (2, 2)
    assert called["chain"][0].name == "RuntimeOffset"
    assert called["strict"] is True
    assert response == {
        "success": True,
        "data": [[2.0, 3.0], [4.0, 5.0]],
        "shape": [2, 2],
        "applied_steps": ["RuntimeOffset"],
    }


def test_spectra_preprocessing_wrapper_delegates_to_shared_runtime(monkeypatch):
    called = {}

    def fake_apply_preprocessing_chain(X, chain, *, strict, wavelengths=None, y=None):
        called["strict"] = strict
        called["chain"] = chain
        return X * 2, ["Scale"]

    monkeypatch.setattr(spectra_module, "apply_preprocessing_chain", fake_apply_preprocessing_chain)

    X = np.array([[1.0, 2.0]])
    transformed = spectra_module._apply_preprocessing_chain(
        X,
        [{"name": "Scale", "params": {}}],
    )

    assert called == {
        "strict": False,
        "chain": [{"name": "Scale", "params": {}}],
    }
    np.testing.assert_allclose(transformed, [[2.0, 4.0]])
