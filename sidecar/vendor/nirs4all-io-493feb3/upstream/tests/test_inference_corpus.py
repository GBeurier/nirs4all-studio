# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Labeled inference corpus + per-decision precision + abstention (Stories 3.4/3.6).

A small *synthetic* labeled corpus measures the inference engine's per-decision
accuracy and verifies it ABSTAINS on ambiguous signal types rather than guessing.
Scores remain uncalibrated (C5): full Brier/ECE calibration needs a larger
vendor/domain-split real corpus and is deferred (documented, not claimed).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import nirs4all_io as nio


def _wl(n=20, start=1000, step=5):
    return [str(start + i * step) for i in range(n)]


def _write_combined(tmp, name, X, y, *, seed=0):
    cols = _wl(X.shape[1])
    df = pd.DataFrame(X, columns=cols)
    df["target"] = y
    df.to_csv(tmp / name, sep=";", index=False)
    return tmp / name


def _absorbance(rng, n=30, p=20):
    # [0.4, 1.4]: unambiguous absorbance (max>1.2 rules out reflectance; max<1.5
    # rules out the %-scorers) -> the detector commits rather than abstaining.
    return rng.random((n, p)) * 1.0 + 0.4


def _snv(rng, n=30, p=20):
    return rng.standard_normal((n, p))  # mean~0 std~1 -> preprocessed


def _reflectance(rng, n=30, p=20):
    return rng.random((n, p)) * 0.6 + 0.2  # [0.2,0.8] -> reflectance/transmittance overlap -> abstain


# (id, builder(tmp,rng)->input, expected) ; expected fields may be None to skip
CORPUS = [
    ("abs_regression", lambda t, r: _write_combined(t, "d.csv", _absorbance(r), r.random(30) * 50), {"structure": "single_combined", "signal_type": "absorbance", "task_type": "regression", "roles": {"1000": "features", "target": "targets"}}),
    ("snv_regression", lambda t, r: _write_combined(t, "d.csv", _snv(r), r.random(30) * 50), {"structure": "single_combined", "signal_type": "preprocessed", "task_type": "regression"}),
    ("abs_multiclass", lambda t, r: _write_combined(t, "d.csv", _absorbance(r), r.integers(0, 4, 30)), {"structure": "single_combined", "signal_type": "absorbance", "task_type": "multiclass"}),
    ("abs_binary", lambda t, r: _write_combined(t, "d.csv", _absorbance(r), r.integers(0, 2, 30)), {"structure": "single_combined", "task_type": "binary"}),
    ("reflectance_ambiguous", lambda t, r: _write_combined(t, "d.csv", _reflectance(r), r.random(30) * 50), {"structure": "single_combined", "signal_type_ambiguous": True}),
]


def _build_folder(tmp, rng):
    cols = _wl(10)
    pd.DataFrame(_absorbance(rng, 20, 10), columns=cols).to_csv(tmp / "Xcal.csv", sep=";", index=False)
    pd.DataFrame({"y": rng.random(20) * 50}).to_csv(tmp / "Ycal.csv", sep=";", index=False)
    pd.DataFrame(_absorbance(rng, 8, 10), columns=cols).to_csv(tmp / "Xval.csv", sep=";", index=False)
    pd.DataFrame({"y": rng.random(8) * 50}).to_csv(tmp / "Yval.csv", sep=";", index=False)
    return tmp


CORPUS.append(("classic_folder", _build_folder, {"structure": "train_test_folder", "task_type": "regression"}))


def test_inference_precision_and_abstention(tmp_path):
    rng = np.random.default_rng(0)
    tally: dict[str, list[int]] = {"structure": [], "signal_type": [], "task_type": [], "column_role": []}
    for i, (case_id, builder, expected) in enumerate(CORPUS):
        case_dir = tmp_path / f"c{i}_{case_id}"
        case_dir.mkdir()
        inp = builder(case_dir, rng)
        plan = nio.infer(inp)

        if expected.get("structure"):
            tally["structure"].append(int(plan.structure.value == expected["structure"]))
        if expected.get("signal_type") and plan.signal_type is not None:
            tally["signal_type"].append(int(plan.signal_type.value == expected["signal_type"]))
        if expected.get("task_type") and plan.task_type is not None:
            tally["task_type"].append(int(plan.task_type.value == expected["task_type"]))
        if expected.get("roles") and plan.columns:
            roles = {g["col"]: g["role"] for g in plan.columns[0]["column_roles"]}
            for col, want in expected["roles"].items():
                tally["column_role"].append(int(roles.get(col) == want))
        if expected.get("signal_type_ambiguous"):
            # ambiguous reflectance/transmittance overlap must ABSTAIN (unknown), not guess
            assert plan.signal_type is None or plan.signal_type.value == "unknown" or plan.signal_type.ambiguous

    report = {d: (sum(v) / len(v) if v else None) for d, v in tally.items()}
    print("inference precision (synthetic corpus):", report)
    # per-decision precision targets on this small corpus
    assert report["structure"] == 1.0, report
    assert report["task_type"] == 1.0, report
    assert report["signal_type"] is not None and report["signal_type"] >= 0.5, report
    assert report["column_role"] is not None and report["column_role"] >= 0.9, report
