# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Regression tests for the final Codex review fixes."""

from __future__ import annotations

import numpy as np
import pandas as pd

import nirs4all_io as nio
from nirs4all_io.conventions import get_stem
from nirs4all_io.spec import validate_dict
from nirs4all_io.spec.normalize import legacy_to_spec_dict


def _csv(path, df):
    df.to_csv(path, sep=";", index=False)


def test_filename_stem_virtual_key_join(tmp_path):
    """Blocker fix: concat_samples materializes `filename_stem` so a lookup can join by stem."""
    for stem in ("s1", "s2", "s3"):
        _csv(tmp_path / f"{stem}.csv", pd.DataFrame({"400": [0.1], "401": [0.2]}))  # 1 row per "spectrum"
    _csv(tmp_path / "ref.csv", pd.DataFrame({"filename_stem": ["s1", "s2", "s3"], "region": ["n", "s", "e"], "protein": [1.0, 2.0, 3.0]}))
    spec = {
        "conventions": [],
        "sources": [
            {"id": "spectra", "role": "features", "input": ["s1.csv", "s2.csv", "s3.csv"], "merge": "concat_samples", "key": "filename_stem"},
            {"id": "ref", "kind": "lookup", "input": "ref.csv", "columns": [{"role": "targets", "select": ["protein"]}, {"role": "metadata", "select": ["region"]}], "join": {"to": "spectra", "on": "filename_stem", "how": "m:1", "coverage": "complete"}},
        ],
    }
    asm = nio.load(spec, base_dir=tmp_path, target="assembled")
    block = asm.blocks["train"]
    assert block.X[0].shape == (3, 2)  # 3 spectra x 2 wavelengths
    assert sorted(block.metadata["region"]) == ["e", "n", "s"]  # broadcast by stem
    assert sorted(block.y.ravel()) == [1.0, 2.0, 3.0]


def test_filename_stem_join_with_compressed_csv(tmp_path):
    """filename_stem must use compound-extension stems (s1.csv.gz -> 's1'), matching get_stem."""
    for stem in ("s1", "s2"):
        pd.DataFrame({"400": [0.1], "401": [0.2]}).to_csv(tmp_path / f"{stem}.csv.gz", sep=";", index=False, compression="gzip")
    _csv(tmp_path / "ref.csv", pd.DataFrame({"filename_stem": ["s1", "s2"], "y": [10.0, 20.0]}))
    spec = {
        "sources": [
            {"id": "spectra", "role": "features", "input": ["s1.csv.gz", "s2.csv.gz"], "merge": "concat_samples", "key": "filename_stem"},
            {"id": "ref", "kind": "lookup", "input": "ref.csv", "columns": [{"role": "targets", "select": ["y"]}], "join": {"to": "spectra", "on": "filename_stem", "how": "m:1", "coverage": "complete"}},
        ],
    }
    asm = nio.load(spec, base_dir=tmp_path, target="assembled")  # coverage:complete -> would error if stems were 's1.csv'
    assert sorted(asm.blocks["train"].y.ravel()) == [10.0, 20.0]


def test_get_stem_compound_extensions():
    assert get_stem("X.csv.gz") == "X"
    assert get_stem("X.csv.zip") == "X"  # was "X." (off-by-one)
    assert get_stem("data.csv") == "data"
    assert get_stem("foo.bar.baz") == "foo.bar"


def test_legacy_group_filter_applied():
    cfg = {"train_x": "X.csv", "train_y": "Y.csv", "train_group": "M.csv", "train_group_filter": ["site", "date"]}
    spec = validate_dict(legacy_to_spec_dict(cfg))
    msrc = next(s for s in spec.sources if s.id == "train_m")
    assert msrc.role.value == "mixed"
    assert [c.select.to_spec() for c in msrc.columns] == [["site", "date"]]


def test_load_accepts_datasetplan(tmp_path):
    """Appendix I: load(plan) must work (not only load(plan.accept()))."""
    cols = [str(1000 + i * 5) for i in range(8)]
    df = pd.DataFrame(np.random.rand(6, 8), columns=cols)
    df["protein"] = np.arange(6.0)
    _csv(tmp_path / "data.csv", df)
    plan = nio.infer(tmp_path / "data.csv")
    # pass the DatasetPlan directly (resolved_spec carries absolute paths)
    asm = nio.load(plan, target="assembled")  # no base_dir needed
    assert asm.blocks["train"].X[0].shape == (6, 8)
    assert asm.blocks["train"].y.shape == (6, 1)
