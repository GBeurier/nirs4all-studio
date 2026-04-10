#!/usr/bin/env python
"""One-shot generator for the 5 seed preset YAML files in api/presets/.

This script is used during initial migration from the hardcoded preset list
in api/pipelines.py to the file-based preset system. It builds each preset
as a real Python pipeline (matching what was previously hardcoded), runs it
through nirs4all's canonical serializer, and writes a YAML file ready to be
consumed by api/preset_loader.py.

Run from the repo root:
    .venv/Scripts/python.exe nirs4all-webapp/scripts/generate_seed_presets.py

Re-running is safe — it overwrites api/presets/*.yaml.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from nirs4all.operators.models import OPLS
from nirs4all.operators.splitters import KennardStoneSplitter, SPXYGFold
from nirs4all.operators.transforms import (
    ASLSBaseline,
    MultiplicativeScatterCorrection,
    SavitzkyGolay,
    StandardNormalVariate,
)
from nirs4all.pipeline.config.component_serialization import serialize_component
from sklearn.cross_decomposition import PLSRegression
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import KFold
from sklearn.preprocessing import StandardScaler

SEED_PRESETS: list[dict[str, Any]] = [
    {
        "id": "pls_basic",
        "name": "Basic PLS Pipeline",
        "description": "Simple PLS regression with SNV preprocessing",
        "task_type": "regression",
        "pipeline": [
            StandardNormalVariate(),
            KFold(n_splits=5),
            {"model": PLSRegression(n_components=10)},
        ],
    },
    {
        "id": "pls_derivative",
        "name": "PLS with Derivative",
        "description": "PLS regression with first derivative preprocessing",
        "task_type": "regression",
        "pipeline": [
            SavitzkyGolay(window_length=11, polyorder=2, deriv=1),
            StandardNormalVariate(),
            KFold(n_splits=5),
            {"model": PLSRegression(n_components=15)},
        ],
    },
    {
        "id": "rf_standard",
        "name": "Random Forest Pipeline",
        "description": "Random Forest with standard preprocessing",
        "task_type": "regression",
        "pipeline": [
            StandardScaler(),
            KFold(n_splits=5),
            {"model": RandomForestRegressor(n_estimators=100)},
        ],
    },
    {
        "id": "kennard_stone_pls",
        "name": "Kennard-Stone PLS",
        "description": "PLS with Kennard-Stone sample selection",
        "task_type": "regression",
        "pipeline": [
            MultiplicativeScatterCorrection(),
            KennardStoneSplitter(test_size=0.2),
            {"model": PLSRegression(n_components=10)},
        ],
    },
    {
        "id": "advanced_nirs",
        "name": "Advanced NIRS Pipeline",
        "description": "Comprehensive NIRS preprocessing with OPLS",
        "task_type": "regression",
        "pipeline": [
            ASLSBaseline(lam=1e6, p=0.01),
            StandardNormalVariate(),
            SavitzkyGolay(window_length=15, polyorder=2, deriv=1),
            SPXYGFold(n_splits=5),
            {"model": OPLS(n_components=10)},
        ],
    },
]


def main() -> None:
    output_dir = Path(__file__).resolve().parents[1] / "api" / "presets"
    output_dir.mkdir(parents=True, exist_ok=True)

    for preset in SEED_PRESETS:
        canonical = {
            "id": preset["id"],
            "name": preset["name"],
            "description": preset["description"],
            "task_type": preset["task_type"],
            "pipeline": serialize_component(preset["pipeline"]),
        }
        out_file = output_dir / f"{preset['id']}.yaml"
        with open(out_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(canonical, f, sort_keys=False, default_flow_style=False)
        print(f"  wrote {out_file.relative_to(output_dir.parents[1])}")


if __name__ == "__main__":
    main()
