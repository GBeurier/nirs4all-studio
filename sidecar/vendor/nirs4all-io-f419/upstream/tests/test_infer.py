# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Tests for describe, value detectors, and the infer() engine."""

from __future__ import annotations

import numpy as np
import pandas as pd

import nirs4all_io as nio
from nirs4all_io.infer import describe, detect_signal_type, detect_task_type


def _csv(path, df, sep=";"):
    df.to_csv(path, sep=sep, index=False)


# --------------------------------------------------------------------------- #
# describe                                                                    #
# --------------------------------------------------------------------------- #
def test_describe_delimiter_and_header(tmp_path):
    p = tmp_path / "d.csv"
    p.write_text("a;b;c\n1;2;3\n4;5;6\n", encoding="utf-8")
    desc = describe(p)
    assert desc.delimiter == ";"
    assert desc.has_header is True
    assert desc.n_cols == 3


def test_describe_wavelength_header(tmp_path):
    cols = [str(w) for w in range(1000, 1200, 5)]  # 40 monotonic nm columns
    df = pd.DataFrame(np.random.rand(5, len(cols)) * 0.5 + 0.2, columns=cols)
    _csv(tmp_path / "spectra.csv", df)
    desc = describe(tmp_path / "spectra.csv")
    assert desc.is_wavelength_header is True
    assert desc.header_unit == "nm"
    assert desc.axis_range == (1000.0, 1195.0)


# --------------------------------------------------------------------------- #
# value detectors                                                             #
# --------------------------------------------------------------------------- #
def test_detect_task_type():
    assert detect_task_type(np.array([0, 1, 0, 1]))[0] == "binary"
    assert detect_task_type(np.arange(0, 40))[0] == "multiclass"
    assert detect_task_type(np.random.rand(200) * 100)[0] == "regression"


def test_detect_signal_type_absorbance():
    x = np.random.rand(20, 50) * 2.0 + 0.3  # range ~[0.3, 2.3] -> absorbance
    sig, score, _ = detect_signal_type(x)
    assert sig in ("absorbance", "unknown")  # absorbance scorer dominates; may abstain if ambiguous
    if sig != "unknown":
        assert sig == "absorbance"


def test_detect_signal_type_preprocessed():
    x = np.random.randn(20, 50)  # mean~0, std~1 -> SNV-like
    sig, score, _ = detect_signal_type(x)
    assert sig == "preprocessed"


# --------------------------------------------------------------------------- #
# infer()                                                                     #
# --------------------------------------------------------------------------- #
def test_infer_classic_folder(tmp_path):
    cols = [str(w) for w in range(1000, 1060, 5)]
    _csv(tmp_path / "Xcal.csv", pd.DataFrame(np.random.rand(6, len(cols)), columns=cols))
    _csv(tmp_path / "Ycal.csv", pd.DataFrame({"y": np.arange(6.0)}))
    _csv(tmp_path / "Xval.csv", pd.DataFrame(np.random.rand(3, len(cols)), columns=cols))
    _csv(tmp_path / "Yval.csv", pd.DataFrame({"y": np.arange(3.0)}))
    plan = nio.infer(tmp_path)
    assert plan.structure.value == "train_test_folder"
    assert plan.resolved_spec is not None
    d = plan.to_dict()
    assert d["overall_score"] > 0
    # the plan's resolved_spec must actually load
    asm = nio.load(plan.accept(), base_dir=tmp_path, target="assembled")
    assert set(asm.blocks) == {"train", "test"}


def test_infer_single_combined_file_column_roles(tmp_path):
    cols = [str(w) for w in range(1000, 1100, 5)]  # 20 wavelength cols
    df = pd.DataFrame(np.random.rand(8, len(cols)), columns=cols)
    df["protein"] = np.arange(8.0)
    _csv(tmp_path / "data.csv", df)
    plan = nio.infer(tmp_path / "data.csv")
    assert plan.structure.value == "single_combined"
    # column roles: wavelength cols -> features, 'protein' -> targets
    roles = {g["col"]: g["role"] for g in plan.columns[0]["column_roles"]}
    assert roles["1000"] == "features"
    assert roles["protein"] == "targets"
    asm = nio.load(plan.accept(), base_dir=tmp_path, target="assembled")
    assert asm.blocks["train"].X[0].shape == (8, len(cols))
    assert asm.blocks["train"].y.shape == (8, 1)


def test_infer_directory_full_decisions_with_scores(tmp_path):
    """Directory / file-list inference yields scored decisions for every choice."""
    cols = [str(1000 + i * 5) for i in range(12)]
    rng = np.random.default_rng(0)
    absb = rng.random((20, 12)) * 1.0 + 0.4  # unambiguous absorbance
    _csv(tmp_path / "Xcal.csv", pd.DataFrame(absb, columns=cols))
    _csv(tmp_path / "Ycal.csv", pd.DataFrame({"protein": rng.random(20) * 50}))
    _csv(tmp_path / "Xval.csv", pd.DataFrame(rng.random((6, 12)) * 1.0 + 0.4, columns=cols))
    _csv(tmp_path / "Yval.csv", pd.DataFrame({"protein": rng.random(6) * 50}))
    for inp in (tmp_path, [str(tmp_path / f) for f in ("Xcal.csv", "Ycal.csv", "Xval.csv", "Yval.csv")]):
        plan = nio.infer(inp)
        assert plan.structure.value == "train_test_folder" and plan.structure.score > 0
        # every file assignment carries a role, partition and a confidence score
        assert plan.assignments and all("score" in a and a["partition"] for a in plan.assignments)
        assert {(a["role"], a["partition"]) for a in plan.assignments} >= {("features", "train"), ("targets", "test")}
        assert plan.axis and plan.axis["unit"] == "nm"
        assert plan.signal_type.value == "absorbance"
        # task type detected from the SEPARATE Ycal/Yval target file
        assert plan.task_type is not None and plan.task_type.value == "regression"


def test_infer_task_from_separate_classification_target(tmp_path):
    cols = [str(1000 + i * 5) for i in range(8)]
    rng = np.random.default_rng(1)
    _csv(tmp_path / "Xcal.csv", pd.DataFrame(rng.random((30, 8)), columns=cols))
    _csv(tmp_path / "Ycal.csv", pd.DataFrame({"grade": rng.integers(0, 3, 30)}))
    plan = nio.infer(tmp_path)
    assert plan.task_type is not None and plan.task_type.value == "multiclass"


def test_infer_detects_sample_id_and_audits_coverage(tmp_path):
    """Detect a sample-id column, key the joins by it, and verify each sample has a target + metadata."""
    wl = [str(1000 + i * 5) for i in range(8)]
    rng = np.random.default_rng(0)
    X = pd.DataFrame(rng.random((5, 8)), columns=wl)
    X.insert(0, "Sample_ID", [f"s{i}" for i in range(5)])
    X["site"] = ["A", "A", "B", "B", "A"]
    _csv(tmp_path / "X.csv", X)
    _csv(tmp_path / "Y.csv", pd.DataFrame({"Sample_ID": ["s0", "s1", "s2", "s4"], "protein": rng.random(4)}))  # s3 missing
    _csv(tmp_path / "meta.csv", pd.DataFrame({"site": ["A", "B"], "region": ["north", "south"]}))  # shared m:1 dimension
    plan = nio.infer([str(tmp_path / "X.csv"), str(tmp_path / "Y.csv"), str(tmp_path / "meta.csv")])
    assert plan.identity is not None and plan.identity.value == "Sample_ID"
    assert plan.resolved_spec.sample_index.by.value == "id" and plan.resolved_spec.sample_index.key == "Sample_ID"
    by_role = {a["role"]: a for a in plan.alignment}
    assert by_role["targets"]["n_missing"] == 1 and by_role["targets"]["missing"] == ["s3"]   # s3 has no y
    assert by_role["metadata"]["relation"] == "m:1" and by_role["metadata"]["n_missing"] == 0  # shared metadata
    assert any("NO target" in w for w in plan.warnings)


def test_infer_combined_file_detects_sample_id_column(tmp_path):
    wl = [str(1000 + i * 5) for i in range(8)]
    rng = np.random.default_rng(1)
    df = pd.DataFrame(rng.random((6, 8)), columns=wl)
    df.insert(0, "sample_id", [f"m{i}" for i in range(6)])
    df["protein"] = rng.random(6)
    _csv(tmp_path / "data.csv", df)
    plan = nio.infer(tmp_path / "data.csv")
    assert plan.identity is not None and plan.identity.value == "sample_id"
    assert plan.resolved_spec.sample_index.key == "sample_id"
    roles = {g["col"]: g["role"] for g in plan.columns[0]["column_roles"]}
    assert roles["sample_id"] == "id"  # the id column is identity, not a feature/target/metadata role
    assert roles[wl[0]] == "features" and roles["protein"] == "targets"


def test_infer_repetition_proposes_aggregation(tmp_path):
    """A systematically non-unique sample id -> repeated measurements -> repetition + aggregate."""
    wl = [str(1000 + i * 5) for i in range(8)]
    rng = np.random.default_rng(3)
    ids = [f"s{i}" for i in range(4) for _ in range(3)]  # 4 samples x 3 reps = 12 rows
    df = pd.DataFrame(rng.random((12, 8)), columns=wl)
    df.insert(0, "sample_id", ids)
    df["protein"] = rng.random(12) * 50
    _csv(tmp_path / "reps.csv", df)
    plan = nio.infer(tmp_path / "reps.csv")
    rspec = plan.resolved_spec
    assert rspec.repetition == "sample_id"
    assert rspec.aggregate is not None and rspec.aggregate.by == "sample_id" and rspec.aggregate.method.value == "median"
    assert any("repeated" in r for r in plan.recommendations)

    # classification target -> aggregate by vote
    df["protein"] = [0, 1, 2] * 4
    _csv(tmp_path / "reps_cls.csv", df)
    plan2 = nio.infer(tmp_path / "reps_cls.csv")
    assert plan2.resolved_spec.aggregate.method.value == "vote"


def test_infer_multifile_filename_stem_identity(tmp_path):
    """Multi-file X with no id column (one file per sample) -> identity = filename_stem + coverage audit."""
    from nirs4all_io.infer.engine import _infer_identity_and_alignment
    from nirs4all_io.infer.plan import DatasetPlan

    wl = [str(1000 + i * 5) for i in range(6)]
    for s in ("a", "b", "c"):
        _csv(tmp_path / f"{s}.csv", pd.DataFrame(np.random.default_rng().random((1, 6)), columns=wl))
    _csv(tmp_path / "ref.csv", pd.DataFrame({"filename_stem": ["a", "b", "c"], "y": [1.0, 2.0, 3.0]}))
    plan = DatasetPlan()
    spec = {"sources": [{"id": "spectra", "role": "features", "input": ["a.csv", "b.csv", "c.csv"], "merge": "concat_samples"}, {"id": "ref", "role": "targets", "input": "ref.csv"}]}
    _infer_identity_and_alignment(spec, tmp_path, plan)
    assert plan.identity is not None and plan.identity.value == "filename_stem"
    assert spec["sample_index"] == {"by": "id", "key": "filename_stem"}
    tgt = next(a for a in plan.alignment if a["role"] == "targets")
    assert tgt["n_samples"] == 3 and tgt["n_missing"] == 0


def test_detect_replicate_grouping_unit():
    from nirs4all_io.infer.identity import detect_replicate_grouping

    g = detect_replicate_grouping(["mango_001_a", "mango_001_b", "mango_001_c", "mango_002_a", "mango_002_b"])
    assert g is not None and g.n_samples == 2 and g.avg_reps == 2.5
    assert detect_replicate_grouping(["s1", "s2", "s3"]) is None  # bare numbers are sample ids, not reps
    assert detect_replicate_grouping(["a", "b", "c"]) is None  # no separator -> not replicate suffixes


def test_infer_replicate_files_grouped_into_sample_id(tmp_path):
    from nirs4all_io.infer.engine import _infer_identity_and_alignment
    from nirs4all_io.infer.plan import DatasetPlan

    wl = [str(1000 + i * 5) for i in range(6)]
    files = ["mango_001_a", "mango_001_b", "mango_001_c", "mango_002_a", "mango_002_b"]
    for f in files:
        _csv(tmp_path / f"{f}.csv", pd.DataFrame(np.random.default_rng().random((1, 6)), columns=wl))
    plan = DatasetPlan()
    spec = {"sources": [{"id": "spectra", "role": "features", "input": [str(tmp_path / f"{f}.csv") for f in files], "merge": "concat_samples"}]}
    _infer_identity_and_alignment(spec, tmp_path, plan)
    assert plan.identity.value == "sample_id"
    assert spec["sample_index"]["derive"]["from"] == "filename_stem"
    assert spec["repetition"] == "sample_id" and spec["aggregate"]["by"] == "sample_id"


def test_load_derives_grouped_sample_id_and_broadcasts(tmp_path):
    """End-to-end: a derive rule materializes the grouped sample_id; a per-sample target broadcasts to reps."""
    wl = [str(1000 + i * 5) for i in range(6)]
    files = ["m001_a", "m001_b", "m001_c", "m002_a", "m002_b"]
    for f in files:
        _csv(tmp_path / f"{f}.csv", pd.DataFrame(np.random.default_rng().random((1, 6)), columns=wl))
    _csv(tmp_path / "ref.csv", pd.DataFrame({"sample_id": ["m001", "m002"], "protein": [12.0, 20.0]}))
    spec = {
        "sample_index": {"by": "id", "key": "sample_id", "repetition_id": "filename_stem", "derive": {"from": "filename_stem", "strip_suffix": r"[_\-. ][a-z]$"}},
        "repetition": "sample_id",
        "sources": [
            {"id": "spectra", "role": "features", "input": [str(tmp_path / f"{f}.csv") for f in files], "merge": "concat_samples", "key": "sample_id"},
            {"id": "ref", "kind": "lookup", "input": "ref.csv", "columns": [{"role": "targets", "select": ["protein"]}], "join": {"to": "spectra", "on": "sample_id", "how": "m:1", "coverage": "complete"}},
        ],
    }
    asm = nio.load(spec, base_dir=tmp_path, target="assembled")
    block = asm.blocks["train"]
    assert block.X[0].shape[0] == 5  # 5 replicate rows
    assert sorted(block.y.ravel().tolist()) == [12.0, 12.0, 12.0, 20.0, 20.0]  # broadcast per sample
    assert asm.repetition == "sample_id"


def test_infer_no_false_sample_id(tmp_path):
    # pure wavelengths + a float target -> no id column -> row indexing (identity stays None)
    wl = [str(1000 + i * 5) for i in range(8)]
    df = pd.DataFrame(np.random.default_rng(2).random((6, 8)), columns=wl)
    df["protein"] = np.arange(6.0)
    _csv(tmp_path / "data.csv", df)
    plan = nio.infer(tmp_path / "data.csv")
    assert plan.identity is None


def test_infer_plan_is_json_serializable(tmp_path):
    import json

    _csv(tmp_path / "x.csv", pd.DataFrame({"400": [0.1, 0.2], "401": [0.3, 0.4], "y": [1.0, 2.0]}))
    plan = nio.infer(tmp_path / "x.csv")
    json.dumps(plan.to_dict())  # must not raise
