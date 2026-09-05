# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Regression tests for the Codex Phase-1 review fixes (silent-misjoin / lost-row)."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

import nirs4all_io as nio
from nirs4all_io.materialize import JoinError, concat_features, effective_params
from nirs4all_io.spec import LoadingParams, SpecError
from nirs4all_io.spec.dataset_spec import NaConfig
from nirs4all_io.spec.enums import FillMethod, NaPolicy


def _csv(path, df):
    df.to_csv(path, sep=";", index=False)


def test_concat_features_dup_key_now_errors():
    # blocker fix: keyed concat_features is a validated 1:1 join, not a raw inner merge
    a = pd.DataFrame({"id": [1, 1], "a": [1, 2]})
    b = pd.DataFrame({"id": [1, 2], "b": [3, 4]})
    with pytest.raises(JoinError):
        concat_features([a, b], ["a", "b"], key="id")


def test_composite_key_join_assemble(tmp_path):
    _csv(tmp_path / "x.csv", pd.DataFrame({"a": [1, 1, 2], "b": ["p", "q", "p"], "w0": [0.1, 0.2, 0.3]}))
    _csv(tmp_path / "y.csv", pd.DataFrame({"a": [1, 1, 2], "b": ["p", "q", "p"], "target": [10.0, 20.0, 30.0]}))
    spec = {
        "sample_index": {"by": "id", "key": ["a", "b"]},
        "sources": [
            {"id": "x", "role": "features", "input": "x.csv", "key": ["a", "b"]},
            {"id": "y", "role": "targets", "input": "y.csv", "key": ["a", "b"], "join": {"left": "x", "right": "y", "left_on": ["a", "b"], "right_on": ["a", "b"], "cardinality": "1:1", "coverage": "complete"}},
        ],
    }
    asm = nio.load(spec, base_dir=tmp_path, target="assembled")
    assert asm.blocks["train"].X[0].shape == (3, 1)
    assert list(asm.blocks["train"].y.ravel()) == [10.0, 20.0, 30.0]


def test_declared_join_key_missing_errors(tmp_path):
    _csv(tmp_path / "x.csv", pd.DataFrame({"id": [1, 2], "w": [0.1, 0.2]}))
    _csv(tmp_path / "y.csv", pd.DataFrame({"other_id": [1, 2], "t": [1.0, 2.0]}))
    spec = {
        "sources": [
            {"id": "x", "role": "features", "input": "x.csv", "key": "id"},
            {"id": "y", "role": "targets", "input": "y.csv", "join": {"to": "x", "on": "id", "how": "m:1"}},  # 'id' absent in y
        ]
    }
    with pytest.raises(SpecError, match="join keys not found"):
        nio.load(spec, base_dir=tmp_path, target="assembled")


def test_column_split_after_join_with_unknown_policy(tmp_path):
    # split column lives in a metadata source joined onto features; split happens post-join
    _csv(tmp_path / "x.csv", pd.DataFrame({"400": np.arange(6.0), "401": np.arange(6.0)}))
    _csv(tmp_path / "labels.csv", pd.DataFrame({"set": ["cal", "cal", "val", "val", "other", "other"], "y": np.arange(6.0)}))
    spec = {
        "sources": [
            {"id": "x", "role": "features", "input": "x.csv"},
            {"id": "labels", "role": "mixed", "input": "labels.csv", "columns": [{"role": "metadata", "select": ["set"]}, {"role": "targets", "select": ["y"]}], "join": {"to": "x", "how": "1:1"}},
        ],
        "partitions": {"by": "column", "column": "set", "train_values": ["cal"], "test_values": ["val"], "unknown_policy": "train"},
    }
    asm = nio.load(spec, base_dir=tmp_path, target="assembled")
    # cal(2) + unknown 'other'(2) -> train(4); val(2) -> test(2)
    assert asm.blocks["train"].X[0].shape[0] == 4
    assert asm.blocks["test"].X[0].shape[0] == 2


def test_list_of_files_from_mixed_dirs(tmp_path):
    d1, d2 = tmp_path / "d1", tmp_path / "d2"
    d1.mkdir()
    d2.mkdir()
    _csv(d1 / "Xcal.csv", pd.DataFrame({"a": [0.1, 0.2, 0.3], "b": [0.4, 0.5, 0.6]}))
    _csv(d2 / "Ycal.csv", pd.DataFrame({"y": [1.0, 2.0, 3.0]}))
    asm = nio.load([str(d1 / "Xcal.csv"), str(d2 / "Ycal.csv")], target="assembled")
    assert asm.blocks["train"].X[0].shape == (3, 2)
    assert asm.blocks["train"].y is not None and asm.blocks["train"].y.shape == (3, 1)


def test_na_field_merge_inherits_global_fill():
    glob = LoadingParams(na=NaConfig(policy=NaPolicy.REPLACE, fill_method=FillMethod.VALUE, fill_value=9.0))
    src = LoadingParams(na=NaConfig(policy=NaPolicy.REPLACE))  # configures policy but not fill_value
    eff = effective_params(glob, src)
    assert eff.na.policy is NaPolicy.REPLACE
    assert eff.na.fill_value == 9.0  # inherited from global (not wiped)
    assert eff.na.fill_method is FillMethod.VALUE


def test_na_default_per_column_true():
    assert NaConfig().fill_per_column is True
