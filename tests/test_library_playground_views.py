"""Real file-backed spectra and shared catalogues through the native adapters."""
import json

import numpy as np
import pytest

from api.library_playground_views import playground_view


def test_file_backed_spectra_pagination_and_owner_statistics(tmp_path):
    x = np.arange(60, dtype=float).reshape(12, 5) + 1
    y = np.arange(12, dtype=float)
    np.savetxt(tmp_path / "X.csv", x, delimiter=";")
    np.savetxt(tmp_path / "Y.csv", y, delimiter=";")
    payload = {"config": {"train_x": str(tmp_path / "X.csv"), "train_y": str(tmp_path / "Y.csv"),
                           "global_params": {"delimiter": ";", "has_header": False}}, "dataset_id": "real"}
    page = playground_view("spectra.data", {**payload, "start": 2, "end": 5, "include_y": True, "include_metadata": True})
    assert page["spectra"] == x[2:5].tolist()
    assert page["y"] == y[2:5].tolist()
    assert page["total_samples"] == 12 and page["num_features"] == 5
    assert page["dataset_reader"]["backend"] == "nirs4all-io.native"
    stats = playground_view("spectra.stats", payload)
    np.testing.assert_allclose(stats["statistics"]["mean"], x.mean(axis=0))
    np.testing.assert_allclose(stats["statistics"]["std"], x.std(axis=0))
    assert stats["global"]["num_samples"] == 12
    reduced = playground_view("spectra.data", {**payload, "max_wavelengths_returned": 3})
    assert len(reduced["wavelengths"]) == 3 and len(reduced["spectra"][0]) == 3
    with pytest.raises(ValueError, match="end"):
        playground_view("spectra.data", {**payload, "start": 5, "end": 2})
    json.dumps([page, stats, reduced], allow_nan=False)


def test_shared_catalogues_contain_real_operators_and_presets():
    operators = playground_view("playground.operators", {})
    assert any(item["name"] == "StandardNormalVariate" for item in operators["preprocessing"])
    assert any(item["name"] == "KFold" for item in operators["splitting"])
    assert operators["total"] == sum(len(operators[key]) for key in ["preprocessing", "augmentation", "splitting", "filter"])
    presets = playground_view("playground.presets", {})
    assert presets["total"] == 7
    assert any(item["id"] == "snv_basic" for item in presets["presets"])
    with pytest.raises(ValueError, match="payload"):
        playground_view("playground.operators", {"path": "/tmp"})
