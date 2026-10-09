"""Analysis transport projections preserve scientific outputs and bounds."""
from __future__ import annotations

import numpy as np
import pytest

from api.library_analysis import adapt_analysis, binned, shap_axis, shap_view, synthesis


@pytest.fixture
def result():
    return {"job_id": "analysis-one", "base_value": 4.0, "wavelengths": [1000., 1010., 1020., 1030.],
            "mean_abs_shap": [1., 2., 3., 4.], "mean_spectrum": [5., 6., 7., 8.],
            "sample_indices": [7, 11], "_raw_shap_values": [[1., -2., 3., -4.], [2., 3., -4., 5.]],
            "_raw_X": [[5., 6., 7., 8.], [6., 7., 8., 9.]], "_y_true": [1., 2.], "_y_pred": [1.5, 3.],
            "binned_importance": {"bin_size": 2, "bin_stride": 1, "aggregation": "sum"}}


def test_waterfall_overlapping_display_bins_do_not_duplicate_contributions(result):
    view = shap_view({"result": result, "view": "sample", "sample_idx": 0, "top_n": 1})
    assert view["predicted_value"] == 2.0
    assert sum(entry["shap_value"] for entry in view["contributions"]) == -2.0
    assert view["contributions"][-1]["cumulative"] == 2.0


def test_rebin_and_beeswarm_preserve_signed_aggregation(result):
    values = np.asarray(result["_raw_shap_values"])
    bins = binned(values, result["wavelengths"], result["binned_importance"])
    assert bins["aggregation"] == "sum"
    assert bins["bin_values"][0] == 2.0
    assert len(shap_view({"result": result, "view": "beeswarm", "max_samples": 1})["bins"]) == 4


def test_public_result_excludes_arrays_and_scatter_retains_residuals(result):
    assert "_raw_X" not in shap_view({"result": result})
    assert shap_view({"result": result, "view": "scatter"})["residuals"] == [-0.5, -1.0]
    result["_y_true"] = ["one", "two"]
    result["_y_pred"] = ["two", "two"]
    assert shap_view({"result": result, "view": "scatter"})["residuals"] == []


def test_invalid_sample_and_unknown_operation_are_rejected(result):
    with pytest.raises(ValueError, match="sample index"):
        shap_view({"result": result, "view": "sample", "sample_idx": -1})
    with pytest.raises(ValueError, match="Unsupported analysis"):
        adapt_analysis("analysis.unknown", {})


def test_spectral_subset_indices_are_validated(result):
    with pytest.raises(ValueError, match="sample index"):
        shap_view({"result": result, "view": "spectral-detail", "sample_indices": [2]})
    subset = shap_view({"result": result, "view": "spectral-detail", "sample_indices": [1]})
    assert subset["n_samples"] == 1
    assert subset["mean_abs_shap"] == [2., 3., 4., 5.]


@pytest.mark.parametrize("headers,unit,expected", [
    ([1100, 2498], "nm", ([1100., 2498.], "nm")),
    ([1000, 1100], "cm-1", ([1000., 1100.], "cm-1")),
    ([1100, 2498], None, ([1100., 2498.], None)),
    (["aux", "nir"], "nm", ([0., 1.], "index")),
    ([1100], "nm", ([0., 1.], "index")),
    ([np.nan, np.inf], "nm", ([0., 1.], "index")),
])
def test_shap_axis_preserves_owner_units_only_on_valid_numeric_headers(headers, unit, expected):
    from types import SimpleNamespace

    data = SimpleNamespace(headers=lambda _: headers, header_unit=lambda _: unit)
    assert shap_axis(data, 2) == expected


@pytest.mark.parametrize("view", ["results", "spectral", "spectral-detail", "beeswarm", "sample", "rebin"])
def test_shap_views_preserve_persisted_axis_unit_and_keep_legacy_unit_unknown(result, view):
    document = {"result": result, "view": view, "sample_idx": 0, "bin_size": 2, "bin_stride": 1, "bin_aggregation": "sum"}
    assert shap_view(document)["axis_unit"] is None
    result["axis_unit"] = "nm"
    assert shap_view(document)["axis_unit"] == "nm"


@pytest.mark.integration_full
def test_real_csv_shap_axis_uses_owner_nanometers(tmp_path):
    inspection = pytest.importorskip("nirs4all.api.dataset_inspection")
    path = tmp_path / "X.csv"
    np.savetxt(path, np.arange(12).reshape(6, 2), delimiter=";", header="1100;2498", comments="")
    data, _ = inspection.load_dataset_for_analysis({"train_x": str(path), "global_params": {"delimiter": ";", "has_header": True, "header_unit": "nm"}})
    assert shap_axis(data, 2) == ([1100., 2498.], "nm")


@pytest.mark.integration_full
def test_real_features_preview_keeps_full_requested_count_and_owner_axes():
    pytest.importorskip("nirs4all.synthesis")
    config = {"name": "test_preview", "n_samples": 120, "random_state": 42,
              "steps": [{"type": "features", "method": "with_features", "params": {"wavelength_range": [1000, 1200], "wavelength_step": 10}}]}
    preview = synthesis("synthesis.preview", {"config": config, "preview_samples": 10})
    assert len(preview["spectra"]) == 10
    assert len(preview["spectra"][0]) == len(preview["wavelengths"]) == 21
    assert preview["actual_samples"] == 120
    assert preview["axis_unit"] == "nm"
    assert np.isfinite(preview["spectra"]).all()


@pytest.mark.integration_full
def test_multi_source_preview_exposes_feature_axis_without_fabricated_wavelengths():
    pytest.importorskip("nirs4all.synthesis")
    config = {"n_samples": 20, "random_state": 42, "steps": [
        {"type": "features", "method": "with_features", "params": {"wavelength_range": [1000, 1200], "wavelength_step": 10}},
        {"type": "sources", "method": "with_sources", "params": {"sources": [
            {"name": "NIR", "type": "nir", "wavelength_range": [1000, 1200]}, {"name": "aux", "type": "aux", "n_features": 3}]}},
        {"type": "output", "method": "with_output", "params": {"as_dataset": False}},
    ]}
    preview = synthesis("synthesis.preview", {"config": config, "preview_samples": 10})
    assert len(preview["spectra"][0]) == len(preview["wavelengths"])
    assert preview["axis_unit"] == "index"
    assert preview["wavelengths"] == list(range(len(preview["spectra"][0])))
