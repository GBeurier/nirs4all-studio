# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Native public inputs: no oracle assembly or parser retries."""

import json

import numpy as np
import pandas as pd
import pytest

import nirs4all_io as nio


def test_array_tuple_preserves_values_partition_order_and_package():
    x = np.arange(18, dtype=np.float32).reshape(6, 3) / 7
    y = np.arange(6, dtype=np.float32) * .7
    split = np.array(["test", "train", "predict", "train", "test", "train"])
    package = nio.load((x, y, split), target="dataset_package")
    blocks = package.to_assembled().blocks
    for partition in ("train", "test", "predict"):
        np.testing.assert_array_equal(blocks[partition].X[0], x[split == partition])
        np.testing.assert_array_equal(blocks[partition].y.ravel(), y[split == partition])


def test_arrays_with_metadata_and_x_only_prediction_have_no_synthetic_targets():
    x = np.arange(12, dtype=np.float32).reshape(4, 3)
    package = nio.load({"X": x, "metadata": pd.DataFrame({"subject": ["b", "a", "b", "c"]})}, target="package")
    block = package.to_assembled().blocks["predict"]
    np.testing.assert_array_equal(block.X[0], x)
    assert block.y is None
    assert block.metadata["subject"].tolist() == ["b", "a", "b", "c"]


@pytest.mark.parametrize("inp,limits", [
    ((np.ones((4, 3)), np.ones(3)), None),
    ((np.ones((4, 3)), np.ones(4), np.array(["train", "typo", "test", "test"])), None),
    (np.ones((4, 3)), {"max_cells": 2}),
    (np.ones((4, 3)), {"max_decoded_total_bytes": 16}),
])
def test_array_admission_rejects_misalignment_and_small_budgets(inp, limits):
    with pytest.raises(ValueError):
        nio.load(inp, limits=limits)


def test_native_frames_direct_entry_enforces_budget_before_copy():
    from nirs4all_io._native import assemble_frames
    spec = {"sources": [{"id": "x", "role": "features", "input": "x"}]}
    frames = [{"name": "x", "columns": ["a"], "rows": [["longer"]]}]
    with pytest.raises(ValueError, match="field.*limit"):
        assemble_frames(spec, frames, limits={"max_field_bytes": 2})


def test_missing_array_values_are_preserved_without_dropping_rows_or_features():
    x = np.array([[1.0, np.nan], [3.0, 4.0]], dtype=np.float32)
    block = nio.load(x, target="package").to_assembled().blocks["predict"]
    np.testing.assert_array_equal(block.X[0], x)


@pytest.mark.parametrize("value", [float("inf"), -float("inf")])
def test_infinite_array_values_are_not_silently_replaced_by_missing_values(value):
    with pytest.raises(ValueError, match="infinite"):
        nio.load(np.array([[1., value]]), target="package")


def test_yaml_relative_refs_false_header_and_aggregate_budget(tmp_path):
    (tmp_path / "X.csv").write_text("1;2\n3;4\n")
    (tmp_path / "Y.csv").write_text("10\n20\n")
    config = tmp_path / "dataset.yaml"
    config.write_text("train_x: X.csv\ntrain_y: Y.csv\nglobal_params:\n  has_header: false\n  delimiter: ';'\n")
    spec = nio.to_spec(config)
    assert all(source["input"].startswith(str(tmp_path)) for source in spec.sources)
    block = nio.load(config, target="package").to_assembled().blocks["train"]
    np.testing.assert_array_equal(block.X[0], [[1, 2], [3, 4]])
    np.testing.assert_array_equal(block.y.ravel(), [10, 20])
    with pytest.raises(ValueError, match="budget|limit"):
        nio.load(config, limits={"max_total_bytes": config.stat().st_size + 1})


@pytest.mark.parametrize("document", ["sources: &cycle [*cycle]\n", "!!python/object/apply:os.system ['echo forbidden']\n"])
def test_yaml_cycles_and_unsafe_tags_fail_before_assembly(tmp_path, document):
    config = tmp_path / "unsafe.yaml"
    config.write_text(document)
    with pytest.raises((ValueError, __import__("yaml").YAMLError)):
        nio.load(config)


def test_scored_plan_mapping_attributes_and_direct_load_match_resolved_spec(tmp_path):
    (tmp_path / "Xcal.csv").write_text("1100;1102\n1.5;2.5\n3.5;4.5\n5.5;6.5\n")
    (tmp_path / "Ycal.csv").write_text("protein\n1.1\n2.3\n3.7\n")
    plan = nio.infer(tmp_path, hints=None)
    assert plan.structure.value == plan["structure"]["value"]
    assert plan.calibration["method"] == "none"
    assert json.loads(json.dumps(plan)) == plan.to_dict()
    assert nio.load(plan) == nio.load(plan.resolved_spec)
    assert plan.accept(name="reviewed").name == "reviewed"
    assert nio.DatasetPlan().resolved_spec is None
    with pytest.raises(ValueError, match="Non-empty"):
        nio.infer(tmp_path / "missing", hints={"task_type": "regression"})


def test_native_bare_convention_gate_covers_oracle_specific_exception_namespace_case(tmp_path):
    (tmp_path / "spectra.csv").write_text("1100;1102\n1.5;2.5\n3.5;4.5\n")
    (tmp_path / "target.csv").write_text("protein\n1.1\n2.3\n")
    with pytest.raises(ValueError, match="no dataset files recognized"):
        nio.load(tmp_path)
    block = nio.load(tmp_path, conventions=["bare"], target="package").to_assembled().blocks["train"]
    np.testing.assert_array_equal(block.X[0], [[1.5, 2.5], [3.5, 4.5]])
    np.testing.assert_allclose(block.y.ravel(), [1.1, 2.3])


def test_array_categorical_targets_keep_labels_across_partitions():
    x = np.arange(12).reshape(6, 2)
    labels = np.array(["b", "a", "b", "a", "b", "a"])
    split = np.array(["train", "train", "train", "test", "test", "test"])
    ds = nio.load((x, labels, split), target="spectrodataset")
    np.testing.assert_array_equal(ds.y({"y": "raw"}).ravel(), labels)
    np.testing.assert_array_equal(ds.y({"partition": "test"}).ravel(), [0, 1, 0])


@pytest.mark.parametrize("code", [-1, .5, 2, float("nan")])
def test_categorical_codebook_refuses_invalid_codes(code):
    from nirs4all_io._adapter import _decode_targets
    with pytest.raises(ValueError, match="codebook"):
        _decode_targets(np.array([[code]]), ["label"], {"label": {"categories": ["a", "b"]}})
