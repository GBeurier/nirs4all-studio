"""The same dataset can serve continuous and discretized target pipelines."""

import numpy as np
import pytest
from nirs4all.operators.transforms.targets import IntegerKBinsDiscretizer, RangeDiscretizer

from api.pipeline_canonical import editor_to_canonical
from api.pipeline_y_processing import normalize_y_processing_params


@pytest.mark.parametrize("edges", ["10,20", "[10,20]", [10, 20]])
def test_custom_target_bins_export_as_library_parameters(edges):
    exported = editor_to_canonical([{
        "id": "target", "type": "y_processing", "name": "RangeDiscretizer", "params": {"bins": edges},
    }])
    params = exported[0]["y_processing"]["params"]
    assert params == {"bins": [10, 20]}
    targets = np.array([[0.0], [10.0], [15.0], [20.0], [30.0]])
    original = targets.copy()
    assert RangeDiscretizer(**params).fit_transform(targets).ravel().tolist() == [0, 1, 1, 2, 2]
    np.testing.assert_array_equal(targets, original)


@pytest.mark.parametrize("strategy", ["uniform", "quantile"])
def test_equal_width_and_equal_count_target_bins_are_library_owned(strategy):
    exported = editor_to_canonical([{
        "id": "target", "type": "y_processing", "name": "IntegerKBinsDiscretizer",
        "params": {"n_bins": 2, "strategy": strategy},
    }])
    params = exported[0]["y_processing"]["params"]
    values = np.array([[0.0], [1.0], [2.0], [10.0], [11.0], [12.0]])
    np.testing.assert_array_equal(IntegerKBinsDiscretizer(**params).fit_transform(values).ravel(), [0, 0, 0, 1, 1, 1])


@pytest.mark.parametrize("bins", ["", "10,", "2,1", "1,1", "[true,2]", "NaN,2", 0, False, [1, float("inf")]])
def test_bad_target_boundaries_fail_before_execution(bins):
    with pytest.raises(ValueError):
        normalize_y_processing_params("RangeDiscretizer", {"bins": bins})


def test_disabled_target_processing_exports_regression_without_changing_dataset():
    assert editor_to_canonical([{
        "id": "target", "type": "y_processing", "name": "RangeDiscretizer",
        "params": {"bins": "invalid"}, "enabled": False,
    }]) == []


def test_minmax_editor_bounds_use_public_scaler_signature():
    assert normalize_y_processing_params("MinMaxScaler", {"feature_range_min": -1, "feature_range_max": 1}) == {"feature_range": [-1, 1]}


def test_saved_target_panel_configuration_does_not_run_stale_scaler():
    assert editor_to_canonical([{
        "id": "target", "type": "y_processing", "name": "StandardScaler", "params": {},
        "yProcessingConfig": {"enabled": True, "scaler": "RangeDiscretizer", "params": {"ranges": "10,20"}},
    }]) == [{"y_processing": {"class": "nirs4all.operators.transforms.targets.RangeDiscretizer", "params": {"bins": [10, 20]}}}]


def test_nested_disabled_targets_do_not_add_generator_alternatives():
    disabled = {"id": "off", "type": "y_processing", "name": "RangeDiscretizer", "params": {"bins": "invalid"}, "enabled": False}
    model = {"id": "model", "type": "model", "name": "Ridge", "classPath": "sklearn.linear_model.Ridge", "params": {}}
    noop = {"id": "noop", "type": "flow", "name": "NoOp", "params": {}, "isNoOp": True, "rawNirs4all": None}
    assert editor_to_canonical([{
        "id": "or", "type": "flow", "subType": "generator", "generatorKind": "or", "name": "Or", "params": {}, "branches": [[disabled, model], [noop]],
    }]) == [{"_or_": [{"model": {"class": "sklearn.linear_model.Ridge"}}, None]}]
    assert editor_to_canonical([{
        "id": "aug", "type": "flow", "subType": "feature_augmentation", "generatorKind": "or", "name": "FeatureAugmentation", "params": {}, "children": [disabled, noop],
    }]) == [{"feature_augmentation": {"_or_": [None]}}]
