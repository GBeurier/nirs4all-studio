from __future__ import annotations

from pathlib import Path

import yaml
from nirs4all.operators.models import OPLSDA, PLSDA
from nirs4all.operators.models.sklearn.opls import OPLS
from nirs4all.operators.splitters.splitters import (
    KennardStoneSplitter,
    SPXYFold,
    SPXYGFold,
)
from nirs4all.operators.transforms import (
    ASLSBaseline,
    Detrend,
    Gaussian,
    SavitzkyGolay,
    StandardNormalVariate,
)
from nirs4all.operators.transforms import ExtendedMultiplicativeScatterCorrection as EMSC
from nirs4all.operators.transforms import MultiplicativeScatterCorrection as MSC
from nirs4all.operators.transforms.orthogonalization import OSC
from nirs4all.pipeline.config.component_serialization import serialize_component
from sklearn.cross_decomposition import PLSRegression
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
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
            "default_variant": "regression",
            "variants": {
                "regression": variant_payload(regression_pipeline),
                "classification": variant_payload(classification_pipeline),
            },
        },
    }


def cartesian_preprocessing_space() -> dict[str, object]:
    """Shared preprocessing generator used by the advanced presets."""
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
        "count": 150,
    }


PRESETS = [
    build_preset(
        filename_stem="pls_basic",
        preset_id="pls_basic",
        name="Basic PLS Pipeline",
        description="Simple PLS templates for regression and classification",
        regression_pipeline=[
            StandardNormalVariate(),
            KFold(n_splits=5),
            {"model": PLSRegression(n_components=10)},
        ],
        classification_pipeline=[
            StandardNormalVariate(),
            StratifiedKFold(n_splits=5, shuffle=True, random_state=42),
            {"model": PLSDA(n_components=10)},
        ],
    ),
    build_preset(
        filename_stem="pls_derivative",
        preset_id="pls_derivative",
        name="PLS with Derivative",
        description="PLS templates with first derivative preprocessing",
        regression_pipeline=[
            SavitzkyGolay(polyorder=2, deriv=1),
            StandardNormalVariate(),
            KFold(n_splits=5),
            {"model": PLSRegression(n_components=15)},
        ],
        classification_pipeline=[
            SavitzkyGolay(polyorder=2, deriv=1),
            StandardNormalVariate(),
            StratifiedKFold(n_splits=5, shuffle=True, random_state=42),
            {"model": PLSDA(n_components=15)},
        ],
    ),
    build_preset(
        filename_stem="kennard_stone_pls",
        preset_id="kennard_stone_pls",
        name="Kennard-Stone PLS",
        description="PLS templates with sample selection",
        regression_pipeline=[
            MSC(),
            KennardStoneSplitter(test_size=0.2),
            {"model": PLSRegression(n_components=10)},
        ],
        classification_pipeline=[
            MSC(),
            StratifiedKFold(n_splits=5, shuffle=True, random_state=42),
            {"model": PLSDA(n_components=10)},
        ],
    ),
    build_preset(
        filename_stem="advanced_nirs",
        preset_id="advanced_nirs",
        name="Advanced NIRS Pipeline",
        description="Comprehensive NIRS preprocessing for regression and classification",
        regression_pipeline=[
            ASLSBaseline(lam=1e6, p=0.01),
            StandardNormalVariate(),
            SavitzkyGolay(window_length=15, polyorder=2, deriv=1),
            SPXYGFold(n_splits=5),
            {"model": OPLS(n_components=10)},
        ],
        classification_pipeline=[
            ASLSBaseline(lam=1e6, p=0.01),
            StandardNormalVariate(),
            SavitzkyGolay(window_length=15, polyorder=2, deriv=1),
            StratifiedKFold(n_splits=5, shuffle=True, random_state=42),
            {"model": OPLSDA(n_components=10)},
        ],
    ),
    build_preset(
        filename_stem="rf_standard",
        preset_id="rf_standard",
        name="Random Forest Pipeline",
        description="Random Forest templates with standard preprocessing",
        regression_pipeline=[
            StandardScaler(),
            KFold(n_splits=5),
            {"model": RandomForestRegressor(n_estimators=100, random_state=42)},
        ],
        classification_pipeline=[
            StandardScaler(),
            StratifiedKFold(n_splits=5, shuffle=True, random_state=42),
            {"model": RandomForestClassifier(n_estimators=100, random_state=42)},
        ],
    ),
    build_preset(
        filename_stem="pls_finetune_advanced",
        preset_id="pls_spxy_cartesian_finetune",
        name="Advanced PLS Pipeline",
        description="PLS finetuning with Cartesian preprocessing variants",
        regression_pipeline=[
            SPXYFold(n_splits=3, random_state=42),
            cartesian_preprocessing_space(),
            StandardScaler(with_mean=True, with_std=False),
            {
                "model": PLSRegression(scale=False),
                "name": "PLS",
                "finetune_params": {
                    "n_trials": 25,
                    "sampler": "binary",
                    "model_params": {"n_components": ("int", 1, 25)},
                },
            },
        ],
        classification_pipeline=[
            StratifiedKFold(n_splits=3, shuffle=True, random_state=42),
            cartesian_preprocessing_space(),
            StandardScaler(with_mean=True, with_std=False),
            {
                "model": PLSDA(n_components=8),
                "name": "PLSDA",
                "finetune_params": {
                    "n_trials": 25,
                    "sampler": "binary",
                    "model_params": {"n_components": ("int", 1, 25)},
                },
            },
        ],
    ),
]


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
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
