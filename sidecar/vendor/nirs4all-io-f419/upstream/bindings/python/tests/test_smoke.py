# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Smoke tests for the pyo3 binding's JSON surface against the contract corpus."""
from pathlib import Path

import pytest

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

