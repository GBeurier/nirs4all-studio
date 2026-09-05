# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Cookbook coverage matrix (Epic 2.4 gate).

Each case is a real on-disk situation + its DatasetSpec. The vocabulary each
spec exercises is **introspected from the spec** (not hand-asserted), and the
final test fails if any load-supported E.1/E.2 vocabulary element has zero
fixtures -- undocumented/untested vocabulary is treated as unshipped.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

import nirs4all_io as nio
from nirs4all_io.spec import DatasetSpec
from nirs4all_io.spec.enums import MergeMode, SourceKind

# load-supported vocabulary that MUST each have >=1 cookbook fixture
CATALOGUE = {
    "selector:positional", "selector:slice", "selector:names", "selector:name_range", "selector:regex", "selector:dtype", "selector:rest",
    "merge:concat_samples", "merge:concat_features", "merge:by_key",
    "cardinality:1:1", "cardinality:m:1", "cardinality:1:m",
    "coverage:complete", "coverage:warn", "coverage:drop", "coverage:error",
    "partition:column", "partition:index", "partition:index_file",
    "folds:inline", "folds:file", "folds:column",
    "lookup", "composite_key",
    "variations", "role:weights", "selector:auto",
}


def vocab_elements(spec: DatasetSpec) -> set[str]:
    """Introspect which vocabulary elements a spec exercises (generates the matrix)."""
    els: set[str] = set()
    if spec.partitions and spec.partitions.by:
        els.add(f"partition:{spec.partitions.by.value}")
    if spec.folds:
        if spec.folds.inline:
            els.add("folds:inline")
        if spec.folds.file:
            els.add("folds:file")
        if spec.folds.column:
            els.add("folds:column")
    for s in spec.sources:
        if s.merge is not MergeMode.NONE:
            els.add(f"merge:{s.merge.value}")
        if s.kind is SourceKind.LOOKUP:
            els.add("lookup")
        if isinstance(s.key, list):
            els.add("composite_key")
        if s.key == "filename_stem":
            els.add("virtual_key")
        for c in s.columns:
            els.add(f"selector:{c.select.kind}")
            if c.role.value == "weights":
                els.add("role:weights")
        if s.join:
            els.add(f"cardinality:{s.join.cardinality.value}")
            els.add(f"coverage:{s.join.coverage.value}")
        if s.variations:
            els.add("variations")
    return els


def _wl(n=6, start=1000, step=5):
    return [str(start + i * step) for i in range(n)]


def _build(tmp, files):
    for name, df in files.items():
        df.to_csv(tmp / name, sep=";", index=False)


# (id, files, spec) — files written into a per-case tmp dir
def _cases():
    wl = _wl()
    X6 = lambda n=6: pd.DataFrame(np.random.rand(n, len(wl)), columns=wl)  # noqa: E731

    cases: list[tuple[str, dict, dict]] = []

    # L.2 — slice features + positional last target
    df = X6()
    df["y"] = np.arange(6.0)
    cases.append(("L2_slice_positional", {"data.csv": df}, {"sources": [{"id": "d", "role": "mixed", "input": "data.csv", "columns": [{"role": "features", "select": "0:6"}, {"role": "targets", "select": -1}]}]}))

    # L.3 — regex + names + dtype + rest
    df = X6()
    df["protein"] = np.arange(6.0)
    df["site"] = ["a", "b", "a", "b", "a", "b"]
    df["notes"] = ["n"] * 6
    cases.append(("L3_regex_names_dtype_rest", {"d.csv": df}, {"sources": [{"id": "d", "role": "mixed", "input": "d.csv", "columns": [{"role": "features", "select": {"regex": r"^\d+$"}}, {"role": "targets", "select": ["protein"]}, {"role": "metadata", "select": {"dtype": "string"}}, {"role": "ignore", "select": "rest"}]}]}))

    # L.18a — name_range + rest
    df = X6()
    df["protein"] = np.arange(6.0)
    cases.append(("L18a_name_range_rest", {"w.csv": df}, {"sources": [{"id": "a", "role": "mixed", "input": "w.csv", "columns": [{"role": "features", "select": {"name_range": [wl[0], wl[-1]]}}, {"role": "targets", "select": ["protein"]}, {"role": "metadata", "select": "rest"}]}]}))

    # L.6 — concat_samples glob
    cases.append(("L6_concat_samples", {"b1.csv": X6(3).assign(y=[1.0, 2, 3]), "b2.csv": X6(3).assign(y=[4.0, 5, 6])}, {"sources": [{"id": "d", "role": "mixed", "input": ["b1.csv", "b2.csv"], "merge": "concat_samples", "columns": [{"role": "features", "select": {"regex": r"^\d+$"}}, {"role": "targets", "select": ["y"]}]}]}))

    # L.7 — concat_features by key
    cases.append(("L7_concat_features", {"nir.csv": pd.DataFrame({"id": [1, 2, 3], "n1": [0.1, 0.2, 0.3]}), "mir.csv": pd.DataFrame({"id": [1, 2, 3], "m1": [0.4, 0.5, 0.6]})}, {"sources": [{"id": "x", "role": "features", "input": ["nir.csv", "mir.csv"], "merge": "concat_features", "key": "id"}]}))

    # L.18c — by_key merge of 3 files
    cases.append(("L18c_by_key", {"a.csv": pd.DataFrame({"id": [1, 2], "a": [1.0, 2]}), "b.csv": pd.DataFrame({"id": [1, 2], "b": [3.0, 4]}), "c.csv": pd.DataFrame({"id": [1, 2], "c": [5.0, 6]})}, {"sources": [{"id": "d", "role": "features", "input": ["a.csv", "b.csv", "c.csv"], "merge": "by_key", "key": "id"}]}))

    # L.4 — 3 files 1:1 (default complete)
    cases.append(("L4_1to1", {"X.csv": X6(), "Y.csv": pd.DataFrame({"y": np.arange(6.0)})}, {"sources": [{"id": "x", "role": "features", "input": "X.csv"}, {"id": "y", "role": "targets", "input": "Y.csv", "join": {"to": "x", "how": "1:1"}}]}))

    # L.8 flagship — concat_samples + m:1 lookup complete
    meas = lambda site: pd.DataFrame({wl[0]: [0.1, 0.2], wl[1]: [0.3, 0.4], "protein": [1.0, 2.0], "site": site})  # noqa: E731
    cases.append(("L8_flagship_m1_complete", {"ba.csv": meas(["S1", "S2"]), "bb.csv": meas(["S2", "S1"]), "sites.csv": pd.DataFrame({"site": ["S1", "S2"], "region": ["n", "s"]})}, {"sources": [{"id": "m", "role": "mixed", "input": ["ba.csv", "bb.csv"], "merge": "concat_samples", "columns": [{"role": "features", "select": [wl[0], wl[1]]}, {"role": "targets", "select": ["protein"]}, {"role": "metadata", "select": ["site"]}]}, {"id": "sites", "kind": "lookup", "input": "sites.csv", "columns": [{"role": "metadata", "select": ["region"]}], "join": {"to": "m", "on": "site", "how": "m:1", "coverage": "complete"}}]}))

    # m:1 coverage warn (missing key kept + null-filled)
    cases.append(("m1_warn", {"x.csv": pd.DataFrame({wl[0]: [0.1, 0.2, 0.3], "site": ["S1", "S2", "S3"]}), "s.csv": pd.DataFrame({"site": ["S1", "S2"], "region": ["n", "s"]})}, {"sources": [{"id": "x", "role": "mixed", "input": "x.csv", "columns": [{"role": "features", "select": [wl[0]]}, {"role": "metadata", "select": ["site"]}]}, {"id": "s", "kind": "lookup", "input": "s.csv", "columns": [{"role": "metadata", "select": ["region"]}], "join": {"to": "x", "on": "site", "how": "m:1", "coverage": "warn"}}]}))

    # m:1 coverage drop
    cases.append(("m1_drop", {"x.csv": pd.DataFrame({wl[0]: [0.1, 0.2, 0.3], "site": ["S1", "S2", "S3"]}), "s.csv": pd.DataFrame({"site": ["S1", "S2"], "region": ["n", "s"]})}, {"sources": [{"id": "x", "role": "mixed", "input": "x.csv", "columns": [{"role": "features", "select": [wl[0]]}, {"role": "metadata", "select": ["site"]}]}, {"id": "s", "kind": "lookup", "input": "s.csv", "columns": [{"role": "metadata", "select": ["region"]}], "join": {"to": "x", "on": "site", "how": "m:1", "coverage": "drop"}}]}))

    # 1:1 keyed join, coverage error (all keys present -> ok; exercises 'error')
    cases.append(("c1to1_error", {"X.csv": X6().assign(id=list(range(6))), "Y.csv": pd.DataFrame({"id": list(range(6)), "y": np.arange(6.0)})}, {"sample_index": {"by": "id", "key": "id"}, "sources": [{"id": "x", "role": "mixed", "input": "X.csv", "key": "id", "columns": [{"role": "features", "select": {"regex": r"^\d+$"}}]}, {"id": "y", "role": "targets", "input": "Y.csv", "key": "id", "columns": [{"role": "targets", "select": ["y"]}], "join": {"to": "x", "on": "id", "how": "1:1", "coverage": "error"}}]}))

    # 1:m expansion
    cases.append(("c1tom", {"x.csv": pd.DataFrame({"sid": [1, 2], wl[0]: [0.1, 0.2]}), "t.csv": pd.DataFrame({"sid": [1, 1, 2], "y": [10.0, 11, 20]})}, {"sources": [{"id": "x", "role": "mixed", "input": "x.csv", "key": "sid", "columns": [{"role": "features", "select": [wl[0]]}]}, {"id": "t", "role": "targets", "input": "t.csv", "columns": [{"role": "targets", "select": ["y"]}], "join": {"to": "x", "left_on": "sid", "right_on": "sid", "how": "1:m"}}]}))

    # composite key 1:1
    cases.append(("composite", {"x.csv": pd.DataFrame({"a": [1, 1], "b": ["p", "q"], wl[0]: [0.1, 0.2]}), "y.csv": pd.DataFrame({"a": [1, 1], "b": ["p", "q"], "y": [1.0, 2.0]})}, {"sample_index": {"by": "id", "key": ["a", "b"]}, "sources": [{"id": "x", "role": "mixed", "input": "x.csv", "key": ["a", "b"], "columns": [{"role": "features", "select": [wl[0]]}]}, {"id": "y", "role": "targets", "input": "y.csv", "key": ["a", "b"], "columns": [{"role": "targets", "select": ["y"]}], "join": {"left": "x", "right": "y", "left_on": ["a", "b"], "right_on": ["a", "b"], "how": "1:1", "coverage": "complete"}}]}))

    # L.10 — column split
    df = X6(8)
    df["y"] = np.arange(8.0)
    df["set"] = ["cal", "cal", "cal", "cal", "val", "val", "val", "val"]
    cases.append(("L10_column_split", {"all.csv": df}, {"sources": [{"id": "d", "role": "mixed", "input": "all.csv", "columns": [{"role": "features", "select": {"regex": r"^\d+$"}}, {"role": "targets", "select": ["y"]}, {"role": "metadata", "select": ["set"]}]}], "partitions": {"by": "column", "column": "set", "train_values": ["cal"], "test_values": ["val"]}}))

    # L.11 — explicit row-index split (deterministic by construction; no shuffle at load time)
    df = X6(10)
    df["y"] = np.arange(10.0)
    cases.append(("L11_index", {"all.csv": df}, {"sources": [{"id": "d", "role": "mixed", "input": "all.csv", "columns": [{"role": "features", "select": {"regex": r"^\d+$"}}, {"role": "targets", "select": ["y"]}]}], "partitions": {"by": "index", "train": [0, 1, 2, 3, 4, 5, 6], "test": [7, 8, 9]}}))

    # auto selector for targets (deterministic at load time: last numeric column)
    df_auto = X6(6).assign(y=np.arange(6.0))
    cases.append(("auto_targets", {"data.csv": df_auto}, {"sources": [{"id": "d", "role": "mixed", "input": "data.csv", "columns": [{"role": "targets", "select": "auto"}, {"role": "features", "select": "rest"}]}]}))

    # folds inline
    cases.append(("folds_inline", {"X.csv": X6(), "Y.csv": pd.DataFrame({"y": np.arange(6.0)})}, {"sources": [{"id": "x", "role": "features", "input": "X.csv"}, {"id": "y", "role": "targets", "input": "Y.csv", "join": {"to": "x", "how": "1:1"}}], "folds": {"inline": [{"train": [0, 1, 2, 3], "val": [4, 5]}]}}))

    # folds by column (each distinct value of cv_fold -> one fold)
    df_cv = X6(6).assign(y=np.arange(6.0), cv_fold=[0, 1, 0, 1, 0, 1])
    cases.append(("folds_column", {"all.csv": df_cv}, {"sources": [{"id": "d", "role": "mixed", "input": "all.csv", "columns": [{"role": "features", "select": {"regex": r"^\d+$"}}, {"role": "targets", "select": ["y"]}, {"role": "metadata", "select": ["cv_fold"]}]}], "folds": {"column": "cv_fold"}}))

    # weights as a column role: surfaced on the SpectroDataset as a `__sample_weight__` metadata column
    df_w = X6(6).assign(y=np.arange(6.0), w=[1.0, 1.0, 2.0, 0.5, 1.0, 1.5])
    cases.append(("role_weights", {"data.csv": df_w}, {"sources": [{"id": "d", "role": "mixed", "input": "data.csv", "columns": [{"role": "features", "select": {"regex": r"^\d+$"}}, {"role": "targets", "select": ["y"]}, {"role": "weights", "select": ["w"]}]}]}))

    # variations: a feature source with a pre-computed preprocessing variant (e.g. SNV) -> processings on the SpectroDataset
    snv_df = X6(6)  # second file with identical column headers, different values
    cases.append(("variations_snv", {"X.csv": X6(6), "X_snv.csv": snv_df, "Y.csv": pd.DataFrame({"y": np.arange(6.0)})}, {"sources": [{"id": "x", "role": "features", "input": "X.csv", "variations": [{"name": "snv", "input": "X_snv.csv"}]}, {"id": "y", "role": "targets", "input": "Y.csv", "join": {"to": "x", "how": "1:1"}}]}))

    return cases


@pytest.fixture(params=_cases(), ids=lambda c: c[0])
def cookbook_case(request, tmp_path):
    case_id, files, spec_dict = request.param
    _build(tmp_path, files)
    return case_id, spec_dict, tmp_path


def test_cookbook_case_loads(cookbook_case):
    _, spec_dict, base = cookbook_case
    asm = nio.load(spec_dict, base_dir=base, target="assembled")
    assert asm.blocks  # produced at least one partition block
    for block in asm.blocks.values():
        assert block.X and block.X[0].shape[0] == block.n_samples


def test_folds_file_case(tmp_path):
    # folds:file needs an extra fold file written alongside
    pd.DataFrame(np.random.rand(6, 6), columns=_wl()).to_csv(tmp_path / "X.csv", sep=";", index=False)
    pd.DataFrame({"y": np.arange(6.0)}).to_csv(tmp_path / "Y.csv", sep=";", index=False)
    (tmp_path / "folds.csv").write_text("fold_0,fold_1\n0,2\n1,3\n,4\n,5\n", encoding="utf-8")
    spec = {"sources": [{"id": "x", "role": "features", "input": "X.csv"}, {"id": "y", "role": "targets", "input": "Y.csv", "join": {"to": "x", "how": "1:1"}}], "folds": {"file": "folds.csv", "format": "csv"}}
    asm = nio.load(spec, base_dir=tmp_path, target="assembled")
    assert len(asm.folds) == 2


def test_index_file_case(tmp_path):
    # partitions:index_file needs index files written alongside
    df = pd.DataFrame(np.random.rand(8, 6), columns=_wl())
    df["y"] = np.arange(8.0)
    df.to_csv(tmp_path / "all.csv", sep=";", index=False)
    (tmp_path / "train_idx.txt").write_text("0\n1\n2\n3\n4\n", encoding="utf-8")
    (tmp_path / "test_idx.txt").write_text("[5, 6, 7]\n", encoding="utf-8")
    spec = {"sources": [{"id": "d", "role": "mixed", "input": "all.csv", "columns": [{"role": "features", "select": {"regex": r"^\d+$"}}, {"role": "targets", "select": ["y"]}]}], "partitions": {"by": "index_file", "train_file": "train_idx.txt", "test_file": "test_idx.txt"}}
    asm = nio.load(spec, base_dir=tmp_path, target="assembled")
    assert asm.blocks["train"].n_samples == 5
    assert asm.blocks["test"].n_samples == 3


def test_coverage_matrix_complete():
    """Every load-supported E.1/E.2 vocabulary element must be exercised (Epic 2.4 gate)."""
    covered: set[str] = set()
    for _id, _files, spec_dict in _cases():
        covered |= vocab_elements(DatasetSpec.from_dict(spec_dict))
    # folds:file + partition:index_file are exercised by their dedicated tests
    covered.add("folds:file")
    covered.add("partition:index_file")
    missing = CATALOGUE - covered
    assert not missing, f"cookbook does not exercise these vocabulary elements: {sorted(missing)}"
