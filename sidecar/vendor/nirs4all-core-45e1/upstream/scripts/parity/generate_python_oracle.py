#!/usr/bin/env python3
"""Generate full-Python nirs4all parity goldens for portable aggregate pipelines."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import yaml
from sklearn.cross_decomposition import PLSRegression

ROOT = Path(__file__).resolve().parents[2]
WORKSPACE = ROOT.parent
NIRS4ALL_SRC = WORKSPACE / "nirs4all"
if NIRS4ALL_SRC.is_dir():
    sys.path.insert(0, str(NIRS4ALL_SRC))

from nirs4all.operators.splitters import KennardStoneSplitter  # noqa: E402
from nirs4all.operators.transforms import SavitzkyGolay, StandardNormalVariate  # noqa: E402

FIXTURE_DIR = ROOT / "tests" / "parity" / "fixtures"
OUTPUT = ROOT / "tests" / "parity" / "expected" / "portable_python_oracle.json"
CASE_NAMES = [
    "portable_snv_pls",
    "portable_savgol_pls",
    "portable_kennard_stone_snv_pls",
    "portable_methods_pipeline",
]


def deterministic_noise(row: int, col: int) -> float:
    state = ((row + 1) * 73856093) ^ ((col + 1) * 19349663)
    state &= 0xFFFFFFFF
    state = (1664525 * state + 1013904223) & 0xFFFFFFFF
    return state / 4294967295 - 0.5


def make_dataset(rows: int = 40, cols: int = 28) -> tuple[np.ndarray, np.ndarray]:
    X = np.empty((rows, cols), dtype=np.float64)
    y = np.empty(rows, dtype=np.float64)
    for r in range(rows):
        phase = r / 5
        target = 0.0
        for c in range(cols):
            wavelength = 900 + c * 8
            value = (
                0.6 * math.sin(phase + c / 7)
                + 0.25 * math.cos(r / 6 - c / 11)
                + 0.002 * wavelength
                + ((r % 4) - 1.5) * 0.03
                + 0.12 * deterministic_noise(r, c)
                + 0.03 * math.sin(((r + 1) * (c + 2)) / 13)
            )
            X[r, c] = value
            target += value * (0.04 if c < cols / 2 else -0.025) + 0.01 * deterministic_noise(c, r)
        y[r] = target + 0.2 * math.sin(r / 3) + r * 0.015
    return X, y


def load_fixture(name: str) -> dict[str, Any]:
    path = FIXTURE_DIR / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def component_values(step: dict[str, Any]) -> list[int]:
    if "_range_" in step:
        if step.get("param") != "n_components":
            raise ValueError("Only n_components _range_ sweeps are portable")
        start, stop, stride = [int(v) for v in step["_range_"]]
        return list(range(start, stop + 1, stride))
    params = step.get("model", {}).get("params", {})
    return [int(params.get("n_components", 2))]


def instantiate_transform(step: dict[str, Any]):
    cls = step.get("class")
    params = step.get("params", {})
    if cls in {
        "nirs4all.operators.transforms.SNV",
        "nirs4all.operators.transforms.StandardNormalVariate",
        "nirs4all.operators.transforms.scalers.StandardNormalVariate",
    }:
        return "StandardNormalVariate", StandardNormalVariate(**params)
    if cls in {
        "nirs4all.operators.transforms.SavitzkyGolay",
        "nirs4all.operators.transforms.nirs.SavitzkyGolay",
    }:
        return "SavitzkyGolay", SavitzkyGolay(**params)
    raise ValueError(f"Unsupported portable transform: {cls}")


def split_indices(definition: dict[str, Any], X: np.ndarray, y: np.ndarray) -> tuple[str, np.ndarray, np.ndarray]:
    for step in definition["pipeline"]:
        cls = step.get("class") if isinstance(step, dict) else None
        if cls in {
            "nirs4all.operators.splitters.KennardStoneSplitter",
            "nirs4all.operators.splitters.splitters.KennardStoneSplitter",
        }:
            splitter = KennardStoneSplitter(**step.get("params", {}))
            train, test = next(splitter.split(X, y))
            return "KennardStone", np.asarray(train, dtype=int), np.asarray(test, dtype=int)
    all_indices = np.arange(X.shape[0], dtype=int)
    return "all", all_indices, all_indices


def execute_case(name: str, X: np.ndarray, y: np.ndarray) -> dict[str, Any]:
    definition = load_fixture(name)
    split_kind, train_indices, test_indices = split_indices(definition, X, y)
    X_train = X[train_indices].copy()
    X_test = X[test_indices].copy()
    y_train = y[train_indices].copy()
    y_test = y[test_indices].copy()
    preprocessing: list[str] = []
    model_step: dict[str, Any] | None = None

    for step in definition["pipeline"]:
        if "model" in step:
            model_step = step
            continue
        cls = step.get("class")
        if cls and "KennardStoneSplitter" in cls:
            continue
        label, transform = instantiate_transform(step)
        transform.fit(X_train, y_train)
        X_train = transform.transform(X_train)
        X_test = transform.transform(X_test)
        preprocessing.append(label)

    if model_step is None:
        raise ValueError(f"{name} has no model step")

    variants = []
    for n_components in component_values(model_step):
        model = PLSRegression(n_components=n_components)
        model.fit(X_train, y_train)
        predictions = model.predict(X_test).reshape(-1)
        diff = predictions - y_test
        rmse = float(np.sqrt(np.mean(diff * diff)))
        variants.append(
            {
                "n_components": n_components,
                "rmse": rmse,
                "predictions": predictions.tolist(),
            }
        )

    selected = min(variants, key=lambda item: item["rmse"])
    return {
        "name": name,
        "fixture": f"tests/parity/fixtures/{name}.json",
        "split": {
            "kind": split_kind,
            "trainIndices": train_indices.tolist(),
            "testIndices": test_indices.tolist(),
        },
        "preprocessing": preprocessing,
        "targets": y_test.tolist(),
        "variants": variants,
        "selected": selected,
    }


def main() -> int:
    X, y = make_dataset()
    payload = {
        "metadata": {
            "source": "full Python nirs4all operators + sklearn.cross_decomposition.PLSRegression",
            "generator": "scripts/parity/generate_python_oracle.py",
            "tolerances": {
                "split_indices": 0,
                "targets_abs": 1e-12,
                "rmse_abs": 1e-6,
                "predictions_abs": 1e-5,
            },
        },
        "dataset": {
            "rows": int(X.shape[0]),
            "cols": int(X.shape[1]),
            "X": X.reshape(-1).tolist(),
            "y": y.tolist(),
        },
        "cases": [execute_case(name, X, y) for name in CASE_NAMES],
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    for name in CASE_NAMES:
        yaml_path = FIXTURE_DIR / f"{name}.yaml"
        json_path = FIXTURE_DIR / f"{name}.json"
        yaml_payload = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
        json_payload = json.loads(json_path.read_text(encoding="utf-8"))
        if yaml_payload != json_payload:
            raise AssertionError(f"JSON/YAML fixture mismatch for {name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
