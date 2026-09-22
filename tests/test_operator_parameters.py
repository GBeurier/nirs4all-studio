"""Real operator execution for JSON types and saved, deprecated UI defaults."""
from __future__ import annotations

import copy
import math

import numpy as np
import pytest

import api.shared  # noqa: F401 (initialize lightweight API modules)
from api import operator_parameters
from api.operator_parameters import normalize_operator_parameters, normalize_runtime_operator_parameters
from api.pipeline_canonical import editor_steps_to_runtime_canonical
from api.shared.pipeline_service import normalize_params


@pytest.mark.parametrize("reference", ["f_regression", "sklearn.feature_selection.f_regression"])
def test_regression_scorer_selected_in_editor_is_callable_in_run_and_playground(reference):
    from nirs4all.pipeline.config.component_serialization import deserialize_component
    from sklearn.feature_selection import f_regression

    from api.shared.pipeline_service import instantiate_operator

    step = {"type": "preprocessing", "name": "SelectFdr", "params": {"score_func": reference, "alpha": .05}}
    runtime = deserialize_component(editor_steps_to_runtime_canonical([step])[0], strict_imports=True)
    playground = instantiate_operator("SelectFdr", step["params"])
    rng = np.random.default_rng(87)
    X = rng.normal(size=(80, 6))
    y = 3 * X[:, 0] + rng.normal(size=80) * .01
    for operator in (runtime, playground):
        assert operator.score_func is f_regression
        assert operator.fit_transform(X, y).shape[1] > 0


def test_nested_regression_pipeline_normalizes_cars_and_supervised_selector_defaults():
    payload = [
        {
            "_cartesian_": [
                [
                    {"class": "nirs4all.operators.transforms.feature_selection.FlexibleSVD", "params": {"n_components": .95}},
                    {"class": "sklearn.feature_selection.SelectFdr", "params": {"alpha": .05}},
                ],
                {
                    "class": "nirs4all.operators.transforms.CARS",
                    "params": {"n_pls_components": 10, "n_sampling_runs": 50},
                },
            ]
        },
        {"model": {"class": "tabpfn.TabPFNRegressor"}},
        {"model": {"class": "lightgbm.LGBMRegressor"}},
    ]

    normalized = normalize_runtime_operator_parameters(payload)
    selector = normalized[0]["_cartesian_"][0]["_or_"][1]
    cars = normalized[0]["_cartesian_"][1]
    assert selector["params"]["score_func"] == {"function": "sklearn.feature_selection.f_regression"}
    assert cars["params"]["n_components"] == 10
    assert "n_pls_components" not in cars["params"]

    from nirs4all.pipeline.config.generator import expand_spec

    expanded = expand_spec(normalized[0])
    assert len(expanded) == 2
    assert [variant[0]["class"].rsplit(".", 1)[-1] for variant in expanded] == [
        "FlexibleSVD",
        "SelectFdr",
    ]


def test_nested_supervised_cartesian_pipeline_executes_all_variants(tmp_path):
    import nirs4all

    rng = np.random.default_rng(11)
    y = rng.uniform(-2, 2, 60)
    wavelengths = np.linspace(0, 8 * np.pi, 48)
    X = (
        2 * np.sin(wavelengths)[None, :]
        + 3 * y[:, None] * np.cos(2 * wavelengths)[None, :]
        + .02 * rng.normal(size=(60, 48))
    )
    payload = [
        {"class": "nirs4all.operators.transforms.StandardNormalVariate"},
        {"class": "nirs4all.operators.transforms.OSC", "params": {"n_components": 1}},
        {"_or_": [
            {"class": "nirs4all.operators.transforms.WaveletDenoise", "params": {"level": 2}},
            {"class": "nirs4all.operators.transforms.SecondDerivative"},
        ]},
        {"_cartesian_": [
            [
                {"class": "nirs4all.operators.transforms.feature_selection.FlexibleSVD", "params": {"n_components": .95}},
                {"class": "sklearn.feature_selection.SelectFdr", "params": {"alpha": .05}},
            ],
            {"class": "nirs4all.operators.transforms.CARS", "params": {
                "n_pls_components": 3, "n_sampling_runs": 3, "cv_folds": 2, "random_state": 4,
            }},
        ]},
        {
            "model": {
                "class": "sklearn.cross_decomposition.PLSRegression",
                "params": {"n_components": 10, "scale": True, "max_iter": 500},
            },
            "finetune_params": {
                "n_trials": 2,
                "approach": "grouped",
                "eval_mode": "best",
                "model_params": {
                    "n_components": {"type": "int", "low": 1, "high": 30, "step": 1},
                },
            },
        },
        {"model": {"class": "lightgbm.LGBMRegressor"}},
        {"model": {"class": "sklearn.linear_model.Ridge"}},
    ]

    pipeline = normalize_runtime_operator_parameters(payload)
    with nirs4all.run(
        pipeline[:-2] + [pipeline[-1]],
        (X, y, {"train": 48}),
        engine="legacy",
        workspace_path=tmp_path,
        verbose=0,
        save_charts=False,
        refit=False,
    ) as result:
        rows = result.predictions.filter_predictions(partition="test", load_arrays=True)
    assert len(rows) == 8
    assert {row["model_name"] for row in rows} == {"PLSRegression", "Ridge"}
    assert all(len(row["y_pred"]) == 12 for row in rows)


def test_saved_sparse_coder_dictionary_runs_in_pipeline_and_playground():
    from nirs4all.pipeline.config.component_serialization import deserialize_component
    from sklearn.decomposition import SparseCoder

    from api.shared.pipeline_service import instantiate_operator

    dictionary = np.eye(4)
    params = {"dictionary": dictionary.tolist(), "transform_n_nonzero_coefs": 2}
    step = {"type": "preprocessing", "name": "SparseCoder", "params": params}
    runtime = deserialize_component(editor_steps_to_runtime_canonical([step])[0], strict_imports=True)
    playground = instantiate_operator("SparseCoder", params)
    X = np.random.default_rng(88).normal(size=(12, 4))
    expected = SparseCoder(dictionary=dictionary, transform_n_nonzero_coefs=2).transform(X)
    for operator in (runtime, playground):
        np.testing.assert_allclose(operator.transform(X), expected)


@pytest.mark.parametrize("kind,name,path,params", [
    ("model", "HistGradientBoostingRegressor", "sklearn.ensemble.HistGradientBoostingRegressor", {"max_features": 1, "max_iter": 3}),
    ("model", "HistGradientBoostingClassifier", "sklearn.ensemble.HistGradientBoostingClassifier", {"max_features": 1, "max_iter": 3}),
    ("model", "MLPRegressor", "sklearn.neural_network.MLPRegressor", {"hidden_layer_sizes": "(8, 4)", "max_iter": 3, "random_state": 42}),
    ("model", "MLPClassifier", "sklearn.neural_network.MLPClassifier", {"hidden_layer_sizes": "[8, 4]", "max_iter": 3, "random_state": 42}),
    *[("model", name, f"sklearn.linear_model.{name}", {"alphas": "warn", "n_alphas": "deprecated", "cv": 2})
      for name in ["LassoCV", "ElasticNetCV", "MultiTaskLassoCV", "MultiTaskElasticNetCV"]],
    ("preprocessing", "KBinsDiscretizer", "sklearn.preprocessing.KBinsDiscretizer", {"quantile_method": "warn", "encode": "ordinal"}),
    ("y_processing", "MinMaxScaler", "sklearn.preprocessing.MinMaxScaler", {"feature_range": "(0, 1)"}),
    ("preprocessing", "LogTransform", "nirs4all.operators.transforms.LogTransform", {"base": "e"}),
])
def test_saved_editor_parameters_fit_with_real_library_deserialization(kind, name, path, params):
    from nirs4all.pipeline.config.component_serialization import deserialize_component

    steps = [{"id": "fixture", "type": kind, "name": name, "classPath": path, "params": params}]
    before = copy.deepcopy(steps)
    canonical = editor_steps_to_runtime_canonical(steps)
    component = canonical[0]
    if kind in {"model", "y_processing"}:
        component = component[kind]
    operator = deserialize_component(component, strict_imports=True)
    rng = np.random.default_rng(814)
    X = rng.uniform(1, 5, (32, 6))
    y = X[:, 0] - 0.2 * X[:, 1]
    if "Classifier" in name:
        y = (y > np.median(y)).astype(int)
    elif name.startswith("MultiTask"):
        y = np.column_stack([y, X[:, 2]])
    if kind == "model":
        output = operator.fit(X[:24], y[:24]).predict(X[24:])
    elif kind == "y_processing":
        output = operator.fit_transform(y[:, None])
        np.testing.assert_allclose(output.min(), 0)
        np.testing.assert_allclose(output.max(), 1)
    else:
        output = operator.fit_transform(X)
        if name == "LogTransform":
            np.testing.assert_allclose(output, np.log(X))
    assert np.isfinite(output).all()
    assert steps == before  # Running must not rewrite the saved editor document.


@pytest.mark.parametrize("release", [(1, 6), (1, 9)])
def test_alpha_grid_size_is_preserved_across_sklearn_versions(monkeypatch, release):
    monkeypatch.setattr(operator_parameters, "_sklearn_version", lambda: release)
    for params in [{"alphas": "warn", "n_alphas": 37}, {"alphas": 37}]:
        expected = {"n_alphas": 37} if release < (1, 7) else {"alphas": 37}
        assert normalize_operator_parameters("LassoCV", params) == expected
    assert normalize_operator_parameters("LassoCV", {"alphas": [0.01, 0.2]}) == {"alphas": [0.01, 0.2]}


def test_historical_kbins_quantiles_keep_linear_semantics(monkeypatch):
    monkeypatch.setattr(operator_parameters, "_sklearn_version", lambda: (1, 9))
    assert normalize_operator_parameters("KBinsDiscretizer", {"quantile_method": "warn"}) == {"quantile_method": "linear"}
    monkeypatch.setattr(operator_parameters, "_sklearn_version", lambda: (1, 6))
    with pytest.raises(ValueError, match="requires scikit-learn >= 1.7"):
        normalize_operator_parameters("KBinsDiscretizer", {"quantile_method": "averaged_inverted_cdf"})


@pytest.mark.parametrize("name,params,expected", [
    ("LogisticRegression", {"penalty": "deprecated", "multi_class": "deprecated", "C": 2}, {"C": 2}),
    ("LogisticRegressionCV", {"penalty": "deprecated", "l1_ratios": "warn", "use_legacy_attributes": "warn"}, {}),
    ("ColumnTransformer", {"force_int_remainder_cols": "deprecated", "remainder": "drop"}, {"remainder": "drop"}),
])
def test_sklearn_transition_sentinels_never_reach_estimators(name, params, expected):
    assert normalize_operator_parameters(name, params) == expected


@pytest.mark.parametrize("name", ["ClassifierChain", "RegressorChain"])
def test_chain_estimator_name_tracks_supported_sklearn_runtime(monkeypatch, name):
    estimator = {"class": "sklearn.linear_model.Ridge"}
    historical = {"estimator": estimator, "base_estimator": "deprecated"}
    monkeypatch.setattr(operator_parameters, "_sklearn_version", lambda: (1, 6))
    assert normalize_operator_parameters(name, historical) == {"base_estimator": estimator}
    monkeypatch.setattr(operator_parameters, "_sklearn_version", lambda: (1, 7))
    assert normalize_operator_parameters(name, historical) == {"estimator": estimator}


def test_playground_and_runtime_share_parameter_meaning():
    params = {"base": "10"}
    assert normalize_params("LogTransform", params) == {"base": 10.0}
    assert normalize_operator_parameters("LogTransform", {"base": "e"}) == {"base": math.e}
    assert normalize_params("MinMaxScaler", {"feature_range": "(-1, 1)"}) == {"feature_range": (-1, 1)}
    with pytest.raises(ValueError):
        normalize_params("LogTransform", {"base": "not-a-base"})


def test_mlp_layer_sizes_preserve_saved_and_swept_architectures():
    for value, expected in [("(100, 50)", (100, 50)), ("[8, 4]", (8, 4)), ("8", 8), ([8, 4], (8, 4))]:
        assert normalize_operator_parameters("MLPRegressor", {"hidden_layer_sizes": value}) == {"hidden_layer_sizes": expected}
    assert normalize_operator_parameters("MLPClassifier", {"hidden_layer_sizes": {"_or_": ["(8, 4)", "(16,)"]}}) == {
        "hidden_layer_sizes": {"_or_": [(8, 4), (16,)]},
    }
    assert normalize_operator_parameters("MLPRegressor", {"hidden_layer_sizes": "invalid"}) == {"hidden_layer_sizes": "invalid"}


def test_nested_branches_and_fraction_sweeps_preserve_unrelated_integer_parameters():
    payload = {"branch": [[{"model": {"class": "sklearn.ensemble.HistGradientBoostingRegressor", "params": {
        "max_features": {"_or_": [0.5, 1]}, "max_iter": 3,
    }}}], [{"model": {"class": "sklearn.ensemble.RandomForestRegressor", "params": {"max_features": 1}}}]]}
    output = normalize_runtime_operator_parameters(payload)
    histogram = output["branch"][0][0]["model"]["params"]
    assert all(isinstance(value, float) for value in histogram["max_features"]["_or_"])
    assert isinstance(histogram["max_iter"], int)
    assert isinstance(output["branch"][1][0]["model"]["params"]["max_features"], int)
