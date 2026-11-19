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


def test_engine_options_select_native_kernels_only_on_request():
    from api.library_analysis import shap_engine_options

    assert shap_engine_options({"explainer_backend": "shap", "seed": 3}) == {}
    assert shap_engine_options({}) == {}
    assert shap_engine_options({"explainer_backend": "methods", "baseline": "mean", "seed": 3, "group_width": None}) == {
        "explainer_backend": "methods", "baseline": "mean", "seed": 3}


def test_grouped_attributions_read_group_means_at_group_centres():
    from types import SimpleNamespace

    from api.library_analysis import grouped_display

    X = np.arange(12, dtype=float).reshape(2, 6)
    wavelengths = [1000., 1002., 1004., 1006., 1008., 1010.]
    names = [f"{value:.1f} nm" for value in wavelengths]
    per_feature = SimpleNamespace(explanation={"groups": [{"feature_start": i, "feature_end": i + 1, "label": names[i]} for i in range(6)]})
    assert grouped_display(per_feature, X, wavelengths, names) == (X, wavelengths, names)
    grouped = SimpleNamespace(explanation={"groups": [{"feature_start": 0, "feature_end": 4, "label": "1000-1006 nm"},
                                                      {"feature_start": 4, "feature_end": 6, "label": "1008-1010 nm"}]})
    values, axis, labels = grouped_display(grouped, X, wavelengths, names)
    assert values.tolist() == [[1.5, 4.5], [7.5, 10.5]]
    assert axis == [1003.0, 1009.0]
    assert labels == ["1000-1006 nm", "1008-1010 nm"]


class _SubsetDataset:
    """Two partitions with aligned features, targets and metadata."""

    def __init__(self):
        import polars as pl

        self.rows = {"train": (np.array([[1., 1.], [2., 2.], [3., 3.]]), np.array([10., 20., 30.]), {"site": ["A", "B", "A"]}),
                     "test": (np.array([[4., 4.], [2., 2.]]), np.array([40., 50.]), {"site": ["B", "B"]})}
        self.pl = pl

    def _part(self, selector):
        if selector:
            return self.rows[selector["partition"]]
        X, y, meta = zip(*self.rows.values())
        return np.vstack(X), np.concatenate(y), {"site": sum((m["site"] for m in meta), [])}

    def x(self, selector, layout="2d"):
        return self._part(selector)[0]

    def y(self, selector):
        return self._part(selector)[1]

    def metadata(self, selector):
        return self.pl.DataFrame(self._part(selector)[2])


def test_subsets_pass_background_candidates_and_explained_samples_once():
    from api.library_analysis import subset_data

    subsets = {"background": {"partition": "train", "filters": [{"column": "site", "values": ["A"]}]},
               "explained": {"partition": "test", "filters": [{"column": "site", "values": ["B"]}]}}
    passed, positions, targets, rows, counts = subset_data(_SubsetDataset(), subsets, None)
    assert passed.tolist() == [[1., 1.], [3., 3.], [4., 4.], [2., 2.]]
    assert positions == [2, 3]
    assert targets.tolist() == [40., 50.]
    assert rows.tolist() == [0, 1]
    assert counts == {"background_candidates": 2, "explained_outside_background": 2}
    # Only the chosen explained samples are passed, aligned with their targets.
    passed, positions, targets, rows, counts = subset_data(_SubsetDataset(), subsets, 1)
    assert len(passed) == 3 and len(positions) == 1 and counts["explained_outside_background"] == 1
    assert targets.tolist() == [[40., 50.][rows[0]]]
    # Explained samples already among the background candidates are not passed again.
    subsets["background"] = {"partition": "all", "filters": []}
    passed, positions, _, _, counts = subset_data(_SubsetDataset(), subsets, None)
    assert len(passed) == 5 and positions == [3, 4]
    assert counts == {"background_candidates": 5, "explained_outside_background": 0}


def test_subsets_refuse_empty_selections_and_unknown_columns():
    from api.library_analysis import subset_data

    empty = {"background": {"partition": "train", "filters": [{"column": "site", "values": ["Z"]}]}, "explained": {"partition": "test"}}
    with pytest.raises(ValueError, match="background subset"):
        subset_data(_SubsetDataset(), empty, None)
    unknown = {"background": {"partition": "train"}, "explained": {"partition": "test", "filters": [{"column": "batch", "values": [1]}]}}
    with pytest.raises(ValueError, match="Unknown metadata column"):
        subset_data(_SubsetDataset(), unknown, None)


def test_temporal_metadata_matches_its_listed_iso_value():
    import datetime

    from api.library_analysis import subset_rows

    dataset = _SubsetDataset()
    dataset.rows["test"] = (dataset.rows["test"][0], dataset.rows["test"][1], {"site": [datetime.date(2026, 1, 2), datetime.date(2026, 3, 4)]})
    _, _, keep = subset_rows(dataset, {"partition": "test", "filters": [{"column": "site", "values": ["2026-03-04"]}]})
    assert keep.tolist() == [False, True]


def test_sample_breakdown_refuses_non_additive_results(result):
    result["additive"] = False
    with pytest.raises(ValueError, match="not additive"):
        shap_view({"result": result, "view": "sample", "sample_idx": 0})
