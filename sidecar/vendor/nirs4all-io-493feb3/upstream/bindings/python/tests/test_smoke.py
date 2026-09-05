# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Smoke tests for the pyo3 binding's JSON surface against the contract corpus."""
from pathlib import Path

import pytest
from nirs4all_io._adapter import to_spectrodataset
from nirs4all_io._package import DatasetPackage

import nirs4all_io as nio

CORPUS = Path(__file__).resolve().parents[3] / "tests/goldens/contract/corpus"


def test_infer_returns_plan_dict():
    plan = nio.infer(str(CORPUS / "single_combined"))
    assert isinstance(plan, dict)
    assert "resolved_spec" in plan


def test_to_spec_returns_validatable_spec():
    spec = nio.to_spec(str(CORPUS / "train_test"))
    assert spec["schema_version"] == 1
    # the produced spec round-trips through validate()
    nio.validate(spec)


def test_load_assembled_summary():
    assembled = nio.load(str(CORPUS / "x_y_separate"), target="assembled")
    assert "blocks" in assembled
    assert type(assembled["assembled_schema_version"]) is int
    assert assembled["assembled_schema_version"] == 2


@pytest.mark.parametrize("wire_version", [None, 2.0, True, "2"])
def test_public_assembled_paths_reject_non_integer_or_retired_wire(monkeypatch, wire_version):
    """Fresh-wheel public readers accept only an exact integer v2 marker."""
    full = {"assembled_schema_version": wire_version, "blocks": {}}
    monkeypatch.setattr(nio, "load_summary", lambda *_args: full)
    with pytest.raises(ValueError, match="assembled_schema_version=2"):
        nio.load("legacy.csv", target="assembled")
    with pytest.raises(ValueError, match="assembled_schema_version=2"):
        DatasetPackage(full)
    with pytest.raises(ValueError, match="assembled_schema_version=2"):
        nio.to_spectrodataset(full, spectro_dataset_cls=_RecordingDataset)


def test_validate_rejects_invalid_spec():
    with pytest.raises(ValueError):
        nio.validate({"partitions": {"by": "random"}})


class _RecordingDataset:
    """Recording double so the SpectroDataset adapter is testable without nirs4all."""

    def __init__(self, name):
        self.name = name
        self.add_samples_calls = []
        self.targets = 0

    def add_samples(self, x, meta, headers=None, header_unit=None):
        self.add_samples_calls.append(meta)

    def add_targets(self, y):
        self.targets += 1

    def set_signal_type(self, *a, **k):
        pass

    def add_metadata(self, df):
        pass

    def add_features(self, *a, **k):
        pass

    def set_task_type(self, *a, **k):
        pass

    def set_folds(self, f):
        pass

    def set_repetition(self, r):
        pass

    def set_aggregate(self, *a, **k):
        pass

    def set_aggregate_method(self, *a):
        pass

    def set_aggregate_exclude_outliers(self, *a):
        pass


def test_spectrodataset_adapter_drives_the_builder():
    # nirs4all is absent in this clean venv; inject a recording double to exercise
    # the lazy SpectroDataset adapter end-to-end (full-array reconstruction).
    ds = nio.load(str(CORPUS / "train_test"), target="spectrodataset", spectro_dataset_cls=_RecordingDataset)
    assert ds.name == "train_test"
    assert {m["partition"] for m in ds.add_samples_calls} == {"train", "test"}
    assert ds.targets >= 1


def test_spectrodataset_adapter_rejects_retired_unversioned_wire():
    """Wheel-level guard: direct adapter calls cannot revive v1 fallback."""
    with pytest.raises(ValueError, match="assembled_schema_version=2"):
        to_spectrodataset({}, spectro_dataset_cls=_RecordingDataset)
