from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import yaml
from nirs4all.operators.splitters.splitters import SPXYFold
from nirs4all.operators.transforms import (
    ASLSBaseline,
    Detrend,
    FlexiblePCA,
    Gaussian,
    SavitzkyGolay,
    StandardNormalVariate,
)
from nirs4all.operators.transforms import ExtendedMultiplicativeScatterCorrection as EMSC
from nirs4all.operators.transforms import MultiplicativeScatterCorrection as MSC
from nirs4all.operators.transforms.orthogonalization import OSC
from nirs4all.operators.transforms.wavelet_denoise import WaveletDenoise
from nirs4all.pipeline.config.component_serialization import serialize_component
from sklearn.model_selection import KFold, StratifiedKFold
from sklearn.preprocessing import StandardScaler

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "api" / "presets"


def variant_payload(pipeline: list[object]) -> dict[str, object]:
    """Serialize one preset variant in the webapp preset contract."""
    return {
        "format": "yaml",
        "pipeline": serialize_component(pipeline),
    }


def build_preset(
    *,
    filename_stem: str,
    preset_id: str,
    name: str,
    description: str,
    complexity: int,
    regression_pipeline: list[object],
    classification_pipeline: list[object],
) -> dict[str, object]:
    """Build one dual-variant preset entry."""
    return {
        "filename_stem": filename_stem,
        "content": {
            "id": preset_id,
            "name": name,
            "description": description,
            "complexity": complexity,
            "default_variant": "regression",
            "variants": {
                "regression": variant_payload(regression_pipeline),
                "classification": variant_payload(classification_pipeline),
            },
        },
    }


def class_ref(path: str, **params: object) -> str | dict[str, object]:
    """Return a canonical class reference payload."""
    if not params:
        return path
    return {"class": path, "params": params}


def function_ref(path: str, *, framework: str) -> dict[str, str]:
    """Return a canonical function reference payload."""
    return {
        "function": path,
        "framework": framework,
    }


def model_step(
    model: str | dict[str, object],
    *,
    name: str | None = None,
    finetune_params: dict[str, object] | None = None,
    train_params: dict[str, object] | None = None,
    refit_params: dict[str, object] | None = None,
    extra: dict[str, object] | None = None,
) -> dict[str, object]:
    """Build a model step while keeping canonical payloads explicit."""
    step: dict[str, object] = {"model": model}
    if name:
        step["name"] = name
    if finetune_params:
        step["finetune_params"] = finetune_params
    if train_params:
        step["train_params"] = train_params
    if refit_params:
        step["refit_params"] = refit_params
    if extra:
        step.update(extra)
    return step


def kfold_regression(n_splits: int = 5) -> KFold:
    """Standard regression KFold preset."""
    return KFold(n_splits=n_splits, shuffle=True, random_state=42)


def kfold_classification(n_splits: int = 5) -> StratifiedKFold:
    """Standard classification KFold preset."""
    return StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)


def spxy_regression(n_splits: int = 3) -> SPXYFold:
    """Benchmark-style SPXY cross-validation for larger searches."""
    return SPXYFold(n_splits=n_splits, random_state=42)


def simple_preprocessing_space() -> dict[str, object]:
    """Three lightweight preprocessing options for fast presets."""
    return {
        "_or_": [
            StandardNormalVariate,
            MSC,
            SavitzkyGolay(window_length=15, polyorder=2, deriv=1),
        ]
    }


def complex_cartesian_preprocessing_space(*, count: int = 150) -> dict[str, object]:
    """Operational chemometric cartesian inspired by the benchmark PLS runs."""
    return {
        "_cartesian_": [
            {
                "_or_": [
                    None,
                    StandardNormalVariate,
                    MSC,
                    EMSC(degree=1),
                    EMSC(degree=2),
                ]
            },
            {
                "_or_": [
                    None,
                    SavitzkyGolay(window_length=11, polyorder=2, deriv=1),
                    SavitzkyGolay(window_length=15, polyorder=2, deriv=1),
                    SavitzkyGolay(window_length=21, polyorder=2, deriv=1),
                    SavitzkyGolay(window_length=31, polyorder=2, deriv=1),
                    SavitzkyGolay(window_length=15, polyorder=3, deriv=2),
                    SavitzkyGolay(window_length=21, polyorder=3, deriv=2),
                    SavitzkyGolay(window_length=31, polyorder=3, deriv=2),
                    Gaussian(order=0, sigma=1),
                    Gaussian(order=0, sigma=2),
                ]
            },
            {
                "_or_": [
                    None,
                    ASLSBaseline,
                    Detrend,
                ]
            },
            {
                "_or_": [
                    None,
                    OSC(1),
                    OSC(2),
                    OSC(3),
                ]
            },
        ],
        "count": count,
    }


def ultra_cartesian_preprocessing_space(*, count: int = 240) -> dict[str, object]:
    """Larger cartesian search for ultra presets and deep exploration."""
    return {
        "_cartesian_": [
            {
                "_or_": [
                    None,
                    StandardNormalVariate,
                    MSC,
                    EMSC(degree=1),
                    EMSC(degree=2),
                ]
            },
            {
                "_or_": [
                    None,
                    SavitzkyGolay(window_length=11, polyorder=2, deriv=1),
                    SavitzkyGolay(window_length=15, polyorder=2, deriv=1),
                    SavitzkyGolay(window_length=21, polyorder=2, deriv=1),
                    SavitzkyGolay(window_length=31, polyorder=2, deriv=1),
                    SavitzkyGolay(window_length=11, polyorder=3, deriv=2),
                    SavitzkyGolay(window_length=15, polyorder=3, deriv=2),
                    SavitzkyGolay(window_length=21, polyorder=3, deriv=2),
                    SavitzkyGolay(window_length=31, polyorder=3, deriv=2),
                    Gaussian(order=0, sigma=1),
                    Gaussian(order=0, sigma=2),
                    WaveletDenoise("db4", level=3),
                    WaveletDenoise("db4", level=5),
                ]
            },
            {
                "_or_": [
                    None,
                    ASLSBaseline,
                    ASLSBaseline(lam=1e5, p=0.01),
                    Detrend,
                ]
            },
            {
                "_or_": [
                    None,
                    OSC(1),
                    OSC(2),
                    OSC(3),
                    FlexiblePCA(n_components=0.25),
                ]
            },
        ],
        "count": count,
    }


def pls_finetune_params(*, n_trials: int = 25, upper: int = 25) -> dict[str, object]:
    """Benchmark-style PLS Optuna block."""
    return {
        "n_trials": n_trials,
        "sampler": "binary",
        "model_params": {
            "n_components": ("int", 1, upper),
        },
    }


def ridge_regression_finetune_params(*, n_trials: int = 40) -> dict[str, object]:
    """Ridge tuning space used in the tabular benchmark runs."""
    return {
        "n_trials": n_trials,
        "sampler": "tpe",
        "model_params": {
            "alpha": ("float_log", 1e-5, 1e4),
            "fit_intercept": ("categorical", [True, False]),
            "solver": ("categorical", ["auto", "svd", "cholesky", "lsqr"]),
        },
    }


def ridge_classification_finetune_params(*, n_trials: int = 30) -> dict[str, object]:
    """Simpler RidgeClassifier tuning for classification presets."""
    return {
        "n_trials": n_trials,
        "sampler": "tpe",
        "model_params": {
            "alpha": ("float_log", 1e-5, 1e4),
            "fit_intercept": ("categorical", [True, False]),
        },
    }


def aom_regression_finetune_params(*, n_trials: int = 80) -> dict[str, object]:
    """AOM-PLS tuning block aligned with the AOM benchmark script."""
    return {
        "n_trials": n_trials,
        "sampler": "tpe",
        "model_params": {
            "n_components": ("int", 1, 27),
            "n_orth": ("int", 0, 5),
            "operator_index": ("int", 0, 120),
        },
    }


def aom_classification_finetune_params(*, n_trials: int = 30) -> dict[str, object]:
    """Safe AOM-PLS tuning block for classification presets."""
    return {
        "n_trials": n_trials,
        "sampler": "tpe",
        "model_params": {
            "n_components": ("int", 1, 25),
        },
    }


def grid_finetune_params(
    search_space: dict[str, list[object]],
    *,
    n_trials: int | None = None,
) -> dict[str, object]:
    """Build a stable grid-search finetune block for webapp presets.

    The webapp editor rewrites top-level model ``_grid_`` sweeps into
    parameter-level generators, which explodes full pipeline expansion after
    round-trip. Using ``finetune_params`` keeps the model search scoped to the
    model controller and preserves the intended preset size.
    """
    total_trials = n_trials or math.prod(max(1, len(values)) for values in search_space.values())
    return {
        "n_trials": total_trials,
        "sampler": "grid",
        "approach": "single",
        "eval_mode": "best",
        "verbose": 0,
        "model_params": search_space,
    }


def lightgbm_finetune_params(*, n_trials: int = 25) -> dict[str, object]:
    """Shared LightGBM tuning space."""
    return {
        "n_trials": n_trials,
        "sampler": "tpe",
        "model_params": {
            "n_estimators": ("int", 100, 600),
            "max_depth": ("int", 3, 12),
            "learning_rate": ("float_log", 0.01, 0.2),
            "num_leaves": ("int", 15, 127),
            "subsample": ("float", 0.7, 1.0),
        },
    }


def random_forest_finetune_params(*, n_trials: int = 20) -> dict[str, object]:
    """Shared RandomForest tuning space."""
    return {
        "n_trials": n_trials,
        "sampler": "tpe",
        "model_params": {
            "n_estimators": ("int", 200, 800),
            "max_depth": ("int", 4, 20),
            "min_samples_leaf": ("int", 1, 5),
            "min_samples_split": ("int", 2, 12),
        },
    }


def xgboost_finetune_params(*, n_trials: int = 25) -> dict[str, object]:
    """Shared XGBoost tuning space."""
    return {
        "n_trials": n_trials,
        "sampler": "tpe",
        "model_params": {
            "n_estimators": ("int", 100, 600),
            "max_depth": ("int", 3, 10),
            "learning_rate": ("float_log", 0.01, 0.2),
            "subsample": ("float", 0.7, 1.0),
            "colsample_bytree": ("float", 0.6, 1.0),
        },
    }


def extra_trees_finetune_params(*, n_trials: int = 20) -> dict[str, object]:
    """ExtraTrees tuning space for the ultra tree preset."""
    return {
        "n_trials": n_trials,
        "sampler": "tpe",
        "model_params": {
            "n_estimators": ("int", 200, 800),
            "max_depth": ("int", 4, 20),
            "min_samples_leaf": ("int", 1, 5),
        },
    }


def gradient_boosting_finetune_params(*, n_trials: int = 20) -> dict[str, object]:
    """GradientBoosting tuning space for the ultra tree preset."""
    return {
        "n_trials": n_trials,
        "sampler": "tpe",
        "model_params": {
            "n_estimators": ("int", 100, 500),
            "learning_rate": ("float_log", 0.01, 0.2),
            "max_depth": ("int", 2, 6),
            "subsample": ("float", 0.7, 1.0),
        },
    }


def nicon_train_params(*, epochs: int = 250, patience: int = 60) -> dict[str, object]:
    """Operational PyTorch NICON training defaults."""
    return {
        "epochs": epochs,
        "patience": patience,
        "cyclic_lr": True,
        "cyclic_lr_mode": "triangular2",
        "base_lr": 0.0005,
        "max_lr": 0.01,
        "step_size": 120,
    }


def nicon_finetune_params(*, n_trials: int = 20, tune_epochs: int = 40, tune_patience: int = 20) -> dict[str, object]:
    """Search space borrowed from the nicon benchmark runs."""
    return {
        "n_trials": n_trials,
        "sampler": "tpe",
        "pruner": "hyperband",
        "approach": "grouped",
        "model_params": {
            "spatial_dropout": ("float", 0.01, 0.5),
            "filters1": ("categorical", [4, 8, 16, 32]),
            "dropout_rate": ("float", 0.01, 0.5),
            "filters2": ("categorical", [32, 64, 128, 256]),
            "filters3": ("categorical", [8, 16, 32, 64]),
            "dense_units": ("categorical", [8, 16, 32, 64]),
        },
        "train_params": {
            "epochs": tune_epochs,
            "patience": tune_patience,
            "learning_rate": 0.005,
            "verbose": 0,
        },
    }


def simple_pls_regression_step() -> dict[str, object]:
    """Simple PLS sweep for regression."""
    return model_step(
        class_ref("sklearn.cross_decomposition.PLSRegression"),
        name="PLS-Sweep",
        extra={"_range_": [2, 30, 4], "param": "n_components"},
    )


def simple_pls_classification_step() -> dict[str, object]:
    """Simple PLS sweep for classification."""
    return model_step(
        class_ref("nirs4all.operators.models.sklearn.plsda.PLSDA"),
        name="PLSDA-Sweep",
        extra={"_range_": [2, 30, 4], "param": "n_components"},
    )


def fixed_pls_regression_step(n_components: int) -> dict[str, object]:
    """Fixed PLS baseline."""
    return model_step(
        class_ref("sklearn.cross_decomposition.PLSRegression", n_components=n_components, scale=False),
        name=f"PLS-{n_components}",
    )


def fixed_pls_classification_step(n_components: int) -> dict[str, object]:
    """Fixed PLSDA baseline."""
    return model_step(
        class_ref("nirs4all.operators.models.sklearn.plsda.PLSDA", n_components=n_components),
        name=f"PLSDA-{n_components}",
    )


def tuned_pls_regression_step(*, n_trials: int = 25, upper: int = 25) -> dict[str, object]:
    """Finetuned PLS regression step."""
    return model_step(
        class_ref("sklearn.cross_decomposition.PLSRegression", scale=False),
        name="PLS-Finetuned",
        finetune_params=pls_finetune_params(n_trials=n_trials, upper=upper),
    )


def tuned_pls_classification_step(*, n_trials: int = 25, upper: int = 25) -> dict[str, object]:
    """Finetuned PLS classification step."""
    return model_step(
        class_ref("nirs4all.operators.models.sklearn.plsda.PLSDA"),
        name="PLSDA-Finetuned",
        finetune_params=pls_finetune_params(n_trials=n_trials, upper=upper),
    )


def tuned_ridge_regression_step(*, n_trials: int = 40) -> dict[str, object]:
    """Finetuned Ridge regression step."""
    return model_step(
        class_ref("sklearn.linear_model.Ridge"),
        name="Ridge-Finetuned",
        finetune_params=ridge_regression_finetune_params(n_trials=n_trials),
    )


def tuned_ridge_classification_step(*, n_trials: int = 30) -> dict[str, object]:
    """Finetuned Ridge classification step."""
    return model_step(
        class_ref("sklearn.linear_model.RidgeClassifier"),
        name="RidgeClassifier-Finetuned",
        finetune_params=ridge_classification_finetune_params(n_trials=n_trials),
    )


def fixed_aom_regression_step(n_components: int) -> dict[str, object]:
    """Fixed AOM-PLS regression step."""
    return model_step(
        class_ref(
            "nirs4all.operators.models.sklearn.aom_pls.AOMPLSRegressor",
            n_components=n_components,
            center=True,
            scale=False,
        ),
        name="AOM-PLS",
    )


def fixed_aom_classification_step(n_components: int) -> dict[str, object]:
    """Fixed AOM-PLS classification step."""
    return model_step(
        class_ref(
            "nirs4all.operators.models.sklearn.aom_pls_classifier.AOMPLSClassifier",
            n_components=n_components,
        ),
        name="AOM-PLS",
    )


def tuned_aom_regression_step(*, n_trials: int = 80) -> dict[str, object]:
    """Finetuned AOM-PLS regression step."""
    return model_step(
        class_ref("nirs4all.operators.models.sklearn.aom_pls.AOMPLSRegressor", center=True, scale=False),
        name="AOM-PLS-Finetuned",
        finetune_params=aom_regression_finetune_params(n_trials=n_trials),
    )


def tuned_aom_classification_step(*, n_trials: int = 30) -> dict[str, object]:
    """Finetuned AOM-PLS classification step."""
    return model_step(
        class_ref("nirs4all.operators.models.sklearn.aom_pls_classifier.AOMPLSClassifier"),
        name="AOM-PLS-Finetuned",
        finetune_params=aom_classification_finetune_params(n_trials=n_trials),
    )


def fixed_opls_regression_step(*, orthogonal_components: int = 2, pls_components: int = 15) -> dict[str, object]:
    """Fixed OPLS regression step."""
    return model_step(
        class_ref(
            "nirs4all.operators.models.sklearn.opls.OPLS",
            n_components=orthogonal_components,
            pls_components=pls_components,
            backend="numpy",
        ),
        name="OPLS",
    )


def fixed_opls_classification_step(*, orthogonal_components: int = 1, pls_components: int = 15) -> dict[str, object]:
    """Fixed OPLS classification step."""
    return model_step(
        class_ref(
            "nirs4all.operators.models.sklearn.oplsda.OPLSDA",
            n_components=orthogonal_components,
            pls_components=pls_components,
        ),
        name="OPLSDA",
    )


def fixed_ikpls_step(n_components: int) -> dict[str, object]:
    """Fixed IKPLS regression step."""
    return model_step(
        class_ref(
            "nirs4all.operators.models.sklearn.ikpls.IKPLS",
            n_components=n_components,
            backend="numpy",
        ),
        name="IKPLS",
    )


def lightgbm_grid_regression_step(*, simple: bool) -> dict[str, object]:
    """Grid-based LightGBM regression sweep."""
    search_space = (
        {"n_estimators": [100, 200, 400], "max_depth": [6, 10], "learning_rate": [0.05]}
        if simple
        else {"n_estimators": [150, 300, 600], "max_depth": [6, 10], "learning_rate": [0.03, 0.05]}
    )
    return model_step(
        class_ref("lightgbm.sklearn.LGBMRegressor", random_state=42, verbose=-1),
        name="LightGBM-Sweep",
        finetune_params=grid_finetune_params(search_space),
    )


def lightgbm_grid_classification_step(*, simple: bool) -> dict[str, object]:
    """Grid-based LightGBM classification sweep."""
    search_space = (
        {"n_estimators": [100, 200, 400], "max_depth": [6, 10], "learning_rate": [0.05]}
        if simple
        else {"n_estimators": [150, 300, 600], "max_depth": [6, 10], "learning_rate": [0.03, 0.05]}
    )
    return model_step(
        class_ref("lightgbm.sklearn.LGBMClassifier", random_state=42, verbose=-1),
        name="LightGBM-Sweep",
        finetune_params=grid_finetune_params(search_space),
    )


def random_forest_grid_regression_step(*, simple: bool) -> dict[str, object]:
    """Grid-based RandomForest regression sweep."""
    search_space = (
        {"n_estimators": [200, 400, 800], "max_depth": [8, 16]}
        if simple
        else {"n_estimators": [300, 600], "max_depth": [8, 12, 20], "min_samples_leaf": [1, 3]}
    )
    return model_step(
        class_ref("sklearn.ensemble.RandomForestRegressor", random_state=42),
        name="RandomForest-Sweep",
        finetune_params=grid_finetune_params(search_space),
    )


def random_forest_grid_classification_step(*, simple: bool) -> dict[str, object]:
    """Grid-based RandomForest classification sweep."""
    search_space = (
        {"n_estimators": [200, 400, 800], "max_depth": [8, 16]}
        if simple
        else {"n_estimators": [300, 600], "max_depth": [8, 12, 20], "min_samples_leaf": [1, 3]}
    )
    return model_step(
        class_ref("sklearn.ensemble.RandomForestClassifier", random_state=42),
        name="RandomForest-Sweep",
        finetune_params=grid_finetune_params(search_space),
    )


def xgboost_grid_regression_step() -> dict[str, object]:
    """Grid-based XGBoost regression sweep."""
    search_space = {
        "n_estimators": [150, 300, 600],
        "max_depth": [4, 6, 8],
        "learning_rate": [0.03, 0.05],
    }
    return model_step(
        class_ref("xgboost.sklearn.XGBRegressor", random_state=42, verbosity=0),
        name="XGBoost-Sweep",
        finetune_params=grid_finetune_params(search_space),
    )


def xgboost_grid_classification_step() -> dict[str, object]:
    """Grid-based XGBoost classification sweep."""
    search_space = {
        "n_estimators": [150, 300, 600],
        "max_depth": [4, 6, 8],
        "learning_rate": [0.03, 0.05],
    }
    return model_step(
        class_ref("xgboost.sklearn.XGBClassifier", random_state=42, verbosity=0),
        name="XGBoost-Sweep",
        finetune_params=grid_finetune_params(search_space),
    )


def tuned_lightgbm_regression_step(*, n_trials: int = 25) -> dict[str, object]:
    """Finetuned LightGBM regression step."""
    return model_step(
        class_ref("lightgbm.sklearn.LGBMRegressor", random_state=42, verbose=-1),
        name="LightGBM-Finetuned",
        finetune_params=lightgbm_finetune_params(n_trials=n_trials),
    )


def tuned_lightgbm_classification_step(*, n_trials: int = 25) -> dict[str, object]:
    """Finetuned LightGBM classification step."""
    return model_step(
        class_ref("lightgbm.sklearn.LGBMClassifier", random_state=42, verbose=-1),
        name="LightGBM-Finetuned",
        finetune_params=lightgbm_finetune_params(n_trials=n_trials),
    )


def tuned_random_forest_regression_step(*, n_trials: int = 20) -> dict[str, object]:
    """Finetuned RandomForest regression step."""
    return model_step(
        class_ref("sklearn.ensemble.RandomForestRegressor", random_state=42),
        name="RandomForest-Finetuned",
        finetune_params=random_forest_finetune_params(n_trials=n_trials),
    )


def tuned_random_forest_classification_step(*, n_trials: int = 20) -> dict[str, object]:
    """Finetuned RandomForest classification step."""
    return model_step(
        class_ref("sklearn.ensemble.RandomForestClassifier", random_state=42),
        name="RandomForest-Finetuned",
        finetune_params=random_forest_finetune_params(n_trials=n_trials),
    )


def tuned_xgboost_regression_step(*, n_trials: int = 25) -> dict[str, object]:
    """Finetuned XGBoost regression step."""
    return model_step(
        class_ref("xgboost.sklearn.XGBRegressor", random_state=42, verbosity=0),
        name="XGBoost-Finetuned",
        finetune_params=xgboost_finetune_params(n_trials=n_trials),
    )


def tuned_xgboost_classification_step(*, n_trials: int = 25) -> dict[str, object]:
    """Finetuned XGBoost classification step."""
    return model_step(
        class_ref("xgboost.sklearn.XGBClassifier", random_state=42, verbosity=0),
        name="XGBoost-Finetuned",
        finetune_params=xgboost_finetune_params(n_trials=n_trials),
    )


def tuned_extra_trees_regression_step(*, n_trials: int = 20) -> dict[str, object]:
    """Finetuned ExtraTrees regression step."""
    return model_step(
        class_ref("sklearn.ensemble.ExtraTreesRegressor", random_state=42),
        name="ExtraTrees-Finetuned",
        finetune_params=extra_trees_finetune_params(n_trials=n_trials),
    )


def tuned_extra_trees_classification_step(*, n_trials: int = 20) -> dict[str, object]:
    """Finetuned ExtraTrees classification step."""
    return model_step(
        class_ref("sklearn.ensemble.ExtraTreesClassifier", random_state=42),
        name="ExtraTrees-Finetuned",
        finetune_params=extra_trees_finetune_params(n_trials=n_trials),
    )


def tuned_gradient_boosting_regression_step(*, n_trials: int = 20) -> dict[str, object]:
    """Finetuned GradientBoosting regression step."""
    return model_step(
        class_ref("sklearn.ensemble.GradientBoostingRegressor", random_state=42),
        name="GradientBoosting-Finetuned",
        finetune_params=gradient_boosting_finetune_params(n_trials=n_trials),
    )


def tuned_gradient_boosting_classification_step(*, n_trials: int = 20) -> dict[str, object]:
    """Finetuned GradientBoosting classification step."""
    return model_step(
        class_ref("sklearn.ensemble.GradientBoostingClassifier", random_state=42),
        name="GradientBoosting-Finetuned",
        finetune_params=gradient_boosting_finetune_params(n_trials=n_trials),
    )


def tabpfn_regression_step() -> dict[str, object]:
    """Fast TabPFN regression step."""
    return model_step(
        class_ref("tabpfn.regressor.TabPFNRegressor", ignore_pretraining_limits=True),
        name="TabPFN",
    )


def tabpfn_classification_step() -> dict[str, object]:
    """Fast TabPFN classification step."""
    return model_step(
        class_ref("tabpfn.classifier.TabPFNClassifier", ignore_pretraining_limits=True),
        name="TabPFN",
    )


def nicon_regression_step(*, deep: bool) -> dict[str, object]:
    """PyTorch NICON regression step."""
    train_params = nicon_train_params(epochs=400 if deep else 250, patience=100 if deep else 60)
    finetune_params = nicon_finetune_params(n_trials=25, tune_epochs=60, tune_patience=25) if deep else None
    return model_step(
        function_ref("nirs4all.operators.models.pytorch.nicon.customizable_nicon", framework="pytorch"),
        name="NICON-CNN",
        train_params=train_params,
        finetune_params=finetune_params,
    )


def nicon_classification_step(*, deep: bool) -> dict[str, object]:
    """PyTorch NICON classification step."""
    train_params = nicon_train_params(epochs=400 if deep else 250, patience=100 if deep else 60)
    finetune_params = nicon_finetune_params(n_trials=25, tune_epochs=60, tune_patience=25) if deep else None
    return model_step(
        function_ref("nirs4all.operators.models.pytorch.nicon.customizable_nicon_classification", framework="pytorch"),
        name="NICON-CNN",
        train_params=train_params,
        finetune_params=finetune_params,
    )


PRESETS = [
    build_preset(
        filename_stem="simple_pls",
        preset_id="simple_pls",
        name="Simple PLS",
        description="Three classic preprocessing choices, KFold, and a single n_components sweep for PLS.",
        complexity=1,
        regression_pipeline=[
            simple_preprocessing_space(),
            kfold_regression(5),
            simple_pls_regression_step(),
        ],
        classification_pipeline=[
            simple_preprocessing_space(),
            kfold_classification(5),
            simple_pls_classification_step(),
        ],
    ),
    build_preset(
        filename_stem="fast_result",
        preset_id="fast_result",
        name="Fast Result",
        description="Quick SPXY-oriented preset with simple preprocessing, AOM-PLS, and TabPFN for fast first results.",
        complexity=2,
        regression_pipeline=[
            simple_preprocessing_space(),
            spxy_regression(3),
            fixed_aom_regression_step(12),
            tabpfn_regression_step(),
        ],
        classification_pipeline=[
            simple_preprocessing_space(),
            kfold_classification(3),
            fixed_aom_classification_step(12),
            tabpfn_classification_step(),
        ],
    ),
    build_preset(
        filename_stem="simple_trees_boosting",
        preset_id="simple_trees_boosting",
        name="Simple Trees / Boosting",
        description="Same lightweight preprocessing pattern as Simple PLS, with LightGBM and RandomForest sweeps.",
        complexity=3,
        regression_pipeline=[
            simple_preprocessing_space(),
            kfold_regression(5),
            lightgbm_grid_regression_step(simple=True),
            random_forest_grid_regression_step(simple=True),
        ],
        classification_pipeline=[
            simple_preprocessing_space(),
            kfold_classification(5),
            lightgbm_grid_classification_step(simple=True),
            random_forest_grid_classification_step(simple=True),
        ],
    ),
    build_preset(
        filename_stem="complex_pls",
        preset_id="complex_pls",
        name="Complex PLS",
        description="Benchmark-style cartesian preprocessing with fixed PLS, tuned PLS, tuned Ridge, and AOM-PLS.",
        complexity=4,
        regression_pipeline=[
            complex_cartesian_preprocessing_space(count=150),
            kfold_regression(3),
            StandardScaler(with_mean=True, with_std=False),
            fixed_pls_regression_step(12),
            tuned_pls_regression_step(n_trials=25, upper=25),
            tuned_ridge_regression_step(n_trials=40),
            fixed_aom_regression_step(12),
        ],
        classification_pipeline=[
            complex_cartesian_preprocessing_space(count=150),
            kfold_classification(3),
            StandardScaler(with_mean=True, with_std=False),
            fixed_pls_classification_step(12),
            tuned_pls_classification_step(n_trials=25, upper=25),
            tuned_ridge_classification_step(n_trials=30),
            fixed_aom_classification_step(12),
        ],
    ),
    build_preset(
        filename_stem="complex_trees",
        preset_id="complex_trees",
        name="Complex Trees",
        description="Cartesian preprocessing with LightGBM, RandomForest, and XGBoost tree/boosting grids.",
        complexity=5,
        regression_pipeline=[
            complex_cartesian_preprocessing_space(count=40),
            kfold_regression(3),
            lightgbm_grid_regression_step(simple=False),
            random_forest_grid_regression_step(simple=False),
            xgboost_grid_regression_step(),
        ],
        classification_pipeline=[
            complex_cartesian_preprocessing_space(count=40),
            kfold_classification(3),
            lightgbm_grid_classification_step(simple=False),
            random_forest_grid_classification_step(simple=False),
            xgboost_grid_classification_step(),
        ],
    ),
    build_preset(
        filename_stem="nonlinear_exploration",
        preset_id="nonlinear_exploration",
        name="Non-Linear Exploration",
        description="Cartesian preprocessing with LightGBM, XGBoost, NICON, and TabPFN for broad non-linear screening.",
        complexity=6,
        regression_pipeline=[
            complex_cartesian_preprocessing_space(count=40),
            spxy_regression(3),
            StandardScaler(),
            lightgbm_grid_regression_step(simple=False),
            xgboost_grid_regression_step(),
            nicon_regression_step(deep=False),
            tabpfn_regression_step(),
        ],
        classification_pipeline=[
            complex_cartesian_preprocessing_space(count=40),
            kfold_classification(3),
            StandardScaler(),
            lightgbm_grid_classification_step(simple=False),
            xgboost_grid_classification_step(),
            nicon_classification_step(deep=False),
            tabpfn_classification_step(),
        ],
    ),
    build_preset(
        filename_stem="ultra_pls",
        preset_id="ultra_pls",
        name="Ultra PLS",
        description="Large cartesian chemometric exploration with PLS, OPLS, IKPLS-style linear models, and tuned Ridge.",
        complexity=7,
        regression_pipeline=[
            ultra_cartesian_preprocessing_space(count=240),
            kfold_regression(3),
            StandardScaler(with_mean=True, with_std=False),
            fixed_pls_regression_step(15),
            fixed_opls_regression_step(orthogonal_components=2, pls_components=15),
            fixed_ikpls_step(15),
            tuned_ridge_regression_step(n_trials=60),
        ],
        classification_pipeline=[
            ultra_cartesian_preprocessing_space(count=240),
            kfold_classification(3),
            StandardScaler(with_mean=True, with_std=False),
            fixed_pls_classification_step(15),
            fixed_opls_classification_step(orthogonal_components=1, pls_components=15),
            fixed_aom_classification_step(15),
            tuned_ridge_classification_step(n_trials=40),
        ],
    ),
    build_preset(
        filename_stem="ultra_trees",
        preset_id="ultra_trees",
        name="Ultra Trees",
        description="Bigger preprocessing search with tuned LightGBM, RandomForest, XGBoost, ExtraTrees, and GradientBoosting.",
        complexity=8,
        regression_pipeline=[
            ultra_cartesian_preprocessing_space(count=80),
            spxy_regression(3),
            tuned_lightgbm_regression_step(n_trials=35),
            tuned_random_forest_regression_step(n_trials=25),
            tuned_xgboost_regression_step(n_trials=35),
            tuned_extra_trees_regression_step(n_trials=20),
            tuned_gradient_boosting_regression_step(n_trials=20),
        ],
        classification_pipeline=[
            ultra_cartesian_preprocessing_space(count=80),
            kfold_classification(3),
            tuned_lightgbm_classification_step(n_trials=35),
            tuned_random_forest_classification_step(n_trials=25),
            tuned_xgboost_classification_step(n_trials=35),
            tuned_extra_trees_classification_step(n_trials=20),
            tuned_gradient_boosting_classification_step(n_trials=20),
        ],
    ),
    build_preset(
        filename_stem="deep_nonlinear_exploration",
        preset_id="deep_nonlinear_exploration",
        name="Deep Non-Linear Exploration",
        description="Large cartesian preprocessing with tuned gradient-boosted trees, tuned NICON, and TabPFN.",
        complexity=9,
        regression_pipeline=[
            ultra_cartesian_preprocessing_space(count=80),
            spxy_regression(3),
            StandardScaler(),
            tuned_lightgbm_regression_step(n_trials=25),
            tuned_xgboost_regression_step(n_trials=25),
            nicon_regression_step(deep=True),
            tabpfn_regression_step(),
        ],
        classification_pipeline=[
            ultra_cartesian_preprocessing_space(count=80),
            kfold_classification(3),
            StandardScaler(),
            tuned_lightgbm_classification_step(n_trials=25),
            tuned_xgboost_classification_step(n_trials=25),
            nicon_classification_step(deep=True),
            tabpfn_classification_step(),
        ],
    ),
    build_preset(
        filename_stem="ultra_slow",
        preset_id="ultra_slow",
        name="Ultra Slow",
        description="Heavy Cartesian preset mixing tuned PLS, tuned Ridge, tuned AOM-PLS, tuned LightGBM, and TabPFN.",
        complexity=10,
        regression_pipeline=[
            complex_cartesian_preprocessing_space(count=90),
            spxy_regression(3),
            StandardScaler(with_mean=True, with_std=False),
            tuned_pls_regression_step(n_trials=40, upper=30),
            tuned_ridge_regression_step(n_trials=60),
            tuned_lightgbm_regression_step(n_trials=30),
            tuned_aom_regression_step(n_trials=80),
            tabpfn_regression_step(),
        ],
        classification_pipeline=[
            complex_cartesian_preprocessing_space(count=90),
            kfold_classification(3),
            StandardScaler(with_mean=True, with_std=False),
            tuned_pls_classification_step(n_trials=35, upper=30),
            tuned_ridge_classification_step(n_trials=40),
            tuned_lightgbm_classification_step(n_trials=30),
            tuned_aom_classification_step(n_trials=30),
            tabpfn_classification_step(),
        ],
    ),
]


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    desired_paths = {
        OUTPUT_DIR / f"{preset['filename_stem']}.yaml"
        for preset in PRESETS
    }
    for stale_path in OUTPUT_DIR.glob("*.yaml"):
        if stale_path not in desired_paths:
            stale_path.unlink()
            print(f"removed {stale_path.relative_to(OUTPUT_DIR.parents[1])}")

    for preset in PRESETS:
        path = OUTPUT_DIR / f"{preset['filename_stem']}.yaml"
        with open(path, "w", encoding="utf-8") as file:
            yaml.safe_dump(
                preset["content"],
                file,
                sort_keys=False,
                default_flow_style=False,
                allow_unicode=False,
            )
        print(f"wrote {path.relative_to(OUTPUT_DIR.parents[1])}")


if __name__ == "__main__":
    main()
