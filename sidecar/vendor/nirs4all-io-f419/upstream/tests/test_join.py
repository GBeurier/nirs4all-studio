# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Tests for the relational merge/join engine (cardinality × coverage × duplicates)."""

from __future__ import annotations

import pandas as pd
import pytest

from nirs4all_io.materialize import (
    JoinError,
    concat_features,
    concat_samples,
    join_tables,
    merge_by_key,
)
from nirs4all_io.spec.enums import Cardinality, Coverage


# --------------------------------------------------------------------------- #
# concat_samples / concat_features                                            #
# --------------------------------------------------------------------------- #
def test_concat_samples_schema_union_and_origins():
    a = pd.DataFrame({"x": [1, 2], "y": [10, 20]})
    b = pd.DataFrame({"x": [3], "z": [99]})  # different schema
    out, origins, audit = concat_samples([a, b], ["a", "b"])
    assert len(out) == 3
    assert origins == ["a", "a", "b"]
    assert set(out.columns) == {"x", "y", "z"}
    assert pd.isna(out.loc[2, "y"]) and pd.isna(out.loc[0, "z"])
    assert any("schema-union" in w for w in audit.warnings)


def test_concat_features_by_key():
    nir = pd.DataFrame({"id": [1, 2], "n1": [0.1, 0.2]})
    mir = pd.DataFrame({"id": [2, 1], "m1": [0.9, 0.8]})  # different row order
    out, _ = concat_features([nir, mir], ["nir", "mir"], key="id")
    assert set(out.columns) == {"id", "n1", "m1"}
    assert out.loc[out.id == 1, "m1"].iloc[0] == 0.8  # aligned by key not row order


def test_concat_features_by_row_order_namespaces_clashes():
    a = pd.DataFrame({"v": [1, 2]})
    b = pd.DataFrame({"v": [3, 4]})
    out, _ = concat_features([a, b], ["a", "b"])
    assert list(out.columns) == ["v", "b__v"]


def test_concat_features_unequal_rows_errors():
    with pytest.raises(JoinError, match="equal row counts"):
        concat_features([pd.DataFrame({"a": [1, 2]}), pd.DataFrame({"b": [1]})], ["a", "b"])


# --------------------------------------------------------------------------- #
# join_tables — cardinality                                                   #
# --------------------------------------------------------------------------- #
def _measurements():
    return pd.DataFrame({"site": ["A", "B", "A", "C"], "val": [1, 2, 3, 4]})


def _sites(keys=("A", "B", "C")):
    return pd.DataFrame({"site": list(keys), "region": [f"r_{k}" for k in keys]})


def test_m1_broadcasts_lookup():
    out, audit = join_tables(_measurements(), _sites(), left_on="site", right_on="site", cardinality=Cardinality.MANY_TO_ONE, coverage=Coverage.COMPLETE, left_name="m", right_name="sites")
    assert len(out) == 4  # left preserved
    assert list(out["region"]) == ["r_A", "r_B", "r_A", "r_C"]  # broadcast
    assert audit.n_matched == 4


def test_m1_duplicate_right_key_errors():
    dup_sites = pd.DataFrame({"site": ["A", "A"], "region": ["x", "y"]})
    with pytest.raises(JoinError, match="duplicate keys on the right"):
        join_tables(_measurements(), dup_sites, left_on="site", right_on="site", cardinality=Cardinality.MANY_TO_ONE, coverage=Coverage.WARN)


def test_1to1_duplicate_errors_either_side():
    left = pd.DataFrame({"id": [1, 1], "a": [1, 2]})
    right = pd.DataFrame({"id": [1, 2], "b": [3, 4]})
    with pytest.raises(JoinError, match="duplicate keys on left"):
        join_tables(left, right, left_on="id", right_on="id", cardinality=Cardinality.ONE_TO_ONE, coverage=Coverage.WARN)


def test_1tom_expands_left():
    left = pd.DataFrame({"sid": [1, 2], "s": ["a", "b"]})
    right = pd.DataFrame({"sid": [1, 1, 2], "t": [10, 11, 20]})  # many per left key
    out, _ = join_tables(left, right, left_on="sid", right_on="sid", cardinality=Cardinality.ONE_TO_MANY, coverage=Coverage.COMPLETE)
    assert len(out) == 3
    assert sorted(out.loc[out.sid == 1, "t"]) == [10, 11]


# --------------------------------------------------------------------------- #
# join_tables — coverage                                                      #
# --------------------------------------------------------------------------- #
def test_coverage_complete_raises_on_missing():
    with pytest.raises(JoinError, match="coverage 'complete'"):
        join_tables(_measurements(), _sites(("A", "B")), left_on="site", right_on="site", cardinality=Cardinality.MANY_TO_ONE, coverage=Coverage.COMPLETE)


def test_coverage_warn_keeps_all_and_nullfills():
    out, audit = join_tables(_measurements(), _sites(("A", "B")), left_on="site", right_on="site", cardinality=Cardinality.MANY_TO_ONE, coverage=Coverage.WARN)
    assert len(out) == 4
    assert pd.isna(out.loc[out.site == "C", "region"]).all()
    assert any("unmatched" in w for w in audit.warnings)


def test_coverage_drop_removes_unmatched_with_audit():
    out, audit = join_tables(_measurements(), _sites(("A", "B")), left_on="site", right_on="site", cardinality=Cardinality.MANY_TO_ONE, coverage=Coverage.DROP)
    assert len(out) == 3  # the C row dropped
    assert "C" not in set(out["site"])
    assert audit.dropped_rows and audit.dropped_rows[0]["key"] == "C"


def test_coverage_error_raises_on_first_miss():
    with pytest.raises(JoinError, match="coverage 'error'"):
        join_tables(_measurements(), _sites(("A", "B")), left_on="site", right_on="site", cardinality=Cardinality.MANY_TO_ONE, coverage=Coverage.ERROR)


# --------------------------------------------------------------------------- #
# composite keys + by_key merge                                               #
# --------------------------------------------------------------------------- #
def test_composite_key_join():
    left = pd.DataFrame({"a": [1, 1], "b": ["x", "y"], "v": [10, 20]})
    right = pd.DataFrame({"a": [1, 1], "b": ["x", "y"], "w": [100, 200]})
    out, _ = join_tables(left, right, left_on=["a", "b"], right_on=["a", "b"], cardinality=Cardinality.ONE_TO_ONE, coverage=Coverage.COMPLETE)
    assert list(out["w"]) == [100, 200]


def test_merge_by_key_three_frames():
    a = pd.DataFrame({"id": [1, 2, 3], "a": [1, 2, 3]})
    b = pd.DataFrame({"id": [1, 2, 3], "b": [4, 5, 6]})
    c = pd.DataFrame({"id": [1, 2, 3], "c": [7, 8, 9]})
    out, _ = merge_by_key([a, b, c], ["a", "b", "c"], key="id")
    assert set(out.columns) == {"id", "a", "b", "c"}
    assert len(out) == 3
