# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Parity oracle (Story 5.2, dev/test-only): nirs4all-io must build a SpectroDataset
equivalent to nirs4all's own DatasetConfigs on the same input. nirs4all is imported
read-only as an oracle; skipped if it is not installed. Run: pytest -m parity."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

# skip the whole module unless nirs4all (the modelling lib) is importable
pytest.importorskip("nirs4all.data", reason="parity oracle needs nirs4all installed")
pytestmark = pytest.mark.parity


def _write(path, df):
    df.to_csv(path, sep=";", index=False)


def _classic_fixture(tmp_path, n_train=20, n_test=8, n_feat=10):
    wl = [str(1000 + i * 5) for i in range(n_feat)]
    rng = np.random.default_rng(0)
    files = {
        "Xcal.csv": pd.DataFrame(rng.random((n_train, n_feat)) * 2.0 + 0.3, columns=wl),
        "Ycal.csv": pd.DataFrame({"y": rng.random(n_train) * 50}),
        "Xval.csv": pd.DataFrame(rng.random((n_test, n_feat)) * 2.0 + 0.3, columns=wl),
        "Yval.csv": pd.DataFrame({"y": rng.random(n_test) * 50}),
    }
    for name, df in files.items():
        _write(tmp_path / name, df)
    return {
        "train_x": str(tmp_path / "Xcal.csv"),
        "train_y": str(tmp_path / "Ycal.csv"),
        "test_x": str(tmp_path / "Xval.csv"),
        "test_y": str(tmp_path / "Yval.csv"),
        "delimiter": ";",
        "has_header": True,
    }


def test_parity_classic_regression(tmp_path):
    from nirs4all.data import DatasetConfigs

    import nirs4all_io as nio

    cfg = _classic_fixture(tmp_path)
    ref = DatasetConfigs(dict(cfg)).get_dataset_at(0)  # nirs4all's own SpectroDataset
    mine = nio.load(dict(cfg), target="spectrodataset")  # io builds a real SpectroDataset

    for part in ("train", "test"):
        sel = {"partition": part}
        ref_x = ref.x(sel, layout="2d", concat_source=True)
        mine_x = mine.x(sel, layout="2d", concat_source=True)
        assert ref_x.shape == mine_x.shape, f"{part} X shape: nirs4all {ref_x.shape} vs io {mine_x.shape}"
        np.testing.assert_allclose(np.asarray(ref_x, dtype=float), np.asarray(mine_x, dtype=float), rtol=1e-5, err_msg=f"{part} X values differ")
        np.testing.assert_allclose(ref.y(sel).ravel().astype(float), mine.y(sel).ravel().astype(float), rtol=1e-5)

    assert ref.task_type.value == mine.task_type.value  # both auto-detect 'regression'
    assert ref.headers(0) == mine.headers(0)  # wavelength headers preserved identically


def test_parity_classification_task_detection(tmp_path):
    from nirs4all.data import DatasetConfigs

    import nirs4all_io as nio

    wl = [str(1000 + i * 5) for i in range(8)]
    rng = np.random.default_rng(1)
    _write(tmp_path / "Xcal.csv", pd.DataFrame(rng.random((30, 8)), columns=wl))
    _write(tmp_path / "Ycal.csv", pd.DataFrame({"y": rng.integers(0, 3, 30)}))  # 3 classes
    cfg = {"train_x": str(tmp_path / "Xcal.csv"), "train_y": str(tmp_path / "Ycal.csv"), "delimiter": ";", "has_header": True}
    ref = DatasetConfigs(dict(cfg)).get_dataset_at(0)
    mine = nio.load(dict(cfg), target="spectrodataset")
    assert ref.task_type.value == mine.task_type.value  # both -> multiclass_classification


def test_categorical_labels_survive_partition_local_codebooks(tmp_path):
    import nirs4all_io as nio

    for part, labels in (("cal", ["b", "a", "b"]), ("val", ["a", "b", "a"])):
        _write(tmp_path / f"X{part}.csv", pd.DataFrame({"x": [1.5, 2.5, 3.5]}))
        _write(tmp_path / f"Y{part}.csv", pd.DataFrame({"class": labels}))
    ds = nio.load({
        "train_x": str(tmp_path / "Xcal.csv"), "train_y": str(tmp_path / "Ycal.csv"),
        "test_x": str(tmp_path / "Xval.csv"), "test_y": str(tmp_path / "Yval.csv"),
        "global_params": {"has_header": True, "delimiter": ";"},
    }, target="spectrodataset")
    np.testing.assert_array_equal(ds.y({"y": "raw"}).ravel(), ["b", "a", "b", "a", "b", "a"])
    np.testing.assert_array_equal(ds.y({"partition": "test"}).ravel(), [0, 1, 0])
