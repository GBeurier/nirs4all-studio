# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Adversarial inputs must produce clear errors / graceful handling, not crashes (Epic 6.1)."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

import nirs4all_io as nio
from nirs4all_io.materialize import JoinError
from nirs4all_io.spec import SpecError


def _csv(path, df):
    df.to_csv(path, sep=";", index=False)


def test_unaligned_row_counts_errors(tmp_path):
    _csv(tmp_path / "X.csv", pd.DataFrame(np.random.rand(5, 3), columns=["a", "b", "c"]))
    _csv(tmp_path / "Y.csv", pd.DataFrame({"y": [1.0, 2.0, 3.0]}))  # 3 rows vs 5
    spec = {"sources": [{"id": "x", "role": "features", "input": "X.csv"}, {"id": "y", "role": "targets", "input": "Y.csv", "join": {"to": "x", "how": "1:1"}}]}
    with pytest.raises(SpecError, match="not row-aligned"):
        nio.load(spec, base_dir=tmp_path, target="assembled")


def test_features_only_is_graceful(tmp_path):
    _csv(tmp_path / "Xcal.csv", pd.DataFrame(np.random.rand(4, 3), columns=["a", "b", "c"]))
    asm = nio.load(tmp_path, target="assembled")  # only X present -> no targets
    assert asm.blocks["train"].X[0].shape == (4, 3)
    assert asm.blocks["train"].y is None


def test_empty_directory_errors_clearly(tmp_path):
    (tmp_path / "readme.md").write_text("nothing here", encoding="utf-8")
    with pytest.raises(SpecError, match="no dataset files recognized"):
        nio.load(tmp_path, target="assembled")


def test_coverage_complete_missing_key_errors(tmp_path):
    _csv(tmp_path / "x.csv", pd.DataFrame({"w": [0.1, 0.2], "site": ["A", "Z"]}))
    _csv(tmp_path / "sites.csv", pd.DataFrame({"site": ["A", "B"], "region": ["n", "s"]}))
    spec = {"sources": [{"id": "x", "role": "mixed", "input": "x.csv", "columns": [{"role": "features", "select": ["w"]}, {"role": "metadata", "select": ["site"]}]}, {"id": "sites", "kind": "lookup", "input": "sites.csv", "columns": [{"role": "metadata", "select": ["region"]}], "join": {"to": "x", "on": "site", "how": "m:1", "coverage": "complete"}}]}
    with pytest.raises(JoinError, match="complete"):
        nio.load(spec, base_dir=tmp_path, target="assembled")


def test_malformed_spec_errors(tmp_path):
    with pytest.raises(SpecError):
        nio.load({"sources": []}, base_dir=tmp_path, target="assembled")


def test_ambiguous_multisource_is_warning_not_crash(tmp_path):
    # two files match train_x -> multi-source (warning), must not crash
    _csv(tmp_path / "Xcal_NIR.csv", pd.DataFrame(np.random.rand(4, 2), columns=["a", "b"]))
    _csv(tmp_path / "Xcal_MIR.csv", pd.DataFrame(np.random.rand(4, 2), columns=["c", "d"]))
    _csv(tmp_path / "Ycal.csv", pd.DataFrame({"y": np.arange(4.0)}))
    asm = nio.load(tmp_path, target="assembled")
    assert asm.n_sources == 2  # both Xcal_* recognized as multi-source features


def test_unknown_input_type_errors():
    with pytest.raises((SpecError, TypeError)):
        nio.load(12345, target="assembled")
