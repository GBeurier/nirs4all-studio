# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Tests for convention profiles + matching engine (FolderParser parity + vendor-corpus)."""

from __future__ import annotations

from nirs4all_io.conventions import (
    builtin_profiles,
    get_stem,
    match_items,
    pattern_matches,
    resolve_profiles,
)
from nirs4all_io.spec.enums import Partition, Role


def _by_role(result):
    return {(a.role, a.partition, a.source_index): a.name for a in result.assignments}


def test_builtin_profiles_load():
    profiles = builtin_profiles()
    assert set(profiles) == {"nirs4all-classic", "train-test", "bare", "vendor-corpus"}
    assert profiles["vendor-corpus"].is_vendor_corpus


def test_word_boundary_matching():
    assert pattern_matches("xcal.csv", "xcal")
    assert pattern_matches("m_train.csv", "m", word_boundary=True)  # boundary after 'm'
    assert not pattern_matches("max.csv", "m", word_boundary=True)  # 'ma' is not a boundary
    assert pattern_matches("x.csv", "x", word_boundary=True)


def test_compound_extension_stem():
    assert get_stem("Xcal.csv.gz") == "Xcal"
    assert get_stem("data.csv") == "data"


def test_nirs4all_classic_cal_val_parity():
    profiles = resolve_profiles(["nirs4all-classic"])
    result = match_items(["Xcal.csv", "Xval.csv", "Ycal.csv", "Yval.csv"], profiles)
    roles = _by_role(result)
    assert roles[(Role.FEATURES, Partition.TRAIN, 0)] == "Xcal.csv"
    assert roles[(Role.FEATURES, Partition.TEST, 0)] == "Xval.csv"
    assert roles[(Role.TARGETS, Partition.TRAIN, 0)] == "Ycal.csv"
    assert roles[(Role.TARGETS, Partition.TEST, 0)] == "Yval.csv"
    assert not result.unmatched


def test_train_test_profile():
    profiles = resolve_profiles(["train-test"])
    result = match_items(["X_train.csv", "X_test.csv", "y_train.csv", "y_test.csv"], profiles)
    roles = _by_role(result)
    assert roles[(Role.FEATURES, Partition.TRAIN, 0)] == "X_train.csv"
    assert roles[(Role.TARGETS, Partition.TEST, 0)] == "y_test.csv"


def test_multi_source_detection():
    profiles = resolve_profiles(["nirs4all-classic"])
    result = match_items(["Xcal_NIR.csv", "Xcal_MIR.csv", "Ycal.csv"], profiles)
    train_x = sorted(a.name for a in result.assignments if a.role is Role.FEATURES and a.partition is Partition.TRAIN)
    assert train_x == ["Xcal_MIR.csv", "Xcal_NIR.csv"]
    assert any("multi-source" in w for w in result.warnings)


def test_bare_stems():
    profiles = resolve_profiles(["nirs4all-classic"])
    result = match_items(["X.csv", "Y.csv", "M.csv"], profiles)
    roles = _by_role(result)
    assert roles[(Role.FEATURES, Partition.TRAIN, 0)] == "X.csv"
    assert roles[(Role.TARGETS, Partition.TRAIN, 0)] == "Y.csv"
    assert roles[(Role.METADATA, Partition.TRAIN, 0)] == "M.csv"


def test_folds_file_detected():
    profiles = resolve_profiles(["nirs4all-classic"])
    result = match_items(["Xcal.csv", "Ycal.csv", "folds.csv"], profiles)
    assert result.fold_files == ["folds.csv"]


def test_unsupported_extension_ignored():
    profiles = resolve_profiles(["nirs4all-classic"])
    result = match_items(["Xcal.csv", "plot.png"], profiles)
    names = {a.name for a in result.assignments}
    assert "plot.png" not in names
    assert "plot.png" in result.unmatched


def test_vendor_corpus_match():
    profiles = resolve_profiles(["vendor-corpus"])
    result = match_items(["s1.0", "s2.0", "s3.0", "reference.csv"], profiles)
    assert result.vendor is not None
    assert result.vendor.spectra == ["s1.0", "s2.0", "s3.0"]
    assert result.vendor.reference == ["reference.csv"]
    assert result.vendor.join.get("sample_key") == "filename_stem"


def test_vendor_corpus_with_sniff_predicate():
    profiles = resolve_profiles(["vendor-corpus"])
    # opaque extensions; rely on a sniff predicate instead of the format list
    result = match_items(["a.dat", "b.dat", "labels.csv"], profiles, is_spectrum=lambda n: n.endswith(".dat"))
    assert result.vendor.spectra == ["a.dat", "b.dat"]
    assert result.vendor.reference == ["labels.csv"]
