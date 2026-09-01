# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Tests for alias normalization + legacy-keys -> DatasetSpec conversion."""

from __future__ import annotations

import pytest

from nirs4all_io.spec import (
    DatasetSpec,
    MergeMode,
    Partition,
    Role,
    alias_map,
    apply_key_aliases,
    legacy_to_spec_dict,
    normalize_to_spec_dict,
    validate_dict,
)


@pytest.mark.parametrize(
    "alias,canonical",
    [
        ("xtrain", "train_x"),
        ("X_cal", "train_x"),
        ("calibration_features", "train_x"),
        ("Xval", "test_x"),
        ("x_test", "test_x"),
        ("ycal", "train_y"),
        ("y_test", "test_y"),
        ("yval", "test_y"),
        ("meta_cal", "train_group"),
        ("metadata_val", "test_group"),
        ("cv", "folds"),
        ("cross_validation", "folds"),
        ("modalities", "sources"),
        ("dataset_name", "name"),
        ("problem_type", "task_type"),
        ("directory", "folder"),
        ("loading_params", "global_params"),
    ],
)
def test_alias_map_resolves_synonyms(alias, canonical):
    from nirs4all_io.spec import normalize_key

    assert alias_map()[normalize_key(alias)] == canonical


def test_apply_key_aliases_canonical_wins():
    cfg = {"Xtrain": "a.csv", "train_x": "canonical.csv"}
    out = apply_key_aliases(cfg)
    assert out["train_x"] == "canonical.csv"
    assert "Xtrain" not in out


def test_legacy_classic_four_files_to_spec():
    cfg = {"train_x": "Xcal.csv", "train_y": "Ycal.csv", "test_x": "Xval.csv", "test_y": "Yval.csv"}
    spec_dict = legacy_to_spec_dict(cfg)
    spec = validate_dict(spec_dict)
    by_id = {s.id: s for s in spec.sources}
    assert set(by_id) == {"train_x", "train_y", "test_x", "test_y"}
    assert by_id["train_x"].partition is Partition.TRAIN
    assert by_id["test_x"].partition is Partition.TEST
    assert by_id["train_y"].role is Role.TARGETS
    assert by_id["train_y"].join is not None and by_id["train_y"].join.right == "train_x"


def test_legacy_multisource_x_list():
    cfg = {"train_x": ["nir.csv", "mir.csv"], "train_y": "y.csv"}
    spec = validate_dict(legacy_to_spec_dict(cfg))
    feature_ids = [s.id for s in spec.sources if s.role is Role.FEATURES]
    assert feature_ids == ["train_x_0", "train_x_1"]
    # Y joins to the first feature source (source 0 owns Y).
    ysrc = next(s for s in spec.sources if s.role is Role.TARGETS)
    assert ysrc.join.right == "train_x_0"


def test_legacy_y_from_x_columns():
    cfg = {"train_x": "data.csv", "train_x_filter": {"regex": r"^\d"}, "train_y_filter": ["protein"]}
    spec = validate_dict(legacy_to_spec_dict(cfg))
    src = spec.sources[0]
    assert src.role is Role.MIXED
    roles = [c.role for c in src.columns]
    assert Role.TARGETS in roles and Role.FEATURES in roles


def test_legacy_folds_path():
    cfg = {"train_x": "X.csv", "train_y": "Y.csv", "folds": "folds.csv"}
    spec = validate_dict(legacy_to_spec_dict(cfg))
    assert spec.folds is not None and spec.folds.file == "folds.csv"


def test_legacy_aliased_input_end_to_end():
    # raw user dict full of aliases -> normalize_to_spec_dict -> valid spec
    raw = {"Xcal": "Xcal.csv", "Ycal": "Ycal.csv", "Xval": "Xval.csv", "Yval": "Yval.csv", "cv": "folds.csv", "problem_type": "regression"}
    spec = validate_dict(normalize_to_spec_dict(raw))
    assert spec.task_type.value == "regression"
    assert len(spec.sources) == 4


def test_new_spec_passes_through():
    new_spec = {"sources": [{"id": "x", "role": "features", "input": "x.csv"}]}
    assert normalize_to_spec_dict(new_spec) == new_spec


def test_concat_samples_alias_not_clobbered_for_new_spec():
    d = {"sources": [{"id": "d", "role": "mixed", "input": ["a.csv", "b.csv"], "merge": "concat_samples"}]}
    spec = DatasetSpec.from_dict(normalize_to_spec_dict(d))
    assert spec.sources[0].merge is MergeMode.CONCAT_SAMPLES
