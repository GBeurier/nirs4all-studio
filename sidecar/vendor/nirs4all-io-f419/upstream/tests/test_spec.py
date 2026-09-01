# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Tests for the DatasetSpec IR: round-trip, selectors, validation, cookbook specs."""

from __future__ import annotations

import pytest

from nirs4all_io.spec import (
    Cardinality,
    DatasetSpec,
    MergeMode,
    Role,
    SpecError,
    parse_selector,
    validate_dict,
)
from nirs4all_io.spec.selectors import (
    DtypeSelector,
    NameRangeSelector,
    NameSelector,
    PositionalSelector,
    RegexSelector,
    RestSelector,
    SliceSelector,
)


# --------------------------------------------------------------------------- #
# Selectors (E.1)                                                             #
# --------------------------------------------------------------------------- #
def test_selector_parsing_forms():
    assert isinstance(parse_selector(-1), PositionalSelector)
    assert isinstance(parse_selector([0, 1]), PositionalSelector)
    assert isinstance(parse_selector("2:-1"), SliceSelector)
    assert isinstance(parse_selector(["protein", "moisture"]), NameSelector)
    assert isinstance(parse_selector({"regex": r"^\d+$"}), RegexSelector)
    assert isinstance(parse_selector({"dtype": "string"}), DtypeSelector)
    assert isinstance(parse_selector({"name_range": ["400", "2500"]}), NameRangeSelector)
    assert isinstance(parse_selector("rest"), RestSelector)


def test_selector_rejects_bad_dtype_and_bool():
    with pytest.raises(SpecError):
        parse_selector({"dtype": "complex"})
    with pytest.raises(SpecError):
        parse_selector(True)


def test_selector_resolution_against_columns():
    cols = ["id", "400", "401", "402", "protein", "site"]
    dtypes = ["string", "numeric", "numeric", "numeric", "numeric", "string"]
    assert PositionalSelector((-1,)).resolve(cols, dtypes, set()) == [5]
    assert SliceSelector("1:4").resolve(cols, dtypes, set()) == [1, 2, 3]
    assert NameSelector(("protein",)).resolve(cols, dtypes, set()) == [4]
    assert RegexSelector(r"^\d+$").resolve(cols, dtypes, set()) == [1, 2, 3]
    assert DtypeSelector("string").resolve(cols, dtypes, set()) == [0, 5]
    assert NameRangeSelector("400", "402").resolve(cols, dtypes, set()) == [1, 2, 3]
    assert RestSelector().resolve(cols, dtypes, {0, 4, 5}) == [1, 2, 3]


@pytest.mark.parametrize(
    "value",
    [-1, [0, 1], "2:-1", ["a", "b"], {"regex": "x"}, {"dtype": "numeric"}, {"name_range": ["a", "b"]}, "rest", "auto"],
)
def test_selector_roundtrip_to_spec(value):
    assert parse_selector(value).to_spec() == value


# --------------------------------------------------------------------------- #
# Spec round-trip                                                             #
# --------------------------------------------------------------------------- #
def test_minimal_spec_roundtrip():
    d = {"sources": [{"id": "x", "role": "features", "input": "spectra.csv", "partition": "predict"}]}
    spec = DatasetSpec.from_dict(d)
    again = DatasetSpec.from_dict(spec.to_dict())
    assert again.to_dict() == spec.to_dict()
    assert spec.sources[0].role is Role.FEATURES


def test_yaml_roundtrip_preserves_semantics():
    spec = DatasetSpec.from_dict(
        {
            "name": "demo",
            "task_type": "regression",
            "sample_index": {"by": "id", "key": "Sample_ID"},
            "sources": [{"id": "data", "role": "mixed", "input": "data.csv", "columns": {"features": "0:-1", "targets": -1}}],
        }
    )
    restored = DatasetSpec.from_yaml(spec.to_yaml())
    assert restored.to_dict() == spec.to_dict()
    assert restored.sources[0].columns_from_map is True


# --------------------------------------------------------------------------- #
# Validation                                                                  #
# --------------------------------------------------------------------------- #
def test_validation_rejects_duplicate_ids():
    with pytest.raises(SpecError, match="duplicate source ids"):
        validate_dict({"sources": [{"id": "a", "role": "features", "input": "x.csv"}, {"id": "a", "role": "targets", "input": "y.csv"}]})


def test_validation_requires_key_for_id_indexing():
    with pytest.raises(SpecError, match="requires a 'key'"):
        validate_dict({"sample_index": {"by": "id"}, "sources": [{"id": "x", "role": "features", "input": "x.csv"}]})


def test_validation_multifile_needs_merge():
    with pytest.raises(SpecError, match="requires a 'merge'"):
        validate_dict({"sources": [{"id": "x", "role": "features", "input": ["a.csv", "b.csv"]}]})


def test_validation_lookup_must_be_joined():
    with pytest.raises(SpecError, match="never joined"):
        validate_dict(
            {
                "sources": [
                    {"id": "x", "role": "features", "input": "x.csv"},
                    {"id": "sites", "role": "metadata", "kind": "lookup", "input": "sites.csv"},
                ]
            }
        )


def test_validation_folds_exactly_one():
    with pytest.raises(SpecError, match="exactly one"):
        validate_dict({"sources": [{"id": "x", "role": "features", "input": "x.csv"}], "folds": {"file": "f.csv", "column": "cv"}})


# --------------------------------------------------------------------------- #
# Cookbook specs (Appendix L) parse + validate                                #
# --------------------------------------------------------------------------- #
L2 = {"sources": [{"id": "data", "role": "mixed", "input": "data.csv", "columns": {"features": "0:-1", "targets": -1}}]}

L5 = {
    "sample_index": {"by": "id", "key": "Sample_ID"},
    "sources": [
        {"id": "x", "role": "features", "input": "X.csv", "key": "Sample_ID"},
        {"id": "y", "role": "targets", "input": "Y.csv", "key": "Sample_ID", "join": {"to": "x", "on": "Sample_ID", "how": "1:1", "coverage": "complete"}},
    ],
}

L8 = {
    "name": "mango_multi_batch",
    "task_type": "regression",
    "sample_index": {"by": "row"},
    "sources": [
        {
            "id": "measurements",
            "role": "mixed",
            "input": ["batch_a.csv", "batch_b.csv", "batch_c.csv"],
            "merge": "concat_samples",
            "columns": [
                {"role": "features", "select": {"regex": r"^\d+(\.\d+)?$"}},
                {"role": "targets", "select": ["protein", "moisture"]},
                {"role": "metadata", "select": ["site_code", "date", "operator"]},
                {"role": "ignore", "select": ["notes"]},
            ],
        },
        {
            "id": "sites",
            "kind": "lookup",
            "input": "sites.csv",
            "columns": [{"role": "metadata", "select": "rest"}],
            "join": {"left": "measurements", "right": "sites", "left_on": "site_code", "right_on": "site_code", "cardinality": "m:1", "coverage": "complete"},
        },
    ],
}


@pytest.mark.parametrize("d", [L2, L5, L8], ids=["L2", "L5", "L8_flagship"])
def test_cookbook_specs_validate(d):
    spec = validate_dict(d)
    assert DatasetSpec.from_dict(spec.to_dict()).to_dict() == spec.to_dict()


def test_flagship_join_semantics():
    spec = DatasetSpec.from_dict(L8)
    sites = spec.sources[1]
    assert sites.join is not None
    assert sites.join.cardinality is Cardinality.MANY_TO_ONE
    assert sites.merge is MergeMode.NONE
    meas = spec.sources[0]
    assert meas.merge is MergeMode.CONCAT_SAMPLES
    assert [c.role for c in meas.columns] == [Role.FEATURES, Role.TARGETS, Role.METADATA, Role.IGNORE]
    # lookup with columns but no source role -> defaults to 'mixed' (roles come
    # from columns), not silently 'features' (Codex foundation fix #3).
    assert sites.role is Role.MIXED


# --------------------------------------------------------------------------- #
# Codex foundation-review fixes                                               #
# --------------------------------------------------------------------------- #
def test_column_role_mixed_rejected():
    with pytest.raises(SpecError, match="source-level role"):
        DatasetSpec.from_dict({"sources": [{"id": "x", "role": "mixed", "input": "x.csv", "columns": [{"role": "mixed", "select": "rest"}]}]})


def test_m1_join_requires_explicit_keys_not_source_key():
    # full-form m:1 with only a per-source 'key' (alignment) must be rejected
    bad = {
        "sources": [
            {"id": "x", "role": "features", "input": "x.csv"},
            {"id": "sites", "kind": "lookup", "input": "sites.csv", "key": "site_code", "columns": [{"role": "metadata", "select": "rest"}], "join": {"left": "x", "right": "sites", "cardinality": "m:1"}},
        ]
    }
    with pytest.raises(SpecError, match="needs explicit left_on/right_on"):
        validate_dict(bad)


def test_m1_join_shorthand_on_is_accepted():
    ok = {
        "sources": [
            {"id": "x", "role": "features", "input": "x.csv"},
            {"id": "sites", "kind": "lookup", "input": "sites.csv", "columns": [{"role": "metadata", "select": "rest"}], "join": {"to": "x", "on": "site_code", "how": "m:1"}},
        ]
    }
    spec = validate_dict(ok)
    j = spec.sources[1].join
    assert j.left_on == "site_code" and j.right_on == "site_code"


def test_lookup_with_columns_defaults_to_mixed_and_roundtrips():
    d = {"sources": [{"id": "x", "role": "features", "input": "x.csv"}, {"id": "ref", "kind": "lookup", "input": "ref.csv", "columns": [{"role": "targets", "select": ["protein"]}, {"role": "metadata", "select": "rest"}], "join": {"to": "x", "on": "id", "how": "m:1"}}]}
    spec = DatasetSpec.from_dict(d)
    assert spec.sources[1].role is Role.MIXED
    # round-trip keeps role 'mixed' (not silently 'features')
    assert DatasetSpec.from_dict(spec.to_dict()).sources[1].role is Role.MIXED
