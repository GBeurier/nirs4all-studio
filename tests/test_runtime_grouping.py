from __future__ import annotations

import numpy as np
import pytest
from sklearn.model_selection import GroupKFold, KFold

import api.shared.runtime_grouping as runtime_grouping
from api.shared.runtime_grouping import (
    normalize_split_group_by_mapping,
    prepare_pipeline_steps_with_runtime_grouping,
)


class DummyDataset:
    def __init__(self, *, repetition: str | None = "sample_id", metadata_columns: list[str] | None = None):
        self.repetition = repetition
        self.metadata_columns = metadata_columns or ["sample_id", "batch"]
        self._values = {
            "sample_id": np.array(["s1", "s1", "s2", "s2"], dtype=object),
            "batch": np.array(["b1", "b1", "b2", "b2"], dtype=object),
        }

    def metadata_column(self, column: str, context=None, include_augmented: bool = False):
        return self._values[column]


@pytest.fixture(autouse=True)
def _patch_splitter_instantiation(monkeypatch):
    def instantiate(name: str, params: dict, operator_type: str = "splitting"):
        if operator_type != "splitting":
            raise AssertionError(f"Unexpected operator type in test: {operator_type}")
        if name == "KFold":
            return KFold(**params)
        if name == "GroupKFold":
            return GroupKFold(**params)
        raise AssertionError(f"Unexpected splitter in test: {name}")

    monkeypatch.setattr(runtime_grouping, "instantiate_operator", instantiate)


def test_normalize_split_group_by_mapping_rejects_unknown_dataset_ids():
    with pytest.raises(ValueError, match="unknown dataset IDs"):
        normalize_split_group_by_mapping(["dataset_a"], {"dataset_b": "batch"})


def test_prepare_pipeline_steps_with_runtime_grouping_injects_group_by():
    steps = [{"type": "splitting", "name": "KFold", "params": {"n_splits": 3}}]

    prepared = prepare_pipeline_steps_with_runtime_grouping(
        steps,
        DummyDataset(),
        "batch",
    )

    assert prepared.steps[0]["params"]["group_by"] == "batch"
    assert "group_by" not in steps[0]["params"]
    assert prepared.has_splitters is True
    assert prepared.has_optional_splitters is True
    assert prepared.has_required_splitters is False
    assert prepared.warnings == []


def test_prepare_pipeline_steps_with_runtime_grouping_warns_for_repetition_only():
    steps = [{"type": "splitting", "name": "GroupKFold", "params": {"n_splits": 2}}]

    prepared = prepare_pipeline_steps_with_runtime_grouping(
        steps,
        DummyDataset(repetition="sample_id"),
        None,
    )

    assert prepared.has_required_splitters is True
    assert prepared.steps[0]["params"] == {"n_splits": 2}
    assert prepared.warnings == [
        "Splitter 'GroupKFold' requires an effective group. No additional 'group_by' was selected, so only the configured dataset repetition 'sample_id' will be used."
    ]


def test_prepare_pipeline_steps_with_runtime_grouping_requires_effective_group():
    steps = [{"type": "splitting", "name": "GroupKFold", "params": {"n_splits": 2}}]

    with pytest.raises(ValueError, match="requires an effective group"):
        prepare_pipeline_steps_with_runtime_grouping(
            steps,
            DummyDataset(repetition=None, metadata_columns=["batch"]),
            None,
        )


def test_prepare_pipeline_steps_with_runtime_grouping_rejects_persisted_group_by():
    steps = [{"type": "splitting", "name": "KFold", "params": {"n_splits": 3, "group_by": "batch"}}]

    with pytest.raises(ValueError, match="already persists 'group_by' or legacy 'group'"):
        prepare_pipeline_steps_with_runtime_grouping(
            steps,
            DummyDataset(),
            "batch",
        )
